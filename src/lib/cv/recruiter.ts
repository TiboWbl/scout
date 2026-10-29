import { ACTION_VERBS as ACTION_START, figuresIn, hasKeyword, strongLine } from "@/lib/cv/ats";
import type { LlmProvider } from "@/lib/llm";

// The recruiter's reading of a CV, for the role sought or one offer. Shared by the CV page and the
// demo. Every strength quotes the CV, every gap of an offer quotes the offer, and Scout drops what it
// cannot find: nothing is invented.

export const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ");
export const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim().length > 1).map((x) => x.trim()) : []);

// The role's keywords, asked once per set of roles and kept: the same CV always gets the same score.
export const KEYWORDS_SYSTEM = `Pour un métier visé, donne les 12 compétences, outils ou méthodes que les offres de ce métier demandent le plus souvent, en 1 ou 2 mots, sous leur forme la plus courante dans les offres (ex. « roadmap », « backlog », « discovery », « SQL », « A/B test », « Jira », « OKR »). Pas de qualités générales (communication, rigueur). Réponds uniquement avec {"mots_cles": [...]}.`;

// The recruiter's reading: what convinces, what is missing, how to tailor. Every strength quotes the CV,
// every gap of an offer quotes the offer, and Scout drops what it cannot find: nothing is invented.
const RECRUITER_SYSTEM = `Tu es recruteur. Tu lis un CV (données personnelles retirées) pour un poste cible, et tu dis franchement, sans flatter ni sévérité gratuite, comment il se présente. Réponds uniquement avec {"avis", "atouts", "manques", "personnaliser", "lignes"} :
- "avis" : un texte de 2 phrases au plus, ce qu'un recruteur retient de ce CV pour ce poste et si le profil serait convoqué en entretien. Juge au niveau du poste cible : un poste junior n'attend pas l'expérience d'un confirmé.
- "atouts" : 2 ou 3 objets {"point", "citation_cv"} : ce qui convaincrait un recruteur pour ce poste. "citation_cv" : un seul passage du CV qui le prouve à lui seul, recopié mot pour mot.
- "manques" : 0 à 3 objets {"point", "citation_poste"} : ce que le poste attend et que le CV ne montre pas. Ne cite jamais un manque si le CV en parle. "citation_poste" : s'il y a une offre, les mots de l'offre qui le demandent, recopiés mot pour mot ; sinon, le mot-clé exact de la liste « demandé par les offres du métier ».
- "personnaliser" : 2 ou 3 actions concrètes pour adapter ce CV à ce poste (quoi remonter, quel intitulé ou quels mots reprendre, quoi raccourcir), en une phrase chacune. N'invente rien sur la personne.
- "lignes" : jusqu'à 3 lignes de missions du CV (jamais la formation ni les compétences) qui gagneraient le plus à être réécrites pour ce poste, en objets {"ligne", "proposition", "pourquoi"}. "ligne" : recopiée mot pour mot. "proposition" : toujours la ligne réécrite, au même temps que le reste du CV, qui commence par un verbe d'action, garde tous les chiffres et mots-clés de la ligne d'origine, et ne dépasse pas 35 mots ; n'invente aucun chiffre, écris [chiffre] là où la personne doit mettre le sien. Ne propose jamais une ligne qui commence déjà par un verbe d'action et contient déjà un résultat chiffré. "pourquoi" : une phrase. Liste vide si tout est déjà bon.
Écris en français, en tutoyant la personne, sans tiret cadratin.`;

export type Recruiter = { target: string; avis: string; atouts: { point: string; citation: string }[]; manques: { point: string; citation: string | null }[]; conseils: string[] };
const quoted = (whole: string, part: unknown) => typeof part === "string" && part.trim().length >= 8 && fold(whole).includes(fold(part.trim().replace(/^[«"“]\s*|\s*[»"”]$/g, "")));
const objects = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => typeof x === "object" && x !== null) : []);

export type Suggestion = { ligne: string; proposition: string; pourquoi: string | null };

export async function readAsRecruiter(
  llm: LlmProvider,
  { text, redacted, roles, experienceYears, keywords, offer }: { text: string; redacted: string; roles: string; experienceYears: number | null; keywords: string[]; offer: { title: string; company: string; text: string } | null },
): Promise<{ recruiter: Recruiter; suggestions: Suggestion[] }> {
  // Shown as "Pour « … »": the role itself, not the list of its spellings.
  const target = offer ? `${offer.title}${offer.company ? ` chez ${offer.company}` : ""}` : roles.split(", ")[0];
  const level = experienceYears !== null ? `, ${experienceYears} an${experienceYears > 1 ? "s" : ""} d'expérience` : "";
  const brief = offer
    ? `Poste cible : l'offre ci-dessous.\n\nOFFRE : ${offer.title}${offer.company ? ` · ${offer.company}` : ""}\n${offer.text}`
    : `Poste cible : ${roles} (métier visé, pas d'offre précise)${level}.\nDemandé par les offres du métier : ${keywords.join(", ")}.`;
  const read = (await llm.json({ system: RECRUITER_SYSTEM, user: `${brief}\n\nCV :\n${redacted}`, tier: "fast" })) as Record<string, unknown>;
  const cv = fold(text);
  const missingKeyword = (k: unknown) => {
    const parts = typeof k === "string" ? k.split(/,| et /).map((x) => x.trim()).filter(Boolean) : [];
    return parts.length > 0 && parts.every((p) => keywords.some((w) => fold(w) === fold(p)) && !hasKeyword(cv, p));
  };
  const recruiter: Recruiter = {
    target,
    avis: (typeof read.avis === "string" ? read.avis : strings(read.avis).join(" ")).trim().slice(0, 600),
    // A strength counts only with its proof in the CV, a gap of an offer only with its words in the offer.
    atouts: objects(read.atouts)
      .filter((x) => typeof x.point === "string" && quoted(text, x.citation_cv))
      .map((x) => ({ point: String(x.point), citation: String(x.citation_cv).trim() }))
      .slice(0, 3),
    manques: objects(read.manques)
      // Without an offer, a gap must be one of the role's keywords, and really absent from the CV.
      .filter((x) => typeof x.point === "string" && (offer ? quoted(offer.text, x.citation_poste) : missingKeyword(x.citation_poste)))
      .map((x) => ({ point: String(x.point), citation: offer ? String(x.citation_poste).trim() : null }))
      .slice(0, 3),
    conseils: strings(read.personnaliser).map((c) => c.replace(/\*\*/g, "")).slice(0, 3),
  };
  // A rewrite counts only if its line is really in the CV, the line can gain something (a line that
  // already opens on a verb, shows a figure and stays short is left alone), and the rewrite loses
  // nothing the grid counts: the verb first, every figure, every market keyword, a short sentence.
  const kept = (line: string, proposal: string) => {
    if (proposal.split(/\s+/).length > 35 || !ACTION_START.test(fold(proposal).replace(/^[^a-z]+/, ""))) return false;
    const figures = figuresIn(line).map((f) => f.match(/\d+(?:[  .,]\d+)*/)?.[0] ?? f);
    if (!figures.every((f) => proposal.includes(f))) return false;
    return keywords.every((k) => !hasKeyword(fold(line), k) || hasKeyword(fold(proposal), k));
  };
  const suggestions = objects(read.lignes)
    .filter((x): x is { ligne: string; proposition: string; pourquoi?: unknown } => typeof x.ligne === "string" && typeof x.proposition === "string" && x.ligne.length > 15)
    .filter((x) => cv.includes(fold(x.ligne)) && !strongLine(x.ligne) && kept(x.ligne, x.proposition))
    .map((x) => ({ ligne: x.ligne, proposition: x.proposition, pourquoi: typeof x.pourquoi === "string" ? x.pourquoi : null }))
    .slice(0, 3);
  return { recruiter, suggestions };
}
