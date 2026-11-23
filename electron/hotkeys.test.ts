// L4: a hotkey that cannot be registered is logged and never crashes the app.

import assert from "node:assert/strict";
import test from "node:test";

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
