import type { Criteria } from "@/lib/domain/criteria";

// Cheap lexical pre-sort before the LLM, to decide in which order offers get scored within the
// rate limit. Not an exact-keyword gate: partial title overlap and description mentions count.

const STOP = new Set(["de", "du", "des", "la", "le", "les", "et", "en", "a", "the", "of", "and", "for", "h", "f", "x", "m", "w"]);

// Abbreviations and their spelled-out forms are the same words for the pre-sort.
const SYNONYMS: [RegExp, string][] = [
  [/\bquality assurance\b/g, "qa"],
  [/\bproduct owner\b/g, "product owner po"],
  [/\bproduct manager\b/g, "product manager pm"],
  [/\buser experience\b/g, "ux"],
  [/\buser interface\b/g, "ui"],
];

// Set phrases naming another job than their words: a "Business Developer" sells, it does not code.
// Read as one word, they never half-match a developer's search, and still match a salesperson's.
const SET_PHRASES: [RegExp, string][] = [[/\b(business develop(?:er|ment)|developpeur (?:commercial|d.affaires))\b/g, "bizdev"]];

function tokens(s: string): string[] {
  let text = s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  for (const [re, one] of SET_PHRASES) text = text.replace(re, one);
  for (const [re, add] of SYNONYMS) text = text.replace(re, (m) => `${m} ${add}`);
  return text
    .split(/[^a-z0-9+#]+/)
    .filter((t) => t.length >= 2 && !STOP.has(t));
}

// Words shared by countless job titles; a match on them alone says nothing about the role.
const GENERIC = new Set([
  "manager", "junior", "senior", "associate", "lead", "chef", "responsable", "head", "officer", "specialist", "specialiste",
  "charge", "chargee", "consultant", "assistant", "assistante", "director", "directeur", "directrice", "intern", "stagiaire",
  "alternant", "alternante", "confirme", "confirmee", "jr", "sr", "ii", "iii", "i",
]);

function phraseScore(phrase: string, titleTokens: Set<string>, text: string): { title: number; body: number } {
  const all = tokens(phrase);
  if (all.length === 0) return { title: 0, body: 0 };
  const distinctive = all.filter((t) => !GENERIC.has(t));
  const ptoks = distinctive.length > 0 ? distinctive : all;
  const inTitle = ptoks.filter((t) => titleTokens.has(t)).length / ptoks.length;
  const body = text.includes(all.join(" ")) ? 1 : 0;
  // "Product" alone in "FP&A Business Partner – Tech & Product" is weaker than the full "Product Manager".
  const genericMissing = all.some((t) => GENERIC.has(t) && !titleTokens.has(t));
  const full = genericMissing ? 0.75 : 1;
  return { title: inTitle >= 0.99 ? full : inTitle >= 0.5 ? 0.5 : 0, body };
}

export function relevance(title: string, description: string, criteria: Criteria): number {
  const titleTokens = new Set(tokens(title));
  const text = tokens(`${title} ${description}`).join(" ");
  let score = 0;

  const best = (phrases: string[], titleWeight: number, bodyWeight: number) => {
    let top = 0;
    for (const p of phrases) {
      const s = phraseScore(p, titleTokens, text);
      top = Math.max(top, s.title * titleWeight + s.body * bodyWeight);
    }
    return top;
  };

  score += best([...criteria.targetRoles, ...criteria.titleVariants], 10, 3);
  score += best(criteria.bridgeRoles, 6, 2);
  score += best([...criteria.sectorsPriority, ...criteria.sectorsOk], 0, 1.5);
  return score;
}

// Title-only match against the roles sought and bridges. Deciding which offers reach the LLM on the
// description would send nearly everything: "work closely with product managers" is everywhere.
// "QA avec évolution vers le produit" is searched as "QA": qualifiers never appear in job titles.
// The job a criteria title names, without what qualifies it: "Customer Success Manager - Produits SaaS",
// "Product Owner orienté discovery" and "Business Analyst (tech)" name a Customer Success Manager, a Product
// Owner and a Business Analyst. The qualifier still reaches the judge, which reads the whole phrase.
export const core = (phrase: string) => phrase.split(/\s[-–—|:/]\s|,|\s+(?:orient[ée]e?s?|avec|en|pour|vers|dans|with|towards|chez|sur)\s/i)[0].replace(/\s*\(.*$/, "").trim();

export function titleRelevance(title: string, criteria: Criteria): number {
  const titleTokens = new Set(tokens(title));
  let top = 0;
  for (const p of [...criteria.targetRoles, ...criteria.titleVariants]) top = Math.max(top, phraseScore(core(p), titleTokens, "").title * 10);
  for (const p of criteria.bridgeRoles) top = Math.max(top, phraseScore(core(p), titleTokens, "").title * 6);
  return top;
}

// The title names a role sought word for word ("Healthcare Product Manager Junior" names "Product
// Manager"). Multi-word phrases only: acronyms like "PM" or "PO" are too ambiguous to settle it.
export function namesTargetRole(title: string, criteria: Criteria): boolean {
  const t = ` ${tokens(title).join(" ")} `;
  return [...criteria.targetRoles, ...criteria.titleVariants].some((p) => {
    const words = tokens(core(p));
    return words.length >= 2 && t.includes(` ${words.join(" ")} `);
  });
}

// The model sometimes fills a gap by guessing: "Monteur.euse Cycle" (bikes) justified as "Monteur vidéo".
// The words of the roles sought that its reason uses must be in the offer itself (title or text); the
// ones it brings from the search alone are an invention.
const plain = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").split(/[^a-z0-9+#]+/).filter((t) => t.length >= 4 && !STOP.has(t));
export function inventedRoleWords(why: string, title: string, description: string, criteria: Criteria): string[] {
  const inTitle = new Set(plain(title));
  const offer = new Set(plain(`${title} ${description}`));
  const reason = ` ${plain(why).join(" ")} `;
  const invented = new Set<string>();
  // Only when the reason names a role sought in full ("Monteur vidéo") while the title names it in part
  // ("Monteur") and the offer never writes the rest: a single common word ("contenu") proves nothing.
  for (const p of [...criteria.targetRoles, ...criteria.titleVariants, ...criteria.bridgeRoles]) {
    const words = plain(core(p));
    const distinctive = words.filter((t) => !GENERIC.has(t));
    if (words.length < 2 || !reason.includes(` ${words.join(" ")} `)) continue;
    if (!distinctive.some((t) => inTitle.has(t))) continue;
    for (const t of distinctive) if (!offer.has(t)) invented.add(t);
  }
  return [...invented];
}

// The role sought, named in full by the title, or in part with the rest written in the offer ("Chef de
// projet" whose text says "digital" for "Chef de projet digital"). A part only counts when the title says
// nothing else: "Product Designer" names another job than "Motion Designer", whatever its text says, and
// so does "Chef de projet travaux". A role reduced to one distinctive word ("Spécialiste vidéo") is
// named in full only: "Sales Engineer - Video Protection" is not one. Roles sought and equivalents only.
const NEUTRAL = new Set([
  ...GENERIC, "stage", "stagiaire", "alternance", "alternant", "alternante", "apprenti", "apprentie", "apprentissage", "internship",
  "cdi", "cdd", "freelance", "interim", "mois", "months", "hf", "fh", "nb", "remote", "hybride", "hybrid", "teletravail",
])
export function namesRole(title: string, description: string, criteria: Criteria): boolean {
  const inTitle = new Set(tokens(title));
  const text = new Set(tokens(`${title} ${description}`));
  // Title parts: "Monteur vidéo - Paris", "Stage 2 mois - Assistant création de contenu".
  // An abbreviation ("PM", "PO") counts spelled out ("Product Owner") or written in capitals, never as a
  // time of day ("22h PM").
  const acronym = (a: string) => {
    const word = new RegExp(`\\b${a}\\b`, "i");
    if (inTitle.has(a.toLowerCase()) && !word.test(title)) return true;
    return new RegExp(`\\b${a.toUpperCase()}\\b`).test(title.replace(/\b\d{1,2}\s?h\s?\d{0,2}\s+(AM|PM)\b/gi, " "));
  };
  const parts = title.split(/\s[-–—|:]\s|[(,|]/).map((part) => tokens(part));
  for (const p of [...criteria.targetRoles, ...criteria.titleVariants]) {
    const all = tokens(core(p));
    const distinctive = all.filter((t) => !GENERIC.has(t));
    const words = distinctive.length > 0 ? distinctive : all;
    if (words.length === 0) continue;
    if (/^[A-Z]{2,4}$/.test(core(p).trim())) {
      if (acronym(core(p).trim())) return true;
      continue;
    }
    const share = words.filter((t) => inTitle.has(t)).length / words.length;
    if (share >= 0.99 && (words.length >= 2 || all.every((t) => inTitle.has(t)))) return true;
    if (share < 0.5 || share >= 0.99 || !words.every((t) => text.has(t))) continue;
    const own = new Set(all);
    if (parts.some((part) => part.some((t) => own.has(t)) && part.every((t) => own.has(t) || NEUTRAL.has(t) || /^\d+$/.test(t)))) return true;
  }
  return false;
}

// A training course or a school programme is not a job offer ("Formation Monteur audiovisuel").
export const isTraining = (title: string) => /^\s*(formation|bootcamp|programme de formation|cursus)\b|\bformation (certifiante|qualifiante|diplomante|diplômante)\b/i.test(title);
