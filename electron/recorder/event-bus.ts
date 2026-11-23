import type { EventInput } from "../../common/events";
import type { RecEvent } from "../../common/types";
import type { SessionStore } from "./session-store";

export type EventListener = (ev: RecEvent) => void;

/**
 * Events the collectors produce about the user's work. While the recording is paused, or the screen
 * is frozen for an explanation, none of them are recorded: the user is not doing the task, and the
 * clicks and focus changes of Handover's own overlay are not steps.
 */
export const PAUSE_BLOCKED_TYPES: ReadonlySet<string> = new Set([
  "pointer.click",
  "app.activate",
  "app.title-change",
  "browser.url",
  "clipboard.change",
  "terminal.command",
  "marker",
]);

/**
 * In-process hub between collectors and the active session. Collectors publish
 * typed `EventInput`s; the bus persists them via the attached `SessionStore`
 * and fans them out to subscribers (status updates now; correlation later).
 * When no session is active (`detach`ed) published events are safely dropped,
 * so a collector that fires slightly after Stop cannot write to a closed store.
 */
export class EventBus {
  private store: SessionStore | null = null;
  private readonly listeners = new Set<EventListener>();
  private blocked = false;

  attach(store: SessionStore): void {
    this.store = store;
    this.blocked = false;
  }

  detach(): void {
    this.store = null;
    this.blocked = false;
  }

  /** While blocked, the types in {@link PAUSE_BLOCKED_TYPES} are dropped (paused, or frozen). */
  setBlocked(blocked: boolean): void {
    this.blocked = blocked;
  }

  get active(): boolean {
    return this.store !== null;
  }

  publish(input: EventInput): RecEvent | null {
    if (!this.store) return null;
    if (this.blocked && PAUSE_BLOCKED_TYPES.has(input.type)) return null;
    const ev = this.store.append(input.type, input.source, input.payload);
    for (const listener of this.listeners) listener(ev);
    return ev;
  }

  subscribe(listener: EventListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}
