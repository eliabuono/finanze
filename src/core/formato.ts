/**
 * Lettura/scrittura dei file di dati nello stesso formato della versione Python
 * (movimenti.txt, saldi_noti.txt, importati.txt, prezzi_cache.csv: testo separato da ';').
 * Così PC (anche con l'app Python) e telefono possono usare la stessa cartella su Google Drive.
 */
import type { FileImportato, Movimento, SaldoNoto } from "./tipi";

export const COLONNE = ["id", "data", "conto", "tipo", "descrizione", "importo", "categoria", "isin", "quote", "fonte", "manuale"];
export const COL_SALDI = ["data", "conto", "saldo", "fonte"];
export const COL_IMPORTATI = ["file", "dimensione", "modificato", "formato", "movimenti_nuovi", "importato_il", "dal", "al"];

/** CSV con ';' e virgolette come pandas. */
export function leggiCsv(testo: string): Record<string, string>[] {
  testo = testo.replace(/^﻿/, "");
  const righe: string[][] = [];
  let campo = "", riga: string[] = [], virg = false;
  for (let i = 0; i < testo.length; i++) {
    const c = testo[i];
    if (virg) {
      if (c === '"') {
        if (testo[i + 1] === '"') { campo += '"'; i++; } else virg = false;
      } else campo += c;
    } else if (c === '"') virg = true;
    else if (c === ";") { riga.push(campo); campo = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && testo[i + 1] === "\n") i++;
      riga.push(campo); campo = "";
      if (riga.length > 1 || riga[0] !== "") righe.push(riga);
      riga = [];
    } else campo += c;
  }
  if (campo !== "" || riga.length) { riga.push(campo); righe.push(riga); }
  if (!righe.length) return [];
  const [h, ...corpo] = righe;
  return corpo.map((r) => Object.fromEntries(h.map((k, i) => [k, r[i] ?? ""])));
}

const cella = (v: unknown) => {
  const s = v === null || v === undefined ? "" : String(v);
  return /[;"\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};

export function scriviCsv(colonne: string[], righe: Record<string, unknown>[]): string {
  return [colonne.join(";"), ...righe.map((r) => colonne.map((c) => cella(r[c])).join(";"))].join("\n") + "\n";
}

const num = (s: string) => (s === "" || s === undefined ? null : Number(s));

export function movimentiDaTesto(t: string): Movimento[] {
  return leggiCsv(t).map((r) => ({
    id: r.id, data: r.data.slice(0, 10), conto: r.conto, tipo: r.tipo ?? "", descrizione: r.descrizione ?? "",
    importo: Number(r.importo), categoria: r.categoria ?? "", isin: r.isin ?? "",
    quote: num(r.quote), fonte: r.fonte ?? "", manuale: r.manuale === "1",
  }));
}

const quoteTesto = (v: number | null) => (v === null || Number.isNaN(v) ? "" : v.toFixed(6).replace(/0+$/, "").replace(/\.$/, ""));

export function movimentiATesto(mov: Movimento[]): string {
  const ord = mov.map((m, i) => ({ m, i })).sort((a, b) =>
    a.m.data < b.m.data ? -1 : a.m.data > b.m.data ? 1 : a.m.conto < b.m.conto ? -1 : a.m.conto > b.m.conto ? 1 : a.i - b.i);
  return scriviCsv(COLONNE, ord.map(({ m }) => ({ ...m, importo: m.importo.toFixed(2), quote: quoteTesto(m.quote),
    manuale: m.manuale ? "1" : "" })));
}

export function saldiDaTesto(t: string): SaldoNoto[] {
  return leggiCsv(t).map((r) => ({ data: r.data.slice(0, 10), conto: r.conto, saldo: Number(r.saldo), fonte: r.fonte ?? "" }));
}

export function saldiATesto(s: SaldoNoto[]): string {
  const ord = [...s].sort((a, b) => a.conto.localeCompare(b.conto) || (a.data < b.data ? -1 : a.data > b.data ? 1 : 0));
  return scriviCsv(COL_SALDI, ord.map((x) => ({ ...x, saldo: x.saldo.toFixed(2) })));
}

export function importatiDaTesto(t: string): FileImportato[] {
  return leggiCsv(t).map((r) => ({ file: r.file, dimensione: Number(r.dimensione) || 0, formato: r.formato,
    movimenti_nuovi: Number(r.movimenti_nuovi) || 0, importato_il: r.importato_il ?? "", dal: r.dal ?? "", al: r.al ?? "",
    ...(r.modificato ? { modificato: r.modificato } : {}) } as FileImportato));
}

export function importatiATesto(r: FileImportato[]): string {
  return scriviCsv(COL_IMPORTATI, r as any);
}

export type CachePrezzi = Record<string, Record<string, number>>; // isin -> data -> prezzo

export function prezziDaTesto(t: string): CachePrezzi {
  const out: CachePrezzi = {};
  for (const r of leggiCsv(t)) {
    const p = Number(r.prezzo);
    if (!r.isin || !Number.isFinite(p)) continue;
    (out[r.isin] ??= {})[r.data.slice(0, 10)] = p;
  }
  return out;
}

export function prezziATesto(c: CachePrezzi): string {
  const righe: Record<string, unknown>[] = [];
  for (const isin of Object.keys(c).sort())
    for (const d of Object.keys(c[isin]).sort()) righe.push({ data: d, isin, prezzo: c[isin][d] });
  return scriviCsv(["data", "isin", "prezzo"], righe);
}
