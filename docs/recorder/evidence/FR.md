# Lane FR (release-fixes) evidence

BASE_SHA bcec7c966b9dcaec4f26604bdcac4b1b305cfb4b. Branch `lane/FR-release-fixes`.

Checks (local, Node 24.19.0): `npm test` 321 pass / 0 fail; `npm run build` exit 0;
`node --test scripts/compliance.test.mjs` 40 pass; `node scripts/prepare-compliance.mjs --licenses-only`
builds `.compliance/` containing `NOTICE` and `narration-model/{Apache-2.0.txt,Whisper-MIT.txt,model-card-README.md}`
and `verifyComplianceDirectory` passes. CI is unavailable (billing), so nothing was run on GitHub.

| Finding | Commit | Proving test | Notes |
|---|---|---|---|
| REL-1 | d626cb3 | `compliance.test.mjs` "licenses-only bundles cannot pass release verification" (fails when a narration-model file is missing) and "release config ships NOTICE and the Whisper licences..." | See licence sources below. `verify-windows-package.mjs` requires them through `verifyComplianceDirectory`. Tesseract text re-read: tessdata is still downloaded, not bundled, so it stays; the heading was changed to "Optional downloaded data". |
| REL-2 | c8f122e | "release config ships NOTICE..." asserts the macro | Found in electron-builder/app-builder-lib 26.15.6: `node_modules/app-builder-lib/templates/nsis/multiUserUi.nsh:6` `Var isForceCurrentInstall`, `:40` sets it to "0", `:41-42` `!ifmacrodef customInstallmode` then `!insertmacro customInstallMode`, `:59` `${if} $isForceCurrentInstall == "1"` takes the per-user path. **Not run:** there is no Windows here, so the installer was never executed; the Tuesday run is the first proof. |
| REL-3 | d626cb3, eb9c7ee | verifier test (NOTICE required) and config test (`files` arrays) | NOTICE added to both `files` arrays, copied into the bundle, and `verify-windows-package.mjs` requires `NOTICE` in app.asar. |
| REL-4 | d626cb3 | `.compliance/THIRD-PARTY-LICENSES.txt` regenerated, 0 matches for "Skill Recorder" | No unit test for the header text. |
| REL-5 | eb9c7ee | config test asserts `build:helper:*` in `dist`, `dist:win:x64`, `dist:mac` | Prefixed (`dist` is macOS-only after its platform assert). |
| REL-6 | f8886c8 | config test: App.css has no "scout" | Comment text only. |
| REL-7 | f8886c8 | config test: file absent | `.github/copilot-instructions.md` deleted. The copilot keys in `third_party/compliance-policy.json` are **left alone** (editing it would change the CI cache key). |
| REL-8 | f8c470e | docs only, no code test | windows-test-script.md: Smart App Control section (owner decides; tester stops if On/Evaluation), per-user wording, "Done reviewing (label may differ slightly)" before Export. Also a row in tester-results-form.md. |

## Licence sources (pinned, fetched with curl, read before commit)

| File in `third_party/narration-model/` | Source URL | sha256 |
|---|---|---|
| `Apache-2.0.txt` | https://www.apache.org/licenses/LICENSE-2.0.txt | cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30 |
| `model-card-README.md` | https://huggingface.co/Xenova/whisper-small/raw/2d67713f236afa48a18992566e7647f6ca848e13/README.md (revision from `scripts/narration-models.json`) | 12ae844fce48ede74fa80a1e24a7a34a3d9975bd4ba4f2a234762cf9a1f7a057 |
| `Whisper-MIT.txt` | https://raw.githubusercontent.com/openai/whisper/86098128c0b4f24f0e2aa2994de830614b474227/LICENSE | b5d65a59060e68c4ff940e1eddfa6f94b2d68fdf58ed7f4dd57721c997e35e9d |

The copyright line ("Copyright (c) 2022 OpenAI") comes from the fetched file. The commit 86098128… was the head of `main` at fetch time (2026-11-24).

## Not proven / not done
- The NSIS installer and the packaged Windows build were not run (no Windows host, no CI).
- The new licence files are not hash-pinned in `compliance-policy.json` (the lane may not edit it); they are protected by the committed files and a content assertion for the Whisper copyright line only.
