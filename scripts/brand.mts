// Generates the Scout logo, icons and share image from the brand fonts. Usage: npm run brand
// Text is converted to outlines, so the files render the same everywhere without the fonts.
import { mkdirSync, writeFileSync } from "node:fs";
import opentype from "opentype.js";
import sharp from "sharp";

const INK = "#17151f";
const PAPER = "#fbfaf8";
const VIOLET = "#6d5bf0"; // on light backgrounds
const VIOLET_ON_DARK = "#8b7dff"; // same hue, enough contrast on ink

// Google Fonts serves TrueType-flavoured WOFF to this (old) user agent; opentype.js reads it.
async function font(family: string, axes: string): Promise<opentype.Font> {
  const ua = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_6_8) AppleWebKit/534.59.10 (KHTML, like Gecko) Version/5.1.9 Safari/534.59.10";
  const css = await (await fetch(`https://fonts.googleapis.com/css2?family=${family}:${axes}`, { headers: { "User-Agent": ua } })).text();
  const url = css.match(/url\(([^)]+)\)/)?.[1];
  if (!url) throw new Error(`no font file for ${family}`);
  return opentype.parse(await (await fetch(url)).arrayBuffer());
}

const display = await font("Bricolage+Grotesque", "opsz,wght@96,800");
const body = await font("Inter", "wght@500");
const strong = await font("Inter", "wght@700");
const semi = await font("Inter", "wght@600");

type Mark = { d: string; width: number; dot: { cx: number; cy: number; r: number } };

// Glyph by glyph, with the font's advances and kerning: opentype.js does not support every
// substitution table of these fonts, and no ligature is needed for these few words.
function textPath(f: opentype.Font, text: string, x: number, y: number, size: number): opentype.Path {
  const out = new opentype.Path();
  const scale = size / f.unitsPerEm;
  let cursor = x;
  let previous: opentype.Glyph | null = null;
  for (const ch of text) {
    const glyph = f.charToGlyph(ch);
    if (previous) cursor += f.getKerningValue(previous, glyph) * scale;
    out.extend(glyph.getPath(cursor, y, size));
    cursor += (glyph.advanceWidth ?? 0) * scale;
    previous = glyph;
  }
  return out;
}

// Own serialisation: opentype.js's toPathData mangles some quadratic curves of this font into NaN.
// A missing control point falls back to the previous point (the curve becomes a straight segment).
function pathData(path: opentype.Path): string {
  const n = (v: number) => (Number.isFinite(v) ? v.toFixed(2) : null);
  let px = 0;
  let py = 0;
  const parts: string[] = [];
  for (const c of path.commands) {
    if (c.type === "Z") parts.push("Z");
    else if (c.type === "M" || c.type === "L") parts.push(`${c.type}${n(c.x)} ${n(c.y)}`);
    else if (c.type === "Q") parts.push(`Q${n(c.x1) ?? px.toFixed(2)} ${n(c.y1) ?? py.toFixed(2)} ${n(c.x)} ${n(c.y)}`);
    else if (c.type === "C") parts.push(`C${n(c.x1) ?? px.toFixed(2)} ${n(c.y1) ?? py.toFixed(2)} ${n(c.x2)} ${n(c.y2)} ${n(c.x)} ${n(c.y)}`);
    if (c.type !== "Z") [px, py] = [c.x, c.y];
  }
  return parts.join("");
}

// Word + round dot sitting on the baseline. dotScale > 1 enlarges the dot for tiny sizes.
function mark(word: string, size: number, dotScale = 1): Mark {
  const path = textPath(display, word, 0, size, size);
  const bb = path.getBoundingBox();
  const r = size * 0.105 * dotScale;
  // Enough air between the last letter and the dot, even when the dot grows for tiny icons.
  const gap = size * (0.05 + 0.03 * (dotScale - 1));
  const cx = bb.x2 + gap + r;
  return { d: pathData(path), width: cx + r, dot: { cx, cy: size - r, r } };
}

function svg(width: number, height: number, inner: string) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">${inner}</svg>`;
}

const placed = (m: Mark, x: number, y: number, ink: string, dot: string, cls = "") =>
  `<g transform="translate(${x.toFixed(2)} ${y.toFixed(2)})"><path${cls ? ` class="${cls}-ink"` : ""} d="${m.d}" fill="${ink}"/><circle${cls ? ` class="${cls}-dot"` : ""} cx="${m.dot.cx.toFixed(2)}" cy="${m.dot.cy.toFixed(2)}" r="${m.dot.r.toFixed(2)}" fill="${dot}"/></g>`;

// Cap height of the S, to centre the monogram optically rather than on its line box.
function sMetrics(size: number, dotScale: number) {
  const m = mark("S", size, dotScale);
  const bb = textPath(display, "S", 0, size, size).getBoundingBox();
  return { m, top: bb.y1, bottom: size };
}

function squareIcon(px: number, { bg, ink, dot, radius = 0.22, dotScale = 1 }: { bg: string | null; ink: string; dot: string; radius?: number; dotScale?: number }) {
  const size = px * 0.62;
  const { m, top, bottom } = sMetrics(size, dotScale);
  const x = (px - m.width) / 2;
  const y = (px - (bottom - top)) / 2 - top;
  const rect = bg ? `<rect width="${px}" height="${px}" rx="${(px * radius).toFixed(2)}" fill="${bg}"/>` : "";
  return svg(px, px, rect + placed(m, x, y, ink, dot));
}

const png = (s: string, file: string) => sharp(Buffer.from(s)).png().toFile(file);

mkdirSync("public/brand", { recursive: true });
mkdirSync("public/icons", { recursive: true });

// Wordmark, black and white text, transparent background.
const word = mark("Scout", 200);
const pad = 24;
const wordSvg = (ink: string, dot: string) => svg(Math.ceil(word.width + pad * 2), 200 + pad * 2, placed(word, pad, pad + 6, ink, dot));
writeFileSync("public/brand/scout-wordmark-black.svg", wordSvg(INK, VIOLET));
writeFileSync("public/brand/scout-wordmark-white.svg", wordSvg("#ffffff", VIOLET_ON_DARK));

// Monogram: the dot grows as the icon shrinks, so it stays visible in a browser tab.
const dark = { bg: INK, ink: "#ffffff", dot: VIOLET_ON_DARK };
const light = { bg: "#ffffff", ink: INK, dot: VIOLET };
for (const [px, dotScale] of [[16, 1.6], [32, 1.35], [192, 1.1], [512, 1]] as const) {
  await png(squareIcon(px, { ...dark, dotScale }), `public/icons/icon-${px}.png`);
  await png(squareIcon(px, { ...light, dotScale }), `public/icons/icon-${px}-light.png`);
}
// iOS rounds the corners itself: full-bleed square.
await png(squareIcon(180, { ...dark, radius: 0, dotScale: 1.1 }), "src/app/apple-icon.png");

// Browser tab icon that follows the system theme.
const tab = (() => {
  const px = 32;
  const size = px * 0.62;
  const { m, top, bottom } = sMetrics(size, 1.35);
  const x = (px - m.width) / 2;
  const y = (px - (bottom - top)) / 2 - top;
  const style = `<style>.bg{fill:${INK}}.s-ink{fill:#fff}.s-dot{fill:${VIOLET_ON_DARK}}@media (prefers-color-scheme: dark){.bg{fill:#fff}.s-ink{fill:${INK}}.s-dot{fill:${VIOLET}}}</style>`;
  return svg(px, px, `${style}<rect class="bg" width="${px}" height="${px}" rx="7"/>${placed(m, x, y, "#fff", VIOLET_ON_DARK, "s")}`);
})();
writeFileSync("src/app/icon.svg", tab);

// For the portfolio: the monogram on its dark tile, and on transparent backgrounds.
await png(squareIcon(512, dark), "public/brand/scout-s-512.png");
await png(squareIcon(512, { bg: null, ink: INK, dot: VIOLET }), "public/brand/scout-s-512-black-transparent.png");
await png(squareIcon(512, { bg: null, ink: "#ffffff", dot: VIOLET_ON_DARK }), "public/brand/scout-s-512-white-transparent.png");

// Share image (1200×627, LinkedIn's recommended size: a larger one is shrunk and blurred), used when the link is sent.
// Seen as a thumbnail about 500 px wide and recompressed by LinkedIn: few words, large type, no thin
// weight (a 500 weight blurs; 600 holds). Left, what Scout is; right, what it shows:
// an offer explained, and a market counted (shares from the demo's Product Manager market).
{
  const W = 1200;
  const H = 627;
  const MUTED = "#47425a";
  const LINE = "#e4e0ec";
  const t = (f: opentype.Font, text: string, x: number, y: number, size: number, fill: string) => `<path transform="translate(${x} ${y})" d="${pathData(textPath(f, text, 0, 0, size))}" fill="${fill}"/>`;
  const width = (f: opentype.Font, text: string, size: number) => textPath(f, text, 0, 0, size).getBoundingBox().x2;
  const x = 76;
  const left =
    placed(mark("Scout", 128), x - 4, 110, INK, VIOLET) +
    t(strong, "Les offres lues", x, 356, 58, INK) +
    t(strong, "à la source.", x, 424, 58, INK) +
    t(semi, "Triées et expliquées pour toi.", x, 500, 30, MUTED);
  const cx = 640;
  const cw = 490;
  const pill = "Coup de cœur";
  const pw = width(semi, pill, 21) + 32;
  const offer =
    `<rect x="${cx}" y="76" width="${cw}" height="200" rx="26" fill="#ffffff" stroke="${LINE}" stroke-width="2"/>` +
    t(strong, "Product Manager", cx + 32, 136, 31, INK) +
    `<rect x="${cx + 32}" y="160" width="${pw}" height="38" rx="19" fill="#fde8dc"/>` +
    t(semi, pill, cx + 48, 186, 21, "#a8481f") +
    t(strong, "Pour toi :", cx + 32, 246, 24, VIOLET) +
    t(semi, "ton expérience discovery", cx + 32 + width(strong, "Pour toi :", 24) + 9, 246, 24, INK);
  const skills: [string, number][] = [["IA", 59], ["API", 21], ["SaaS", 18]];
  const barX = cx + 110;
  const barW = cw - 110 - 110;
  const rows = skills
    .map(([name, share], k) => {
      const y = 392 + k * 52;
      return (
        t(semi, name, cx + 32, y + 9, 25, INK) +
        `<rect x="${barX}" y="${y - 8}" width="${barW}" height="16" rx="8" fill="#ece8f7"/>` +
        `<rect x="${barX}" y="${y - 8}" width="${(barW * share) / 100}" height="16" rx="8" fill="${VIOLET}"/>` +
        t(strong, `${share} %`, barX + barW + 20, y + 9, 25, INK)
      );
    })
    .join("");
  const market =
    `<rect x="${cx}" y="300" width="${cw}" height="254" rx="26" fill="#ffffff" stroke="${LINE}" stroke-width="2"/>` +
    t(strong, "Ton marché, compté", cx + 32, 350, 27, INK) +
    rows;
  const inner =
    `<rect width="${W}" height="${H}" fill="${PAPER}"/>` +
    `<rect x="${W - 300}" y="-160" width="460" height="460" rx="130" fill="${VIOLET}" opacity="0.08"/>` +
    left +
    offer +
    market;
  await sharp(Buffer.from(svg(W, H, inner)), { density: 144 }).resize(W, H).flatten({ background: PAPER }).png({ compressionLevel: 9 }).toFile("src/app/opengraph-image.png");
  writeFileSync("src/app/opengraph-image.alt.txt", "Scout : les offres lues à la source, sur les sites carrière et les API publiques, triées et expliquées, avec ce que ton marché demande, compté offre par offre.");
}

console.log("logo, icônes et image de partage générés");
