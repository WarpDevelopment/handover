// Handover click and control helper for Windows.
//
// One C# file, compiled in CI with the in-box csc.exe (.NET Framework 4.x, C# 5 language level) by
// scripts/build-helper-win.ps1, with app.manifest (Per-Monitor-V2 DPI aware).
// Keep it C# 5: no $"" interpolation, no ?., no nameof, no expression-bodied members, no tuples, no out var.
//
// Privacy floors (docs/recorder/tester-package.md section 1):
//   * MOUSE hook only (WH_MOUSE_LL). There is no keyboard hook anywhere in this file.
//   * Control NAME and role only. No ValuePattern, no TextPattern, no field values.
//     Password fields keep role and name and are flagged isPassword.
//   * No network access.
//
// Protocol: JSON lines on stdout, one object per line. stderr is for logs only.
//   {"type":"hello","helper":"HandoverHelper","version":"1.0.0","platform":"windows","protocol":1}
//   {"type":"capabilities","hook":true,"uia":true,"interactive":true,"elevated":false,"space":"windows_virtual_px"}
//   {"type":"click","button":"left","clickCount":1,"x":10,"y":20,"lookupMs":12,"target":{...},"unavailableReason":"..."}
//   {"type":"hook_lost"}                (the watchdog saw the hook disappear; capabilities hook:true follows the reinstall)
//   {"type":"error","message":"..."}
//   {"type":"selftest", ...}            (--selftest only)
// The process exits when stdin closes.

using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows.Automation;

namespace Handover
{
    internal static class Program
    {
        internal const string Version = "1.0.0";
        internal const int LookupTimeoutMs = 300;
        /// <summary>The ancestry walk may use this much of a lookup; whatever it collected by then is kept (NAT-5).</summary>
        internal const int AncestryBudgetMs = 200;

        private static readonly object OutLock = new object();
        private static StreamWriter stdout;

        internal static void Emit(string jsonLine)
        {
            lock (OutLock)
            {
                stdout.WriteLine(jsonLine);
                stdout.Flush();
            }
        }

        internal static void Log(string message)
        {
            try { Console.Error.WriteLine("[HandoverHelper] " + message); } catch { }
        }

        internal static bool Elevated;

        /// <summary>The capabilities line; re-sent after the watchdog reinstalls the hook (hook:true closes the gap).</summary>
        internal static void EmitCapabilities(bool hookOk)
        {
            Emit("{\"type\":\"capabilities\",\"hook\":" + Json.Bool(hookOk)
                + ",\"uia\":true,\"interactive\":" + Json.Bool(Environment.UserInteractive)
                + ",\"elevated\":" + Json.Bool(Elevated)
                + ",\"space\":\"windows_virtual_px\"}");
        }

        private static int Main(string[] args)
        {
            stdout = new StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(false));
            stdout.AutoFlush = false;

            bool selftest = Array.IndexOf(args, "--selftest") >= 0;
            Elevated = Native.IsCurrentProcessElevated();

            Emit("{\"type\":\"hello\",\"helper\":\"HandoverHelper\",\"version\":\"" + Version
                + "\",\"platform\":\"windows\",\"protocol\":1}");

            if (selftest) return SelfTest();

            Lookup.Warmup();
            ClickHook hook = new ClickHook();
            bool hookOk = hook.Start();
            EmitCapabilities(hookOk);
            if (!hookOk)
            {
                Emit("{\"type\":\"error\",\"message\":\"SetWindowsHookEx(WH_MOUSE_LL) failed\"}");
                return 2;
            }

            // Exit when the parent closes our stdin.
            Thread watcher = new Thread(delegate ()
            {
                try { while (Console.In.Read() != -1) { } } catch { }
                hook.Stop();
            });
            watcher.IsBackground = true;
            watcher.Start();

            hook.RunMessageLoop(); // returns when Stop() posts WM_QUIT
            return 0;
        }

        private static int SelfTest()
        {
            // 1. Can a low-level mouse hook be installed here? Install and remove at once.
            bool hookOk = false;
            try
            {
                IntPtr id = Native.SetWindowsHookEx(Native.WH_MOUSE_LL, NoopProc, Native.GetModuleHandle(null), 0);
                hookOk = id != IntPtr.Zero;
                if (hookOk) Native.UnhookWindowsHookEx(id);
            }
            catch (Exception e) { Log("selftest hook: " + e.Message); }

            EmitCapabilities(hookOk);

            // 2. FromPoint(10,10) through the same path a click takes.
            StringBuilder sb = new StringBuilder();
            sb.Append("{\"type\":\"selftest\",\"interactive\":").Append(Json.Bool(Environment.UserInteractive));
            sb.Append(",\"hookInstalled\":").Append(Json.Bool(hookOk));
            // Cold call first, with a generous budget, to show UIA works at all; then the warm call a click
            // would make, with the real 300 ms budget.
            Stopwatch cold = Stopwatch.StartNew();
            LookupResult coldResult = Lookup.Run(10, 10, true, 10000);
            sb.Append(",\"coldFromPointMs\":").Append(cold.ElapsedMilliseconds.ToString(CultureInfo.InvariantCulture));
            sb.Append(",\"coldFromPoint\":\"").Append(coldResult.TargetJson != null ? "found" : (coldResult.Reason ?? "none")).Append("\"");
            Stopwatch sw = Stopwatch.StartNew();
            LookupResult r = Lookup.Run(10, 10, true);
            sb.Append(",\"fromPointMs\":").Append(sw.ElapsedMilliseconds.ToString(CultureInfo.InvariantCulture));
            if (r.TargetJson != null)
            {
                sb.Append(",\"fromPoint\":\"found\",\"target\":").Append(r.TargetJson);
            }
            else
            {
                sb.Append(",\"fromPoint\":\"none\",\"reason\":\"").Append(r.Reason ?? "unknown").Append("\"");
            }
            sb.Append("}");
            Emit(sb.ToString());
            // Exit 0 as long as the helper started and said hello; the hook and UIA results above are
            // reported, not asserted, because they depend on the runner session.
            return 0;
        }

        private static IntPtr NoopProc(int nCode, IntPtr wParam, IntPtr lParam)
        {
            return Native.CallNextHookEx(IntPtr.Zero, nCode, wParam, lParam);
        }
    }

    internal sealed class RawClick
    {
        public int Button;      // 0 left, 1 right, 2 middle
        public int X, Y;
        public uint Time;       // MSLLHOOKSTRUCT.time (ms tick)
    }

    /// <summary>
    /// The low-level mouse hook. The callback only copies the point into a queue and calls the next hook:
    /// Windows silently removes a hook whose callback takes longer than LowLevelHooksTimeout (1 s).
    /// A worker thread does the UIA lookup with a 300 ms timeout. A watchdog notices a removed hook.
    /// </summary>
    internal sealed class ClickHook
    {
        private readonly BlockingCollection<RawClick> queue = new BlockingCollection<RawClick>(new ConcurrentQueue<RawClick>(), 256);
        private readonly Native.HookProc proc; // kept in a field so the delegate is never collected
        private IntPtr hookId = IntPtr.Zero;
        private uint loopThreadId;

        private int lastButton = -1;
        private uint lastTime;
        private int lastX, lastY;

        // Watchdog state. The hook callback only increments a counter (any mouse message, so a moving cursor is a
        // heartbeat). A counter, not Environment.TickCount: a tick can repeat or wrap, a counter cannot look idle
        // when callbacks did arrive (N1).
        private volatile int heartbeat;
        private volatile bool hookInstalled;
        private volatile bool stopped;
        // The hook thread only STORES the outcome of a reinstall; the watchdog thread reads it and does the I/O (N2).
        private volatile bool reinstallPending; // a reinstall was posted and has not finished
        private volatile bool reinstallDone;    // the hook thread finished one; hookInstalled holds the result

        public ClickHook() { proc = Callback; }

        public bool Start()
        {
            loopThreadId = Native.GetCurrentThreadId();
            // The hook thread must not be starved: Windows drops a hook whose callback is late (NAT-2).
            try { Thread.CurrentThread.Priority = ThreadPriority.Highest; } catch { }
            hookId = Native.SetWindowsHookEx(Native.WH_MOUSE_LL, proc, Native.GetModuleHandle(null), 0);
            if (hookId == IntPtr.Zero) return false;
            hookInstalled = true;

            Thread worker = new Thread(Work);
            worker.IsBackground = true;
            worker.Name = "click-lookup";
            worker.Start();

            Thread dog = new Thread(Watchdog);
            dog.IsBackground = true;
            dog.Name = "hook-watchdog";
            dog.Start();
            return true;
        }

        public void Stop()
        {
            stopped = true;
            queue.CompleteAdding();
            if (loopThreadId != 0) Native.PostThreadMessage(loopThreadId, Native.WM_QUIT, UIntPtr.Zero, IntPtr.Zero);
        }

        public void RunMessageLoop()
        {
            Native.MSG msg;
            while (Native.GetMessage(out msg, IntPtr.Zero, 0, 0) > 0)
            {
                // Hooks are serviced by GetMessage. The watchdog asks for a reinstall on THIS thread, because a
                // low-level hook only works while its installing thread pumps messages.
                if (msg.message == Native.WM_REINSTALL_HOOK) Reinstall();
            }
            if (hookId != IntPtr.Zero) Native.UnhookWindowsHookEx(hookId);
            hookId = IntPtr.Zero;
        }

        private void Reinstall()
        {
            if (stopped) return;
            if (hookId != IntPtr.Zero) { Native.UnhookWindowsHookEx(hookId); hookId = IntPtr.Zero; }
            hookId = Native.SetWindowsHookEx(Native.WH_MOUSE_LL, proc, Native.GetModuleHandle(null), 0);
            hookInstalled = hookId != IntPtr.Zero;
            // Store the result and nothing else: this is the hook thread, and a write to stdout can block on the
            // output lock or a full pipe while the new hook is already installed (N2). The watchdog reports it.
            // The heartbeat is NOT touched here: only a real callback proves the hook works.
            reinstallDone = true;
        }

        private void PostReinstall()
        {
            reinstallPending = true;
            Native.PostThreadMessage(loopThreadId, Native.WM_REINSTALL_HOOK, UIntPtr.Zero, IntPtr.Zero);
        }

        /// <summary>
        /// About once a second: if the cursor moved and real input happened, but the hook counted no mouse
        /// message, the hook looks lost. Two such checks in a row are required before it is reported (N1): say
        /// so once per streak, then ask the hook thread to reinstall and report the outcome. While the hook is not
        /// installed, keep retrying. All stdout writes happen here, never on the hook thread.
        /// </summary>
        private void Watchdog()
        {
            Native.POINT prev;
            bool havePrev = Native.GetCursorPos(out prev);
            int prevBeat = heartbeat;
            uint prevInput = LastInputTick();
            int suspect = 0;           // consecutive checks that looked lost
            bool lostStreak = false;   // hook_lost already reported and no callback counted since
            bool quietNext = false;    // the next successful reinstall is a repeat inside a streak
            while (!stopped)
            {
                Thread.Sleep(1000);
                if (stopped) break;

                // Report a finished reinstall. hook:true closes the helper_restart gap in the app; hook:false keeps it
                // open and the retry below runs. A repeat inside a streak that succeeded stays quiet.
                if (reinstallDone)
                {
                    reinstallDone = false;
                    reinstallPending = false;
                    bool ok = hookInstalled;
                    if (!(quietNext && ok)) Program.EmitCapabilities(ok);
                    quietNext = false;
                }

                Native.POINT cur;
                bool haveCur = Native.GetCursorPos(out cur); // fails on the secure desktop (lock screen, UAC): skip then
                uint input = LastInputTick();
                int beat = heartbeat;
                if (beat != prevBeat) { lostStreak = false; suspect = 0; } // a callback was counted: the hook is alive

                if (!hookInstalled)
                {
                    if (!reinstallPending) PostReinstall();
                }
                else
                {
                    bool moved = haveCur && havePrev && (cur.x != prev.x || cur.y != prev.y);
                    bool inputSince = input != prevInput;
                    // UIPI may withhold hook callbacks while the cursor or the foreground window belongs to a
                    // higher-integrity process. Silence there is not a lost hook, so do not judge it (unproven on device).
                    bool overHigher = moved && Native.CursorOrForegroundHigherIntegrity(cur.x, cur.y);
                    bool looksLost = moved && inputSince && beat == prevBeat && !overHigher;
                    suspect = looksLost ? suspect + 1 : 0;
                    if (suspect >= 2)
                    {
                        suspect = 0;
                        hookInstalled = false; // no more judging until the reinstall reports
                        if (!lostStreak)
                        {
                            lostStreak = true;
                            Program.Log("watchdog: no hook callback while the mouse moved; reinstalling");
                            Program.Emit("{\"type\":\"hook_lost\"}");
                        }
                        else
                        {
                            quietNext = true;
                        }
                        PostReinstall();
                    }
                }
                prev = cur; havePrev = haveCur; prevBeat = beat; prevInput = input;
            }
        }

        private static uint LastInputTick()
        {
            Native.LASTINPUTINFO li = new Native.LASTINPUTINFO();
            li.cbSize = (uint)Marshal.SizeOf(typeof(Native.LASTINPUTINFO));
            return Native.GetLastInputInfo(ref li) ? li.dwTime : 0;
        }

        // Runs on the hook thread. Keep it tiny: no UIA, no I/O, no locks that can block.
        private IntPtr Callback(int nCode, IntPtr wParam, IntPtr lParam)
        {
            if (nCode >= 0)
            {
                heartbeat++; // heartbeat for the watchdog: a counter increment and nothing else (single writer: this thread)
                int msg = wParam.ToInt32();
                int button = -1;
                if (msg == Native.WM_LBUTTONDOWN) button = 0;
                else if (msg == Native.WM_RBUTTONDOWN) button = 1;
                else if (msg == Native.WM_MBUTTONDOWN) button = 2;
                if (button >= 0)
                {
                    Native.MSLLHOOKSTRUCT h = (Native.MSLLHOOKSTRUCT)Marshal.PtrToStructure(lParam, typeof(Native.MSLLHOOKSTRUCT));
                    RawClick c = new RawClick();
                    c.Button = button; c.X = h.pt.x; c.Y = h.pt.y; c.Time = h.time;
                    try { queue.TryAdd(c); } catch (InvalidOperationException) { }
                }
            }
            return Native.CallNextHookEx(hookId, nCode, wParam, lParam);
        }

        private void Work()
        {
            foreach (RawClick c in queue.GetConsumingEnumerable())
            {
                try
                {
                    int count = ClickCount(c);
                    // When we are behind, do not stack 300 ms timeouts: report the click without a lookup.
                    bool skipLookup = queue.Count > 8;
                    Stopwatch sw = Stopwatch.StartNew();
                    LookupResult r = Lookup.Run(c.X, c.Y, !skipLookup);
                    if (skipLookup) r.Reason = "timeout";
                    long ms = sw.ElapsedMilliseconds;

                    StringBuilder sb = new StringBuilder();
                    sb.Append("{\"type\":\"click\",\"button\":\"").Append(c.Button == 0 ? "left" : c.Button == 1 ? "right" : "middle").Append("\"");
                    sb.Append(",\"clickCount\":").Append(count);
                    sb.Append(",\"x\":").Append(c.X.ToString(CultureInfo.InvariantCulture));
                    sb.Append(",\"y\":").Append(c.Y.ToString(CultureInfo.InvariantCulture));
                    sb.Append(",\"lookupMs\":").Append(ms.ToString(CultureInfo.InvariantCulture));
                    if (r.TargetJson != null) sb.Append(",\"target\":").Append(r.TargetJson);
                    if (r.Reason != null) sb.Append(",\"unavailableReason\":\"").Append(r.Reason).Append("\"");
                    sb.Append("}");
                    Program.Emit(sb.ToString());
                }
                catch (Exception e)
                {
                    Program.Log("worker: " + e.Message);
                    Program.Emit("{\"type\":\"error\",\"message\":" + Json.Str("click worker: " + e.GetType().Name) + "}");
                }
            }
        }

        private int ClickCount(RawClick c)
        {
            uint dt = (uint)Native.GetDoubleClickTime();
            int dx = Math.Max(1, Native.GetSystemMetrics(Native.SM_CXDOUBLECLK));
            int dy = Math.Max(1, Native.GetSystemMetrics(Native.SM_CYDOUBLECLK));
            bool dbl = lastButton == c.Button
                && unchecked(c.Time - lastTime) <= dt
                && Math.Abs(c.X - lastX) <= dx / 2
                && Math.Abs(c.Y - lastY) <= dy / 2;
            if (dbl) { lastButton = -1; } // a third click starts a new sequence
            else { lastButton = c.Button; lastTime = c.Time; lastX = c.X; lastY = c.Y; }
            return dbl ? 2 : 1;
        }
    }

    internal sealed class LookupResult
    {
        public string TargetJson;   // a ClickTarget as JSON, or null
        public string Reason;       // an UnavailableReason, or null
    }

    /// <summary>What the lookup has collected so far. Written by the lookup thread, read (as a snapshot) by Run.</summary>
    internal sealed class ElementData
    {
        public string Role = "other";
        public string NativeRole = "";
        public string Name = "";
        public string AutoId = "";
        public bool IsPassword;
        public System.Windows.Rect Rect = System.Windows.Rect.Empty;
        public readonly List<string[]> Parents = new List<string[]>(); // nearest parent first
        public System.Windows.Rect WinRect = System.Windows.Rect.Empty;
        public string WindowTitle = "";
        public string Process;
    }

    internal static class Lookup
    {
        private static readonly string[] RemoteProcesses = new string[] {
            "mstsc", "msrdc", "msrdcw", "windows365", "windowsapp", "wfica32", "wfcrun32",
            "cdviewer", "selfservice", "receiver", "citrixworkspace",
            "vmware-view", "vmware-remotemks"
        };

        // Lookup threads still blocked inside UIA, in total and per root-window process (NAT-11): one hung app
        // stops lookups against that app only, not against every other window.
        private const int MaxStuckTotal = 8;
        private const int MaxStuckPerProcess = 2;
        private static readonly object StuckLock = new object();
        private static readonly Dictionary<uint, int> StuckByPid = new Dictionary<uint, int>();
        private static int stuckTotal;

        private sealed class Holder
        {
            public readonly object Gate = new object();
            public LookupResult Result;   // a final answer that needs no snapshot (remote, elevated, no element, error)
            public ElementData Data;      // the element, once resolved; the ancestry is added to it as it is walked
        }

        /// <summary>Resolve the control at (x, y) with a hard 300 ms budget.</summary>
        public static LookupResult Run(int x, int y, bool allowLookup)
        {
            return Run(x, y, allowLookup, Program.LookupTimeoutMs);
        }

        /// <summary>
        /// The first UIA call in a process loads providers and can take well over 300 ms (measured 302 ms
        /// and a timeout on the CI runner). Warm it up in the background so the first real click is not lost.
        /// </summary>
        public static void Warmup()
        {
            Thread t = new Thread(delegate () { try { Run(10, 10, true, 5000); } catch { } });
            t.IsBackground = true;
            t.Start();
        }

        private static bool TryEnter(uint pid)
        {
            lock (StuckLock)
            {
                int n;
                StuckByPid.TryGetValue(pid, out n);
                if (stuckTotal >= MaxStuckTotal || n >= MaxStuckPerProcess) return false;
                StuckByPid[pid] = n + 1;
                stuckTotal++;
                return true;
            }
        }

        private static void Leave(uint pid)
        {
            lock (StuckLock)
            {
                int n;
                if (StuckByPid.TryGetValue(pid, out n))
                {
                    if (n <= 1) StuckByPid.Remove(pid); else StuckByPid[pid] = n - 1;
                }
                if (stuckTotal > 0) stuckTotal--;
            }
        }

        public static LookupResult Run(int x, int y, bool allowLookup, int timeoutMs)
        {
            if (!allowLookup) return new LookupResult { Reason = "timeout" };

            uint pid;
            string title;
            Native.RootWindowAt(x, y, out pid, out title);
            if (!TryEnter(pid)) return new LookupResult { Reason = "timeout" };

            // The ancestry deadline: about 200 ms of the 300 ms click budget; a longer (selftest) budget is used whole.
            int ancestryBudgetMs = timeoutMs > Program.LookupTimeoutMs ? timeoutMs : Program.AncestryBudgetMs;
            Holder holder = new Holder();
            Stopwatch clock = Stopwatch.StartNew();
            Thread t = new Thread(delegate ()
            {
                try { Resolve(holder, x, y, pid, title, clock, ancestryBudgetMs); }
                catch (Exception e)
                {
                    Program.Log("lookup: " + e.GetType().Name + " " + e.Message);
                    lock (holder.Gate)
                    {
                        if (holder.Data == null)
                            holder.Result = new LookupResult { Reason = Native.IsHigherIntegrity(pid) ? "elevated_window" : "opaque_toolkit" };
                    }
                }
                finally { Leave(pid); }
            });
            t.IsBackground = true;
            t.SetApartmentState(ApartmentState.MTA);
            t.Start();
            bool finished = t.Join(timeoutMs);

            // Return the element as soon as it is resolved, even if the ancestry walk is still running or was cut
            // short: a control without all of its parents is far better than a lost click (NAT-5).
            lock (holder.Gate)
            {
                if (holder.Result != null) return holder.Result;
                if (holder.Data != null) return Build(holder.Data);
            }
            return new LookupResult { Reason = finished ? "opaque_toolkit" : "timeout" };
        }

        /// <summary>A top-level window as a weak target: its title and process, no UIA.</summary>
        private static string WindowTarget(string process, string title)
        {
            StringBuilder sb = new StringBuilder();
            sb.Append("{\"grounding\":\"accessibility_weak\",\"source\":\"uia\",\"role\":\"window\",\"nativeRole\":\"Window\"");
            sb.Append(",\"name\":").Append(Json.Str(Json.Clean(title)));
            sb.Append(",\"isPassword\":false");
            if (process != null)
                sb.Append(",\"app\":{\"name\":").Append(Json.Str(process)).Append(",\"process\":").Append(Json.Str(process)).Append("}");
            sb.Append(",\"windowTitle\":").Append(Json.Str(Json.Clean(title))).Append("}");
            return sb.ToString();
        }

        private static void Resolve(Holder holder, int x, int y, uint pid, string title, Stopwatch clock, int ancestryBudgetMs)
        {
            string process = Native.ProcessName(pid);

            // Remote-desktop clients are classified without touching UIA: the UIA tree stops at the client window.
            if (process != null && Array.IndexOf(RemoteProcesses, process.ToLowerInvariant()) >= 0)
            {
                lock (holder.Gate) { holder.Result = new LookupResult { TargetJson = WindowTarget(process, title), Reason = "remote_session" }; }
                return;
            }

            // A window of a higher integrity level than ours cannot be read through UIA (UIPI): say so, keep the
            // window title, and do not spend the budget on a call that will fail (NAT-6).
            if (pid != 0 && Native.IsHigherIntegrity(pid))
            {
                lock (holder.Gate) { holder.Result = new LookupResult { TargetJson = WindowTarget(process, title), Reason = "elevated_window" }; }
                return;
            }

            AutomationElement el = null;
            CacheRequest cr = new CacheRequest();
            cr.Add(AutomationElement.NameProperty);
            cr.Add(AutomationElement.ControlTypeProperty);
            cr.Add(AutomationElement.AutomationIdProperty);
            cr.Add(AutomationElement.ClassNameProperty);
            cr.Add(AutomationElement.BoundingRectangleProperty);
            cr.Add(AutomationElement.IsPasswordProperty);
            cr.Add(AutomationElement.ProcessIdProperty);
            cr.TreeScope = TreeScope.Element;
            try
            {
                using (cr.Activate())
                {
                    el = AutomationElement.FromPoint(new System.Windows.Point(x, y));
                }
            }
            catch (ElementNotAvailableException) { el = null; }
            catch (InvalidOperationException) { el = null; }
            catch (System.ComponentModel.Win32Exception) { el = null; }

            if (el == null)
            {
                lock (holder.Gate) { holder.Result = new LookupResult { Reason = "opaque_toolkit" }; }
                return;
            }

            // Read cached properties only. Never GetCurrentPropertyValue(Value) or a ValuePattern.
            ElementData d = new ElementData();
            d.Name = Json.Clean(el.Cached.Name);
            ControlType ct = el.Cached.ControlType;
            d.Role = Role(ct);
            d.NativeRole = ct == null ? "" : (ct.ProgrammaticName ?? "").Replace("ControlType.", "");
            try { d.IsPassword = el.Cached.IsPassword; } catch { }
            d.AutoId = Json.Clean(el.Cached.AutomationId);
            try { d.Rect = el.Cached.BoundingRectangle; } catch { }
            d.WindowTitle = title ?? "";
            d.Process = process;
            if (d.Process == null) { try { d.Process = Native.ProcessName((uint)el.Cached.ProcessId); } catch { } }

            // The element is resolved: publish it now. Everything after this only adds detail.
            lock (holder.Gate) { holder.Data = d; }

            // Ancestry, nearest parent first, up to and including the top-level window, against a deadline.
            try
            {
                AutomationElement desktop = null;
                try { desktop = AutomationElement.RootElement; } catch { } // fetched once, not per parent
                TreeWalker walker = TreeWalker.ControlViewWalker;
                AutomationElement cur = el;
                for (int i = 0; i < 24; i++)
                {
                    if (clock.ElapsedMilliseconds >= ancestryBudgetMs) break;
                    AutomationElement p = walker.GetParent(cur, cr);
                    if (p == null || (desktop != null && Automation.Compare(p, desktop))) break;
                    string pRole = Role(p.Cached.ControlType);
                    string pName = Json.Clean(p.Cached.Name);
                    System.Windows.Rect pRect = System.Windows.Rect.Empty;
                    if (pRole == "window") { try { pRect = p.Cached.BoundingRectangle; } catch { } }
                    lock (holder.Gate)
                    {
                        d.Parents.Add(new string[] { pRole, pName });
                        if (pRole == "window") { d.WindowTitle = pName; d.WinRect = pRect; }
                    }
                    if (pRole == "window") break; // the first window-role parent ends the walk
                    cur = p;
                }
            }
            catch (Exception e) { Program.Log("ancestry: " + e.GetType().Name); }
        }

        /// <summary>Builds the click target from a snapshot. The caller holds the holder's lock.</summary>
        private static LookupResult Build(ElementData d)
        {
            bool weak = d.Name.Length == 0 || d.Role == "other";
            if (!weak && d.Role != "window" && !d.WinRect.IsEmpty && !d.Rect.IsEmpty)
            {
                double winArea = d.WinRect.Width * d.WinRect.Height;
                if (winArea > 0 && (d.Rect.Width * d.Rect.Height) / winArea > 0.6) weak = true;
            }

            StringBuilder sb2 = new StringBuilder();
            sb2.Append("{\"grounding\":\"").Append(weak ? "accessibility_weak" : "accessibility").Append("\",\"source\":\"uia\"");
            sb2.Append(",\"role\":\"").Append(d.Role).Append("\",\"nativeRole\":").Append(Json.Str(d.NativeRole));
            sb2.Append(",\"name\":").Append(Json.Str(d.Name));
            if (d.AutoId.Length > 0) sb2.Append(",\"automationId\":").Append(Json.Str(d.AutoId));
            sb2.Append(",\"isPassword\":").Append(Json.Bool(d.IsPassword));
            System.Windows.Rect rect = d.Rect;
            if (!rect.IsEmpty && !double.IsInfinity(rect.X) && !double.IsInfinity(rect.Y)
                && !double.IsInfinity(rect.Width) && !double.IsInfinity(rect.Height))
            {
                sb2.Append(",\"bounds\":{\"x\":").Append(Json.Num(rect.X)).Append(",\"y\":").Append(Json.Num(rect.Y))
                   .Append(",\"width\":").Append(Json.Num(rect.Width)).Append(",\"height\":").Append(Json.Num(rect.Height)).Append("}");
            }
            if (d.Parents.Count > 0)
            {
                // Window first, nearest parent last, at most 6 entries.
                List<string[]> parents = new List<string[]>(d.Parents);
                parents.Reverse();
                List<string[]> kept = new List<string[]>();
                if (parents.Count <= 6) kept.AddRange(parents);
                else { kept.Add(parents[0]); kept.AddRange(parents.GetRange(parents.Count - 5, 5)); }
                sb2.Append(",\"ancestry\":[");
                for (int i = 0; i < kept.Count; i++)
                {
                    if (i > 0) sb2.Append(",");
                    sb2.Append("{\"role\":\"").Append(kept[i][0]).Append("\",\"name\":").Append(Json.Str(kept[i][1])).Append("}");
                }
                sb2.Append("]");
            }
            if (d.Process != null)
                sb2.Append(",\"app\":{\"name\":").Append(Json.Str(d.Process)).Append(",\"process\":").Append(Json.Str(d.Process)).Append("}");
            if (d.WindowTitle != null && d.WindowTitle.Length > 0) sb2.Append(",\"windowTitle\":").Append(Json.Str(Json.Clean(d.WindowTitle)));
            sb2.Append("}");

            return new LookupResult { TargetJson = sb2.ToString(), Reason = weak ? "opaque_toolkit" : null };
        }

        private static string Role(ControlType ct)
        {
            if (ct == null) return "other";
            if (ct == ControlType.Button || ct == ControlType.SplitButton) return "button";
            if (ct == ControlType.Edit) return "textbox";
            if (ct == ControlType.ComboBox) return "combobox";
            if (ct == ControlType.ListItem) return "listitem";
            if (ct == ControlType.MenuItem) return "menuitem";
            if (ct == ControlType.Hyperlink) return "link";
            if (ct == ControlType.TabItem) return "tab";
            if (ct == ControlType.CheckBox) return "checkbox";
            if (ct == ControlType.RadioButton) return "radio";
            if (ct == ControlType.DataItem) return "row";
            if (ct == ControlType.TreeItem) return "treeitem";
            if (ct == ControlType.Window) return "window";
            if (ct == ControlType.Pane || ct == ControlType.Group) return "pane";
            if (ct == ControlType.Document) return "document";
            if (ct == ControlType.Text) return "text";
            if (ct == ControlType.Image) return "image";
            return "other";
        }
    }

    internal static class Json
    {
        public static string Bool(bool b) { return b ? "true" : "false"; }

        public static string Num(double d)
        {
            return Math.Round(d).ToString("0", CultureInfo.InvariantCulture);
        }

        /// <summary>Line separators that some JSON readers (and readline) treat as a line break: U+0085, U+2028, U+2029.</summary>
        private static bool IsLineSeparator(char c)
        {
            return c == (char)0x85 || c == (char)0x2028 || c == (char)0x2029;
        }

        /// <summary>Control names are capped and stripped of control characters and Unicode line separators.</summary>
        public static string Clean(string s)
        {
            if (s == null) return "";
            StringBuilder sb = new StringBuilder();
            foreach (char c in s)
            {
                if (c < 0x20 || c == 0x7f || IsLineSeparator(c)) sb.Append(' '); else sb.Append(c);
                if (sb.Length >= 200) break;
            }
            return sb.ToString();
        }

        public static string Str(string s)
        {
            StringBuilder sb = new StringBuilder("\"");
            foreach (char c in s ?? "")
            {
                switch (c)
                {
                    case '"': sb.Append("\\\""); break;
                    case '\\': sb.Append("\\\\"); break;
                    case '\n': sb.Append("\\n"); break;
                    case '\r': sb.Append("\\r"); break;
                    case '\t': sb.Append("\\t"); break;
                    default:
                        // Escaped, never raw: a raw U+2028/U+2029/U+0085 splits the line in a naive line reader (NAT-3).
                        if (c < 0x20 || IsLineSeparator(c)) sb.Append("\\u").Append(((int)c).ToString("x4"));
                        else sb.Append(c);
                        break;
                }
            }
            return sb.Append("\"").ToString();
        }
    }

    internal static class Native
    {
        public const int WH_MOUSE_LL = 14;
        public const int WM_LBUTTONDOWN = 0x0201;
        public const int WM_RBUTTONDOWN = 0x0204;
        public const int WM_MBUTTONDOWN = 0x0207;
        public const uint WM_QUIT = 0x0012;
        public const uint WM_REINSTALL_HOOK = 0x8001; // WM_APP + 1, posted by the watchdog to the hook thread
        public const int SM_CXDOUBLECLK = 36;
        public const int SM_CYDOUBLECLK = 37;
        private const uint GA_ROOT = 2;
        private const uint PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
        private const uint TOKEN_QUERY = 0x0008;
        private const int TokenElevation = 20;
        private const int TokenIntegrityLevel = 25;

        public delegate IntPtr HookProc(int nCode, IntPtr wParam, IntPtr lParam);

        [StructLayout(LayoutKind.Sequential)] public struct POINT { public int x; public int y; }
        [StructLayout(LayoutKind.Sequential)]
        public struct MSLLHOOKSTRUCT { public POINT pt; public uint mouseData; public uint flags; public uint time; public UIntPtr dwExtraInfo; }
        [StructLayout(LayoutKind.Sequential)]
        public struct MSG { public IntPtr hwnd; public uint message; public UIntPtr wParam; public IntPtr lParam; public uint time; public POINT pt; }
        [StructLayout(LayoutKind.Sequential)]
        public struct LASTINPUTINFO { public uint cbSize; public uint dwTime; }

        [DllImport("user32.dll", SetLastError = true)] public static extern IntPtr SetWindowsHookEx(int idHook, HookProc lpfn, IntPtr hMod, uint dwThreadId);
        [DllImport("user32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] public static extern bool UnhookWindowsHookEx(IntPtr hhk);
        [DllImport("user32.dll")] public static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);
        [DllImport("user32.dll")] public static extern int GetMessage(out MSG lpMsg, IntPtr hWnd, uint wMsgFilterMin, uint wMsgFilterMax);
        [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] public static extern bool PostThreadMessage(uint idThread, uint msg, UIntPtr wParam, IntPtr lParam);
        [DllImport("user32.dll")] public static extern int GetDoubleClickTime();
        [DllImport("user32.dll")] public static extern int GetSystemMetrics(int nIndex);
        [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] public static extern bool GetCursorPos(out POINT p);
        [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] public static extern bool GetLastInputInfo(ref LASTINPUTINFO plii);
        [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(POINT p);
        [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr hwnd, uint flags);
        [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
        [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr GetModuleHandle(string name);
        [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
        [DllImport("kernel32.dll")] static extern uint GetCurrentProcessId();
        [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
        [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
        [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        static extern bool QueryFullProcessImageName(IntPtr process, uint flags, StringBuilder name, ref int size);
        [DllImport("advapi32.dll", SetLastError = true)] static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);
        [DllImport("advapi32.dll", SetLastError = true)] static extern bool GetTokenInformation(IntPtr token, int cls, out uint info, int len, out int returned);
        [DllImport("advapi32.dll", SetLastError = true, EntryPoint = "GetTokenInformation")]
        static extern bool GetTokenInformationBuffer(IntPtr token, int cls, IntPtr buffer, int len, out int returned);
        [DllImport("advapi32.dll")] static extern IntPtr GetSidSubAuthorityCount(IntPtr sid);
        [DllImport("advapi32.dll")] static extern IntPtr GetSidSubAuthority(IntPtr sid, uint index);

        /// <summary>Top-level window under the point: its process id and title (GetWindowText, not UIA).</summary>
        public static IntPtr RootWindowAt(int x, int y, out uint pid, out string title)
        {
            pid = 0; title = "";
            POINT p; p.x = x; p.y = y;
            IntPtr h = WindowFromPoint(p);
            if (h == IntPtr.Zero) return IntPtr.Zero;
            IntPtr root = GetAncestor(h, GA_ROOT);
            if (root == IntPtr.Zero) root = h;
            GetWindowThreadProcessId(root, out pid);
            StringBuilder sb = new StringBuilder(256);
            GetWindowText(root, sb, sb.Capacity);
            title = sb.ToString();
            return root;
        }

        /// <summary>
        /// The executable name without folder or extension. OpenProcess plus QueryFullProcessImageName is far
        /// cheaper than Process.GetProcessById, which enumerates processes. The folder is never returned.
        /// </summary>
        public static string ProcessName(uint pid)
        {
            if (pid == 0) return null;
            IntPtr h = IntPtr.Zero;
            try
            {
                h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid);
                if (h == IntPtr.Zero) return null;
                StringBuilder sb = new StringBuilder(1024);
                int size = sb.Capacity;
                if (!QueryFullProcessImageName(h, 0, sb, ref size)) return null;
                return Path.GetFileNameWithoutExtension(sb.ToString());
            }
            catch { return null; }
            finally { if (h != IntPtr.Zero) CloseHandle(h); }
        }

        private static bool IsElevated(IntPtr process)
        {
            IntPtr token;
            if (!OpenProcessToken(process, TOKEN_QUERY, out token)) return true; // cannot even open it: treat as higher
            try
            {
                uint elevated; int ret;
                if (!GetTokenInformation(token, TokenElevation, out elevated, 4, out ret)) return false;
                return elevated != 0;
            }
            finally { CloseHandle(token); }
        }

        public static bool IsCurrentProcessElevated()
        {
            try { return IsElevated(GetCurrentProcess()); } catch { return false; }
        }

        /// <summary>
        /// The mandatory integrity level (SECURITY_MANDATORY_*_RID) of a process: 0x2000 medium, 0x3000 high.
        /// -1 when it cannot be read; int.MaxValue when the token cannot be opened (a higher-integrity process).
        /// </summary>
        private static int IntegrityRid(IntPtr process)
        {
            IntPtr token;
            if (!OpenProcessToken(process, TOKEN_QUERY, out token)) return int.MaxValue;
            try
            {
                int need;
                GetTokenInformationBuffer(token, TokenIntegrityLevel, IntPtr.Zero, 0, out need);
                if (need <= 0) return -1;
                IntPtr buffer = Marshal.AllocHGlobal(need);
                try
                {
                    int ret;
                    if (!GetTokenInformationBuffer(token, TokenIntegrityLevel, buffer, need, out ret)) return -1;
                    IntPtr sid = Marshal.ReadIntPtr(buffer); // TOKEN_MANDATORY_LABEL starts with the label SID
                    int count = Marshal.ReadByte(GetSidSubAuthorityCount(sid));
                    if (count <= 0) return -1;
                    return Marshal.ReadInt32(GetSidSubAuthority(sid, (uint)(count - 1)));
                }
                finally { Marshal.FreeHGlobal(buffer); }
            }
            finally { CloseHandle(token); }
        }

        /// <summary>True when the window under the point, or the foreground window, belongs to a higher-integrity process.</summary>
        public static bool CursorOrForegroundHigherIntegrity(int x, int y)
        {
            try
            {
                uint pid; string t;
                RootWindowAt(x, y, out pid, out t);
                if (IsHigherIntegrity(pid)) return true;
                uint fg;
                GetWindowThreadProcessId(GetForegroundWindow(), out fg);
                return IsHigherIntegrity(fg);
            }
            catch { return false; }
        }

        private static int ownRid = -2;

        /// <summary>
        /// True when the process belongs to a higher integrity level than ours (UIPI blocks UIA and input
        /// there). Access denied to a same-session process is read as higher.
        /// </summary>
        public static bool IsHigherIntegrity(uint pid)
        {
            try
            {
                if (pid == 0 || pid == GetCurrentProcessId()) return false;
                if (ownRid == -2) ownRid = IntegrityRid(GetCurrentProcess());
                if (ownRid < 0 || ownRid == int.MaxValue) return false;
                IntPtr h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid);
                if (h == IntPtr.Zero) return true;
                try
                {
                    int rid = IntegrityRid(h);
                    if (rid == int.MaxValue) return true;
                    if (rid < 0) return false;
                    return rid > ownRid;
                }
                finally { CloseHandle(h); }
            }
            catch { return false; }
        }
    }
}
