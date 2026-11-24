# FW: unsigned Windows x64 installer built on a Mac

Base: `08ee4ce`. Host: macOS (Darwin 25.5, arm64), Node 24.19.0, npm from `node@24`. No product code, package.json or lockfile was changed.

**Result:** `/Users/OlivierPotgieter/Desktop/Handover-0.1.0-windows-x64-MAC-BUILT.exe`
- size 657,067,582 bytes
- sha256 `44b82c6a6213c91a127045a27016399ac3f208dd7138eaba7caf56bc96233ae6`
- unsigned (PE certificate table is empty). The NSIS stub is a 32-bit PE, as for every NSIS installer; it installs the x64 app.
- `node scripts/verify-windows-package.mjs x64` **passes**, with no check weakened.
- Never run on Windows. Nothing here proves it launches; only that the package structure and binaries are right.

## Commands

1. **Helper.** Throwaway `helper.csproj` outside the repo (scratchpad `fw/`): `net48`, `PlatformTarget x64`, `LangVersion 5`, `ApplicationManifest` = `native/windows/app.manifest`, `Microsoft.NETFramework.ReferenceAssemblies 1.0.3`, and `<Reference>` for `UIAutomationClient`, `UIAutomationTypes`, `WindowsBase`.
   - First attempt failed with CS0234/CS0246 (`System.Windows.Automation`, `Rect`) because those references were missing. Adding them fixed it.
   - `~/.dotnet/dotnet build helper.csproj -c Release` then copied to `native/build/HandoverHelper.exe` (git-ignored).
   - Checks: PE signature OK, machine `0x8664`, optional-header magic `0x20b` (PE32+), 25,088 bytes. The bytes contain `PerMonitorV2` and `asInvoker`, so the manifest is embedded.
   - Not run: `--selftest` needs Windows (CI runs it).
2. **Install.** `npm ci --ignore-scripts=false --dangerously-allow-all-scripts=false --strict-allow-scripts` (darwin-arm64 tree).
3. **Windows natives.** `npm ci` on Mac skips the win32 optional packages. I fetched the two missing ones with `npm pack` at the lockfile versions and extracted them into `node_modules/`:
   - `@img/sharp-win32-x64@0.35.3`
   - `@koromix/koffi-win32-x64@3.1.1`
   - The lockfile was not touched (`git status` clean). I did not compare the tarball hashes with the lockfile's `integrity`; I planned to and that step was denied in the session, so this is unproven.
   - `onnxruntime-node` ships `bin/napi-v6/win32/x64/*` in its own package. `node-pty` ships `prebuilds/win32-x64`. `get-windows` is excluded on Windows by `build.win.files`.
4. **Remove darwin natives** from `node_modules` (moved to the scratchpad, not deleted): `@img/sharp-darwin-arm64`, `@img/sharp-libvips-darwin-arm64`, `@koromix/koffi-darwin-arm64`. A CI Windows tree never has them, and `prepare-compliance` refuses a tree with the wrong sharp payload ("Unexpected Sharp native payload installed for win32-x64").
5. **Models.** `npm run models:fetch`: 7 files, all SHA-256 pins verified.
6. **Compliance.** `scripts/compliance.mjs` keys everything on `process.platform`/`process.arch`, and on darwin-arm64 it would produce a macOS bundle. I ran it under a preload that reports `win32`/`x64` (`node --import spoof-win.mjs scripts/prepare-compliance.mjs`; the preload is two `Object.defineProperty` lines, kept outside the repo). Result: "Prepared 281 package licenses and 49 source materials". Several raw.githubusercontent URLs for onnxruntime 404'd and the jsDelivr recovery URLs were used; the reviewed SHA-256 was still required and matched. The Electron win32-x64 zip was downloaded into `.compliance-cache/electron`.
7. **Build.** `npm run build` (tsc + vite) exit 0, then `CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --config.npmRebuild=false --publish never --win nsis --x64`.
   - `signAndEditExecutable=false` was **not** needed. electron-builder edited the exe resources itself (it downloaded its own rcedit/NSIS tooling) and logged "signing with signtool.exe" steps without a certificate; the output has no signature.
   - I ran electron-builder directly rather than `npm run dist:win:x64`, because that script runs `assert-native-windows-arch.mjs`, which refuses any non-Windows host by design. It is the only CI step skipped on purpose; the other steps it chains were run by hand above.
8. **Verify.** `node scripts/verify-windows-package.mjs x64` printed `Verified helper payload: .../resources/helper/HandoverHelper.exe (25088 bytes)` and `Verified native x64 package, compliance sources, notices, and no standalone FFmpeg: release/win-unpacked`.

## PE check of every `.node` and `.dll` under `app.asar.unpacked` (31 files)

- **15 are PE x64.** This includes `@koromix/koffi-win32-x64/win32_x64/koffi.node`, `@img/sharp-win32-x64/lib/sharp-win32-x64-0.35.3.node` plus both libvips DLLs, `onnxruntime-node/.../win32/x64/*` and `node-pty/prebuilds/win32-x64/*`.
- **11 are PE arm64** (`node-pty` win32-arm64 prebuilds and `third_party/conpty/.../win10-arm64`, `onnxruntime-node/.../win32/arm64/*`).
- **3 are Mach-O** (`node-pty/prebuilds/darwin-arm64|darwin-x64/pty.node`, `onnxruntime-node/.../darwin/arm64/...`) and **2 are ELF** (`onnxruntime-node/.../linux/x64|arm64/...`).
- The 16 non-x64 files are not an artefact of building on a Mac. They are the other-platform folders those npm packages ship inside themselves, and `asarUnpack` takes the whole package. A CI build on `windows-latest` packs the same files. The loaders pick the win32-x64 folder at runtime. The verify script does not forbid them. I left them in so the installer matches CI.

Also present: `resources/helper/HandoverHelper.exe`, `resources/models/Xenova/**`, `resources/compliance/**` (README, inventory, licenses, sources, electron notices, and so on).

## Differences from a CI build

- The helper was built with the .NET SDK and `net48` reference assemblies, not the in-box `csc.exe` (`scripts/build-helper-win.ps1`). Same source, x64, same manifest, but the compiler and its output are not byte-identical to CI's.
- The helper `--selftest` was not run.
- `npm test` and `lockfile` checks were not part of this lane's scope and were not run here.
- Windows natives were extracted from tarballs, not installed by `npm ci` on Windows. No postinstall scripts ran for them (`koffi` and the others ship prebuilt binaries; the `allowScripts` entries only matter for building from source).
- `assert-native-windows-arch.mjs` was bypassed (see 7). Compliance was prepared with a spoofed platform (see 6).
- Not signed. Windows SmartScreen will warn.
- The installer is a Mac-built artefact: do not treat it as a release build.

## Rebuild at b3bd188

Merged `origin/task/workflow-recording-assistant` (b3bd188; fast-forward) and repeated the procedure above unchanged: dotnet helper (25,088 bytes, rebuilt), win32-x64 tarballs extracted, darwin natives moved aside, `models:fetch`, compliance under the win32 shim, `npm run build`, `electron-builder --win nsis --x64`.

- `verify-windows-package.mjs x64` passes (helper payload 25,088 bytes; "Verified native x64 package ...").
- PE check: same 31 files, 15 PE x64, 11 PE arm64, 3 Mach-O, 2 ELF (the other-platform folders shipped inside npm packages, as before).
- `resources/helper`, `resources/models`, `resources/compliance` present.
- Installer copied over `~/Desktop/Handover-0.1.0-windows-x64-MAC-BUILT.exe`.
  - size 657,068,521 bytes
  - sha256 `b7abdf9d0c947c125a4f004823a40692ccb3857c9f0bc0905ccf2b2ef488c2f4`
- Darwin natives restored in `node_modules` afterwards.

**Tarball integrity (closes the open item above).** `package-lock.json` records **sha1** integrity for these two entries, not sha512, so I compared sha1 (read-only on the lockfile):
- `@img/sharp-win32-x64@0.35.3`: `iiXKzcdajCYHfAf7pR6AVqrkdPE=` matches the lockfile.
- `@koromix/koffi-win32-x64@3.1.1`: `WERVlSEG4mSqtpoHIFEdzoGK6cs=` matches the lockfile.
- A sha512 comparison cannot be made from the lockfile. The registry's sha512 for koffi (`KqHPmvj6...`) equals my downloaded file's sha512, so the download is the registry's file.

## Builds at 7bf0ff4

Merged `origin/task/workflow-recording-assistant` (7bf0ff4; fast-forward). `package.json` and `package-lock.json` unchanged since the previous round.

**Windows x64** (same procedure as before: dotnet helper, win32-x64 prebuilds already extracted, darwin natives moved aside, models, compliance under the win32 shim, `npm run build`, `electron-builder --win nsis --x64`):
- `verify-windows-package.mjs x64` passes; PE check unchanged (31 files: 15 PE x64, 11 arm64, 3 Mach-O, 2 ELF).
- `~/Desktop/Handover-0.1.0-windows-x64-7bf0ff4.exe`, 657,069,291 bytes, sha256 `d499a0585e08762b1b8b2e197a800277608b422691195dac8921a9332f8f5dff`. Unsigned, never run on Windows. The earlier `...-MAC-BUILT.exe` was not touched.

**macOS arm64** (native build on this Mac, darwin natives restored, win32 packages moved out of `node_modules`):
- `npm run build:helper:mac` OK; `native/build/HandoverHelper --selftest` printed hello, capabilities and selftest lines (accessibility not trusted for this shell, so `reason: permission_missing`, as expected).
- `CSC_IDENTITY_AUTO_DISCOVERY=false npm run dist:mac` OK (models:fetch, compliance:prepare, helper, vite, electron-builder; ad-hoc signed, not notarized).
- macOS CI checks: `unzip -l` lists `Handover.app/Contents/Resources/helper/HandoverHelper` (Mach-O arm64); `fetch-models.mjs --verify --out=release/mac-arm64/Handover.app/Contents/Resources/models` verified 7 files; `codesign -v` on the app printed nothing (valid ad-hoc signature).
- Not run: `npm test` or the CI window-provider/license coverage steps in non-windows.yml.
- `~/Desktop/Handover-0.1.0-macos-arm64-7bf0ff4.zip`, 668,921,977 bytes, sha256 `f3aefa4d96ac3543689e16b471f9f23f5d5696ea0715ba2130c31c78a49a428e`.

`node_modules` now holds the darwin natives and the win32 packages are moved out again (back in `node_modules` after this step).
