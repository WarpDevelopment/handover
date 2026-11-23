import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";

import {
  installNodeNetGuard,
  installWebRequestDeny,
  isDenyNetworkEnabled,
  shouldBlockUrl,
} from "./network-guard";

test("the deny switch is on only for HANDOVER_DENY_NETWORK=1", () => {
  assert.equal(isDenyNetworkEnabled({ HANDOVER_DENY_NETWORK: "1" }), true);
  assert.equal(isDenyNetworkEnabled({ HANDOVER_DENY_NETWORK: "0" }), false);
  assert.equal(isDenyNetworkEnabled({}), false);
});

test("renderer requests: local schemes and loopback pass, everything else is blocked", () => {
  for (const url of [
    "file:///app/index.html",
    "devtools://devtools/bundled/x.js",
    "data:text/plain,hi",
    "blob:file:///abc",
    "http://localhost:5173/",
    "http://127.0.0.1:5173/@vite/client",
    "ws://localhost:5173/",
  ]) {
    assert.equal(shouldBlockUrl(url), false, url);
  }
  for (const url of [
    "https://huggingface.co/Xenova/whisper-small/resolve/main/x",
    "http://example.com/",
    "wss://example.com/socket",
    "ftp://example.com/",
    "not a url",
  ]) {
    assert.equal(shouldBlockUrl(url), true, url);
  }
});

test("installWebRequestDeny cancels remote requests and logs only the origin", () => {
  let listener: Parameters<Parameters<typeof installWebRequestDeny>[0]["onBeforeRequest"]>[0] | undefined;
  const logs: string[] = [];
  installWebRequestDeny({ onBeforeRequest: (l) => (listener = l) }, (m) => logs.push(m));
  const results: boolean[] = [];
  listener!({ url: "https://example.com/secret/path?token=abc" }, (r) => results.push(r.cancel));
  listener!({ url: "file:///app/index.html" }, (r) => results.push(r.cancel));
  assert.deepEqual(results, [true, false]);
  assert.equal(logs.length, 1);
  assert.ok(!logs[0]!.includes("secret") && !logs[0]!.includes("token"));
});

test("the Node net guard refuses a remote fetch but still serves loopback", async () => {
  const server = http.createServer((_req, res) => res.end("ok"));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  const logs: string[] = [];
  const restore = installNodeNetGuard((m) => logs.push(m));
  try {
    const local = await fetch(`http://127.0.0.1:${port}/`);
    assert.equal(await local.text(), "ok");

    await assert.rejects(fetch("http://192.0.2.1:81/"), /fetch failed/);
    assert.ok(logs.some((l) => l.includes("192.0.2.1")), `expected a blocked-connection log, got ${logs}`);
  } finally {
    restore();
    await new Promise((resolve) => server.close(resolve));
  }
});
