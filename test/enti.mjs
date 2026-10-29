import { chromium } from "playwright";
import http from "node:http"; import fs from "node:fs"; import path from "node:path";
const DIST = path.resolve("dist");
const tipi = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml", ".json": "application/json" };
const srv = http.createServer((q, r) => { let p = decodeURIComponent(new URL(q.url, "http://x").pathname); if (p.endsWith("/")) p += "index.html";
  const f = path.join(DIST, p); if (!fs.existsSync(f)) { r.writeHead(404); r.end(); return; } r.writeHead(200, { "Content-Type": tipi[path.extname(f)] || "application/octet-stream" }); fs.createReadStream(f).pipe(r); }).listen(5182);
const U = "http://localhost:5182/";
const browser = await chromium.launch(); const errori = [];
for (const [nome, vp] of [["pc", { viewport: { width: 1280, height: 900 } }], ["tel", { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }]]) {
  const ctx = await browser.newContext(vp);
  await ctx.route("https://finanze.elia-buono.workers.dev/**", (r) => r.fulfill({ status: 503, headers: { "Access-Control-Allow-Origin": "*" }, body: "{}" }));
  const page = await ctx.newPage(); page.on("pageerror", (e) => errori.push(e.message)); page.on("dialog", (d) => d.accept());
  await page.goto(U + "#impostazioni"); await page.waitForSelector("h1");
  await page.setInputFiles('input[accept*=".zip"]', fs.readdirSync("ref/dati").map((f) => path.join("ref/dati", f)));
  await page.waitForSelector(".avviso.ok");
  await page.goto(U + "#importa"); await page.waitForSelector("h1");
  await page.setInputFiles('input[accept="application/pdf,.pdf"][multiple]', [process.argv[2]]);
  await page.waitForSelector("table.tabella tbody tr", { timeout: 60000 }); await page.waitForTimeout(400);
  await page.goto(U + "#movimenti"); await page.waitForTimeout(600);
  const grp = page.locator(".pastiglia-gruppo").first();
  console.log(nome, "pastiglie:", await page.locator(".pastiglie[aria-label=Conti] > *").allInnerTexts());
  if (nome === "pc") await grp.hover(); else await grp.locator(".freccia").click();
  await page.waitForTimeout(200);
  console.log(nome, "menu visibile:", await grp.locator(".menu-conti").isVisible(), await grp.locator(".menu-conti label").allInnerTexts());
  await grp.locator(".menu-conti label").nth(1).click(); await page.waitForTimeout(300);
  await page.screenshot({ path: `test/shot/enti-movimenti-${nome}.png` });
  console.log(nome, "dopo scelta Salvadanaio:", await grp.getAttribute("class"), (await page.locator(".m-conto").allInnerTexts()).slice(0, 2));
  await page.goto(U + "#saldi"); await page.waitForTimeout(700);
  await page.locator(".elenco-conti li.ente-gruppo").first().click(); await page.waitForTimeout(200);
  console.log(nome, "elenco:", (await page.locator(".elenco-conti li").allInnerTexts()).map((t) => t.replace(/\n/g, " ")));
  await page.locator(".elenco-conti").screenshot({ path: `test/shot/enti-saldi-${nome}.png` });
  await ctx.close();
}
console.log("errori:", errori.join("\n") || "nessuno");
await browser.close(); srv.close();
// grafico Patrimonio con e senza sotto-conti
{
  const b2 = await chromium.launch(); const ctx = await b2.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.route("https://finanze.elia-buono.workers.dev/**", (r) => r.fulfill({ status: 503, headers: { "Access-Control-Allow-Origin": "*" }, body: "{}" }));
  const srv2 = http.createServer((q, r) => { let p = decodeURIComponent(new URL(q.url, "http://x").pathname); if (p.endsWith("/")) p += "index.html";
    const f = path.join(DIST, p); if (!fs.existsSync(f)) { r.writeHead(404); r.end(); return; } r.writeHead(200, { "Content-Type": tipi[path.extname(f)] || "application/octet-stream" }); fs.createReadStream(f).pipe(r); }).listen(5183);
  const page = await ctx.newPage(); const err = []; page.on("pageerror", (e) => err.push(e.message)); page.on("dialog", (d) => d.accept());
  await page.goto("http://localhost:5183/#impostazioni"); await page.waitForSelector("h1");
  await page.setInputFiles('input[accept*=".zip"]', fs.readdirSync("ref/dati").map((f) => path.join("ref/dati", f)));
  await page.waitForSelector(".avviso.ok");
  await page.goto("http://localhost:5183/#saldi"); await page.waitForTimeout(700);
  const leg = async () => (await page.locator("section:has-text('Andamento') .legenda, section:has-text('Andamento') [class*=legenda] button").allInnerTexts()).join(" / ");
  console.log("legenda per ente:", await leg());
  await page.locator("label.spunta:has-text('singoli conti') input").check(); await page.waitForTimeout(300);
  console.log("legenda sotto-conti:", await leg());
  await page.locator("section:has-text('Andamento')").first().screenshot({ path: "test/shot/enti-grafico.png" });
  await page.locator("button[role=radio]:has-text('Candele')").click(); await page.waitForTimeout(200);
  console.log("serie candele:", await page.locator("select").first().locator("option").allInnerTexts());
  console.log("errori grafico:", err.join("\n") || "nessuno");
  await b2.close(); srv2.close();
}
