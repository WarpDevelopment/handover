// Manual proof that narration works with the network denied: loads the BUNDLED Whisper
// model (extraResources/models) through the real getAsrPipeline() with the Node net
// guard installed, then transcribes a WAV of speech and writes a diagnostics zip.
//
//   say -o /tmp/s.aiff "..." && afconvert -f WAVE -d LEI16@16000 -c 1 /tmp/s.aiff /tmp/s.wav
//   node --experimental-transform-types --no-warnings --import ./test/harness/register.mjs \
//     scripts/offline-narration-check.ts /tmp/s.wav /tmp/diag.zip
//
// Not part of `npm test` (needs the 252 MB model and a speech fixture).
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { writeDiagnosticsZip } from "../electron/diagnostics";
import { installNodeNetGuard } from "../electron/network-guard";
import { getAsrPipeline, isNarrationModelCached, narrationModelCacheDir } from "../electron/narration/whisper";

const [wavPath, zipPath] = process.argv.slice(2);
if (!wavPath || !zipPath) throw new Error("usage: offline-narration-check.ts <16k mono wav> <diagnostics.zip>");

const blocked: string[] = [];
installNodeNetGuard((m) => {
  blocked.push(m);
  console.log(`[net-guard] ${m}`);
});

// Prove the guard is live: a remote fetch must fail.
await fetch("https://huggingface.co/").then(
  () => {
    throw new Error("network guard is not active: remote fetch succeeded");
  },
  (err: Error) => console.log(`remote fetch refused as expected: ${err.message}`),
);

console.log(`model dir: ${narrationModelCacheDir()}  cached: ${isNarrationModelCached()}`);
if (!isNarrationModelCached()) throw new Error("bundled model not found");

// 16 kHz mono 16-bit PCM WAV -> Float32.
const wav = readFileSync(wavPath);
const dataAt = wav.indexOf("data") + 8;
const samples = new Float32Array((wav.length - dataAt) / 2);
for (let i = 0; i < samples.length; i++) samples[i] = wav.readInt16LE(dataAt + i * 2) / 32768;
console.log(`audio: ${(samples.length / 16000).toFixed(1)} s`);

const started = Date.now();
const pipe = await getAsrPipeline();
const result = await pipe(samples, { return_timestamps: true, chunk_length_s: 30, language: "en", task: "transcribe" });
console.log(`transcribed in ${((Date.now() - started) / 1000).toFixed(1)} s`);
console.log(`TRANSCRIPT: ${result.text.trim()}`);
if (result.text.trim().length === 0) throw new Error("transcript is empty");

const work = mkdtempSync(path.join(tmpdir(), "handover-offline-"));
await writeDiagnosticsZip(zipPath, {
  info: { generatedAt: new Date().toISOString(), networkDenied: true, blockedAttempts: blocked.length },
  logDir: path.join(work, "logs"),
  sessionsDir: path.join(work, "sessions"),
});
console.log(`diagnostics written: ${zipPath}; blocked network attempts during the run: ${blocked.length}`);
