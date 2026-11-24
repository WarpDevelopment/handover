// The recording bar is narrow: an action failure (APP-5) is shown shortened, with the full text as a tooltip.

export const BAR_ERROR_MAX = 26;

export function shortBarError(message: string): string {
  return message.length > BAR_ERROR_MAX ? `${message.slice(0, BAR_ERROR_MAX - 1)}…` : message;
}
