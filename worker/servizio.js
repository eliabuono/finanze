/**
 * Servizio dell'app Finanze (Cloudflare Worker, piano gratuito). Fa due cose:
 *
 * 1. Prezzi degli ETF: il browser non può chiamare direttamente Yahoo Finance e justETF (CORS).
 *    GET  /?url=<indirizzo>       inoltra la richiesta SOLO a quei siti.
 * 2. Accesso a Google Drive: Google richiede una chiave segreta per dare un accesso che non scade,
 *    e la chiave non può stare nell'app (che è pubblica). La custodisce qui il worker.
 *    POST /google/token   {code, code_verifier, redirect_uri}  -> scambia il codice con Google
 *    POST /google/refresh {refresh_token}                      -> rinnova l'accesso
 *    Il worker non vede né conserva i tuoi dati: passa solo i "biglietti" di accesso.
 * 3. Campioni anonimi di banche non supportate (pulsante "Invia" nella pagina Importa):
 *    POST /campioni  -> salva il file nel repository GitHub privato e/o lo manda per email.
 *
 * Variabili da impostare in Settings > Variables and Secrets:
 *   GOOGLE_CLIENT_ID      (testo)   l'ID client di Google
 *   GOOGLE_CLIENT_SECRET  (secret)  la chiave segreta del client di Google
 *   ORIGINI_AMMESSE       (testo)   es. https://eliabuono.github.io  — così risponde solo alla tua app
 * Per i campioni (facoltative, basta una delle due strade):
 *   GITHUB_TOKEN   (secret)  token "fine-grained" con permesso Contents: Read and write solo sul repository dei campioni
 *   GITHUB_REPO    (testo)   es. eliabuono/finanze-campioni (repository PRIVATO)
 *   RESEND_API_KEY (secret)  chiave di resend.com, per ricevere una mail a ogni campione (con il file allegato)
 *   EMAIL_AVVISO   (testo)   la tua email (la stessa dell'account Resend)
 */
const HOST_AMMESSI = ["query1.finance.yahoo.com", "query2.finance.yahoo.com", "www.justetf.com"];

export default {
  async fetch(request, env) {
    const origine = request.headers.get("Origin") || "";
    const ammesse = (env.ORIGINI_AMMESSE || "").split(",").map((s) => s.trim().replace(/\/+$/, "")).filter(Boolean);
    const cors = {
      "Access-Control-Allow-Origin": ammesse.length ? (ammesse.includes(origine) ? origine : ammesse[0]) : "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Accept, Content-Type",
      "Vary": "Origin",
    };
    const risposta = (corpo, stato = 200, tipo = "application/json") =>
      new Response(typeof corpo === "string" ? corpo : JSON.stringify(corpo), { status: stato, headers: { ...cors, "Content-Type": tipo } });
    if (request.method === "OPTIONS") return new Response(null, { headers: cors });
    if (ammesse.length && origine && !ammesse.includes(origine)) return risposta({ error: "origine non ammessa" }, 403);

    const u = new URL(request.url);

    // ---------------------------------------------------------------- Google
    if (u.pathname === "/google/token" || u.pathname === "/google/refresh") {
      if (request.method !== "POST") return risposta({ error: "metodo non ammesso" }, 405);
      if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) return risposta({ error: "servizio non configurato", error_description: "Mancano GOOGLE_CLIENT_ID o GOOGLE_CLIENT_SECRET nel worker." }, 500);
      let dati;
      try { dati = await request.json(); } catch { return risposta({ error: "richiesta non valida" }, 400); }
      const corpo = new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET });
      if (u.pathname === "/google/token") {
        if (!dati.code || !dati.redirect_uri) return risposta({ error: "richiesta non valida" }, 400);
        corpo.set("grant_type", "authorization_code");
        corpo.set("code", dati.code);
        corpo.set("redirect_uri", dati.redirect_uri);
        if (dati.code_verifier) corpo.set("code_verifier", dati.code_verifier);
      } else {
        if (!dati.refresh_token) return risposta({ error: "richiesta non valida" }, 400);
        corpo.set("grant_type", "refresh_token");
        corpo.set("refresh_token", dati.refresh_token);
      }
      const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST", body: corpo,
        headers: { "Content-Type": "application/x-www-form-urlencoded" } });
      return risposta(await r.text(), r.status);
    }

    // ---------------------------------------------------------------- campioni anonimi
    if (u.pathname === "/campioni") {
      if (request.method !== "POST") return risposta({ error: "metodo non ammesso" }, 405);
      if (Number(request.headers.get("Content-Length") || 0) > 7_000_000) return risposta({ error: "file troppo grande" }, 413);
      const github = env.GITHUB_TOKEN && env.GITHUB_REPO, email = env.RESEND_API_KEY && env.EMAIL_AVVISO;
      if (!github && !email) return risposta({ error: "invio non configurato", error_description: "Nel servizio mancano GITHUB_TOKEN/GITHUB_REPO o RESEND_API_KEY/EMAIL_AVVISO." }, 500);
      let c;
      try { c = await request.json(); } catch { return risposta({ error: "richiesta non valida" }, 400); }
      const testo = (v, n) => String(v ?? "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, n);
      const banca = testo(c.banca, 60), documento = testo(c.documento, 80), nota = testo(c.nota, 500);
      const dati = String(c.dati ?? "");
      if (!banca || !dati || dati.length > 6_500_000 || !/^[A-Za-z0-9+/=]+$/.test(dati)) return risposta({ error: "campione non valido" }, 400);
      const ora = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 19);
      const slug = banca.toLowerCase().normalize("NFD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "banca";
      const nome = `${ora}_${slug}.json${c.gzip ? ".gz" : ""}`;
      const descr = `${banca} — ${documento || "documento"} (${Number(c.pagine) || "?"} pagine, app ${testo(c.versione_app, 20)})` + (nota ? `\nNota: ${nota}` : "");
      const esiti = [];
      let link = "";
      if (github) {
        const r = await fetch(`https://api.github.com/repos/${env.GITHUB_REPO}/contents/campioni/${nome}`, {
          method: "PUT",
          headers: { Authorization: `Bearer ${env.GITHUB_TOKEN}`, Accept: "application/vnd.github+json", "User-Agent": "finanze-servizio",
            "X-GitHub-Api-Version": "2022-11-28", "Content-Type": "application/json" },
          body: JSON.stringify({ message: `Campione: ${descr}`, content: dati }),
        });
        if (r.ok) { esiti.push("github"); link = (await r.json())?.content?.html_url || ""; }
        else esiti.push(`github errore ${r.status}`);
      }
      if (email) {
        const r = await fetch("https://api.resend.com/emails", {
          method: "POST", headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            from: env.EMAIL_MITTENTE || "Finanze <onboarding@resend.dev>", to: [env.EMAIL_AVVISO],
            subject: `Finanze: nuovo campione ${banca}`,
            text: `È arrivato un estratto conto anonimo da aggiungere all'app.\n\n${descr}\n${link ? `\nSu GitHub: ${link}\n` : ""}\nIl file è allegato.`,
            attachments: [{ filename: nome, content: dati }],
          }),
        });
        esiti.push(r.ok ? "email" : `email errore ${r.status}`);
      }
      const ok = esiti.includes("github") || esiti.includes("email");
      return risposta(ok ? { ok: true, esiti } : { error: "invio non riuscito", error_description: esiti.join(", ") }, ok ? 200 : 502);
    }

    // ---------------------------------------------------------------- prezzi
    if (request.method !== "GET") return risposta({ error: "metodo non ammesso" }, 405);
    let dest;
    try { dest = new URL(u.searchParams.get("url")); } catch { return risposta("Servizio Finanze attivo.", 200, "text/plain; charset=utf-8"); }
    if (dest.protocol !== "https:" || !HOST_AMMESSI.includes(dest.hostname)) return risposta({ error: "sito non ammesso" }, 403);
    const r = await fetch(dest.toString(), {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36", "Accept": "application/json" },
      cf: { cacheTtl: 600, cacheEverything: true },
    });
    const h = new Headers(cors);
    h.set("Content-Type", r.headers.get("Content-Type") || "application/json");
    h.set("Cache-Control", "public, max-age=600");
    return new Response(r.body, { status: r.status, headers: h });
  },
};
