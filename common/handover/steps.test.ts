import assert from "node:assert/strict";
import test from "node:test";

import type { RecEvent } from "../types";
import { appKind, buildSteps, groundingOf, reduceUrl, summaryFor } from "./steps";

let seq = 0;
function ev(t: number, type: string, payload: Record<string, unknown>): RecEvent {
  return { seq: seq++, t, epoch: 1_000_000 + t, type, source: "test", payload };
}
const dpx = (c: { x: number; y: number }): [number, number] => [c.x * 2, c.y * 2];

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
      ev(100, "app.activate", { app: "Excel", title: "Book1" }),
      ev(1000, "pointer.click", { button: "left", clickCount: 1, space: "macos_global_points", x: 5, y: 6 }),
      ev(2000, "app.activate", { app: "Google Chrome", title: "Inbox", url: "https://a.example/x?q=1#f" }),
      ev(3000, "pointer.click", { button: "right", clickCount: 1, space: "macos_global_points", x: 7, y: 8 }),
      ev(4000, "pointer.click", { button: "left", clickCount: 2, space: "macos_global_points", x: 7, y: 8 }),
    ],
    dpx,
  );
  assert.deepEqual(
    steps.map((s) => [s.kind, s.actionType, s.summary]),
    [
      ["context", "app_switch", "Switch to Excel"],
      ["action", "click", "Click at (10, 12) in Excel"],
      ["context", "app_switch", "Switch to Google Chrome"],
      ["action", "right_click", "Right-click at (14, 16) in Google Chrome"],
      ["action", "double_click", "Double-click at (14, 16) in Google Chrome"],
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

test("app kind recognises browsers and remote sessions", () => {
  assert.equal(appKind("Google Chrome"), "browser");
  assert.equal(appKind("", "msedge.exe"), "browser");
  assert.equal(appKind("Windows App"), "remote_session");
  assert.equal(appKind("mstsc"), "remote_session");
  assert.equal(appKind("Citrix Workspace"), "remote_session");
  assert.equal(appKind("Excel"), "native");
  assert.equal(appKind(""), "unknown");
});
