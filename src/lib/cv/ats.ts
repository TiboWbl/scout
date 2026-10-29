import { impliedBy, skillText, spellings } from "@/lib/views/skills";

// Scout's CV grid, out of 100. There is no universal ATS score: this one is transparent, each lost
// point says why and how to fix it. Pure functions, run on the server (contacts are found here by
// regex, never by the model).

export type Layout = {
  pages: number;
  // Share of text lines where text sits side by side in two separate blocks (two-column layout).
  columnRatio: number;
  // Titles written with spaced letters ("E X P É R I E N C E"), which ATS read as single letters.
  spacedTitles: number;
};

export type CvInput = { text: string; layout: Layout; filename: string; sizeBytes: number };

// `why`: why it matters, so the person can decide; nothing here is mandatory. `good`: what a passed
// point brings, so a good CV knows why it works.
export type Check = { ok: boolean; label: string; points: number; max: number; fix?: string; why?: string; good?: string };
export type Category = { key: "lisibilite" | "structure" | "contenu" | "adequation"; label: string; score: number; max: number; checks: Check[] };
// `keywords`: the role's keywords checked (absent from analyses made before 16 October 2026).
export type AtsResult = { total: number; categories: Category[]; keywords?: string[] };

const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

const EMAIL = /[\w.+-]+@[\w-]+(\.[\w-]+)+/;
const PHONE = /(?:\+\d{1,3}[\s.-]?)?(?:\(?\d{1,4}\)?[\s.-]?){2,5}\d{2,4}/g;
export function contactsFound(text: string) {
  const phone = (text.match(PHONE) ?? []).some((m) => m.replace(/\D/g, "").length >= 9);
  return { email: EMAIL.test(text), phone };
}

const SECTIONS: [string, RegExp][] = [
  ["Expérience", /\b(experiences?( professionnelles?)?|parcours professionnel|work experience|experience|employment)\b/],
  ["Formation", /\b(formations?|education|diplomes?|etudes|academic)\b/],
  ["Compétences", /\b(competences|skills|savoir[- ]faire|outils|hard skills|soft skills)\b/],
];
const LANGUAGES = /\b(langues?|languages?)\b/;
// A level a recruiter can read: CEFR, the usual words, or a test.
const LANGUAGE_LEVEL = /\b(a1|a2|b1|b2|c1|c2|courant|bilingue|natif|native|maternelle|fluent|professionnel|intermediaire|intermediate|notions|scolaire|toeic|toefl|ielts|cambridge)\b/;

// Read at the start of a mission line only: "crédit" or "créatif" inside a sentence is not an action.
const ACTION_VERBS =
  /^(pilot|lanc|concu|concev|developp|cre[eé]|optimis|amelior|augment|redui|ger[eé]|dirig|coordonn|mis en place|mettre en place|deploy|analys|automatis|negoci|condui|realis|organis|livr|anim|defini|defin|construi|men[ée]|mener|redig|particip|contribu|encadr|form[eé]|former|assur|collabor|identifi|prioris|structur|recrut|conseill|accompagn|refond|migr|integr|test[eé]|mesur|mont[eé]|tourn[eé]|produi|garanti|support|fidelis|prospect|vend|sign[eé]|planifi|implement|supervis|elabor|etabli|instaur|initi|fond[eé]|cofond|transform|modernis|simplifi|standardis|document|present|trait[eé]|resolu|diagnostiq|install|configur|cod[eé]|programm|dessin|illustr|photographi|film|edit[eé]|publi|ecri|traduit|enseign|soign|administr|prepar|control|verifi|audit|evalu|etudi|interview|synthetis|negoc|piloter|lancer|concevoir|developper|creer|optimiser|ameliorer|gerer|coordonner|deployer|analyser|realiser|organiser|animer|definir|construire|rediger|accompagner|led|launched|built|designed|developed|improved|increased|reduced|managed|delivered|created|drove|owned|shipped|implemented|analy[sz]ed|coordinated|organi[sz]ed|conducted|wrote|produced|edited|filmed|negotiated|sold|trained|mentored|supported|defined|ran|grew|scaled|optimi[sz]ed|automated|migrated|redesigned|established|partnered|collaborated|presented|launch|lead|build|design|develop|manage|create|drive)\w*/;
// Figures that show a result: percentages, money, multipliers, counts of people or things.
const QUANTIFIED =
  /(?:[+−-]\s?)?\d+(?:[.,]\d+)?\s?(?:%|k€|m€|€|k\b|m\b|x\b|×|pts?\b|points?\b)|(?:\bx|×)\s?\d+\b|\b\d{1,3}(?:[ .,]?\d{3})*\+?\s(?:\w+\s)?(?:utilisateurs?|clients?|users?|personnes|people|entreprises|equipes?|developpeurs|devs|projets?|pays|ventes|leads|telechargements|downloads|membres|participants|collaborateurs|magasins|sites|produits|fonctionnalites|features|commandes|orders|transactions|abonnes|followers|visites|sessions|entretiens|interviews|tickets|candidats|partenaires|marches|langues|stakeholders|squads|sprints|releases|apps?)\b/gi;

function check(ok: boolean, label: string, max: number, fix: string, points = ok ? max : 0): Check {
  return { ok, label, points, max, ...(ok ? {} : { fix }) };
}

// Why each point matters: the argument behind the advice, so the person decides with full knowledge.
const WHY: [string, string][] = [
  ["Texte lisible", "Un ATS ne lit que le texte : une image est vide pour lui."],
  ["Une seule colonne", "Deux colonnes se mélangent ligne à ligne à la lecture."],
  ["Titres de section", "« E X P É R I E N C E » est lu comme dix lettres isolées."],
  ["Email détecté", "Sans email lisible, le recruteur ne peut pas te répondre d'un clic."],
  ["Téléphone détecté", "Un recruteur appelle souvent avant d'écrire."],
  ["Deux pages", "Un recruteur passe moins d'une minute sur un CV."],
  ["Fichier léger", "Certains formulaires refusent les fichiers lourds."],
  ["Nom de fichier", "« CV Prénom Nom » se retrouve, « document.pdf » se perd."],
  ["Section «", "Un titre standard est rangé à coup sûr par l'ATS."],
  ["Dates des expériences", "L'ATS calcule ton expérience à partir des dates."],
  ["Longueur adaptée", "Trop court, on ne voit rien ; trop long, l'essentiel se dilue."],
  ["Verbes d'action", "Le verbe montre ce que tu as fait toi-même."],
  ["Résultats chiffrés", "Un chiffre rend un résultat vérifiable et mémorable."],
  ["Phrases courtes", "Les recruteurs lisent en diagonale."],
  ["Mots-clés du métier", "Les recruteurs et les ATS cherchent avec les mots des offres : un synonyme ne remonte pas."],
  ["Intitulé visé en tête", "C'est la première chose lue, en quelques secondes : elle dit tout de suite pour quel poste tu postules."],
  ["Compétences prouvées", "Une compétence montrée dans une mission, avec un résultat, est crue ; une liste de mots ne prouve rien."],
  ["Langues avec un niveau", "« Anglais » seul ne dit pas si tu peux mener une réunion : le niveau, si."],
];

const GOOD: [string, string][] = [
  ["Texte lisible", "Tout ton CV est du vrai texte."],
  ["Une seule colonne", "Une seule colonne : rien ne se mélange."],
  ["Titres de section", "Tes titres sont reconnus tels quels."],
  ["Email détecté", "Ton email est lisible."],
  ["Téléphone détecté", "Ton numéro est copiable."],
  ["Deux pages", "Ton CV est court."],
  ["Section «", "Sections standard, bien rangées par un ATS."],
  ["Dates des expériences", "Tes dates sont lisibles."],
  ["Verbes d'action", "Tes missions commencent par ce que tu as fait."],
  ["Résultats chiffrés", "Tes résultats sont chiffrés."],
  ["Phrases courtes", "Des lignes courtes, faciles à survoler."],
  ["Mots-clés du métier", "Tu emploies les mots des offres."],
  ["Intitulé visé en tête", "On sait d'un coup d'œil quel poste tu vises."],
  ["Compétences prouvées", "Tes compétences sont montrées en situation."],
  ["Langues avec un niveau", "Ton niveau de langue est clair."],
];

// What the person's market says (Mon marché): `expected`, its most asked skills, most asked first;
// `present`, those the CV holds (Mon marché's own check); `keys` and `shares` per skill name; `titles`,
// the role's titles as the offers write them, most frequent first.
export type RoleContext = { expected: string[]; present?: string[]; languages?: string[]; keys?: Record<string, string>; shares?: Record<string, number>; titles?: { title: string; count: number }[] };

const phrase = (s: string) => ` ${fold(s).replace(/[^a-z0-9+#]+/g, " ").trim()} `;

export function scoreCv(input: CvInput, roleKeywords: RoleContext): AtsResult {
  const text = input.text;
  const n = fold(text);
  const words = text.split(/\s+/).filter(Boolean).length;
  const contacts = contactsFound(text);

  // Lisibilité machine (40)
  const chars = text.replace(/\s/g, "").length;
  const extractable = chars >= 800 ? 12 : chars >= 300 ? 6 : 0;
  const columns = input.layout.columnRatio < 0.15 ? 8 : input.layout.columnRatio < 0.35 ? 4 : 0;
  const goodName = /cv|resume|curriculum/i.test(input.filename) && !/document|scan|untitled|sans titre|\(\d+\)/i.test(input.filename);
  const lisibilite: Check[] = [
    check(extractable === 12, "Texte lisible par une machine", 12, chars < 300 ? "Le PDF ne contient presque pas de texte : c'est sans doute une image. Exporte-le depuis ton traitement de texte, pas en scan ni en capture." : "Peu de texte extrait : vérifie que les parties en image (bandeau, compétences en icônes) existent aussi en texte.", extractable),
    check(columns === 8, "Une seule colonne, ordre de lecture simple", 8, "Une mise en page en colonnes mélange l'ordre de lecture pour un ATS. Passe à une colonne, ou mets la colonne latérale (compétences, langues) en fin de document.", columns),
    check(input.layout.spacedTitles === 0, "Titres de section écrits normalement", 6, "Des titres en lettres espacées (« E X P É R I E N C E ») sont lus lettre par lettre. Écris-les normalement, la mise en forme peut rester."),
    check(contacts.email, "Email détecté", 3, "Aucun email lisible : écris-le en texte, pas dans une icône ou une image."),
    check(contacts.phone, "Téléphone détecté", 3, "Aucun numéro lisible : écris-le en texte, au format 06 12 34 56 78."),
    check(input.layout.pages <= 2, "Deux pages au plus", 3, "Plus de deux pages : un recruteur lit d'abord la première. Garde l'essentiel sur une page, deux au maximum."),
    check(input.sizeBytes <= 2_000_000, "Fichier léger", 3, "Fichier de plus de 2 Mo : certains formulaires le refusent. Compresse les images ou exporte en « PDF optimisé »."),
    check(goodName, "Nom de fichier explicite", 2, "Nomme le fichier « CV Prénom Nom - Métier.pdf » plutôt que « document.pdf »."),
  ];

  // Structure (20)
  const found = SECTIONS.filter(([, re]) => re.test(n)).map(([label]) => label);
  const years = new Set(text.match(/\b(19[89]\d|20[0-4]\d)\b/g) ?? []);
  const lengthOk = words >= 250 && words <= 900;
  const structure: Check[] = [
    ...SECTIONS.map(([label]) => check(found.includes(label), `Section « ${label} » identifiable`, 4, `Ajoute un titre de section « ${label} » clair : les ATS rangent ton CV grâce à ces titres standard.`)),
    check(LANGUAGES.test(n) && LANGUAGE_LEVEL.test(n), "Langues avec un niveau", 2, LANGUAGES.test(n) ? "Précise ton niveau pour chaque langue (Anglais : C1, courant ; ou un score TOEIC) : un recruteur ne devine pas." : "Ajoute une ligne « Langues » avec ton niveau (ex. Anglais : courant, C1)."),
    check(years.size >= 2, "Dates des expériences", 3, "Date chaque expérience (mois et année de début et de fin) : sans dates, l'ATS ne calcule pas ton expérience."),
    check(lengthOk, "Longueur adaptée", 3, words < 250 ? "CV très court : détaille tes missions et résultats pour chaque expérience." : "CV très long : resserre sur les expériences les plus proches du poste visé."),
  ];

  // Contenu (25)
  // A PDF cuts a mission over several lines: a line starting in lower case continues the one before.
  const raw = text.split(/\n|•|·|▪|◦|‣/).map((l) => l.trim()).filter(Boolean);
  const joined: string[] = [];
  for (const l of raw) {
    if (joined.length && /^[a-zà-ÿ(,;:]/.test(l)) joined[joined.length - 1] += ` ${l}`;
    else joined.push(l);
  }
  const lines = joined.filter((l) => l.split(/\s+/).length >= 4);
  // The experience section: from its heading to the next one (education, skills, languages…).
  const heading = (l: string) => l.split(/\s+/).length <= 4 && /\b(experiences?|parcours professionnel|work experience|employment|formations?|education|competences|skills|langues?|languages?|certifications?|centres? d.interet|interets|projets? personnels?|loisirs|outils)\b/.test(fold(l));
  const start = joined.findIndex((l) => heading(l) && /\b(experience|parcours professionnel|employment)/.test(fold(l)));
  const end = start >= 0 ? joined.findIndex((l, i) => i > start && heading(l) && !/\b(experience|parcours professionnel|employment)/.test(fold(l))) : -1;
  const experience = start >= 0 ? joined.slice(start + 1, end > start ? end : undefined) : joined;
  // A line with dates is a job's heading ("Product Manager, Acme (2023-2025)"), not a mission.
  const missions = experience.filter((l) => l.split(/\s+/).length >= 4 && !/\b(19|20)\d{2}\b.{0,12}(\b(19|20)\d{2}\b|aujourd|present|actuel|now|today)/i.test(l));
  // Mission lines that open on an action verb, each counted once.
  const verbs = missions.filter((l) => ACTION_VERBS.test(fold(l).replace(/^[^a-z]+/, ""))).length;
  const numbers = new Set((fold(text).match(QUANTIFIED) ?? []).map((m) => m.trim())).size;
  const longLines = lines.filter((l) => l.split(/\s+/).length > 35).length;
  const contenu: Check[] = [
    check(verbs >= 8, "Verbes d'action", 10, `Commence chaque mission par un verbe d'action (piloté, lancé, conçu, réduit…) : ${verbs} mission${verbs > 1 ? "s" : ""} sur ${missions.length} commence${verbs > 1 ? "nt" : ""} ainsi, vise au moins 8.`, Math.min(10, Math.round((10 * verbs) / 8))),
    check(numbers >= 4, "Résultats chiffrés", 10, `Chiffre tes résultats : combien, combien de fois, quel effet (+30 %, 2 000 personnes, 15 projets livrés, un budget de 50 k€, 3 jours gagnés). ${numbers} trouvé${numbers > 1 ? "s" : ""}, vise au moins 4.`, Math.min(10, Math.round((10 * numbers) / 4))),
    check(longLines <= 2, "Phrases courtes", 5, "Certaines lignes dépassent 35 mots : coupe-les en puces d'une ligne, une idée par puce.", longLines <= 2 ? 5 : longLines <= 5 ? 2 : 0),
  ];

  // Adéquation (15): the skills most asked in the person's market (Mon marché), checked in the text.
  const expected = roleKeywords.expected.slice(0, 12);
  const present = roleKeywords.present ? expected.filter((k) => roleKeywords.present!.includes(k)) : expected.filter((k) => hasKeyword(n, k));
  const missing = expected.filter((k) => !present.includes(k));
  const shares = roleKeywords.shares ?? {};
  const withShare = (k: string) => (shares[k] ? `${k} (${shares[k]} % des offres)` : k);
  const titles = roleKeywords.titles ?? [];
  // Without the market's titles, the keywords carry the whole of the 15 points.
  const keywordMax = titles.length ? 9 : 12;
  const adequacy = expected.length ? Math.round((keywordMax * present.length) / expected.length) : 0;
  // The top of the CV: its first lines, where the title and the summary sit.
  const head = phrase(text.split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 8).join(" "));
  const titled = titles.find((t) => head.includes(phrase(t.title)));
  const named = titles.slice(0, 3).map((t) => `« ${t.title} »${t.count > 1 ? ` (${t.count} offres)` : ""}`).join(", ");
  // A skill proved in a mission: written in a sentence of at least 7 words, not only in a list.
  // Read like Mon marché: the same normalised words (plural, case, accents, "user storie" for "user stories").
  const inExperience = skillText(experience.filter((l) => l.split(/\s+/).length >= 5).join(" \n "));
  const keyOf = (k: string) => roleKeywords.keys?.[k] || skillText(k).trim();
  // A language is shown by its level (checked above), not in a mission.
  const toProve = present.filter((k) => !roleKeywords.languages?.includes(k));
  const proved = toProve.filter((k) => spellings(keyOf(k)).some((f) => inExperience.includes(` ${f} `)));
  const listed = toProve.filter((k) => !proved.includes(k));
  // Found through a more precise word (MySQL for SQL): a recruiter understands, a strict ATS may not.
  // As the CV writes it ("MySQL", not "mysql").
  const asWritten = (w: string) => text.match(new RegExp(`(?<![A-Za-z])${w.replace(/ /g, "[\\s/-]?")}(?![A-Za-z])`, "i"))?.[0] ?? w;
  const precise = present
    .map((k) => [k, impliedBy(text, keyOf(k))] as const)
    .filter((x): x is readonly [string, string] => Boolean(x[1]))
    .map(([k, w]) => [k, asWritten(w)] as const);
  const preciseTip = precise.length ? ` ${precise.map(([k, w]) => `${k} est reconnu grâce à « ${w} »`).join(", ")} : écris aussi le mot général, par exemple « ${precise[0][0]} (${precise[0][1]}) », pour les logiciels qui cherchent le mot exact.` : "";
  const keywordCheck = check(missing.length === 0 && expected.length > 0, `Mots-clés du métier visé (${present.length}/${expected.length})`, keywordMax, `Absents de ton CV, du plus demandé au moins demandé : ${missing.map(withShare).join(", ")}. Ce sont les compétences les plus demandées dans ton marché : ajoute celles qui correspondent vraiment à ton expérience, avec les mots exacts des offres.${preciseTip}`, adequacy);
  const adequation: Check[] = [
    keywordCheck,
    ...(titles.length
      ? [
          check(Boolean(titled), "Intitulé visé en tête du CV", 3, `Écris en haut de ton CV, sous ton nom, l'intitulé du poste visé tel que les offres l'écrivent : ${named}. Ajoute dessous une accroche de deux lignes (ton expérience, ce que tu sais faire).`),
          check(toProve.length > 0 && listed.length === 0, "Compétences prouvées dans une mission", 3, toProve.length === 0 ? "Ajoute d'abord les compétences de ton marché que tu as vraiment, puis montre chacune dans une mission." : `Citées seulement dans une liste : ${listed.join(", ")}. Montre chacune dans une mission : ce que tu as fait avec, et le résultat.`, toProve.length ? Math.round((3 * proved.length) / toProve.length) : 0),
        ]
      : []),
  ];

  const why = (label: string) => WHY.find(([start]) => label.startsWith(start))?.[1];
  const good = (label: string) => GOOD.find(([start]) => label.startsWith(start))?.[1];
  for (const c of [...lisibilite, ...structure, ...contenu, ...adequation]) {
    c.why = why(c.label);
    if (c.ok) c.good = good(c.label);
  }
  if (keywordCheck.ok && preciseTip) keywordCheck.good = `${keywordCheck.good}${preciseTip}`;

  const categories: Category[] = [
    { key: "lisibilite", label: "Lisibilité machine", max: 40, checks: lisibilite, score: 0 },
    { key: "structure", label: "Structure", max: 20, checks: structure, score: 0 },
    { key: "contenu", label: "Contenu", max: 25, checks: contenu, score: 0 },
    { key: "adequation", label: "Adéquation au métier", max: 15, checks: adequation, score: 0 },
  ].map((c) => ({ ...c, score: c.checks.reduce((s, k) => s + k.points, 0) })) as Category[];
  return { total: categories.reduce((s, c) => s + c.score, 0), categories, keywords: expected };
}

// A keyword is in the CV when each of its words is, as a whole word ("API" is not in "rapide"); a slash
// means alternatives ("Agile/Scrum", "Jira/Confluence"): one of them is enough. Plurals count ("OKRs", "OKR").
const AB = /\ba\s*\/\s*b\b/g;
const escape = (w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export function hasKeyword(foldedCv: string, keyword: string) {
  const cv = foldedCv.replace(AB, "a/b");
  const k = fold(keyword).replace(AB, "a/b");
  const alternatives = (/a\/b/.test(k) ? [k] : k.split(/\s*\/\s*/)).filter(Boolean);
  return alternatives.some((alt) => {
    const words = alt.split(/[^a-z0-9+#/]+/).filter((w) => w.length >= 2);
    return (
      words.length > 0 &&
      words.every((w) => new RegExp(`(?:^|[^a-z0-9])${escape(w.length > 3 ? w.replace(/s$/, "") : w)}(?:s|x|es|ing)?(?![a-z0-9])`).test(cv))
    );
  });
}

// Keywords of an offer found or missing in the CV: the comparison mode.
export function compareKeywords(cvText: string, keywords: string[]) {
  const n = fold(cvText);
  const present = keywords.filter((k) => hasKeyword(n, k));
  return { present, missing: keywords.filter((k) => !present.includes(k)), score: keywords.length ? Math.round((100 * present.length) / keywords.length) : 0 };
}
