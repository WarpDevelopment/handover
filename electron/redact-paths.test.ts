// SEC-8: usernames never reach the diagnostics zip.

import assert from "node:assert/strict";
import test from "node:test";

import { redactHome } from "./redact-paths";

const win = { home: "C:\\Users\\jane.doe", username: "jane.doe" };
const mac = { home: "/Users/janedoe", username: "janedoe" };

test("a Windows home directory becomes ~, in every slash spelling", () => {
  assert.equal(redactHome("C:\\Users\\jane.doe\\AppData\\Local\\Handover\\sessions", win), "~\\AppData\\Local\\Handover\\sessions");
  assert.equal(redactHome("c:/users/jane.doe/AppData/x", win), "~/AppData/x");
  assert.equal(redactHome('{"p":"C:\\\\Users\\\\jane.doe\\\\x"}', win), '{"p":"~\\\\x"}');
});

test("a macOS home directory becomes ~", () => {
  assert.equal(redactHome("/Users/janedoe/Library/Application Support/Handover/sessions", mac), "~/Library/Application Support/Handover/sessions");
});

test("the user's name inside another Users path is replaced too (a short path, a UNC or roaming path)", () => {
  assert.equal(redactHome("\\\\server\\Users\\jane.doe\\Roaming", win), "\\\\server\\Users\\~\\Roaming");
});

test("text without a username is untouched, and a short username is not blindly replaced", () => {
  assert.equal(redactHome("session 20261124-0800-ab12 started", win), "session 20261124-0800-ab12 started");
  assert.equal(redactHome("a b c", { home: "/", username: "a" }), "a b c");
});
