import { useState } from "react";
import { simulazione } from "../../core/analisi";
import { GraficoLinee, PALETTE } from "../grafici";
import { modifica, stato, useVersione } from "../stato";
import { Avviso, Cifra, eur, Intestazione, MESI_BREVI } from "../ui";

const n = (s: string) => Number(s.replace(/\./g, "").replace(",", "."));

export default function Simulazione() {
  useVersione();
  const s = stato.cfg.simulazione;
  const [tasso, setTasso] = useState(String(+(s.tasso_annuo * 100).toFixed(2)).replace(".", ","));
  const [cap, setCap] = useState(String(s.capitale_iniziale));
  const [vers, setVers] = useState(String(s.versamento_mensile));
  const [anni, setAnni] = useState(String(s.anni));
  const [salvato, setSalvato] = useState(false);
  const t = n(tasso) / 100, c = n(cap), v = n(vers), a = Math.min(60, Math.max(1, Math.round(n(anni))));
  const ok = [t, c, v, a].every(Number.isFinite);
  const sim = ok ? simulazione(t, c, v, a) : null;
  const ultimo = sim ? sim.montante.length - 1 : 0;
  return (
    <div className="pagina">
      <Intestazione titolo="Simulazione di accumulo" />
      <div className="riga-campi">
        <label className="campo"><span>Tasso annuo %</span><input inputMode="decimal" value={tasso} onChange={(e) => setTasso(e.target.value)} /></label>
        <label className="campo"><span>Capitale iniziale €</span><input inputMode="decimal" value={cap} onChange={(e) => setCap(e.target.value)} /></label>
        <label className="campo"><span>Versamento mensile €</span><input inputMode="decimal" value={vers} onChange={(e) => setVers(e.target.value)} /></label>
        <label className="campo"><span>Anni</span><input inputMode="numeric" value={anni} onChange={(e) => setAnni(e.target.value)} /></label>
      </div>
      {!sim ? <Avviso tipo="attenzione">Controlla i numeri inseriti.</Avviso> : <>
        <div className="cifre tre">
          <Cifra etichetta="Montante finale" valore={eur(sim.montante[ultimo])} />
          <Cifra etichetta="Versato" valore={eur(sim.versato[ultimo])} />
          <Cifra etichetta="Interessi" valore={eur(sim.interesse[ultimo])} cls="pos" />
        </div>
        <GraficoLinee giorni={sim.date} altezza={320} formatoFumetto={(x) => eur(x)}
          serie={[{ nome: "Capitale versato", valori: sim.versato, colore: "#7d8a99", area: true },
            { nome: "Montante", valori: sim.montante, colore: PALETTE[0], spessore: 2.5, area: true }]} />
        <div className="tabella-scorre">
          <table className="tabella">
            <thead><tr><th>Data</th><th className="n">Versato</th><th className="n">Montante</th><th className="n">Interessi</th></tr></thead>
            <tbody>{sim.date.map((d, i) => i % 12 === 0 ? (
              <tr key={d}><td>{MESI_BREVI[+d.slice(5, 7) - 1]} {d.slice(0, 4)}</td><td className="n num">{eur(sim.versato[i])}</td>
                <td className="n num">{eur(sim.montante[i])}</td><td className="n num">{eur(sim.interesse[i])}</td></tr>) : null)}</tbody>
          </table>
        </div>
        <div className="pulsanti">
          <button onClick={() => { modifica(["cfg"], () => { stato.cfg.simulazione = { tasso_annuo: t, capitale_iniziale: c, versamento_mensile: v, anni: a }; }); setSalvato(true); }}>
            Salva come valori predefiniti</button>
          {salvato && <span className="tenue">Salvati.</span>}
        </div>
      </>}
    </div>
  );
}
