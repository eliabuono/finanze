/** Invio di un estratto conto anonimo di una banca non ancora supportata. */
import { useEffect, useMemo, useState } from "react";
import { creaCampione, type Campione } from "../core/anonimizza";
import { VERSIONE_APP } from "./ambiente";
import { indirizzoServizio } from "./azioni";
import { paginePdf } from "./pdf";
import { Avviso, scaricaFile } from "./ui";

const DOCUMENTI = ["Estratto conto", "Lista movimenti esportata dall'app o dal sito", "Estratto conto carta di credito", "Conto titoli / investimenti", "Altro"];

async function comprimi(testo: string): Promise<{ dati: Uint8Array; gzip: boolean }> {
  const grezzo = new TextEncoder().encode(testo);
  if (typeof CompressionStream === "undefined") return { dati: grezzo, gzip: false };
  const s = new Blob([grezzo]).stream().pipeThrough(new CompressionStream("gzip"));
  return { dati: new Uint8Array(await new Response(s).arrayBuffer()), gzip: true };
}

function base64(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Disegno della pagina come la vedrà lo sviluppatore. */
function Anteprima({ c, pagina }: { c: Campione; pagina: number }) {
  const pg = c.pagine[pagina];
  if (!pg) return null;
  return (
    <svg className="anteprima-campione" viewBox={`0 0 ${pg.w} ${pg.h}`} role="img" aria-label={`Anteprima anonima della pagina ${pagina + 1}`}>
      <rect width={pg.w} height={pg.h} fill="#fff" />
      {pg.p.map(([t, x0, x1, top, bottom], i) => {
        const h = Math.max(4, bottom - top);
        return <text key={i} x={x0} y={bottom - h * 0.15} fontSize={h * 0.95} textLength={Math.max(1, x1 - x0)} lengthAdjust="spacingAndGlyphs" fill="#13233a">{t}</text>;
      })}
    </svg>
  );
}

export function InviaCampione({ file, chiudi }: { file: File; chiudi: () => void }) {
  const [c, setC] = useState<Campione | null>(null);
  const [errore, setErrore] = useState("");
  const [banca, setBanca] = useState("");
  const [documento, setDocumento] = useState(DOCUMENTI[0]);
  const [nota, setNota] = useState("");
  const [visto, setVisto] = useState(false);
  const [pagina, setPagina] = useState(0);
  const [stato, setStato] = useState<"pronto" | "invio" | "inviato">("pronto");

  useEffect(() => {
    let vivo = true;
    paginePdf(file).then((p) => { if (vivo) setC(creaCampione(p)); }).catch((e) => setErrore("Non riesco a leggere il PDF: " + (e?.message ?? e)));
    return () => { vivo = false; };
  }, [file]);

  const json = useMemo(() => (c ? JSON.stringify({ ...c, banca, documento, nota, versione_app: VERSIONE_APP }) : ""), [c, banca, documento, nota]);
  const servizio = indirizzoServizio();
  const nomeFile = `campione_${(banca || "banca").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}.json`;

  const invia = async () => {
    setStato("invio"); setErrore("");
    try {
      const { dati, gzip } = await comprimi(json);
      const r = await fetch(servizio.replace(/\/+$/, "") + "/campioni", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ banca: banca.trim(), documento, nota: nota.trim(), versione_app: VERSIONE_APP, pagine: c!.pagine_totali, gzip, dati: base64(dati) }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) throw new Error(j.error_description || j.error || `errore ${r.status}`);
      setStato("inviato");
    } catch (e: any) {
      setErrore("Invio non riuscito: " + (e?.message ?? e) + ". Puoi riprovare più tardi.");
      setStato("pronto");
    }
  };

  if (stato === "inviato") return (
    <div className="modulo">
      <Avviso tipo="ok">Inviato, grazie! Quando il supporto per {banca} sarà pronto l'app si aggiornerà da sola: a quel punto reimporta il PDF.</Avviso>
      <div className="pulsanti"><button className="primario" onClick={chiudi}>Chiudi</button></div>
    </div>
  );

  return (
    <div className="modulo">
      <p className="nota">Per insegnare all'app a leggere questa banca serve un esempio. Il PDF non viene inviato: parte solo una versione anonima creata qui sul dispositivo. Ogni cifra diventa * (importi, date, IBAN, numeri di carta) e ogni lettera diventa x: descrizioni, nomi e indirizzi non si leggono più. Restano leggibili solo le intestazioni delle colonne e poche parole di struttura (Data, Descrizione, Saldo, Totale, i mesi, il nome della banca) e la posizione di ogni parola nella pagina.</p>
      {errore && <Avviso tipo="errore">{errore}</Avviso>}
      {!c && !errore && <p className="nota">Preparo la versione anonima…</p>}
      {c && <>
        <label className="campo"><span>Nome della banca</span><input value={banca} onChange={(e) => setBanca(e.target.value)} placeholder="es. Fineco, UniCredit, BPER" required /></label>
        <label className="campo"><span>Tipo di documento</span>
          <select value={documento} onChange={(e) => setDocumento(e.target.value)}>{DOCUMENTI.map((d) => <option key={d}>{d}</option>)}</select>
        </label>
        <label className="campo"><span>Nota (facoltativa)</span><textarea rows={2} value={nota} onChange={(e) => setNota(e.target.value)} placeholder="es. è l'estratto trimestrale scaricato dal sito" /></label>
        <div className="s-testa">
          <strong>Anteprima di quello che viene inviato</strong>
          {c.pagine.length > 1 && (
            <span className="pulsanti">
              <button className="piccolo" disabled={pagina === 0} onClick={() => setPagina(pagina - 1)} aria-label="Pagina precedente">‹</button>
              <span className="tenue">pagina {pagina + 1} di {c.pagine.length}</span>
              <button className="piccolo" disabled={pagina >= c.pagine.length - 1} onClick={() => setPagina(pagina + 1)} aria-label="Pagina successiva">›</button>
            </span>
          )}
        </div>
        <Anteprima c={c} pagina={pagina} />
        {c.pagine_totali > c.pagine.length && <p className="nota">Vengono inviate solo le prime {c.pagine.length} pagine su {c.pagine_totali}.</p>}
        <label className="spunta"><input type="checkbox" checked={visto} onChange={(e) => setVisto(e.target.checked)} /> Ho guardato l'anteprima e va bene inviarla</label>
        <div className="pulsanti">
          {servizio
            ? <button className="primario" disabled={!visto || !banca.trim() || stato === "invio"} onClick={invia}>{stato === "invio" ? "Invio…" : "Invia"}</button>
            : <Avviso tipo="attenzione">L'invio non è configurato in questa versione dell'app: scarica il file e mandalo a chi ti ha dato l'app.</Avviso>}
          <button disabled={!visto || !banca.trim()} onClick={() => scaricaFile(nomeFile, json, "application/json")}>Scarica il file</button>
        </div>
      </>}
    </div>
  );
}
