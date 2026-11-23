// The review screen's backend: builds a session in memory with its stored edits, hands the steps and
// images to the renderer, and appends new edits to `edits.jsonl` (append-only: recorded data is never
// changed, and every edit is kept). No Electron imports, so it is unit-tested with a real session folder.

import { randomBytes } from "node:crypto";
import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

import { buildPackageDetailed } from "../common/handover/build-package";
import { assertEdit } from "../common/handover/edits";
import { EDITS_FILE, readSessionInput } from "../common/handover/read-session";
import { reviewDataFrom, type ReviewData, type ReviewEditInput } from "../common/handover/review";
import type { BuildContext, Edit, PackageBytes } from "../common/handover/types";
import { currentEnvironment } from "./export";

export interface ReviewServiceOptions {
  toolVersion: string;
  /** Injected for tests. */
  now?: () => Date;
  random?: () => Uint8Array;
}

interface Built {
  files: PackageBytes;
  data: ReviewData;
}

export class ReviewService {
  private readonly cache = new Map<string, Built>();
  private chain: Promise<unknown> = Promise.resolve();

  constructor(private readonly opts: ReviewServiceOptions) {}

  private serial<T>(job: () => Promise<T>): Promise<T> {
    const next = this.chain.then(job, job);
    this.chain = next.catch(() => undefined);
    return next;
  }

  private async build(sessionDir: string, sessionId: string, extra: Edit[]): Promise<Built> {
    const { session, edits } = await readSessionInput(sessionDir, {
      environment: currentEnvironment(),
      helper: { present: false },
      captureBackend: "electron-desktop-capturer",
    });
    const all = [...edits, ...extra];
    const now = (this.opts.now ?? (() => new Date()))();
    const ctx: BuildContext = {
      package_id: "pkg_review",
      exported_at: now.toISOString(),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      tool_version: this.opts.toolVersion,
    };
    const built = await buildPackageDetailed(session, all, ctx);
    return {
      files: built.files,
      data: reviewDataFrom({
        files: built.files,
        stepIds: built.stepIds,
        sessionId,
        title: session.process.title,
        editCount: all.length,
      }),
    };
  }

  /** Build the session with its stored edits and remember the result for {@link image}. */
  load(sessionDir: string, sessionId: string): Promise<ReviewData> {
    return this.serial(async () => {
      const built = await this.build(sessionDir, sessionId, []);
      this.cache.set(sessionId, built);
      return built.data;
    });
  }

  /** A package image of the last {@link load} as a PNG data URL, or null if it is not one. */
  image(sessionId: string, imagePath: string): string | null {
    if (!/^media\/[A-Za-z0-9_.-]+\.png$/.test(imagePath)) return null;
    const bytes = this.cache.get(sessionId)?.files.get(imagePath);
    return bytes ? `data:image/png;base64,${Buffer.from(bytes).toString("base64")}` : null;
  }

  /**
   * Append one edit. The session is rebuilt with it first; when that fails (for example a blur
   * outside its image) nothing is written and the error is thrown.
   */
  applyEdit(sessionDir: string, sessionId: string, input: ReviewEditInput): Promise<ReviewData> {
    return this.serial(async () => {
      const edit = this.toEdit(input);
      const built = await this.build(sessionDir, sessionId, [edit]);
      await mkdir(sessionDir, { recursive: true });
      await appendFile(path.join(sessionDir, EDITS_FILE), `${JSON.stringify(edit)}\n`, "utf8");
      this.cache.set(sessionId, built);
      return built.data;
    });
  }

  private toEdit(input: ReviewEditInput): Edit {
    const now = (this.opts.now ?? (() => new Date()))();
    const random = this.opts.random ?? (() => randomBytes(4));
    const base = {
      edit_id: `ed_${now.getTime().toString(36)}${Buffer.from(random()).toString("hex")}`,
      at: now.toISOString(),
    };
    const raw = (() => {
      switch (input.op) {
        case "delete_step":
          return { ...base, op: "delete_step", step_id: input.preEditId };
        case "edit_summary":
          if (typeof input.text !== "string" || input.text.trim() === "") {
            throw new Error("A step needs a summary: it cannot be empty.");
          }
          return { ...base, op: "edit_summary", step_id: input.preEditId, text: input.text.trim() };
        case "edit_comment":
          return { ...base, op: "edit_comment", annotation_id: input.annotationId, text: input.text };
        case "blur_rect":
          return { ...base, op: "blur_rect", step_id: input.preEditId, rect_fpx: input.rectFpx };
        default:
          // An unknown operation from the renderer fails closed (assertEdit throws).
          return { ...base, op: String((input as { op?: unknown }).op) };
      }
    })();
    return assertEdit(raw);
  }
}
