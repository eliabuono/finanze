/** Riservatezza sul dispositivo: importi nascosti e codice di accesso (valgono solo su questo dispositivo). */
import { invalidaCalcoli } from "./stato";

const leggi = (k: string) => { try { return localStorage.getItem("finanze:" + k); } catch { return null; } };
const scrivi = (k: string, v: string | null) => {
  try { if (v === null) localStorage.removeItem("finanze:" + k); else localStorage.setItem("finanze:" + k, v); } catch { /* facoltativo */ }
};

// ------------------------------------------------------------------ importi nascosti
let nascosti = leggi("nascondi_importi") === "1";
export const importiNascosti = () => nascosti;
export function impostaImportiNascosti(v: boolean) {
  nascosti = v;
  scrivi("nascondi_importi", v ? "1" : null);
  invalidaCalcoli(); // ridisegna tutto
}

// ------------------------------------------------------------------ codice di accesso
/** Il codice non è salvato: si salva solo la sua impronta (SHA-256 con un valore casuale). */
interface Codice { sale: string; impronta: string; bloccaDopoMin: number; }
const codiceSalvato = (): Codice | null => { try { return JSON.parse(leggi("codice") || "null"); } catch { return null; } };
export const codiceAttivo = () => !!codiceSalvato();
export const minutiBlocco = () => codiceSalvato()?.bloccaDopoMin ?? 1;

async function impronta(codice: string, sale: string): Promise<string> {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(sale + ":" + codice));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

export async function impostaCodice(codice: string, bloccaDopoMin = 1) {
  const sale = [...crypto.getRandomValues(new Uint8Array(16))].map((x) => x.toString(16).padStart(2, "0")).join("");
  scrivi("codice", JSON.stringify({ sale, impronta: await impronta(codice, sale), bloccaDopoMin }));
}
export function togliCodice() { scrivi("codice", null); }
export function impostaMinutiBlocco(min: number) {
  const c = codiceSalvato();
  if (c) scrivi("codice", JSON.stringify({ ...c, bloccaDopoMin: min }));
}
export async function verificaCodice(codice: string): Promise<boolean> {
  const c = codiceSalvato();
  if (!c) return true;
  return (await impronta(codice, c.sale)) === c.impronta;
}
