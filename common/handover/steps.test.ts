import assert from "node:assert/strict";
import test from "node:test";

import type { RecEvent } from "../types";
import { appKind, buildSteps, buildStepsWithState, groundingOf, reduceUrl, summaryFor } from "./steps";

let seq = 0;
function ev(t: number, type: string, payload: Record<string, unknown>): RecEvent {
  return { seq: seq++, t, epoch: 1_000_000 + t, type, source: "test", payload };
}
const dpx = (c: { x: number; y: number }): [number, number] => [c.x * 2, c.y * 2];
/** A window that contains every point the tests click, so a control-less click keeps its app. */
const BOUNDS = { x: 0, y: 0, width: 1000, height: 800 };
/** A second window to the right of the first (x 500 to 1500). */
const BOUNDS_B = { x: 500, y: 0, width: 1000, height: 800 };

test("summaries come from templates and never carry typed values", () => {
  assert.equal(
    summaryFor({ actionType: "click", appName: "Excel", target: { role: "button", name: "Save" } }),
    'Click button "Save" in Excel',
  );
  assert.equal(summaryFor({ actionType: "app_switch", appName: "Google Chrome" }), "Switch to Google Chrome");
  assert.equal(
    summaryFor({ actionType: "click", appName: "Excel", pointDpx: [120.4, 80.6] }),
    "Click at (120, 81) in Excel",
  );
  assert.equal(
    summaryFor({ actionType: "double_click", appName: "Excel", target: { role: "cell", name: "" } }),
    "Double-click cell in Excel",
  );
  assert.equal(
    summaryFor({ actionType: "right_click", target: { role: "textbox", name: 'say "hi"' } }),
    "Right-click text box \"say 'hi'\"",
  );
});

test("the click payload has no value field, so a typed value cannot reach a summary", () => {
  const steps = buildSteps(
    [
      ev(100, "pointer.click", {
        button: "left", clickCount: 1, space: "macos_global_points", x: 1, y: 1,
        // A hostile producer: extra fields that would be values must be ignored.
        value: "hunter2", target: { grounding: "accessibility", source: "ax", role: "textbox", nativeRole: "AXTextField", name: "Email", isPassword: false, value: "secret@example.com" },
      }),
    ],
    dpx,
  );
  assert.equal(steps[0].summary, 'Click text box "Email"');
  assert.ok(!steps[0].summary.includes("secret"));
});

test("clicks, app switches and ordering: click, then app switch", () => {
  const steps = buildSteps(
    [
      ev(0, "session.start", {}),
      ev(100, "app.activate", { app: "Excel", title: "Book1", bounds: { x: 0, y: 0, width: 400, height: 800 } }),
      ev(1000, "pointer.click", { button: "left", clickCount: 1, space: "macos_global_points", x: 5, y: 6 }),
      ev(2000, "app.activate", { app: "Google Chrome", title: "Inbox", url: "https://a.example/x?q=1#f", bounds: BOUNDS_B }),
      ev(3000, "pointer.click", { button: "right", clickCount: 1, space: "macos_global_points", x: 700, y: 8 }),
      ev(4000, "pointer.click", { button: "left", clickCount: 2, space: "macos_global_points", x: 700, y: 8 }),
    ],
    dpx,
  );
  assert.deepEqual(
    steps.map((s) => [s.kind, s.actionType, s.summary]),
    [
      ["context", "app_switch", "Switch to Excel"],
      ["action", "click", "Click at (10, 12) in Excel"], // inside Excel's last known window
      ["context", "app_switch", "Switch to Google Chrome"],
      ["action", "right_click", "Right-click at (1400, 16) in Google Chrome"],
      ["action", "double_click", "Double-click at (1400, 16) in Google Chrome"],
    ],
  );
  // The browser URL is reduced to origin + path.
  assert.equal(steps[3].url, "https://a.example/x");
});

test("an app switch right after a click in the same app is not a separate step", () => {
  const steps = buildSteps(
    [
      ev(100, "app.activate", { app: "Excel", title: "Book1" }),
      ev(1000, "app.activate", { app: "Finder", title: "Desktop" }),
      ev(2000, "pointer.click", {
        button: "left", clickCount: 1, space: "macos_global_points", x: 1, y: 1,
        target: { grounding: "accessibility", source: "ax", role: "button", nativeRole: "AXButton", name: "OK", isPassword: false, app: { name: "Excel" } },
      }),
      ev(2300, "app.activate", { app: "Excel", title: "Book1" }), // the click's own effect
      ev(2400, "app.title-change", { app: "Excel", title: "Book1 - saved" }),
    ],
    dpx,
  );
  assert.deepEqual(steps.map((s) => s.summary), ["Switch to Excel", "Switch to Finder", 'Click button "OK" in Excel']);
});

test("grounding follows the helper result", () => {
  const base = { button: "left", clickCount: 1, space: "macos_global_points", x: 0, y: 0 } as const;
  assert.deepEqual(groundingOf({ ...base }), { grounding: "visual_only", unavailable: "helper_missing" });
  assert.deepEqual(groundingOf({ ...base, unavailableReason: "timeout" }), { grounding: "visual_only", unavailable: "timeout" });
  const target = { grounding: "accessibility", source: "uia", role: "button", nativeRole: "Button", name: "x", isPassword: false } as const;
  assert.deepEqual(groundingOf({ ...base, target }), { grounding: "accessibility" });
  assert.equal(groundingOf({ ...base, target: { ...target, grounding: "accessibility_weak" } }).grounding, "accessibility_weak");
});

test("URLs drop query and fragment; non-web schemes are dropped", () => {
  assert.equal(reduceUrl("https://mail.example.com/inbox?token=abc#frag"), "https://mail.example.com/inbox");
  assert.equal(reduceUrl("http://localhost:3000/a/b"), "http://localhost:3000/a/b");
  assert.equal(reduceUrl("file:///Users/x/secret.txt"), undefined);
  assert.equal(reduceUrl("not a url"), undefined);
});

test("app kind comes from process, bundle id and the remote_session reason (ClickTarget.app has no kind)", () => {
  for (const p of ["mstsc.exe", "msrdc.exe", "msrdcw.exe", "WindowsApp.exe", "wfica32.exe"]) {
    assert.equal(appKind("x", p), "remote_session", p);
  }
  assert.equal(appKind("Windows App", "WindowsApp.exe"), "remote_session");
  assert.equal(appKind("Chrome", "chrome.exe"), "browser");
  assert.equal(appKind("Safari", undefined, "com.apple.Safari"), "browser");
  assert.equal(appKind("Some", undefined, "com.microsoft.rdc.macos"), "remote_session");
  assert.equal(appKind("Excel", "EXCEL.EXE", "com.microsoft.Excel", "remote_session"), "remote_session");
  assert.equal(appKind("Excel", "EXCEL.EXE"), "native");
  // End to end: a click with no target but the remote_session reason marks the app.
  const steps = buildSteps(
    [
      ev(100, "app.activate", { app: "Notepad", title: "" }),
      ev(900, "pointer.click", { button: "left", clickCount: 1, space: "windows_virtual_px", x: 1, y: 1, unavailableReason: "remote_session" }),
    ],
    dpx,
  );
  assert.equal(steps[1].app.kind, "remote_session");
  const viaTarget = buildSteps(
    [ev(100, "pointer.click", { button: "left", clickCount: 1, space: "windows_virtual_px", x: 1, y: 1,
      target: { grounding: "accessibility", source: "uia", role: "button", nativeRole: "Button", name: "OK", isPassword: false, app: { name: "Remote Desktop", process: "mstsc.exe" } } })],
    dpx,
  );
  assert.equal(viaTarget[0].app.kind, "remote_session");
});

test("a double-click (two clicks, the second with clickCount 2) is one double_click step", () => {
  const target = { grounding: "accessibility", source: "ax", role: "cell", nativeRole: "AXCell", name: "B2", isPassword: false, app: { name: "Excel" } };
  const steps = buildSteps(
    [
      ev(1000, "pointer.click", { button: "left", clickCount: 1, space: "macos_global_points", x: 5, y: 6, lookupMs: 20, target }),
      ev(1180, "pointer.click", { button: "left", clickCount: 2, space: "macos_global_points", x: 5, y: 6, lookupMs: 20, target }),
      ev(5000, "pointer.click", { button: "left", clickCount: 1, space: "macos_global_points", x: 9, y: 9 }),
    ],
    dpx,
  );
  assert.equal(steps.length, 2);
  assert.equal(steps[0].actionType, "double_click");
  assert.equal(steps[0].summary, 'Double-click cell "B2" in Excel');
  assert.equal(steps[0].tMs, 980, "the step keeps the first click's time, back-dated to when the user acted");
  assert.equal(steps[0].frameTMs, 980);
  assert.equal(steps[0].click?.clickCount, 2);
  // Too far apart, a different button, or no first click: not merged.
  const apart = buildSteps(
    [
      ev(1000, "pointer.click", { button: "left", clickCount: 1, space: "macos_global_points", x: 5, y: 6 }),
      ev(2500, "pointer.click", { button: "left", clickCount: 2, space: "macos_global_points", x: 5, y: 6 }),
    ],
    dpx,
  );
  assert.equal(apart.length, 2);
  const otherButton = buildSteps(
    [
      ev(1000, "pointer.click", { button: "left", clickCount: 1, space: "macos_global_points", x: 5, y: 6 }),
      ev(1100, "pointer.click", { button: "right", clickCount: 2, space: "macos_global_points", x: 5, y: 6 }),
    ],
    dpx,
  );
  assert.equal(otherButton.length, 2);
});

const clickPayload = (over: Record<string, unknown>) => ({
  button: "left", clickCount: 1, space: "macos_global_points", x: 0, y: 0, ...over,
});

test("PKG-2: a click that switched apps is one step; the poll lag does not add a 'Switch to' step", () => {
  const send = {
    grounding: "accessibility", source: "ax", role: "button", nativeRole: "AXButton", name: "Send",
    isPassword: false, app: { name: "Google Chrome" },
  };
  const steps = buildSteps(
    [
      ev(16500, "app.activate", { app: "Microsoft Excel", title: "Budget", bounds: BOUNDS }),
      // The user clicked in Chrome at 17,000 (reported 17,250 after a 250 ms lookup). The 1 s active-window
      // poll saw Chrome at 17,100, between the mouse-down and the helper's report.
      ev(17100, "app.activate", { app: "Google Chrome", title: "Inbox", bounds: BOUNDS_B }),
      ev(17250, "pointer.click", clickPayload({ x: 700, y: 250, lookupMs: 250, target: send })),
    ],
    dpx,
  );
  assert.deepEqual(steps.map((s) => s.summary), ["Switch to Microsoft Excel", 'Click button "Send" in Google Chrome']);
  assert.equal(steps[1].tMs, 17000, "the click is timed when the user acted");
});

test("PKG-2: a double-click on a background window is one step, not click + switch + click", () => {
  const cell = {
    grounding: "accessibility", source: "ax", role: "cell", nativeRole: "AXCell", name: "B4",
    isPassword: false, app: { name: "Microsoft Excel" },
  };
  const steps = buildSteps(
    [
      ev(100, "app.activate", { app: "Google Chrome", title: "Inbox", bounds: BOUNDS_B }),
      // First click: no control found (timeout); then the poll reports Excel; then the second click.
      ev(17000, "pointer.click", clickPayload({ x: 40, y: 300, lookupMs: 300, unavailableReason: "timeout" })),
      ev(17100, "app.activate", { app: "Microsoft Excel", title: "Budget", bounds: { x: 0, y: 0, width: 450, height: 800 } }),
      ev(17250, "pointer.click", clickPayload({ x: 40, y: 300, clickCount: 2, lookupMs: 20, target: cell })),
    ],
    dpx,
  );
  assert.deepEqual(
    steps.map((s) => [s.kind, s.actionType, s.summary]),
    [
      ["context", "app_switch", "Switch to Google Chrome"],
      ["action", "double_click", 'Double-click cell "B4" in Microsoft Excel'],
    ],
  );
});

test("PKG-2: an app switch with no click near it is still a step", () => {
  const steps = buildSteps(
    [
      ev(100, "app.activate", { app: "Excel", title: "Book1", bounds: BOUNDS }),
      ev(9000, "app.activate", { app: "Finder", title: "Desktop", bounds: BOUNDS_B }),
      ev(30000, "pointer.click", clickPayload({ x: 700, y: 10 })),
    ],
    dpx,
  );
  assert.deepEqual(steps.map((s) => s.summary), ["Switch to Excel", "Switch to Finder", "Click at (1400, 20) in Finder"]);
});

test("PKG-3: a click with no control keeps the last app only inside its window; otherwise it claims no app", () => {
  const inside = buildSteps(
    [
      ev(100, "app.activate", { app: "Excel", title: "Book1", bounds: { x: 100, y: 100, width: 300, height: 300 } }),
      ev(5000, "pointer.click", clickPayload({ x: 150, y: 150, unavailableReason: "timeout" })),
      ev(6000, "pointer.click", clickPayload({ x: 900, y: 900, unavailableReason: "timeout" })),
    ],
    dpx,
  );
  assert.equal(inside[1].app.name, "Excel");
  assert.equal(inside[2].app.name, "", "outside the window: the app is not known");
  assert.equal(inside[2].app.kind, "unknown");
  assert.equal(inside[2].windowTitle, undefined);
  assert.equal(inside[2].summary, "Click at (1800, 1800)", "the summary names no app it does not know");
  // With no window bounds at all, nothing can be verified.
  const noBounds = buildSteps(
    [
      ev(100, "app.activate", { app: "Excel", title: "Book1" }),
      ev(5000, "pointer.click", clickPayload({ x: 150, y: 150, unavailableReason: "timeout" })),
    ],
    dpx,
  );
  assert.equal(noBounds[1].app.name, "");
});

test("PKG-10 / PKG-6: stateAt tells which app, title and URL were frontmost at a moment", () => {
  const { stateAt } = buildStepsWithState(
    [
      ev(100, "app.activate", { app: "Google Chrome", title: "Inbox", url: "https://mail.example/inbox?x=1", bounds: BOUNDS }),
      ev(5600, "app.title-change", { app: "Google Chrome", title: "Payroll" }),
      ev(5700, "browser.url", { url: "https://mail.example/payroll#x" }),
      ev(9000, "app.activate", { app: "Excel", title: "Book1", bounds: BOUNDS }),
    ],
    dpx,
  );
  assert.equal(stateAt(50), undefined, "nothing was known yet");
  assert.equal(stateAt(6000)?.windowTitle, "Payroll");
  assert.equal(stateAt(6000)?.url, "https://mail.example/payroll");
  assert.equal(stateAt(6000)?.app.name, "Google Chrome");
  assert.equal(stateAt(9500)?.app.name, "Excel");
});

test("app kind recognises browsers and remote sessions", () => {
  assert.equal(appKind("Google Chrome"), "browser");
  assert.equal(appKind("", "msedge.exe"), "browser");
  assert.equal(appKind("Windows App"), "remote_session");
  assert.equal(appKind("mstsc"), "remote_session");
  assert.equal(appKind("Citrix Workspace"), "remote_session");
  assert.equal(appKind("Excel"), "native");
  assert.equal(appKind(""), "unknown");
});
