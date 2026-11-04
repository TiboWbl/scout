import type { SupabaseClient } from "@supabase/supabase-js";
import { Criteria } from "@/lib/domain/criteria";
import type { LlmProvider } from "@/lib/llm";
import { companyKey } from "./normalize";
import { resolveCompany } from "./resolve";

// Proactive search: the sectors people care most about (sport, health…) get their companies looked for,
// start-ups included, instead of waiting for them to show up in a search engine. The model only proposes
// names and sites; each is checked like a favourite and enters the directory only with a real career page
// that lists offers in France. A made-up or unreadable company leaves no trace.

const SYSTEM = `Tu connais bien le marché de l'emploi en France. Pour un secteur donné, liste des entreprises dont c'est le cœur de métier (pas un client ni un fournisseur du secteur) et qui recrutent en France, avec leur site web officiel : marques, distributeurs, start-ups et scale-ups, éditeurs d'applications, médias, clubs et organisations, selon le secteur. Uniquement des entreprises réelles et actives dont tu es sûr ; si tu doutes d'une entreprise ou de son site, ne la mets pas. Le nom seul, tel que l'entreprise l'écrit, sans parenthèses ni liste de marques. Réponds uniquement avec {"entreprises": [{"nom": "...", "site": "exemple.com"}]}.`;

// One company name, as offers write it: the bolded name when the model wrote a sentence ("PayFit
// **Shine**" → "Shine"), never parentheses ("Groupe Lagardère (Paris Match)") nor markdown.
export function cleanName(raw: string): string {
  const bold = [...raw.matchAll(/\*\*(.+?)\*\*/g)].map((m) => m[1]);
  const name = bold.length ? bold[bold.length - 1] : raw;
  return name.replace(/[*_`#]/g, "").replace(/\s*\(.*?\)\s*/g, " ").replace(/\s+/g, " ").trim();
}

export type SectorReport = { sector: string; proposed: number; added: number; offers: number };

export async function sectorsSought(db: SupabaseClient): Promise<string[]> {
  const { data } = await db.from("profiles").select("criteria").not("onboarded_at", "is", null).eq("is_demo", false);
  const sectors = new Map<string, string>();
  for (const row of data ?? []) {
    const c = Criteria.safeParse(row.criteria).data;
    for (const s of c?.sectorsPriority ?? []) sectors.set(s.trim().toLowerCase(), s.trim());
  }
  return [...sectors.values()];
}

export async function discoverSector(db: SupabaseClient, llm: LlmProvider, sector: string, { perAsk = 40 } = {}): Promise<SectorReport> {
  const { data: known } = await db.from("companies").select("name_key").not("ats", "is", null);
  const have = new Set((known ?? []).map((c) => c.name_key as string));
  const seen = new Set<string>();
  const proposals: { nom: string; site: string }[] = [];
  // Two angles: the established names, then the young companies a search engine rarely shows.
  for (const angle of ["les entreprises établies (marques, distributeurs, groupes, médias)", "les start-ups et scale-ups françaises (applications, plateformes, technologie)"]) {
    const read = (await llm.json({ system: SYSTEM, user: `Secteur : ${sector}. Donne jusqu'à ${perAsk} entreprises, en priorité ${angle}.`, tier: "fast" }).catch(() => null)) as { entreprises?: unknown } | null;
    for (const e of Array.isArray(read?.entreprises) ? read!.entreprises : []) {
      const x = e as { nom?: unknown; site?: unknown };
      if (typeof x.nom !== "string" || !x.nom.trim()) continue;
      // The company's name only, as offers write it: "Groupe Lagardère (Paris Match, JDD)" → "Groupe Lagardère".
      const nom = cleanName(x.nom);
      if (!nom || nom.length > 60) continue;
      const key = companyKey(nom);
      if (seen.has(key) || have.has(key)) continue;
      seen.add(key);
      proposals.push({ nom, site: typeof x.site === "string" ? x.site.trim() : "" });
    }
  }
  return resolveAll(db, proposals, `secteur:${sector}`, sector);
}

// Companies like the ones a person already follows: favourites describe what they like (sector, size,
// product, culture) better than any keyword. Same checks as for a sector: only a real career page with
// offers in France enters the directory.
const SIMILAR = `Tu connais bien les entreprises qui recrutent en France. À partir d'une liste d'entreprises qu'une personne aime, propose d'autres entreprises qui leur ressemblent (même secteur, même taille, même type de produit ou même culture) et qui recrutent en France, en particulier celles qu'on connaît moins. Pas celles de la liste. Uniquement des entreprises réelles et actives dont tu es sûr, avec leur site web officiel. Le nom seul, tel que l'entreprise l'écrit. Réponds uniquement avec {"entreprises": [{"nom": "...", "site": "exemple.com"}]}.`;

export async function favoritesSought(db: SupabaseClient): Promise<string[][]> {
  const { data } = await db.from("favorite_companies").select("user_id, company:companies(name)");
  const byUser = new Map<string, string[]>();
  for (const f of data ?? []) {
    const name = (f.company as unknown as { name: string } | null)?.name;
    if (name) byUser.set(f.user_id as string, [...(byUser.get(f.user_id as string) ?? []), name]);
  }
  return [...byUser.values()].filter((list) => list.length >= 3);
}

export async function discoverSimilar(db: SupabaseClient, llm: LlmProvider, favorites: string[]): Promise<SectorReport> {
  const { data: known } = await db.from("companies").select("name_key").not("ats", "is", null);
  const have = new Set((known ?? []).map((c) => c.name_key as string));
  const seen = new Set<string>();
  const proposals: { nom: string; site: string }[] = [];
  // A few favourites at a time: the model looks closer at each.
  for (let i = 0; i < favorites.length; i += 15) {
    const read = (await llm.json({ system: SIMILAR, user: `Entreprises aimées : ${favorites.slice(i, i + 15).join(", ")}. Propose jusqu'à 25 entreprises qui leur ressemblent.`, tier: "fast" }).catch(() => null)) as { entreprises?: unknown } | null;
    for (const e of Array.isArray(read?.entreprises) ? read!.entreprises : []) {
      const x = e as { nom?: unknown; site?: unknown };
      if (typeof x.nom !== "string" || !x.nom.trim()) continue;
      const nom = cleanName(x.nom);
      if (!nom || nom.length > 60) continue;
      const key = companyKey(nom);
      if (seen.has(key) || have.has(key)) continue;
      seen.add(key);
      proposals.push({ nom, site: typeof x.site === "string" ? x.site.trim() : "" });
    }
  }
  return resolveAll(db, proposals, "favorites-similaires", "favorites similaires");
}

async function resolveAll(db: SupabaseClient, proposals: { nom: string; site: string }[], via: string, label: string): Promise<SectorReport> {
  let added = 0;
  let offers = 0;
  let next = 0;
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      while (next < proposals.length) {
        const p = proposals[next++];
        // A company already in the directory under another name (Drivy is Getaround): never twice.
        const host = p.site.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
        if (host) {
          const { data: same } = await db.from("companies").select("id").eq("domain", host).limit(1);
          if (same?.length) continue;
        }
        const r = await Promise.race([
          resolveCompany(db, p.site ? { name: p.nom, site: p.site } : { name: p.nom }, { via, keepUnfound: false }),
          new Promise<null>((r) => setTimeout(() => r(null), 45_000)),
        ]).catch(() => null);
        if (r?.found) {
          added++;
          offers += r.offers;
        }
      }
    }),
  );
  return { sector: label, proposed: proposals.length, added, offers };
}
