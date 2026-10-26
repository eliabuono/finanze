/** Grafici in SVG (scale e forme di d3, disegno con React). */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { scaleLinear, scaleUtc, scaleBand } from "d3-scale";
import { line, area, arc, pie, curveStepAfter, curveLinear } from "d3-shape";
import { bisectLeft, extent, max, min } from "d3-array";
import { timeFormatLocale } from "d3-time-format";
import { ms } from "../core/date";
import { importiNascosti } from "./privacy";
import type { Candela } from "../core/analisi";

export const PALETTE = ["#0f7b6c", "#3b6fd4", "#d98e04", "#a23b72", "#5b8c2a", "#7a5bc7", "#c2513a", "#2a9db0",
  "#8a6d3b", "#d15a9b", "#4f6d8f", "#9aa631"];
/** Colori dei conti: senza il blu, riservato alla linea della liquidità. */
export const PALETTE_CONTI = PALETTE.filter((_, i) => i !== 1);
export const NERO = "var(--ink)";
export const BLU = "#1f5fbf";

const locIt = timeFormatLocale({
  dateTime: "%A %e %B %Y, %X", date: "%d/%m/%Y", time: "%H:%M:%S", periods: ["AM", "PM"],
  days: ["domenica", "lunedì", "martedì", "mercoledì", "giovedì", "venerdì", "sabato"],
  shortDays: ["dom", "lun", "mar", "mer", "gio", "ven", "sab"],
  months: ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"],
  shortMonths: ["gen", "feb", "mar", "apr", "mag", "giu", "lug", "ago", "set", "ott", "nov", "dic"],
});
const fmtMeseAnno = locIt.utcFormat("%b %Y");
const fmtAnno = locIt.utcFormat("%Y");
const fmtGiorno = locIt.utcFormat("%e %b %Y");
const fmtMese = locIt.utcFormat("%b");

function tickData(d: Date, span: number) {
  if (span > 3 * 365 * 864e5) return fmtAnno(d);
  if (d.getUTCMonth() === 0) return fmtAnno(d);
  return span > 300 * 864e5 ? fmtMese(d) : fmtMeseAnno(d);
}

export function useLarghezza<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((e) => setW(Math.floor(e[0].contentRect.width)));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

export const eurBreve = (v: number) => {
  if (importiNascosti()) return "•••";
  const a = Math.abs(v);
  if (a >= 1e6) return (v / 1e6).toLocaleString("it-IT", { maximumFractionDigits: 1 }) + " M";
  if (a >= 1e4) return Math.round(v / 1e3).toLocaleString("it-IT") + " k";
  if (a >= 1e3) return (v / 1e3).toLocaleString("it-IT", { maximumFractionDigits: 1 }) + " k";
  return v.toLocaleString("it-IT", { maximumFractionDigits: 0 });
};

interface Suggerimento { x: number; y: number; contenuto: ReactNode; }
function Fumetto({ s, larghezza }: { s: Suggerimento | null; larghezza: number }) {
  if (!s) return null;
  const aDestra = s.x < larghezza / 2;
  return (
    <div className="fumetto" style={{ top: Math.max(4, s.y), ...(aDestra ? { left: s.x + 14 } : { right: larghezza - s.x + 14 }) }}>
      {s.contenuto}
    </div>
  );
}

function Legenda({ voci, nascoste, cambia }: { voci: { nome: string; colore: string; tratteggio?: boolean }[]; nascoste?: Set<string>; cambia?: (n: string) => void }) {
  return (
    <div className="legenda">
      {voci.map((v) => (
        <button key={v.nome} type="button" className={"voce" + (nascoste?.has(v.nome) ? " spenta" : "")}
          onClick={() => cambia?.(v.nome)} disabled={!cambia} aria-pressed={!nascoste?.has(v.nome)}>
          <span className="campione" style={{ background: v.tratteggio ? "transparent" : v.colore, borderColor: v.colore }} />
          {v.nome}
        </button>
      ))}
    </div>
  );
}

// ================================================================== linee
export interface SerieLinea {
  nome: string; valori: (number | null)[]; colore?: string; spessore?: number; tratteggio?: boolean;
  area?: boolean; gradini?: boolean;
  /** fascia di incertezza disegnata attorno alla serie */
  fascia?: { basso: (number | null)[]; alto: (number | null)[] };
}

/** Grafico a linee nel tempo. Trascinando sul grafico si ingrandisce quel tratto (zoom). */
export function GraficoLinee({ giorni, serie, altezza = 320, formato = eurBreve, formatoFumetto, zero = false, legenda = true }: {
  giorni: string[]; serie: SerieLinea[]; altezza?: number; formato?: (v: number) => string;
  formatoFumetto?: (v: number) => string; zero?: boolean; legenda?: boolean;
}) {
  const [ref, w] = useLarghezza<HTMLDivElement>();
  const [nascoste, setNascoste] = useState<Set<string>>(new Set());
  const [hover, setHover] = useState<number | null>(null);
  const [zoom, setZoom] = useState<[number, number] | null>(null);
  const [trascina, setTrascina] = useState<{ da: number; a: number; attivo: boolean } | null>(null);
  const chiaveDati = giorni.length + "|" + (giorni[0] ?? "") + "|" + (giorni[giorni.length - 1] ?? "");
  useEffect(() => { setZoom(null); setHover(null); }, [chiaveDati]);
  const colori = serie.map((s, i) => s.colore ?? PALETTE[i % PALETTE.length]);
  const visibili = serie.map((s, i) => ({ ...s, colore: colori[i] })).filter((s) => !nascoste.has(s.nome));
  const m = { t: 10, r: 12, b: 26, l: 48 };
  const x = useMemo(() => giorni.map((d) => new Date(ms(d))), [giorni]);
  const tempi = useMemo(() => x.map((d) => d.getTime()), [x]);
  const [i0, i1] = zoom ?? [0, Math.max(0, giorni.length - 1)];
  // diradamento per grafici con molti punti
  const passo = Math.max(1, Math.floor((i1 - i0 + 1) / Math.max(200, w * 1.5)));
  const indici = useMemo(() => {
    const out: number[] = [];
    for (let i = i0; i <= i1; i += passo) out.push(i);
    if (out[out.length - 1] !== i1 && giorni.length) out.push(i1);
    return out;
  }, [i0, i1, passo, giorni.length]);
  if (!giorni.length) return <div ref={ref} className="grafico vuoto">Nessun dato da mostrare.</div>;
  const definito = (v: number | null | undefined): v is number => v !== null && v !== undefined && Number.isFinite(v);
  const valori = visibili.flatMap((s) => indici.flatMap((i) => [s.valori[i], s.fascia?.basso[i], s.fascia?.alto[i]]).filter(definito));
  let y0 = min(valori) ?? 0, y1 = max(valori) ?? 1;
  if (zero) { y0 = Math.min(0, y0); y1 = Math.max(0, y1); }
  if (y0 === y1) { y0 -= 1; y1 += 1; }
  const sx = scaleUtc().domain([x[i0], x[i1] > x[i0] ? x[i1] : new Date(x[i0].getTime() + 864e5)]).range([m.l, Math.max(m.l + 10, w - m.r)]);
  const sy = scaleLinear().domain([y0, y1]).nice(5).range([altezza - m.b, m.t]);
  const span = x[i1].getTime() - x[i0].getTime();
  const tickX = sx.ticks(Math.max(2, Math.floor(w / 90)));
  const indiceDa = (px: number) => {
    const t = sx.invert(px).getTime();
    let i = bisectLeft(tempi, t);
    if (i > 0 && (i >= tempi.length || t - tempi[i - 1] < tempi[i] - t)) i--;
    return Math.min(Math.max(i, i0), i1);
  };
  const posX = (e: React.PointerEvent) => e.clientX - (e.currentTarget as SVGElement).getBoundingClientRect().left;
  const onDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const p = posX(e);
    setTrascina({ da: p, a: p, attivo: false });
  };
  const onMove = (e: React.PointerEvent) => {
    const p = posX(e);
    if (trascina) {
      const attivo = trascina.attivo || Math.abs(p - trascina.da) > 8;
      if (attivo && !trascina.attivo) (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
      setTrascina({ ...trascina, a: p, attivo });
      if (attivo) { setHover(null); return; }
    }
    setHover(indiceDa(p));
  };
  const onUp = () => {
    if (trascina?.attivo) {
      const a = indiceDa(Math.min(trascina.da, trascina.a)), b = indiceDa(Math.max(trascina.da, trascina.a));
      if (b - a >= 2) setZoom([a, b]);
    }
    setTrascina(null);
  };
  const fmtF = formatoFumetto ?? ((v: number) => v.toLocaleString("it-IT", { maximumFractionDigits: 2 }));
  let fumetto: Suggerimento | null = null;
  if (hover !== null && !trascina?.attivo) {
    const righe = visibili.map((s) => ({ s, v: s.valori[hover] })).filter((r) => definito(r.v));
    fumetto = {
      x: sx(x[hover]), y: m.t,
      contenuto: (<>
        <div className="f-titolo">{fmtGiorno(x[hover])}</div>
        {righe.map(({ s, v }) => (
          <div key={s.nome} className="f-riga"><span className="campione" style={{ background: s.colore }} />
            <span className="f-nome">{s.nome}</span><span className="f-val">{fmtF(v as number)}</span></div>
        ))}
      </>),
    };
  }
  return (
    <div className="grafico" ref={ref}>
      {zoom && (
        <button type="button" className="piccolo reimposta-zoom" onClick={() => setZoom(null)}>Reimposta zoom</button>
      )}
      {w > 0 && (
        <svg width={w} height={altezza} role="img" aria-label={"Grafico: " + serie.map((s) => s.nome).join(", ") + ". Trascina per ingrandire un periodo."}
          onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={() => setTrascina(null)}
          onPointerLeave={() => { if (!trascina?.attivo) { setHover(null); setTrascina(null); } }} onDoubleClick={() => setZoom(null)}
          style={{ touchAction: "pan-y" }}>
          <defs><clipPath id={"clip" + chiaveDati.length + m.l}><rect x={m.l} y={0} width={Math.max(0, w - m.l - m.r)} height={altezza} /></clipPath></defs>
          {sy.ticks(5).map((t) => (
            <g key={t}>
              <line x1={m.l} x2={w - m.r} y1={sy(t)} y2={sy(t)} className={t === 0 ? "asse-zero" : "griglia"} />
              <text x={m.l - 6} y={sy(t)} dy="0.32em" textAnchor="end" className="etichetta">{formato(t)}</text>
            </g>
          ))}
          {tickX.map((t) => (
            <text key={t.getTime()} x={sx(t)} y={altezza - 6} textAnchor="middle" className="etichetta">{tickData(t, span)}</text>
          ))}
          <g clipPath={`url(#clip${chiaveDati.length + m.l})`}>
            {visibili.map((s) => {
              const pts = indici.map((i) => [i, s.valori[i]] as const);
              const curva = s.gradini ? curveStepAfter : curveLinear;
              const ln = line<readonly [number, number | null]>().defined((p) => definito(p[1])).x((p) => sx(x[p[0]])).y((p) => sy(p[1] as number)).curve(curva);
              const ar = area<readonly [number, number | null]>().defined((p) => definito(p[1])).x((p) => sx(x[p[0]])).y0(sy(Math.max(y0, 0)))
                .y1((p) => sy(p[1] as number)).curve(curva);
              const fa = s.fascia && area<number>().defined((i) => definito(s.fascia!.basso[i]) && definito(s.fascia!.alto[i]))
                .x((i) => sx(x[i])).y0((i) => sy(s.fascia!.basso[i] as number)).y1((i) => sy(s.fascia!.alto[i] as number));
              return (
                <g key={s.nome}>
                  {fa && <path d={fa(indici) ?? ""} style={{ fill: s.colore }} opacity={0.15} />}
                  {s.area && <path d={ar(pts) ?? ""} style={{ fill: s.colore }} opacity={0.14} />}
                  <path d={ln(pts) ?? ""} fill="none" style={{ stroke: s.colore }} strokeWidth={s.spessore ?? 1.75}
                    strokeDasharray={s.tratteggio ? "6 4" : undefined} strokeLinejoin="round" strokeLinecap="round" />
                </g>
              );
            })}
          </g>
          {trascina?.attivo && (
            <rect x={Math.max(m.l, Math.min(trascina.da, trascina.a))} y={m.t} width={Math.abs(trascina.a - trascina.da)} height={altezza - m.b - m.t} className="selezione-zoom" />
          )}
          {hover !== null && !trascina?.attivo && (
            <g>
              <line x1={sx(x[hover])} x2={sx(x[hover])} y1={m.t} y2={altezza - m.b} className="mirino" />
              {visibili.map((s) => definito(s.valori[hover]) ? (
                <circle key={s.nome} cx={sx(x[hover])} cy={sy(s.valori[hover] as number)} r={3.5} style={{ fill: s.colore, stroke: "var(--surface)" }} strokeWidth={1.5} />
              ) : null)}
            </g>
          )}
        </svg>
      )}
      <Fumetto s={fumetto} larghezza={w} />
      {legenda && serie.length > 1 && (
        <Legenda voci={serie.map((s, i) => ({ nome: s.nome, colore: colori[i], tratteggio: s.tratteggio }))} nascoste={nascoste}
          cambia={(n) => setNascoste((p) => { const q = new Set(p); q.has(n) ? q.delete(n) : q.add(n); return q; })} />
      )}
    </div>
  );
}

// ================================================================== barre impilate
export function GraficoBarre({ periodi, serie, altezza = 320, etichettaPeriodo, formatoFumetto }: {
  periodi: string[]; serie: { nome: string; valori: number[]; colore?: string }[]; altezza?: number;
  etichettaPeriodo: (p: string) => string; formatoFumetto: (v: number) => string;
}) {
  const [ref, w] = useLarghezza<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const [nascoste, setNascoste] = useState<Set<string>>(new Set());
  if (!periodi.length) return <div ref={ref} className="grafico vuoto">Nessun dato nel periodo.</div>;
  const colori = serie.map((s, i) => s.colore ?? PALETTE[i % PALETTE.length]);
  const vis = serie.map((s, i) => ({ ...s, colore: colori[i] })).filter((s) => !nascoste.has(s.nome));
  const m = { t: 10, r: 8, b: 26, l: 48 };
  const tot = periodi.map((_, i) => vis.reduce((a, s) => a + s.valori[i], 0));
  const sx = scaleBand<number>().domain(periodi.map((_, i) => i)).range([m.l, Math.max(m.l + 10, w - m.r)]).padding(0.22);
  const sy = scaleLinear().domain([0, max(tot) || 1]).nice(5).range([altezza - m.b, m.t]);
  const ogni = Math.max(1, Math.ceil(periodi.length / Math.max(1, Math.floor(w / 56))));
  let fumetto: Suggerimento | null = null;
  if (hover !== null) {
    const righe = vis.map((s) => ({ s, v: s.valori[hover] })).filter((r) => r.v > 0).sort((a, b) => b.v - a.v);
    fumetto = {
      x: (sx(hover) ?? 0) + sx.bandwidth() / 2, y: m.t,
      contenuto: (<>
        <div className="f-titolo">{etichettaPeriodo(periodi[hover])} · {formatoFumetto(tot[hover])}</div>
        {righe.map(({ s, v }) => (
          <div key={s.nome} className="f-riga"><span className="campione" style={{ background: s.colore }} />
            <span className="f-nome">{s.nome}</span><span className="f-val">{formatoFumetto(v)}</span></div>
        ))}
      </>),
    };
  }
  return (
    <div className="grafico" ref={ref}>
      {w > 0 && (
        <svg width={w} height={altezza} role="img" aria-label="Grafico a barre" onPointerLeave={() => setHover(null)}>
          {sy.ticks(5).map((t) => (
            <g key={t}>
              <line x1={m.l} x2={w - m.r} y1={sy(t)} y2={sy(t)} className={t === 0 ? "asse-zero" : "griglia"} />
              <text x={m.l - 6} y={sy(t)} dy="0.32em" textAnchor="end" className="etichetta">{eurBreve(t)}</text>
            </g>
          ))}
          {periodi.map((p, i) => {
            let acc = 0;
            return (
              <g key={p} onPointerEnter={() => setHover(i)} onPointerDown={() => setHover(i)}>
                <rect x={sx(i)} y={m.t} width={sx.bandwidth()} height={altezza - m.b - m.t} fill="transparent" />
                {vis.map((s) => {
                  const v = s.valori[i];
                  if (!(v > 0)) return null;
                  const y = sy(acc + v), h = sy(acc) - y;
                  acc += v;
                  return <rect key={s.nome} x={sx(i)} y={y} width={sx.bandwidth()} height={Math.max(0, h - 0.5)} style={{ fill: s.colore }}
                    opacity={hover === null || hover === i ? 1 : 0.55} />;
                })}
                {i % ogni === 0 && <text x={(sx(i) ?? 0) + sx.bandwidth() / 2} y={altezza - 6} textAnchor="middle" className="etichetta">{etichettaPeriodo(p)}</text>}
              </g>
            );
          })}
        </svg>
      )}
      <Fumetto s={fumetto} larghezza={w} />
      <Legenda voci={serie.map((s, i) => ({ nome: s.nome, colore: colori[i] }))} nascoste={nascoste}
        cambia={(n) => setNascoste((p) => { const q = new Set(p); q.has(n) ? q.delete(n) : q.add(n); return q; })} />
    </div>
  );
}

// ================================================================== ciambella
export function Ciambella({ voci, formato, titolo }: { voci: { nome: string; valore: number; colore?: string }[]; formato: (v: number) => string; titolo?: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const dati = voci.filter((v) => v.valore > 0).map((v, i) => ({ ...v, colore: v.colore ?? PALETTE[i % PALETTE.length] }));
  const tot = dati.reduce((a, v) => a + v.valore, 0);
  if (!tot) return <div className="grafico vuoto">Nessun dato.</div>;
  const R = 92, r = 58;
  const archi = pie<(typeof dati)[number]>().value((d) => d.valore).sort(null)(dati);
  const a = arc<any>().innerRadius(r).outerRadius(R).padAngle(0.012).cornerRadius(2);
  const sel = hover !== null ? dati[hover] : null;
  return (
    <div className="ciambella">
      <svg viewBox="-100 -100 200 200" width={200} height={200} role="img" aria-label={titolo ?? "Ripartizione"} onPointerLeave={() => setHover(null)}>
        {archi.map((s, i) => (
          <path key={s.data.nome} d={a(s) ?? ""} fill={s.data.colore} opacity={hover === null || hover === i ? 1 : 0.45}
            onPointerEnter={() => setHover(i)} onPointerDown={() => setHover(i)} />
        ))}
        <text y={-6} textAnchor="middle" className="c-nome">{sel ? sel.nome : titolo ?? "Totale"}</text>
        <text y={14} textAnchor="middle" className="c-val">{formato(sel ? sel.valore : tot)}</text>
        {sel && <text y={30} textAnchor="middle" className="c-pct">{(sel.valore / tot * 100).toLocaleString("it-IT", { maximumFractionDigits: 1 })}%</text>}
      </svg>
      <ul className="c-elenco">
        {dati.map((v, i) => (
          <li key={v.nome} onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)} className={hover === i ? "attiva" : ""}>
            <span className="campione" style={{ background: v.colore }} />
            <span className="c-voce">{v.nome}</span>
            <span className="num">{formato(v.valore)}</span>
            <span className="num tenue">{(v.valore / tot * 100).toLocaleString("it-IT", { maximumFractionDigits: 1 })}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ================================================================== candele
export function GraficoCandele({ candele, altezza = 340, formato = eurBreve, formatoFumetto }: {
  candele: Candela[]; altezza?: number; formato?: (v: number) => string; formatoFumetto: (v: number) => string;
}) {
  const [ref, w] = useLarghezza<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  if (!candele.length) return <div ref={ref} className="grafico vuoto">Nessun dato da mostrare.</div>;
  const m = { t: 10, r: 10, b: 26, l: 48 };
  const sx = scaleBand<number>().domain(candele.map((_, i) => i)).range([m.l, Math.max(m.l + 10, w - m.r)]).padding(0.25);
  const sy = scaleLinear().domain([min(candele, (c) => c.minimo)!, max(candele, (c) => c.massimo)!]).nice(5).range([altezza - m.b, m.t]);
  const ogni = Math.max(1, Math.ceil(candele.length / Math.max(1, Math.floor(w / 70))));
  const span = ms(candele[candele.length - 1].data) - ms(candele[0].data);
  const c = hover !== null ? candele[hover] : null;
  return (
    <div className="grafico" ref={ref}>
      {w > 0 && (
        <svg width={w} height={altezza} role="img" aria-label="Grafico a candele" onPointerLeave={() => setHover(null)}>
          {sy.ticks(5).map((t) => (
            <g key={t}>
              <line x1={m.l} x2={w - m.r} y1={sy(t)} y2={sy(t)} className={t === 0 ? "asse-zero" : "griglia"} />
              <text x={m.l - 6} y={sy(t)} dy="0.32em" textAnchor="end" className="etichetta">{formato(t)}</text>
            </g>
          ))}
          {candele.map((k, i) => {
            const su = k.chiusura >= k.apertura;
            const col = su ? "var(--pos)" : "var(--neg)";
            const cx = (sx(i) ?? 0) + sx.bandwidth() / 2;
            const yA = sy(k.apertura), yC = sy(k.chiusura);
            return (
              <g key={k.data} onPointerEnter={() => setHover(i)} onPointerDown={() => setHover(i)}>
                <rect x={sx(i)} y={m.t} width={sx.bandwidth()} height={altezza - m.b - m.t} fill="transparent" />
                <line x1={cx} x2={cx} y1={sy(k.massimo)} y2={sy(k.minimo)} style={{ stroke: col }} strokeWidth={1} />
                <rect x={sx(i)} y={Math.min(yA, yC)} width={Math.max(1, sx.bandwidth())} height={Math.max(1, Math.abs(yA - yC))}
                  style={{ fill: su ? "var(--surface)" : col, stroke: col }} strokeWidth={1} opacity={hover === null || hover === i ? 1 : 0.6} />
                {i % ogni === 0 && <text x={cx} y={altezza - 6} textAnchor="middle" className="etichetta">{tickData(new Date(ms(k.data)), span)}</text>}
              </g>
            );
          })}
        </svg>
      )}
      <Fumetto larghezza={w} s={c && hover !== null ? {
        x: (sx(hover) ?? 0) + sx.bandwidth() / 2, y: m.t,
        contenuto: (<>
          <div className="f-titolo">fino al {fmtGiorno(new Date(ms(c.data)))}</div>
          {([["Apertura", c.apertura], ["Massimo", c.massimo], ["Minimo", c.minimo], ["Chiusura", c.chiusura]] as const).map(([n, v]) => (
            <div key={n} className="f-riga"><span className="f-nome">{n}</span><span className="f-val">{formatoFumetto(v)}</span></div>
          ))}
          <div className="f-riga"><span className="f-nome">Variazione</span>
            <span className={"f-val " + (c.chiusura >= c.apertura ? "pos" : "neg")}>{formatoFumetto(c.chiusura - c.apertura)}</span></div>
        </>),
      } : null} />
    </div>
  );
}
