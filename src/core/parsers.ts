/**
 * Lettori degli estratti conto (porting fedele della versione Python).
 *  - Trade Republic: estratto conto (conto corrente + acquisti/vendite titoli)
 *  - Intesa Sanpaolo: estratto conto trimestrale e "Lista movimenti"
 *  - Satispay: "Lista Transazioni"
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
    .filter((m) => (m.contabilizzato || "Si").startsWith("Si"))
    .map(({ contabilizzato, ...m }) => m)
    .map((m, i) => ({ m, i }))
    .sort((a, b) => (a.m.data < b.m.data ? -1 : a.m.data > b.m.data ? 1 : a.i - b.i))
    .map((x) => x.m);
  return { movimenti: out, controlli: {} as Controlli };
}
