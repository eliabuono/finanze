/** Azioni che toccano la rete o più parti dello stato. */
import { adesso } from "../core/date";
import { aggiornaPrezzi, creaFetch, unisciCache } from "../core/prezzi";
import { SERVIZIO } from "./ambiente";
import { invalidaCalcoli, modifica, salvaMetaPrezzi, stato } from "./stato";

export const nativa = () => !!(window as any).Capacitor?.isNativePlatform?.();
/** Indirizzo del servizio (Cloudflare Worker): quello scritto in Impostazioni oppure quello pubblicato con l'app. */
export const indirizzoServizio = () => (stato.cfg.proxy_prezzi || SERVIZIO).trim();
export const proxyPrezzi = indirizzoServizio;
export const prezziDisponibili = () => nativa() || !!proxyPrezzi();

let inCorso: Promise<void> | null = null;
export function aggiornaPrezziOra(): Promise<void> {
  inCorso ??= (async () => {
    const t = stato.reg.mov.filter((m) => m.isin && m.quote !== null);
    if (!t.length) return;
    const inizio = t.reduce((a, m) => (m.data < a ? m.data : a), t[0].data);
    const es = await aggiornaPrezzi(stato.cfg.strumenti, inizio, creaFetch(nativa() ? "" : proxyPrezzi()));
    stato.erroriPrezzi = es.errori;
    stato.ticker = { ...stato.ticker, ...es.ticker };
    if (Object.keys(es.nuove).length) {
      stato.prezziAggiornati = adesso();
      modifica(["prezzi"], () => { stato.prezzi = unisciCache(stato.prezzi, es.nuove); });
    } else invalidaCalcoli();
    await salvaMetaPrezzi();
  })().finally(() => { inCorso = null; });
  return inCorso;
}

/** Prezzi più vecchi di un'ora? */
export function prezziVecchi(): boolean {
  if (!stato.prezziAggiornati) return true;
  const t = Date.parse(stato.prezziAggiornati.replace(" ", "T"));
  return !Number.isFinite(t) || Date.now() - t > 3600_000;
}
