import type { SupabaseClient } from "@supabase/supabase-js";
import { Criteria } from "@/lib/domain/criteria";
import type { LlmProvider } from "@/lib/llm";
import { companyKey } from "./normalize";
import { resolveCompany } from "./resolve";

// Proactive search: the sectors people care most about (sport, health…) get their companies looked for,
// start-ups included, instead of waiting for them to show up in a search engine. The model only proposes
// names and sites; each is checked like a favourite and enters the directory only with a real career page
// that lists offers in France. A made-up or unreadable company leaves no trace.

const SYSTEM = `Tu connais bien le marché de l'emploi en France. Pour un secteur donné, liste des entreprises qui recrutent en France dans ce secteur, avec leur site web officiel : marques, distributeurs, start-ups et scale-ups, éditeurs d'applications, médias, clubs et organisations, selon le secteur. Uniquement des entreprises réelles et actives dont tu es sûr ; si tu doutes d'une entreprise ou de son site, ne la mets pas. Réponds uniquement avec {"entreprises": [{"nom": "...", "site": "exemple.com"}]}.`;

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
      const key = companyKey(x.nom);
      if (seen.has(key) || have.has(key)) continue;
      seen.add(key);
      proposals.push({ nom: x.nom.trim(), site: typeof x.site === "string" ? x.site.trim() : "" });
    }
  }
  let added = 0;
  let offers = 0;
  let next = 0;
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      while (next < proposals.length) {
        const p = proposals[next++];
        const r = await Promise.race([
          resolveCompany(db, p.site ? { name: p.nom, site: p.site } : { name: p.nom }, { via: `secteur:${sector}`, keepUnfound: false }),
          new Promise<null>((r) => setTimeout(() => r(null), 45_000)),
        ]).catch(() => null);
        if (r?.found) {
          added++;
          offers += r.offers;
        }
      }
    }),
  );
  return { sector, proposed: proposals.length, added, offers };
}
