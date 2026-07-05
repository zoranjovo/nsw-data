import { DateTime } from "luxon";

const DEBUG_ENABLED = process.env.DEBUG === "true";

const timestamp = (): string => {
  return DateTime.now().toFormat("HH:mm:ss");
};

const format = (label: string, message: string): string => {
  return `[${timestamp()}] ${label.padEnd(6)} ${message}`;
};

export const debugLog = (label: string, message: string): void => {
  if (!DEBUG_ENABLED) return;
  console.log(format(label, message));
};
