/**
 * Impostazioni di pubblicazione dell'app (valgono per tutti quelli che la usano).
 *
 * GOOGLE_CLIENT_ID: "ID client" OAuth creato su console.cloud.google.com (vedi LEGGIMI, sezione Google Drive).
 * SERVIZIO: indirizzo del Cloudflare Worker (worker/servizio.js), che serve sia per l'accesso a Google Drive
 *   sia per i prezzi degli ETF. Es. "https://finanze.tuonome.workers.dev"
 */
export const GOOGLE_CLIENT_ID = "362451763280-vou14jpr0vp0rq5r3fuec8mrnr7el2k9.apps.googleusercontent.com";
export const SERVIZIO = "https://finanze.elia-buono.workers.dev";
export const VERSIONE_APP = "1.6.0";
