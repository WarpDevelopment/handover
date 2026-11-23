// Handover click and control helper for Windows.
//
// One C# file, compiled in CI with the in-box csc.exe (.NET Framework 4.x) by
// scripts/build-helper-win.ps1, with app.manifest (Per-Monitor-V2 DPI aware).
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

        private static int Main(string[] args)
        {
            stdout = new StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(false));
            stdout.AutoFlush = false;

            bool selftest = Array.IndexOf(args, "--selftest") >= 0;
            bool elevated = Native.IsCurrentProcessElevated();

            Emit("{\"type\":\"hello\",\"helper\":\"HandoverHelper\",\"version\":\"" + Version
                + "\",\"platform\":\"windows\",\"protocol\":1}");

            if (selftest) return SelfTest(elevated);

            Lookup.Warmup();
            ClickHook hook = new ClickHook();
            bool hookOk = hook.Start();
            Emit("{\"type\":\"capabilities\",\"hook\":" + Json.Bool(hookOk)
                + ",\"uia\":true,\"interactive\":" + Json.Bool(Environment.UserInteractive)
                + ",\"elevated\":" + Json.Bool(elevated)
                + ",\"space\":\"windows_virtual_px\"}");
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

        private static int SelfTest(bool elevated)
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

            Emit("{\"type\":\"capabilities\",\"hook\":" + Json.Bool(hookOk)
                + ",\"uia\":true,\"interactive\":" + Json.Bool(Environment.UserInteractive)
                + ",\"elevated\":" + Json.Bool(elevated)
                + ",\"space\":\"windows_virtual_px\"}");

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
    /// A worker thread does the UIA lookup with a 300 ms timeout.
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

        public ClickHook() { proc = Callback; }

        public bool Start()
        {
            loopThreadId = Native.GetCurrentThreadId();
            hookId = Native.SetWindowsHookEx(Native.WH_MOUSE_LL, proc, Native.GetModuleHandle(null), 0);
            if (hookId == IntPtr.Zero) return false;

            Thread worker = new Thread(Work);
            worker.IsBackground = true;
            worker.Name = "click-lookup";
            worker.Start();
            return true;
        }

        public void Stop()
        {
            queue.CompleteAdding();
            if (loopThreadId != 0) Native.PostThreadMessage(loopThreadId, Native.WM_QUIT, UIntPtr.Zero, IntPtr.Zero);
        }

        public void RunMessageLoop()
        {
            Native.MSG msg;
            while (Native.GetMessage(out msg, IntPtr.Zero, 0, 0) > 0) { /* hooks are serviced by GetMessage */ }
            if (hookId != IntPtr.Zero) Native.UnhookWindowsHookEx(hookId);
            hookId = IntPtr.Zero;
        }

        // Runs on the hook thread. Keep it tiny: no UIA, no I/O, no locks that can block.
        private IntPtr Callback(int nCode, IntPtr wParam, IntPtr lParam)
        {
            if (nCode >= 0)
            {
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

    internal static class Lookup
    {
        private static readonly string[] RemoteProcesses = new string[] {
            "mstsc", "msrdc", "msrdcw", "windows365", "windowsapp", "wfica32", "wfcrun32",
            "cdviewer", "selfservice", "receiver", "citrixworkspace"
        };

        private static int stuck; // lookup threads still blocked inside UIA

        private sealed class Holder { public LookupResult Result; }

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

        public static LookupResult Run(int x, int y, bool allowLookup, int timeoutMs)
        {
            if (!allowLookup) return new LookupResult { Reason = "timeout" };
            if (Thread.VolatileRead(ref stuck) >= 4) return new LookupResult { Reason = "timeout" };

            Holder holder = new Holder();
            Thread t = new Thread(delegate ()
            {
                try { holder.Result = Resolve(x, y); }
                catch (Exception e)
                {
                    Program.Log("lookup: " + e.GetType().Name + " " + e.Message);
                    holder.Result = new LookupResult { Reason = Native.LooksElevated(x, y) ? "elevated_window" : "opaque_toolkit" };
                }
                finally { Interlocked.Decrement(ref stuck); }
            });
            t.IsBackground = true;
            t.SetApartmentState(ApartmentState.MTA);
            Interlocked.Increment(ref stuck);
            t.Start();
            if (!t.Join(timeoutMs)) return new LookupResult { Reason = "timeout" };
            return holder.Result ?? new LookupResult { Reason = "opaque_toolkit" };
        }

        private static LookupResult Resolve(int x, int y)
        {
            // Remote-desktop clients are classified without touching UIA: the UIA tree stops at the client window.
            uint pid;
            string title;
            IntPtr root = Native.RootWindowAt(x, y, out pid, out title);
            string process = Native.ProcessName(pid);
            if (process != null && Array.IndexOf(RemoteProcesses, process.ToLowerInvariant()) >= 0)
            {
                StringBuilder sb = new StringBuilder();
                sb.Append("{\"grounding\":\"accessibility_weak\",\"source\":\"uia\",\"role\":\"window\",\"nativeRole\":\"Window\"");
                sb.Append(",\"name\":").Append(Json.Str(Json.Clean(title)));
                sb.Append(",\"isPassword\":false");
                sb.Append(",\"app\":{\"name\":").Append(Json.Str(process)).Append(",\"process\":").Append(Json.Str(process)).Append("}");
                sb.Append(",\"windowTitle\":").Append(Json.Str(Json.Clean(title))).Append("}");
                return new LookupResult { TargetJson = sb.ToString(), Reason = "remote_session" };
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
                return new LookupResult { Reason = Native.LooksElevated(x, y) ? "elevated_window" : "opaque_toolkit" };
            }

            // Read cached properties only. Never GetCurrentPropertyValue(Value) or a ValuePattern.
            string name = Json.Clean(el.Cached.Name);
            ControlType ct = el.Cached.ControlType;
            string role = Role(ct);
            string native = ct == null ? "" : (ct.ProgrammaticName ?? "").Replace("ControlType.", "");
            bool isPassword = false;
            try { isPassword = el.Cached.IsPassword; } catch { }
            string autoId = Json.Clean(el.Cached.AutomationId);
            System.Windows.Rect rect = System.Windows.Rect.Empty;
            try { rect = el.Cached.BoundingRectangle; } catch { }

            // Ancestry, nearest parent first, up to the top-level window.
            List<string[]> parents = new List<string[]>();
            System.Windows.Rect winRect = System.Windows.Rect.Empty;
            string windowTitle = title;
            try
            {
                TreeWalker walker = TreeWalker.ControlViewWalker;
                AutomationElement cur = el;
                for (int i = 0; i < 24; i++)
                {
                    AutomationElement p = walker.GetParent(cur, cr);
                    if (p == null || p == AutomationElement.RootElement) break;
                    string pRole = Role(p.Cached.ControlType);
                    string pName = Json.Clean(p.Cached.Name);
                    parents.Add(new string[] { pRole, pName });
                    if (pRole == "window") { windowTitle = pName; try { winRect = p.Cached.BoundingRectangle; } catch { } }
                    cur = p;
                }
            }
            catch (Exception e) { Program.Log("ancestry: " + e.GetType().Name); }

            bool weak = name.Length == 0 || role == "other";
            if (!weak && role != "window" && !winRect.IsEmpty && !rect.IsEmpty)
            {
                double winArea = winRect.Width * winRect.Height;
                if (winArea > 0 && (rect.Width * rect.Height) / winArea > 0.6) weak = true;
            }

            StringBuilder sb2 = new StringBuilder();
            sb2.Append("{\"grounding\":\"").Append(weak ? "accessibility_weak" : "accessibility").Append("\",\"source\":\"uia\"");
            sb2.Append(",\"role\":\"").Append(role).Append("\",\"nativeRole\":").Append(Json.Str(native));
            sb2.Append(",\"name\":").Append(Json.Str(name));
            if (autoId.Length > 0) sb2.Append(",\"automationId\":").Append(Json.Str(autoId));
            sb2.Append(",\"isPassword\":").Append(Json.Bool(isPassword));
            if (!rect.IsEmpty && !double.IsInfinity(rect.X) && !double.IsInfinity(rect.Width))
            {
                sb2.Append(",\"bounds\":{\"x\":").Append(Json.Num(rect.X)).Append(",\"y\":").Append(Json.Num(rect.Y))
                   .Append(",\"width\":").Append(Json.Num(rect.Width)).Append(",\"height\":").Append(Json.Num(rect.Height)).Append("}");
            }
            if (parents.Count > 0)
            {
                // Window first, nearest parent last, at most 6 entries.
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
            string proc = process;
            if (proc == null) { try { proc = Native.ProcessName((uint)el.Cached.ProcessId); } catch { } }
            if (proc != null)
                sb2.Append(",\"app\":{\"name\":").Append(Json.Str(proc)).Append(",\"process\":").Append(Json.Str(proc)).Append("}");
            if (windowTitle != null && windowTitle.Length > 0) sb2.Append(",\"windowTitle\":").Append(Json.Str(Json.Clean(windowTitle)));
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

        /// <summary>Control names are capped and stripped of control characters.</summary>
        public static string Clean(string s)
        {
            if (s == null) return "";
            StringBuilder sb = new StringBuilder();
            foreach (char c in s)
            {
                if (c < 0x20 || c == 0x7f) sb.Append(' '); else sb.Append(c);
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
                        if (c < 0x20) sb.Append("\\u").Append(((int)c).ToString("x4"));
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
        public const int SM_CXDOUBLECLK = 36;
        public const int SM_CYDOUBLECLK = 37;
        private const uint GA_ROOT = 2;
        private const uint PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
        private const uint TOKEN_QUERY = 0x0008;
        private const int TokenElevation = 20;

        public delegate IntPtr HookProc(int nCode, IntPtr wParam, IntPtr lParam);

        [StructLayout(LayoutKind.Sequential)] public struct POINT { public int x; public int y; }
        [StructLayout(LayoutKind.Sequential)]
        public struct MSLLHOOKSTRUCT { public POINT pt; public uint mouseData; public uint flags; public uint time; public UIntPtr dwExtraInfo; }
        [StructLayout(LayoutKind.Sequential)]
        public struct MSG { public IntPtr hwnd; public uint message; public UIntPtr wParam; public IntPtr lParam; public uint time; public POINT pt; }

        [DllImport("user32.dll", SetLastError = true)] public static extern IntPtr SetWindowsHookEx(int idHook, HookProc lpfn, IntPtr hMod, uint dwThreadId);
        [DllImport("user32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] public static extern bool UnhookWindowsHookEx(IntPtr hhk);
        [DllImport("user32.dll")] public static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);
        [DllImport("user32.dll")] public static extern int GetMessage(out MSG lpMsg, IntPtr hWnd, uint wMsgFilterMin, uint wMsgFilterMax);
        [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] public static extern bool PostThreadMessage(uint idThread, uint msg, UIntPtr wParam, IntPtr lParam);
        [DllImport("user32.dll")] public static extern int GetDoubleClickTime();
        [DllImport("user32.dll")] public static extern int GetSystemMetrics(int nIndex);
        [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(POINT p);
        [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr hwnd, uint flags);
        [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
        [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr GetModuleHandle(string name);
        [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
        [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
        [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
        [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
        [DllImport("advapi32.dll", SetLastError = true)] static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);
        [DllImport("advapi32.dll", SetLastError = true)] static extern bool GetTokenInformation(IntPtr token, int cls, out uint info, int len, out int returned);

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

        public static string ProcessName(uint pid)
        {
            if (pid == 0) return null;
            try { return Process.GetProcessById((int)pid).ProcessName; } catch { return null; }
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
        /// True when the foreground window, or the window under the point, belongs to a process at a higher
        /// integrity level than ours (UIPI). Used only after UIA has already failed.
        /// </summary>
        public static bool LooksElevated(int x, int y)
        {
            try
            {
                if (IsCurrentProcessElevated()) return false;
                uint pid; string t;
                RootWindowAt(x, y, out pid, out t);
                if (pid == 0) { GetWindowThreadProcessId(GetForegroundWindow(), out pid); }
                if (pid == 0) return false;
                IntPtr h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid);
                if (h == IntPtr.Zero) return true; // access denied to a same-session process implies higher integrity
                try { return IsElevated(h); } finally { CloseHandle(h); }
            }
            catch { return false; }
        }
    }
}
