import { z } from "zod";
import type { Criteria, CvSummary } from "@/lib/domain/criteria";
import type { Level } from "@/lib/domain/offer";
import { detectExperienceYears } from "@/lib/domain/signals";
import { getLlm } from "@/lib/llm";
import { namesTargetRole } from "./relevance";

export type JudgeInput = {
  id: string;
  title: string;
  company: string;
  location: string;
  contract: string;
  experienceRequired: number | null;
  // What the posting says in words when it gives no number ("profil junior", "expérience significative").
  experienceLevel?: "junior" | "experienced" | null;
  description: string;
  // Only a search-engine excerpt could be read: nothing precise may be inferred from it.
  excerpt?: boolean;
  // One of the person's favourite companies.
  favorite?: boolean;
  // The title itself is close to a role sought or a bridge (false: read only because it is a favourite).
  titleMatch?: boolean;
};

// The company's activity is shown on all its offers: a sentence about one posting's country or market
// ("croissance marché Cambodge", written from "Cambodia Content Specialist") would be false on the others.
const PLACES = /\b(cambodge|turquie|thailande|indonesie|japon|chine|coree|inde|bresil|mexique|argentine|portugal|espagne|italie|allemagne|pays-bas|belgique|suisse|royaume-uni|angleterre|irlande|suede|norvege|danemark|finlande|pologne|grece|roumanie|ukraine|russie|maroc|algerie|tunisie|egypte|nigeria|kenya|afrique du sud|australie|canada|etats-unis|usa|vietnam|philippines|malaisie|singapour|emirats|arabie|qatar|israel|balkans|scandinavie|pays nordiques|nordics|golfe|amerique latine|asie|europe de l'est)\b|\bmarches? (?:de |du |des |d')?[a-z]+ (?:local|locaux)\b|\bmarche (?:turc|cambodgien|japonais|bresilien|indonesien|thai|allemand|espagnol|italien|britannique|americain|asiatique)\b/;
export const isCompanyWide = (activity: string) => !PLACES.test(activity.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, ""));

const foldAccents = (v: string) => v.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
// Titles announcing a junior-level role.
const JUNIOR = /\b(junior|jr|associate|graduate|entry[- ]level|debutant|jeune diplome)\b/;
const plural = (n: number) => (n > 1 ? "s" : "");

// Facts shown on a card must be in the posting itself. The detector's reading of the text wins; the
// model's reading counts only with its quote, found word for word in the posting and naming the years.
const squash = (v: string) => foldAccents(v).replace(/[’']/g, "'").replace(/\s+/g, " ").trim();

export function verifiedExperience(
  asked: string | null,
  required: number | null,
  description: string,
  quote: string | null = null,
): { label: string | null; years: number | null } {
  if (required !== null) return { label: required === 0 ? "Débutant accepté" : `${required} an${plural(required)} et plus`, years: required };
  const text = squash(description);
  if (quote && text.includes(squash(quote))) {
    const years = detectExperienceYears(quote);
    if (years !== null) return { label: years === 0 ? "Débutant accepté" : `${years} an${plural(years)} et plus`, years };
  }
  if (asked && !/\d/.test(asked) && /debutant|premiere experience|jeune diplome|junior|graduate|entry[- ]level|no experience|sans experience/.test(text)) return { label: asked, years: null };
  return { label: null, years: null };
}

// The contract type the model read, kept only if its quote is in the posting and names that contract.
const CONTRACT_WORDS: Record<string, RegExp> = {
  cdi: /\b(cdi|permanent|indetermin)/,
  cdd: /\b(cdd|fixed[- ]term|determin)/,
  stage: /\b(stage|stagiaire|intern(ship)?)\b/,
  alternance: /\b(alternan|apprenti|work[- ]study)/,
  freelance: /\b(freelance|independant|contractor)/,
};
export function verifiedContract(contract: string | null, quote: string | null, description: string): string | null {
  const c = contract?.toLowerCase().trim() ?? "";
  if (!quote || !CONTRACT_WORDS[c]) return null;
  return squash(description).includes(squash(quote)) && CONTRACT_WORDS[c].test(squash(quote)) ? c : null;
}

export function verifiedSalary(salary: string | null, description: string): string | null {
  if (!salary) return null;
  const text = description.replace(/[\s\u00a0\u202f]/g, "");
  const numbers = salary.replace(/[\s\u00a0\u202f]/g, "").match(/\d+/g);
  return numbers && numbers.every((n) => text.includes(n)) ? salary : null;
}

export type Skill = { name: string; kind: "outil" | "methode" | "savoir_etre" | "langue" };
const SKILL_KINDS = ["outil", "methode", "savoir_etre", "langue"] as const;

// Skills kept only if each of their words is in the posting: never a skill the model imagined.
export function checkedSkills(list: { nom: string; type?: string | null }[], description: string): Skill[] {
  const text = foldAccents(description);
  const out: Skill[] = [];
  for (const s of list) {
    const name = plain(s.nom).replace(/\s+/g, " ").trim();
    const words = foldAccents(name).split(/[^a-z0-9+#]+/).filter((w) => w.length >= 2);
    if (!name || name.length > 40 || words.length === 0 || !words.every((w) => text.includes(w))) continue;
    const kind = SKILL_KINDS.find((k) => fold(s.type ?? "").startsWith(k.slice(0, 5))) ?? "methode";
    if (!out.some((o) => foldAccents(o.name) === foldAccents(name))) out.push({ name, kind });
  }
  return out.slice(0, 6);
}

export type Judgement = {
  level: Level;
  missions: string[];
  salary: string | null;
  experience_asked: string | null;
  // Years asked, when verified in the posting: the engine applies the experience gate with it.
  experience_years: number | null;
  // Contract type read by the model with a verified quote: the engine applies the contract gate with it.
  contract_found: string | null;
  // What the company makes or sells, from the posting: stored on the company, shown in the offer detail.
  company_product: string | null;
  // What the posting asks for, each checked in its text: stored on the offer (Mon CV sums them up).
  skills: Skill[] | null;
  // The level the responsibilities describe, when the posting gives no experience: an estimate.
  seniority: "junior" | "confirme" | "senior" | null;
  score_interet: number;
  score_chances: number;
  score_tremplin: number;
  why: string;
  strengths: string[];
  watch: string[];
  cv_levers: string[];
  excluded_reason: string | null;
};

// The model answers factual questions about each offer; the level is derived by a fixed rule
// (deriveLevel), so it stays consistent and explainable even with a small model.
const fold = (v: string) => v.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[\s-]+/g, "_").trim();
const oneOf = <T extends string>(values: readonly T[], fallback: T) =>
  z.string().transform((v) => values.find((x) => fold(v).startsWith(x)) ?? fallback);
const MATCHES = ["metier_vise", "passerelle", "autre"] as const;
const SECTORS = ["prioritaire", "accepte", "a_eviter", "autre"] as const;
type Match = (typeof MATCHES)[number];
type Sector = (typeof SECTORS)[number];

const Score = z.coerce.number().min(0).max(100);
// Plain text only: the cards render text, and models like to add **bold**.
const plain = (v: string) => v.replace(/\*\*|__|`/g, "").replace(/^\s*[-*•]\s+/, "").trim();
const List = z.array(z.string()).nullish().transform((v) => (v ?? []).map(plain).filter(Boolean));
const Text = z.string().nullish().transform((v) => (v && v.trim() && !/^(null|aucun|non|none)$/i.test(v.trim()) ? v.trim() : null));
const Item = z.object({
  id: z.union([z.string(), z.number()]).transform((v) => String(v).trim()),
  correspondance: oneOf(MATCHES, "autre"),
  secteur: oneOf(SECTORS, "autre"),
  piege: Text,
  deal_breaker: Text,
  deal_breaker_concerne: Text,
  citation_deal_breaker: Text,
  secteur_evite_concerne: Text,
  citation_secteur: Text,
  score_interet: Score,
  score_chances: Score,
  score_tremplin: Score,
  // Null for an offer with nothing that fits (it is set aside with "en_bref" as its reason).
  pourquoi: Text,
  reserve: Text,
  missions: List,
  salaire: Text,
  experience_demandee: Text,
  citation_experience: Text,
  contrat: Text,
  citation_contrat: Text,
  en_bref: Text,
  activite_entreprise: Text,
  competences: z
    .array(z.object({ nom: z.string(), type: z.string().nullish() }).passthrough())
    .nullish()
    .transform((v) => v ?? []),
  points_forts: List,
  secteur_prioritaire_concerne: Text,
  niveau_missions: Text,
  points_d_attention: List,
  leviers_cv: List,
});
type Item = z.infer<typeof Item>;

// `favorite`: a company the person picked. `reach`: the offer is open to their level (junior, beginners
// accepted, or no more years asked than they have): where their chances are best.
export type Facts = { match: Match; sector: Sector; trap: string | null; dealBreaker: string | null; chances: number; favorite?: boolean; reach?: boolean };

// A sector to avoid or a deal-breaker excludes an offer only if the model names which of the person's
// own items it is: "fintech is not sport" is not a reason they gave.
export function namedItem(cited: string | null, items: string[]): boolean {
  const c = fold(cited ?? "");
  if (c.length < 3) return false;
  return items.some((i) => {
    const f = fold(i);
    return f.length >= 3 && (f === c || f.includes(c) || c.includes(f));
  });
}

// The posting's sentence must name what the person's item is about: "jeu vidéo" needs "jeu" or "vidéo",
// "Produit non digital (collection textile, retail)" needs "collection", "textile" or "retail".
const GENERIC_WORDS = new Set(["produit", "produits", "digital", "digitaux", "numerique", "secteur", "secteurs", "poste", "postes", "non", "sans", "pas", "orientation", "et", "de", "des", "du", "la", "le", "les", "en", "ou", "paris", "equipe", "equipes", "structure", "structurees"]);
export function proves(item: string, quote: string | null): boolean {
  if (!quote) return false;
  const words = fold(item).split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !GENERIC_WORDS.has(w));
  const q = fold(quote).replace(/_/g, " ");
  return words.some((w) => q.includes(w.replace(/s$/, "")));
}
// "Postes sans orientation discovery": an absence no sentence can prove. It lowers interest, never excludes.
const NEGATIVE = /\b(sans|pas de|non|aucun)\b/;

// Constraints are gates, not averages: any one of them sets the level on its own.
export function deriveLevel(f: Facts, criteria: Criteria): { level: Level; reason: string | null } {
  if (f.dealBreaker) return { level: "ecartee", reason: f.dealBreaker };
  if (f.sector === "a_eviter") return { level: "ecartee", reason: "Secteur que tu as choisi d'éviter." };
  if (f.trap) return f.match === "passerelle" ? { level: "tremplin", reason: null } : { level: "ecartee", reason: f.trap };
  if (f.match === "autre") return { level: "ecartee", reason: null };
  if (f.match === "passerelle") return { level: "tremplin", reason: null };
  if (f.sector === "autre" && !criteria.otherSectors.open && !f.favorite) return { level: "ecartee", reason: "Hors des secteurs que tu vises." };
  // A crush: the role sought, with real chances, in a preferred sector, at a favourite company, or
  // open to the person's level.
  return { level: f.chances >= 50 && (f.sector === "prioritaire" || f.favorite || f.reach) ? "coeur" : "solide", reason: null };
}

// Some models answer on a 0-10 scale despite the instruction; a relevant offer reveals it.
function to100(item: Item, level: Level) {
  const scores = [item.score_interet, item.score_chances, item.score_tremplin];
  const factor = level !== "ecartee" && scores.every((n) => n <= 10) ? 10 : 1;
  const [interet, chances, tremplin] = scores.map((n) => Math.min(100, Math.round(n * factor)));
  // A bridge is by definition not the role sought: it never outranks it on interest.
  const cap = level === "ecartee" ? 30 : level === "tremplin" ? 55 : 100;
  return [Math.min(interet, cap), chances, tremplin];
}

const SYSTEM = `Tu es le moteur de tri de Scout, un outil qui aide une personne à décrocher un emploi.
Pour chaque offre, juge le POSTE RÉEL décrit par les missions, pas l'intitulé. Lis d'abord la partie « profil recherché / qualifications / requirements ».

Réponds à ces questions pour chaque offre :
- "correspondance" : les missions réelles sont-elles celles d'un des métiers visés ou de leurs variantes ("metier_vise"), d'un métier passerelle du profil ou de la même famille, ou d'un poste au contact du produit et des utilisateurs dans un secteur prioritaire ("passerelle"), ou d'autre chose ("autre") ? Un intitulé présent dans les listes du profil, avec les missions habituelles de ce métier, n'est jamais "autre", même si le poste est très opérationnel ou demande plus d'expérience. Le domaine du produit (cloud, sécurité, IA, finance…) ne change pas le métier : il joue seulement sur "secteur" et score_interet.
- "secteur" : le secteur de l'entreprise est-il "prioritaire", "accepte", "a_eviter" ou "autre" pour la personne ? "a_eviter" seulement s'il correspond à un élément de secteurs_a_eviter : recopie cet élément mot pour mot dans "secteur_evite_concerne", et dans "citation_secteur" la phrase exacte de l'offre qui le montre. Un secteur simplement absent des secteurs prioritaires est "autre", jamais "a_eviter". Le secteur est celui du produit ou du service de l'entreprise qui recrute, jamais celui de ses clients : un cabinet de conseil, une ESN, une agence ou un cabinet de recrutement relèvent du conseil ou du service, même s'ils ont des clients dans la santé ou le sport. "prioritaire" seulement si l'entreprise elle-même est dans un des secteurs_prioritaires : recopie cet élément mot pour mot dans "secteur_prioritaire_concerne".
- "piege" : une phrase de 12 mots maximum si l'intitulé est trompeur (missions sans rapport avec le titre, poste commercial déguisé, métier d'un autre domaine sous un intitulé familier), sinon null. Le secteur, le type de clients (B2B, B2C), la technologie (IA, data, crypto) ou le niveau technique ne sont jamais un piège : un Product Manager B2B ou IA reste un Product Manager.
- "deal_breaker" : une phrase de 12 mots maximum si l'offre heurte clairement un deal-breaker du profil, sinon null ; recopie ce deal-breaker mot pour mot dans "deal_breaker_concerne", et dans "citation_deal_breaker" la phrase exacte de l'offre qui le prouve. Sans phrase de l'offre qui le prouve, ce n'est pas un deal-breaker. Un secteur non prioritaire n'est jamais un deal-breaker.

Scores, entiers de 0 à 100 (jamais sur 10) :
- score_interet : alignement avec ce que la personne cherche (missions, secteur). Bas si "autre" ou piège. Plus haut si l'entreprise fait partie de ses entreprises favorites. Tiens compte de ses retours : rapproche-toi des offres qu'elle a appréciées, éloigne-toi de celles qu'elle a écartées et de leurs raisons.
- score_chances : expérience demandée vs réelle, compétences requises vs CV, langues. Chaque année demandée au-delà de l'expérience de la personne baisse ce score. L'expérience ne change jamais la correspondance.
- score_tremplin : valeur comme étape de carrière (apprentissage, encadrement, passerelle).

Si "extrait_seulement" est vrai, tu n'as qu'un extrait de l'offre : remplis "missions", "salaire" et "experience_demandee" seulement avec ce qui y est écrit, sinon [] ou null, et commence "points_d_attention" par « Extrait seulement : lis l'offre complète ».

Rédige en français, en texte brut sans Markdown (pas d'astérisques), tutoiement, ton bienveillant et factuel.
- "pourquoi" : une phrase concrète de 25 mots maximum qui dit ce qui fait correspondre cette offre à la recherche de la personne : le métier réel et ses missions, le secteur, le niveau d'expérience demandé face au sien, l'entreprise si elle fait partie de ses favorites. Uniquement ce qui correspond, aucune réserve ici. Sans répéter l'intitulé ni le nom de l'entreprise. Ex. « PM d'une app santé grand public, ouvert aux profils juniors : discovery et roadmap comme chez ton dernier poste. »
- "reserve" : la principale réserve en 12 mots maximum, concrète, hors expérience demandée (Scout la calcule lui-même) : secteur, type de poste, contexte (ex. « Secteur bancaire, hors de tes priorités », « Poste en conseil, chez des clients »). null s'il n'y en a pas : jamais une phrase qui dit que tout va bien.
- "missions" : les 2 ou 3 missions principales du poste, 8 mots maximum chacune (ex. « Piloter la roadmap de l'app patient »).
- "salaire" : le salaire tel qu'il est écrit dans l'offre (ex. « 45-55 k€ brut annuel »), sinon null. N'estime jamais.
- "experience_demandee" : l'expérience minimale demandée, lue partout dans l'offre (profil recherché, must-haves, requirements, qualifications…), en 5 mots maximum (ex. « 3 ans et plus », « Première expérience acceptée »), sinon null.
- "citation_experience" : la phrase exacte de l'offre, recopiée mot pour mot, qui indique cette expérience (ex. « 3+ years in product management »), sinon null.
- "contrat" : le type de contrat proposé par l'offre, "cdi", "cdd", "stage", "alternance" ou "freelance", sinon null ; "citation_contrat" : la phrase exacte de l'offre qui l'indique, sinon null.
- "activite_entreprise" : ce que l'entreprise fait concrètement, d'après l'offre : son produit ou service et pour qui, en 20 mots maximum (ex. « Application de suivi de rééducation pour les kinésithérapeutes et leurs patients »). L'entreprise dans son ensemble, jamais ce poste : pas de pays, de ville, de marché, d'équipe ni de projet propre à l'offre (il s'affiche sur toutes ses offres). Jamais de slogan, de promesse ni de valeurs ; null si l'offre ne le dit pas.
- "competences" : 3 à 6 compétences demandées par l'offre, chacune en 1 à 3 mots recopiés de l'offre, avec "type" : "outil" (logiciel, langage), "methode" (méthode, pratique, domaine de savoir-faire), "savoir_etre" (qualité humaine) ou "langue". Rien qui ne soit écrit dans l'offre.
- "en_bref" : la raison principale en 12 mots maximum (ex. « Poste commercial, pas de produit » ou « Produit digital santé, équipe structurée »).
- "points_d_attention" contient le piège s'il y en a un : 0 à 2 éléments de 10 mots maximum.
- "niveau_missions" : d'après les responsabilités décrites (autonomie, encadrement, périmètre, interlocuteurs), le poste est-il "junior", "confirme" ou "senior" ? Juge sur les missions, pas sur l'intitulé.
Réponds uniquement avec {"resultats": [{"id", "correspondance", "secteur", "secteur_evite_concerne", "citation_secteur", "piege", "deal_breaker", "deal_breaker_concerne", "citation_deal_breaker", "missions", "salaire", "experience_demandee", "citation_experience", "contrat", "citation_contrat", "en_bref", "activite_entreprise", "competences", "score_interet", "score_chances", "score_tremplin", "pourquoi", "reserve", "points_d_attention", "secteur_prioritaire_concerne", "niveau_missions"}]} avec un élément par offre reçue, dans le même ordre.`;

const REQUIREMENTS_HEADER = /^(.{0,40})(profil recherch|ce que nous recherchons|qualifications?|requirements|what we('re| are) looking for|about you|your profile|who you are|you (have|are)|must[- ]have|tu es|vous [eê]tes|comp[ée]tences requises)/im;

// Keeps the requirements section intact even in long descriptions, since chances hinge on it.
export function focusedExcerpt(description: string, max = 3200): string {
  if (description.length <= max) return description;
  const match = REQUIREMENTS_HEADER.exec(description);
  if (!match) return description.slice(0, max);
  const reqStart = match.index;
  const requirements = description.slice(reqStart, reqStart + 1900);
  return `${description.slice(0, max - requirements.length - 20)}\n[…]\n${requirements}`;
}

export function profileBrief(criteria: Criteria, cv: CvSummary | null, experienceYears: number | null, favorites: string[] = [], feedback: Feedback = { liked: [], disliked: [] }) {
  return JSON.stringify({
    metiers_vises: criteria.targetRoles,
    variantes: criteria.titleVariants.slice(0, 12),
    passerelles: criteria.bridgeRoles,
    secteurs_prioritaires: criteria.sectorsPriority,
    secteurs_acceptes: criteria.sectorsOk,
    secteurs_a_eviter: criteria.sectorsAvoid,
    autres_secteurs: criteria.otherSectors.open ? (criteria.otherSectors.condition ?? "acceptés") : "refusés",
    contrats: criteria.contracts,
    // A V.I.E. is abroad by definition: its country must never count against it.
    ...(criteria.contracts.includes("vie")
      ? {
          vie: "La personne cherche aussi un V.I.E. Un V.I.E. se déroule à l'étranger : son pays n'est jamais un défaut. Un V.I.E. dans un autre métier que ceux visés n'est retenu (Tremplin) que s'il remplit deux conditions : la personne a de vrais arguments pour être prise (une expérience, une compétence ou une formation de son profil que le poste demande), et le poste la rapproche des métiers visés (compétences, secteur ou responsabilités qu'elle pourra faire valoir ensuite). Dans « pourquoi », donne ces deux arguments, concrètement. Sa formation compte comme un argument (un diplôme d'ingénieur rend crédible un V.I.E. d'ingénieur généraliste, de projet ou technico-commercial). Un V.I.E. sans aucun lien avec son expérience, ses compétences ni sa formation est écarté.",
        }
      : {}),
    experience_annees: experienceYears,
    langues: criteria.languages,
    deal_breakers: criteria.dealBreakers,
    entreprises_favorites: favorites,
    ...(feedback.liked.length ? { offres_appreciees: feedback.liked } : {}),
    ...(feedback.disliked.length ? { offres_ecartees_par_la_personne: feedback.disliked } : {}),
    cv: cv ? { postes: cv.roles, competences: cv.skills, formation: cv.education, realisations: cv.highlights } : null,
  });
}

// What the person told Scout about earlier offers: kept, applied to, or set aside with a reason.
export type Feedback = { liked: string[]; disliked: string[] };

export async function judgeBatch(
  offers: JudgeInput[],
  criteria: Criteria,
  cv: CvSummary | null,
  experienceYears: number | null,
  favorites: string[] = [],
  feedback: Feedback = { liked: [], disliked: [] },
): Promise<Map<string, Judgement>> {
  const llm = getLlm();

  const shortIds = new Map(offers.map((o, i) => [`o${i + 1}`, o.id]));
  const user = `Profil :\n${profileBrief(criteria, cv, experienceYears, favorites, feedback)}\n\nOffres :\n${offers
    .map((o, i) =>
      JSON.stringify({
        id: `o${i + 1}`,
        intitule: o.title,
        entreprise: o.company,
        lieu: o.location,
        contrat: o.contract,
        experience_demandee_detectee: o.experienceRequired,
        ...(o.experienceLevel ? { niveau_experience_ecrit: o.experienceLevel === "junior" ? "profil junior accepté" : "expérience significative demandée" } : {}),
        ...(o.excerpt ? { extrait_seulement: true } : {}),
        description: focusedExcerpt(o.description),
      }),
    )
    .join("\n")}`;

  const raw = await llm.json({ system: SYSTEM, user, tier: "fast" });
  const items = (raw as { resultats?: unknown })?.resultats;
  const results = new Map<string, Judgement>();
  if (!Array.isArray(items)) return results;
  // One malformed offer must not cost the whole batch.
  items.forEach((entry, index) => {
    const parsed = Item.safeParse(entry);
    if (!parsed.success) {
      if (process.env.SCOUT_DEBUG_JUDGE) console.error("judge item rejected:", parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
      return;
    }
    const item = parsed.data;
    // Models sometimes echo "1" or "O1" instead of "o1"; the answer order matches the input order.
    const id = shortIds.get(item.id) ?? shortIds.get(`o${item.id.replace(/^o/i, "")}`) ?? (items.length === offers.length ? offers[index].id : undefined);
    if (!id) return;
    const input = offers.find((o) => o.id === id)!;
    const experience = verifiedExperience(item.experience_demandee, input.experienceRequired, input.description, item.citation_experience);
    // A title that names the role sought, with no trap, is that role: the model sometimes files it as a bridge.
    // Exclusions need both the person's own item and the posting's words proving it.
    const quoted = (q: string | null) => Boolean(q && q.trim().length >= 8 && squash(input.description).includes(squash(q)));
    const avoided = criteria.sectorsAvoid.find((x) => namedItem(item.secteur_evite_concerne, [x]));
    const sectorRead = item.secteur === "a_eviter" && !(avoided && quoted(item.citation_secteur) && proves(avoided, item.citation_secteur)) ? "autre" : item.secteur;
    // A preferred sector must be one of the person's, and the company's own business: a consulting firm
    // or an agency with clients in health is not a health company.
    const consulting = /cabinet|conseil|consulting|\besn\b|ssii|agence|recrutement|staffing|freelances?\b/i.test(item.activite_entreprise ?? "") && !criteria.sectorsPriority.some((p) => /conseil|consulting|agence/i.test(p));
    const sector = sectorRead === "prioritaire" && (consulting || !namedItem(item.secteur_prioritaire_concerne, criteria.sectorsPriority)) ? "autre" : sectorRead;
    const seniority = (["junior", "confirme", "senior"] as const).find((l) => fold(item.niveau_missions ?? "").startsWith(l.slice(0, 5))) ?? null;
    // A "trap" that only talks about the sector is a sector opinion, not a misleading title: kept as a note.
    const trap = item.piege && !/\b(secteurs?|prioritaires?|sant[eé]|sport)\b/i.test(item.piege) ? item.piege : null;
    // A title naming the role sought is that role. A role read only because the company is a favourite
    // is a bridge only in a preferred sector (close to the product and its users there).
    const match =
      item.correspondance === "passerelle" && !trap && namesTargetRole(input.title, criteria)
        ? "metier_vise"
        : item.correspondance === "passerelle" && input.titleMatch === false && sector !== "prioritaire"
          ? "autre"
          : // Only a search-engine excerpt: too little to rule out an offer whose title is the role sought.
            item.correspondance === "autre" && input.excerpt && !trap && namesTargetRole(input.title, criteria)
            ? "metier_vise"
            : item.correspondance;
    const asked = input.experienceRequired ?? experience.years;
    const reach =
      (asked !== null && asked <= (experienceYears ?? 0)) ||
      input.experienceLevel === "junior" ||
      (asked === null && !input.experienceLevel && seniority === "junior") ||
      JUNIOR.test(foldAccents(input.title)) ||
      (asked === null && input.experienceLevel !== "experienced" && experience.label !== null && !/\d/.test(experience.label));
    const breaker = criteria.dealBreakers.find((x) => namedItem(item.deal_breaker_concerne, [x]));
    const dealBreaker =
      item.deal_breaker && breaker && quoted(item.citation_deal_breaker) && !NEGATIVE.test(fold(breaker).replace(/_/g, " ")) && proves(breaker, item.citation_deal_breaker)
        ? item.deal_breaker
        : null;
    const facts: Facts = { match, sector, trap, dealBreaker, chances: item.score_chances, favorite: input.favorite, reach };
    const { level, reason } = deriveLevel(facts, criteria);
    const [interet, chances, tremplin] = to100(item, level);
    // A deal-breaker the posting does not prove stays visible as something to check.
    const unproven = item.deal_breaker && !dealBreaker ? [`À vérifier : ${item.deal_breaker}`] : [];
    // The main reservation leads the points to check; "pourquoi" says only what fits, so it never
    // contradicts the level.
    // The experience gap is computed, never written by the model: "3 ans demandés, 2 de plus que toi".
    const years = (n: number) => `${n} an${n > 1 ? "s" : ""}`;
    const gap = asked !== null && experienceYears !== null ? asked - experienceYears : null;
    const experienceNote =
      gap !== null && gap > 0
        ? `${years(asked!)} demandé${asked! > 1 ? "s" : ""}, ${gap} de plus que toi`
        : asked === null && input.experienceLevel === "experienced"
          ? "Expérience significative demandée"
          : asked === null && !input.experienceLevel && seniority && seniority !== "junior"
            ? `Expérience non précisée, missions de niveau ${seniority === "senior" ? "senior" : "confirmé"}`
            : null;
    // A "reservation" that says all is well, or speaks of experience (computed above), is dropped.
    const modelNote = item.reserve && !/align|correspond|coherent|adapte|ok\b|exp[ée]rience|\bans?\b|years?/i.test(item.reserve) ? plain(item.reserve) : null;
    const reservation = experienceNote ?? modelNote;
    const watch = [
      ...(item.piege && !item.points_d_attention.includes(item.piege) ? [item.piege] : []),
      ...unproven,
      ...(reservation && !item.points_d_attention.includes(reservation) ? [reservation] : []),
      ...(experienceNote && modelNote ? [modelNote] : []),
      // Years written by the model could contradict the computed gap: Scout's own reading speaks for them.
      // Experience is Scout's own reading (above): the model's words on it could guess or contradict.
      ...item.points_d_attention.filter((p) => !/exp[ée]rience|\d+\s*(ans?|years?)\b|seniorit|niveau/i.test(p)),
    ];
    results.set(id, {
      level,
      missions: item.missions.slice(0, 3),
      salary: verifiedSalary(item.salaire, input.description),
      experience_asked: experience.label,
      experience_years: experience.years,
      contract_found: verifiedContract(item.contrat, item.citation_contrat, input.description),
      company_product: item.activite_entreprise && !input.excerpt && isCompanyWide(item.activite_entreprise) ? plain(item.activite_entreprise).slice(0, 200) : null,
      skills: input.excerpt ? null : checkedSkills(item.competences, input.description),
      seniority: input.excerpt ? null : seniority,
      score_interet: interet,
      score_chances: chances,
      score_tremplin: tremplin,
      why: item.pourquoi ? plain(item.pourquoi) : item.en_bref ? plain(item.en_bref) : "",
      // Read when the offer is opened (/api/offers/[id]/details): the sorting pass stays short.
      strengths: [],
      watch: watch.slice(0, 3),
      cv_levers: [],
      excluded_reason: level === "ecartee" ? (reason ?? (item.en_bref ? plain(item.en_bref) : item.pourquoi ? plain(item.pourquoi) : "Ne correspond pas à ta recherche.")) : null,
    });
  });
  return results;
}

// Ranking weight between the three scores, driven by the openness slider.
export function rank(s: { score_interet: number | null; score_chances: number | null; score_tremplin: number | null }, openness: number) {
  const t = openness / 100;
  const wi = 0.7 - 0.4 * t;
  const wc = 0.2 + 0.25 * t;
  const wt = 0.1 + 0.15 * t;
  return wi * (s.score_interet ?? 0) + wc * (s.score_chances ?? 0) + wt * (s.score_tremplin ?? 0);
}
