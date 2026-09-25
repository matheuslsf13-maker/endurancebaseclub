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
    if (!navigator.clipboard?.writeText) return false;
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
