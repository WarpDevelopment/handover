// Registers the resolution hooks (hooks.mjs) for the unit tests. Pass to Node
// with `--import ./test/harness/register.mjs` so the hooks are active before the
// test files (and all the app TypeScript they import) are loaded.
import { register } from "node:module";
register("./hooks.mjs", import.meta.url);
