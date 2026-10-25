/** Configurazione (stesso formato di dati/config.json della versione per PC in Python). */
import type { Config } from "./tipi";

export const VERSIONE = 3;

export const CONFIG_DEFAULT: Config = {
  versione: VERSIONE,
  intestatario: "",
  regole_apprese: {},
  compensa_rimborsi: true,
  strumenti: {},
  regole_categorie: [
    ["Trasferimento interno", ["RICARICA SATISPAY", "SATISPAY EUROPE", "XME SALVADANAIO", "SALVADANAIO",
      "RIUNIONE SOMME", "GIROCONTO", "VERSO LA BANCA", "DALLA BANCA", "LIBRETTO"]],
    ["Investimenti", ["BUY TRADE", "SELL TRADE", "SAVINGS PLAN EXECUTION"]],
    ["Stipendio", ["STIPENDIO", "EMOLUMENTI", "SALARY", "PAYROLL"]],
    ["Affitto", ["AFFITTO", "CANONE LOCAZIONE", "LOCAZIONE"]],
    ["Interessi e premi", ["INTEREST PAYMENT", "YOUR INTEREST", "SAVEBACK", "CASH REWARD", "INTERESSI", "CASHBACK"]],
    ["Tasse e imposte", ["STAMP DUTY", "TAX OPTIMISATION", "IMPOSTA DI BOLLO", "F24", "PAGOPA"]],
    ["Supermercato", ["CONAD", "MD SPA", "PENNY", "LIDL", "CARREFOUR", "ESSELUNGA", "COOP", "EUROSPIN",
      "PAM ", "IPER", "SUPERMERC", "NOVA COOP", "ALDI", "BENNET", "TIGOTA"]],
    ["Bar e ristoranti", ["BAR ", " BAR", "RISTORANTE", "PIZZ", "CAFFE", "CAFFÈ", "PASTICCERIA", "GLOVO",
      "JUST EAT", "DELIVEROO", "TRATTORIA", "OSTERIA", "KEBAB", "SUSHI", "BIRR", "PUB",
      "GASTRONOMIA", "CAMST", "GELATERIA", "MCDONALD", "BURGER"]],
    ["Trasporti", ["GTT", "TRENITALIA", "ITALO", "RYANAIR", "EASYJET", "TAP & GO", "TELEPASS", "Q8", "ENI ",
      "TAMOIL", "ESSO", "AUTOSTRAD", "UBER", "FREE NOW", "BOLT", "LIME", "TO BIKE", "FLIXBUS", "WIZZ"]],
    ["Casa e utenze", ["IREN", "FASTWEB", "ENEL", "HERA", "A2A", "BRICOMAN", "LEROY MERLIN", "IKEA",
      "FULL HOME", "OBI ", "BRICO"]],
    ["Telefono e abbonamenti", ["ILIAD", "VODAFONE", "TIM ", "WINDTRE", "SPOTIFY", "NETFLIX", "DISNEY",
      "APPLE.COM", "GOOGLE", "AMAZON PRIME", "CANONE MENSILE"]],
    ["Acquisti online", ["AMAZON", "AMZN", "TEMU", "EBAY", "ZALANDO", "ALIEXPRESS", "SHEIN"]],
    ["Salute", ["FARMACIA", "PARAFARMACIA", "MEDIC", "OSPEDALE", "DENTIST", "OTTICA"]],
    ["Sport e tempo libero", ["DECATHLON", "PALESTRA", "CINEMA", "TEATRO", "MUSEO", "TICKET", "SKI"]],
    ["Abbigliamento", ["HUMANA", "ZARA", "H&M", "OVS", "UNIQLO", "PRIMARK", "VINTED"]],
    ["Contanti", ["PRELIEVO", "VERSAMENTO CONTANTI"]],
    ["Amici e persone", ["A UNA PERSONA", "DA UNA PERSONA"]],
    ["Commissioni banca", ["COMMISSIONI", "CANONE", "TRADE REPUBLIC CARD", "SPESE"]],
  ],
  categoria_default_uscite: "Altre uscite",
  categoria_default_entrate: "Altre entrate",
  categorie_escluse: ["Trasferimento interno", "Investimenti"],
  simulazione: { tasso_annuo: 0.07, capitale_iniziale: 10000, versamento_mensile: 500, anni: 10 },
  proxy_prezzi: "",
};

const PAROLE_NUOVE: Record<number, Record<string, string[]>> = {
  2: { "Trasferimento interno": ["SALVADANAIO", "RIUNIONE SOMME", "VERSO LA BANCA", "DALLA BANCA"],
       "Amici e persone": ["A UNA PERSONA", "DA UNA PERSONA"] },
  3: { "Trasferimento interno": ["SATISPAY EUROPE", "LIBRETTO"] },
};

export const copia = <T>(x: T): T => JSON.parse(JSON.stringify(x));

/** Completa una configurazione letta da file (anche della versione Python) con le chiavi mancanti. */
export function normalizza(letta: any): { cfg: Config; cambiata: boolean } {
  if (!letta || typeof letta !== "object") return { cfg: copia(CONFIG_DEFAULT), cambiata: true };
  const cfg: any = { versione: 1, ...letta };
  let cambiata = false;
  for (const [k, v] of Object.entries(CONFIG_DEFAULT)) {
    if (!(k in cfg)) { cfg[k] = copia(v); cambiata = true; }
  }
  if (migra(cfg)) cambiata = true;
  return { cfg, cambiata };
}

function migra(cfg: Config): boolean {
  const v = cfg.versione ?? 1;
  if (v >= VERSIONE) return false;
  const regole = cfg.regole_categorie;
  for (let ver = v + 1; ver <= VERSIONE; ver++) {
    for (const [cat, parole] of Object.entries(PAROLE_NUOVE[ver] ?? {})) {
      const r = regole.find((x) => x[0] === cat);
      if (!r) {
        const pos = cat !== "Trasferimento interno" ? 1 : 0;
        regole.splice(cat === "Amici e persone" ? regole.length - 1 : pos, 0, [cat, [...parole]]);
      } else r[1].push(...parole.filter((p) => !r[1].includes(p)));
    }
  }
  cfg.versione = VERSIONE;
  return true;
}

/** Tutte le categorie conosciute (regole + default). */
export function categorieNote(cfg: Config, extra: Iterable<string> = []): string[] {
  const s = new Set<string>([...cfg.regole_categorie.map((r) => r[0]), cfg.categoria_default_uscite,
    cfg.categoria_default_entrate, ...extra]);
  s.delete("");
  return [...s].sort((a, b) => a.localeCompare(b, "it"));
}

export function aggiungiCategoria(cfg: Config, nome: string): boolean {
  nome = nome.trim();
  if (!nome || cfg.regole_categorie.some((r) => r[0] === nome)) return false;
  cfg.regole_categorie.splice(Math.max(cfg.regole_categorie.length - 1, 0), 0, [nome, []]);
  return true;
}
