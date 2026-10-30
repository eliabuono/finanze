import * as fs from "node:fs";
import { pagineDaCampione } from "../src/core/anonimizza";
import { riconosci } from "../src/core/parsers";
import { Registro } from "../src/core/registro";
import { copia, CONFIG_DEFAULT } from "../src/core/config";
import { nomeConto } from "../src/core/conti";

let errori = 0;
const check = (n: string, ok: boolean, info: any = "") => { if (!ok) { errori++; console.log("KO", n, info); } else console.log("ok", n); };
const pag = pagineDaCampione(JSON.parse(fs.readFileSync("test/campioni/unicredit.json", "utf8")), { cifre: true });
check("riconosciuto", riconosci(pag) === "unicredit", riconosci(pag));
const cfg = copia(CONFIG_DEFAULT);
const reg = new Registro();
const e = reg.importa(pag, "uc.pdf", 1, cfg);
// nel campione ci sono 54 righe con data operazione e data valuta (più le righe di saldo iniziale e finale)
check("54 movimenti", e.letti === 54 && reg.mov.length === 54, e.letti);
check("conto UniCredit", reg.mov.every((m) => m.conto === "UniCredit") && nomeConto("UniCredit") === "UniCredit");
check("uscite e entrate", reg.mov.filter((m) => m.importo < 0).length === 33 && reg.mov.filter((m) => m.importo > 0).length === 21,
  [reg.mov.filter((m) => m.importo < 0).length, reg.mov.filter((m) => m.importo > 0).length]);
// la descrizione prende anche le righe sopra la data (la data sta a metà del blocco)
const prima = reg.mov.find((m) => m.descrizione.startsWith("XXXXXXXXX XXX XXXXXXXX XXXXX DI CREDITO"));
check("righe sopra e sotto la data", !!prima && prima.descrizione.includes("| ESTRATTO"), prima?.descrizione);
check("nessuna riga del piè di pagina", !reg.mov.some((m) => /xxx\.xxxxxxxxx\.xx/.test(m.descrizione)));
check("saldo noto", reg.saldi.some((s) => s.conto === "UniCredit" && s.saldo === 11111.11));
check("niente movimenti dalle tabelle dopo il saldo finale", !reg.mov.some((m) => /TOTALE|RIEPILOGO/.test(m.descrizione)));
console.log(errori ? `${errori} ERRORI` : "TUTTO OK");
