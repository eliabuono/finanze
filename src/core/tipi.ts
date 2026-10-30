/** Tipi condivisi. Le date sono stringhe ISO "AAAA-MM-GG". */

export interface MovimentoLetto {
  data: string;
  conto: string;
  tipo: string;
  descrizione: string;
  importo: number; // + entrata, - uscita
  categoria: string;
  isin: string;
  quote: number | null;
  saldo: number | null; // saldo dopo il movimento, se l'estratto lo riporta
  fonte: string;
  id?: string; // id univoco della banca (Satispay)
  valuta?: string; // valuta dell'importo se non è in euro (Revolut): all'import si converte in euro
}

export interface Movimento {
  id: string;
  data: string;
  conto: string;
  tipo: string;
  descrizione: string;
  importo: number;
  categoria: string;
  isin: string;
  quote: number | null;
  fonte: string;
  manuale: boolean; // categoria fissata a mano per questo movimento
}

export interface SaldoNoto {
  data: string;
  conto: string;
  saldo: number;
  fonte: string;
}

export interface FileImportato {
  file: string;
  dimensione: number;
  formato: string;
  movimenti_nuovi: number;
  importato_il: string;
  dal: string;
  al: string;
  modificato?: string;
}

export type Formato = "trade_republic" | "satispay" | "intesa_lista" | "intesa_estratto" | "revolut" | "fineco" | "sconosciuto";

export interface Controlli {
  saldo_iniziale_dichiarato?: number | null;
  saldo_finale_dichiarato?: number | null;
  saldo_finale_calcolato?: number | null;
  saldo_iniziale_dedotto?: number | null;
  somma_importi?: number;
  data_inizio?: string | null;
  data_fine?: string | null;
  saldo_salvadanaio?: number | null;
  /** estratti con più conti (Revolut: uno per valuta): saldo di chiusura dichiarato e calcolato, nella valuta del conto */
  sezioni?: { conto: string; valuta: string; saldo_finale_dichiarato: number | null; saldo_finale_calcolato: number | null }[];
}

export interface Strumento {
  nome: string;
  classe: string;
  ticker: string;
  obiettivo: number | null; // 0-1
  prezzo_manuale?: number | null;
}

export interface Config {
  versione: number;
  intestatario: string;
  regole_apprese: Record<string, string>;
  compensa_rimborsi: boolean;
  strumenti: Record<string, Strumento>;
  regole_categorie: [string, string[]][];
  categoria_default_uscite: string;
  categoria_default_entrate: string;
  categorie_escluse: string[];
  simulazione: { tasso_annuo: number; capitale_iniziale: number; versamento_mensile: number; anni: number };
  proxy_prezzi: string; // URL dell'intermediario per Yahoo/justETF (vuoto = accesso diretto, solo app nativa)
  /** categoria -> macro-categoria, per raggruppare i grafici (es. Supermercato -> Cibo) */
  macro_categorie: Record<string, string>;
  /** nome del salvadanaio Satispay (maiuscolo) -> personale o colletta, scelto a mano o riconosciuto */
  salvadanai_satispay: Record<string, "personale" | "colletta">;
}
