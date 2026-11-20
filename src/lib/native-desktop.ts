"use client";

type NativeWindow = Window & {
  __TAURI__?: { core?: { invoke?: <T>(command: string) => Promise<T> } };
};

export function nativeFolderPicker() {
  if (typeof window === "undefined") return undefined;
  const invoke = (window as NativeWindow).__TAURI__?.core?.invoke;
  return invoke ? () => invoke<string | null>("pick_project_folder") : undefined;
}
