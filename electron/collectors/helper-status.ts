import { existsSync } from "node:fs";
import path from "node:path";

import type { HelperDoctorInfo, HelperState } from "../../common/ipc";

export interface HelperLaunch {
  file: string;
  args: string[];
}

function helperFileName(platform: NodeJS.Platform): string | null {
  if (platform === "win32") return "HandoverHelper.exe";
  if (platform === "darwin") return "HandoverHelper";
  return null;
}

/**
 * Where the helper lives: `<resources>/helper/` when packaged (electron-builder extraResources),
 * `native/build/` in a dev checkout. Returns null when the binary is not there.
 */
export function defaultHelperLaunch(
  platform: NodeJS.Platform = process.platform,
  resourcesPath: string | undefined = (process as { resourcesPath?: string }).resourcesPath,
  cwd: string = process.cwd(),
): HelperLaunch | null {
  const name = helperFileName(platform);
  if (!name) return null;
  const candidates = [
    ...(resourcesPath ? [path.join(resourcesPath, "helper", name)] : []),
    path.join(cwd, "native", "build", name),
  ];
  const file = candidates.find((candidate) => existsSync(candidate));
  return file ? { file, args: [] } : null;
}

const MAX_SAMPLES = 500;

/** Rolling lookup timings and counts, shared by the collector (writer) and the doctor (reader). */
export class HelperTracker {
  private state: HelperState | null = null;
  private version: string | null = null;
  private lastError: string | null = null;
  private samples: number[] = [];
  private counts = { accessibility: 0, accessibility_weak: 0, none: 0 };

  constructor(private readonly resolve: () => HelperLaunch | null = defaultHelperLaunch) {}

  setState(state: HelperState, error?: string): void {
    this.state = state;
    if (error !== undefined) this.lastError = error;
  }

  setVersion(version: string): void {
    this.version = version;
  }

  recordClick(grounding: "accessibility" | "accessibility_weak" | "none", lookupMs?: number): void {
    this.counts[grounding] += 1;
    if (lookupMs !== undefined) {
      this.samples.push(lookupMs);
      if (this.samples.length > MAX_SAMPLES) this.samples.shift();
    }
  }

  reset(): void {
    this.state = null;
    this.samples = [];
    this.counts = { accessibility: 0, accessibility_weak: 0, none: 0 };
  }

  private percentile(p: number): number | null {
    if (this.samples.length === 0) return null;
    const sorted = [...this.samples].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] ?? null;
  }

  report(): HelperDoctorInfo {
    // Before any recording has started, the best answer is whether the binary is shipped.
    const state: HelperState = this.state ?? (this.resolve() ? "ok" : "missing");
    return {
      helper: state,
      version: this.version,
      lastError: this.lastError ?? (state === "missing" ? "Helper binary not found" : null),
      lookupP50Ms: this.percentile(50),
      lookupP95Ms: this.percentile(95),
      counts: { ...this.counts },
    };
  }
}

/** The app-wide tracker the doctor reads. */
export const helperTracker = new HelperTracker();
