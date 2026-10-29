import { useMemo, useState } from "react";
import { nomeConto } from "../../core/conti";
import { perCategoria, type Frequenza } from "../../core/analisi";
import { chiave, controlloTrasferimenti } from "../../core/categorie";
import { aggiungiGiorni, formatoIt, oggi } from "../../core/date";
import { Ciambella, GraficoBarre, GraficoLinee, NERO, PALETTE } from "../grafici";
import { calcolaInvestimenti, calcolaSaldi, contiNoti, modifica, stato, useVersione } from "../stato";
import { mesiInteri, previsione, type Metodo } from "../../core/previsioni";
import { Avviso, Cifra, etichettaMese, eur, Intestazione, Pastiglie, PastiglieConti, pct, Scelta, Segmenti, Sezione, segnoCls, useMemoria, Vuoto } from "../ui";

type Vista = "Uscite" | "Entrate" | "Dettaglio" | "Previsione" | "Trasferimenti";

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
  const macro = stato.cfg.macro_categorie ?? {};
  const haMacro = Object.keys(macro).length > 0;
  const [usaMacro, setUsaMacro] = useMemoria("spese:macro", true);
  const raggruppa = haMacro && usaMacro;
  const macroDi = (c: string) => (raggruppa ? macro[c] || c : c);

  const f = useMemo(() => mov.filter((m) => (!conti.length || conti.includes(m.conto)) && m.data >= dal && m.data <= al),
    [mov, conti, dal, al, stato.versione]);
  const pc = useMemo(() => {
    const r = perCategoria(f, stato.cfg.categorie_escluse, freq, compensa);
    if (!raggruppa) return r;
    const unisci = (t: Record<string, number[]>) => {
      const out: Record<string, number[]> = {};
      for (const [cat, v] of Object.entries(t)) {
        const k = macro[cat] || cat;
        out[k] = out[k] ? out[k].map((x, i) => x + v[i]) : [...v];
      }
      return out;
    };
    return { periodi: r.periodi, entrate: unisci(r.entrate), uscite: unisci(r.uscite) };
  }, [f, freq, compensa, raggruppa, stato.versione]);
  if (!mov.length) return <Vuoto titolo="Nessun movimento"><button className="primario" onClick={() => vai("importa")}>Importa estratti conto</button></Vuoto>;

  const somma = (t: Record<string, number[]>) => Object.values(t).reduce((a, v) => a + v.reduce((x, y) => x + y, 0), 0);
  const E = somma(pc.entrate), U = somma(pc.uscite);
  const etP = freq === "M" ? etichettaMese : (p: string) => p.slice(0, 4);
  const categorieF = [...new Set(f.flatMap((m) => (raggruppa && macro[m.categoria] ? [m.categoria, macro[m.categoria]] : [m.categoria])))].sort((a, b) => a.localeCompare(b, "it"));
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
        <PastiglieConti etichetta="Conti" conti={tuttiConti} scelte={conti} cambia={setConti} />
        <label className="spunta">
          <input type="checkbox" checked={compensa} onChange={(e) => modifica(["cfg"], () => { stato.cfg.compensa_rimborsi = e.target.checked; })} />
          Compensa i rimborsi nella stessa categoria (il coinquilino che ti ridà la sua parte d'affitto, un reso, l'amico che ti restituisce i soldi)
        </label>
        {haMacro ? (
          <label className="spunta"><input type="checkbox" checked={usaMacro} onChange={(e) => setUsaMacro(e.target.checked)} /> Raggruppa in macro-categorie</label>
        ) : <p className="nota">Puoi raggruppare le categorie in macro-categorie (per esempio «Cibo») in <button className="link" onClick={() => vai("impostazioni")}>Impostazioni</button>.</p>}
      </div>
      <div className="cifre tre">
        <Cifra etichetta="Entrate" valore={eur(E)} cls="pos" />
        <Cifra etichetta="Uscite" valore={eur(U)} cls="neg" />
        <Cifra etichetta="Risparmio" valore={eur(E - U)} cls={segnoCls(E - U)} nota={E ? `${pct((E - U) / E)} delle entrate` : undefined} />
      </div>
      <p className="nota">Esclusi dal calcolo: {stato.cfg.categorie_escluse.join(", ")} (si cambia in Impostazioni).</p>

      <Sezione>
        <Segmenti etichetta="Vista" valore={vista} opzioni={["Uscite", "Entrate", "Dettaglio", "Previsione", "Trasferimenti"] as const} cambia={setVista} />
        {(vista === "Uscite" || vista === "Entrate") && (() => {
          const { voci, serie } = tabella(vista === "Uscite" ? pc.uscite : pc.entrate);
          const n = Math.max(pc.periodi.length, 1);
          return <>
            <GraficoBarre periodi={pc.periodi} serie={serie} etichettaPeriodo={etP} formatoFumetto={(v) => eur(v)} />
            <div className="due-colonne">
              <Ciambella titolo={vista} voci={voci} formato={(v) => eur(v)} />
              <div className="tabella-scorre">
                <table className="tabella">
                  <thead><tr><th>{raggruppa ? "Macro-categoria" : "Categoria"}</th><th className="n">Totale</th><th className="n">Media per {freq === "M" ? "mese" : "anno"}</th></tr></thead>
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
            {f.filter((m) => m.categoria === cd || macroDi(m.categoria) === cd).sort((a, b) => (a.data < b.data ? 1 : -1)).slice(0, 500).map((m) => (
              <li key={m.id}><div className="riga-mov">
                <span className="m-data">{formatoIt(m.data)}</span><span className="m-desc">{m.descrizione}</span>
                <span className="m-meta"><span className="m-conto">{nomeConto(m.conto)}</span>{m.categoria !== cd && <span className="etichetta-cat">{m.categoria}</span>}</span>
                <span className={"m-importo num " + segnoCls(m.importo)}>{eur(m.importo, 2)}</span></div></li>
            ))}
          </ul>
        </>}
        {vista === "Previsione" && <Previsione f={f} dal={dal} al={al} compensa={compensa} />}
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
            <tr key={x.conto + x.controparte}><td>{nomeConto(x.conto)}</td><td>{x.controparte || "–"}</td><td className="n num">{x.n}</td><td className={"n num " + segnoCls(x.tot)}>{eur(x.tot, 2)}</td></tr>
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
              <span className="m-meta"><span className="m-conto">{nomeConto(m.conto)} ↔ {nomeConto(m.controparte)}</span><span className="etichetta-cat">{m.categoria}</span></span>
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

// ------------------------------------------------------------------ previsione
function Previsione({ f, dal, al, compensa }: { f: typeof stato.reg.mov; dal: string; al: string; compensa: boolean }) {
  const [metodo, setMetodo] = useMemoria<Metodo>("prev:metodo", "media");
  const [mesi, setMesi] = useMemoria("prev:mesi", "12");
  const k = Number(mesi);
  const dati = useMemo(() => {
    const periodi = mesiInteri(dal, al, oggi());
    if (periodi.length < 2) return null;
    const pc = perCategoria(f, stato.cfg.categorie_escluse, "M", compensa);
    const idx = new Map(pc.periodi.map((p, i) => [p, i]));
    const tot = (t: Record<string, number[]>, p: string) => { const i = idx.get(p); return i === undefined ? 0 : Object.values(t).reduce((a, v) => a + v[i], 0); };
    const serie = { periodi, entrate: periodi.map((p) => tot(pc.entrate, p)), uscite: periodi.map((p) => tot(pc.uscite, p)) };
    return { serie, prev: previsione(serie, k, metodo) };
  }, [f, dal, al, compensa, metodo, k, stato.versione]);
  if (!dati) return <Avviso>Per la previsione servono almeno due mesi interi nel periodo scelto qui sopra (Dal / Al).</Avviso>;
  const { serie, prev } = dati;
  const n = serie.periodi.length;
  const giorni = [...serie.periodi, ...prev.futuri];
  const storia = (v: number[]) => [...v, ...prev.futuri.map(() => null)];
  const futuro = (v: number[], ultimo: number) => [...serie.periodi.map((_, i) => (i === n - 1 ? ultimo : null)), ...v];
  const mediaE = serie.entrate.reduce((a, b) => a + b, 0) / n, mediaU = serie.uscite.reduce((a, b) => a + b, 0) / n;
  // patrimonio di oggi (conti + investimenti al valore attuale) più il risparmio previsto
  const s = calcolaSaldi(), inv = calcolaInvestimenti();
  const patrimonio = Object.values(s.ultimo).reduce((a, b) => a + b, 0) + (inv?.totale.valore ?? 0);
  const fin = prev.risparmioCumulato;
  const oggiMese = prev.futuri.map((_, j) => j);
  const quando = (j: number) => { const p = prev.futuri[j]; return `${["gen", "feb", "mar", "apr", "mag", "giu", "lug", "ago", "set", "ott", "nov", "dic"][+p.slice(5, 7) - 1]} ${p.slice(0, 4)}`; };
  return (
    <div className="previsione">
      <p className="nota">Taratura: {n} mesi interi, da {etichettaMese(serie.periodi[0])} a {etichettaMese(serie.periodi[n - 1])} (il periodo «Dal / Al» qui sopra, con gli stessi conti e le stesse esclusioni). {metodo === "media"
        ? "Ogni mese futuro vale la media dei mesi di taratura."
        : "Ogni mese futuro segue la retta di tendenza dei mesi di taratura (se le spese crescevano, continuano a crescere)."} La fascia indica dove cade il risultato circa 2 volte su 3, in base a quanto variavano i mesi di taratura.</p>
      <div className="controlli">
        <Segmenti etichetta="Metodo" valore={metodo} cambia={setMetodo} opzioni={[{ v: "media", t: "Media" }, { v: "tendenza", t: "Tendenza" }] as { v: Metodo; t: string }[]} />
        <Segmenti etichetta="Orizzonte" valore={mesi} cambia={setMesi} opzioni={[{ v: "6", t: "6 mesi" }, { v: "12", t: "1 anno" }, { v: "24", t: "2 anni" }, { v: "60", t: "5 anni" }]} />
      </div>
      <div className="cifre quattro">
        <Cifra etichetta="Entrate al mese (taratura)" valore={eur(mediaE)} cls="pos" nota={metodo === "tendenza" ? `tendenza ${prev.entrate.pendenza >= 0 ? "+" : ""}${eur(prev.entrate.pendenza)} al mese` : undefined} />
        <Cifra etichetta="Uscite al mese (taratura)" valore={eur(mediaU)} cls="neg" nota={metodo === "tendenza" ? `tendenza ${prev.uscite.pendenza >= 0 ? "+" : ""}${eur(prev.uscite.pendenza)} al mese` : undefined} />
        <Cifra etichetta={`Risparmio in ${k} mesi`} valore={eur(fin.stima[k - 1])} cls={segnoCls(fin.stima[k - 1])} nota={`tra ${eur(fin.basso[k - 1])} e ${eur(fin.alto[k - 1])}`} />
        <Cifra etichetta={`Patrimonio a ${quando(k - 1)}`} valore={eur(patrimonio + fin.stima[k - 1])} nota={`oggi ${eur(patrimonio)}`} />
      </div>
      <h3>Entrate e uscite mensili</h3>
      <GraficoLinee giorni={giorni} altezza={300} formatoFumetto={(v) => eur(v)} serie={[
        { nome: "Entrate", valori: storia(serie.entrate), colore: "var(--pos)" },
        { nome: "Uscite", valori: storia(serie.uscite), colore: "var(--neg)" },
        { nome: "Entrate previste", valori: futuro(prev.entrate.stima, serie.entrate[n - 1]), colore: "var(--pos)", tratteggio: true,
          fascia: { basso: futuro(prev.entrate.basso, serie.entrate[n - 1]), alto: futuro(prev.entrate.alto, serie.entrate[n - 1]) } },
        { nome: "Uscite previste", valori: futuro(prev.uscite.stima, serie.uscite[n - 1]), colore: "var(--neg)", tratteggio: true,
          fascia: { basso: futuro(prev.uscite.basso, serie.uscite[n - 1]), alto: futuro(prev.uscite.alto, serie.uscite[n - 1]) } },
      ]} />
      <h3>Patrimonio previsto</h3>
      <GraficoLinee giorni={["oggi", ...prev.futuri].map((p, j) => (j === 0 ? oggi() : p))} altezza={260} formatoFumetto={(v) => eur(v)} serie={[
        { nome: "Patrimonio previsto", colore: NERO, spessore: 2.5, valori: [patrimonio, ...oggiMese.map((j) => patrimonio + fin.stima[j])],
          fascia: { basso: [patrimonio, ...oggiMese.map((j) => patrimonio + fin.basso[j])], alto: [patrimonio, ...oggiMese.map((j) => patrimonio + fin.alto[j])] } },
      ]} />
      <p className="nota">Il patrimonio previsto parte da quello di oggi (conti più investimenti al valore attuale) e somma il risparmio previsto; non considera l'andamento dei mercati né spese straordinarie future.</p>
    </div>
  );
}
