import { useRef, useState } from "react";
import { aggiungiCategoria } from "../../core/config";
import { formatoIt, oggi } from "../../core/date";
import { nativa } from "../azioni";
import { SERVIZIO } from "../ambiente";
import { VERSIONE_APP } from "../ambiente";
import { accedi, clientId, configurato, esci, impostaClientId, sincronizza, useSync } from "../sync";
import { FILE, modifica, opzioniCategorie, sostituisci, stato, testoDi, TUTTE, useVersione, type Parte } from "../stato";
import { Avviso, eur, Intestazione, Pastiglie, scaricaFile, Segmenti, Sezione } from "../ui";
import { gruppiSalvadanaio, type TipoSalvadanaio } from "../../core/collette";
import { installabile, installa } from "../pwa";
import { codiceAttivo, impostaCodice, impostaMinutiBlocco, minutiBlocco, togliCodice, verificaCodice } from "../privacy";

const CLASSI = ["Azionario", "Obbligazionario", "Oro", "Materie prime", "Liquidità", "Immobiliare", "Altro"];

export default function Impostazioni() {
  useVersione();
  const cfg = stato.cfg;
  const [nome, setNome] = useState(cfg.intestatario ?? "");
  const [esito, setEsito] = useState("");
  return (
    <div className="pagina">
      <Intestazione titolo="Impostazioni" />
      {esito && <Avviso tipo="ok">{esito}</Avviso>}

      <Sezione titolo="Il tuo nome" nota="Nome e cognome come compaiono negli estratti conto: serve a riconoscere i bonifici tra i tuoi conti come trasferimenti interni, che non sono né entrate né uscite.">
        <form className="riga-campi" onSubmit={(e) => {
          e.preventDefault();
          let n = 0;
          modifica(["cfg", "mov"], () => { stato.cfg.intestatario = nome.trim(); n = stato.reg.ricategorizza(stato.cfg); });
          setEsito(`Nome salvato. ${n ? `Ricategorizzati ${n} movimenti.` : ""}`);
        }}>
          <label className="campo largo"><span>Nome e cognome</span><input value={nome} onChange={(e) => setNome(e.target.value)} autoComplete="name" /></label>
          <button type="submit" disabled={nome.trim() === (cfg.intestatario ?? "")}>Salva nome</button>
        </form>
      </Sezione>

      <Cloud />
      <Strumenti />
      <Regole />
      <Macro />
      <Collette />
      <Codice />

      <Sezione titolo="Categorie escluse dall'analisi" nota="Non sono veri redditi o spese: per esempio i trasferimenti tra i tuoi conti e gli acquisti di ETF.">
        <Pastiglie etichetta="Categorie escluse" opzioni={opzioniCategorie()} scelte={cfg.categorie_escluse}
          cambia={(v) => modifica(["cfg"], () => { stato.cfg.categorie_escluse = v; })} />
      </Sezione>

      <Prezzi />
      <Dati setEsito={setEsito} />

      <Sezione titolo="Ricalcola le categorie">
        <p className="nota">Riapplica regole ed esercenti imparati a tutti i movimenti. Le categorie cambiate a mano vengono sovrascritte, tranne quelle fissate con il lucchetto 🔒.</p>
        <button onClick={() => { if (!confirm("Ricalcolare la categoria di tutti i movimenti?")) return; let n = 0; modifica(["mov"], () => { n = stato.reg.ricategorizza(stato.cfg, false); }); setEsito(`Categorie ricalcolate: ${n} movimenti cambiati.`); }}>
          Riapplica le regole a tutti i movimenti</button>
      </Sezione>

      <Sezione titolo="Installa l'app">
        {nativa() ? <p className="nota">Stai usando l'app installata.</p> : <>
          <p className="nota">Puoi usare Finanze come un'app, con la sua icona e anche senza rete. Su iPhone: in Safari tocca Condividi e poi «Aggiungi alla schermata Home». Su Android: nel menu di Chrome «Installa app». Sul PC: l'icona di installazione nella barra degli indirizzi di Chrome o Edge.</p>
          {installabile() && <button className="primario" onClick={installa}>Installa Finanze</button>}
        </>}
        <p className="nota tenue">Versione {VERSIONE_APP}</p>
      </Sezione>
    </div>
  );
}

function Cloud() {
  const s = useSync();
  const [id, setId] = useState(clientId());
  const [errore, setErrore] = useState("");
  const vai = () => accedi().catch((e) => setErrore(String(e.message ?? e)));
  const quando = s.ultimo ? new Date(s.ultimo).toLocaleString("it-IT", { dateStyle: "short", timeStyle: "short" }) : "";
  return (
    <Sezione titolo="Google Drive" nota="Con Google Drive telefono e PC usano gli stessi dati: i file stanno nella cartella «Finanze» del tuo Drive, nello stesso formato della versione per PC. L'app vede solo i file che crea lei, non il resto del Drive. Senza Google Drive i dati restano solo su questo dispositivo.">
      {(s.stato === "collegato" || s.stato === "sincronizzo" || s.stato === "senza rete") && (
        <Avviso tipo="ok">Collegato{s.utente ? ` come ${s.utente}` : ""}. {s.stato === "sincronizzo" ? "Sincronizzo…" : s.stato === "senza rete" ? "Senza rete: sincronizzo appena torna." : quando ? `Ultima sincronizzazione ${quando}.` : ""}</Avviso>
      )}
      {s.stato === "scaduto" && <Avviso tipo="attenzione">Google non concede più l'accesso (per esempio è stato revocato dall'account Google). Le modifiche restano qui e vengono caricate appena ti ricolleghi.</Avviso>}
      {s.stato === "errore" && <Avviso tipo="errore">{s.errore}</Avviso>}
      {errore && <Avviso tipo="errore">{errore}</Avviso>}
      {!configurato() && <Avviso tipo="attenzione">Google Drive non è ancora configurato in questa versione dell'app (manca l'ID client di Google o l'indirizzo del servizio: vedi LEGGIMI).</Avviso>}
      <div className="pulsanti">
        {(s.stato === "non collegato" || s.stato === "errore" || s.stato === "scaduto") && <button className="primario" onClick={vai} disabled={!configurato()}>{s.stato === "scaduto" ? "Ricollega Google Drive" : "Collega Google Drive"}</button>}
        {s.stato !== "non collegato" && s.stato !== "scaduto" && <button onClick={() => sincronizza()} disabled={s.stato === "sincronizzo"}>Sincronizza ora</button>}
        {s.stato !== "non collegato" && <button className="testo" onClick={() => esci()}>Scollega</button>}
      </div>
      <details className="dettagli">
        <summary>Configurazione per chi pubblica l'app</summary>
        <p className="nota">ID client OAuth di Google (console.cloud.google.com) e indirizzo del servizio (sezione «Prezzi degli ETF»). Di solito sono già scritti nell'app pubblicata.</p>
        <form className="riga-campi" onSubmit={(e) => { e.preventDefault(); impostaClientId(id); setErrore(""); }}>
          <label className="campo largo"><span>ID client di Google</span><input value={id} onChange={(e) => setId(e.target.value)} placeholder="1234567890-abc….apps.googleusercontent.com" spellCheck={false} /></label>
          <button type="submit" disabled={id.trim() === clientId()}>Salva ID</button>
        </form>
        <p className="nota">Origine JavaScript autorizzata: <code>{location.origin}</code><br />URI di reindirizzamento autorizzato: <code>{location.origin + location.pathname}</code></p>
      </details>
    </Sezione>
  );
}

function Strumenti() {
  const strum = stato.cfg.strumenti;
  const [nuovo, setNuovo] = useState("");
  const cambia = (isin: string, campo: string, valore: any) => modifica(["cfg"], () => { (stato.cfg.strumenti[isin] as any)[campo] = valore; });
  const n = (s: string) => { const v = Number(s.replace(",", ".")); return s.trim() === "" || !Number.isFinite(v) ? null : v; };
  return (
    <Sezione titolo="Strumenti" nota="Gli ETF trovati negli estratti conto. Ticker Yahoo: lascia vuoto per cercarlo dall'ISIN (preferendo Xetra e Borsa Italiana); se Yahoo non lo trova i prezzi vengono presi da justETF, oppure scrivi «justetf» per usare sempre justETF. Il prezzo manuale serve solo se nessuna delle due fonti trova lo strumento.">
      <ul className="elenco-strumenti">
        {Object.entries(strum).map(([isin, s]) => (
          <li key={isin}>
            <div className="s-isin"><strong>{s.nome || isin}</strong> <span className="tenue">{isin}</span></div>
            <div className="riga-campi">
              <label className="campo"><span>Nome breve</span><input defaultValue={s.nome} onBlur={(e) => e.target.value !== s.nome && cambia(isin, "nome", e.target.value.trim() || isin)} /></label>
              <label className="campo"><span>Classe</span>
                <select value={s.classe} onChange={(e) => cambia(isin, "classe", e.target.value)}>
                  {[...new Set([...CLASSI, s.classe])].map((c) => <option key={c}>{c}</option>)}
                </select></label>
              <label className="campo"><span>Ticker Yahoo</span><input defaultValue={s.ticker} placeholder="automatico" onBlur={(e) => e.target.value !== s.ticker && cambia(isin, "ticker", e.target.value.trim())} spellCheck={false} /></label>
              <label className="campo stretto"><span>Obiettivo %</span><input inputMode="decimal" defaultValue={s.obiettivo === null || s.obiettivo === undefined ? "" : String(+(s.obiettivo * 100).toFixed(2)).replace(".", ",")}
                onBlur={(e) => { const v = n(e.target.value); cambia(isin, "obiettivo", v === null ? null : v / 100); }} /></label>
              <label className="campo stretto"><span>Prezzo manuale €</span><input inputMode="decimal" defaultValue={s.prezzo_manuale ? String(s.prezzo_manuale).replace(".", ",") : ""}
                onBlur={(e) => cambia(isin, "prezzo_manuale", n(e.target.value))} /></label>
            </div>
            <button className="piccolo testo" onClick={() => { if (confirm(`Togliere ${s.nome} dagli strumenti?`)) modifica(["cfg"], () => { delete stato.cfg.strumenti[isin]; }); }}>Togli</button>
          </li>
        ))}
      </ul>
      <form className="riga-campi" onSubmit={(e) => {
        e.preventDefault();
        const isin = nuovo.trim().toUpperCase();
        if (!/^[A-Z]{2}[A-Z0-9]{9}\d$/.test(isin) || strum[isin]) return;
        modifica(["cfg"], () => { stato.cfg.strumenti[isin] = { nome: isin, classe: "Altro", ticker: "", obiettivo: null }; });
        setNuovo("");
      }}>
        <label className="campo"><span>Aggiungi per ISIN</span><input value={nuovo} onChange={(e) => setNuovo(e.target.value)} placeholder="IE00B4L5Y983" spellCheck={false} /></label>
        <button type="submit" disabled={!/^[A-Z]{2}[A-Z0-9]{9}\d$/.test(nuovo.trim().toUpperCase())}>Aggiungi</button>
      </form>
    </Sezione>
  );
}

function Regole() {
  const regole = stato.cfg.regole_categorie;
  const [nuova, setNuova] = useState("");
  const sposta = (i: number, d: number) => modifica(["cfg"], () => { const r = stato.cfg.regole_categorie; const [x] = r.splice(i, 1); r.splice(i + d, 0, x); });
  return (
    <Sezione titolo="Regole di categoria" nota="Se la descrizione di un movimento contiene una delle parole chiave (separate da virgole), il movimento va in quella categoria. Le regole valgono dall'alto in basso: vince la prima che corrisponde. Gli esercenti imparati vincono sulle regole.">
      <ul className="elenco-regole">
        {regole.map(([cat, parole], i) => (
          <li key={cat}>
            <div className="r-testa">
              <strong>{cat}</strong>
              <span className="r-azioni">
                <button className="piccolo" aria-label={`Sposta ${cat} su`} disabled={i === 0} onClick={() => sposta(i, -1)}>↑</button>
                <button className="piccolo" aria-label={`Sposta ${cat} giù`} disabled={i === regole.length - 1} onClick={() => sposta(i, 1)}>↓</button>
                <button className="piccolo testo" onClick={() => { if (confirm(`Eliminare la regola «${cat}»? I movimenti già classificati restano come sono.`)) modifica(["cfg"], () => { stato.cfg.regole_categorie.splice(i, 1); }); }}>Elimina</button>
              </span>
            </div>
            <textarea aria-label={`Parole chiave per ${cat}`} rows={2} defaultValue={parole.join(", ")}
              onBlur={(e) => { const v = e.target.value.split(",").map((x) => x.trim()).filter(Boolean); if (v.join(",") !== parole.join(",")) modifica(["cfg"], () => { stato.cfg.regole_categorie[i] = [cat, v]; }); }} />
          </li>
        ))}
      </ul>
      <form className="riga-campi" onSubmit={(e) => { e.preventDefault(); modifica(["cfg"], () => aggiungiCategoria(stato.cfg, nuova)); setNuova(""); }}>
        <label className="campo largo"><span>Nuova categoria</span><input value={nuova} onChange={(e) => setNuova(e.target.value)} /></label>
        <button type="submit" disabled={!nuova.trim()}>Aggiungi</button>
      </form>
      <p className="nota">Dopo aver cambiato le regole usa «Applica le regole» in Movimenti (solo i non classificati) o «Riapplica a tutti» qui sotto.</p>
    </Sezione>
  );
}

function Prezzi() {
  const [url, setUrl] = useState(stato.cfg.proxy_prezzi ?? "");
  return (
    <Sezione titolo="Servizio e prezzi degli ETF" nota={nativa() ? "Nell'app installata i prezzi arrivano direttamente da Yahoo Finance e justETF." :
      "Il browser non può chiedere i prezzi direttamente a Yahoo Finance e justETF: passa da un piccolo servizio gratuito (un Cloudflare Worker, istruzioni nel LEGGIMI), lo stesso che serve per collegare Google Drive. Senza, il valore degli ETF usa il prezzo dell'ultimo acquisto."}>
      <form className="riga-campi" onSubmit={(e) => { e.preventDefault(); modifica(["cfg"], () => { stato.cfg.proxy_prezzi = url.trim(); }); }}>
        <label className="campo largo"><span>Indirizzo del servizio</span><input type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://prezzi.tuonome.workers.dev" spellCheck={false} /></label>
        <button type="submit" disabled={url.trim() === (stato.cfg.proxy_prezzi ?? "")}>Salva</button>
      </form>
      {!stato.cfg.proxy_prezzi && SERVIZIO && <p className="nota">In uso il servizio dell'app: {SERVIZIO}</p>}
    </Sezione>
  );
}

function Dati({ setEsito }: { setEsito: (s: string) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [errore, setErrore] = useState("");
  const backup = async () => {
    const JSZip = (await import("jszip")).default;
    const z = new JSZip();
    for (const p of TUTTE) z.file(FILE[p], testoDi(p));
    scaricaFile(`finanze_backup_${oggi()}.zip`, await z.generateAsync({ type: "blob" }), "application/zip");
  };
  const ripristina = async (files: File[]) => {
    setErrore("");
    const t: Partial<Record<Parte, string>> = {};
    const perNome = Object.fromEntries(TUTTE.map((p) => [FILE[p], p])) as Record<string, Parte>;
    try {
      for (const f of files) {
        if (f.name.toLowerCase().endsWith(".zip")) {
          const JSZip = (await import("jszip")).default;
          const z = await JSZip.loadAsync(f);
          for (const [n, e] of Object.entries(z.files)) {
            const base = n.split("/").pop()!;
            if (perNome[base] && !e.dir) t[perNome[base]] = await e.async("string");
          }
        } else if (perNome[f.name]) t[perNome[f.name]] = await f.text();
      }
      if (!Object.keys(t).length) { setErrore("Nessun file riconosciuto. Servono movimenti.txt, saldi_noti.txt, importati.txt, config.json (e prezzi_cache.csv) oppure un backup .zip."); return; }
      if (!confirm(`Sostituire i dati di questo dispositivo con ${Object.keys(t).map((p) => FILE[p as Parte]).join(", ")}?`)) return;
      sostituisci(t);
      modifica(Object.keys(t) as Parte[], () => { stato.reg.ripara(stato.cfg); });
      setEsito(`Dati caricati: ${stato.reg.mov.length.toLocaleString("it-IT")} movimenti.`);
    } catch (e: any) { setErrore(String(e?.message ?? e)); }
    if (input.current) input.current.value = "";
  };
  return (
    <Sezione titolo="Dati e backup" nota="Puoi caricare qui i file della cartella «dati» della versione per PC (movimenti.txt, saldi_noti.txt, importati.txt, config.json, prezzi_cache.csv), selezionandoli tutti insieme, oppure un backup .zip.">
      {errore && <Avviso tipo="errore">{errore}</Avviso>}
      <input ref={input} type="file" multiple hidden accept=".txt,.json,.csv,.zip,text/plain,application/json,application/zip" onChange={(e) => ripristina([...(e.target.files ?? [])])} />
      <div className="pulsanti">
        <button onClick={backup}>Scarica backup (.zip)</button>
        <button onClick={() => input.current?.click()}>Carica dati o backup</button>
        <button className="testo pericolo" onClick={() => {
          if (!confirm("Cancellare tutti i movimenti, i saldi e i file importati da questo dispositivo? (Le regole e le impostazioni restano. Se Google Drive è collegato, la cancellazione arriva anche lì.)")) return;
          modifica(["mov", "saldi", "imp"], () => { stato.reg.mov = []; stato.reg.saldi = []; stato.reg.importati = []; });
          setEsito("Movimenti cancellati.");
        }}>Cancella i movimenti</button>
      </div>
    </Sezione>
  );
}

// ------------------------------------------------------------------ macro-categorie
const PROPOSTA_MACRO: Record<string, string> = {
  "Supermercato": "Cibo", "Bar e ristoranti": "Cibo",
  "Affitto": "Casa", "Casa e utenze": "Casa",
  "Trasporti": "Trasporti", "Viaggi": "Viaggi e tempo libero", "Sport e tempo libero": "Viaggi e tempo libero",
  "Telefono e abbonamenti": "Acquisti e abbonamenti", "Acquisti online": "Acquisti e abbonamenti", "Abbigliamento": "Acquisti e abbonamenti",
  "Salute": "Salute", "Tasse e imposte": "Tasse e banca", "Commissioni banca": "Tasse e banca",
  "Stipendio": "Redditi", "Interessi e premi": "Redditi",
};

function Macro() {
  const macro = stato.cfg.macro_categorie ?? {};
  const categorie = opzioniCategorie().filter((c) => !stato.cfg.categorie_escluse.includes(c));
  const esistenti = [...new Set(Object.values(macro).filter(Boolean))].sort((a, b) => a.localeCompare(b, "it"));
  const cambia = (cat: string, v: string) => modifica(["cfg"], () => {
    const m = { ...(stato.cfg.macro_categorie ?? {}) };
    if (v.trim()) m[cat] = v.trim(); else delete m[cat];
    stato.cfg.macro_categorie = m;
  });
  return (
    <Sezione titolo="Macro-categorie" nota="Raggruppa più categorie in una macro-categoria (per esempio Supermercato e Bar e ristoranti in «Cibo») per avere torte e grafici più leggibili in Entrate e uscite. Le categorie senza macro restano come sono.">
      <datalist id="macro-esistenti">{esistenti.map((m) => <option key={m} value={m} />)}</datalist>
      <ul className="elenco-macro">
        {categorie.map((c) => (
          <li key={c + (macro[c] ?? "")}>
            <span>{c}</span>
            <input list="macro-esistenti" defaultValue={macro[c] ?? ""} placeholder="nessuna" aria-label={`Macro-categoria di ${c}`}
              onBlur={(e) => { if (e.target.value.trim() !== (macro[c] ?? "")) cambia(c, e.target.value); }} />
          </li>
        ))}
      </ul>
      <div className="pulsanti">
        <button onClick={() => modifica(["cfg"], () => {
          const m = { ...(stato.cfg.macro_categorie ?? {}) };
          for (const c of categorie) if (!m[c] && PROPOSTA_MACRO[c]) m[c] = PROPOSTA_MACRO[c];
          stato.cfg.macro_categorie = m;
        })}>Proponi un raggruppamento</button>
        {Object.keys(macro).length > 0 && <button className="testo" onClick={() => { if (confirm("Togliere tutte le macro-categorie?")) modifica(["cfg"], () => { stato.cfg.macro_categorie = {}; }); }}>Togli tutte</button>}
      </div>
    </Sezione>
  );
}

// ------------------------------------------------------------------ salvadanai e collette Satispay
function Collette() {
  const gruppi = gruppiSalvadanaio(stato.reg.mov, stato.cfg);
  if (!gruppi.length) return null;
  const scegli = (nome: string, t: TipoSalvadanaio) => modifica(["cfg", "mov"], () => {
    stato.cfg.salvadanai_satispay = { ...(stato.cfg.salvadanai_satispay ?? {}), [nome]: t };
    stato.reg.allineaSalvadanai(stato.cfg);
  });
  const personale = gruppi.filter((g) => g.tipo === "personale").reduce((a, g) => a + g.versato - g.prelevato, 0);
  return (
    <Sezione titolo="Salvadanai e collette Satispay" nota="Il salvadanaio personale (dove vanno gli spiccioli) è un conto tuo: i soldi che ci metti sono un trasferimento interno. Le collette no: non sono un conto e per entrate e uscite ognuna conta solo per la differenza tra quanto hai prelevato e quanto hai versato (se prelevi di più è un'entrata, se prelevi di meno è una spesa), nella categoria «Collette». L'app le riconosce dal nome; qui puoi correggerla.">
      {personale < -0.5 && <Avviso tipo="attenzione">Il salvadanaio personale risulta in rosso ({eur(personale, 2)}): probabilmente una delle voci segnate come personale è una colletta.</Avviso>}
      <ul className="elenco-collette">
        {gruppi.map((g) => {
          const netto = g.prelevato - g.versato;
          return (
            <li key={g.nome}>
              <div>
                <strong>{g.etichetta}</strong>
                <div className="tenue piccolo-testo">{g.n} movimenti, {formatoIt(g.dal)} – {formatoIt(g.al)} · versati {eur(g.versato, 2)}, prelevati {eur(g.prelevato, 2)}
                  {g.tipo === "colletta" ? ` · ${netto >= 0 ? "entrata" : "spesa"} di ${eur(Math.abs(netto), 2)}` : ""}</div>
              </div>
              <Segmenti etichetta={`Tipo di ${g.etichetta}`} valore={g.tipo} cambia={(t) => scegli(g.nome, t)}
                opzioni={[{ v: "personale", t: "Personale" }, { v: "colletta", t: "Colletta" }] as { v: TipoSalvadanaio; t: string }[]} />
            </li>
          );
        })}
      </ul>
    </Sezione>
  );
}

// ------------------------------------------------------------------ codice di accesso
function Codice() {
  const [attivo, setAttivo] = useState(codiceAttivo());
  const [nuovo, setNuovo] = useState("");
  const [ripeti, setRipeti] = useState("");
  const [attuale, setAttuale] = useState("");
  const [msg, setMsg] = useState("");
  const valido = /^\d{4,8}$/.test(nuovo) && nuovo === ripeti;
  return (
    <Sezione titolo="Codice di accesso" nota="Facoltativo: se lo imposti, l'app lo chiede all'apertura su questo dispositivo (ogni dispositivo ha il suo). Protegge da chi prende in mano il telefono o il PC, ma non cifra i dati salvati.">
      {msg && <Avviso tipo="ok">{msg}</Avviso>}
      {!attivo ? (
        <form className="riga-campi" onSubmit={async (e) => { e.preventDefault(); if (!valido) return; await impostaCodice(nuovo, 1); setAttivo(true); setNuovo(""); setRipeti(""); setMsg("Codice attivato."); }}>
          <label className="campo"><span>Nuovo codice (4–8 cifre)</span><input type="password" inputMode="numeric" autoComplete="new-password" value={nuovo} onChange={(e) => setNuovo(e.target.value.replace(/\D/g, ""))} /></label>
          <label className="campo"><span>Ripeti il codice</span><input type="password" inputMode="numeric" autoComplete="new-password" value={ripeti} onChange={(e) => setRipeti(e.target.value.replace(/\D/g, ""))} /></label>
          <button type="submit" className="primario" disabled={!valido}>Attiva il codice</button>
        </form>
      ) : (<>
        <label className="campo stretto"><span>Richiedi il codice dopo</span>
          <select defaultValue={String(minutiBlocco())} onChange={(e) => impostaMinutiBlocco(Number(e.target.value))}>
            <option value="0">ogni volta che torni all'app</option>
            <option value="1">1 minuto fuori dall'app</option>
            <option value="5">5 minuti</option>
            <option value="15">15 minuti</option>
            <option value="60">1 ora</option>
          </select>
        </label>
        <form className="riga-campi" onSubmit={async (e) => {
          e.preventDefault();
          if (!(await verificaCodice(attuale))) { setMsg(""); alert("Codice attuale errato."); return; }
          togliCodice(); setAttivo(false); setAttuale(""); setMsg("Codice tolto: l'app si apre senza codice.");
        }}>
          <label className="campo"><span>Codice attuale</span><input type="password" inputMode="numeric" autoComplete="current-password" value={attuale} onChange={(e) => setAttuale(e.target.value.replace(/\D/g, ""))} /></label>
          <button type="submit" disabled={attuale.length < 4}>Togli il codice</button>
        </form>
        <p className="nota">Per cambiarlo: toglilo e impostane uno nuovo.</p>
      </>)}
    </Sezione>
  );
}
