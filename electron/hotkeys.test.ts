// L4: a hotkey that cannot be registered is logged and never crashes the app.

import assert from "node:assert/strict";
import test from "node:test";

import { ExplainHotkey } from "./explain-hotkey";
import { registerHotkey } from "./hotkeys";

test("a registered hotkey reports true and wires the handler", () => {
  const registered: Record<string, () => void> = {};
  const warnings: unknown[][] = [];
  const ok = registerHotkey(
    { register: (a, cb) => ((registered[a] = cb), true) },
    "CommandOrControl+Shift+E",
    () => undefined,
    { warn: (...a) => warnings.push(a) },
  );
  assert.equal(ok, true);
  assert.ok(registered["CommandOrControl+Shift+E"]);
  assert.deepEqual(warnings, []);
});

test("a hotkey another app owns is logged, not thrown", () => {
  const warnings: unknown[][] = [];
  const ok = registerHotkey({ register: () => false }, "CommandOrControl+Shift+E", () => undefined, {
    warn: (...a) => warnings.push(a),
  });
  assert.equal(ok, false);
  assert.equal(warnings.length, 1);
  assert.match(String(warnings[0][0]), /CommandOrControl\+Shift\+E could not be registered; use the button/);
});

test("a registry that throws is logged, not thrown", () => {
  const warnings: unknown[][] = [];
  const ok = registerHotkey(
    {
      register: () => {
        throw new Error("RegisterHotKey failed");
      },
    },
    "CommandOrControl+Shift+E",
    () => undefined,
    { warn: (...a) => warnings.push(a) },
  );
  assert.equal(ok, false);
  assert.equal(warnings.length, 1);
  assert.match(String(warnings[0][0]), /failed to register/);
  assert.equal((warnings[0][1] as Error).message, "RegisterHotKey failed");
});

test("APP-8: Ctrl+Shift+E is registered only while recording", () => {
  const held = new Set<string>();
  const shortcuts = {
    register: (a: string) => { held.add(a); return true; },
    unregister: (a: string) => { held.delete(a); },
  };
  const key = new ExplainHotkey(shortcuts, "CommandOrControl+Shift+E", () => {}, { warn: () => {} });
  assert.equal(held.size, 0, "not held while idle");
  assert.equal(key.current(), null);
  key.sync(false);
  assert.equal(held.size, 0);
  key.sync(true);
  key.sync(true); // every status change calls it: no double registration
  assert.deepEqual([...held], ["CommandOrControl+Shift+E"]);
  assert.equal(key.current(), "CommandOrControl+Shift+E");
  key.sync(false);
  assert.equal(held.size, 0, "released when the recording stops");
  assert.equal(key.current(), null);
});

test("APP-8: a hotkey another app owns is reported as unavailable and retried on the next recording", () => {
  let accept = false;
  const shortcuts = { register: () => accept, unregister: () => {} };
  const key = new ExplainHotkey(shortcuts, "X", () => {}, { warn: () => {} });
  key.sync(true);
  assert.equal(key.current(), null);
  accept = true;
  key.sync(false);
  key.sync(true);
  assert.equal(key.current(), "X");
});
