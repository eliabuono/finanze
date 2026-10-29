import * as fs from "node:fs";
import * as path from "node:path";
// @ts-ignore
import * as pdfjs from "/opt/npm-tools/node_modules/pdfjs-dist/legacy/build/pdf.mjs";
import { leggiPdf } from "../src/core/pdftext";
import { leggi, leggiTradeRepublic, leggiSatispay, leggiIntesaEstratto, leggiIntesaLista, leggiRevolut } from "../src/core/parsers";
import { creaCampione, pagineDaCampione } from "../src/core/anonimizza";
const R = "/mnt/user-data/uploads/finanze";
const files = ["Intesa San Paolo/31-12-2024_Estratto conto.pdf", "Intesa San Paolo/31-03-2026_Estratto conto trimestrale.pdf",
  "Intesa San Paolo/lista_completa_21102026.pdf", "Satispay/Esporta_report_2023_09_01_2024_09_30.pdf", "Trade Republic/statement.pdf",
  "/mnt/user-data/attachments/6894ff28-618d-5173-9fef-38bf82a9fb19/f7a85272-account-statement_2024-01-01_2024-12-31_it-it_a9e337.pdf"];
(async () => {
  const rev = await leggiPdf(pdfjs as any, new Uint8Array(fs.readFileSync("/mnt/user-data/attachments/6894ff28-618d-5173-9fef-38bf82a9fb19/f7a85272-account-statement_2024-01-01_2024-12-31_it-it_a9e337.pdf")));
  const cr = creaCampione(rev);
  console.log("REVOLUT p1:", cr.pagine[0].p.map((w) => w[0]).join(" ").slice(0, 1500));
  for (const f of files) {
    const pag = await leggiPdf(pdfjs as any, new Uint8Array(fs.readFileSync(f.startsWith("/") ? f : path.join(R, f))));
    const tutte = pag.slice(0, 15);
    const orig = leggi(tutte, f);
    const c = creaCampione(pag);
    const pa = pagineDaCampione(JSON.parse(JSON.stringify(c)), { cifre: true });
    const L: any = { trade_republic: leggiTradeRepublic, satispay: leggiSatispay, intesa_estratto: leggiIntesaEstratto, intesa_lista: leggiIntesaLista, revolut: leggiRevolut };
    let out: any; try { out = { formato: orig.formato, ...L[orig.formato](pa, f) }; } catch (e: any) { console.log("KO", f, e.message); continue; }
    console.log(`${orig.movimenti.length === out.movimenti.length ? "OK" : "KO"} ${f}: ${out.formato} mov ${orig.movimenti.length} -> ${out.movimenti.length}`);
    console.log("    ", out.movimenti[0]?.data, out.movimenti[0]?.importo, "|", out.movimenti[0]?.descrizione.slice(0, 100));
  }
})();
