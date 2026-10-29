/**
 * Prezzi storici in EUR da Yahoo Finance, con justETF come riserva (porting di prezzi.py).
 *
 * Dal browser i siti di Yahoo e justETF non si possono chiamare direttamente (CORS): serve un piccolo
 * intermediario (il Cloudflare Worker in /worker, gratuito) il cui indirizzo si scrive in Impostazioni.
 * Nell'app installata (Android/iPhone, con CapacitorHttp attivo) le richieste partono dal telefono e
 * l'intermediario non serve. Senza prezzi si usa il prezzo implicito degli acquisti.
 */
import { aggiungiGiorni, oggi } from "./date";
import type { CachePrezzi } from "./formato";
import type { Strumento } from "./tipi";

const BORSE_PREFERITE = ["GER", "MIL", "FRA", "AMS", "PAR", "STU", "MUN", "BER", "LSE"];

export type Fetch = (url: string) => Promise<any>;

export function creaFetch(proxy: string): Fetch {
  return async (url: string) => {
    const u = proxy ? proxy + (proxy.includes("?") ? "&" : "?") + "url=" + encodeURIComponent(url) : url;
    const r = await fetch(u, { headers: { Accept: "application/json" } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  };
}

async function risolviTicker(get: Fetch, isin: string, ticker: string): Promise<string | null> {
  if (ticker) return ticker;
  const j = await get(`https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(isin)}&quotesCount=20&newsCount=0`);
  const q: any[] = j?.quotes ?? [];
  if (!q.length) return null;
  const rank = (e: string) => { const i = BORSE_PREFERITE.indexOf(e); return i < 0 ? 99 : i; };
  q.sort((a, b) => rank(a.exchange) - rank(b.exchange));
  return q[0].symbol ?? null;
}

export async function chiusure(get: Fetch, simbolo: string, inizio: string): Promise<{ s: Record<string, number>; valuta: string }> {
  const p1 = Math.floor(Date.parse(inizio + "T00:00:00Z") / 1000);
  const p2 = Math.floor(Date.now() / 1000) + 86400;
  const j = await get(`https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(simbolo)}?period1=${p1}&period2=${p2}&interval=1d&events=history`);
  const r = j?.chart?.result?.[0];
  if (!r?.timestamp?.length) throw new Error(`nessun prezzo per ${simbolo}`);
  const off = r.meta?.gmtoffset ?? 0;
  const close: (number | null)[] = r.indicators?.quote?.[0]?.close ?? [];
  const s: Record<string, number> = {};
  r.timestamp.forEach((t: number, i: number) => {
    const v = close[i];
    if (v !== null && v !== undefined && Number.isFinite(v)) s[new Date((t + off) * 1000).toISOString().slice(0, 10)] = v;
  });
  return { s, valuta: r.meta?.currency ?? "EUR" };
}

async function scaricaEur(get: Fetch, simbolo: string, inizio: string): Promise<Record<string, number>> {
  let { s, valuta } = await chiusure(get, simbolo, inizio);
  if (valuta === "GBp") { s = Object.fromEntries(Object.entries(s).map(([d, v]) => [d, v / 100])); valuta = "GBP"; }
  if (valuta && valuta !== "EUR") {
    const fx = (await chiusure(get, `EUR${valuta}=X`, inizio)).s;
    const dfx = Object.keys(fx).sort();
    const out: Record<string, number> = {};
    let j = 0, ult = NaN;
    for (const d of Object.keys(s).sort()) {
      while (j < dfx.length && dfx[j] <= d) ult = fx[dfx[j++]];
      if (Number.isFinite(ult)) out[d] = s[d] / ult;
    }
    return out;
  }
  return s;
}

async function scaricaJustetf(get: Fetch, isin: string, inizio: string): Promise<Record<string, number>> {
  const url = `https://www.justetf.com/api/etfs/${isin}/performance-chart?locale=it&currency=EUR&valuesType=MARKET_VALUE` +
    `&reduceData=false&includeDividends=false&features=DIVIDENDS&dateFrom=${inizio}&dateTo=${oggi()}`;
  const j = await get(url);
  const punti: any[] = j?.series ?? [];
  if (!punti.length) throw new Error("justETF non ha dati per questo ISIN");
  const s: Record<string, number> = {};
  for (const p of punti) if (p?.value) s[String(p.date).slice(0, 10)] = Number(p.value.raw);
  const q = j.latestQuote, dq = j.latestQuoteDate;
  const raw = q && typeof q === "object" ? q.raw : q;
  if (raw && dq) s[String(dq).slice(0, 10)] = Number(raw);
  return s;
}

export interface EsitoPrezzi { nuove: CachePrezzi; ticker: Record<string, string>; errori: Record<string, string>; }

/** Scarica i prezzi (Yahoo, poi justETF). Nel ticker si può scrivere "justetf" per usare direttamente justETF. */
export async function aggiornaPrezzi(strumenti: Record<string, Strumento>, inizio: string, get: Fetch): Promise<EsitoPrezzi> {
  const out: EsitoPrezzi = { nuove: {}, ticker: {}, errori: {} };
  const dal = aggiungiGiorni(inizio, -10);
  await Promise.all(Object.entries(strumenti).map(async ([isin, info]) => {
    const tick = (info.ticker ?? "").trim();
    let errY: string | null = null;
    if (tick.toLowerCase() !== "justetf") {
      try {
        const sim = await risolviTicker(get, isin, tick);
        if (!sim) errY = "non trovato su Yahoo";
        else {
          try {
            out.nuove[isin] = await scaricaEur(get, sim, dal);
            out.ticker[isin] = sim;
            return;
          } catch (e: any) { errY = `${sim}: ${e?.message ?? e}`; }
        }
      } catch (e: any) { errY = String(e?.message ?? e); }
    }
    try {
      out.nuove[isin] = await scaricaJustetf(get, isin, dal);
      out.ticker[isin] = "justETF";
    } catch (e: any) {
      out.errori[isin] = (errY ? `Yahoo: ${errY}; ` : "") + `justETF: ${e?.message ?? e}`;
    }
  }));
  return out;
}

export function unisciCache(vecchia: CachePrezzi, nuove: CachePrezzi): CachePrezzi {
  const c: CachePrezzi = { ...vecchia };
  for (const [isin, s] of Object.entries(nuove)) c[isin] = { ...(c[isin] ?? {}), ...s };
  return c;
}
