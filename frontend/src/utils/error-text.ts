/** User-facing message for an error, without Electron's IPC wrapper text. */
export function errorText(e: unknown): string {
  const msg = (e as any)?.message ?? String(e);
  return msg.replace(/^Error invoking remote method '[^']+': (Error: )?/, "");
}
