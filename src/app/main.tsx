import "./stile.css";
import { StrictMode, useEffect, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import * as cloud from "./sync";
import { useSync } from "./sync";
import { registraServiceWorker } from "./pwa";
import { carica, invalidaCalcoli, salvaSubito, stato, useVersione } from "./stato";
import { Avviso } from "./ui";
import Saldi from "./pagine/Saldi";
import Movimenti from "./pagine/Movimenti";
import Investimenti from "./pagine/Investimenti";
import Spese from "./pagine/Spese";
import Importa from "./pagine/Importa";
import Allena from "./pagine/Allena";
import Simulazione from "./pagine/Simulazione";
import Impostazioni from "./pagine/Impostazioni";

const I = {
  saldi: <path d="M3 20h18M5 20V10m4 10V6m4 14v-8m4 8V4" />,
  movimenti: <path d="M4 6h16M4 12h16M4 18h10" />,
  investimenti: <path d="M3 17l5-5 4 4 8-9M15 7h5v5" />,
  spese: <><circle cx="12" cy="12" r="8" /><path d="M12 4v8l6 4" /></>,
  importa: <path d="M12 4v11m-5-5l5 5 5-5M5 20h14" />,
  allena: <path d="M4 7h10l6 5-6 5H4zM8 12h.01" />,
  simulazione: <path d="M4 19c4-1 6-4 8-8s4-6 8-7M4 5v14h16" />,
  impostazioni: <><circle cx="12" cy="12" r="3" /><path d="M12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10l2 2M5 19l2-2M17 7l2-2" /></>,
  altro: <path d="M5 12h.01M12 12h.01M19 12h.01" />,
} as const;
type Id = Exclude<keyof typeof I, "altro">;

const PAGINE: { id: Id; nome: string; breve: string; comp: (p: { vai: (p: string) => void }) => ReactNode; principale?: boolean }[] = [
  { id: "saldi", nome: "Patrimonio", breve: "Patrimonio", comp: Saldi, principale: true },
  { id: "movimenti", nome: "Movimenti", breve: "Movimenti", comp: Movimenti, principale: true },
  { id: "investimenti", nome: "Investimenti", breve: "Investimenti", comp: Investimenti, principale: true },
  { id: "spese", nome: "Entrate e uscite", breve: "Spese", comp: Spese, principale: true },
  { id: "importa", nome: "Importa", breve: "Importa", comp: Importa },
  { id: "allena", nome: "Allena categorie", breve: "Allena", comp: Allena },
  { id: "simulazione", nome: "Simulazione", breve: "Simulazione", comp: Simulazione },
  { id: "impostazioni", nome: "Impostazioni", breve: "Impostazioni", comp: Impostazioni },
];

const Icona = ({ id }: { id: keyof typeof I }) => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{I[id]}</svg>
);

function leggiHash(): Id {
  const h = location.hash.replace(/^#\/?/, "") as Id;
  return PAGINE.some((p) => p.id === h) ? h : "saldi";
}

function StatoSync() {
  const s = useSync();
  if (s.stato === "non collegato") return null;
  const testo = { collegato: "Google Drive aggiornato", sincronizzo: "Sincronizzo…", errore: "Google Drive: errore", scaduto: "Google Drive da ricollegare", "senza rete": "Senza rete" }[s.stato];
  return <a href="#impostazioni" className={"sync " + s.stato.replace(" ", "-")} title={s.errore || testo}><span className="pallino" />{testo}</a>;
}

function App() {
  useVersione();
  const [pagina, setPagina] = useState<Id>(leggiHash);
  const [menu, setMenu] = useState(false);
  useEffect(() => {
    const f = () => { setPagina(leggiHash()); setMenu(false); window.scrollTo(0, 0); };
    window.addEventListener("hashchange", f);
    return () => window.removeEventListener("hashchange", f);
  }, []);
  const vai = (p: string) => { location.hash = p; };
  const P = PAGINE.find((p) => p.id === pagina)!;
  if (!stato.pronto) return <div className="caricamento">Carico i dati…</div>;
  const altroAttivo = !P.principale;
  return (
    <div className="guscio">
      <nav className="laterale" aria-label="Sezioni">
        <div className="marchio">Finanze</div>
        {PAGINE.map((p) => (
          <a key={p.id} href={"#" + p.id} className={p.id === pagina ? "attiva" : ""} aria-current={p.id === pagina ? "page" : undefined}>
            <Icona id={p.id} />{p.nome}
          </a>
        ))}
        <div className="piede"><StatoSync /></div>
      </nav>
      <main>
        <div className="sync-mobile"><StatoSync /></div>
        {stato.note.length > 0 && (
          <Avviso>{stato.note.join(". ")}. <button className="link" onClick={() => { stato.note = []; invalidaCalcoli(); }}>Ok</button></Avviso>
        )}
        <P.comp key={P.id} vai={vai} />
      </main>
      <nav className="basso" aria-label="Sezioni principali">
        {PAGINE.filter((p) => p.principale).map((p) => (
          <a key={p.id} href={"#" + p.id} className={p.id === pagina ? "attiva" : ""} aria-current={p.id === pagina ? "page" : undefined}>
            <Icona id={p.id} /><span>{p.breve}</span>
          </a>
        ))}
        <button type="button" className={altroAttivo || menu ? "attiva" : ""} onClick={() => setMenu(!menu)} aria-expanded={menu}>
          <Icona id="altro" /><span>Altro</span>
        </button>
      </nav>
      {menu && (
        <div className="menu-altro" onClick={() => setMenu(false)}>
          <div className="foglio" onClick={(e) => e.stopPropagation()}>
            {PAGINE.filter((p) => !p.principale).map((p) => (
              <a key={p.id} href={"#" + p.id} className={p.id === pagina ? "attiva" : ""}><Icona id={p.id} />{p.nome}</a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const radice = createRoot(document.getElementById("app")!);
radice.render(<StrictMode><App /></StrictMode>);
(async () => {
  try {
    await carica();
  } catch (e) {
    console.error(e);
    stato.pronto = true;
    stato.note = ["Non riesco a leggere i dati salvati su questo dispositivo: " + String(e)];
    invalidaCalcoli();
  }
  cloud.avvia().catch((e) => console.error(e));
  registraServiceWorker();
})();
window.addEventListener("pagehide", () => { salvaSubito(); });
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") salvaSubito(); });
