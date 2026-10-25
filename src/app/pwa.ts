/** Installazione come app (PWA) e funzionamento senza rete (service worker). */
let evento: any = null;
window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); evento = e; });
export const installabile = () => !!evento;
export async function installa() { if (!evento) return; evento.prompt(); await evento.userChoice; evento = null; }

export function registraServiceWorker() {
  if (!("serviceWorker" in navigator) || location.protocol === "file:" || (window as any).Capacitor?.isNativePlatform?.()) return;
  if (location.hostname === "localhost" && location.port && !location.search.includes("sw=1")) return; // in sviluppo no
  navigator.serviceWorker.register("./sw.js").catch(() => { /* senza service worker l'app funziona lo stesso, solo non offline */ });
}
