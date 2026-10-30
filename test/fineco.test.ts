import * as fs from "node:fs";
import { pagineDaCampione } from "../src/core/anonimizza";
import { leggiFineco, riconosci } from "../src/core/parsers";
import { Registro } from "../src/core/registro";
import { copia, CONFIG_DEFAULT, normalizza } from "../src/core/config";
import { investimenti, serieDaPrezzi } from "../src/core/analisi";

let errori = 0;
const check = (n: string, ok: boolean, info: any = "") => { if (!ok) { errori++; console.log("KO", n, info); } else console.log("ok", n); };
const c = JSON.parse(fs.readFileSync("test/campioni/fineco.json", "utf8"));
// nel campione il nome della banca nel piè di pagina è anonimizzato: lo si rimette per provare il riconoscimento
for (const pg of c.pagine) for (const k of ["p", "p3"]) for (const w of pg[k]) if (w[0] === "XxxxxxXxxx") w[0] = "FinecoBank";
const pag = pagineDaCampione(c, { cifre: true });
check("riconosciuto", riconosci(pag) === "fineco", riconosci(pag));
const r = leggiFineco(pag, "fineco.pdf");
check("25 movimenti", r.movimenti.length === 25, r.movimenti.length);
const titoli = r.movimenti.filter((m) => m.tipo === "Acquisto titoli" || m.tipo === "Vendita titoli");
check("22 compravendite di titoli", titoli.length === 22, titoli.length);
check("tutte con ISIN dal dossier", titoli.every((m) => m.isin && m.quote !== null), titoli.filter((m) => !m.isin).map((m) => m.descrizione));
check("una vendita con quote negative", titoli.filter((m) => m.importo > 0).length === 1 && titoli.filter((m) => m.importo > 0).every((m) => (m.quote as number) < 0));
check("3 entrate non titoli", r.movimenti.filter((m) => !m.isin && m.importo > 0).length === 3);
check("seconda riga della descrizione", r.movimenti[0].descrizione.includes(" | "), r.movimenti[0].descrizione);
check("saldi dal riepilogo", r.controlli.saldo_iniziale_dichiarato === 1.11 && r.controlli.saldo_finale_dichiarato === 11.11, r.controlli);

// import completo: conto Fineco, saldo noto, strumenti nuovi, investimenti
const cfg = copia(CONFIG_DEFAULT);
const reg = new Registro();
const e = reg.importa(pag, "fineco.pdf", 1, cfg);
check("import", e.formato === "fineco" && e.aggiunti === 25 && reg.mov.every((m) => m.conto === "Fineco"), e);
check("saldo noto Fineco", reg.saldi.some((s) => s.conto === "Fineco" && s.saldo === 11.11));
check("strumenti aggiunti", Object.keys(cfg.strumenti).length >= 5, Object.entries(cfg.strumenti).map(([i, s]) => i + " " + s.nome));
check("categoria Investimenti", reg.mov.filter((m) => m.isin).every((m) => m.categoria === "Investimenti"));
const inv = investimenti(reg.mov, cfg.strumenti, (_i, g, impl, man) => serieDaPrezzi(undefined, g, impl, man), "2012-01-01");
check("pagina Investimenti", !!inv && inv.righe.length >= 5, inv?.righe.length);
// migrazione delle regole
const { cfg: vecchia } = normalizza({ ...copia(CONFIG_DEFAULT), versione: 5, regole_categorie: [["Investimenti", ["BUY TRADE"]]] });
check("regole migrate", vecchia.regole_categorie.find((x) => x[0] === "Investimenti")![1].includes("ACQUISTO TITOLI"));
console.log(errori ? `${errori} ERRORI` : "TUTTO OK");
