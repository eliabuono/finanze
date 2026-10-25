/**
 * Sincronizzazione con OneDrive (Microsoft Graph, accesso con codice PKCE, nessun server intermedio).
 *
 * I file stanno nella cartella dell'app su OneDrive ("App/Finanze"): movimenti.txt, saldi_noti.txt,
 * importati.txt, config.json, prezzi_cache.csv — gli stessi della versione per PC.
 * Ogni dispositivo tiene una copia locale e lavora anche senza rete; quando può, scarica le modifiche
 * fatte altrove e carica le proprie. Se due dispositivi hanno cambiato gli stessi dati, le modifiche si uniscono.
 */
import { useSyncExternalStore } from "react";
import { normalizza } from "../core/config";
import * as F from "../core/formato";
import { Registro } from "../core/registro";
import { unisciCache } from "../core/prezzi";
import { MICROSOFT_CLIENT_ID } from "./ambiente";
import * as archivio from "./archivio";
import { allaModifica, FILE, salvaSubito, sostituisci, stato, testoDi, TUTTE, type Parte } from "./stato";

const AUTH = "https://login.microsoftonline.com/common/oauth2/v2.0";
const SCOPE = "Files.ReadWrite.AppFolder offline_access User.Read";
const GRAPH = "https://graph.microsoft.com/v1.0";

interface Token { access: string; scade: number; refresh?: string; utente?: string; }
interface Meta { etag: Partial<Record<Parte, string>>; inSospeso: Parte[]; eliminati: string[]; ultimo?: string; }

export type StatoSync = "non collegato" | "collegato" | "sincronizzo" | "errore" | "scaduto" | "senza rete";
const info: { stato: StatoSync; errore: string; ultimo: string; utente: string; v: number } =
  { stato: "non collegato", errore: "", ultimo: "", utente: "", v: 0 };
const asc = new Set<() => void>();
function aggiornaInfo(p: Partial<typeof info>) { Object.assign(info, p); info.v++; asc.forEach((f) => f()); }
export function useSync() {
  useSyncExternalStore((f) => { asc.add(f); return () => asc.delete(f); }, () => info.v);
  return info;
}

export const clientId = () => { try { return localStorage.getItem("finanze:ms_client_id") || MICROSOFT_CLIENT_ID; } catch { return MICROSOFT_CLIENT_ID; } };
export function impostaClientId(id: string) { try { localStorage.setItem("finanze:ms_client_id", id.trim()); } catch { /* */ } }
const redirectUri = () => location.origin + location.pathname;

let meta: Meta = { etag: {}, inSospeso: [], eliminati: [] };
const generazione: Partial<Record<Parte, number>> = {};
const BASE_MOV = "base:movimenti.txt"; // ultima versione dei movimenti sincronizzata, per unire le modifiche
let token: Token | null = null;
const salvaMeta = () => archivio.scrivi("meta:onedrive", meta);
const salvaToken = () => archivio.scrivi("meta:onedrive_token", token);

// ------------------------------------------------------------------ accesso
const b64url = (b: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const casuale = (n = 48) => b64url(crypto.getRandomValues(new Uint8Array(n)));

export async function accedi(silenzioso = false) {
  const id = clientId();
  if (!id) throw new Error("Manca l'ID applicazione Microsoft (vedi Impostazioni).");
  const verifier = casuale();
  const challenge = b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  const st = casuale(16);
  localStorage.setItem("finanze:pkce", JSON.stringify({ verifier, st, silenzioso }));
  const q = new URLSearchParams({ client_id: id, response_type: "code", redirect_uri: redirectUri(), response_mode: "query",
    scope: SCOPE, code_challenge: challenge, code_challenge_method: "S256", state: st });
  if (silenzioso) q.set("prompt", "none");
  await salvaSubito(); // prima di lasciare la pagina
  location.assign(`${AUTH}/authorize?${q}`);
}

async function chiediToken(corpo: Record<string, string>): Promise<Token> {
  const r = await fetch(`${AUTH}/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId(), scope: SCOPE, ...corpo }) });
  const j = await r.json();
  if (!r.ok) throw Object.assign(new Error(j.error_description || j.error || `HTTP ${r.status}`), { codice: j.error });
  return { access: j.access_token, scade: Date.now() + (j.expires_in - 60) * 1000, refresh: j.refresh_token ?? token?.refresh, utente: token?.utente };
}

/** Da chiamare all'avvio: completa l'accesso se si sta tornando dalla pagina di Microsoft. */
async function ritornoDaMicrosoft(): Promise<boolean> {
  const u = new URL(location.href);
  const code = u.searchParams.get("code"), err = u.searchParams.get("error");
  if (!code && !err) return false;
  const salvato = JSON.parse(localStorage.getItem("finanze:pkce") || "null");
  localStorage.removeItem("finanze:pkce");
  history.replaceState(null, "", redirectUri() + location.hash);
  if (err) {
    if (!salvato?.silenzioso) aggiornaInfo({ stato: "errore", errore: u.searchParams.get("error_description") || err });
    else aggiornaInfo({ stato: "scaduto", errore: "" });
    return true;
  }
  if (!salvato || salvato.st !== u.searchParams.get("state")) { aggiornaInfo({ stato: "errore", errore: "Risposta di Microsoft non valida, riprova." }); return true; }
  token = await chiediToken({ grant_type: "authorization_code", code: code!, redirect_uri: redirectUri(), code_verifier: salvato.verifier });
  try {
    const me = await (await fetch(`${GRAPH}/me?$select=displayName,userPrincipalName`, { headers: { Authorization: `Bearer ${token.access}` } })).json();
    token.utente = me.userPrincipalName || me.displayName || "";
  } catch { /* facoltativo */ }
  await salvaToken();
  return true;
}

async function tokenValido(): Promise<string> {
  if (token && token.scade > Date.now()) return token.access;
  if (!token?.refresh) throw Object.assign(new Error("accesso scaduto"), { codice: "scaduto" });
  try {
    token = await chiediToken({ grant_type: "refresh_token", refresh_token: token.refresh });
    await salvaToken();
    return token.access;
  } catch (e: any) {
    if (e.codice === "invalid_grant" || e.codice === "interaction_required") throw Object.assign(new Error("accesso scaduto"), { codice: "scaduto" });
    throw e;
  }
}

export async function esci() {
  token = null;
  await archivio.cancella("meta:onedrive_token");
  meta.etag = {};
  await salvaMeta();
  aggiornaInfo({ stato: "non collegato", utente: "", errore: "" });
}

// ------------------------------------------------------------------ Graph
async function graph(percorso: string, init: RequestInit = {}): Promise<Response> {
  const t = await tokenValido();
  const r = await fetch(GRAPH + percorso, { ...init, headers: { Authorization: `Bearer ${t}`, ...(init.headers ?? {}) } });
  if (r.status === 401) { if (token) token.scade = 0; throw Object.assign(new Error("accesso scaduto"), { codice: "scaduto" }); }
  return r;
}

async function elencoRemoto(): Promise<Record<string, { eTag: string }>> {
  const r = await graph("/me/drive/special/approot/children?$select=name,eTag,size&$top=200");
  if (!r.ok) throw new Error(`OneDrive: errore ${r.status}`);
  const j = await r.json();
  return Object.fromEntries((j.value ?? []).map((x: any) => [x.name, { eTag: x.eTag }]));
}

async function scarica(nome: string): Promise<{ testo: string; eTag: string }> {
  const r = await graph(`/me/drive/special/approot:/${encodeURIComponent(nome)}`);
  if (!r.ok) throw new Error(`OneDrive: ${nome} non leggibile (${r.status})`);
  const it = await r.json();
  const c = await graph(`/me/drive/special/approot:/${encodeURIComponent(nome)}:/content`);
  if (!c.ok) throw new Error(`OneDrive: ${nome} non leggibile (${c.status})`);
  return { testo: await c.text(), eTag: it.eTag };
}

async function carica(nome: string, testo: string, eTag?: string): Promise<string | null> {
  const r = await graph(`/me/drive/special/approot:/${encodeURIComponent(nome)}:/content`, {
    method: "PUT", body: testo, headers: { "Content-Type": "text/plain; charset=utf-8", ...(eTag ? { "If-Match": eTag } : { "If-None-Match": "*" }) },
  });
  if (r.status === 412 || r.status === 409) return null; // cambiato altrove nel frattempo
  if (!r.ok) throw new Error(`OneDrive: ${nome} non salvato (${r.status})`);
  return (await r.json()).eTag;
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
  const c = { ...altro, ...loc, intestatario: loc.intestatario || altro.intestatario, proxy_prezzi: loc.proxy_prezzi || altro.proxy_prezzi,
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
    else aggiornaInfo({ stato: navigator.onLine ? "errore" : "senza rete", errore: String(e?.message ?? e) });
  }
}

let timerSync: ReturnType<typeof setTimeout> | null = null;
const prossima = (ms = 2500) => { if (timerSync) clearTimeout(timerSync); timerSync = setTimeout(() => { timerSync = null; sincronizza(); }, ms); };

/** Avvio: legge lo stato salvato, completa un eventuale accesso e sincronizza. */
export async function avvia() {
  // al primo avvio: se ci sono già dati qui andranno uniti a quelli su OneDrive, altrimenti si scaricano e basta
  meta = (await archivio.leggi<Meta>("meta:onedrive")) ?? { etag: {}, inSospeso: stato.reg.mov.length ? [...TUTTE] : [], eliminati: [] };
  if (!(await archivio.leggi("meta:onedrive"))) await salvaMeta();
  token = (await archivio.leggi<Token>("meta:onedrive_token")) ?? null;
  allaModifica((parti) => {
    for (const p of parti) {
      generazione[p] = (generazione[p] ?? 0) + 1;
      if (!meta.inSospeso.includes(p)) meta.inSospeso.push(p);
    }
    salvaMeta();
    if (token) prossima();
  });
  try { await ritornoDaMicrosoft(); } catch (e: any) { aggiornaInfo({ stato: "errore", errore: String(e?.message ?? e) }); }
  if (info.stato === "scaduto") return;
  if (!token) { if (info.stato !== "errore") aggiornaInfo({ stato: "non collegato" }); return; }
  aggiornaInfo({ stato: "collegato", utente: token.utente ?? "", ultimo: meta.ultimo ?? "" });
  await sincronizza();
  if (info.stato === "scaduto" && !sessionStorage.getItem("finanze:riaccesso")) {
    // accesso di Microsoft scaduto (succede dopo circa un giorno): si rinnova da solo, senza chiedere nulla se possibile
    sessionStorage.setItem("finanze:riaccesso", "1");
    accedi(true).catch(() => {});
    return;
  }
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") prossima(300); });
  window.addEventListener("online", () => prossima(300));
  setInterval(() => { if (document.visibilityState === "visible") sincronizza(); }, 5 * 60_000);
}

export const collegato = () => !!token;
