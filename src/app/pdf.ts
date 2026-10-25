/** Lettura dei PDF nel browser: pdf.js viene caricato solo quando serve. */
import { leggiPdf, type Pagina } from "../core/pdftext";

let pdfjsP: Promise<any> | null = null;
function pdfjs() {
  pdfjsP ??= import("pdfjs-dist/legacy/build/pdf.mjs").then((m: any) => {
    m.GlobalWorkerOptions.workerSrc = new URL("./pdf.worker.mjs", document.baseURI).href;
    return m;
  });
  return pdfjsP;
}

export async function paginePdf(file: File | Blob): Promise<Pagina[]> {
  const dati = new Uint8Array(await file.arrayBuffer());
  return leggiPdf(await pdfjs(), dati);
}
