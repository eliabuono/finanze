import { useMemo, useState } from "react";
import { nomeConto } from "../../core/conti";
import { addestra, daClassificare } from "../../core/categorie";
import { aggiungiCategoria } from "../../core/config";
import { aggiungiGiorni, oggi } from "../../core/date";
import { modifica, opzioniCategorie, stato, useVersione } from "../stato";
import { Avviso, eur, Intestazione, Scelta, Segmenti, Sezione, Vuoto } from "../ui";

export default function Allena({ vai }: { vai: (p: string) => void }) {
  useVersione();
  const [quanti, setQuanti] = useState(60);
  const [periodo, setPeriodo] = useState<"3" | "1" | "0">("3");
  const [scelte, setScelte] = useState<Record<string, string>>({});
  const [accetta, setAccetta] = useState(false);
  const [nuova, setNuova] = useState("");
  const [esito, setEsito] = useState("");
  const mov = stato.reg.mov;
  const def = new Set([stato.cfg.categoria_default_uscite, stato.cfg.categoria_default_entrate]);

  const tab = useMemo(() => {
    const mod = addestra(mov, def);
    const base = periodo === "0" ? mov : mov.filter((m) => m.data >= aggiungiGiorni(oggi(), -365 * +periodo));
    return daClassificare(base, def, mod, quanti);
  }, [mov, periodo, quanti, stato.versione]); // eslint-disable-line

  if (!mov.length) return <Vuoto titolo="Nessun movimento"><button className="primario" onClick={() => vai("importa")}>Importa estratti conto</button></Vuoto>;
  const opzioni = [...opzioniCategorie().filter((c) => !def.has(c)), ...[...def].sort()];
  const finali: Record<string, string> = { ...Object.fromEntries(Object.entries(scelte).filter(([, v]) => v)) };
  if (accetta) for (const r of tab) if (!finali[r.esercente] && r.suggerita && r.fiducia >= 0.8) finali[r.esercente] = r.suggerita;
  const daFare = mov.filter((m) => def.has(m.categoria)).length;

  return (
    <div className="pagina">
      <Intestazione titolo="Allena le categorie" />
      <p className="introduzione">Qui ci sono gli esercenti e le persone i cui movimenti non hanno ancora una categoria, dai più importanti (numero di movimenti e importo). Scegli la categoria: l'app la applica a tutti i loro movimenti e la ricorda per i prossimi estratti conto.</p>
      <div className="controlli">
        <Segmenti etichetta="Movimenti considerati" valore={periodo} cambia={setPeriodo}
          opzioni={[{ v: "1", t: "Ultimi 12 mesi" }, { v: "3", t: "Ultimi 3 anni" }, { v: "0", t: "Sempre" }] as { v: "3" | "1" | "0"; t: string }[]} />
        <Scelta etichetta="Quanti esercenti" valore={String(quanti)} opzioni={["20", "60", "120", "300"]} cambia={(v) => setQuanti(+v)} />
      </div>
      {esito && <Avviso tipo="ok">{esito}</Avviso>}
      {!tab.length ? <Avviso tipo="ok">Tutti i movimenti hanno una categoria.</Avviso> : <>
        <p className="nota">Movimenti ancora da classificare: {daFare.toLocaleString("it-IT")}. Questi {tab.length} esercenti ne coprono {tab.reduce((a, r) => a + r.movimenti, 0).toLocaleString("it-IT")}.</p>
        <ul className="elenco-allena">
          {tab.map((r) => (
            <li key={r.esercente}>
              <div className="a-testa">
                <strong>{r.esercente}</strong>
                <span className="tenue num">{r.movimenti} mov. · {eur(r.totale)}</span>
              </div>
              <div className="a-esempio tenue">{nomeConto(r.conto)}: {r.esempio}</div>
              <div className="a-scelta">
                <select aria-label={`Categoria per ${r.esercente}`} value={scelte[r.esercente] ?? ""} onChange={(e) => setScelte({ ...scelte, [r.esercente]: e.target.value })}>
                  <option value="">{r.suggerita ? `Suggerita: ${r.suggerita}` : "Scegli…"}</option>
                  {opzioni.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
                {r.suggerita && <span className="fiducia" title="Fiducia del suggerimento"><span style={{ width: `${r.fiducia * 100}%` }} /></span>}
                {r.suggerita && !scelte[r.esercente] && <button className="piccolo" onClick={() => setScelte({ ...scelte, [r.esercente]: r.suggerita })}>Usa</button>}
              </div>
            </li>
          ))}
        </ul>
        <div className="barra-azioni">
          <label className="spunta"><input type="checkbox" checked={accetta} onChange={(e) => setAccetta(e.target.checked)} /> Per le righe vuote usa la categoria suggerita se la fiducia è almeno 0,8</label>
          <button className="primario" disabled={!Object.keys(finali).length}
            onClick={() => { let n = 0; modifica(["mov", "cfg"], () => { n = stato.reg.impara(finali, stato.cfg); }); setEsito(`Imparati ${Object.keys(finali).length} esercenti, aggiornati ${n} movimenti.`); setScelte({}); }}>
            Impara {Object.keys(finali).length} esercenti</button>
        </div>
      </>}
      <Sezione titolo="Nuova categoria">
        <form className="riga-campi" onSubmit={(e) => { e.preventDefault(); if (nuova.trim()) { modifica(["cfg"], () => aggiungiCategoria(stato.cfg, nuova)); setNuova(""); } }}>
          <label className="campo largo"><span>Nome</span><input value={nuova} onChange={(e) => setNuova(e.target.value)} placeholder="es. Famiglia, Viaggi" /></label>
          <button type="submit" disabled={!nuova.trim()}>Aggiungi al menu</button>
        </form>
      </Sezione>
      <Imparati />
    </div>
  );
}

function Imparati() {
  const ap = stato.cfg.regole_apprese ?? {};
  const [mod, setMod] = useState<Record<string, string>>({});
  const opzioni = opzioniCategorie();
  const voci = Object.keys(ap).sort();
  const cambiati = Object.entries(mod).filter(([k, v]) => ap[k] !== v);
  return (
    <details className="dettagli">
      <summary>Esercenti già imparati ({voci.length})</summary>
      {!voci.length ? <p className="nota">Ancora nessuno.</p> : <>
        <ul className="elenco-imparati">
          {voci.map((k) => (
            <li key={k}>
              <span>{k}</span>
              <select aria-label={`Categoria di ${k}`} value={mod[k] ?? ap[k]} onChange={(e) => setMod({ ...mod, [k]: e.target.value })}>
                {[...new Set([ap[k], ...opzioni])].map((o) => <option key={o}>{o}</option>)}
              </select>
              <button className="piccolo" onClick={() => modifica(["mov", "cfg"], () => stato.reg.dimentica([k], stato.cfg))}>Dimentica</button>
            </li>
          ))}
        </ul>
        <div className="pulsanti"><button className="primario" disabled={!cambiati.length}
          onClick={() => { modifica(["mov", "cfg"], () => stato.reg.impara(Object.fromEntries(cambiati), stato.cfg)); setMod({}); }}>
          Salva {cambiati.length} modifiche</button></div>
        <p className="nota">«Dimentica» riporta i movimenti di quell'esercente alle regole generali.</p>
      </>}
    </details>
  );
}
