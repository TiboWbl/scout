import type { NormalizedOffer } from "@/lib/domain/offer";
import { fromHtmlPage, fromJsonLd } from "../jsonld";
import type { BoardRef, Keep, Wanted } from "./ats-more";

// A company's own career site, without a known ATS: its job pages carry the schema.org JobPosting
// that search engines read. The board token is the address of the page listing the offers. Job links
// come from that page, or from the site map when the list is drawn in the browser.

const TIMEOUT_MS = 12_000;
const MAX_JOBS = 120;
const PARALLEL = 6;
const HEADERS = { "User-Agent": "Mozilla/5.0 (compatible; Scout job aggregator)", Accept: "text/html,application/xml", "Accept-Language": "fr-FR,fr;q=0.9" };
// Paths that look like a single job page, not a list or a filter.
const JOB_PATH = /\/(jobs?|offres?(-d-emploi)?|annonces?|emplois?|postes?|careers?|carrieres?|job-offers?|positions?|vacanc(y|ies)|opportunit(y|ies)|recrutement)\/[^?#]*[a-z0-9-]{6,}/i;

async function text(url: string): Promise<string | null> {
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: HEADERS, redirect: "follow" }).catch(() => null);
  return res?.ok ? res.text().catch(() => null) : null;
}

// "qualit&#xE9;" → "qualité": a title must read as written to be matched against the searches.
const entities = (s: string) =>
  s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");

// Job links of a listing page, with their visible text (usually the title).
export function jobLinks(html: string, pageUrl: string): { url: string; label: string }[] {
  const base = new URL(pageUrl);
  const out = new Map<string, string>();
  for (const m of html.matchAll(/<a\b[^>]*href="([^"#]+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    let url: URL;
    try {
      url = new URL(m[1].replace(/&amp;/g, "&"), base);
    } catch {
      continue;
    }
    if (url.hostname !== base.hostname || !JOB_PATH.test(url.pathname) || url.pathname.replace(/\/$/, "") === base.pathname.replace(/\/$/, "")) continue;
    // On a shared career site, only this company's offers.
    const company = /^\/companies\/[^/]+/.exec(base.pathname)?.[0];
    if (company && !url.pathname.startsWith(company)) continue;
    url.search = "";
    const label = entities(m[2].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
    if (!out.has(url.href) || label.length > (out.get(url.href)?.length ?? 0)) out.set(url.href, label);
  }
  return [...out].map(([url, label]) => ({ url, label }));
}

// Job addresses from the site map: those robots.txt declares, then the usual places. Maps under the listing's
// own path ("/fr/fr/") come first. The address's last part usually holds the title ("…/product-manager-paris").
async function fromSitemap(pageUrl: string): Promise<{ url: string; label: string }[]> {
  const page = new URL(pageUrl);
  const origin = page.origin;
  const prefix = page.pathname.split("/").slice(0, 3).join("/");
  const robots = (await text(`${origin}/robots.txt`)) ?? "";
  const declared = [...robots.matchAll(/^sitemap:\s*(\S+)/gim)].map((m) => m[1]);
  const queue = [...declared.sort((a, b) => Number(new URL(b).pathname.startsWith(prefix)) - Number(new URL(a).pathname.startsWith(prefix))), `${origin}/sitemap.xml`, `${origin}/sitemap_index.xml`];
  const seen = new Set<string>();
  const urls: string[] = [];
  for (let i = 0; i < queue.length && seen.size < 12 && urls.length < 5000; i++) {
    if (seen.has(queue[i])) continue;
    seen.add(queue[i]);
    const xml = await text(queue[i]);
    if (!xml) continue;
    for (const [, loc] of xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)) {
      if (/\.xml(\.gz)?$/i.test(loc)) {
        if (/job|offre|emploi|career|carriere|poste|vacanc|sitemap\d|sitemap_index/i.test(loc)) queue.push(loc);
      } else if (JOB_PATH.test(new URL(loc, origin).pathname)) urls.push(loc);
    }
  }
  const local = urls.filter((u) => new URL(u).pathname.startsWith(prefix));
  return (local.length ? local : urls).map((url) => ({ url, label: decodeURIComponent(new URL(url).pathname.split("/").filter(Boolean).pop() ?? "").replace(/[-_]+/g, " ") }));
}

// A listing narrowed by an identifier ("…/france-jobs/3456/3017382/2": France on L'Oréal's site) often
// shows its first offers only, its next pages forbidden to robots. The site map lists the same listing
// narrowed further (by region, city, job family: "…/3017382-3012874/…"): read together, they cover it.
async function narrowedListings(pageUrl: string): Promise<{ url: string; label: string }[]> {
  const page = new URL(pageUrl);
  const id = page.pathname.split("/").filter((p) => /^\d{6,}$/.test(p)).sort((a, b) => b.length - a.length)[0];
  if (!id) return [];
  const robots = (await text(`${page.origin}/robots.txt`)) ?? "";
  const maps = [...robots.matchAll(/^sitemap:\s*(\S+)/gim)].map((m) => m[1]);
  const prefix = page.pathname.split("/").slice(0, 2).join("/");
  const pages = new Set<string>();
  for (const map of [`${page.origin}${prefix}/sitemap.xml`, ...maps].slice(0, 3)) {
    for (const [, loc] of (await text(map))?.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g) ?? []) {
      const u = new URL(loc, page.origin);
      if (u.href !== page.href && u.pathname.startsWith(prefix) && new RegExp(`/${id}(?:[-/]|$)`).test(u.pathname) && !JOB_PATH.test(u.pathname)) pages.add(u.href);
    }
    if (pages.size) break;
  }
  const out = new Map<string, string>();
  const list = [...pages].slice(0, 80);
  for (let i = 0; i < list.length; i += PARALLEL) {
    const htmls = await Promise.all(list.slice(i, i + PARALLEL).map(async (u) => ({ u, html: await text(u) })));
    for (const { u, html } of htmls) for (const l of html ? jobLinks(html, u) : []) if (!out.has(l.url)) out.set(l.url, l.label);
  }
  return [...out].map(([url, label]) => ({ url, label }));
}

export async function site(board: BoardRef, keep?: Keep, wanted?: Wanted): Promise<NormalizedOffer[]> {
  const listing = await text(board.token);
  if (listing === null) throw new Error("career page unreachable");
  let links = jobLinks(listing, board.token);
  if (links.length === 0) links = await fromSitemap(board.token);
  else {
    const seen = new Set(links.map((l) => l.url));
    for (const l of await narrowedListings(board.token)) if (!seen.has(l.url)) links.push(l);
  }
  // Titles visible on the list spare the requests no search could use.
  const toRead = links.filter((l) => !wanted || !l.label || l.label.length > 120 || wanted(l.label)).slice(0, MAX_JOBS);
  const out: NormalizedOffer[] = [];
  for (let i = 0; i < toRead.length; i += PARALLEL) {
    const pages = await Promise.all(toRead.slice(i, i + PARALLEL).map(async (l) => ({ url: l.url, html: await text(l.url) })));
    for (const p of pages) {
      // The structured JobPosting when the page has one, else the page itself read as a posting.
      const offer = p.html ? (fromJsonLd(p.html, p.url) ?? fromHtmlPage(p.html, p.url)) : null;
      if (!offer || (keep && !keep(offer.places, offer.remote, offer.title))) continue;
      out.push({ ...offer, sourceKey: `site:${board.token}`, company: { name: board.name, domain: board.domain ?? undefined, ats: "site", atsToken: board.token } });
    }
  }
  return out;
}
