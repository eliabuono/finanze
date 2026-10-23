import sharp from "sharp";
const d = "public/";
for (const [src, out, s] of [["icona.svg","icona-192.png",192],["icona.svg","icona-512.png",512],["icona-maskable.svg","icona-maskable-512.png",512],["icona-maskable.svg","apple-touch-icon.png",180],["icona.svg","favicon-32.png",32]])
  await sharp(d+src).resize(s,s).png().toFile(d+out);
console.log("ok");
