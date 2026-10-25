import { useMemo, useState } from "react";
import { chiave } from "../../core/categorie";
import { aggiungiCategoria } from "../../core/config";
import { formatoIt } from "../../core/date";
import { scriviCsv } from "../../core/formato";
import type { Movimento } from "../../core/tipi";
import { contiNoti, modifica, opzioniCategorie, stato, useVersione } from "../stato";
import { Avviso, Cifra, eur, Intestazione, Pannello, Pastiglie, Scelta, scaricaFile, segnoCls, Vuoto } from "../ui";

const PASSO = 100;

export default function Movimenti({ vai }: { vai: (p: string) => void }) {
  useVersione();
  const [conti, setConti] = useState<string[]>([]);
  const [categoria, setCategoria] = useState("");
  const [testo, setTesto] = useState("");
  const [dal, setDal] = useState("");
  const [al, setAl] = useState("");
  const [quanti, setQuanti] = useState(PASSO);
  const [aperto, setAperto] = useState<Movimento | null>(null);
  const [esito, setEsito] = useState("");
  const mov = stato.reg.mov;

  const filtrati = useMemo(() => {
    const t = testo.trim().toLowerCase();
    return mov.filter((m) => (!conti.length || conti.includes(m.conto)) && (!categoria || m.categoria === categoria)
      && (!dal || m.data >= dal) && (!al || m.data <= al) && (!t || m.descrizione.toLowerCase().includes(t)))
      .sort((a, b) => (a.data < b.data ? 1 : a.data > b.data ? -1 : 0));
  }, [mov, conti, categoria, testo, dal, al, stato.versione]);

  if (!mov.length) return <Vuoto titolo="Nessun movimento"><button className="primario" onClick={() => vai("importa")}>Importa estratti conto</button></Vuoto>;
  const entrate = filtrati.reduce((a, m) => a + (m.importo > 0 ? m.importo : 0), 0);
  const uscite = filtrati.reduce((a, m) => a + (m.importo < 0 ? -m.importo : 0), 0);
  const categorie = opzioniCategorie();
  const reset = () => setQuanti(PASSO);

  return (
    <div className="pagina">
      <Intestazione titolo="Movimenti">
        <button onClick={() => scaricaFile("movimenti_filtrati.csv", scriviCsv(["data", "conto", "descrizione", "importo", "categoria", "isin", "quote"],
          filtrati.map((m) => ({ ...m, importo: m.importo.toFixed(2), quote: m.quote ?? "" }))), "text/csv;charset=utf-8")}>Scarica CSV</button>
      </Intestazione>
      <div className="filtri">
        <Pastiglie etichetta="Conti" opzioni={contiNoti()} scelte={conti} cambia={(v) => { setConti(v); reset(); }} />
        <div className="riga-campi">
          <label className="campo largo"><span>Cerca nella descrizione</span>
            <input type="search" value={testo} onChange={(e) => { setTesto(e.target.value); reset(); }} placeholder="es. Esselunga, affitto…" /></label>
          <Scelta etichetta="Categoria" valore={categoria} opzioni={categorie} vuota="Tutte" cambia={(v) => { setCategoria(v); reset(); }} />
          <label className="campo"><span>Dal</span><input type="date" value={dal} onChange={(e) => { setDal(e.target.value); reset(); }} /></label>
          <label className="campo"><span>Al</span><input type="date" value={al} onChange={(e) => { setAl(e.target.value); reset(); }} /></label>
        </div>
      </div>
      <div className="cifre tre">
        <Cifra etichetta="Movimenti" valore={filtrati.length.toLocaleString("it-IT")} />
        <Cifra etichetta="Entrate" valore={eur(entrate)} cls="pos" />
        <Cifra etichetta="Uscite" valore={eur(uscite)} cls="neg" />
      </div>
      {esito && <Avviso tipo="ok">{esito}</Avviso>}
      <ul className="elenco-movimenti">
        {filtrati.slice(0, quanti).map((m) => (
          <li key={m.id}>
            <button type="button" onClick={() => setAperto(m)}>
              <span className="m-data">{formatoIt(m.data)}</span>
              <span className="m-desc">{m.descrizione}</span>
              <span className="m-meta"><span className="m-conto">{m.conto}</span>
                <span className="etichetta-cat">{m.manuale && <span aria-label="categoria fissata" title="Categoria fissata a mano">🔒 </span>}{m.categoria}</span></span>
              <span className={"m-importo num " + segnoCls(m.importo)}>{eur(m.importo, 2)}</span>
            </button>
          </li>
        ))}
      </ul>
      {filtrati.length > quanti && (
        <div className="pulsanti centro"><button onClick={() => setQuanti(quanti + PASSO * 5)}>Mostra altri ({(filtrati.length - quanti).toLocaleString("it-IT")} rimanenti)</button></div>
      )}
      <div className="pulsanti">
        <button onClick={() => { let n = 0; modifica(["mov"], () => { n = stato.reg.ricategorizza(stato.cfg); }); setEsito(`Regole applicate: ${n} movimenti cambiati.`); }}>
          Applica le regole ai movimenti non classificati</button>
      </div>
      <Pannello aperto={!!aperto} chiudi={() => setAperto(null)} titolo="Movimento">
        {aperto && <DettaglioMovimento m={aperto} chiudi={(msg) => { setAperto(null); if (msg) setEsito(msg); }} />}
      </Pannello>
    </div>
  );
}

export function DettaglioMovimento({ m, chiudi }: { m: Movimento; chiudi: (msg?: string) => void }) {
  const [cat, setCat] = useState(m.categoria);
  const [nuova, setNuova] = useState("");
  const esercente = chiave(m);
  const opzioni = opzioniCategorie();
  const scelta = nuova.trim() || cat;
  const salvaSolo = () => {
    modifica(["mov", "cfg"], () => { if (nuova.trim()) aggiungiCategoria(stato.cfg, nuova); stato.reg.fissa([m.id], scelta, true); });
    chiudi("Salvato. La categoria di questo movimento è fissata 🔒.");
  };
  const salvaTutti = () => {
    let n = 0;
    modifica(["mov", "cfg"], () => {
      if (nuova.trim()) aggiungiCategoria(stato.cfg, nuova);
      stato.reg.fissa([m.id], scelta, m.manuale);
      n = stato.reg.impara({ [esercente]: scelta }, stato.cfg);
    });
    chiudi(`Salvato. Aggiornati anche ${n} movimenti di ${esercente} (esclusi quelli con 🔒).`);
  };
  return (
    <div className="dettaglio">
      <dl>
        <dt>Data</dt><dd>{formatoIt(m.data)}</dd>
        <dt>Conto</dt><dd>{m.conto}</dd>
        <dt>Importo</dt><dd className={"num " + segnoCls(m.importo)}>{eur(m.importo, 2)}</dd>
        {m.isin && <><dt>Titolo</dt><dd>{m.isin}{m.quote !== null ? ` · ${m.quote.toLocaleString("it-IT", { maximumFractionDigits: 6 })} quote` : ""}</dd></>}
        <dt>Esercente</dt><dd>{esercente || "–"}</dd>
        <dt>Descrizione</dt><dd className="desc-lunga">{m.descrizione.split(" | ").map((r, i) => <span key={i}>{r}<br /></span>)}</dd>
        <dt>File</dt><dd className="tenue">{m.fonte}</dd>
      </dl>
      <Scelta etichetta="Categoria" valore={cat} opzioni={opzioni} cambia={setCat} />
      <label className="campo"><span>…oppure una categoria nuova</span><input value={nuova} onChange={(e) => setNuova(e.target.value)} placeholder="es. Famiglia, Viaggi" /></label>
      {m.manuale && <p className="nota">🔒 Categoria fissata a mano: le regole e l'apprendimento non la cambiano.</p>}
      <div className="pulsanti colonna">
        <button className="primario" onClick={salvaSolo} disabled={scelta === m.categoria && m.manuale}>Salva solo questo movimento</button>
        {esercente && !m.isin && <button onClick={salvaTutti} disabled={scelta === m.categoria && !nuova}>Salva per tutti i movimenti di {esercente}</button>}
        {m.manuale && <button className="testo" onClick={() => { modifica(["mov"], () => stato.reg.fissa([m.id], null, false)); chiudi("Sbloccato."); }}>Sblocca la categoria</button>}
      </div>
      <p className="nota">«Solo questo movimento» serve per le eccezioni, per esempio un bonifico con il tuo nome fatto da un'altra persona. «Tutti i movimenti» vale anche per i prossimi estratti conto.</p>
    </div>
  );
}
