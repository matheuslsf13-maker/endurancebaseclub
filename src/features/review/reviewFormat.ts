// pt-BR number formats of the review screens (B2-m12): a decimal comma like the domain's issue
// messages ("divergência de 3,5 s"), never `toFixed`'s decimal point.

const seconds = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const signedSeconds = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1, signDisplay: 'always' });

/** `3,5` for 3 500 ms (tenths of a second). */
export function formatSecondsBR(ms: number): string {
  return seconds.format(ms / 1000);
}

/** `+0,3` / `-0,3` for ±300 ms: a mark's distance to the crossing's median. */
export function formatSignedSecondsBR(ms: number): string {
  return signedSeconds.format(ms / 1000);
}
