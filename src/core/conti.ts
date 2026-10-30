/**
 * Conti raggruppati per ente (banca o app): «Intesa Sanpaolo» con Conto e Salvadanaio, «Revolut» con un conto per
 * valuta... I nomi dei conti nei dati restano quelli di sempre (compatibili con la versione per PC); qui si decide
 * solo come mostrarli.
 */
const ENTI: [RegExp, string][] = [
  [/^Intesa\b/i, "Intesa Sanpaolo"],
  [/^Satispay\b/i, "Satispay"],
  [/^Trade Republic\b/i, "Trade Republic"],
  [/^Revolut\b/i, "Revolut"],
  [/^Fineco\b/i, "Fineco"],
  [/^UniCredit\b/i, "UniCredit"],
];

export interface InfoConto { conto: string; ente: string; sotto: string; }

export function infoConto(conto: string): InfoConto {
  for (const [re, ente] of ENTI) {
    if (!re.test(conto)) continue;
    let resto = conto.replace(re, "").trim();
    if (ente === "Intesa Sanpaolo") resto = resto.replace(/^Sanpaolo\b/i, "").trim();
    return { conto, ente, sotto: resto || "Conto" };
  }
  return { conto, ente: conto, sotto: "Conto" };
}

export interface Gruppo { ente: string; conti: InfoConto[]; }

/** Conti raggruppati per ente, nell'ordine dato; dentro ogni ente prima il conto principale. */
export function raggruppaConti(conti: string[]): Gruppo[] {
  const g = new Map<string, InfoConto[]>();
  for (const c of conti) {
    const i = infoConto(c);
    const x = g.get(i.ente);
    if (x) x.push(i); else g.set(i.ente, [i]);
  }
  const peso = (s: string) => (s === "Conto" || s === "EUR" ? 0 : 1);
  return [...g.entries()].map(([ente, cs]) => ({ ente, conti: cs.sort((a, b) => peso(a.sotto) - peso(b.sotto) || a.sotto.localeCompare(b.sotto, "it")) }));
}

/** Nome da mostrare: «Intesa Sanpaolo», «Intesa Sanpaolo · Salvadanaio», «Revolut · USD». */
export function nomeConto(conto: string): string {
  const i = infoConto(conto);
  return i.sotto === "Conto" ? i.ente : `${i.ente} · ${i.sotto}`;
}
