/**
 * Registro unico dei movimenti e dei saldi noti (porting di registro.py).
 * Importare più volte lo stesso file, o file sovrapposti, non crea doppioni: per ogni conto/data/importo
 * si aggiungono solo i movimenti in più rispetto a quelli già presenti (Satispay usa il proprio ID).
 */
import { categorizza, chiave } from "./categorie";
import { formatoValuta, tassoDel, type Cambi } from "./cambi";
import { CAT_COLLETTE, eRisparmioSatispay, nomeSalvadanaio, rilevaCollette, tipoSalvadanaio } from "./collette";
import { adesso, aggiungiGiorni } from "./date";
import { leggi } from "./parsers";
import type { Pagina } from "./pdftext";
import type { Config, FileImportato, Movimento, MovimentoLetto, SaldoNoto } from "./tipi";

const CONTI_INTESA = ["Intesa Sanpaolo", "Intesa Salvadanaio"];
export const SALVADANAI: Record<string, string> = { "Intesa Sanpaolo": "Intesa Salvadanaio", "Satispay": "Satispay Salvadanaio" };

/** Movimento verso o dal salvadanaio personale (le collette Satispay non contano: non sono un conto tuo). */
export function eSalvadanaio(m: { conto: string; descrizione: string; tipo?: string }, cfg?: Config | null): boolean {
  const d = String(m.descrizione ?? "").toUpperCase();
  if (m.conto === "Intesa Sanpaolo") return d.includes("SALVADANAIO");
  if (m.conto === "Satispay") return eRisparmioSatispay(m) && tipoSalvadanaio(nomeSalvadanaio(m.descrizione), cfg) === "personale";
  return false;
}

function conSalvadanaio(mov: MovimentoLetto[], cfg: Config): MovimentoLetto[] {
  const extra = mov.filter((m) => SALVADANAI[m.conto] && eSalvadanaio(m, cfg))
    .map((m) => ({ ...m, conto: SALVADANAI[m.conto], importo: -m.importo, tipo: "Salvadanaio", id: undefined }));
  return [...mov, ...extra];
}

/** Hash breve e stabile (FNV-1a a 64 bit), 12 cifre esadecimali come gli id della versione Python. */
export function hash12(s: string): string {
  let h1 = 0x811c9dc5 | 0, h2 = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193);
    h2 = Math.imul(h2 ^ c, 0x5bd1e995) ^ (h2 >>> 13);
  }
  return ((h1 >>> 0).toString(16).padStart(8, "0") + (h2 >>> 0).toString(16).padStart(8, "0")).slice(0, 12);
}

const r2 = (x: number) => Math.round(x * 100) / 100;
const k3 = (conto: string, data: string, importo: number) => `${conto}|${data}|${r2(importo).toFixed(2)}`;

export interface EsitoImport {
  file: string; formato: string; letti: number; aggiunti: number; errore?: string;
  saldo_finale_dichiarato?: number | null; saldo_finale_calcolato?: number | null;
  /** collette Satispay riconosciute in questo import */
  collette?: string[];
  /** valute estere non importate perché mancava il cambio (per esempio senza rete) */
  senzaCambio?: string[];
  sezioni?: { conto: string; valuta: string; saldo_finale_dichiarato: number | null; saldo_finale_calcolato: number | null }[];
}

export class Registro {
  mov: Movimento[] = [];
  saldi: SaldoNoto[] = [];
  importati: FileImportato[] = [];

  constructor(mov: Movimento[] = [], saldi: SaldoNoto[] = [], importati: FileImportato[] = []) {
    this.mov = mov;
    this.saldi = saldi;
    this.importati = importati;
  }

  giaImportato(nome: string, dimensione: number): boolean {
    return this.importati.some((r) => r.file === nome && Number(r.dimensione) === dimensione);
  }

  importa(pagine: Pagina[], nome: string, dimensione: number, cfg: Config, cambi: Cambi = {}): EsitoImport {
    const letto = leggi(pagine, nome);
    const { formato, controlli } = letto;
    // movimenti in valuta estera: in euro al cambio del giorno, l'importo originale resta nella descrizione
    const senzaCambio = new Set<string>();
    const movimenti: MovimentoLetto[] = [];
    for (const m of letto.movimenti) {
      if (!m.valuta || m.valuta === "EUR") { movimenti.push(m); continue; }
      const t = tassoDel(cambi[m.valuta], m.data);
      if (!t) { senzaCambio.add(m.valuta); continue; }
      const { valuta, ...resto } = m;
      movimenti.push({ ...resto, importo: Math.round((m.importo / t) * 100) / 100, saldo: null,
        descrizione: `${m.descrizione} | ${formatoValuta(m.importo, valuta)}` });
    }
    if (controlli.sezioni) for (const z of controlli.sezioni) {
      if (z.valuta === "EUR" || z.saldo_finale_dichiarato === null) continue;
      const data = controlli.data_fine || letto.movimenti.filter((m) => m.conto === z.conto).map((m) => m.data).sort().pop();
      const t = data ? tassoDel(cambi[z.valuta], data) : null;
      (z as any).saldo_eur = t ? Math.round((z.saldo_finale_dichiarato / t) * 100) / 100 : null;
      (z as any).data = data;
    }
    if (!cfg.salvadanai_satispay) cfg.salvadanai_satispay = {};
    let nuovi = conSalvadanaio(movimenti, cfg);
    let dal: string | null = null, al: string | null = null;
    if (formato === "intesa_estratto") {
      dal = controlli.data_inizio ?? null;
      al = controlli.data_fine ?? null;
      if (dal && al) this.rimuoviListe(dal, al);
    } else if (formato === "intesa_lista") {
      const periodi = this.periodiEstratti();
      nuovi = nuovi.filter((m) => !periodi.some(([a, b]) => a <= m.data && m.data <= b));
    }
    if (nuovi.length) {
      dal = dal || nuovi.reduce((x, m) => (m.data < x ? m.data : x), nuovi[0].data);
      al = al || nuovi.reduce((x, m) => (m.data > x ? m.data : x), nuovi[0].data);
    }
    const aggiunti = this.unisci(nuovi, cfg);
    const collette = this.allineaSalvadanai(cfg).rilevate;
    this.aggiungiSaldiImport(formato, nuovi, controlli, nome);
    this.aggiungiStrumenti(cfg);
    // se mancavano dei cambi il file non risulta importato, così si può riprovare quando c'è la rete
    this.importati = this.importati.filter((r) => r.file !== nome);
    if (!senzaCambio.size) this.importati.push({ file: nome, dimensione, formato, movimenti_nuovi: aggiunti, importato_il: adesso(),
      dal: dal ?? "", al: al ?? "" });
    return { file: nome, formato, letti: nuovi.length, aggiunti, collette, ...controlli,
      ...(senzaCambio.size ? { senzaCambio: [...senzaCambio] } : {}) };
  }

  /** Strumenti nuovi trovati nei movimenti ma non ancora in configurazione. */
  aggiungiStrumenti(cfg: Config): boolean {
    let cambiato = false;
    for (const m of this.mov) {
      if (!m.isin || m.quote === null || cfg.strumenti[m.isin]) continue;
      const nome = m.descrizione.split(m.isin).pop()!.split(",")[0].trim().slice(0, 30) || m.isin;
      cfg.strumenti[m.isin] = { nome, classe: "Altro", ticker: "", obiettivo: null };
      cambiato = true;
    }
    return cambiato;
  }

  periodiEstratti(): [string, string][] {
    return this.importati.filter((r) => r.formato === "intesa_estratto" && r.dal && r.al).map((r) => [r.dal, r.al]);
  }

  rimuoviListe(dal: string, al: string): number {
    const liste = new Set(this.importati.filter((r) => r.formato === "intesa_lista").map((r) => r.file));
    const prima = this.mov.length;
    this.mov = this.mov.filter((m) => !(liste.has(m.fonte) && CONTI_INTESA.includes(m.conto) && m.data >= dal && m.data <= al));
    return prima - this.mov.length;
  }

  /** Corregge registri creati con versioni precedenti. Restituisce cosa ha fatto. */
  ripara(cfg: Config): string[] {
    const note: string[] = [];
    for (const r of this.importati) {
      if (r.formato === "intesa_estratto" && !r.al) {
        const a = this.saldi.filter((s) => s.fonte === r.file && s.conto === "Intesa Sanpaolo").map((s) => s.data).sort();
        if (a.length) {
          const fine = a[a.length - 1];
          const m = +fine.slice(5, 7);
          r.dal = `${fine.slice(0, 4)}-${String(Math.floor((m - 1) / 3) * 3 + 1).padStart(2, "0")}-01`;
          r.al = fine;
        }
      }
    }
    for (const [a, b] of this.periodiEstratti()) {
      // liste movimenti sovrapposte a un estratto conto: si tiene l'estratto (che è già nel registro)
      const liste = new Set(this.importati.filter((r) => r.formato === "intesa_lista").map((r) => r.file));
      const estratto = this.importati.find((r) => r.formato === "intesa_estratto" && r.al === b)?.file;
      const haEstratto = estratto && this.mov.some((m) => m.fonte === estratto);
      if (!haEstratto) continue;
      const prima = this.mov.length;
      this.mov = this.mov.filter((m) => !(liste.has(m.fonte) && CONTI_INTESA.includes(m.conto) && m.data >= a && m.data <= b));
      if (this.mov.length < prima) note.push(`Tolti ${prima - this.mov.length} movimenti della lista Intesa già presenti nell'estratto conto ${a} – ${b}`);
    }
    // Revolut ha un conto per valuta: il vecchio conto «Revolut» (solo euro) diventa «Revolut EUR»
    let rev = 0;
    for (const m of this.mov) if (m.conto === "Revolut") { m.conto = "Revolut EUR"; rev++; }
    for (const x of this.saldi) if (x.conto === "Revolut") { x.conto = "Revolut EUR"; rev++; }
    if (rev) note.push("Il conto Revolut ora si chiama «Revolut EUR» (Revolut ha un conto per ogni valuta)");
    const a = this.allineaSalvadanai(cfg);
    if (a.rilevate.length) note.push(`Riconosciute come collette (non come salvadanaio personale): ${a.rilevate.join(", ")}`);
    if (a.tolti) note.push(`Tolti dal Salvadanaio Satispay ${a.tolti} movimenti delle collette`);
    if (a.aggiunti) note.push(`Aggiunti ${a.aggiunti} movimenti mancanti dei salvadanai`);
    const cambiati = this.ricategorizza(cfg);
    if (cambiati) note.push(`Ricategorizzati ${cambiati} movimenti con le regole aggiornate`);
    if (this.aggiungiStrumenti(cfg)) note.push("Aggiunti alle Impostazioni gli strumenti nuovi trovati nei movimenti");
    return note;
  }

  /**
   * Tiene allineati salvadanai e collette Satispay: riconosce le collette, toglie dal conto «Satispay Salvadanaio»
   * i loro movimenti, aggiunge quelli mancanti del salvadanaio personale e aggiorna le categorie
   * (Collette oppure Trasferimento interno; non tocca quelle fissate con il lucchetto né gli esercenti imparati).
   */
  allineaSalvadanai(cfg: Config): { rilevate: string[]; tolti: number; aggiunti: number; ricategorizzati: number } {
    if (!cfg.salvadanai_satispay) cfg.salvadanai_satispay = {};
    const rilevate = rilevaCollette(this.mov, cfg);
    for (const n of rilevate) cfg.salvadanai_satispay[n] = "colletta";
    const spec = SALVADANAI["Satispay"];
    const prima = this.mov.length;
    this.mov = this.mov.filter((m) => !(m.conto === spec && tipoSalvadanaio(nomeSalvadanaio(m.descrizione), cfg) === "colletta"));
    const tolti = prima - this.mov.length;
    const aggiunti = this.riparaSalvadanaio(cfg);
    let ricategorizzati = 0;
    for (const m of this.mov) {
      if (m.manuale || !eRisparmioSatispay(m)) continue;
      const colletta = tipoSalvadanaio(nomeSalvadanaio(m.descrizione), cfg) === "colletta";
      if (!colletta && m.categoria !== CAT_COLLETTE) continue;
      const c = categorizza(m, cfg);
      if (c !== m.categoria) { m.categoria = c; ricategorizzati++; }
    }
    return { rilevate, tolti, aggiunti, ricategorizzati };
  }

  riparaSalvadanaio(cfg?: Config): number {
    const nuovi: Movimento[] = [];
    for (const [base, spec] of Object.entries(SALVADANAI)) {
      const presenti = new Map<string, number>();
      for (const m of this.mov) if (m.conto === spec) {
        const k = k3("", m.data, -m.importo);
        presenti.set(k, (presenti.get(k) ?? 0) + 1);
      }
      for (const m of this.mov) {
        if (m.conto !== base || !eSalvadanaio(m, cfg)) continue;
        const k = k3("", m.data, m.importo);
        const n = presenti.get(k) ?? 0;
        if (n > 0) { presenti.set(k, n - 1); continue; }
        const d: Movimento = { ...m, conto: spec, importo: -m.importo, tipo: "Salvadanaio", categoria: "Trasferimento interno", manuale: false, id: "" };
        d.id = this.nuovoId(d, nuovi.length);
        nuovi.push(d);
      }
    }
    this.mov.push(...nuovi);
    return nuovi.length;
  }

  private ids = new Set<string>();
  private nuovoId(m: { conto: string; data: string; importo: number; descrizione: string }, n: number): string {
    if (this.ids.size === 0 || this.ids.size < this.mov.length) this.ids = new Set(this.mov.map((x) => x.id));
    let id = hash12(`${m.conto}|${m.data}|${m.importo.toFixed(2)}|${m.descrizione}|${n}`);
    for (let i = 1; this.ids.has(id); i++) id = hash12(`${m.conto}|${m.data}|${m.importo.toFixed(2)}|${m.descrizione}|${n}|${i}`);
    this.ids.add(id);
    return id;
  }

  private unisci(nuovi: MovimentoLetto[], cfg: Config): number {
    if (!nuovi.length) return 0;
    const ids = new Set(this.mov.map((m) => m.id));
    const contaEs = new Map<string, number>();
    for (const m of this.mov) { const k = k3(m.conto, m.data, m.importo); contaEs.set(k, (contaEs.get(k) ?? 0) + 1); }
    const contaN = new Map<string, number>();
    const daAggiungere: MovimentoLetto[] = [];
    for (const m of nuovi) {
      if (m.id) {
        if (ids.has(m.id)) continue;
        ids.add(m.id);
        daAggiungere.push(m);
        continue;
      }
      const k = k3(m.conto, m.data, m.importo);
      const n = (contaN.get(k) ?? 0) + 1;
      contaN.set(k, n);
      if (n > (contaEs.get(k) ?? 0)) daAggiungere.push(m);
    }
    const righe: Movimento[] = daAggiungere.map((m, i) => ({
      id: m.id || this.nuovoId(m, i), data: m.data, conto: m.conto, tipo: m.tipo, descrizione: m.descrizione,
      importo: m.importo, categoria: categorizza(m, cfg), isin: m.isin ?? "", quote: m.quote ?? null,
      fonte: m.fonte ?? "", manuale: false,
    }));
    this.mov.push(...righe);
    return righe.length;
  }

  private aggiungiSaldiImport(formato: string, movimenti: MovimentoLetto[], c: any, fonte: string) {
    const nuovi: SaldoNoto[] = [];
    if (!movimenti.length && formato !== "intesa_estratto") return;
    const conto = movimenti[0]?.conto ?? "Intesa Sanpaolo";
    const d1 = movimenti.length ? movimenti.reduce((x, m) => (m.data > x ? m.data : x), movimenti[0].data) : c.data_fine;
    if (formato === "intesa_estratto") {
      const df = c.data_fine || d1;
      if (c.saldo_finale_dichiarato != null) nuovi.push({ data: df, conto: "Intesa Sanpaolo", saldo: c.saldo_finale_dichiarato, fonte });
      if (c.saldo_salvadanaio != null) nuovi.push({ data: df, conto: "Intesa Salvadanaio", saldo: c.saldo_salvadanaio, fonte });
    } else if (formato === "fineco" || formato === "unicredit") {
      if (c.saldo_finale_dichiarato != null) nuovi.push({ data: c.data_fine || d1, conto: formato === "fineco" ? "Fineco" : "UniCredit", saldo: c.saldo_finale_dichiarato, fonte });
    } else if (formato === "revolut") {
      // un saldo di chiusura per ogni valuta (quelli in valuta estera convertiti in euro al cambio di quel giorno)
      for (const z of c.sezioni ?? []) {
        const saldo = z.valuta === "EUR" ? z.saldo_finale_dichiarato : z.saldo_eur;
        const data = z.valuta === "EUR" ? c.data_fine || movimenti.filter((m) => m.conto === z.conto).map((m) => m.data).sort().pop() : z.data;
        if (saldo != null && data) nuovi.push({ data, conto: z.conto, saldo, fonte });
      }
    } else if (formato === "trade_republic") {
      if (c.saldo_finale_dichiarato != null) nuovi.push({ data: d1, conto, saldo: c.saldo_finale_dichiarato, fonte });
    } else if (formato === "satispay") {
      const ult = movimenti.filter((m) => m.conto === "Satispay").pop();
      if (ult && ult.saldo != null) nuovi.push({ data: ult.data, conto, saldo: ult.saldo, fonte });
    }
    for (const s of nuovi) this.aggiungiSaldo(s.data, s.conto, s.saldo, s.fonte);
  }

  aggiungiSaldo(data: string, conto: string, saldo: number, fonte = "manuale") {
    this.saldi = this.saldi.filter((s) => !(s.data === data && s.conto === conto));
    this.saldi.push({ data, conto, saldo: Number(saldo), fonte });
  }

  rimuoviSaldo(data: string, conto: string) {
    this.saldi = this.saldi.filter((s) => !(s.data === data && s.conto === conto));
  }

  /** Memorizza esercente -> categoria e la applica a tutti i movimenti di quell'esercente (tranne i 🔒). */
  impara(esercenti: Record<string, string>, cfg: Config): number {
    cfg.regole_apprese = { ...(cfg.regole_apprese ?? {}), ...esercenti };
    let n = 0;
    if (!Object.keys(esercenti).length) return 0;
    for (const m of this.mov) {
      if (m.isin || m.manuale) continue;
      const cat = esercenti[chiave(m)];
      if (cat && m.categoria !== cat) { m.categoria = cat; n++; }
    }
    return n;
  }

  /** Dimentica esercenti imparati: i loro movimenti tornano alle regole generali. */
  dimentica(esercenti: string[], cfg: Config): number {
    const via = new Set(esercenti);
    for (const k of via) delete cfg.regole_apprese[k];
    let n = 0;
    for (const m of this.mov) {
      if (m.manuale || m.isin || !via.has(chiave(m))) continue;
      const c = categorizza({ ...m, categoria: "" }, cfg);
      if (c !== m.categoria) { m.categoria = c; n++; }
    }
    return n;
  }

  /** Imposta (e blocca) la categoria di singoli movimenti. */
  fissa(ids: Iterable<string>, categoria: string | null, bloccato = true) {
    const s = new Set(ids);
    for (const m of this.mov) if (s.has(m.id)) {
      if (categoria !== null) m.categoria = categoria;
      m.manuale = bloccato;
    }
  }

  /** Riapplica le regole: di default solo ai movimenti con categoria vuota o di default. Restituisce quanti cambiano. */
  ricategorizza(cfg: Config, soloDaClassificare = true): number {
    const def = new Set([cfg.categoria_default_uscite, cfg.categoria_default_entrate, ""]);
    let n = 0;
    for (const m of this.mov) {
      if (m.manuale) continue;
      if (soloDaClassificare && !def.has(m.categoria)) continue;
      const c = categorizza(m, cfg);
      if (c !== m.categoria) { m.categoria = c; n++; }
    }
    return n;
  }

  /**
   * Unione a tre vie dei movimenti: `base` è l'ultima versione sincronizzata. Per ogni movimento vince
   * il dispositivo che l'ha cambiato; quelli cancellati da una parte (e non toccati dall'altra) spariscono.
   */
  static unione3(locali: Movimento[], remoti: Movimento[], base: Movimento[]): Movimento[] {
    const firma = (m: Movimento) => JSON.stringify([m.data, m.conto, m.tipo, m.descrizione, m.importo, m.categoria, m.isin, m.quote, m.fonte, m.manuale]);
    const B = new Map(base.map((m) => [m.id, firma(m)]));
    const R = new Map(remoti.map((m) => [m.id, m]));
    const L = new Map(locali.map((m) => [m.id, m]));
    const out: Movimento[] = [];
    for (const m of locali) {
      const r = R.get(m.id);
      const cambiatoQui = B.get(m.id) !== firma(m);
      if (r) out.push(cambiatoQui ? m : r);
      else if (!B.has(m.id) || cambiatoQui) out.push(m); // nuovo qui, oppure cancellato altrove ma cambiato qui
    }
    // nuovi dall'altro dispositivo, senza doppioni dello stesso movimento importato su entrambi
    const chiaveM = (m: Movimento) => `${m.conto}|${m.data}|${m.importo.toFixed(2)}|${m.descrizione}`;
    const contaQui = new Map<string, number>();
    for (const m of out) contaQui.set(chiaveM(m), (contaQui.get(chiaveM(m)) ?? 0) + 1);
    const contaLa = new Map<string, number>();
    for (const m of remoti) {
      if (L.has(m.id)) { const k = chiaveM(m); contaLa.set(k, (contaLa.get(k) ?? 0) + 1); continue; }
      if (B.has(m.id)) continue; // cancellato qui
      const k = chiaveM(m);
      const n = (contaLa.get(k) ?? 0) + 1;
      contaLa.set(k, n);
      if (n > (contaQui.get(k) ?? 0)) out.push(m);
    }
    return out;
  }

  /** Unisce i dati di un altro registro (per esempio quello salvato su Google Drive da un altro dispositivo). */
  static unione(a: Registro, b: Registro, eliminati: Set<string> = new Set()): Registro {
    // a (locale) vince; da b si aggiungono i movimenti che a non ha, senza doppioni dello stesso movimento
    // importato su due dispositivi (stesso conto, data, importo e descrizione)
    const chiaveM = (m: Movimento) => `${m.conto}|${m.data}|${m.importo.toFixed(2)}|${m.descrizione}`;
    const per = new Map<string, Movimento>(a.mov.map((m) => [m.id, m]));
    const contaA = new Map<string, number>();
    for (const m of a.mov) contaA.set(chiaveM(m), (contaA.get(chiaveM(m)) ?? 0) + 1);
    const contaB = new Map<string, number>();
    for (const m of b.mov) {
      if (eliminati.has(m.id)) continue;
      const k = chiaveM(m);
      const n = (contaB.get(k) ?? 0) + 1;
      contaB.set(k, n);
      if (per.has(m.id)) continue;
      if (n > (contaA.get(k) ?? 0)) per.set(m.id, m);
    }
    const saldi = new Map<string, SaldoNoto>();
    for (const s of [...b.saldi, ...a.saldi]) saldi.set(s.data + "|" + s.conto, s);
    const imp = new Map<string, FileImportato>();
    for (const r of [...b.importati, ...a.importati]) imp.set(r.file, r);
    return new Registro([...per.values()], [...saldi.values()], [...imp.values()]);
  }
}

export { aggiungiGiorni };
