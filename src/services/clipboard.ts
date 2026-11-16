/**
 * Clipboard handling for secrets (P-04 fix).
 *
 * The auto-clear timer lives at module level, not inside a React
 * component, so navigating away from the view that copied a secret no
 * longer cancels the clear. Clearing is also conditional: if the
 * clipboard no longer holds the value this app copied (the user has
 * copied something else since), it is left untouched instead of being
 * clobbered. Copy failures are reported to the caller (the returned
 * promise resolves false) instead of being silently swallowed while
 * the UI claims success.
 */

let clearTimer: ReturnType<typeof setTimeout> | null = null;
let lastCopiedValue: string | null = null;

function cancelPendingClear(): void {
  if (clearTimer) {
    clearTimeout(clearTimer);
    clearTimer = null;
  }
}

/**
 * Clears the clipboard, but only when it still contains the last value
 * copied through this service. When the clipboard cannot be read
 * (permission denied), it falls back to clearing unconditionally —
 * leaving a known secret in place is worse than the small chance of
 * erasing something copied in the meantime.
 */
export async function clearClipboardIfOurs(): Promise<void> {
  cancelPendingClear();
  const ours = lastCopiedValue;
  lastCopiedValue = null;
  if (ours === null) return;

  try {
    if (navigator.clipboard?.readText) {
      try {
        const current = await navigator.clipboard.readText();
        if (current !== ours) return; // User copied something else; keep it.
      } catch {
        // Unreadable clipboard: fall through and clear anyway.
      }
    }
    await navigator.clipboard?.writeText('');
  } catch {
    // Clipboard unavailable; nothing more can be done.
  }
}

/**
 * Copies `text` and schedules its removal after `clearAfterSeconds`
 * (no removal when <= 0). Resolves true only when the write actually
 * succeeded, so callers can show an honest copied/failed state.
 */
export async function copyTextWithAutoClear(text: string, clearAfterSeconds: number): Promise<boolean> {
  if (!navigator.clipboard?.writeText) return false;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    return false;
  }
  lastCopiedValue = text;
  cancelPendingClear();
  if (clearAfterSeconds > 0) {
    clearTimer = setTimeout(() => {
      void clearClipboardIfOurs();
    }, clearAfterSeconds * 1000);
  }
  return true;
}
