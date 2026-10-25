import { useMemo, useState } from "react";
import { perCategoria, type Frequenza } from "../../core/analisi";
import { chiave, controlloTrasferimenti } from "../../core/categorie";
import { aggiungiGiorni, formatoIt, oggi } from "../../core/date";
import { Ciambella, GraficoBarre, PALETTE } from "../grafici";
import { contiNoti, modifica, stato, useVersione } from "../stato";
import { Avviso, Cifra, etichettaMese, eur, Intestazione, Pastiglie, pct, Scelta, Segmenti, Sezione, segnoCls, useMemoria, Vuoto } from "../ui";

type Vista = "Uscite" | "Entrate" | "Dettaglio" | "Trasferimenti";

export default function Spese({ vai }: { vai: (p: string) => void }) {
  useVersione();
  const mov = stato.reg.mov;
  const tuttiConti = contiNoti();
  const [dal, setDal] = useState(() => aggiungiGiorni(oggi(), -365));
  const [al, setAl] = useState(oggi());
  const [freq, setFreq] = useMemoria<Frequenza>("spese:freq", "M");
  const [conti, setConti] = useState<string[]>(() => tuttiConti.filter((c) => c !== "Intesa Salvadanaio"));
  const [vista, setVista] = useMemoria<Vista>("spese:vista", "Uscite");
  const [catDett, setCatDett] = useState("");
  const compensa = stato.cfg.compensa_rimborsi ?? true;

  const f = useMemo(() => mov.filter((m) => (!conti.length || conti.includes(m.conto)) && m.data >= dal && m.data <= al),
    [mov, conti, dal, al, stato.versione]);
  const pc = useMemo(() => perCategoria(f, stato.cfg.categorie_escluse, freq, compensa), [f, freq, compensa, stato.versione]);
  if (!mov.length) return <Vuoto titolo="Nessun movimento"><button className="primario" onClick={() => vai("importa")}>Importa estratti conto</button></Vuoto>;

  const somma = (t: Record<string, number[]>) => Object.values(t).reduce((a, v) => a + v.reduce((x, y) => x + y, 0), 0);
  const E = somma(pc.entrate), U = somma(pc.uscite);
  const etP = freq === "M" ? etichettaMese : (p: string) => p.slice(0, 4);
  const categorieF = [...new Set(f.map((m) => m.categoria))].sort((a, b) => a.localeCompare(b, "it"));
  const cd = catDett || categorieF[0] || "";

  const tabella = (t: Record<string, number[]>) => {
    const voci = Object.entries(t).map(([nome, v]) => ({ nome, valore: v.reduce((a, b) => a + b, 0) })).sort((a, b) => b.valore - a.valore);
    const colore = new Map(voci.map((v, i) => [v.nome, PALETTE[i % PALETTE.length]]));
    return { voci: voci.map((v) => ({ ...v, colore: colore.get(v.nome)! })), serie: voci.map((v) => ({ nome: v.nome, valori: t[v.nome], colore: colore.get(v.nome)! })) };
  };

  return (
    <div className="pagina">
      <Intestazione titolo="Entrate e uscite" />
      <div className="filtri">
        <div className="riga-campi">
          <label className="campo"><span>Dal</span><input type="date" value={dal} onChange={(e) => setDal(e.target.value)} /></label>
          <label className="campo"><span>Al</span><input type="date" value={al} onChange={(e) => setAl(e.target.value)} /></label>
          <div className="campo"><span>Raggruppa per</span><Segmenti etichetta="Raggruppa per" valore={freq} opzioni={[{ v: "M", t: "Mese" }, { v: "Y", t: "Anno" }] as { v: Frequenza; t: string }[]} cambia={setFreq} /></div>
        </div>
        <Pastiglie etichetta="Conti" opzioni={tuttiConti} scelte={conti} cambia={setConti} />
        <label className="spunta">
          <input type="checkbox" checked={compensa} onChange={(e) => modifica(["cfg"], () => { stato.cfg.compensa_rimborsi = e.target.checked; })} />
          Compensa i rimborsi nella stessa categoria (il coinquilino che ti ridà la sua parte d'affitto, un reso, l'amico che ti restituisce i soldi)
        </label>
      </div>
      <div className="cifre tre">
        <Cifra etichetta="Entrate" valore={eur(E)} cls="pos" />
        <Cifra etichetta="Uscite" valore={eur(U)} cls="neg" />
        <Cifra etichetta="Risparmio" valore={eur(E - U)} cls={segnoCls(E - U)} nota={E ? `${pct((E - U) / E)} delle entrate` : undefined} />
      </div>
      <p className="nota">Esclusi dal calcolo: {stato.cfg.categorie_escluse.join(", ")} (si cambia in Impostazioni).</p>

      <Sezione>
        <Segmenti etichetta="Vista" valore={vista} opzioni={["Uscite", "Entrate", "Dettaglio", "Trasferimenti"] as const} cambia={setVista} />
        {(vista === "Uscite" || vista === "Entrate") && (() => {
          const { voci, serie } = tabella(vista === "Uscite" ? pc.uscite : pc.entrate);
          const n = Math.max(pc.periodi.length, 1);
          return <>
            <GraficoBarre periodi={pc.periodi} serie={serie} etichettaPeriodo={etP} formatoFumetto={(v) => eur(v)} />
            <div className="due-colonne">
              <Ciambella titolo={vista} voci={voci} formato={(v) => eur(v)} />
              <div className="tabella-scorre">
                <table className="tabella">
                  <thead><tr><th>Categoria</th><th className="n">Totale</th><th className="n">Media per {freq === "M" ? "mese" : "anno"}</th></tr></thead>
                  <tbody>{voci.map((v) => (
                    <tr key={v.nome} className="cliccabile" onClick={() => { setCatDett(v.nome); setVista("Dettaglio"); }}>
                      <td><span className="campione" style={{ background: v.colore }} />{v.nome}</td>
                      <td className="n num">{eur(v.valore)}</td><td className="n num">{eur(v.valore / n)}</td></tr>
                  ))}</tbody>
                </table>
              </div>
            </div>
          </>;
        })()}
        {vista === "Dettaglio" && <>
          <div className="controlli"><Scelta etichetta="Categoria" valore={cd} opzioni={categorieF} cambia={setCatDett} /></div>
          <ul className="elenco-movimenti compatto">
            {f.filter((m) => m.categoria === cd).sort((a, b) => (a.data < b.data ? 1 : -1)).slice(0, 500).map((m) => (
              <li key={m.id}><div className="riga-mov">
                <span className="m-data">{formatoIt(m.data)}</span><span className="m-desc">{m.descrizione}</span>
                <span className="m-meta"><span className="m-conto">{m.conto}</span></span>
                <span className={"m-importo num " + segnoCls(m.importo)}>{eur(m.importo, 2)}</span></div></li>
            ))}
          </ul>
        </>}
        {vista === "Trasferimenti" && <Trasferimenti />}
      </Sezione>
    </div>
  );
}

function Trasferimenti() {
  const ctr = useMemo(() => controlloTrasferimenti(stato.reg.mov), [stato.versione]);
  const [segnati, setSegnati] = useState<Set<string>>(new Set());
  const senza = new Map<string, { conto: string; controparte: string; n: number; tot: number }>();
  for (const m of ctr.senzaControparte) {
    const k = m.conto + "|" + chiave(m);
    const x = senza.get(k) ?? { conto: m.conto, controparte: chiave(m), n: 0, tot: 0 };
    x.n++; x.tot += m.importo;
    senza.set(k, x);
  }
  const sospette = ctr.coppieNonMarcate.filter((m) => Math.abs(m.importo) >= 50 && m.categoria !== "Amici e persone")
    .sort((a, b) => (a.data < b.data ? 1 : -1));
  return (
    <div>
      <p className="nota">I soldi spostati tra i tuoi conti non sono né entrate né uscite. Qui si controlla che ogni trasferimento abbia il movimento corrispondente sull'altro conto.</p>
      <h3>Trasferimenti verso conti non importati</h3>
      <p className="nota">Revolut, DEGIRO, libretti…: non sono spese, ma quei soldi escono dai conti che l'app conosce.</p>
      {senza.size === 0 ? <Avviso tipo="ok">Nessuno: ogni trasferimento ha la sua controparte.</Avviso> : (
        <div className="tabella-scorre"><table className="tabella">
          <thead><tr><th>Conto</th><th>Controparte</th><th className="n">Movimenti</th><th className="n">Totale</th></tr></thead>
          <tbody>{[...senza.values()].sort((a, b) => a.tot - b.tot).map((x) => (
            <tr key={x.conto + x.controparte}><td>{x.conto}</td><td>{x.controparte || "–"}</td><td className="n num">{x.n}</td><td className={"n num " + segnoCls(x.tot)}>{eur(x.tot, 2)}</td></tr>
          ))}</tbody></table></div>
      )}
      <h3>Possibili trasferimenti non riconosciuti</h3>
      <p className="nota">Coppie di movimenti di segno opposto e stesso importo su due conti, a pochi giorni di distanza, non segnate come trasferimento.</p>
      {sospette.length === 0 ? <Avviso tipo="ok">Nessuna coppia sospetta.</Avviso> : <>
        <ul className="elenco-movimenti compatto">
          {sospette.map((m) => (
            <li key={m.id}><label className="riga-mov spuntabile">
              <input type="checkbox" checked={segnati.has(m.id)} onChange={() => setSegnati((p) => { const q = new Set(p); q.has(m.id) ? q.delete(m.id) : q.add(m.id); return q; })} />
              <span className="m-data">{formatoIt(m.data)}</span><span className="m-desc">{m.descrizione}</span>
              <span className="m-meta"><span className="m-conto">{m.conto} ↔ {m.controparte}</span><span className="etichetta-cat">{m.categoria}</span></span>
              <span className={"m-importo num " + segnoCls(m.importo)}>{eur(m.importo, 2)}</span>
            </label></li>
          ))}
        </ul>
        <div className="pulsanti"><button className="primario" disabled={!segnati.size}
          onClick={() => { modifica(["mov"], () => stato.reg.fissa(segnati, "Trasferimento interno", true)); setSegnati(new Set()); }}>
          Segna {segnati.size} movimenti come trasferimento interno</button></div>
      </>}
    </div>
  );
}
