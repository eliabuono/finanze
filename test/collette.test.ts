import { copia, CONFIG_DEFAULT } from "../src/core/config";
import { Registro } from "../src/core/registro";
import { gruppiSalvadanaio, CAT_COLLETTE } from "../src/core/collette";
import { perCategoria, saldi } from "../src/core/analisi";
import type { Movimento } from "../src/core/tipi";

let errori = 0;
const check = (n: string, ok: boolean, info: any = "") => { if (!ok) { errori++; console.log("KO", n, info); } else console.log("ok", n); };

const cfg = copia(CONFIG_DEFAULT);
let k = 0;
const mv = (data: string, descrizione: string, importo: number, tipo = importo < 0 ? "Deposito Risparmi" : "Prelievo Risparmi", conto = "Satispay"): Movimento =>
  ({ id: "id" + k++, data, conto, tipo, descrizione, importo, categoria: "Trasferimento interno", isin: "", quote: null, fonte: "x.pdf", manuale: false });
const sat: Movimento[] = [
  mv("2025-09-01", "Ricarica", 300, "Dalla Banca"),
  mv("2025-09-02", "Salvadanaio di Anna", -0.5), mv("2025-09-03", "Salvadanaio di Anna", -0.7), mv("2025-12-01", "Salvadanaio di Anna", 1.0),
  // colletta con un nome suo: versa 20, preleva 100 (gli altri hanno messo 80)
  mv("2025-10-05", "Regalo Marco", -20), mv("2025-11-10", "Regalo Marco", 100),
  // colletta che sembra un salvadanaio personale: la scopre il saldo in rosso
  mv("2025-10-06", "Salvadanaio di Luca", -10), mv("2025-10-20", "Salvadanaio di Luca", 60),
  // colletta a cui hai solo partecipato
  mv("2025-10-07", "Cena Laurea", -15),
  mv("2025-11-11", "Negozio regali", -100, "a un Negozio"),
];
// come le versioni precedenti: ogni movimento «Risparmi» aveva la sua copia nel conto Satispay Salvadanaio
const vecchie = sat.filter((m) => m.tipo.includes("Risparmi")).map((m) => ({ ...m, id: m.id + "s", conto: "Satispay Salvadanaio", tipo: "Salvadanaio", importo: -m.importo }));
const reg = new Registro([...sat, ...vecchie]);
const note = reg.ripara(cfg);
console.log(note);

const g = gruppiSalvadanaio(reg.mov, cfg);
console.log(g.map((x) => [x.etichetta, x.tipo, x.versato, x.prelevato]));
check("Anna personale", g.find((x) => x.nome === "SALVADANAIO DI ANNA")?.tipo === "personale");
check("Regalo Marco colletta", g.find((x) => x.nome === "REGALO MARCO")?.tipo === "colletta");
check("Luca rilevata", cfg.salvadanai_satispay["SALVADANAIO DI LUCA"] === "colletta");
const spec = reg.mov.filter((m) => m.conto === "Satispay Salvadanaio");
check("nel salvadanaio solo Anna", spec.length === 3 && spec.every((m) => m.descrizione === "Salvadanaio di Anna"), spec.map((m) => m.descrizione));
const s = saldi(reg.mov, [], "2025-12-31");
const ultimo = (c: string) => (s as any).ultimo[c] ?? null;
console.log("saldi", s.conti, s.conti.map(ultimo));
check("saldo salvadanaio 0,20", Math.abs((ultimo("Satispay Salvadanaio") ?? NaN) - 0.2) < 1e-9, ultimo("Satispay Salvadanaio"));
check("categorie collette", reg.mov.filter((m) => m.conto === "Satispay" && ["Regalo Marco", "Salvadanaio di Luca", "Cena Laurea"].includes(m.descrizione)).every((m) => m.categoria === CAT_COLLETTE));

const pc = perCategoria(reg.mov, cfg.categorie_escluse, "M", false);
const tot = (t: Record<string, number[]>, c: string) => (t[c] ?? []).reduce((a, b) => a + b, 0);
console.log(pc.periodi, pc.entrate, pc.uscite);
check("entrate collette 80+50", Math.abs(tot(pc.entrate, CAT_COLLETTE) - 130) < 1e-9, tot(pc.entrate, CAT_COLLETTE));
check("uscite collette 15", Math.abs(tot(pc.uscite, CAT_COLLETTE) - 15) < 1e-9, tot(pc.uscite, CAT_COLLETTE));
const pcc = perCategoria(reg.mov, cfg.categorie_escluse, "M", true);
check("compensate: ottobre +50-15, novembre +80", pcc.entrate[CAT_COLLETTE]?.join() === "35,80", pcc.entrate);
check("entrata Marco a novembre", pc.entrate[CAT_COLLETTE]?.[pc.periodi.indexOf("2025-11-01")] === 80);

// scelta a mano: Cena Laurea come personale -> torna nel salvadanaio
cfg.salvadanai_satispay["CENA LAUREA"] = "personale";
reg.allineaSalvadanai(cfg);
check("scelta a mano", reg.mov.filter((m) => m.conto === "Satispay Salvadanaio" && m.descrizione === "Cena Laurea").length === 1
  && reg.mov.find((m) => m.conto === "Satispay" && m.descrizione === "Cena Laurea")?.categoria === "Trasferimento interno");
// e di nuovo colletta
cfg.salvadanai_satispay["CENA LAUREA"] = "colletta";
reg.allineaSalvadanai(cfg);
check("di nuovo colletta", !reg.mov.some((m) => m.conto === "Satispay Salvadanaio" && m.descrizione === "Cena Laurea"));
// idempotente
const n = reg.mov.length; const a = reg.allineaSalvadanai(cfg);
check("idempotente", reg.mov.length === n && !a.tolti && !a.aggiunti && !a.ricategorizzati && !a.rilevate.length, a);
console.log(errori ? `${errori} ERRORI` : "TUTTO OK");
