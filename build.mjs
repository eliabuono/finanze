// Costruisce l'app in dist/ (pagina, script, service worker, manifest, icone).
import * as esbuild from "esbuild";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const dev = process.argv.includes("--dev");
const out = "dist";
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out + "/assets", { recursive: true });

const r = await esbuild.build({
  entryPoints: ["src/app/main.tsx"], bundle: true, splitting: true, format: "esm", outdir: out + "/assets",
  entryNames: "[name]-[hash]", chunkNames: "c-[hash]", assetNames: "[name]-[hash]",
  minify: !dev, sourcemap: dev, jsx: "automatic", target: ["es2020", "safari15", "chrome90"],
  loader: { ".css": "css" }, metafile: true, logLevel: "warning",
  define: { "process.env.NODE_ENV": dev ? '"development"' : '"production"' },
});
fs.copyFileSync("node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs", out + "/pdf.worker.mjs");
for (const f of fs.readdirSync("public")) fs.copyFileSync(path.join("public", f), path.join(out, f));

const usciti = Object.keys(r.metafile.outputs).map((p) => path.relative(out, p).split(path.sep).join("/")).filter((p) => !p.endsWith(".map"));
const js = usciti.find((p) => /assets\/main-.*\.js$/.test(p));
const css = usciti.find((p) => /assets\/main-.*\.css$/.test(p));

const html = `<!doctype html>
<html lang="it">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Finanze</title>
<meta name="description" content="Conti, investimenti, entrate e uscite dai tuoi estratti conto in PDF">
<meta name="theme-color" content="#0f6e62">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="Finanze">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<link rel="manifest" href="manifest.webmanifest">
<link rel="icon" href="favicon-32.png" sizes="32x32">
<link rel="icon" href="icona.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="apple-touch-icon.png">
<link rel="stylesheet" href="${css}">
</head>
<body>
<div id="app"></div>
<noscript>Per usare Finanze serve JavaScript.</noscript>
<script type="module" src="${js}"></script>
</body>
</html>
`;
fs.writeFileSync(out + "/index.html", html);

const manifest = {
  name: "Finanze", short_name: "Finanze", description: "Conti, investimenti, entrate e uscite dai tuoi estratti conto",
  lang: "it", start_url: "./", scope: "./", display: "standalone", background_color: "#edf1f0", theme_color: "#0f6e62",
  icons: [
    { src: "icona-192.png", sizes: "192x192", type: "image/png" },
    { src: "icona-512.png", sizes: "512x512", type: "image/png" },
    { src: "icona-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
  ],
};
fs.writeFileSync(out + "/manifest.webmanifest", JSON.stringify(manifest, null, 2));

const daSalvare = ["./", "index.html", "manifest.webmanifest", "pdf.worker.mjs", ...fs.readdirSync("public"), ...usciti];
const versione = crypto.createHash("sha1").update(daSalvare.join("|") + fs.readFileSync(out + "/" + js)).digest("hex").slice(0, 10);
fs.writeFileSync(out + "/sw.js", fs.readFileSync("src/sw.js", "utf8")
  .replace("__VERSIONE__", versione).replace("__FILE__", JSON.stringify(daSalvare)));
fs.writeFileSync(out + "/.nojekyll", "");
const kb = (p) => (fs.statSync(path.join(out, p)).size / 1024).toFixed(0) + " kB";
console.log("costruito", versione, usciti.map((u) => `${u} ${kb(u)}`).join(", "));
