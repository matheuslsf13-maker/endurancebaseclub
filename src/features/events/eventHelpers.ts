/** Small helpers shared by the Events, event general-tab and settings screens. */

/** Comma-separated free text ("Elite, Base, Elite") into a trimmed, order-preserving unique list. */
export function parseLevels(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(',')) {
    const v = raw.trim();
    if (v && !out.includes(v)) out.push(v);
  }
  return out;
}

/** The error's own message when it has one (an `ApiError`'s is already pt-BR), else a fallback. */
export function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

/** Best-effort clipboard write; jsdom, older browsers and a denied permission all resolve `false`. */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Some phones/browsers refuse the Clipboard API (permission, focus): fall back below.
  }
  return copyWithSelection(text);
}

/** The older copy path: select the text in an off-screen textarea and run "copy". It works where
 * the Clipboard API is missing or refused (organizer feedback 2026-10-22: the temporary password
 * could not be copied to send over WhatsApp). */
function copyWithSelection(text: string): boolean {
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.top = '0';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();
  area.setSelectionRange(0, text.length);
  try {
    return typeof document.execCommand === 'function' && document.execCommand('copy');
  } catch {
    return false;
  } finally {
    area.remove();
  }
}
