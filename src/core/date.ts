/** Date come stringhe ISO "AAAA-MM-GG", calcoli in UTC (niente sorprese con i fusi orari). */
const GIORNO = 86400000;

export const ms = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
export const daMs = (t: number) => new Date(t).toISOString().slice(0, 10);
export const aggiungiGiorni = (d: string, n: number) => daMs(ms(d) + n * GIORNO);
export const giorniTra = (a: string, b: string) => Math.round((ms(b) - ms(a)) / GIORNO);
export const giornoSettimana = (d: string) => new Date(ms(d)).getUTCDay(); // 0 dom ... 6 sab

export function oggi(): string {
  const t = new Date();
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
}

/** Tutti i giorni da a a b compresi. */
export function intervallo(a: string, b: string): string[] {
  const out: string[] = [];
  for (let t = ms(a), f = ms(b); t <= f; t += GIORNO) out.push(daMs(t));
  return out;
}

/** Giorni lavorativi (lun-ven) da a a b compresi. */
export const lavorativi = (a: string, b: string) => intervallo(a, b).filter((d) => { const g = giornoSettimana(d); return g > 0 && g < 6; });

export function fineMese(d: string): string {
  const a = +d.slice(0, 4), m = +d.slice(5, 7);
  return daMs(Date.UTC(a, m, 0));
}

export function fineTrimestre(d: string): string {
  const a = +d.slice(0, 4), m = +d.slice(5, 7);
  return daMs(Date.UTC(a, Math.ceil(m / 3) * 3, 0));
}

/** Venerdì della settimana (il venerdì stesso o il successivo), come pandas "W-FRI". */
export function venerdi(d: string): string {
  const g = giornoSettimana(d);
  return aggiungiGiorni(d, (5 - g + 7) % 7);
}

export const inizioMese = (d: string) => d.slice(0, 8) + "01";
export const inizioAnno = (d: string) => d.slice(0, 5) + "01-01";

export function formatoIt(d: string | null | undefined): string {
  if (!d) return "–";
  return `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
}

export function adesso(): string {
  const t = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${oggi()} ${p(t.getHours())}:${p(t.getMinutes())}`;
}
