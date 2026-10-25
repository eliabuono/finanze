/**
 * Intermediario per i prezzi degli ETF (Cloudflare Worker, piano gratuito).
 * Il browser non può chiamare direttamente Yahoo Finance e justETF (CORS): l'app chiama questo worker,
 * che inoltra la richiesta SOLO a quei due siti e restituisce la risposta.
 *
 * Uso dall'app: https://<nome>.<account>.workers.dev/?url=<indirizzo codificato>
 * Facoltativo: nella variabile ORIGINI_AMMESSE (Settings > Variables) gli indirizzi dell'app separati da virgola,
 * per esempio https://tuonome.github.io — così il worker risponde solo alla tua app.
 */
const HOST_AMMESSI = ["query1.finance.yahoo.com", "query2.finance.yahoo.com", "www.justetf.com"];

export default {
  async fetch(request, env) {
    const origine = request.headers.get("Origin") || "";
    const ammesse = (env.ORIGINI_AMMESSE || "").split(",").map((s) => s.trim()).filter(Boolean);
    const cors = {
      "Access-Control-Allow-Origin": ammesse.length ? (ammesse.includes(origine) ? origine : ammesse[0]) : "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Accept",
      "Vary": "Origin",
    };
    if (request.method === "OPTIONS") return new Response(null, { headers: cors });
    if (request.method !== "GET") return new Response("Metodo non ammesso", { status: 405, headers: cors });
    if (ammesse.length && origine && !ammesse.includes(origine)) return new Response("Origine non ammessa", { status: 403, headers: cors });

    const destinazione = new URL(request.url).searchParams.get("url");
    let u;
    try { u = new URL(destinazione); } catch { return new Response("Parametro url mancante", { status: 400, headers: cors }); }
    if (u.protocol !== "https:" || !HOST_AMMESSI.includes(u.hostname)) return new Response("Sito non ammesso", { status: 403, headers: cors });

    const r = await fetch(u.toString(), {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36", "Accept": "application/json" },
      cf: { cacheTtl: 600, cacheEverything: true },
    });
    const h = new Headers(cors);
    h.set("Content-Type", r.headers.get("Content-Type") || "application/json");
    h.set("Cache-Control", "public, max-age=600");
    return new Response(r.body, { status: r.status, headers: h });
  },
};
