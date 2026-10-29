/** Scarica i cambi delle valute estere (Yahoo Finance, tramite il servizio come per i prezzi degli ETF). */
import { aggiungiGiorni } from "../core/date";
import type { Cambi } from "../core/cambi";
import { chiusure, creaFetch } from "../core/prezzi";
import { nativa, proxyPrezzi } from "./azioni";

const memoria: Cambi = {};

export async function scaricaCambi(valute: string[], dal: string): Promise<Cambi> {
  const out: Cambi = {};
  if (!valute.length) return out;
  const get = creaFetch(nativa() ? "" : proxyPrezzi());
  const inizio = aggiungiGiorni(dal, -10);
  await Promise.all(valute.map(async (v) => {
    const giaQui = memoria[v];
    if (giaQui && Object.keys(giaQui).sort()[0] <= inizio) { out[v] = giaQui; return; }
    try {
      const { s } = await chiusure(get, `EUR${v}=X`, inizio);
      memoria[v] = out[v] = s;
    } catch { /* senza cambio i movimenti in quella valuta non si importano (e lo si dice) */ }
  }));
  return out;
}
