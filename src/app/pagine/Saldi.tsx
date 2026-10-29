import { useMemo, useState } from "react";
import { ohlc, type FreqCandela } from "../../core/analisi";
import { aggiungiGiorni, formatoIt, giorniTra, oggi } from "../../core/date";
import { GraficoCandele, GraficoLinee, BLU, NERO, PALETTE_CONTI as PALETTE, type SerieLinea } from "../grafici";
import { calcolaBuchi, calcolaInvestimenti, calcolaSaldi, modifica, stato, useVersione } from "../stato";
import { CoefficienteCrescita, type SerieCrescita } from "../crescita";
import { Avviso, Cifra, eur, Intestazione, Pannello, Scelta, Segmenti, Sezione, segnoCls, useMemoria, Vuoto, pct } from "../ui";

const PERIODI = [{ v: "1", t: "1 anno" }, { v: "3", t: "3 anni" }, { v: "5", t: "5 anni" }, { v: "0", t: "Tutto" }] as { v: string; t: string }[];

export default function Saldi({ vai }: { vai: (p: string) => void }) {
  useVersione();
  const [periodo, setPeriodo] = useMemoria("saldi:periodo", "3");
  const [tipo, setTipo] = useMemoria<"Linee" | "Candele">("saldi:tipo", "Linee");
  const [contoC, setContoC] = useState("TOTALE");
  const [freq, setFreq] = useMemoria<FreqCandela>("saldi:freq", "Mese");
  const [nuovoSaldo, setNuovoSaldo] = useState(false);
  const [tuttiNoti, setTuttiNoti] = useState(false);
  const mov = stato.reg.mov;
  const s = calcolaSaldi();
  const inv = calcolaInvestimenti();

  const dati = useMemo(() => {
    if (!s.giorni.length) return null;
    const da = periodo === "0" ? s.giorni[0] : aggiungiGiorni(oggi(), -365 * +periodo);
    const i0 = Math.max(0, s.giorni.findIndex((d) => d >= da));
    const giorni = s.giorni.slice(i0);
    const conti = s.conti.map((c) => ({ nome: c, valori: s.valori[c].slice(i0) }));
    let invV: (number | null)[] | null = null;
    if (inv) {
      const mappa = new Map(inv.tot.giorni.map((d, i) => [d, inv.tot.valore[i]]));
      let ult: number | null = null;
      invV = giorni.map((d) => { const v = mappa.get(d); if (v !== undefined) ult = v; return d < inv.tot.giorni[0] ? null : ult; });
    }
    const liquidita = giorni.map((_, i) => { let t = 0, ok = false; for (const c of conti) { const v = c.valori[i]; if (v !== null) { t += v; ok = true; } } return ok ? t : null; });
    const totale = liquidita.map((v, i) => (v === null && (invV?.[i] ?? null) === null ? null : (v ?? 0) + (invV?.[i] ?? 0)));
    return { giorni, conti, invV, liquidita, totale };
  }, [s, inv, periodo]);

  const serieCrescita = useMemo((): SerieCrescita[] => {
    if (!s.giorni.length) return [];
    const invPer = inv ? new Map(inv.tot.giorni.map((d, i) => [d, inv.tot.valore[i]])) : null;
    let ultimoInv = 0;
    const liq: (number | null)[] = [], tot: (number | null)[] = [], invS: (number | null)[] = [];
    s.giorni.forEach((d, i) => {
      const v = invPer?.get(d); if (v !== undefined) ultimoInv = v;
      const iv = inv && d >= inv.tot.giorni[0] ? ultimoInv : 0;
      let l = 0, ok = false;
      for (const c of s.conti) { const x = s.valori[c][i]; if (x !== null) { l += x; ok = true; } }
      liq.push(ok ? l : null); tot.push(ok ? l + iv : null); invS.push(inv && d >= inv.tot.giorni[0] ? iv : null);
    });
    const out: SerieCrescita[] = [
      { nome: "Patrimonio totale", giorni: s.giorni, valori: tot, spiega: "Crescita del patrimonio (conti più investimenti): misura quanto riesci ad accumulare, risparmi e rendimenti insieme." },
      { nome: "Liquidità", giorni: s.giorni, valori: liq, spiega: "Crescita dei soli conti, salvadanai compresi: i soldi spostati negli investimenti qui risultano come una diminuzione." },
    ];
    if (inv) out.push({ nome: "Investimenti (valore)", giorni: s.giorni, valori: invS, spiega: "Crescita del valore degli investimenti, versamenti compresi." });
    return out;
  }, [s, inv]);

  if (!mov.length) return (
    <Vuoto titolo="Ancora nessun movimento">
      <p>Importa gli estratti conto in PDF di Intesa Sanpaolo, Trade Republic, Satispay e Revolut per vedere saldi e patrimonio.</p>
      <button className="primario" onClick={() => vai("importa")}>Importa estratti conto</button>
    </Vuoto>
  );

  const liq = Object.values(s.ultimo).reduce((a, b) => a + b, 0);
  const valInv = inv?.totale.valore ?? 0;
  const serie: SerieLinea[] = dati ? [
    ...dati.conti.map((c, i) => ({ nome: c.nome, valori: c.valori, colore: PALETTE[i % PALETTE.length] })),
    ...(dati.invV ? [{ nome: "Investimenti", valori: dati.invV, colore: "#c2513a" }] : []),
    { nome: "Liquidità", valori: dati.liquidita, colore: BLU, spessore: 2.5, tratteggio: true },
    { nome: "Totale", valori: dati.totale, colore: NERO, spessore: 3 },
  ] : [];
  const scelteCandele = ["TOTALE", "LIQUIDITÀ", ...s.conti, ...(dati?.invV ? ["Investimenti"] : [])];
  const valoriCandela = !dati ? [] : contoC === "TOTALE" ? dati.totale : contoC === "LIQUIDITÀ" ? dati.liquidita
    : contoC === "Investimenti" ? dati.invV ?? [] : dati.conti.find((c) => c.nome === contoC)?.valori ?? [];

  // avvisi: estratti mancanti dopo l'ultimo saldo noto, conti fermi da tempo
  const buchi = calcolaBuchi();
  const avvisi: string[] = [];
  const ultimiNoti = new Map<string, string>();
  for (const a of stato.reg.saldi) if ((ultimiNoti.get(a.conto) ?? "") < a.data) ultimiNoti.set(a.conto, a.data);
  for (const [conto, data] of ultimiNoti) {
    const dopo = buchi.find((b) => b.conto === conto && b.al > data);
    const ultimoMov = mov.filter((m) => m.conto === conto).reduce((x, m) => (m.data > x ? m.data : x), "");
    const ultimoDato = ultimoMov > data ? ultimoMov : data;
    if (dopo) avvisi.push(`${conto}: dopo l'ultimo saldo noto (${formatoIt(data)}) mancano movimenti dal ${formatoIt(dopo.dal)} al ${formatoIt(dopo.al)}, quindi il saldo attuale è probabilmente sbagliato. Importa l'estratto conto mancante o inserisci il saldo di oggi.`);
    else if (giorniTra(ultimoDato, oggi()) > 90 && Math.abs(s.ultimo[conto] ?? 0) > 0.5)
      avvisi.push(`${conto}: nessun movimento né saldo dopo il ${formatoIt(ultimoDato)}. Se il conto è ancora attivo, inserisci il saldo di oggi.`);
  }

  const ordinati = [...s.controllo].sort((a, b) => a.conto.localeCompare(b.conto) || (a.data < b.data ? -1 : 1));
  const ultimoPerConto = new Set(s.conti.map((c) => ordinati.filter((x) => x.conto === c).pop()).filter(Boolean));
  const righeControllo = tuttiNoti ? ordinati : ordinati.filter((c) => Math.abs(c.differenza) > 0.01 || ultimoPerConto.has(c) || c.fonte === "manuale");

  return (
    <div className="pagina">
      <Intestazione titolo="Patrimonio" />
      <div className="testata-patrimonio">
        <Cifra grande etichetta="Patrimonio totale" valore={eur(liq + valInv)} nota={`al ${formatoIt(oggi())}`} />
        <div className="cifre">
          <Cifra etichetta="Liquidità" valore={eur(liq)} />
          <Cifra etichetta="Investimenti" valore={eur(valInv)}
            nota={inv ? <span className={segnoCls(inv.totale.guadagno)}>{eur(inv.totale.guadagno)} ({pct(inv.totale.guadagnoPct)})</span> : "nessuno"} />
        </div>
      </div>

      <ul className="elenco-conti">
        {s.conti.map((c, i) => (
          <li key={c}>
            <span className="campione" style={{ background: PALETTE[i % PALETTE.length] }} />
            <span className="nome">{c}</span>
            <span className={"num " + ((s.ultimo[c] ?? 0) < 0 ? "neg" : "")}>{eur(s.ultimo[c], 2)}</span>
          </li>
        ))}
      </ul>

      <Sezione titolo="Andamento" azioni={<Segmenti etichetta="Tipo di grafico" valore={tipo} opzioni={["Linee", "Candele"] as const} cambia={setTipo} />}>
        <div className="controlli">
          <Segmenti etichetta="Periodo" valore={periodo} opzioni={PERIODI} cambia={setPeriodo} />
          {tipo === "Candele" && <>
            <Scelta etichetta="Serie" valore={contoC} opzioni={scelteCandele} cambia={setContoC} />
            <Segmenti etichetta="Durata candela" valore={freq} opzioni={["Settimana", "Mese", "Trimestre"] as const} cambia={setFreq} />
          </>}
        </div>
        {dati && tipo === "Linee" && <GraficoLinee giorni={dati.giorni} serie={serie} altezza={360} formatoFumetto={(v) => eur(v)} />}
        {dati && tipo === "Candele" && <GraficoCandele candele={ohlc(dati.giorni, valoriCandela, freq)} formatoFumetto={(v) => eur(v)} />}
        {tipo === "Linee" && <p className="nota">Totale = tutti i conti più gli investimenti. Liquidità = solo i conti, salvadanai compresi. Tocca una voce della legenda per nasconderla.</p>}
      </Sezione>

      <Sezione titolo="Crescita del patrimonio">
        <CoefficienteCrescita serie={serieCrescita} />
      </Sezione>

      <Sezione titolo="Controllo con i saldi noti" azioni={<button onClick={() => setNuovoSaldo(true)}>Aggiungi saldo</button>}
        nota="Ogni estratto conto fornisce un saldo noto. Una differenza diversa da zero indica movimenti mancanti tra quel saldo e il precedente (di solito un estratto conto non importato). Dopo l'ultimo saldo noto il saldo è calcolato dai movimenti.">
        {avvisi.map((a) => <Avviso key={a} tipo="attenzione">{a}</Avviso>)}
        <div className="tabella-scorre">
          <table className="tabella">
            <thead><tr><th>Conto</th><th>Data</th><th className="n">Saldo noto</th><th className="n">Differenza</th><th className="solo-largo">Fonte</th><th /></tr></thead>
            <tbody>
              {righeControllo.map((c) => (
                <tr key={c.conto + c.data}>
                  <td>{c.conto}</td><td>{formatoIt(c.data)}</td><td className="n num">{eur(c.saldoNoto, 2)}</td>
                  <td className={"n num " + (Math.abs(c.differenza) > 0.01 ? "neg" : "tenue")}>{Math.abs(c.differenza) > 0.01 ? eur(c.differenza, 2) : "0"}</td>
                  <td className="tenue taglia solo-largo">{c.fonte}</td>
                  <td>{c.fonte === "manuale" && <button className="piccolo" onClick={() => modifica(["saldi"], () => stato.reg.rimuoviSaldo(c.data, c.conto))}>Elimina</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {ordinati.length > righeControllo.length || tuttiNoti ? (
          <button className="testo" onClick={() => setTuttiNoti(!tuttiNoti)}>{tuttiNoti ? "Mostra solo differenze e ultimi saldi" : `Mostra tutti i saldi noti (${ordinati.length})`}</button>
        ) : null}
      </Sezione>
      <Pannello aperto={nuovoSaldo} chiudi={() => setNuovoSaldo(false)} titolo="Aggiungi un saldo noto">
        <FormSaldo chiudi={() => setNuovoSaldo(false)} conti={[...new Set([...s.conti, "Revolut"])]} />
      </Pannello>
    </div>
  );
}

function FormSaldo({ chiudi, conti }: { chiudi: () => void; conti: string[] }) {
  const [conto, setConto] = useState(conti[0]);
  const [data, setData] = useState(oggi());
  const [valore, setValore] = useState("");
  const v = Number(valore.replace(/\./g, "").replace(",", "."));
  return (
    <form className="modulo" onSubmit={(e) => { e.preventDefault(); if (!Number.isFinite(v)) return; modifica(["saldi"], () => stato.reg.aggiungiSaldo(data, conto, v)); chiudi(); }}>
      <p className="nota">Per esempio il saldo che vedi oggi nell'app della banca. Da quella data in poi il saldo del conto parte da questo valore.</p>
      <Scelta etichetta="Conto" valore={conto} opzioni={conti} cambia={setConto} />
      <label className="campo"><span>Data</span><input type="date" value={data} max={oggi()} onChange={(e) => setData(e.target.value)} required /></label>
      <label className="campo"><span>Saldo in euro</span><input inputMode="decimal" value={valore} onChange={(e) => setValore(e.target.value)} placeholder="1.234,56" required /></label>
      <div className="pulsanti"><button type="submit" className="primario" disabled={!valore || !Number.isFinite(v)}>Aggiungi saldo</button></div>
    </form>
  );
}
