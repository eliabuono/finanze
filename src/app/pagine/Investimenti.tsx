import { useEffect, useState } from "react";
import { indiceRendimento, ohlc, perClasse, type FreqCandela } from "../../core/analisi";
import { formatoIt } from "../../core/date";
import { aggiornaPrezziOra, prezziDisponibili, prezziVecchi } from "../azioni";
import { Ciambella, GraficoCandele, GraficoLinee, NERO, PALETTE } from "../grafici";
import { calcolaInvestimenti, stato, useVersione } from "../stato";
import { importiNascosti } from "../privacy";
import { Avviso, Cifra, eur, Intestazione, num, pct, Scelta, Segmenti, Sezione, segnoCls, useMemoria, Vuoto } from "../ui";

type Vista = "Profitto" | "Valore e versato" | "Candele" | "Allocazione";

export default function Investimenti({ vai }: { vai: (p: string) => void }) {
  useVersione();
  const [vistaSalvata, setVista] = useMemoria<Vista>("inv:vista", "Profitto");
  const vista: Vista = (["Profitto", "Valore e versato", "Candele", "Allocazione"] as const).includes(vistaSalvata) ? vistaSalvata : "Profitto";
  const [modo, setModo] = useMemoria<"€" | "%">("inv:modo", "€");
  const [strum, setStrum] = useState("Totale");
  const [serieC, setSerieC] = useState("Indice di rendimento");
  const [freq, setFreq] = useMemoria<FreqCandela>("inv:freq", "Settimana");
  const [carico, setCarico] = useState(false);
  const [errore, setErrore] = useState("");
  const inv = calcolaInvestimenti();

  const aggiorna = async () => {
    setCarico(true); setErrore("");
    try { await aggiornaPrezziOra(); } catch (e: any) { setErrore(String(e?.message ?? e)); }
    setCarico(false);
  };
  useEffect(() => { if (inv && prezziDisponibili() && prezziVecchi()) aggiorna(); }, []); // eslint-disable-line

  if (!inv) return (
    <Vuoto titolo="Nessun acquisto di titoli">
      <p>Importa l'estratto conto di Trade Republic: gli acquisti di ETF con ISIN e quote compaiono qui.</p>
      <button className="primario" onClick={() => vai("importa")}>Importa estratti conto</button>
    </Vuoto>
  );
  const nomi = Object.keys(inv.serie);
  const T = inv.totale;
  const sel = strum === "Totale" ? inv.tot : inv.serie[strum];
  const profitto = [
    ...nomi.map((n, i) => ({ nome: n, colore: PALETTE[i % PALETTE.length], valori: modo === "€" ? inv.serie[n].profitto
      : inv.serie[n].profitto.map((p, j) => (inv.serie[n].versato[j] > 0 ? (p / inv.serie[n].versato[j]) * 100 : null)) })),
    { nome: "Totale", colore: NERO, spessore: 3.5, valori: modo === "€" ? inv.tot.profitto
      : inv.tot.profitto.map((p, j) => (inv.tot.versato[j] > 0 ? (p / inv.tot.versato[j]) * 100 : null)) },
  ];
  const opzCandele = ["Indice di rendimento", "Profitto del portafoglio", "Valore del portafoglio", ...nomi.map((n) => `${n}: prezzo`)];
  const valoriC = serieC === "Indice di rendimento" ? indiceRendimento(inv.tot.valore, inv.tot.flussi)
    : serieC === "Profitto del portafoglio" ? inv.tot.profitto : serieC === "Valore del portafoglio" ? inv.tot.valore
    : inv.serie[serieC.replace(/: prezzo$/, "")]?.prezzo ?? [];
  const unitaC = serieC === "Indice di rendimento" ? (v: number) => num(v, 2) : (v: number) => eur(v, serieC.endsWith("prezzo") ? 2 : 0);
  const classi = perClasse(inv.righe);

  return (
    <div className="pagina">
      <Intestazione titolo="Investimenti">
        <button onClick={aggiorna} disabled={carico || !prezziDisponibili()}>{carico ? "Aggiorno…" : "Aggiorna prezzi"}</button>
      </Intestazione>
      {!prezziDisponibili() && (
        <Avviso>Valori calcolati con il prezzo degli ultimi acquisti. Per i prezzi di mercato imposta l'intermediario dei prezzi in <button className="link" onClick={() => vai("impostazioni")}>Impostazioni</button> (nell'app installata sul telefono non serve).</Avviso>
      )}
      {errore && <Avviso tipo="errore">Prezzi non aggiornati: {errore}</Avviso>}
      {Object.entries(stato.erroriPrezzi).map(([k, e]) => <Avviso key={k} tipo="attenzione">{stato.cfg.strumenti[k]?.nome ?? k}: {e}</Avviso>)}
      <div className="cifre quattro">
        <Cifra etichetta="Valore" valore={eur(T.valore)} />
        <Cifra etichetta="Versato" valore={eur(T.versato)} />
        <Cifra etichetta="Guadagno" valore={eur(T.guadagno)} cls={segnoCls(T.guadagno)} nota={pct(T.guadagnoPct)} />
        <Cifra etichetta="Tasso annuo (TIR)" valore={pct(T.tir)} cls={segnoCls(T.tir)} nota={`TWR ${pct(T.twr)}`} />
      </div>
      {stato.prezziAggiornati && <p className="nota">Prezzi aggiornati il {formatoIt(stato.prezziAggiornati.slice(0, 10))} alle {stato.prezziAggiornati.slice(11)}. Si aggiornano da soli quando sono più vecchi di un'ora.</p>}

      <ul className="schede-inv solo-stretto">
        {inv.righe.map((r) => (
          <li key={r.isin}>
            <div className="si-testa"><strong>{r.strumento}</strong><span className="num">{eur(r.valore)}</span></div>
            <div className="si-sotto tenue"><span>{r.classe} · {pct(r.peso, 1, false)}{r.obiettivo !== null ? ` (obiettivo ${pct(r.obiettivo, 0, false)})` : ""}</span>
              <span className={"num " + segnoCls(r.guadagno)}>{eur(r.guadagno)} ({pct(r.guadagnoPct)})</span></div>
            <div className="si-sotto tenue piccolo-testo"><span>{importiNascosti() ? "•••" : num(r.quote, 4)} quote a {num(r.prezzo, 2)} €, versati {eur(r.versato)}</span><span>TIR {pct(r.tir)}</span></div>
          </li>
        ))}
      </ul>
      <div className="tabella-scorre solo-largo">
        <table className="tabella">
          <thead><tr><th>Strumento</th><th>Classe</th><th className="n">Quote</th><th className="n">Prezzo</th><th className="n">Versato</th>
            <th className="n">Valore</th><th className="n">Guadagno</th><th className="n">TIR</th><th className="n">TWR</th><th className="n">Peso</th><th className="n">Obiettivo</th></tr></thead>
          <tbody>
            {inv.righe.map((r) => (
              <tr key={r.isin}>
                <td><strong>{r.strumento}</strong><div className="tenue piccolo-testo">{r.isin} · dal {formatoIt(r.dal)}</div></td>
                <td>{r.classe}</td><td className="n num">{importiNascosti() ? "•••" : num(r.quote, 4)}</td><td className="n num">{num(r.prezzo, 2)}</td>
                <td className="n num">{eur(r.versato)}</td><td className="n num">{eur(r.valore)}</td>
                <td className={"n num " + segnoCls(r.guadagno)}>{eur(r.guadagno)}<div className="piccolo-testo">{pct(r.guadagnoPct)}</div></td>
                <td className={"n num " + segnoCls(r.tir)}>{pct(r.tir)}</td><td className={"n num " + segnoCls(r.twr)}>{pct(r.twr)}</td>
                <td className="n num">{pct(r.peso, 1, false)}</td>
                <td className="n num">{r.obiettivo === null ? "–" : <>{pct(r.obiettivo, 1, false)}<div className={"piccolo-testo " + segnoCls(r.scostamento)}>{pct(r.scostamento)}</div></>}</td>
              </tr>
            ))}
            <tr className="totale">
              <td><strong>Totale</strong></td><td /><td /><td /><td className="n num">{eur(T.versato)}</td><td className="n num">{eur(T.valore)}</td>
              <td className={"n num " + segnoCls(T.guadagno)}>{eur(T.guadagno)}<div className="piccolo-testo">{pct(T.guadagnoPct)}</div></td>
              <td className="n num">{pct(T.tir)}</td><td className="n num">{pct(T.twr)}</td><td className="n num">100%</td><td />
            </tr>
          </tbody>
        </table>
      </div>
      <p className="nota">TIR = rendimento annuo del tuo denaro, tiene conto di quando hai versato. TWR = rendimento degli strumenti indipendente dai versamenti, confrontabile con un indice; sotto l'anno è il rendimento del periodo.</p>

      <Sezione>
        <Segmenti etichetta="Grafico" valore={vista} opzioni={["Profitto", "Valore e versato", "Candele", "Allocazione"] as const} cambia={setVista} />
        {vista === "Profitto" && <>
          <div className="controlli"><Segmenti etichetta="Unità" valore={modo} opzioni={[{ v: "€", t: "Euro" }, { v: "%", t: "% sul versato" }] as { v: "€" | "%"; t: string }[]} cambia={setModo} /></div>
          <GraficoLinee giorni={inv.tot.giorni} serie={profitto} altezza={360} zero formato={modo === "%" ? (v) => num(v, 0) + "%" : undefined}
            formatoFumetto={modo === "%" ? (v) => num(v, 1) + "%" : (v) => eur(v)} />
        </>}
        {vista === "Valore e versato" && <>
          <div className="controlli"><Scelta etichetta="Strumento" valore={strum} opzioni={["Totale", ...nomi]} cambia={setStrum} /></div>
          <GraficoLinee giorni={sel.giorni} altezza={340} formatoFumetto={(v) => eur(v)}
            serie={[{ nome: "Versato", valori: sel.versato, colore: "#7d8a99", gradini: true, area: true }, { nome: "Valore", valori: sel.valore, colore: PALETTE[0], spessore: 2.5 }]} />
        </>}
        {vista === "Candele" && <>
          <div className="controlli">
            <Scelta etichetta="Serie" valore={serieC} opzioni={opzCandele} cambia={setSerieC} />
            <Segmenti etichetta="Durata candela" valore={freq} opzioni={["Settimana", "Mese", "Trimestre"] as const} cambia={setFreq} />
          </div>
          <GraficoCandele candele={ohlc(inv.tot.giorni, valoriC, freq)} formato={serieC === "Indice di rendimento" ? (v) => num(v, 0) : undefined} formatoFumetto={unitaC} />
          <p className="nota">L'indice di rendimento (base 100) mostra come è andato il portafoglio togliendo l'effetto dei versamenti; il valore in euro invece sale anche quando versi. Le candele usano i prezzi di chiusura giornalieri.</p>
        </>}
        {vista === "Allocazione" && <>
          <div className="due-colonne">
            <Ciambella titolo="Per classe" voci={classi.map((c) => ({ nome: c.classe, valore: c.valore }))} formato={(v) => eur(v)} />
            <Ciambella titolo="Per strumento" voci={inv.righe.map((r) => ({ nome: r.strumento, valore: r.valore }))} formato={(v) => eur(v)} />
          </div>
          <div className="tabella-scorre">
            <table className="tabella">
              <thead><tr><th>Classe</th><th className="n">Valore</th><th className="n">Guadagno</th><th className="n">Peso</th><th className="n">Obiettivo</th><th className="n">Scostamento</th></tr></thead>
              <tbody>{classi.map((c) => (
                <tr key={c.classe}><td>{c.classe}</td><td className="n num">{eur(c.valore)}</td><td className={"n num " + segnoCls(c.guadagno)}>{eur(c.guadagno)}</td>
                  <td className="n num">{pct(c.peso, 1, false)}</td><td className="n num">{c.obiettivo === null ? "–" : pct(c.obiettivo, 1, false)}</td>
                  <td className={"n num " + segnoCls(c.scostamento)}>{c.scostamento === null ? "–" : pct(c.scostamento)}</td></tr>
              ))}</tbody>
            </table>
          </div>
          <p className="nota">Classi e pesi obiettivo si impostano in <button className="link" onClick={() => vai("impostazioni")}>Impostazioni</button>.</p>
        </>}
      </Sezione>
      <details className="dettagli">
        <summary>Fonte dei prezzi</summary>
        <ul>{Object.entries(inv.fonti).map(([n, f]) => <li key={n}><strong>{n}</strong>: {f}</li>)}</ul>
      </details>
    </div>
  );
}

