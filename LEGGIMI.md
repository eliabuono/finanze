# Finanze

Un'unica app per Android, iPhone e PC: legge gli estratti conto in PDF (Intesa Sanpaolo, Trade Republic, Satispay) e mostra patrimonio, saldi, investimenti, entrate e uscite per categoria. È la stessa app della versione Python, rifatta per girare nel browser:

- **i PDF vengono letti sul dispositivo**, non vengono mandati a nessun server;
- i dati restano nel dispositivo e, se colleghi **Google Drive**, telefono e PC usano gli stessi dati (cartella `Finanze` del tuo Drive, stessi file della versione Python: `movimenti.txt`, `saldi_noti.txt`, `importati.txt`, `config.json`, `prezzi_cache.csv`);
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

## 2. Il servizio (Cloudflare Worker, una volta sola, ~5 minuti)

Un piccolo servizio gratuito che fa due cose: custodisce la chiave segreta per l'accesso a Google Drive (che non può stare nell'app, perché il codice è pubblico) e passa all'app i prezzi degli ETF da Yahoo Finance e justETF. Non vede né conserva i tuoi dati.

1. Crea un account su <https://dash.cloudflare.com> (gratis, senza carta).
2. **Workers & Pages → Create → Worker** (parti da «Hello World»), nome `finanze`, **Deploy**.
3. **Edit code**: cancella tutto, incolla il contenuto di `worker/servizio.js`, **Deploy**.
4. Copia l'indirizzo del worker, tipo `https://finanze.TUONOME.workers.dev`.
5. In **Settings → Variables and Secrets** aggiungi `ORIGINI_AMMESSE` = `https://TUONOME.github.io` (le altre due variabili arrivano al passo 3).

## 3. Google Drive (una volta sola, ~15 minuti)

Telefono e PC usano gli stessi dati, salvati nella cartella «Finanze» del tuo Google Drive. L'app vede solo i file che crea lei, non il resto del Drive. Ci si collega una volta e poi l'accesso si rinnova da solo.

1. Vai su <https://console.cloud.google.com> con il tuo account Google e crea un progetto `Finanze`.
2. **API e servizi → Libreria**: cerca **Google Drive API** e premi **Abilita**.
3. **Google Auth Platform** (o «Schermata consenso OAuth») → **Inizia**: nome app `Finanze`, la tua email come assistenza e contatto, pubblico **Esterno**.
4. **Accesso ai dati → Aggiungi o rimuovi ambiti**: cerca `drive.file`, spunta `.../auth/drive.file`, **Aggiorna**, **Salva**.
5. **Pubblico → Pubblica app → Conferma** (stato «In produzione»). Se resta «In test» l'accesso scade ogni 7 giorni e funziona solo per gli utenti di prova.
6. **Client → Crea client**: tipo **Applicazione web**, nome `Finanze`.
   - Origini JavaScript autorizzate: `https://TUONOME.github.io`
   - URI di reindirizzamento autorizzati: `https://TUONOME.github.io/finanze/` (con la barra finale)
   - **Crea**, poi copia **ID client** e **Client secret** (la chiave segreta si vede una volta sola: scaricala o copiala subito).
7. Torna nel worker di Cloudflare, **Settings → Variables and Secrets**, e aggiungi `GOOGLE_CLIENT_ID` (tipo testo) e `GOOGLE_CLIENT_SECRET` (tipo **Secret**). **Deploy**.
8. Su GitHub apri `src/app/ambiente.ts` (matita) e scrivi l'ID client e l'indirizzo del worker:
   `GOOGLE_CLIENT_ID = "1234…apps.googleusercontent.com"` e `SERVIZIO = "https://finanze.TUONOME.workers.dev"`. **Commit changes**.

Dopo 2–3 minuti (quando «Pubblica» in Actions è verde) nell'app: **Impostazioni → Collega Google Drive**. Il segreto non va mai in `ambiente.ts` né altrove su GitHub: sta solo nel worker.

Se Google mostrasse «App non verificata», tocca **Avanzate → Vai a Finanze**: è la tua app. Con il solo permesso `drive.file` di solito l'avviso non compare.

### Prezzi degli ETF

Con il servizio configurato i prezzi si aggiornano da soli (Yahoo Finance, oppure justETF se Yahoo non trova lo strumento). Senza, il valore degli ETF usa il prezzo dell'ultimo acquisto, oppure il prezzo manuale in Impostazioni → Strumenti.

## 4. Installare l'app

- **iPhone**: apri il link in Safari → Condividi → **Aggiungi alla schermata Home**.
- **Android**: apri il link in Chrome → menu ⋮ → **Installa app**.
- **PC (Windows/Mac)**: apri il link in Chrome o Edge → icona di installazione nella barra degli indirizzi.

Per i tuoi amici basta mandare il link. Ognuno importa i propri PDF e, se vuole, collega il proprio Google Drive.

## 5. Portare i dati dalla versione Python

Nell'app: **Impostazioni → Dati e backup → Carica dati o backup**, e seleziona insieme i file della cartella `finanze/dati` del PC: `movimenti.txt`, `saldi_noti.txt`, `importati.txt`, `config.json`, `prezzi_cache.csv`. Tornano tutte le categorie, gli esercenti imparati e i movimenti bloccati 🔒. Poi collega Google Drive dal PC: i dati salgono sul Drive e il telefono li scarica appena lo colleghi.
## 6. App per gli store (facoltativo)

Non serve per usare l'app né per condividerla: il link e «Aggiungi alla schermata Home» bastano. Se un giorno vuoi pubblicarla:

- **Google Play / file APK** (servono Android Studio e un account sviluppatore Google, 25 $ una tantum):
  1. Installa [Node.js](https://nodejs.org) e [Android Studio](https://developer.android.com/studio).
  2. In `capacitor.config.json` sostituisci `TUONOME` con il tuo nome GitHub.
  3. In questa cartella: `npm install`, `npx cap add android`, `npm run android`.
  4. In Android Studio: **Build → Generate Signed App Bundle / APK**. L'APK si può anche mandare direttamente agli amici.
- **App Store** (servono un Mac con Xcode e l'Apple Developer Program, 99 $/anno): `npx cap add ios`, `npm run ios`, poi da Xcode **Product → Archive**. Apple può rifiutare le app che sono solo un sito «impacchettato»: per iPhone l'installazione dal link resta la strada più semplice.

L'app impacchettata carica la versione pubblicata su GitHub Pages (quindi si aggiorna da sola). Attenzione: Google non permette l'accesso dall'interno di un'app impacchettata, quindi per gli store il collegamento a Google Drive andrebbe rifatto con il plugin di accesso Google nativo; la versione installata dal link non ha questo problema.

## Per chi modifica il codice

- `src/core/`: lettura dei PDF (`parsers.ts`, `pdftext.ts`), registro dei movimenti, categorie, calcoli (`analisi.ts`), prezzi. Stesse regole della versione Python, verificate sugli stessi PDF: stessi movimenti, saldi, TIR e TWR.
- `src/app/`: interfaccia (React), archivio locale (IndexedDB), Google Drive (`sync.ts`), PWA.
- `worker/servizio.js`: il Cloudflare Worker (accesso Google e prezzi).
- `npm install`, poi `npm run build` (crea `dist/`) o `npm run dev` (prova in locale su http://localhost:8080).
- I formati dei PDF delle banche possono cambiare: il controllo dei saldi in Importa e in Patrimonio serve proprio ad accorgersene.

Non è un software certificato: verifica sempre i numeri importanti con gli estratti conto ufficiali.
