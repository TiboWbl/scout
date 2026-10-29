import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { getLlm } from "@/lib/llm";

// Who really recruits behind an employer name: a subsidiary's group, a public body's institution.
// The model proposes a brand and an official domain; a domain is kept only if the logo CDN knows it.

const BATCH = 25;
const SYSTEM = `Tu aides à identifier les employeurs d'offres d'emploi. Pour chaque employeur, tu reçois son nom tel qu'il apparaît et quelques intitulés de ses offres.
Réponds uniquement avec {"employeurs": [{"id", "marque", "domaine"}]} :
- "marque" : le nom court, sans parenthèse, de la marque ou du groupe le plus connu qui recrute réellement (une filiale → son groupe ; une agence ou entité d'un groupe → le groupe ; une administration ou un établissement public → l'institution principale), sinon le nom lui-même.
- "domaine" : le domaine du site officiel de cette marque (ex. "theodo.com"), seulement si tu le connais avec certitude, sinon null. N'invente jamais.`;

const Answer = z.object({
  employeurs: z.array(z.object({ id: z.union([z.string(), z.number()]).transform(String), marque: z.string().nullish(), domaine: z.string().nullish() })),
});

const logoBytes = async (domain: string): Promise<Buffer | null> => {
  const token = process.env.NEXT_PUBLIC_LOGO_DEV_TOKEN;
  if (!token) return null;
  const res = await fetch(`https://img.logo.dev/${domain}?token=${token}&size=32&format=png&fallback=404`, { signal: AbortSignal.timeout(10_000) }).catch(() => null);
  return res?.ok ? Buffer.from(await res.arrayBuffer()) : null;
};

// For a dead or unknown site, the logo CDN may answer with the logo of the social page it found
// (LinkedIn, Facebook…): that is not the employer's logo.
const BORROWED = ["linkedin.com", "facebook.com", "instagram.com", "x.com", "twitter.com", "youtube.com", "indeed.com", "welcometothejungle.com", "glassdoor.com", "malt.fr"];
let borrowed: Promise<Buffer[]> | null = null;
// Whether the company's site still answers (any HTTP status counts, even a refusal): a dead domain's
// "logo" is whatever the CDN found elsewhere, often its LinkedIn page.
export async function siteAnswers(domain: string): Promise<boolean> {
  for (const host of [domain, `www.${domain}`]) {
    const res = await fetch(`https://${host}`, { method: "HEAD", redirect: "follow", signal: AbortSignal.timeout(8_000) }).catch(() => null);
    if (res) return true;
  }
  return false;
}

export async function hasOwnLogo(domain: string): Promise<boolean> {
  if (!(await siteAnswers(domain))) return false;
  const bytes = await logoBytes(domain);
  if (!bytes) return false;
  if (BORROWED.some((d) => domain === d || domain.endsWith(`.${d}`))) return false;
  borrowed ??= Promise.all(BORROWED.map(logoBytes)).then((list) => list.filter((b): b is Buffer => b !== null));
  return !(await borrowed).some((b) => b.equals(bytes));
}
const logoExists = hasOwnLogo;

const cleanDomain = (d: string) => d.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");

export async function enrichCompanies(db: SupabaseClient, limit = 200): Promise<{ checked: number; withDomain: number }> {
  const { data: companies } = await db.from("companies").select("id, name").is("domain", null).is("enriched_at", null).limit(limit);
  let withDomain = 0;
  for (let i = 0; i < (companies ?? []).length; i += BATCH) {
    const batch = companies!.slice(i, i + BATCH);
    // A few postings per employer: titles for the model, full text as evidence for any brand it names.
    const titles = new Map<string, string[]>();
    const evidence = new Map<string, string>();
    await Promise.all(
      batch.map(async (c) => {
        const { data: offers } = await db.from("offers").select("title, description").eq("company_id", c.id).limit(3);
        titles.set(c.id, (offers ?? []).map((o) => o.title).slice(0, 2));
        evidence.set(c.id, (offers ?? []).map((o) => `${o.title}\n${(o.description ?? "").slice(0, 4000)}`).join("\n").toLowerCase());
      }),
    );
    const user = batch.map((c, k) => JSON.stringify({ id: `e${k + 1}`, nom: c.name, offres: titles.get(c.id) ?? [] })).join("\n");
    let answer: z.infer<typeof Answer> | null = null;
    try {
      const parsed = Answer.safeParse(await getLlm().json({ system: SYSTEM, user, tier: "fast" }));
      answer = parsed.success ? parsed.data : null;
    } catch {
      return { checked: i, withDomain };
    }
    for (const [k, c] of batch.entries()) {
      const a = answer?.employeurs.find((e) => e.id === `e${k + 1}` || e.id === String(k + 1));
      // "Deloitte (filiale …)" → "Deloitte"; a brand that only re-spells the name is not a different recruiter.
      const proposed = a?.marque?.replace(/\s*\(.*?\)\s*/g, " ").trim() || null;
      const same = (x: string) => x.toLowerCase().replace(/[^a-z0-9]/g, "");
      const isSelf = !proposed || same(proposed) === same(c.name);
      // Only a brand the postings themselves mention: a wrong group shown to the user is worse than none.
      const mentioned = Boolean(proposed && evidence.get(c.id)?.includes(proposed.toLowerCase()));
      const brand = proposed && mentioned && !isSelf ? proposed : null;
      // The domain must belong to the employer itself or to a brand the postings mention.
      const domain = a?.domaine ? cleanDomain(a.domaine) : null;
      const verified = domain && (isSelf || brand) && /^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain) && (await logoExists(domain)) ? domain : null;
      if (verified) withDomain++;
      // A new domain means a new logo: its colour is extracted again.
      await db
        .from("companies")
        .update({ brand, enriched_at: new Date().toISOString(), ...(verified ? { domain: verified, color_checked_at: null } : {}) })
        .eq("id", c.id);
    }
  }
  return { checked: companies?.length ?? 0, withDomain };
}

// Employers known only by name (search engines): their site guessed from the name ("Hubvisory" →
// hubvisory.com), then kept only if the model, reading the site's own title and description next to
// the company's postings, confirms it is the same company. "eXalt" must not get a caterer's logo.
const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "");
const SAME = `Pour chaque cas, tu reçois une entreprise vue dans des offres d'emploi (nom et extrait d'offre) et un site web trouvé à partir de son nom (titre et description du site). Le site est-il bien celui de cette entreprise ? Réponds "oui" seulement si l'activité décrite par le site correspond clairement à celle de l'offre ; en cas de doute, "non". Réponds {"resultats": [{"id", "meme_entreprise": "oui" | "non"}]}.`;

async function siteFromName(name: string): Promise<{ domain: string; title: string } | null> {
  const base = fold(name.replace(/\b(sas|sa|sarl|group|groupe|france)\b/gi, ""));
  if (base.length < 3) return null;
  for (const tld of ["fr", "com", "io", "co", "eu"]) {
    const res = await fetch(`https://${base}.${tld}`, { redirect: "follow", signal: AbortSignal.timeout(6_000), headers: { "User-Agent": "Mozilla/5.0" } }).catch(() => null);
    if (!res?.ok) continue;
    const html = (await res.text().catch(() => "")).slice(0, 30_000);
    const meta = (re: RegExp) => re.exec(html)?.[1]?.replace(/&[#a-z0-9]+;/gi, " ").trim() ?? "";
    const title = `${meta(/<title[^>]*>([^<]*)/i)} — ${meta(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)/i) || meta(/og:description["'][^>]+content=["']([^"']+)/i)}`;
    if (fold(title).includes(base)) return { domain: cleanDomain(new URL(res.url).hostname), title: title.slice(0, 400) };
  }
  return null;
}

export async function guessDomains(db: SupabaseClient, companyIds: string[]): Promise<number> {
  const { data } = await db.from("companies").select("id, name, product").in("id", companyIds).is("domain", null).is("domain_guessed_at", null);
  const found: { id: string; name: string; domain: string; title: string; offer: string }[] = [];
  await Promise.all(
    (data ?? []).map(async (c) => {
      await db.from("companies").update({ domain_guessed_at: new Date().toISOString() }).eq("id", c.id);
      const site = await siteFromName(c.name);
      if (!site) return;
      const { data: o } = await db.from("offers").select("description").eq("company_id", c.id).not("description", "is", null).limit(1).maybeSingle();
      found.push({ id: c.id, name: c.name, ...site, offer: `${c.product ?? ""} ${(o?.description ?? "").slice(0, 1200)}` });
    }),
  );
  let kept = 0;
  for (let i = 0; i < found.length; i += 10) {
    const batch = found.slice(i, i + 10);
    const raw = (await getLlm()
      .json({ system: SAME, user: batch.map((f, k) => JSON.stringify({ id: `c${k}`, entreprise: f.name, offre: f.offer, site: f.domain, site_dit: f.title })).join("\n"), tier: "fast" })
      .catch(() => null)) as { resultats?: { id: string; meme_entreprise: string }[] } | null;
    for (const r of raw?.resultats ?? []) {
      const f = batch[Number(String(r.id).replace(/\D/g, ""))];
      if (!f || !/^oui/i.test(r.meme_entreprise ?? "") || !(await hasOwnLogo(f.domain))) continue;
      kept++;
      await db.from("companies").update({ domain: f.domain, color_checked_at: null, cover_checked_at: null }).eq("id", f.id);
    }
  }
  return kept;
}
