import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export async function safeResponseJson<T = any>(
  response: Response,
): Promise<T> {
  const text = await response.text();
  const trimmed = text.trim();
  if (!trimmed) return {} as T;
  if (trimmed.startsWith("<")) {
    throw new Error(
      response.ok
        ? "Unexpected HTML response from server"
        : `Server returned HTML error (${response.status}). Retry in a moment.`,
    );
  }
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    throw new Error(
      response.ok
        ? "Invalid JSON response from server"
        : `Request failed (${response.status})`,
    );
  }
}
