/** Componenti comuni dell'interfaccia e formattazione dei numeri. */
import { useEffect, useRef, useState, type ReactNode } from "react";

export function eur(v: number | null | undefined, dec = 0): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "–";
  if (Math.abs(v) < 0.5 * Math.pow(10, -dec)) v = 0;
  return v.toLocaleString("it-IT", { minimumFractionDigits: dec, maximumFractionDigits: dec }) + "\u00a0€";
}
export function pct(v: number | null | undefined, dec = 1, segno = true): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "–";
  return (segno && v > 0 ? "+" : "") + (v * 100).toLocaleString("it-IT", { minimumFractionDigits: dec, maximumFractionDigits: dec }) + "%";
}
export const num = (v: number | null | undefined, dec = 2) =>
  v === null || v === undefined || !Number.isFinite(v) ? "–" : v.toLocaleString("it-IT", { minimumFractionDigits: dec, maximumFractionDigits: dec });
export const segnoCls = (v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(v) || v === 0 ? "" : v > 0 ? "pos" : "neg");

export function Intestazione({ titolo, children }: { titolo: string; children?: ReactNode }) {
  return (
    <header className="intestazione">
      <h1>{titolo}</h1>
      {children && <div className="azioni">{children}</div>}
    </header>
  );
}

export function Cifra({ etichetta, valore, nota, cls = "", grande = false }: { etichetta: string; valore: ReactNode; nota?: ReactNode; cls?: string; grande?: boolean }) {
  return (
    <div className={"cifra" + (grande ? " grande" : "")}>
      <div className="c-etichetta">{etichetta}</div>
      <div className={"c-valore num " + cls}>{valore}</div>
      {nota !== undefined && <div className="c-nota">{nota}</div>}
    </div>
  );
}

export function Segmenti<T extends string>({ valore, opzioni, cambia, etichetta }: { valore: T; opzioni: readonly T[] | { v: T; t: string }[]; cambia: (v: T) => void; etichetta: string }) {
  const op = (opzioni as any[]).map((o) => (typeof o === "string" ? { v: o, t: o } : o)) as { v: T; t: string }[];
  return (
    <div className="segmenti" role="radiogroup" aria-label={etichetta}>
      {op.map((o) => (
        <button key={o.v} type="button" role="radio" aria-checked={o.v === valore} className={o.v === valore ? "attivo" : ""} onClick={() => cambia(o.v)}>
          {o.t}
        </button>
      ))}
    </div>
  );
}

export function Scelta({ valore, opzioni, cambia, etichetta, vuota }: { valore: string; opzioni: string[]; cambia: (v: string) => void; etichetta: string; vuota?: string }) {
  return (
    <label className="campo">
      <span>{etichetta}</span>
      <select value={valore} onChange={(e) => cambia(e.target.value)}>
        {vuota !== undefined && <option value="">{vuota}</option>}
        {opzioni.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </label>
  );
}

/** Selezione multipla a pastiglie (nessuna selezionata = tutte). */
export function Pastiglie({ opzioni, scelte, cambia, etichetta }: { opzioni: string[]; scelte: string[]; cambia: (v: string[]) => void; etichetta: string }) {
  const s = new Set(scelte);
  return (
    <div className="pastiglie" role="group" aria-label={etichetta}>
      {opzioni.map((o) => (
        <button key={o} type="button" aria-pressed={s.has(o)} className={s.has(o) ? "attiva" : ""}
          onClick={() => { const q = new Set(s); q.has(o) ? q.delete(o) : q.add(o); cambia(opzioni.filter((x) => q.has(x))); }}>
          {o}
        </button>
      ))}
    </div>
  );
}

export function Avviso({ tipo = "info", children }: { tipo?: "info" | "attenzione" | "ok" | "errore"; children: ReactNode }) {
  return <div className={"avviso " + tipo} role={tipo === "errore" ? "alert" : "status"}>{children}</div>;
}

/** Pannello che sale dal basso sul telefono e appare al centro sul PC. */
export function Pannello({ aperto, chiudi, titolo, children }: { aperto: boolean; chiudi: () => void; titolo: string; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (aperto && !d.open) d.showModal();
    if (!aperto && d.open) d.close();
  }, [aperto]);
  return (
    <dialog ref={ref} className="pannello" onClose={chiudi} onClick={(e) => { if (e.target === ref.current) chiudi(); }}>
      <div className="p-testa">
        <h2>{titolo}</h2>
        <button type="button" className="chiudi" onClick={chiudi} aria-label="Chiudi">×</button>
      </div>
      <div className="p-corpo">{aperto && children}</div>
    </dialog>
  );
}

export function Vuoto({ titolo, children }: { titolo: string; children?: ReactNode }) {
  return (
    <div className="vuoto-pagina">
      <h2>{titolo}</h2>
      {children}
    </div>
  );
}

export function Sezione({ titolo, children, azioni, nota }: { titolo?: string; children: ReactNode; azioni?: ReactNode; nota?: ReactNode }) {
  return (
    <section className="sezione">
      {(titolo || azioni) && (
        <div className="s-testa">
          {titolo && <h2>{titolo}</h2>}
          {azioni && <div className="azioni">{azioni}</div>}
        </div>
      )}
      {nota && <p className="nota">{nota}</p>}
      {children}
    </section>
  );
}

export function useMemoria<T>(chiave: string, iniziale: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => {
    try { const s = localStorage.getItem("finanze:" + chiave); return s ? (JSON.parse(s) as T) : iniziale; } catch { return iniziale; }
  });
  return [v, (x: T) => { setV(x); try { localStorage.setItem("finanze:" + chiave, JSON.stringify(x)); } catch { /* facoltativo */ } }];
}

export function scaricaFile(nome: string, contenuto: BlobPart, tipo = "text/plain;charset=utf-8") {
  const url = URL.createObjectURL(new Blob([contenuto], { type: tipo }));
  const a = document.createElement("a");
  a.href = url; a.download = nome;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export const MESI_BREVI = ["gen", "feb", "mar", "apr", "mag", "giu", "lug", "ago", "set", "ott", "nov", "dic"];
export const etichettaMese = (p: string) => `${MESI_BREVI[+p.slice(5, 7) - 1]} ${p.slice(2, 4)}`;
