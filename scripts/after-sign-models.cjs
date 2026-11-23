// macOS only: copy the bundled narration model into the app AFTER electron-builder
// has signed it, then re-seal the bundle ad hoc.
//
// Why not extraResources: during signing, @electron/osx-sign runs `isbinaryfile` on every
// file, and that library throws "RangeError: Invalid array length" on the ONNX weights
// (they are protobuf). Ignoring the path does not help because the walk happens first.
// Windows has no such step, so it takes the models through `win.extraResources`.
const { execFileSync } = require("node:child_process");
const { cpSync, existsSync } = require("node:fs");
const path = require("node:path");

exports.default = async function afterSign(context) {
  if (context.electronPlatformName !== "darwin") return;
  const source = path.join(context.packager.projectDir, "extraResources", "models");
  if (!existsSync(source)) {
    throw new Error("extraResources/models is missing; run `npm run models:fetch` first.");
  }
  const appName = `${context.packager.appInfo.productFilename}.app`;
  const appPath = path.join(context.appOutDir, appName);
  cpSync(source, path.join(appPath, "Contents", "Resources", "models"), { recursive: true });
  // The copy changed the sealed resources, so seal the bundle again (ad hoc, unsigned test build).
  execFileSync("codesign", ["--force", "--deep", "--sign", "-", appPath], { stdio: "inherit" });
};
