// SEC-8: the diagnostics zip is sent to other people, and an absolute path names the OS user. Replace the
// home directory (and a bare `Users\<name>` / `home/<name>` segment) with `~` before text leaves the machine.

import os from "node:os";

export interface HomeIdentity {
  home: string;
  username: string;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Both slash spellings of a path, so `C:\Users\a` also matches `C:/Users/a` and a JSON-escaped `C:\\Users\\a`. */
function pathPattern(p: string): string {
  return p
    .split(/[\\/]+/)
    .filter((part) => part !== "")
    .map(escapeRegExp)
    .join("(?:\\\\\\\\|[\\\\/])+");
}

export function redactHome(text: string, who: HomeIdentity = currentIdentity()): string {
  let out = text;
  if (who.home && who.home.length > 3) {
    const lead = /^[\\/]/.test(who.home) ? "(?:\\\\\\\\|[\\\\/])+" : "";
    out = out.replace(new RegExp(`${lead}${pathPattern(who.home)}`, "gi"), "~");
  }
  if (who.username && who.username.length >= 2) {
    const user = escapeRegExp(who.username);
    out = out.replace(new RegExp(`((?:Users|home)(?:\\\\\\\\|[\\\\/]))${user}(?=$|[\\\\/\\s"'])`, "gi"), "$1~");
  }
  return out;
}

function currentIdentity(): HomeIdentity {
  let username = "";
  try {
    username = os.userInfo().username;
  } catch {
    // no passwd entry: the home directory still covers the common case
  }
  return { home: os.homedir(), username };
}
