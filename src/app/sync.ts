/**
 * Sincronizzazione con Google Drive.
 *
 * I file stanno nella cartella "Finanze" del tuo Google Drive: movimenti.txt, saldi_noti.txt, importati.txt,
 * config.json, prezzi_cache.csv — gli stessi della versione per PC. L'app vede solo i file che ha creato lei
 * (permesso "drive.file"), non il resto del Drive.
 * Ogni dispositivo tiene una copia locale e lavora anche senza rete; quando può, scarica le modifiche fatte
 * altrove e carica le proprie. Se due dispositivi hanno cambiato gli stessi dati, le modifiche si uniscono.
 *
 * L'accesso si fa una volta sola: lo scambio del codice con Google passa dal "servizio" (Cloudflare Worker,
 * worker/servizio.js) che custodisce la chiave segreta dell'app; poi l'accesso si rinnova da solo.
 */
import { useSyncExternalStore } from "react";
import { normalizza } from "../core/config";
import * as F from "../core/formato";
import { Registro } from "../core/registro";
import { unisciCache } from "../core/prezzi";
import { GOOGLE_CLIENT_ID } from "./ambiente";
import { indirizzoServizio } from "./azioni";
import * as archivio from "./archivio";
import { allaModifica, FILE, salvaSubito, sostituisci, stato, testoDi, TUTTE, type Parte } from "./stato";

const AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
const SCOPE = "openid email https://www.googleapis.com/auth/drive.file";
const DRIVE = "https://www.googleapis.com/drive/v3";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3";
const CARTELLA = "Finanze";

interface Token { access: string; scade: number; refresh?: string; utente?: string; scope?: string; }
const SENZA_PERMESSO = "Nella pagina di Google non è stata spuntata la casella per Google Drive («Visualizzare, modificare, creare ed eliminare solo i file di Google Drive che utilizzi con questa app»). Premi «Collega Google Drive» e spuntala.";
interface Meta { etag: Partial<Record<Parte, string>>; inSospeso: Parte[]; eliminati: string[]; ultimo?: string; cartella?: string; }

export type StatoSync = "non collegato" | "collegato" | "sincronizzo" | "errore" | "scaduto" | "senza rete";
const info: { stato: StatoSync; errore: string; ultimo: string; utente: string; v: number } =
  { stato: "non collegato", errore: "", ultimo: "", utente: "", v: 0 };
const asc = new Set<() => void>();
function aggiornaInfo(p: Partial<typeof info>) { Object.assign(info, p); info.v++; asc.forEach((f) => f()); }
export function useSync() {
  useSyncExternalStore((f) => { asc.add(f); return () => asc.delete(f); }, () => info.v);
  return info;
}

export const clientId = () => { try { return localStorage.getItem("finanze:google_client_id") || GOOGLE_CLIENT_ID; } catch { return GOOGLE_CLIENT_ID; } };
export function impostaClientId(id: string) { try { localStorage.setItem("finanze:google_client_id", id.trim()); } catch { /* */ } }
export const configurato = () => !!clientId() && !!indirizzoServizio();
const redirectUri = () => location.origin + location.pathname;

let meta: Meta = { etag: {}, inSospeso: [], eliminati: [] };
const generazione: Partial<Record<Parte, number>> = {};
const BASE_MOV = "base:movimenti.txt"; // ultima versione dei movimenti sincronizzata, per unire le modifiche
let token: Token | null = null;
const salvaMeta = () => archivio.scrivi("meta:cloud", meta);
const salvaToken = () => archivio.scrivi("meta:cloud_token", token);

// ------------------------------------------------------------------ accesso
const b64url = (b: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const casuale = (n = 48) => b64url(crypto.getRandomValues(new Uint8Array(n)));

export async function accedi() {
  if (!clientId()) throw new Error("Manca l'ID client di Google (vedi LEGGIMI).");
  if (!indirizzoServizio()) throw new Error("Manca l'indirizzo del servizio (Cloudflare Worker, vedi LEGGIMI).");
  const verifier = casuale();
  const challenge = b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  const st = casuale(16);
  localStorage.setItem("finanze:pkce", JSON.stringify({ verifier, st }));
  const q = new URLSearchParams({ client_id: clientId(), response_type: "code", redirect_uri: redirectUri(), scope: SCOPE,
    access_type: "offline", prompt: "consent", include_granted_scopes: "true",
    code_challenge: challenge, code_challenge_method: "S256", state: st });
  await salvaSubito(); // prima di lasciare la pagina
  location.assign(`${AUTH}?${q}`);
}

async function chiediToken(percorso: "token" | "refresh", corpo: Record<string, string>): Promise<Token> {
  const r = await fetch(indirizzoServizio().replace(/\/+$/, "") + "/google/" + percorso, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw Object.assign(new Error(j.error_description || j.error || `servizio: errore ${r.status}`), { codice: j.error });
  return { access: j.access_token, scade: Date.now() + ((j.expires_in ?? 3600) - 60) * 1000, refresh: j.refresh_token ?? token?.refresh,
    utente: token?.utente, scope: j.scope ?? token?.scope };
}

/** Da chiamare all'avvio: completa l'accesso se si sta tornando dalla pagina di Google. */
async function ritornoDaGoogle(): Promise<boolean> {
  const u = new URL(location.href);
  const code = u.searchParams.get("code"), err = u.searchParams.get("error");
  if (!code && !err) return false;
  const salvato = JSON.parse(localStorage.getItem("finanze:pkce") || "null");
  localStorage.removeItem("finanze:pkce");
  history.replaceState(null, "", redirectUri() + location.hash);
  if (err) {
    aggiornaInfo({ stato: "errore", errore: err === "access_denied" ? "Accesso a Google Drive annullato." : err });
    return true;
  }
  if (!salvato || salvato.st !== u.searchParams.get("state")) { aggiornaInfo({ stato: "errore", errore: "Risposta di Google non valida, riprova." }); return true; }
  token = await chiediToken("token", { code: code!, redirect_uri: redirectUri(), code_verifier: salvato.verifier });
  if (token.scope && !token.scope.includes("drive.file")) {
    // l'utente ha dato l'accesso ma ha lasciato vuota la casella di Google Drive
    token = null;
    await archivio.cancella("meta:cloud_token");
    aggiornaInfo({ stato: "errore", errore: SENZA_PERMESSO });
    return true;
  }
  try {
    const me = await (await fetch("https://openidconnect.googleapis.com/v1/userinfo", { headers: { Authorization: `Bearer ${token.access}` } })).json();
    token.utente = me.email || me.name || "";
  } catch { /* facoltativo */ }
  meta.cartella = undefined; // con un account diverso la cartella è un'altra
  await salvaToken();
  return true;
}

async function tokenValido(): Promise<string> {
  if (token && token.scade > Date.now()) return token.access;
  if (!token?.refresh) throw Object.assign(new Error("accesso scaduto"), { codice: "scaduto" });
  try {
    token = await chiediToken("refresh", { refresh_token: token.refresh });
    await salvaToken();
    return token.access;
  } catch (e: any) {
    if (e.codice === "invalid_grant") throw Object.assign(new Error("accesso scaduto"), { codice: "scaduto" });
    throw e;
  }
}

export async function esci() {
  token = null;
  await archivio.cancella("meta:cloud_token");
  meta.etag = {};
  meta.cartella = undefined;
  await salvaMeta();
  aggiornaInfo({ stato: "non collegato", utente: "", errore: "" });
}

// ------------------------------------------------------------------ Google Drive
async function api(url: string, init: RequestInit = {}, ritenta = true): Promise<Response> {
  const t = await tokenValido();
  const r = await fetch(url, { ...init, headers: { Authorization: `Bearer ${t}`, ...(init.headers ?? {}) } });
  if (r.status === 401 && ritenta && token) { token.scade = 0; return api(url, init, false); }
  if (r.status === 401) throw Object.assign(new Error("accesso scaduto"), { codice: "scaduto" });
  return r;
}

async function json(r: Response, cosa: string) {
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    const motivo = String(j?.error?.message ?? r.status);
    if (r.status === 403 && /insufficient.*scope/i.test(motivo)) throw Object.assign(new Error(SENZA_PERMESSO), { codice: "permesso" });
    throw new Error(`Google Drive: ${cosa} (${motivo})`);
  }
  return r.json();
}

const q = (s: string) => encodeURIComponent(s);

async function cartella(): Promise<string> {
  if (meta.cartella) return meta.cartella;
  const cerca = `name='${CARTELLA}' and mimeType='application/vnd.google-apps.folder' and 'root' in parents and trashed=false`;
  const j = await json(await api(`${DRIVE}/files?q=${q(cerca)}&fields=files(id)&orderBy=createdTime&spaces=drive`), "cartella non leggibile");
  if (j.files?.length) meta.cartella = j.files[0].id;
  else {
    const c = await json(await api(`${DRIVE}/files?fields=id`, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: CARTELLA, mimeType: "application/vnd.google-apps.folder" }) }), "cartella non creata");
    meta.cartella = c.id;
  }
  await salvaMeta();
  return meta.cartella!;
}

let ids: Record<string, string> = {};

async function elencoRemoto(): Promise<Record<string, { eTag: string }>> {
  const dir = await cartella();
  const r = await api(`${DRIVE}/files?q=${q(`'${dir}' in parents and trashed=false`)}&fields=files(id,name,version)&orderBy=modifiedTime desc&pageSize=100&spaces=drive`);
  if (r.status === 404) { meta.cartella = undefined; return elencoRemoto(); } // cartella cancellata: se ne crea un'altra
  const j = await json(r, "elenco dei file non leggibile");
  const out: Record<string, { eTag: string }> = {};
  ids = {};
  for (const f of j.files ?? []) if (!out[f.name]) { out[f.name] = { eTag: String(f.version) }; ids[f.name] = f.id; }
  return out;
}

async function scarica(nome: string): Promise<{ testo: string; eTag: string }> {
  const id = ids[nome];
  const m = await json(await api(`${DRIVE}/files/${id}?fields=version`), `${nome} non leggibile`);
  const c = await api(`${DRIVE}/files/${id}?alt=media`);
  if (!c.ok) throw new Error(`Google Drive: ${nome} non leggibile (${c.status})`);
  return { testo: await c.text(), eTag: String(m.version) };
}

async function carica(nome: string, testo: string, eTag?: string): Promise<string | null> {
  const id = ids[nome];
  if (id) {
    if (eTag) {
      const m = await json(await api(`${DRIVE}/files/${id}?fields=version`), `${nome} non leggibile`);
      if (String(m.version) !== eTag) return null; // cambiato altrove nel frattempo
    }
    const r = await json(await api(`${UPLOAD}/files/${id}?uploadType=media&fields=version`, {
      method: "PATCH", body: new Blob([testo], { type: "text/plain;charset=utf-8" }), headers: { "Content-Type": "text/plain; charset=utf-8" } }), `${nome} non salvato`);
    return String(r.version);
  }
  const confine = "finanze" + casuale(12);
  const corpo = new Blob([
    `--${confine}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`,
    JSON.stringify({ name: nome, parents: [await cartella()], mimeType: "text/plain" }),
    `\r\n--${confine}\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n`, testo, `\r\n--${confine}--`,
  ]);
  const r = await json(await api(`${UPLOAD}/files?uploadType=multipart&fields=id,version`, {
    method: "POST", body: corpo, headers: { "Content-Type": `multipart/related; boundary=${confine}` } }), `${nome} non salvato`);
  ids[nome] = r.id;
  return String(r.version);
}

// ------------------------------------------------------------------ unione dei dati
async function unisci(p: Parte, remoto: string): Promise<string> {
  if (p === "mov") {
    // unione a tre vie con l'ultima versione sincronizzata: vince chi ha cambiato il movimento
    const base = F.movimentiDaTesto((await archivio.leggi<string>(BASE_MOV)) ?? "");
    const u = new Registro(Registro.unione3(stato.reg.mov, F.movimentiDaTesto(remoto), base), stato.reg.saldi, stato.reg.importati);
    for (const [a, b] of u.periodiEstratti()) u.rimuoviListe(a, b);
    return F.movimentiATesto(u.mov);
  }
  if (p === "saldi" || p === "imp") {
    const r = new Registro(stato.reg.mov, stato.reg.saldi, stato.reg.importati);
    const altro = new Registro();
    altro.mov = r.mov;
    if (p === "saldi") altro.saldi = F.saldiDaTesto(remoto); else altro.saldi = r.saldi;
    if (p === "imp") altro.importati = F.importatiDaTesto(remoto); else altro.importati = r.importati;
    const u = Registro.unione(r, altro);
    return p === "saldi" ? F.saldiATesto(u.saldi) : F.importatiATesto(u.importati);
  }
  if (p === "prezzi") return F.prezziATesto(unisciCache(F.prezziDaTesto(remoto), stato.prezzi));
  let rc: any = null;
  try { rc = JSON.parse(remoto); } catch { /* */ }
  const altro = normalizza(rc).cfg;
  const loc = stato.cfg;
  // regole: quelle dell'altro dispositivo più le parole e le categorie aggiunte qui
  const regole = altro.regole_categorie.map(([cat, parole]) => {
    const qui = loc.regole_categorie.find((r) => r[0] === cat)?.[1] ?? [];
    return [cat, [...parole, ...qui.filter((x) => !parole.includes(x))]] as [string, string[]];
  });
  for (const r of loc.regole_categorie) if (!regole.some((x) => x[0] === r[0])) regole.splice(Math.max(regole.length - 1, 0), 0, r);
  // primo collegamento di questo dispositivo: per le impostazioni semplici valgono quelle già sul Drive
  const primaVolta = !meta.etag.cfg;
  const c = { ...(primaVolta ? { ...loc, ...altro } : { ...altro, ...loc }),
    intestatario: (primaVolta ? altro.intestatario || loc.intestatario : loc.intestatario || altro.intestatario),
    proxy_prezzi: loc.proxy_prezzi || altro.proxy_prezzi,
    regole_categorie: regole, regole_apprese: { ...altro.regole_apprese, ...loc.regole_apprese },
    strumenti: { ...altro.strumenti, ...loc.strumenti } };
  return JSON.stringify(c, null, 2);
}

// ------------------------------------------------------------------ sincronizzazione
let corsa: Promise<void> | null = null;
let ancora = false;

export function sincronizza(): Promise<void> {
  if (corsa) { ancora = true; return corsa; }
  corsa = (async () => {
    do {
      ancora = false;
      await giro();
    } while (ancora);
  })().finally(() => { corsa = null; });
  return corsa;
}

async function giro() {
  if (!token) return;
  if (!navigator.onLine) { aggiornaInfo({ stato: "senza rete" }); return; }
  aggiornaInfo({ stato: "sincronizzo", errore: "" });
  try {
    for (let tentativo = 0; tentativo < 3; tentativo++) {
      const remoto = await elencoRemoto();
      const arrivati: Partial<Record<Parte, string>> = {};
      let conflitto = false;
      for (const p of TUTTE) {
        const nome = FILE[p];
        const rem = remoto[nome];
        const inSospeso = meta.inSospeso.includes(p);
        if (rem && rem.eTag !== meta.etag[p]) {
          const { testo, eTag } = await scarica(nome);
          if (inSospeso) sostituisci({ [p]: await unisci(p, testo) });
          else { arrivati[p] = testo; if (p === "mov") await archivio.scrivi(BASE_MOV, testo); }
          meta.etag[p] = eTag;
        }
        if (inSospeso || !rem) {
          const g = generazione[p] ?? 0;
          const testo = testoDi(p);
          const nuovo = await carica(nome, testo, rem ? meta.etag[p] : undefined);
          if (nuovo === null) { conflitto = true; delete meta.etag[p]; continue; }
          meta.etag[p] = nuovo;
          if (p === "mov") await archivio.scrivi(BASE_MOV, testo);
          // se nel frattempo è cambiato ancora qualcosa resta in sospeso per il prossimo giro
          if ((generazione[p] ?? 0) === g) meta.inSospeso = meta.inSospeso.filter((x) => x !== p);
        }
      }
      if (Object.keys(arrivati).length) sostituisci(arrivati);
      if (!conflitto) break;
    }
    meta.ultimo = new Date().toISOString();
    await salvaMeta();
    aggiornaInfo({ stato: "collegato", ultimo: meta.ultimo, utente: token?.utente ?? "" });
  } catch (e: any) {
    await salvaMeta();
    if (e?.codice === "scaduto") aggiornaInfo({ stato: "scaduto", errore: "" });
    else if (e?.codice === "permesso") {
      token = null;
      await archivio.cancella("meta:cloud_token");
      aggiornaInfo({ stato: "errore", errore: SENZA_PERMESSO });
    }
    else aggiornaInfo({ stato: navigator.onLine ? "errore" : "senza rete", errore: String(e?.message ?? e) });
  }
}

let timerSync: ReturnType<typeof setTimeout> | null = null;
const prossima = (ms = 2500) => { if (timerSync) clearTimeout(timerSync); timerSync = setTimeout(() => { timerSync = null; sincronizza(); }, ms); };

/** Avvio: legge lo stato salvato, completa un eventuale accesso e sincronizza. */
export async function avvia() {
  // al primo avvio: se ci sono già dati qui andranno uniti a quelli sul Drive, altrimenti si scaricano e basta
  const salvata = await archivio.leggi<Meta>("meta:cloud");
  meta = salvata ?? { etag: {}, inSospeso: stato.reg.mov.length ? [...TUTTE] : [], eliminati: [] };
  if (!salvata) await salvaMeta();
  token = (await archivio.leggi<Token>("meta:cloud_token")) ?? null;
  allaModifica((parti) => {
    for (const p of parti) {
      generazione[p] = (generazione[p] ?? 0) + 1;
      if (!meta.inSospeso.includes(p)) meta.inSospeso.push(p);
    }
    salvaMeta();
    if (token) prossima();
  });
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && token) prossima(300); });
  window.addEventListener("online", () => { if (token) prossima(300); });
  setInterval(() => { if (document.visibilityState === "visible" && token) sincronizza(); }, 5 * 60_000);
  try { await ritornoDaGoogle(); } catch (e: any) { aggiornaInfo({ stato: "errore", errore: String(e?.message ?? e) }); }
  if (!token) { if (info.stato !== "errore") aggiornaInfo({ stato: "non collegato" }); return; }
  aggiornaInfo({ stato: "collegato", utente: token.utente ?? "", ultimo: meta.ultimo ?? "" });
  await sincronizza();
}

export const collegato = () => !!token;
