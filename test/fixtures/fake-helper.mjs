// A stand-in for the native click helper, driven by the Node protocol tests.
// Usage: node fake-helper.mjs <mode> [stateFile]
//   good         hello, capabilities, a click with a target, a click without one, a malformed line, then waits
//   crash-once   first run: hello then exit 1; later runs (stateFile exists) behave like `good`
//   no-ax        capabilities with accessibility:false (hook still works), then a permission_missing click
//   no-tap       capabilities with hook:false, accessibility:false (macOS before the grant)
//   trust-revoked      (NAT-1) capabilities ok, a click, then hook:false accessibility:false
//   hook-lost          (NAT-2) capabilities ok, {"type":"hook_lost"}, then capabilities ok again
//   unicode-name       (NAT-3) a click whose name holds raw U+2028/U+2029/U+0085, CRLF-terminated
//   hook-false-trusted (NAT-4) capabilities hook:false accessibility:true
//   crash-after-hello  (NAT-8) hello, then exit 1 after 20 ms, every time
//   silent       prints nothing at all (a hung helper)
import { existsSync, writeFileSync } from "node:fs";

const [mode = "good", stateFile] = process.argv.slice(2);
const out = (obj) => process.stdout.write(`${JSON.stringify(obj)}\n`);
const hello = () => out({ type: "hello", helper: "FakeHelper", version: "9.9.9", protocol: 1 });

const target = {
  grounding: "accessibility",
  source: "uia",
  role: "button",
  nativeRole: "Button",
  name: "Save",
  automationId: "saveBtn",
  isPassword: false,
  bounds: { x: 10, y: 20, width: 80, height: 24 },
  ancestry: [{ role: "window", name: "Notepad" }],
  app: { name: "notepad", process: "notepad" },
  windowTitle: "Untitled - Notepad",
  // Must never reach the event stream: not part of ClickTarget.
  value: "SECRET FIELD VALUE",
};

function runGood() {
  hello();
  out({ type: "capabilities", hook: true, accessibility: true, space: "windows_virtual_px" });
  out({ type: "click", button: "left", clickCount: 1, x: 105, y: 215, lookupMs: 12, target });
  process.stdout.write("this is not json\n");
  process.stdout.write('{"type":"click","button":"left"}\n'); // missing coordinates
  out({ type: "click", button: "right", clickCount: 1, x: 5, y: 6, lookupMs: 300, unavailableReason: "timeout" });
  process.stdin.resume();
  process.stdin.on("end", () => process.exit(0));
}

if (mode === "good") {
  runGood();
} else if (mode === "crash-once") {
  if (stateFile && existsSync(stateFile)) {
    runGood();
  } else {
    if (stateFile) writeFileSync(stateFile, "crashed");
    hello();
    setTimeout(() => process.exit(1), 50);
  }
} else if (mode === "no-ax") {
  hello();
  out({ type: "capabilities", hook: true, accessibility: false, space: "macos_global_points" });
  out({ type: "click", button: "left", clickCount: 1, x: 40, y: 50, lookupMs: 0, unavailableReason: "permission_missing" });
  process.stdin.resume();
  process.stdin.on("end", () => process.exit(0));
} else if (mode === "no-tap") {
  hello();
  out({ type: "capabilities", hook: false, accessibility: false, space: "macos_global_points" });
  process.stdin.resume();
  process.stdin.on("end", () => process.exit(0));
} else if (mode === "trust-revoked") {
  // NAT-1: Accessibility is taken away mid-run; the helper tears the tap down and says so.
  hello();
  out({ type: "capabilities", hook: true, accessibility: true, space: "macos_global_points" });
  out({ type: "click", button: "left", clickCount: 1, x: 1, y: 2, lookupMs: 5, target });
  setTimeout(() => out({ type: "capabilities", hook: false, accessibility: false, space: "macos_global_points" }), 60);
  process.stdin.resume();
  process.stdin.on("end", () => process.exit(0));
} else if (mode === "hook-lost") {
  // NAT-2: the Windows watchdog saw the hook disappear, reinstalled it, and re-announced it.
  hello();
  out({ type: "capabilities", hook: true, accessibility: null, space: "windows_virtual_px" });
  setTimeout(() => out({ type: "hook_lost" }), 40);
  setTimeout(() => out({ type: "capabilities", hook: true, accessibility: null, space: "windows_virtual_px" }), 140);
  process.stdin.resume();
  process.stdin.on("end", () => process.exit(0));
} else if (mode === "unicode-name") {
  // NAT-3: a raw U+2028 / U+2029 / U+0085 inside a control name, as a helper that does not escape them sends it.
  hello();
  out({ type: "capabilities", hook: true, accessibility: true, space: "windows_virtual_px" });
  process.stdout.write(
    `${JSON.stringify({ type: "click", button: "left", clickCount: 1, x: 7, y: 8, lookupMs: 3, target: { ...target, name: "Line One Two\u0085Three" } })}\r\n`,
  );
  out({ type: "click", button: "left", clickCount: 1, x: 9, y: 9, lookupMs: 3, unavailableReason: "timeout" });
  process.stdin.resume();
  process.stdin.on("end", () => process.exit(0));
} else if (mode === "hook-false-trusted") {
  // NAT-4: Accessibility is granted but the hook is not installed.
  hello();
  out({ type: "capabilities", hook: false, accessibility: true, space: "macos_global_points" });
  process.stdin.resume();
  process.stdin.on("end", () => process.exit(0));
} else if (mode === "crash-after-hello") {
  // NAT-8: every run says hello and dies; the test counts how often it is relaunched.
  hello();
  setTimeout(() => process.exit(1), 20);
} else if (mode === "silent") {
  process.stdin.resume();
  process.stdin.on("end", () => process.exit(0));
}
