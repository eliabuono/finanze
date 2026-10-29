import { useRef, useState } from "react";
import { formatoIt } from "../../core/date";
import type { EsitoImport } from "../../core/registro";
import { paginePdf } from "../pdf";
import { calcolaBuchi, modifica, stato, useVersione } from "../stato";
import { Avviso, Intestazione, Pannello, Sezione } from "../ui";
import { InviaCampione } from "../campione";

const NOMI_FORMATO: Record<string, string> = {
  trade_republic: "Trade Republic", satispay: "Satispay", intesa_estratto: "Intesa, estratto conto",
  intesa_lista: "Intesa, lista movimenti", revolut: "Revolut", errore: "Non letto",
};

export default function Importa() {
  useVersione();
  const input = useRef<HTMLInputElement>(null);
  const [esiti, setEsiti] = useState<EsitoImport[]>([]);
  const [avanz, setAvanz] = useState<{ i: number; n: number; nome: string } | null>(null);
  const [sopra, setSopra] = useState(false);
  const [reimporta, setReimporta] = useState(false);
  const [nonLetti, setNonLetti] = useState<Record<string, File>>({});
  const [campione, setCampione] = useState<File | null>(null);
  const inputCampione = useRef<HTMLInputElement>(null);

  const importa = async (files: File[]) => {
    const pdf = files.filter((f) => f.name.toLowerCase().endsWith(".pdf") || f.type === "application/pdf");
    if (!pdf.length) return;
    const out: EsitoImport[] = [];
    for (let i = 0; i < pdf.length; i++) {
      const f = pdf[i];
      setAvanz({ i, n: pdf.length, nome: f.name });
      if (!reimporta && stato.reg.giaImportato(f.name, f.size)) {
        out.push({ file: f.name, formato: "già importato", letti: 0, aggiunti: 0 });
        continue;
      }
      try {
        const pagine = await paginePdf(f);
        let e!: EsitoImport;
        modifica(["mov", "saldi", "imp", "cfg"], () => { e = stato.reg.importa(pagine, f.name, f.size, stato.cfg); });
        out.push(e);
      } catch (err: any) {
        const msg = String(err?.message ?? err);
        if (msg.includes("Formato non riconosciuto")) setNonLetti((p) => ({ ...p, [f.name]: f }));
        out.push({ file: f.name, formato: "errore", letti: 0, aggiunti: 0,
          errore: msg.includes("Formato non riconosciuto") ? "Banca o tipo di documento non ancora supportato." : msg });
      }
      setEsiti([...out]);
    }
    setEsiti(out);
    setAvanz(null);
    if (input.current) input.current.value = "";
  };

  const mov = stato.reg.mov;
  const copertura = new Map<string, { n: number; dal: string; al: string }>();
  for (const m of mov) {
    const x = copertura.get(m.conto) ?? { n: 0, dal: m.data, al: m.data };
    x.n++; if (m.data < x.dal) x.dal = m.data; if (m.data > x.al) x.al = m.data;
    copertura.set(m.conto, x);
  }
  const buchi = calcolaBuchi();
  const aggiunti = esiti.reduce((a, e) => a + e.aggiunti, 0);

  return (
    <div className="pagina">
      <Intestazione titolo="Importa estratti conto" />
      <div className={"zona-file" + (sopra ? " sopra" : "")}
        onDragOver={(e) => { e.preventDefault(); setSopra(true); }} onDragLeave={() => setSopra(false)}
        onDrop={(e) => { e.preventDefault(); setSopra(false); importa([...e.dataTransfer.files]); }}>
        <p><strong>Scegli i PDF degli estratti conto</strong>, anche molti insieme. L'app riconosce da sola banca e formato.</p>
        <ul className="formati">
          <li>Intesa Sanpaolo: estratto conto trimestrale e «Lista movimenti» esportata dall'app o dal sito</li>
          <li>Trade Republic: estratto conto (statement.pdf, con acquisti di ETF, quote e ISIN)</li>
          <li>Satispay: «Esporta report» (lista transazioni)</li>
          <li>Revolut: estratto conto in PDF (in italiano o in inglese)</li>
        </ul>
        <input ref={input} type="file" accept="application/pdf,.pdf" multiple hidden onChange={(e) => importa([...(e.target.files ?? [])])} />
        <button className="primario" disabled={!!avanz} onClick={() => input.current?.click()}>{avanz ? "Lettura in corso…" : "Scegli i PDF"}</button>
        <label className="spunta"><input type="checkbox" checked={reimporta} onChange={(e) => setReimporta(e.target.checked)} /> Rileggi anche i file già importati (non crea doppioni)</label>
        <p className="nota">I PDF vengono letti su questo dispositivo e non vengono inviati da nessuna parte. Reimportare lo stesso file non crea doppioni.</p>
      </div>
      {avanz && (
        <div className="avanzamento" role="status">
          <progress max={avanz.n} value={avanz.i} />
          <span>Leggo {avanz.nome} ({avanz.i + 1} di {avanz.n})</span>
        </div>
      )}
      {esiti.length > 0 && !avanz && (esiti.every((e) => e.formato === "errore")
        ? <Avviso tipo="attenzione">Nessun file letto. Se la banca non è ancora supportata puoi inviare un esempio anonimo con il pulsante qui sotto.</Avviso>
        : <Avviso tipo="ok">Aggiunti {aggiunti.toLocaleString("it-IT")} movimenti. I doppioni vengono scartati.</Avviso>)}
      {!avanz && esiti.some((e) => e.collette?.length) && (
        <Avviso>Riconosciute come collette Satispay: {[...new Set(esiti.flatMap((e) => e.collette ?? []))].join(", ")}. Puoi controllarle in Impostazioni › Salvadanai e collette Satispay.</Avviso>)}
      {esiti.length > 0 && (
        <div className="tabella-scorre">
          <table className="tabella">
            <thead><tr><th>File</th><th>Formato</th><th className="n">Letti</th><th className="n">Aggiunti</th><th>Controllo saldo</th></tr></thead>
            <tbody>{esiti.map((e) => {
              const a = e.saldo_finale_dichiarato, b = e.saldo_finale_calcolato;
              const ctrl = a == null || b == null ? "–" : Math.abs(a - b) < 0.01 ? "✅ torna" : `⚠️ ${a.toLocaleString("it-IT")} dichiarato, ${b.toLocaleString("it-IT")} calcolato`;
              return (
                <tr key={e.file}><td className="taglia">{e.file}{e.errore && <div className="neg piccolo-testo">{e.errore}</div>}
                  {nonLetti[e.file] && <button className="piccolo" onClick={() => setCampione(nonLetti[e.file])}>Invia un esempio anonimo per aggiungerla</button>}</td>
                  <td>{NOMI_FORMATO[e.formato] ?? e.formato}</td><td className="n num">{e.letti}</td><td className="n num">{e.aggiunti}</td><td>{ctrl}</td></tr>
              );
            })}</tbody>
          </table>
        </div>
      )}

      <Sezione titolo="La tua banca non c'è?" nota="Invia un estratto conto di esempio: sul dispositivo ne viene creata una versione anonima (tutte le cifre diventano * e le lettere x), che vedi in anteprima prima di inviarla. Serve per insegnare all'app a leggere quella banca.">
        <input ref={inputCampione} type="file" accept="application/pdf,.pdf" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) setCampione(f); e.target.value = ""; }} />
        <div className="pulsanti"><button onClick={() => inputCampione.current?.click()}>Scegli un estratto conto da inviare</button></div>
      </Sezione>
      <Pannello aperto={!!campione} chiudi={() => setCampione(null)} titolo="Aggiungi una banca">
        {campione && <InviaCampione file={campione} chiudi={() => setCampione(null)} />}
      </Pannello>

      <Sezione titolo="Copertura per conto">
        {!mov.length ? <p className="nota">Nessun movimento ancora: importa i PDF.</p> : (
          <div className="tabella-scorre"><table className="tabella">
            <thead><tr><th>Conto</th><th className="n">Movimenti</th><th>Dal</th><th>Al</th></tr></thead>
            <tbody>{[...copertura.entries()].sort().map(([c, x]) => (
              <tr key={c}><td>{c}</td><td className="n num">{x.n.toLocaleString("it-IT")}</td><td>{formatoIt(x.dal)}</td><td>{formatoIt(x.al)}</td></tr>
            ))}</tbody></table></div>
        )}
        {buchi.length > 0 && <>
          <p className="nota">Periodi senza movimenti, probabilmente estratti conto mancanti:</p>
          <div className="tabella-scorre"><table className="tabella">
            <thead><tr><th>Conto</th><th>Dal</th><th>Al</th><th className="n">Giorni</th></tr></thead>
            <tbody>{buchi.map((b) => <tr key={b.conto + b.dal}><td>{b.conto}</td><td>{formatoIt(b.dal)}</td><td>{formatoIt(b.al)}</td><td className="n num">{b.giorni}</td></tr>)}</tbody>
          </table></div>
        </>}
      </Sezione>
      <details className="dettagli">
        <summary>File già importati ({stato.reg.importati.length})</summary>
        <div className="tabella-scorre"><table className="tabella">
          <thead><tr><th>File</th><th>Formato</th><th className="n">Nuovi</th><th>Periodo</th><th>Importato il</th></tr></thead>
          <tbody>{[...stato.reg.importati].sort((a, b) => (a.importato_il < b.importato_il ? 1 : -1)).map((r) => (
            <tr key={r.file}><td className="taglia">{r.file}</td><td>{NOMI_FORMATO[r.formato] ?? r.formato}</td><td className="n num">{r.movimenti_nuovi}</td>
              <td>{r.dal ? `${formatoIt(r.dal)} – ${formatoIt(r.al)}` : "–"}</td><td>{r.importato_il}</td></tr>
          ))}</tbody></table></div>
      </details>
    </div>
  );
}
