/** Coefficiente di crescita del patrimonio su finestre mobili, con la sua tendenza nel tempo. */
import { useState } from "react";
import { crescitaMobile, type ModoCrescita } from "../core/previsioni";
import { GraficoLinee, NERO, PALETTE } from "./grafici";
import { Avviso, Cifra, eur, num, pct, Scelta, Segmenti, segnoCls, useMemoria } from "./ui";

export interface SerieCrescita { nome: string; giorni: string[]; valori: (number | null)[]; spiega: string; }

const FINESTRE = [{ v: "91", t: "3 mesi" }, { v: "182", t: "6 mesi" }, { v: "365", t: "1 anno" }, { v: "730", t: "2 anni" }, { v: "1095", t: "3 anni" }];

export function CoefficienteCrescita({ serie }: { serie: SerieCrescita[] }) {
  const [nome, setNome] = useState(serie[0]?.nome ?? "");
  const [finestra, setFinestra] = useMemoria("cresc:finestra", "365");
  const [modo, setModo] = useMemoria<ModoCrescita>("cresc:modo2", "euro_mese");
  const s = serie.find((x) => x.nome === nome) ?? serie[0];
  if (!s) return null;
  const c = crescitaMobile(s.giorni, s.valori, Number(finestra), modo);
  const euro = modo === "euro_mese";
  const k = euro ? 1 : 100;
  const val = c.valori.map((v) => (v === null ? null : v * k));
  const ten = c.tendenza.map((v) => (v === null ? null : v * k));
  const ultimi = c.valori.filter((v): v is number => v !== null);
  const attuale = ultimi.length ? ultimi[ultimi.length - 1] : NaN;
  const etF = FINESTRE.find((x) => x.v === finestra)?.t ?? "";
  const fmt = (v: number) => (euro ? eur(v) : pct(v));
  const misura = euro ? `Crescita al mese (media su ${etF})` : modo === "annuo" ? `Tasso annuo (su ${etF})` : `Variazione in ${etF}`;
  const pendenza = euro
    ? `${c.pendenzaAnnua >= 0 ? "+" : ""}${eur(c.pendenzaAnnua)} al mese, ogni anno`
    : `${c.pendenzaAnnua >= 0 ? "+" : ""}${(c.pendenzaAnnua * 100).toLocaleString("it-IT", { maximumFractionDigits: 1 })} punti % all'anno`;
  return (
    <div>
      <div className="controlli">
        {serie.length > 1 && <Scelta etichetta="Serie" valore={s.nome} opzioni={serie.map((x) => x.nome)} cambia={setNome} />}
        <label className="campo stretto"><span>Finestra</span>
          <select value={finestra} onChange={(e) => setFinestra(e.target.value)}>{FINESTRE.map((x) => <option key={x.v} value={x.v}>{x.t}</option>)}</select></label>
        <div className="campo"><span>Misura</span><Segmenti etichetta="Misura" valore={modo} cambia={setModo}
          opzioni={[{ v: "euro_mese", t: "€ al mese" }, { v: "annuo", t: "% annuo" }, { v: "periodo", t: "% nella finestra" }] as { v: ModoCrescita; t: string }[]} /></div>
      </div>
      <p className="nota">{s.spiega} Ogni punto è {euro ? `l'aumento medio al mese` : modo === "annuo" ? "la crescita annua equivalente" : "la variazione"} degli ultimi {etF} fino a quel giorno; la linea tratteggiata è la tendenza del coefficiente nel tempo.</p>
      {c.giudizio === "dati insufficienti" ? <Avviso>Servono più dati: prova una finestra più corta.</Avviso> : (
        <div className="cifre adatta">
          <Cifra etichetta={`Oggi (${etF})`} valore={fmt(attuale)} cls={segnoCls(attuale)} />
          <Cifra etichetta="Media nel tempo" valore={fmt(c.media)} cls={segnoCls(c.media)} />
          <Cifra etichetta="Andamento" valore={c.giudizio} nota={pendenza} />
        </div>
      )}
      <GraficoLinee giorni={s.giorni} altezza={300} zero
        formato={euro ? undefined : (v) => num(v, 0) + "%"} formatoFumetto={euro ? (v) => eur(v) : (v) => num(v, 1) + "%"} serie={[
          { nome: misura, valori: val, colore: PALETTE[0], spessore: 2 },
          { nome: "Tendenza", valori: ten, colore: NERO, tratteggio: true, spessore: 1.5 },
        ]} />
      <p className="nota">{euro
        ? "In € al mese il coefficiente dice quanto cresce il patrimonio ogni mese (risparmi più rendimenti). Se la tendenza sale stai accumulando sempre di più."
        : "In percentuale la crescita si confronta con quanto hai già: a parità di risparmio la percentuale scende man mano che il patrimonio cresce."} Con finestre corte il coefficiente oscilla molto: per la tendenza sono più affidabili le finestre di 1 anno o più.</p>
    </div>
  );
}
