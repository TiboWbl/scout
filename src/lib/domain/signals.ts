import type { Contract } from "./criteria";

function norm(s: string) {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

// Order matters: an internship mentioning "CDI possible à l'issue" is still an internship.
const CONTRACT_PATTERNS: [RegExp, Contract][] = [
  [/\b(stage|stagiaire|internship|intern)\b/, "stage"],
  [/\b(alternance|alternant|apprenti|apprentissage|apprenticeship|work[- ]study|contrat pro)\b/, "alternance"],
  [/\b(freelance|independant|contractor|portage)\b/, "freelance"],
  [/\b(cdd|fixed[- ]term|temporary contract|contrat a duree determinee|interim)\b/, "cdd"],
  [/\b(cdi|permanent|contrat a duree indeterminee|full[- ]time)\b/, "cdi"],
];

// In prose, only explicit statements count: "première expérience (stage ou alternance acceptés)"
// describes the candidate, not the contract, and must not turn a CDI into an internship.
const DESCRIPTION_PATTERNS: [RegExp, Contract][] = [
  // "ton stage", "ce stage": the posting speaks of itself as an internship, before any CDI mention.
  [/\b(ton|ce|votre|du|ton futur) stage\b|\bstage de fin d'etudes\b/, "stage"],
  [/\b(cdi|contrat a duree indeterminee)\b/, "cdi"],
  [/\b(cdd|contrat a duree determinee|fixed[- ]term contract)\b/, "cdd"],
  [/\b(offre de stage|stage de \d+ ?mois|stage d'une duree|stage de fin d'etudes de \d+|\d+[- ]month internship|internship of \d+)\b/, "stage"],
  [/\b(contrat d'alternance|alternance (de|sur) \d+|contrat d'apprentissage|contrat de professionnalisation)\b/, "alternance"],
  [/\b(mission freelance|contrat freelance|freelance mission)\b/, "freelance"],
];

// `explicit` is a structured field from the source (e.g. Lever "commitment"); it wins over prose.
// A V.I.E. (volontariat international en entreprise), as postings write it: "VIE" or "V.I.E" in capitals,
// never "Auxiliaire de vie" nor "AUXILIAIRE DE VIE SOCIALE".
export function isVie(title: string, description = ""): boolean {
  if (/volontariat international (en entreprise|vie)\b/i.test(`${title} ${description}`)) return true;
  return /(^|[^A-Za-z])(V\.I\.E\.?|VIE)(?![A-Za-z])/.test(title) && !/\b(DE|D'|DU|LA|EN) VIE\b|\bVIE (SOCIALE|SCOLAIRE|QUOTIDIENNE|ETUDIANTE|ÉTUDIANTE|SERIE|SÉRIE)\b/i.test(title);
}

export function detectContract(title: string, explicit?: string | null, description = ""): Contract | "unknown" {
  if (isVie(title, description)) return "vie";
  // A title saying "Intern" or "Alternance" beats a generic "Full-time" ATS field.
  const t = norm(title);
  for (const [re, contract] of CONTRACT_PATTERNS) if (contract !== "cdi" && re.test(t)) return contract;
  for (const text of [explicit ?? "", title]) {
    const n = norm(text);
    if (!n) continue;
    for (const [re, contract] of CONTRACT_PATTERNS) if (re.test(n)) return contract;
  }
  const d = norm(description);
  // A stated contract, anywhere in the text: "Contrat : CDI", "type de contrat : stage", "… en stage".
  const full = norm(description);
  const stated = STATED_CONTRACT.map((re) => re.exec(full)?.[1]).find(Boolean);
  if (stated) return STATED_WORDS[stated.replace(/[- ]/g, "")] ?? "unknown";
  for (const [re, contract] of DESCRIPTION_PATTERNS) if (re.test(d)) return contract;
  return "unknown";
}

const STATED_CONTRACT = [
  /(?:type de )?contrat(?: de travail)?\s*(?:propose)?\s*:?\s*(?:en\s+)?(cdi|cdd|stage|alternance|apprentissage|freelance|interim)\b/,
  /\b(?:poste|offre|position|recrute\w*|cherche\w*|recherche\w*)\b[^.\n]{0,80}\ben (cdi|cdd|stage|alternance)\b/,
  /employment type\s*:?\s*(full[- ]?time|permanent|internship|fixed[- ]?term|temporary|contract)\b/,
];
const STATED_WORDS: Record<string, Contract> = {
  cdi: "cdi", cdd: "cdd", stage: "stage", alternance: "alternance", apprentissage: "alternance", freelance: "freelance", interim: "cdd",
  fulltime: "cdi", permanent: "cdi", internship: "stage", fixedterm: "cdd", temporary: "cdd", contract: "freelance",
};

// Remote work as the description puts it, when the location field said nothing: "télétravail jusqu'à
// 3 jours", "hybrid work, 2 days of remote", "full remote". Agile "rituels hybrides" are not remote work.
export function detectRemote(description: string): "remote" | "hybrid" | null {
  const n = norm(description).replace(/[\u00a0\u202f]/g, " ");
  if (/\b(full[- ]?remote|fully remote|100 ?% (remote|teletravail|en teletravail)|teletravail (complet|total|integral)|remote[- ]first)\b/.test(n)) return "remote";
  if (/\b(pas de|sans|aucun|no) (teletravail|remote|home office)\b|\bteletravail (non|impossible)\b|\bfully on[- ]?site\b|\b100 ?% (presentiel|sur site)\b/.test(n)) return null;
  if (
    /\bteletravail\b|\b(work|working) remotely\b|\bremote (work|working|days?|policy)\b|\bhome office\b|\b(\d|un|une|deux|trois|quatre)\s*(jours?|days?)\s*(de |of |en )?(teletravail|remote|tt|home office)\b|\b(teletravail|remote)\s*(jusqu'?a|up to|de)?\s*\d\s*(jours?|days?)|\bhybrid work|travail hybride|mode hybride|organisation hybride|modele hybride|politique de teletravail|teletravail (flexible|partiel|possible|occasionnel|autorise)|hybrid (model|working|policy|set ?up|schedule)|remote[- ]friendly|flexible remote/.test(
      n,
    )
  )
    return "hybrid";
  return null;
}

// The experience asked, read in the posting (the first requirement stated): every duration in years ("3 ans", "3+ years",
// "4 à 8 ans", "(> 5 ans)", "8–12 ans", "jusqu'à 2 ans", "au moins 5/6 ans") is kept when the words around it
// speak of experience, and dropped when they describe the company ("nos 50 ans d'expérience") or a
// contract ("CDD de 2 ans").
const NUM = String.raw`(\d{1,2}(?:[.,]5)?)`;
const DURATION = new RegExp(
  String.raw`(jusqu'? ?a|up to|moins de|less than|max(?:imum)?\.?|plus de|more than|over|au moins|at least|minimum|minimun|minium|min\.?|>=?|≥|entre|between|de|from|d|sur|of)?\s*` +
    String.raw`${NUM}\s*(\+|ou plus|or more|et plus|and more|or above)?\s*(?:(?:a|-|to|/|et|and|ou|or)\s*${NUM}\s*\+?\s*)?(?:ans?|annees?|years?|yrs?)\b`,
  "g",
);
const EXPERIENCE_WORDS = /experien|\bexp\b|years of|years in|years as|background|track record|seniorit|poste similaire|similar role|role similaire|in product|en product|en gestion|in management|au sein d|minimum|au moins|at least|profil/;
// Right before the duration: the company's history, a contract, an age, a past period.
const NOT_A_REQUIREMENT = /\b(depuis|since|founded|fondee?s?|creee?s?|il y a|ago|over the (past|last)|for the (past|last)|pendant|during|age|old|aged|garantie|guarantee|anniversaire|nos|our|fort de|forte de|pres de|nearly|almost|contrat|cdd|duree|duration|programme|program|mission|alternance|apprentissage|engagement|tous les|every|prime|anciennete|a partir de|bac|degree|diplome|etudes|cursus|formation)\b[ ,'+-]*(\w+[ ,'+-]+){0,2}$/;
const CEILING = /^(jusqu'? ?a|up to|moins de|less than|max(?:imum)?\.?)$/;

export type ExperienceRange = { min: number | null; max: number | null };

export function detectExperience(description: string): ExperienceRange {
  const n = norm(description)
    .replace(/&#?[a-z0-9]+;/g, " ")
    .replace(/[\u00a0\u202f]/g, " ")
    .replace(/[–—‑−]/g, "-")
    .replace(/[’`]/g, "'");
  let best: ExperienceRange = { min: null, max: null };
  for (const m of n.matchAll(DURATION)) {
    const at = m.index ?? 0;
    const end = at + m[0].length;
    const before = n.slice(Math.max(0, at - 110), at);
    const around = `${before}${m[0]}${n.slice(end, end + 70)}`;
    if (!EXPERIENCE_WORDS.test(around)) continue;
    if (NOT_A_REQUIREMENT.test(n.slice(Math.max(0, at - 30), at + (m[1] ? m[1].length + 1 : 0)))) continue;
    const prefix = (m[1] ?? "").trim();
    const a = Math.floor(Number(m[2].replace(",", ".")));
    const b = m[4] !== undefined ? Math.floor(Number(m[4].replace(",", "."))) : null;
    let min: number;
    let max: number | null;
    if (CEILING.test(prefix)) [min, max] = [0, a];
    else [min, max] = [a, b !== null && b >= a && b <= 20 ? b : null];
    if (!Number.isFinite(min) || min > 15) continue;
    // The first requirement stated is the main one ("8–12 years, including 3–5 managing teams").
    best = { min, max };
    break;
  }
  return best;
}

// Without a number, the words still say a lot: "profil junior" or "première expérience" is within a
// beginner's reach, "expérience significative" is not. Junior wins when both appear ("junior ou confirmé").
export type ExperienceLevel = "junior" | "experienced";
const JUNIOR_TEXT =
  /\b(profils? junior|junior accepte|postes? junior|peu experimente|premiere experience|1ere experience|jeune diplome|debutant|sortie? d['’ ]ecole|fraichement diplome|entry[- ]level|new grad|graduate program|recent graduate|no (prior )?experience (is )?required|early[- ]career)/;
const EXPERIENCED_TEXT =
  /\b(experience (professionnelle )?(significative|solide|confirmee|averee|reussie|consequente|importante|approfondie|probante)|(solide|forte|riche|longue|vraie) experience|profils? (confirme|experimente|senior)|vous etes experimente|tu es experimente|plusieurs annees d['’ ]experience|significant experience|extensive experience|proven (track record|experience)|strong (track record|experience)|seasoned|several years of experience|experienced (product|professional|pm))/;

export function detectExperienceLevel(description: string): ExperienceLevel | null {
  const n = norm(description);
  if (JUNIOR_TEXT.test(n)) return "junior";
  if (EXPERIENCED_TEXT.test(n)) return "experienced";
  return null;
}

// Years an "experienced" profile implies, used only for the gap (never shown as a number).
export const EXPERIENCED_YEARS = 4;

// Lowest number of years the offer asks for, or null when it doesn't say.
export function detectExperienceYears(description: string): number | null {
  return detectExperience(description).min;
}

// "0 à 2 ans", "3 à 6 ans", "3 ans et plus", "Débutant accepté": how a range reads on a card.
export function experienceLabel(min: number | null, max: number | null): string | null {
  if (min === null) return null;
  if (max !== null && max > min) return `${min} à ${max} ans`;
  if (min === 0) return "Débutant accepté";
  return `${min} an${min > 1 ? "s" : ""} et plus`;
}

// The card's reading: the years when the posting gives them, otherwise its own words.
// `estimate`: the level the missions describe when nothing is written, said as an estimate.
export function experienceText(min: number | null, max: number | null, level: ExperienceLevel | null | undefined, estimate?: string | null): string | null {
  return (
    experienceLabel(min, max) ??
    (level === "junior" ? "Profil junior accepté" : level === "experienced" ? "Expérience significative demandée" : null) ??
    (estimate === "junior" ? "Non précisée · missions de niveau junior (estimé)" : estimate === "confirme" ? "Non précisée · missions de niveau confirmé (estimé)" : estimate === "senior" ? "Non précisée · missions de niveau senior (estimé)" : null)
  );
}

// Minimum experience an intitulé implies, used only as a coarse, safe gate.
export function titleSeniorityYears(title: string): number {
  // "V.I.E" is a contract, not the level V ("Engineer V").
  const n = norm(title.replace(/V\.I\.E\.?|\bVIE\b/g, " "));
  if (/\b(vp|vice[- ]president|chief|cpo|cto|director|directeur|directrice|head of|head)\b/.test(n)) return 8;
  if (/\b(principal|staff|group product manager)\b/.test(n)) return 7;
  // People-management roles need experience whatever the field.
  if (/\b(engineering manager|manager, engineering|manager i+, engineering|people manager|team lead|tech lead)\b/.test(n)) return 5;
  if (/\b(senior|sr\.?|lead|expert)\b/.test(n)) return 5;
  // Levelled titles (e.g. "Architect 3", "Engineer III").
  if (/\b(iii|iv|v)\b|\s[3-5]\s*$|\s[3-5]\s*[-–(]/.test(n)) return 5;
  if (/\b(confirme|confirmee|confirmed|experimente|experimentee|experienced|ii)\b|\s2\s*$|\s2\s*[-–(,]/.test(n)) return 3;
  return 0;
}

// The salary as the posting writes it ("45-55 k€ brut annuel", "50 000 € à 60 000 €", "€60,000 – €75,000"),
// only next to words about pay, and only for plausible annual or monthly amounts. Never estimated.
// A whole number: grouped thousands (50 000, 60,000) or plain digits (2133), with optional cents.
const MONEY = String.raw`(?:\d{1,3}(?:[ .,]\d{3})+|\d+)(?:[.,]\d{1,2})?(?![\d])`;
const AMOUNT = String.raw`(${MONEY})\s*(k|K|000)?\s*(?:€|eur(?:os?)?|k€)?`;
const SALARY = new RegExp(String.raw`(?<![\d.,])(?:€\s*)?${AMOUNT}\s*(?:-|a|à|to|et|and)\s*(?:€\s*)?${AMOUNT}|(?<![\d.,])(?:€\s*)?(${MONEY})\s*(k€|k|K€|000\s*€|\s?€)`, "g");
const PAY_WORDS = /salaire|remuneration|package|salary|compensation|pay range|brut|gross|fixe|base|annuel|annual|par an|per year|\/an|k€/;
const NOT_PAY = /levee|leve|raised|funding|financement|chiffre d.affaires|revenue|ca de|turnover|budget|capital|valoris|ticket|panier|jour travaille|par jour|\/jour|cheques?|projets?|inferieur|superieur|montant|achats?|economies|commandes?|marches?|portefeuille|encours|actifs/;

function annualThousands(raw: string, unit: string | undefined): number | null {
  const digits = raw.replace(/[ .,](?=\d{3}(?!\d))/g, "").replace(",", ".");
  let v = Number(digits);
  if (!Number.isFinite(v)) return null;
  if (unit && /k/i.test(unit)) return v;
  if (unit === "000") return v;
  if (v >= 1000) v = v / 1000;
  return v;
}

export function detectSalary(description: string): string | null {
  const n = norm(description).replace(/[  ]/g, " ").replace(/[–—‑−]/g, "-");
  for (const m of n.matchAll(SALARY)) {
    const at = m.index ?? 0;
    // Pay words right before the amount (or just after it), never a budget or a deal size.
    const around = n.slice(Math.max(0, at - 45), at + m[0].length + 30);
    if (!PAY_WORDS.test(around) || NOT_PAY.test(n.slice(Math.max(0, at - 50), at + m[0].length))) continue;
    const low = m[1] !== undefined ? annualThousands(m[1], m[2] ?? m[4]) : annualThousands(m[5], m[6]);
    const high = m[3] !== undefined ? annualThousands(m[3], m[4] ?? m[2]) : null;
    if (low === null) continue;
    // "1 867 € à 2 134 €" without "k": a monthly pay, even when the posting does not say so.
    const plainEuros = (m[2] ?? m[4] ?? m[6]) === undefined || /€/.test(m[6] ?? "") ? Number((m[1] ?? m[5]).replace(/[ .,](?=\d{3}\b)/g, "").replace(",", ".")) : 0;
    const monthly = /par mois|mensuel|\/mois|per month|monthly/.test(around) || (plainEuros >= 1000 && plainEuros < 15000 && !/annuel|par an|\/an|per year|annual/.test(around));
    const ok = (v: number) => (monthly ? v >= 1.2 && v <= 15 : v >= 18 && v <= 250);
    if (!ok(low) || (high !== null && (!ok(high) || high < low))) continue;
    const fmt = (v: number) => (monthly ? `${Math.round(v * 1000).toLocaleString("fr-FR").replace(/\s/g, " ")} €` : `${Math.round(v)} k€`);
    const value = high !== null && high !== low ? (monthly ? `${fmt(low)} à ${fmt(high)}` : `${Math.round(low)} à ${Math.round(high)} k€`) : fmt(low);
    const gross = /brut|gross/.test(around) ? " brut" : /net\b/.test(around) ? " net" : "";
    return `${value}${gross} ${monthly ? "par mois" : "par an"}`;
  }
  return null;
}
