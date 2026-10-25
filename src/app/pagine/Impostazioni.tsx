import { useRef, useState } from "react";
import { aggiungiCategoria } from "../../core/config";
import { oggi } from "../../core/date";
import { nativa, proxyPrezzi } from "../azioni";
import { VERSIONE_APP } from "../ambiente";
import { accedi, clientId, esci, impostaClientId, sincronizza, useSync } from "../onedrive";
import { FILE, modifica, opzioniCategorie, sostituisci, stato, testoDi, TUTTE, useVersione, type Parte } from "../stato";
import { Avviso, Intestazione, Pastiglie, scaricaFile, Sezione } from "../ui";
import { installabile, installa } from "../pwa";

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

      <OneDrive />
      <Strumenti />
      <Regole />

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

function OneDrive() {
  const s = useSync();
  const [id, setId] = useState(clientId());
  const [errore, setErrore] = useState("");
  const vai = (silenzioso = false) => accedi(silenzioso).catch((e) => setErrore(String(e.message ?? e)));
  const quando = s.ultimo ? new Date(s.ultimo).toLocaleString("it-IT", { dateStyle: "short", timeStyle: "short" }) : "";
  return (
    <Sezione titolo="OneDrive" nota="Con OneDrive telefono e PC usano gli stessi dati: i file stanno nella cartella App/Finanze del tuo OneDrive, nello stesso formato della versione per PC. Senza OneDrive i dati restano solo su questo dispositivo.">
      {(s.stato === "collegato" || s.stato === "sincronizzo" || s.stato === "senza rete") && (
        <Avviso tipo="ok">Collegato{s.utente ? ` come ${s.utente}` : ""}. {s.stato === "sincronizzo" ? "Sincronizzo…" : s.stato === "senza rete" ? "Senza rete: sincronizzo appena torna." : quando ? `Ultima sincronizzazione ${quando}.` : ""}</Avviso>
      )}
      {s.stato === "scaduto" && <Avviso tipo="attenzione">L'accesso a OneDrive è scaduto (Microsoft lo chiede di nuovo dopo circa un giorno). Le modifiche restano qui e vengono caricate appena ti ricolleghi.</Avviso>}
      {s.stato === "errore" && <Avviso tipo="errore">{s.errore}</Avviso>}
      {errore && <Avviso tipo="errore">{errore}</Avviso>}
      <div className="pulsanti">
        {(s.stato === "non collegato" || s.stato === "errore" || s.stato === "scaduto") && <button className="primario" onClick={() => vai()} disabled={!clientId()}>{s.stato === "scaduto" ? "Ricollega OneDrive" : "Collega OneDrive"}</button>}
        {s.stato !== "non collegato" && s.stato !== "scaduto" && <button onClick={() => sincronizza()} disabled={s.stato === "sincronizzo"}>Sincronizza ora</button>}
        {s.stato !== "non collegato" && <button className="testo" onClick={() => esci()}>Scollega</button>}
      </div>
      <details className="dettagli">
        <summary>ID applicazione Microsoft</summary>
        <p className="nota">Serve una sola volta per chi pubblica l'app: è l'«ID applicazione (client)» della registrazione su portal.azure.com (istruzioni nel file LEGGIMI).</p>
        <form className="riga-campi" onSubmit={(e) => { e.preventDefault(); impostaClientId(id); setErrore(""); }}>
          <label className="campo largo"><span>ID applicazione (client)</span><input value={id} onChange={(e) => setId(e.target.value)} placeholder="00000000-0000-0000-0000-000000000000" spellCheck={false} /></label>
          <button type="submit" disabled={id.trim() === clientId()}>Salva ID</button>
        </form>
        <p className="nota">Indirizzo di reindirizzamento da registrare (piattaforma «Applicazione a pagina singola»): <code>{location.origin + location.pathname}</code></p>
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
    <Sezione titolo="Prezzi degli ETF" nota={nativa() ? "Nell'app installata i prezzi arrivano direttamente da Yahoo Finance e justETF." :
      "Il browser non può chiedere i prezzi direttamente a Yahoo Finance e justETF: serve un piccolo intermediario gratuito (un Cloudflare Worker, istruzioni nel LEGGIMI). Senza, il valore degli ETF usa il prezzo dell'ultimo acquisto."}>
      <form className="riga-campi" onSubmit={(e) => { e.preventDefault(); modifica(["cfg"], () => { stato.cfg.proxy_prezzi = url.trim(); }); }}>
        <label className="campo largo"><span>Indirizzo dell'intermediario</span><input type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://prezzi.tuonome.workers.dev" spellCheck={false} /></label>
        <button type="submit" disabled={url.trim() === (stato.cfg.proxy_prezzi ?? "")}>Salva</button>
      </form>
      {!stato.cfg.proxy_prezzi && proxyPrezzi() && <p className="nota">In uso l'intermediario predefinito dell'app.</p>}
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
          if (!confirm("Cancellare tutti i movimenti, i saldi e i file importati da questo dispositivo? (Le regole e le impostazioni restano. Se OneDrive è collegato, la cancellazione arriva anche lì.)")) return;
          modifica(["mov", "saldi", "imp"], () => { stato.reg.mov = []; stato.reg.saldi = []; stato.reg.importati = []; });
          setEsito("Movimenti cancellati.");
        }}>Cancella i movimenti</button>
      </div>
    </Sezione>
  );
}
