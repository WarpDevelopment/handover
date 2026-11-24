import type { HandoverApi } from "../common/ipc";

declare global {
  interface Window {
    handover: HandoverApi;
  }
}

export {};
