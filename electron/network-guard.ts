/**
 * Test-only network kill switch, enabled with `HANDOVER_DENY_NETWORK=1`.
 *
 * It exists so a tester (or CI) can prove the app works with no network at all:
 * a `session.webRequest` block for the renderer side and a Node `net.Socket`
 * guard for the main process. It is NOT a product feature and is never exposed in
 * the UI. Loopback, IPC pipes and local schemes stay allowed so the dev renderer
 * and local helpers keep working.
 */
import net from "node:net";

export const DENY_NETWORK_ENV = "HANDOVER_DENY_NETWORK";

export type DenyLog = (message: string) => void;

export function isDenyNetworkEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[DENY_NETWORK_ENV] === "1";
}

const LOCAL_SCHEMES = new Set(["file:", "devtools:", "data:", "blob:", "about:", "chrome-extension:"]);

/** True for hosts that never leave this machine. */
export function isLoopbackHost(host: string | undefined): boolean {
  if (!host) return true; // no host means localhost for net.connect
  const h = host.replace(/^\[|\]$/g, "").toLowerCase();
  return h === "localhost" || h === "::1" || h === "::ffff:127.0.0.1" || /^127(\.\d{1,3}){3}$/.test(h);
}

/** Should the renderer-side request to `url` be blocked? */
export function shouldBlockUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return true; // unparseable: never let it through
  }
  if (LOCAL_SCHEMES.has(parsed.protocol)) return false;
  if (["http:", "https:", "ws:", "wss:"].includes(parsed.protocol)) {
    return !isLoopbackHost(parsed.hostname);
  }
  return true;
}

/** Minimal structural type for `session.webRequest`, so this stays testable without Electron. */
export interface WebRequestLike {
  onBeforeRequest(
    listener: (details: { url: string }, callback: (response: { cancel: boolean }) => void) => void,
  ): void;
}

/** Block every non-local renderer request, logging each blocked attempt (URL origin only). */
export function installWebRequestDeny(webRequest: WebRequestLike, log: DenyLog): void {
  webRequest.onBeforeRequest((details, callback) => {
    const block = shouldBlockUrl(details.url);
    if (block) log(`blocked renderer request to ${safeOrigin(details.url)}`);
    callback({ cancel: block });
  });
}

function safeOrigin(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}`;
  } catch {
    return "<unparseable>";
  }
}

function connectTarget(args: unknown[]): { local: boolean; label: string } {
  // net.connect() hands Socket#connect an already-normalized `[options, cb]` array.
  const first = Array.isArray(args[0]) ? (args[0] as unknown[])[0] : args[0];
  if (Array.isArray(args[0])) args = args[0] as unknown[];
  if (first !== null && typeof first === "object") {
    const opts = first as { path?: string; host?: string; port?: number };
    if (typeof opts.path === "string") return { local: true, label: "ipc" };
    return { local: isLoopbackHost(opts.host), label: `${opts.host ?? "localhost"}:${opts.port ?? ""}` };
  }
  if (typeof first === "string" && Number.isNaN(Number(first))) return { local: true, label: "ipc" };
  const host = typeof args[1] === "string" ? args[1] : undefined;
  return { local: isLoopbackHost(host), label: `${host ?? "localhost"}:${String(first)}` };
}

/**
 * Patch `net.Socket.prototype.connect` so any non-loopback TCP connect fails with
 * ECONNREFUSED-style errors (this covers fetch/undici, http, https and tls, which all
 * go through it). Returns a function that restores the original.
 */
export function installNodeNetGuard(log: DenyLog, netModule: typeof net = net): () => void {
  const proto = netModule.Socket.prototype;
  const original = proto.connect;
  proto.connect = function guardedConnect(this: net.Socket, ...args: unknown[]) {
    const target = connectTarget(args);
    if (target.local) return (original as (...a: unknown[]) => net.Socket).apply(this, args);
    log(`blocked outbound connection to ${target.label}`);
    const err = Object.assign(new Error(`Network is disabled (${DENY_NETWORK_ENV}=1)`), {
      code: "ECONNREFUSED",
    });
    process.nextTick(() => this.destroy(err));
    return this;
  } as typeof proto.connect;
  return () => {
    proto.connect = original;
  };
}
