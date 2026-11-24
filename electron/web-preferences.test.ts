// SEC-3 and SEC-10: every window disables the spellchecker; the freeze overlay is marked and sandboxed.

import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { windowPreferences } from "./web-preferences";

const here = path.dirname(fileURLToPath(import.meta.url));

test("windowPreferences always sets spellcheck:false, context isolation and no node integration", () => {
  for (const kind of [undefined, "freeze" as const]) {
    const p = windowPreferences({ preload: "/p.cjs", kind });
    assert.equal(p.spellcheck, false);
    assert.equal(p.contextIsolation, true);
    assert.equal(p.nodeIntegration, false);
  }
});

test("only the freeze overlay is sandboxed and marked for the freeze-only preload", () => {
  const freeze = windowPreferences({ preload: "/p.cjs", kind: "freeze" });
  assert.equal(freeze.sandbox, true);
  assert.deepEqual(freeze.additionalArguments, ["--handover-window=freeze"]);
  const other = windowPreferences({ preload: "/p.cjs" });
  assert.equal(other.sandbox, false);
  assert.equal(other.additionalArguments, undefined);
});

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return full.endsWith(".ts") && !full.endsWith(".test.ts") ? [full] : [];
  });
}

test("SEC-3: every BrowserWindow in the app uses windowPreferences or sets spellcheck:false", () => {
  const offenders: string[] = [];
  let windows = 0;
  for (const file of sourceFiles(here)) {
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(/new BrowserWindow\(\{/g)) {
      windows++;
      // The options object of this call: up to the next top-level "new BrowserWindow" or end of file.
      const rest = text.slice(match.index);
      const next = rest.indexOf("new BrowserWindow", 10);
      const block = next === -1 ? rest : rest.slice(0, next);
      const webPrefs = block.slice(block.indexOf("webPreferences"));
      if (!/windowPreferences\(/.test(webPrefs) && !/spellcheck:\s*false/.test(webPrefs)) {
        offenders.push(path.relative(here, file));
      }
    }
  }
  assert.ok(windows >= 7, `found the app's windows (${windows})`);
  assert.deepEqual(offenders, []);
});

test("SEC-3: the default session's spellchecker is switched off at startup", () => {
  const main = readFileSync(path.join(here, "main.ts"), "utf8");
  assert.match(main, /setSpellCheckerEnabled\(false\)/);
});
