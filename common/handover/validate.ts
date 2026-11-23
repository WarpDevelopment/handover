// validatePackage(dir): schema checks plus the cross-file checks of tester-package.md §8.
// Uses a small JSON Schema subset validator (type, required, properties, items, enum, const,
// pattern, min/max, minItems/maxItems, minLength, $ref) so there is no new runtime dependency.
// Unknown properties are allowed on purpose: new fields get added, never renamed.

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { sha256Hex } from "./canonical";
import schema from "./schema/tester-package.schema.json" with { type: "json" };

type Json = unknown;
type Schema = Record<string, unknown>;

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

function typeOk(type: string, v: Json): boolean {
  switch (type) {
    case "object":
      return typeof v === "object" && v !== null && !Array.isArray(v);
    case "array":
      return Array.isArray(v);
    case "string":
      return typeof v === "string";
    case "number":
      return typeof v === "number" && Number.isFinite(v);
    case "integer":
      return typeof v === "number" && Number.isInteger(v);
    case "boolean":
      return typeof v === "boolean";
    default:
      return false;
  }
}

function resolveRef(ref: string): Schema {
  if (!ref.startsWith("#/")) throw new Error(`Unsupported $ref ${ref}`);
  let node: unknown = schema;
  for (const part of ref.slice(2).split("/")) node = (node as Record<string, unknown>)[part];
  if (!node) throw new Error(`Unresolved $ref ${ref}`);
  return node as Schema;
}

/** Validate `value` against a schema node; pushes messages prefixed with `at`. */
export function validateAgainst(node: Schema, value: Json, at: string, errors: string[]): void {
  if (typeof node.$ref === "string") {
    validateAgainst(resolveRef(node.$ref), value, at, errors);
    return;
  }
  if (typeof node.type === "string" && !typeOk(node.type, value)) {
    errors.push(`${at}: expected ${node.type}`);
    return;
  }
  if ("const" in node && value !== node.const) {
    errors.push(`${at}: expected ${JSON.stringify(node.const)}`);
  }
  if (Array.isArray(node.enum) && !node.enum.includes(value)) {
    errors.push(`${at}: ${JSON.stringify(value)} is not one of ${node.enum.join(", ")}`);
  }
  if (typeof value === "string") {
    if (typeof node.pattern === "string" && !new RegExp(node.pattern).test(value)) {
      errors.push(`${at}: does not match ${node.pattern}`);
    }
    if (typeof node.minLength === "number" && value.length < node.minLength) {
      errors.push(`${at}: shorter than ${node.minLength}`);
    }
  }
  if (typeof value === "number") {
    if (typeof node.minimum === "number" && value < node.minimum) errors.push(`${at}: below ${node.minimum}`);
    if (typeof node.maximum === "number" && value > node.maximum) errors.push(`${at}: above ${node.maximum}`);
  }
  if (Array.isArray(value)) {
    if (typeof node.minItems === "number" && value.length < node.minItems) {
      errors.push(`${at}: fewer than ${node.minItems} items`);
    }
    if (typeof node.maxItems === "number" && value.length > node.maxItems) {
      errors.push(`${at}: more than ${node.maxItems} items`);
    }
    if (node.items && typeof node.items === "object") {
      value.forEach((item, i) => validateAgainst(node.items as Schema, item, `${at}[${i}]`, errors));
    }
  }
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    for (const key of (node.required as string[] | undefined) ?? []) {
      if (!(key in obj)) errors.push(`${at}: missing ${key}`);
    }
    const props = (node.properties as Record<string, Schema> | undefined) ?? {};
    for (const [key, sub] of Object.entries(props)) {
      if (key in obj) validateAgainst(sub, obj[key], `${at}.${key}`, errors);
    }
  }
}

export function validateRecord(def: "manifest" | "step" | "annotation" | "gap", value: Json, at: string): string[] {
  const errors: string[] = [];
  validateAgainst(resolveRef(`#/$defs/${def}`), value, at, errors);
  return errors;
}

async function readJsonl(file: string, errors: string[]): Promise<Record<string, unknown>[]> {
  let raw: string;
  try {
    raw = await readFile(file, "utf8");
  } catch {
    errors.push(`${path.basename(file)}: missing`);
    return [];
  }
  const out: Record<string, unknown>[] = [];
  for (const [i, line] of raw.split("\n").entries()) {
    if (line === "") continue;
    try {
      out.push(JSON.parse(line) as Record<string, unknown>);
    } catch {
      errors.push(`${path.basename(file)}:${i + 1}: not valid JSON`);
    }
  }
  return out;
}

async function listPngs(dir: string, rel = ""): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(path.join(dir, rel), { withFileTypes: true })) {
    const p = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...(await listPngs(dir, p)));
    else if (e.name.toLowerCase().endsWith(".png")) out.push(p);
  }
  return out;
}

/** Schema and cross-file checks of tester-package.md §8 on an exported package folder. */
export async function validatePackage(dir: string): Promise<ValidationResult> {
  const errors: string[] = [];
  let manifest: Record<string, unknown>;
  try {
    manifest = JSON.parse(await readFile(path.join(dir, "manifest.json"), "utf8")) as Record<string, unknown>;
  } catch {
    return { ok: false, errors: ["manifest.json: missing or not valid JSON"] };
  }
  errors.push(...validateRecord("manifest", manifest, "manifest"));

  const steps = await readJsonl(path.join(dir, "steps.jsonl"), errors);
  const annotations = await readJsonl(path.join(dir, "annotations.jsonl"), errors);
  const gaps = await readJsonl(path.join(dir, "gaps.jsonl"), errors);
  steps.forEach((s, i) => errors.push(...validateRecord("step", s, `steps.jsonl:${i + 1}`)));
  annotations.forEach((a, i) => errors.push(...validateRecord("annotation", a, `annotations.jsonl:${i + 1}`)));
  gaps.forEach((g, i) => errors.push(...validateRecord("gap", g, `gaps.jsonl:${i + 1}`)));

  // Every path in `files` exists and its sha256 matches.
  const files = (manifest.files as { path: string; sha256: string; bytes: number }[] | undefined) ?? [];
  for (const f of files) {
    if (f.path.includes("..") || path.isAbsolute(f.path)) {
      errors.push(`files: unsafe path ${f.path}`);
      continue;
    }
    try {
      const bytes = await readFile(path.join(dir, f.path));
      if (sha256Hex(bytes) !== f.sha256) errors.push(`files: sha256 mismatch for ${f.path}`);
      if (bytes.byteLength !== f.bytes) errors.push(`files: size mismatch for ${f.path}`);
    } catch {
      errors.push(`files: ${f.path} is listed but missing`);
    }
  }

  // Step ids run S01…Sn with no holes.
  steps.forEach((s, i) => {
    const want = `S${String(i + 1).padStart(2, "0")}`;
    if (s.step_id !== want) errors.push(`steps.jsonl:${i + 1}: step_id ${String(s.step_id)} should be ${want}`);
    if (s.seq !== i + 1) errors.push(`steps.jsonl:${i + 1}: seq ${String(s.seq)} should be ${i + 1}`);
  });

  // Every annotation_ids / step_ids reference resolves.
  const stepIds = new Set(steps.map((s) => s.step_id as string));
  const annIds = new Set(annotations.map((a) => a.annotation_id as string));
  for (const s of steps) {
    for (const id of (s.annotation_ids as string[] | undefined) ?? []) {
      if (!annIds.has(id)) errors.push(`${String(s.step_id)}: annotation_ids refers to unknown ${id}`);
    }
    const why = s.why as { source_annotation_ids?: string[] } | undefined;
    for (const id of why?.source_annotation_ids ?? []) {
      if (!annIds.has(id)) errors.push(`${String(s.step_id)}: why refers to unknown ${id}`);
    }
  }
  for (const a of annotations) {
    for (const id of (a.step_ids as string[] | undefined) ?? []) {
      if (!stepIds.has(id)) errors.push(`${String(a.annotation_id)}: step_ids refers to unknown ${id}`);
    }
  }
  for (const g of gaps) {
    for (const key of ["after_step", "before_step"] as const) {
      const id = g[key] as string | undefined;
      if (id && !stepIds.has(id)) errors.push(`${String(g.gap_id)}: ${key} refers to unknown ${id}`);
    }
  }

  // task_ms + explain_ms + paused_ms = duration_ms.
  const rec = manifest.recording as Record<string, number> | undefined;
  if (rec && rec.task_ms + rec.explain_ms + rec.paused_ms !== rec.duration_ms) {
    errors.push("recording: task_ms + explain_ms + paused_ms must equal duration_ms");
  }
  if (rec && rec.step_count !== steps.length) errors.push("recording: step_count does not match steps.jsonl");

  // image_count equals the number of PNGs.
  const media = manifest.media as { image_count?: number } | undefined;
  const pngs = await listPngs(dir);
  if (media && media.image_count !== pngs.length) {
    errors.push(`media: image_count ${String(media.image_count)} but ${pngs.length} PNGs found`);
  }
  // Every image a step names exists.
  for (const s of steps) {
    for (const frame of [s.before, s.after] as ({ full?: { path: string }; full_annotated?: { path: string }; crop?: { path: string } } | undefined)[]) {
      for (const img of [frame?.full, frame?.full_annotated, frame?.crop]) {
        if (img && !pngs.includes(img.path)) errors.push(`${String(s.step_id)}: image ${img.path} is missing`);
      }
    }
  }
  return { ok: errors.length === 0, errors };
}
