/**
 * Lettori degli estratti conto (porting fedele della versione Python).
 *  - Trade Republic: estratto conto (conto corrente + acquisti/vendite titoli)
 *  - Intesa Sanpaolo: estratto conto trimestrale e "Lista movimenti"
 *  - Satispay: "Lista Transazioni"
 *  - Revolut: estratto conto (in italiano o in inglese)
 *  - Fineco: estratto conto (conto corrente e dossier titoli)
 *  - UniCredit: estratto conto
 */
import { Pagina, Parola, righe } from "./pdftext";
import type { Controlli, Formato, MovimentoLetto } from "./tipi";

const MESI: Record<string, number> = {
  gen: 1, feb: 2, mar: 3, apr: 4, mag: 5, giu: 6, lug: 7, ago: 8, set: 9, ott: 10, nov: 11, dic: 12,
};
const ISIN_RE = /\b([A-Z]{2}[A-Z0-9]{9}\d)\b/;

export function numIt(t: string): number {
  const s = t.replace(/€/g, "").replace(/[\s\u00a0\x19]/g, "").replace(/\./g, "").replace(",", ".");
  return parseFloat(s);
}

const iso = (a: number, m: number, g: number) =>
  `${a}-${String(m).padStart(2, "0")}-${String(g).padStart(2, "0")}`;
const r2 = (x: number) => Math.round(x * 100) / 100;
const spazi = (s: string) => s.split(/\s+/).filter(Boolean).join(" ");

function mov(p: Partial<MovimentoLetto> & Pick<MovimentoLetto, "data" | "conto" | "tipo" | "descrizione" | "importo">): MovimentoLetto {
  return {
    categoria: "", isin: "", quote: null, saldo: null, fonte: "",
    ...p,
    descrizione: spazi(p.descrizione),
    importo: r2(p.importo),
  };
}

// ================================================================== riconoscimento
export function riconosci(pagine: Pagina[]): Formato {
  const t = (pagine[0]?.testo ?? "").slice(0, 3000);
  const T = t.toUpperCase();
  if (T.includes("TRADE REPUBLIC") && T.includes("TRANSAZIONI SUL CONTO")) return "trade_republic";
  if (T.includes("REVOLUT") && (T.includes("DENARO IN USCITA") || T.includes("MONEY OUT"))) return "revolut";
  const tutto = (pagine[0]?.testo ?? "").toUpperCase();
  if (tutto.includes("UNICREDIT") && tutto.includes("ELENCO MOVIMENTI") && tutto.includes("SALDO INIZIALE")) return "unicredit";
  if (tutto.includes("FINECO") && tutto.includes("DESCRIZIONE OPERAZIONE") && tutto.includes("SALDO INIZIALE")) return "fineco";
  if (t.includes("Lista Transazioni") && (t.includes("Satispay") || t.includes("Disponibilit"))) return "satispay";
  if (t.includes("Lista movimenti")) return "intesa_lista";
  if (t.includes("ESTRATTO CONTO N.") && t.includes("C/C N.")) return "intesa_estratto";
  return "sconosciuto";
}

export function leggi(pagine: Pagina[], fonte: string): { formato: Formato; movimenti: MovimentoLetto[]; controlli: Controlli } {
  const formato = riconosci(pagine);
  switch (formato) {
    case "trade_republic": return { formato, ...leggiTradeRepublic(pagine, fonte) };
    case "satispay": return { formato, ...leggiSatispay(pagine, fonte) };
    case "intesa_lista": return { formato, ...leggiIntesaLista(pagine, fonte) };
    case "intesa_estratto": return { formato, ...leggiIntesaEstratto(pagine, fonte) };
    case "revolut": return { formato, ...leggiRevolut(pagine, fonte) };
    case "fineco": return { formato, ...leggiFineco(pagine, fonte) };
    case "unicredit": return { formato, ...leggiUnicredit(pagine, fonte) };
    default: throw new Error(`Formato non riconosciuto: ${fonte}`);
  }
}

// ================================================================== Trade Republic
export function leggiTradeRepublic(pagine: Pagina[], fonte: string) {
  const parole: [number, Parola][] = [];
  let saldoFinaleDichiarato: number | null = null;
  let inTabella = false;
  for (let i = 0; i < pagine.length; i++) {
    const pag = pagine[i];
    const ws = pag.parole;
    if (i === 0) {
      for (const riga of righe(ws, 1)) {
        const s = riga.map((w) => w.text).join(" ");
        if (s.startsWith("Conto corrente") && saldoFinaleDichiarato === null) {
          const imp = s.match(/-?[\d.]+,\d{2}/g);
          if (imp) saldoFinaleDichiarato = numIt(imp[imp.length - 1]);
        }
      }
    }
    let topTab: number | null = null;
    let fine = pag.height;
    for (const w of ws) {
      if (w.text === "DESCRIZIONE" && w.x0 > 140 && w.x0 < 200) topTab = w.top + 5;
      if (w.text === "www.traderepublic.it") fine = Math.min(fine, w.top - 30);
      if (["PANORAMICA", "FONDI", "NOTE"].includes(w.text) && w.x0 < 80 && (topTab === null || w.top > topTab)) {
        fine = Math.min(fine, w.top - 2);
        if (topTab === null) inTabella = false;
      }
    }
    if (topTab !== null) inTabella = true;
    if (!inTabella && topTab === null) continue;
    const start = topTab ?? 0;
    for (const w of ws) if (w.top >= start && w.top < fine) parole.push([i, w]);
    if (fine < pag.height - 120) break;
  }

  parole.sort((a, b) => a[0] - b[0] || a[1].top - b[1].top || a[1].x0 - b[1].x0);
  const blocchi: Parola[][] = [];
  let cur: Parola[] | null = null;
  for (const [, w] of parole) {
    if (w.x0 < 80 && /^\d{1,2}$/.test(w.text)) {
      cur = [w];
      blocchi.push(cur);
    } else if (cur) cur.push(w);
  }

  const movimenti: MovimentoLetto[] = [];
  let saldoPrec = 0;
  for (const ws of blocchi) {
    const giorno = parseInt(ws[0].text, 10);
    const mese = ws.find((w) => w.x0 < 100 && w.text in MESI);
    const anno = ws.find((w) => w.x0 < 100 && /^20\d\d$/.test(w.text));
    if (!mese || !anno) continue;
    const perRiga = (a: Parola, b: Parola) => Math.round(a.top) - Math.round(b.top) || a.x0 - b.x0;
    const tipo = ws.filter((w) => w.x0 > 98 && w.x0 < 148).sort((a, b) => a.top - b.top || a.x0 - b.x0).map((w) => w.text).join(" ");
    const desc = ws.filter((w) => w.x0 >= 148 && w.x0 < 395).sort(perRiga).map((w) => w.text).join(" ");
    const importi = ws.filter((w) => w.x0 >= 395 && w.x0 < 478 && /\d,\d\d$/.test(w.text));
    const saldi = ws.filter((w) => w.x0 >= 476 && /\d,\d\d$/.test(w.text));
    if (!importi.length || !saldi.length) continue;
    const val = numIt(importi[0].text);
    const entrata = importi[0].x0 < 438;
    const saldo = numIt(saldi[0].text);
    let importo = entrata ? val : -val;
    if (Math.abs(saldoPrec + importo - saldo) > 0.015 && Math.abs(saldoPrec - importo - saldo) < 0.015) importo = -importo;
    saldoPrec = saldo;
    const mi = desc.match(ISIN_RE);
    const mq = desc.match(/quantity:\s*([\d.]+)/);
    let quote = mq ? parseFloat(mq[1]) : null;
    const dl = desc.toLowerCase();
    let tipoN: string;
    if (dl.includes("savings plan") || dl.includes("buy trade")) tipoN = "Acquisto titoli";
    else if (dl.includes("sell trade")) {
      tipoN = "Vendita titoli";
      if (quote) quote = -quote;
    } else if (dl.includes("saveback")) tipoN = "Saveback";
    else if (tipo.startsWith("Transazione")) tipoN = "Carta";
    else tipoN = tipo || "Altro";
    movimenti.push(mov({
      data: iso(parseInt(anno.text, 10), MESI[mese.text], giorno), conto: "Trade Republic", tipo: tipoN,
      descrizione: desc, importo, isin: mi ? mi[1] : "", quote, saldo, fonte,
    }));
  }
  const controlli: Controlli = {
    saldo_finale_dichiarato: saldoFinaleDichiarato,
    saldo_finale_calcolato: movimenti.length ? movimenti[movimenti.length - 1].saldo : null,
    somma_importi: r2(movimenti.reduce((s, m) => s + m.importo, 0)),
  };
  return { movimenti, controlli };
}

// ================================================================== Satispay
export function leggiSatispay(pagine: Pagina[], fonte: string) {
  let movimenti: MovimentoLetto[] = [];
  for (const pag of pagine) {
    const ws = pag.parole;
    const date = ws.filter((w) => w.x0 < 30 && /^\d{1,2}$/.test(w.text));
    for (const d of date) {
      const stessa = ws.filter((w) => Math.abs(w.top - d.top) < 3).sort((a, b) => a.x0 - b.x0);
      const sotto = ws.filter((w) => w.top - d.top >= 3 && w.top - d.top < 14).sort((a, b) => a.x0 - b.x0);
      const mese = stessa.find((w) => w.text in MESI && w.x0 < 40);
      const anno = stessa.find((w) => /^20\d\d$/.test(w.text) && w.x0 < 60);
      if (!mese || !anno) continue;
      const nome = stessa.filter((w) => w.x0 >= 60 && w.x0 < 140).map((w) => w.text).join(" ");
      const handle = sotto.filter((w) => w.x0 >= 60 && w.x0 < 140).map((w) => w.text).join(" ");
      const imp = stessa.find((w) => w.x0 >= 140 && w.x0 < 185 && /\d,\d\d$/.test(w.text));
      const tipo = stessa.filter((w) => w.x0 >= 185 && w.x0 < 265).map((w) => w.text).join(" ");
      const saldo = stessa.find((w) => w.x0 >= 305 && w.x0 < 350 && /\d,\d\d$/.test(w.text));
      const ident = ws.find((w) => Math.abs(w.top - d.top) < 4 && w.x0 >= 350)?.text ?? "";
      const stato = sotto.filter((w) => w.x0 >= 185 && w.x0 < 265).map((w) => w.text).join(" ");
      if (!imp) continue;
      if (stato && !stato.includes("Approvat")) continue;
      const descr = nome + (handle && !/^\d\d:\d\d$/.test(handle) ? ` ${handle}` : "");
      movimenti.push(mov({
        data: iso(parseInt(anno.text, 10), MESI[mese.text], parseInt(d.text, 10)), conto: "Satispay",
        tipo: tipo || "Satispay", descrizione: descr, importo: numIt(imp.text),
        saldo: saldo ? numIt(saldo.text) : null, fonte, id: ident,
      }));
    }
  }
  movimenti = movimenti.reverse();
  let controlli: Controlli = {};
  if (movimenti.length && movimenti[0].saldo !== null) {
    const iniziale = (movimenti[0].saldo as number) - movimenti[0].importo;
    const calcolato = iniziale + movimenti.reduce((s, m) => s + m.importo, 0);
    controlli = {
      saldo_iniziale_dedotto: r2(iniziale),
      saldo_finale_dichiarato: movimenti[movimenti.length - 1].saldo,
      saldo_finale_calcolato: r2(calcolato),
    };
  }
  return { movimenti, controlli };
}

// ================================================================== Intesa Sanpaolo - estratto conto
const RE_SALDO = /(?:^|\s)([+-]?\d[\d ]*, ?\d\d)\s*€?$/;

export function leggiIntesaEstratto(pagine: Pagina[], fonte: string) {
  const movimenti: MovimentoLetto[] = [];
  let saldoIniziale: number | null = null;
  let saldoFinale: number | null = null;
  let attivo = true;
  for (const pag of pagine) {
    if (!attivo) break;
    const ws = pag.parole3.map((w) => ({ ...w, text: w.text.replace(/\x19/g, "") }));
    if (!pag.testo.includes("Dettaglio movimenti del conto corrente") && !movimenti.length && saldoIniziale === null) continue;
    let hAdd = ws.find((w) => w.text.startsWith("Addebi"));
    let hAcc = ws.find((w) => w.text.startsWith("Accredit"));
    const hDesc = ws.find((w) => w.text === "Descrizione");
    if (hAdd) {
      const rigaH = ws.filter((w) => Math.abs(w.top - hAdd!.top) < 2);
      const limite = hAcc ? hAcc.x0 - 5 : 1e9;
      hAdd = { ...hAdd, x1: Math.max(...rigaH.filter((w) => w.x0 >= hAdd!.x0 && w.x0 < limite).map((w) => w.x1)) };
      if (hAcc) hAcc = { ...hAcc, x1: Math.max(...rigaH.filter((w) => w.x0 >= hAcc!.x0).map((w) => w.x1)) };
    }
    for (const riga of righe(ws)) {
      const txt = riga.map((w) => w.text).join(" ");
      if (txt.startsWith("Saldo iniziale al") && saldoIniziale === null && hAdd) {
        const m = txt.match(RE_SALDO);
        if (m) saldoIniziale = numIt(m[1]);
        continue;
      }
      if (txt.startsWith("Saldo finale al") && (movimenti.length || saldoIniziale !== null)) {
        const m = txt.match(RE_SALDO);
        if (m) saldoFinale = numIt(m[1]);
        attivo = false;
        break;
      }
      if (!hAdd) continue;
      const data1 = /^\d\d\.\d\d\.\d{4}$/;
      if (data1.test(riga[0].text) && riga[0].x0 < 80 && riga.length > 2 && data1.test(riga[1].text)) {
        const descr = riga.slice(2).filter((w) => w.x0 < hAdd!.x0 - 30);
        const numWs = riga.slice(2).filter((w) => w.x0 >= hAdd!.x0 - 30 && /^[\d.,]+$/.test(w.text));
        if (!numWs.length) continue;
        const valore = numIt(numWs.map((w) => w.text).join(""));
        const xFine = numWs[numWs.length - 1].x1;
        const accredito = hAcc ? Math.abs(xFine - hAcc.x1) < Math.abs(xFine - hAdd.x1) : false;
        const [g, mm, a] = riga[0].text.split(".").map((x) => parseInt(x, 10));
        const d = descr.map((w) => w.text).join(" ");
        movimenti.push(mov({ data: iso(a, mm, g), conto: "Intesa Sanpaolo", tipo: d, descrizione: d,
          importo: accredito ? valore : -valore, fonte }));
      } else if (movimenti.length && hDesc && riga[0].x0 >= hDesc.x0 - 10 && riga[0].x0 < hAdd.x0 - 30) {
        if (!/^(Pagina|ESTRATTO CONTO|AL \d|C\/C N\.)/.test(txt)) {
          movimenti[movimenti.length - 1].descrizione += " | " + riga.filter((w) => w.x0 < hAdd!.x0 - 30).map((w) => w.text).join(" ");
        }
      }
    }
  }
  for (const m of movimenti) {
    // pdf.js separa "24/10- 18:39" e "3, 00" che nell'estratto sono attaccati
    m.descrizione = spazi(m.descrizione).replace(/(\S)- (?=\S)/g, "$1-").replace(/(\d), (?=\d\d(?!\d))/g, "$1,");
    m.tipo = m.descrizione.split(" | ")[0];
  }
  const testo = pagine.map((p) => p.testo).join("\n").replace(/\x19/g, "");
  let dataFine: string | null = null;
  let dataInizio: string | null = null;
  let salvadanaio: number | null = null;
  const mf = testo.match(/Saldo finale al (\d\d)\.(\d\d)\.(\d{4})/);
  if (mf) dataFine = iso(+mf[3], +mf[2], +mf[1]);
  const mi = testo.match(/Saldo iniziale al (\d\d)\.(\d\d)\.(\d{4})/);
  if (mi) {
    const d = new Date(Date.UTC(+mi[3], +mi[2] - 1, +mi[1] + 1));
    dataInizio = d.toISOString().slice(0, 10);
  }
  const ms = testo.match(/Partite contabili del XME Salvadanaio[\s\S]*?\n\s*XME Salvadanaio\s+([+-]?\d[\d ]*, ?\d\d)/);
  if (ms && dataFine && dataFine.endsWith("-12-31")) salvadanaio = numIt(ms[1]);
  const controlli: Controlli = {
    data_inizio: dataInizio, data_fine: dataFine, saldo_salvadanaio: salvadanaio,
    saldo_iniziale_dichiarato: saldoIniziale, saldo_finale_dichiarato: saldoFinale,
    saldo_finale_calcolato: saldoIniziale === null ? null : r2(saldoIniziale + movimenti.reduce((s, m) => s + m.importo, 0)),
  };
  return { movimenti, controlli };
}

// ================================================================== Intesa Sanpaolo - lista movimenti
export function leggiIntesaLista(pagine: Pagina[], fonte: string) {
  const movimenti: (MovimentoLetto & { contabilizzato: string })[] = [];
  let hOp: Parola | null = null, hCont: Parola | null = null, hCat: Parola | null = null, hImp: Parola | null = null;
  for (const pag of pagine) {
    const ws = pag.parole;
    const trovate: Record<string, Parola> = {};
    for (const w of ws) if (["OPERAZIONE", "CONTABILIZZATO", "CATEGORIA", "IMPORTO"].includes(w.text)) trovate[w.text] = w;
    let top0 = 0;
    if (Object.keys(trovate).length === 4) {
      hOp = trovate.OPERAZIONE; hCont = trovate.CONTABILIZZATO; hCat = trovate.CATEGORIA; hImp = trovate.IMPORTO;
      top0 = Math.max(hOp.top, hCat.top, hImp.top) + 10;
    }
    if (!hOp || !hCont || !hCat || !hImp) continue;
    const corpo = ws.filter((w) => w.top > top0);
    const date = corpo.filter((w) => /^\d\d\.\d\d\.\d{4}$/.test(w.text) && w.x0 < hOp!.x0 - 5);
    if (!date.length) continue;
    const gruppi = new Map<Parola, Parola[]>(date.map((d) => [d, []]));
    for (const w of corpo) {
      if (gruppi.has(w)) continue;
      let best = date[0];
      for (const d of date) if (Math.abs(d.top - w.top) < Math.abs(best.top - w.top)) best = d;
      if (Math.abs(best.top - w.top) < 22) gruppi.get(best)!.push(w);
    }
    const ordina = (a: Parola, b: Parola) => Math.round(a.top) - Math.round(b.top) || a.x0 - b.x0;
    for (const d of date) {
      const g = gruppi.get(d)!;
      const desc = g.filter((w) => w.x0 < hCont!.x0 - 5).sort(ordina).map((w) => w.text).join(" ");
      const cat = g.filter((w) => w.x0 >= hCat!.x0 - 15 && w.x0 < hImp!.x0 - 5 && w.text !== "€").sort(ordina).map((w) => w.text).join(" ");
      const imp = g.filter((w) => w.x0 >= hImp!.x0 - 5 && /\d,\d\d$/.test(w.text));
      const contab = g.filter((w) => w.x0 >= hCont!.x0 - 5 && w.x0 < hCat!.x0 - 15).map((w) => w.text).join(" ");
      if (!imp.length) continue;
      const [gg, mm, aa] = d.text.split(".").map((x) => parseInt(x, 10));
      movimenti.push({
        ...mov({ data: iso(aa, mm, gg), conto: "Intesa Sanpaolo", tipo: desc.split(" Disposto")[0].slice(0, 40),
          descrizione: desc, importo: numIt(imp[0].text), categoria: cat, fonte }),
        contabilizzato: contab,
      });
    }
  }
  const out = movimenti
    .filter((m) => /^s[iì]/i.test(m.contabilizzato || "Si")) // "Si" o "SI" a seconda della versione della lista
    .map(({ contabilizzato, ...m }) => m)
    .map((m, i) => ({ m, i }))
    .sort((a, b) => (a.m.data < b.m.data ? -1 : a.m.data > b.m.data ? 1 : a.i - b.i))
    .map((x) => x.m);
  return { movimenti: out, controlli: {} as Controlli };
}

// ================================================================== Revolut - estratto conto
const MESI_REVOLUT: Record<string, number> = {
  ...MESI, gennaio: 1, febbraio: 2, marzo: 3, aprile: 4, maggio: 5, giugno: 6, luglio: 7, agosto: 8, settembre: 9,
  ottobre: 10, novembre: 11, dicembre: 12, jan: 1, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9,
  oct: 10, dec: 12, january: 1, february: 2, march: 3, april: 4, june: 6, july: 7, august: 8, september: 9,
  october: 10, november: 11, december: 12,
};
const meseRev = (t: string) => MESI_REVOLUT[t.toLowerCase().replace(/\.$/, "")];
const RE_IMPORTO_REV = /^[-+]?[€$£]?\d[\d.,]*,\d\d[€$£]?$|^[-+]?[€$£]?\d[\d,]*\.\d\d[€$£]?$/;
function numRev(t: string): number {
  const s = t.replace(/[€$£\s]/g, "");
  // 1.234,56 (italiano) oppure 1,234.56 (inglese)
  return /,\d\d$/.test(s) ? numIt(s) : parseFloat(s.replace(/,/g, ""));
}

function tipoRevolut(principale: string, dettagli: string[], importo: number): string {
  const d = principale.toLowerCase(), det = dettagli.join(" ").toLowerCase();
  // «Cambiato in USD», «Exchanged to EUR»: soldi spostati tra i conti Revolut di valute diverse
  if (/^\p{L}+ (in|to) [A-Z]{3}$/u.test(principale.trim())) return "Cambio valuta";
  if (/^(to|a|trasferimento a|bonifico a) /.test(d)) return "Bonifico in uscita";
  if (/^(pagamento da parte di|payment from|from|da|trasferimento da|bonifico da) /.test(d)) return "Bonifico ricevuto";
  if (/^(ricarica|top-?up|top up)/.test(d)) return "Ricarica Revolut";
  if (/commission|fee|canone|piano |plan /.test(d)) return "Commissioni"; // anche il rimborso di una commissione
  if (/rimborso|refund/.test(d)) return "Rimborso";
  if (/(^|\s)(carta|card):/.test(det)) return importo < 0 ? "Pagamento con carta" : "Rimborso carta";
  return "Revolut";
}

/** Il conto Revolut di una valuta: «Revolut EUR», «Revolut USD»... */
export const contoRevolut = (valuta: string) => `Revolut ${valuta.toUpperCase()}`;

/**
 * Estratto conto Revolut. Con più valute ogni valuta ha le sue pagine (con il suo riepilogo e le sue transazioni),
 * riconoscibili dall'intestazione «Estratto conto in USD»: ognuna diventa un conto a parte. Gli importi restano
 * nella valuta del conto (campo `valuta`), la conversione in euro si fa all'import.
 */
export function leggiRevolut(pagine: Pagina[], fonte: string) {
  const movimenti: MovimentoLetto[] = [];
  const sezioni = new Map<string, { iniziale: number | null; chiusura: number | null; somma: number; primo: MovimentoLetto | null }>();
  let valuta = "EUR";
  let inConto = true;
  let dataFine: string | null = null;
  for (const pag of pagine) {
    const linee = righe(pag.parole, 2).map((r) => [...r].sort((a, b) => a.x0 - b.x0));
    // valuta della pagina, dall'intestazione in alto
    for (const l of linee) {
      if (l[0].top > 140) break;
      const m = l.map((w) => w.text).join(" ").match(/(?:Estratto conto in|statement in)\s+([A-Z]{3})\b/i);
      if (m) { if (m[1].toUpperCase() !== valuta) inConto = true; valuta = m[1].toUpperCase(); break; }
    }
    const conto = contoRevolut(valuta);
    let sez = sezioni.get(valuta);
    if (!sez) sezioni.set(valuta, (sez = { iniziale: null, chiusura: null, somma: 0, primo: null }));
    // intestazione della tabella: Data | Descrizione | Denaro in uscita | Denaro in entrata | Saldo
    let colDesc = 0, colUsc = 0, colEnt = 0, colSaldo = 0, topTab = Infinity;
    for (const l of linee) {
      const t = l.map((w) => w.text.toLowerCase());
      const iDesc = t.findIndex((x) => x === "descrizione" || x === "description");
      if (iDesc < 0 || !(t.includes("data") || t.includes("date"))) continue;
      const denaro = l.filter((w) => ["denaro", "money"].includes(w.text.toLowerCase()));
      const saldo = l.find((w) => ["saldo", "balance"].includes(w.text.toLowerCase()));
      if (denaro.length < 2 || !saldo) continue;
      colDesc = l[iDesc].x0; colUsc = denaro[0].x0; colEnt = denaro[1].x0; colSaldo = saldo.x1; topTab = l[0].top;
      break;
    }
    // riepilogo (prima pagina di ogni valuta): Conto | saldo iniziale | uscite | entrate | saldo di chiusura
    for (const l of linee) {
      if (sez.iniziale !== null || !/^(conto|account)$/i.test(l[0].text) || l[0].top > topTab) continue;
      const imp = l.filter((w) => RE_IMPORTO_REV.test(w.text));
      if (imp.length >= 4) { sez.iniziale = numRev(imp[0].text); sez.chiusura = numRev(imp[imp.length - 1].text); }
    }
    for (const l of linee) {
      const s = l.map((w) => w.text).join(" ");
      const p = s.match(/(?:al|to)\s+(?:\p{L}+\s+)?(\d{1,2})\s+(\p{L}+)\s+(\d{4})\s*$/u);
      if (/^(transazioni|transactions|account transactions)/i.test(s) && p && meseRev(p[2])) dataFine = iso(+p[3], meseRev(p[2]), +p[1]);
    }
    if (!colUsc) continue;
    const mezzoUE = (colUsc + colEnt) / 2, mezzoES = (colEnt + colSaldo) / 2;
    let corrente: { principale: string; dettagli: string[]; data: string; importo: number; saldo: number | null; ultimoTop: number } | null = null;
    const chiudi = () => {
      if (corrente && inConto) {
        const dettagli = corrente.dettagli.filter((d) => !/^(carta|card|costo|fee|tasso|revolut rate|exchange rate)\b/i.test(d));
        const m = mov({ data: corrente.data, conto, tipo: tipoRevolut(corrente.principale, corrente.dettagli, corrente.importo),
          descrizione: [corrente.principale, ...dettagli].join(" | "), importo: corrente.importo, saldo: corrente.saldo, fonte,
          ...(valuta !== "EUR" ? { valuta } : {}) });
        movimenti.push(m);
        sez!.somma += m.importo;
        sez!.primo ??= m;
      }
      corrente = null;
    };
    for (const l of linee) {
      if (l[0].top <= topTab + 2) continue;
      const s = l.map((w) => w.text).join(" ");
      // titoli di sezione: si leggono solo le transazioni del conto (non quelle stornate o in sospeso)
      if (l[0].x0 < colDesc - 10 && /^(transazioni|transactions|account transactions|reverted|pending|operazioni)/i.test(s)) {
        chiudi();
        inConto = /^(transazioni del conto|account transactions)/i.test(s);
        continue;
      }
      const [g, m, a] = l;
      if (l.length >= 4 && /^\d{1,2}$/.test(g.text) && g.x0 < colDesc - 10 && m && meseRev(m.text) && a && /^\d{4}$/.test(a.text)) {
        chiudi();
        const desc = l.filter((w) => w.x0 >= colDesc - 3 && w.x0 < colUsc - 5).map((w) => w.text).join(" ");
        let usc: number | null = null, ent: number | null = null, saldo: number | null = null;
        for (const w of l) {
          if (w.x0 < colUsc - 15 || !RE_IMPORTO_REV.test(w.text)) continue;
          const v = numRev(w.text);
          if (w.x0 < mezzoUE) usc ??= v; else if (w.x0 < mezzoES) ent ??= v; else saldo ??= v;
        }
        if (usc === null && ent === null) continue;
        corrente = { principale: desc, dettagli: [], data: iso(+a.text, meseRev(m.text), +g.text),
          importo: ent !== null ? Math.abs(ent) : -Math.abs(usc!), saldo, ultimoTop: l[0].top };
        continue;
      }
      if (!corrente) continue;
      const c = corrente as NonNullable<typeof corrente>;
      if (l[0].x0 < colDesc - 3 || l[0].top - c.ultimoTop > 20) { chiudi(); continue; }
      const det = l.filter((w) => w.x0 < colUsc - 5).map((w) => w.text).join(" ");
      if (det) c.dettagli.push(det);
      c.ultimoTop = l[0].top;
    }
    chiudi();
  }
  const elenco = [...sezioni.entries()].filter(([, z]) => z.primo || z.iniziale !== null).map(([v, z]) => {
    const iniziale = z.iniziale ?? (z.primo && z.primo.saldo !== null ? (z.primo.saldo as number) - z.primo.importo : null);
    const ultimo = [...movimenti].reverse().find((m) => m.conto === contoRevolut(v));
    return { conto: contoRevolut(v), valuta: v, saldo_finale_dichiarato: z.chiusura ?? ultimo?.saldo ?? null,
      saldo_finale_calcolato: iniziale === null ? null : r2(iniziale + z.somma) };
  });
  const principale = elenco.find((z) => z.valuta === "EUR") ?? elenco[0];
  const controlli: Controlli = {
    saldo_finale_dichiarato: principale?.saldo_finale_dichiarato ?? null,
    saldo_finale_calcolato: principale?.saldo_finale_calcolato ?? null,
    somma_importi: r2(movimenti.reduce((x, m) => x + m.importo, 0)),
    data_fine: dataFine,
    sezioni: elenco,
  };
  return { movimenti, controlli };
}

// ================================================================== Fineco - estratto conto
const RE_DATA_FINECO = /^(\d\d)\.(\d\d)\.(\d\d|\d{4})$/;
const RE_IMPORTO_FINECO = /^[+-]?\d[\d.]*,\d\d$/;
// etichetta prima della quantità negli acquisti e nelle vendite di titoli (tipo «Qta/Val.nom.»)
const RE_ETICHETTA_QUANTITA = /^\p{L}+\/\p{L}+\.\p{L}+\.?$/u;
const dataFineco = (t: string) => {
  const m = t.match(RE_DATA_FINECO)!;
  return iso(m[3].length === 2 ? 2000 + +m[3] : +m[3], +m[2], +m[1]);
};

/**
 * Estratto conto Fineco: tabella dei movimenti (data operazione, data valuta, uscite, entrate, descrizione) e
 * tabella del dossier titoli (ISIN, nome, quantità...). Gli acquisti e le vendite di titoli riportano il nome dello
 * strumento e la quantità: l'ISIN si prende dal dossier cercando lo stesso nome.
 */
export function leggiFineco(pagine: Pagina[], fonte: string) {
  type Riga = { data: string; uscita: number | null; entrata: number | null; testo: string[]; top: number; pagina: number };
  const righeMov: Riga[] = [];
  const dossier: { isin: string; nome: string }[] = [];
  let saldoIniziale: number | null = null, saldoFinale: number | null = null, dataFine: string | null = null;
  pagine.forEach((pag, ip) => {
    const linee = righe(pag.parole, 2).map((r) => [...r].sort((a, b) => a.x0 - b.x0));
    let hUsc: Parola | null = null, hEnt: Parola | null = null, hDesc: Parola | null = null, topTab = Infinity;
    let corrente: Riga | null = null;
    linee.forEach((l, i) => {
      const testo = l.map((w) => w.text).join(" ");
      const T = testo.toUpperCase();
      // riepilogo: VALUTA | SALDO INIZIALE | SALDO FINALE | ... e sotto «EUR 0,00 +12,34 ...»
      if (T.includes("SALDO INIZIALE") && T.includes("SALDO FINALE") && linee[i + 1]?.[0]?.text === "EUR") {
        const imp = linee[i + 1].filter((w) => RE_IMPORTO_FINECO.test(w.text));
        if (imp.length >= 2 && saldoIniziale === null) { saldoIniziale = numIt(imp[0].text); saldoFinale ??= numIt(imp[1].text); }
      }
      const fine = testo.match(/\bal:?\s+(\d\d\.\d\d\.\d{4})\b/);
      if (fine && /movimenti/i.test(testo)) dataFine = dataFineco(fine[1]);
      // intestazione della tabella dei movimenti
      const usc = l.find((w) => w.text === "USCITE"), ent = l.find((w) => w.text === "ENTRATE"), desc = l.find((w) => w.text === "DESCRIZIONE");
      if (usc && ent && desc) { hUsc = usc; hEnt = ent; hDesc = desc; topTab = l[0].top; corrente = null; return; }
      // dossier titoli: ISIN, nome, quantità...
      if (ISIN_RE.test(l[0].text) && l[0].text.length === 12 && l[0].x0 < 80) {
        const nome: string[] = [];
        for (const w of l.slice(1)) { if (/\d,\d/.test(w.text) && !/\p{L}/u.test(w.text)) break; nome.push(w.text); }
        dossier.push({ isin: l[0].text, nome: nome.join(" ") });
        return;
      }
      if (!hUsc || !hEnt || !hDesc || l[0].top <= topTab) return;
      const U = hUsc as Parola, E = hEnt as Parola, D = hDesc as Parola;
      if (/saldo finale/i.test(testo)) {
        const imp = l.find((w) => RE_IMPORTO_FINECO.test(w.text) && w.x0 < D.x0 - 3);
        if (imp) saldoFinale = numIt(imp.text);
        corrente = null; hUsc = null;
        return;
      }
      if (/saldo iniziale/i.test(testo)) {
        const imp = l.find((w) => RE_IMPORTO_FINECO.test(w.text) && w.x0 < D.x0 - 3);
        if (imp && saldoIniziale === null) saldoIniziale = numIt(imp.text);
        return;
      }
      if (RE_DATA_FINECO.test(l[0].text) && l[0].x0 < U.x0) {
        let uscita: number | null = null, entrata: number | null = null;
        for (const w of l) {
          if (w.x0 >= D.x0 - 3 || !RE_IMPORTO_FINECO.test(w.text)) continue;
          const v = Math.abs(numIt(w.text));
          if (Math.abs(w.x1 - U.x1) <= Math.abs(w.x1 - E.x1)) uscita ??= v; else entrata ??= v;
        }
        if (uscita === null && entrata === null) { corrente = null; return; }
        corrente = { data: dataFineco(l[0].text), uscita, entrata, testo: [l.filter((w) => w.x0 >= D.x0 - 3).map((w) => w.text).join(" ")], top: l[0].top, pagina: ip };
        righeMov.push(corrente);
        return;
      }
      // seconda riga della descrizione
      const c = corrente as Riga | null;
      if (c && l[0].x0 >= D.x0 - 3 && l[0].top - c.top <= 10) { c.testo.push(testo); c.top = l[0].top; }
      else corrente = null;
    });
  });

  const nomi = dossier.map((d) => ({ ...d, chiave: d.nome.toLowerCase().replace(/\s+/g, " ") }));
  const movimenti: MovimentoLetto[] = righeMov.map((r) => {
    const importo = r.entrata !== null ? r.entrata : -(r.uscita as number);
    let descrizione = r.testo.join(" | ");
    const parole = r.testo[0].split(" ");
    const iEt = parole.findIndex((w) => RE_ETICHETTA_QUANTITA.test(w));
    let tipo = "Fineco", isin = "", quote: number | null = null;
    if (iEt > 0 && RE_IMPORTO_QUANTITA.test(parole[iEt + 1] ?? "")) {
      // acquisto o vendita di titoli: nome dello strumento e quantità
      const prima = parole.slice(0, iEt).join(" ").toLowerCase();
      const d = nomi.filter((x) => x.chiave && prima.endsWith(x.chiave)).sort((a, b) => b.chiave.length - a.chiave.length)[0];
      const q = parseFloat(parole[iEt + 1].replace(/\./g, "").replace(",", "."));
      tipo = importo < 0 ? "Acquisto titoli" : "Vendita titoli";
      quote = importo < 0 ? q : -q;
      if (d) { isin = d.isin; descrizione = `${descrizione} | ${d.isin} ${d.nome}`; }
    } else if (/(^|\s)(ord|ben|benef|ordinante|beneficiario|bon):/i.test(descrizione)) tipo = "Bonifico";
    else tipo = parole.slice(0, 2).join(" ").slice(0, 40) || "Fineco";
    return mov({ data: r.data, conto: "Fineco", tipo, descrizione, importo, isin, quote: isin ? quote : null, fonte });
  });
  const somma = movimenti.reduce((x, m) => x + m.importo, 0);
  const controlli: Controlli = {
    saldo_iniziale_dichiarato: saldoIniziale,
    saldo_finale_dichiarato: saldoFinale,
    saldo_finale_calcolato: saldoIniziale === null ? null : r2((saldoIniziale as number) + somma),
    somma_importi: r2(somma),
    data_fine: dataFine,
  };
  return { movimenti, controlli };
}
const RE_IMPORTO_QUANTITA = /^\d[\d.]*(,\d+)?$/;

// ================================================================== UniCredit - estratto conto
/**
 * Estratto conto UniCredit: colonne Data | Valuta | Descrizione | Uscite | Entrate. La descrizione occupa più righe
 * e la riga con date e importo sta a metà del suo blocco (righe sopra e sotto): le righe della descrizione si
 * raggruppano in blocchi separati da uno spazio più largo e ogni data prende il blocco che la contiene.
 */
export function leggiUnicredit(pagine: Pagina[], fonte: string) {
  const movimenti: MovimentoLetto[] = [];
  let saldoIniziale: number | null = null, saldoFinale: number | null = null, dataFine: string | null = null;
  let finito = false;
  const segno = (testo: string, v: number) => (/DEBITO/i.test(testo) ? -Math.abs(v) : v);
  for (const pag of pagine) {
    if (finito) break;
    const linee = righe(pag.parole, 2).map((r) => [...r].sort((a, b) => a.x0 - b.x0));
    // riepilogo: «Saldo iniziale al ... Uscite Entrate Saldo finale al ...» e sotto i quattro importi
    linee.forEach((l, i) => {
      const t = l.map((w) => w.text).join(" ");
      if (saldoIniziale === null && /saldo iniziale al/i.test(t) && /saldo finale al/i.test(t)) {
        const imp = (linee[i + 1] ?? []).filter((w) => RE_IMPORTO_FINECO.test(w.text));
        if (imp.length >= 2) { saldoIniziale = numIt(imp[0].text); saldoFinale = numIt(imp[imp.length - 1].text); }
        const d = t.match(/saldo finale al\s+(\d\d\.\d\d\.\d{4})/i);
        if (d) dataFine = dataFineco(d[1]);
      }
    });
    // intestazione della tabella dei movimenti
    const hIdx = linee.findIndex((l) => ["Data", "Valuta", "Descrizione", "Uscite", "Entrate"].every((x) => l.some((w) => w.text === x)));
    if (hIdx < 0) continue;
    const h = linee[hIdx];
    const D = h.find((w) => w.text === "Descrizione")!, U = h.find((w) => w.text === "Uscite")!, E = h.find((w) => w.text === "Entrate")!;
    const limiteImporti = U.x0 - 35;
    type Data = { top: number; data: string; importo: number; testo: string[][] };
    const date: Data[] = [];
    const descr: { top: number; testo: string }[] = [];
    for (const l of linee.slice(hIdx + 1)) {
      const t = l.map((w) => w.text).join(" ");
      const testo = l.filter((w) => w.x0 >= D.x0 - 3 && w.x0 < limiteImporti).map((w) => w.text).join(" ");
      const importi = l.filter((w) => w.x0 >= limiteImporti && RE_IMPORTO_FINECO.test(w.text));
      const conData = RE_DATA_FINECO.test(l[0].text) && l[0].x0 < D.x0 - 3;
      if (conData && /SALDO\s+(INIZIALE|FINALE)/i.test(t)) {
        const v = importi.length ? segno(t, numIt(importi[importi.length - 1].text)) : null;
        if (/INIZIALE/i.test(t)) saldoIniziale ??= v; else { if (v !== null) saldoFinale = v; finito = true; break; }
        continue;
      }
      if (conData && importi.length) {
        const w = importi[importi.length - 1];
        const v = Math.abs(numIt(w.text));
        const uscita = Math.abs(w.x1 - U.x1) <= Math.abs(w.x1 - E.x1);
        date.push({ top: l[0].top, data: dataFineco(l[0].text), importo: uscita ? -v : v, testo: [] });
      }
      if (testo) descr.push({ top: l[0].top, testo });
    }
    // blocchi di righe della descrizione
    const blocchi: { top: number; testo: string }[][] = [];
    for (const r of descr) {
      const ult = blocchi[blocchi.length - 1];
      if (ult && r.top - ult[ult.length - 1].top <= 10) ult.push(r); else blocchi.push([r]);
    }
    for (const b of blocchi) {
      const dentro = date.filter((d) => d.top >= b[0].top - 2 && d.top <= b[b.length - 1].top + 2);
      if (!dentro.length) continue; // testo fuori dalla tabella (note, piè di pagina)
      for (const r of b) {
        const d = dentro.reduce((a, x) => (Math.abs(x.top - r.top) < Math.abs(a.top - r.top) ? x : a), dentro[0]);
        d.testo.push([r.testo]);
      }
    }
    for (const d of date) {
      const righeD = d.testo.map((x) => x[0]);
      movimenti.push(mov({ data: d.data, conto: "UniCredit", tipo: (righeD[0] ?? "UniCredit").slice(0, 40),
        descrizione: righeD.join(" | ") || "UniCredit", importo: d.importo, fonte }));
    }
  }
  const somma = movimenti.reduce((x, m) => x + m.importo, 0);
  const controlli: Controlli = {
    saldo_iniziale_dichiarato: saldoIniziale,
    saldo_finale_dichiarato: saldoFinale,
    saldo_finale_calcolato: saldoIniziale === null ? null : r2((saldoIniziale as number) + somma),
    somma_importi: r2(somma),
    data_fine: dataFine,
  };
  return { movimenti, controlli };
}
