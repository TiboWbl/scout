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

// Share image (1200×630, drawn at twice the size so it stays sharp), used when the link is sent to someone.
{
  const W = 1200;
  const H = 630;
  const big = mark("Scout", 200);
  const line1 = textPath(body, "Les offres lues à la source.", 0, 0, 44);
  const line2 = textPath(body, "Sites carrière et API publiques, triées et expliquées pour toi.", 0, 0, 28);
  const line3 = textPath(body, "Et ce que ton marché demande vraiment, compté offre par offre.", 0, 0, 28);
  const x = 96;
  const inner =
    `<rect width="${W}" height="${H}" fill="${PAPER}"/>` +
    `<rect x="${W - 260}" y="-120" width="420" height="420" rx="120" fill="${VIOLET}" opacity="0.10"/>` +
    placed(big, x, 96, INK, VIOLET) +
    `<g transform="translate(${x + 6} 418)"><path d="${pathData(line1)}" fill="${INK}"/></g>` +
    `<g transform="translate(${x + 6} 482)"><path d="${pathData(line2)}" fill="#544f60"/></g>` +
    `<g transform="translate(${x + 6} 526)"><path d="${pathData(line3)}" fill="#544f60"/></g>`;
  const sharp2x = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W * 2}" height="${H * 2}">${inner}</svg>`;
  await png(sharp2x, "src/app/opengraph-image.png");
  writeFileSync("src/app/opengraph-image.alt.txt", "Scout : les offres lues à la source, sur les sites carrière et les API publiques, triées et expliquées, avec ce que ton marché demande vraiment.");
}

console.log("logo, icônes et image de partage générés");
