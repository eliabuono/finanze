# Finanze

Un'unica app per Android, iPhone e PC: legge gli estratti conto in PDF (Intesa Sanpaolo, Trade Republic, Satispay) e mostra patrimonio, saldi, investimenti, entrate e uscite per categoria. È la stessa app della versione Python, rifatta per girare nel browser:

- **i PDF vengono letti sul dispositivo**, non vengono mandati a nessun server;
- i dati restano nel dispositivo e, se colleghi **OneDrive**, telefono e PC usano gli stessi dati (cartella `App/Finanze` del tuo OneDrive, stessi file della versione Python: `movimenti.txt`, `saldi_noti.txt`, `importati.txt`, `config.json`, `prezzi_cache.csv`);
- funziona anche senza rete, una volta aperta la prima volta.

Si pubblica una volta su internet (gratis, con GitHub Pages) e poi chiunque la apre dal link e la installa come app: tu, i tuoi amici, su qualsiasi telefono o PC. Ognuno vede solo i propri dati.

---

## 1. Pubblicare l'app (una volta sola, ~15 minuti)

1. Crea un account su <https://github.com> (gratis).
2. Crea un repository nuovo chiamato `finanze` (pubblico: GitHub Pages gratuito lo richiede; nel codice non ci sono dati personali).
3. Carica il contenuto di questa cartella nel repository (pulsante **Add file → Upload files**, trascina tutto, **Commit**). In alternativa, con Git: `git init`, `git add .`, `git commit -m "Finanze"`, `git push`.
4. Nel repository: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
5. Vai su **Actions**: parte «Pubblica». Dopo un paio di minuti l'app è su `https://TUONOME.github.io/finanze/`.

Ogni volta che modifichi un file nel repository l'app si ripubblica da sola; i telefoni prendono la versione nuova alla riapertura successiva.

## 2. Collegare OneDrive (una volta sola, ~10 minuti)

Microsoft chiede che ogni app che usa OneDrive sia registrata. È gratis e la registrazione vale per tutti quelli che useranno la tua app.

1. Vai su <https://portal.azure.com> ed entra con il tuo account Microsoft (lo stesso di OneDrive va benissimo).
2. Cerca **Registrazioni app** → **Nuova registrazione**.
   - Nome: `Finanze`
   - Tipi di account supportati: **Account in qualsiasi directory organizzativa e account Microsoft personali**
   - URI di reindirizzamento: piattaforma **Applicazione a pagina singola (SPA)**, indirizzo `https://TUONOME.github.io/finanze/` (con la barra finale)
3. Premi **Registra** e copia l'**ID applicazione (client)**.
4. In **Autorizzazioni API** controlla che ci sia `User.Read`; aggiungi **Microsoft Graph → Autorizzazioni delegate → `Files.ReadWrite.AppFolder`**. Non serve il consenso dell'amministratore.
5. Scrivi l'ID in `src/app/ambiente.ts` (`MICROSOFT_CLIENT_ID = "..."`) e ricarica il file su GitHub. Così l'app è già pronta per tutti. (In alternativa si può incollare l'ID nell'app: Impostazioni → OneDrive → ID applicazione Microsoft.)

Poi nell'app: **Impostazioni → Collega OneDrive**. L'app chiede l'accesso solo alla propria cartella (`App/Finanze`), non al resto del tuo OneDrive.

Nota: per le app che girano nel browser Microsoft rinnova l'accesso circa una volta al giorno. L'app ci prova da sola all'apertura; se serve, compare «Ricollega OneDrive» (un tocco). Nel frattempo i dati restano sul dispositivo e vengono caricati appena ricollegato.

## 3. Prezzi degli ETF (facoltativo, ~5 minuti)

Il browser non può chiedere i prezzi direttamente a Yahoo Finance e justETF. Serve un piccolo intermediario gratuito:

1. Crea un account su <https://dash.cloudflare.com> (gratis).
2. **Workers & Pages → Create → Worker**, nome `prezzi`, **Deploy**, poi **Edit code**: incolla il contenuto di `worker/prezzi.js` e **Deploy**.
3. Copia l'indirizzo del worker (es. `https://prezzi.tuonome.workers.dev`) e scrivilo in `src/app/ambiente.ts` (`PROXY_PREZZI`), oppure nell'app in Impostazioni → Prezzi degli ETF.
4. Facoltativo: nel worker, **Settings → Variables**, aggiungi `ORIGINI_AMMESSE` = `https://TUONOME.github.io` così risponde solo alla tua app.

Senza intermediario l'app funziona lo stesso: il valore degli ETF usa il prezzo dell'ultimo acquisto, oppure il prezzo manuale che puoi scrivere in Impostazioni → Strumenti.

## 4. Installare l'app

- **iPhone**: apri il link in Safari → Condividi → **Aggiungi alla schermata Home**.
- **Android**: apri il link in Chrome → menu ⋮ → **Installa app**.
- **PC (Windows/Mac)**: apri il link in Chrome o Edge → icona di installazione nella barra degli indirizzi.

Per i tuoi amici basta mandare il link. Ognuno importa i propri PDF e, se vuole, collega il proprio OneDrive.

## 5. Portare i dati dalla versione Python

Nell'app: **Impostazioni → Dati e backup → Carica dati o backup**, e seleziona insieme i file della cartella `finanze/dati` del PC: `movimenti.txt`, `saldi_noti.txt`, `importati.txt`, `config.json`, `prezzi_cache.csv`. Tornano tutte le categorie, gli esercenti imparati e i movimenti bloccati 🔒. Poi collega OneDrive dal PC: i dati salgono su OneDrive e il telefono li scarica appena lo colleghi.
## 6. App per gli store (facoltativo)

Non serve per usare l'app né per condividerla: il link e «Aggiungi alla schermata Home» bastano. Se un giorno vuoi pubblicarla:

- **Google Play / file APK** (servono Android Studio e un account sviluppatore Google, 25 $ una tantum):
  1. Installa [Node.js](https://nodejs.org) e [Android Studio](https://developer.android.com/studio).
  2. In `capacitor.config.json` sostituisci `TUONOME` con il tuo nome GitHub.
  3. In questa cartella: `npm install`, `npx cap add android`, `npm run android`.
  4. In Android Studio: **Build → Generate Signed App Bundle / APK**. L'APK si può anche mandare direttamente agli amici.
- **App Store** (servono un Mac con Xcode e l'Apple Developer Program, 99 $/anno): `npx cap add ios`, `npm run ios`, poi da Xcode **Product → Archive**. Apple può rifiutare le app che sono solo un sito «impacchettato»: per iPhone l'installazione dal link resta la strada più semplice.

L'app impacchettata carica la versione pubblicata su GitHub Pages (quindi si aggiorna da sola) e chiede i prezzi direttamente dal telefono, senza intermediario.

## Per chi modifica il codice

- `src/core/`: lettura dei PDF (`parsers.ts`, `pdftext.ts`), registro dei movimenti, categorie, calcoli (`analisi.ts`), prezzi. Stesse regole della versione Python, verificate sugli stessi PDF: stessi movimenti, saldi, TIR e TWR.
- `src/app/`: interfaccia (React), archivio locale (IndexedDB), OneDrive, PWA.
- `npm install`, poi `npm run build` (crea `dist/`) o `npm run dev` (prova in locale su http://localhost:8080).
- I formati dei PDF delle banche possono cambiare: il controllo dei saldi in Importa e in Patrimonio serve proprio ad accorgersene.

Non è un software certificato: verifica sempre i numeri importanti con gli estratti conto ufficiali.
