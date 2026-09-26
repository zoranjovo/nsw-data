import axios from "axios";

export const describeError = (error: unknown): string => {
  if (axios.isAxiosError(error)) {
    const method = error.config?.method?.toUpperCase() ?? "GET";
    const url = error.config?.url ?? "unknown URL";
    const code = error.code ? ` [${error.code}]` : "";
    return `${error.message}${code} (${method} ${url})`;
  }
  if (error instanceof Error) {
    return error.stack ?? error.message;
  }
  return String(error);
};
