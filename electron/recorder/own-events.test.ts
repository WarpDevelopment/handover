// APP-3 and PKG-11: Handover's own app events are dropped at the bus; clicks pass through it.

import assert from "node:assert/strict";
import test from "node:test";

import { EventBus } from "./event-bus";
import { isOwnAppEvent } from "./own-events";

test("app.activate, title-change and browser.url for Handover or this pid are own events", () => {
  assert.equal(isOwnAppEvent({ type: "app.activate", source: "x", payload: { app: "Handover", title: "" } }), true);
  assert.equal(isOwnAppEvent({ type: "app.activate", source: "x", payload: { app: "Electron", title: "" } }), true);
  assert.equal(isOwnAppEvent({ type: "app.activate", source: "x", payload: { app: "Handover.exe", title: "" } }), true);
  assert.equal(isOwnAppEvent({ type: "app.activate", source: "x", payload: { app: "Whatever", title: "", pid: 4242 } }, 4242), true);
  assert.equal(isOwnAppEvent({ type: "app.title-change", source: "x", payload: { app: "Handover", title: "Explain" } }), true);
  assert.equal(isOwnAppEvent({ type: "browser.url", source: "x", payload: { app: "Handover", url: "file:///x" } }), true);
});

test("other apps, other pids and other event types are not own events", () => {
  assert.equal(isOwnAppEvent({ type: "app.activate", source: "x", payload: { app: "Outlook", title: "", pid: 1 } }, 4242), false);
  assert.equal(isOwnAppEvent({ type: "marker", source: "x", payload: { app: "Handover" } as never }), false);
  assert.equal(isOwnAppEvent({ type: "pointer.click", source: "x", payload: {} as never }), false);
});

function fakeStore() {
  const appended: string[] = [];
  return {
    appended,
    store: {
      append: (type: string, _source: string, payload: Record<string, unknown>) => {
        appended.push(type);
        return { seq: appended.length, t: 0, epoch: 0, type, source: "x", payload };
      },
    } as never,
  };
}

test("while blocked (paused or frozen) the bus records pointer.click but drops app events", () => {
  const bus = new EventBus();
  const { store, appended } = fakeStore();
  bus.attach(store);
  bus.setBlocked(true);
  bus.publish({ type: "pointer.click", source: "x", payload: { button: "left", clickCount: 1, space: "macos_global_points", x: 1, y: 1 } as never });
  bus.publish({ type: "app.activate", source: "x", payload: { app: "Mail", title: "" } });
  assert.deepEqual(appended, ["pointer.click"]);
});
