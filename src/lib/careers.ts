import type { SupabaseClient } from "@supabase/supabase-js";
import type { Criteria, CvSummary } from "@/lib/domain/criteria";
import type { LlmProvider } from "@/lib/llm";
import { namesRole } from "@/lib/scoring/relevance";

// "Explorer d'autres métiers": from what the person likes and wants, the model suggests nearby jobs and
// how each leads to where they want to go; Scout then counts, by rules, the offers of each job online now
// and those open to a beginner. The count decides, never an impression. Nothing is invented: a job with
// no offer is shown with zero.

export type CareerIdea = { title: string; why: string; path: string; missions: string; open: number; junior: number };

const SYSTEM = `Tu es conseiller en orientation, spécialiste des métiers en France. À partir de ce qu'une personne aime, de ce qu'elle veut faire et de son profil, propose 6 à 8 métiers concrets qui lui correspondent, en priorité ceux qui recrutent des profils juniors et qui la rapprochent de son objectif. Inclus des métiers voisins qu'elle ne connaît peut-être pas. Pour chacun : "titre" (l'intitulé tel qu'il est écrit dans les offres d'emploi en France, sans « junior »), "pourquoi" (une phrase : ce qui, dans ce qu'elle a dit ou dans son profil, colle à ce métier), "chemin" (une phrase : en quoi ce métier la prépare à son objectif), "missions" (une phrase : ce qu'on y fait au quotidien). Tutoie la personne, sois concret, n'invente rien sur son parcours. Réponds uniquement avec {"metiers": [{"titre", "pourquoi", "chemin", "missions"}]}.`;

// The model's text without markdown ("*end-to-end*", "**SQL**"): the page shows plain sentences.
const plain = (v: unknown) => String(v ?? "").replace(/\*+|`/g, "").replace(/\s+/g, " ").trim();

const JUNIOR = /\b(junior|jr|associate|graduate|entry[- ]level|d[ée]butant|jeune dipl[oô]m)/i;

export async function exploreCareers(
  db: SupabaseClient,
  llm: LlmProvider,
  { text, criteria, cv }: { text: string; criteria: Criteria; cv: CvSummary | null },
): Promise<CareerIdea[]> {
  const profile = {
    metiers_vises: criteria.targetRoles,
    deja_dans_sa_recherche: [...criteria.titleVariants, ...criteria.bridgeRoles],
    secteurs_aimes: criteria.sectorsPriority,
    experience_annees: criteria.experienceYears ?? cv?.experienceYears ?? null,
    formation: cv?.education ?? [],
    postes_occupes: cv?.roles ?? [],
    competences: cv?.skills ?? [],
  };
  const read = (await llm.json({ system: SYSTEM, user: `Ce que la personne dit :\n${text}\n\nSon profil :\n${JSON.stringify(profile)}`, tier: "fast" })) as { metiers?: unknown };
  const ideas = (Array.isArray(read.metiers) ? read.metiers : [])
    .map((m) => m as Record<string, unknown>)
    .filter((m) => typeof m.titre === "string" && m.titre.trim())
    .map((m) => ({ title: String(m.titre).replace(/\s*\(.*?\)\s*/g, " ").replace(/\bjunior\b/gi, "").replace(/\s+/g, " ").trim(), why: plain(m.pourquoi), path: plain(m.chemin), missions: plain(m.missions) }))
    .filter((m, i, all) => m.title && all.findIndex((o) => o.title.toLowerCase() === m.title.toLowerCase()) === i)
    .slice(0, 8);
  if (ideas.length === 0) return [];

  // The offers online now, read once: titles and the experience they ask.
  const offers: { title: string; experience_level: string | null; experience_min_years: number | null }[] = [];
  for (let f = 0; ; f += 1000) {
    const { data } = await db.from("offers").select("title, experience_level, experience_min_years").is("archived_at", null).range(f, f + 999);
    offers.push(...((data ?? []) as typeof offers));
    if (!data || data.length < 1000) break;
  }
  const base = { ...criteria, targetRoles: [] as string[], titleVariants: [] as string[], bridgeRoles: [] as string[] };
  return ideas
    .map((idea) => {
      const role = { ...base, targetRoles: [idea.title] };
      const named = offers.filter((o) => namesRole(o.title, "", role));
      const junior = named.filter((o) => o.experience_level === "junior" || (o.experience_min_years !== null && o.experience_min_years <= 2) || JUNIOR.test(o.title)).length;
      return { ...idea, open: named.length, junior };
    })
    .sort((a, b) => b.junior - a.junior || b.open - a.open);
}
