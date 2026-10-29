import * as fs from "node:fs";
import { pagineDaCampione } from "../src/core/anonimizza";
import { Registro } from "../src/core/registro";
import { copia, CONFIG_DEFAULT } from "../src/core/config";
import { categorizza } from "../src/core/categorie";
import { raggruppaConti, nomeConto } from "../src/core/conti";

let errori = 0;
const check = (n: string, ok: boolean, info: any = "") => { if (!ok) { errori++; console.log("KO", n, info); } else console.log("ok", n); };
const cfg = copia(CONFIG_DEFAULT);
const pag = pagineDaCampione(JSON.parse(fs.readFileSync("test/campioni/revolut_multivaluta.json", "utf8")), { cifre: true });

// senza cambi: si importano solo gli euro e il file non risulta importato
const r0 = new Registro();
const e0 = r0.importa(pag, "rev.pdf", 1, cfg, {});
check("senza cambi solo EUR", r0.mov.every((m) => m.conto === "Revolut EUR") && r0.mov.length === 38, r0.mov.length);
check("senza cambi segnalato", JSON.stringify(e0.senzaCambio) === '["USD","XXX"]', e0.senzaCambio);
check("non risulta importato", !r0.giaImportato("rev.pdf", 1));

// con i cambi (unità di valuta per 1 euro)
const cambi = { USD: { "2024-12-30": 1.25, "2025-09-01": 1.1 }, XXX: { "2024-12-31": 11.11 } };
const r = new Registro();
const e = r.importa(pag, "rev.pdf", 1, cfg, cambi);
const per: Record<string, number> = {};
for (const m of r.mov) per[m.conto] = (per[m.conto] ?? 0) + 1;
console.log(per, e.sezioni);
check("tre conti", per["Revolut EUR"] === 38 && per["Revolut USD"] === 1 && per["Revolut XXX"] === 17, per);
const usd = r.mov.find((m) => m.conto === "Revolut USD")!;
check("USD convertito al cambio del giorno", usd.importo === Math.round(111.11 / 1.1 * 100) / 100 && usd.descrizione.endsWith("| 111,11 USD"), usd);
const nok = r.mov.find((m) => m.conto === "Revolut XXX" && m.importo < 0)!;
check("altra valuta convertita", nok.importo === Math.round(-111.11 / 11.11 * 100) / 100, nok.importo);
const saldiRev = r.saldi.filter((s) => s.conto.startsWith("Revolut"));
console.log(saldiRev);
check("un saldo noto per valuta", saldiRev.length === 3 && saldiRev.find((s) => s.conto === "Revolut USD")?.saldo === 101.01, saldiRev);
const cambio = r.mov.filter((m) => m.tipo === "Cambio valuta");
check("cambi valuta = trasferimenti interni", cambio.length >= 4 && cambio.every((m) => categorizza(m, cfg) === "Trasferimento interno"), cambio.map((m) => m.categoria));
check("già importato con i cambi", r.giaImportato("rev.pdf", 1));

// vecchio conto «Revolut» -> «Revolut EUR»
const v = new Registro([{ ...r.mov[0], id: "x", conto: "Revolut" }], [{ data: "2024-12-31", conto: "Revolut", saldo: 0, fonte: "x" }]);
const note = v.ripara(cfg);
check("rinomina Revolut", v.mov[0].conto === "Revolut EUR" && v.saldi[0].conto === "Revolut EUR" && note.some((n) => n.includes("Revolut EUR")), note);

// raggruppamento per ente
const g = raggruppaConti(["Intesa Salvadanaio", "Intesa Sanpaolo", "Revolut USD", "Revolut EUR", "Satispay", "Satispay Salvadanaio", "Trade Republic"]);
console.log(JSON.stringify(g.map((x) => [x.ente, x.conti.map((c) => c.sotto)])));
check("gruppi", JSON.stringify(g.map((x) => [x.ente, x.conti.map((c) => c.sotto)])) ===
  '[["Intesa Sanpaolo",["Conto","Salvadanaio"]],["Revolut",["EUR","USD"]],["Satispay",["Conto","Salvadanaio"]],["Trade Republic",["Conto"]]]');
check("nomi", nomeConto("Intesa Salvadanaio") === "Intesa Sanpaolo · Salvadanaio" && nomeConto("Intesa Sanpaolo") === "Intesa Sanpaolo" && nomeConto("Revolut USD") === "Revolut · USD");
console.log(errori ? `${errori} ERRORI` : "TUTTO OK");
