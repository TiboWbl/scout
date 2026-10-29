import type { SupabaseClient } from "@supabase/supabase-js";
import type { Skill } from "@/lib/scoring/judge";

// `key`: the skill whatever its spelling; `bonus`: offers that cite it only as a plus ("un plus", "idéalement").
export type SkillStat = { name: string; kind: Skill["kind"]; count: number; share: number; inCv: boolean; key?: string; bonus?: number };

const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9+#]+/g, " ").trim();
// "Roadmaps" and "roadmap", "A/B tests" and "A/B test" are the same skill.
const key = (s: string) => fold(s).split(" ").map((w) => (w.length > 3 ? w.replace(/s$/, "") : w)).join(" ");
const QUALIFIERS = new Set(["produit", "product", "digital", "digitale", "professionnel", "professionnelle", "courant", "avance", "avancee", "solide", "efficace", "agile", "client", "utilisateur", "user", "management", "skill"]);
// The name shown for a skill written several ways, when the most frequent spelling would puzzle.
const DISPLAY: Record<string, string> = { "trade off": "Arbitrages (trade-offs)" };
// Same skill, other spelling.
const ALIASES: Record<string, string> = { ai: "ia", "intelligence artificielle": "ia", "artificial intelligence": "ia", kpi: "kpi", okrs: "okr", "adobe premiere pro": "premiere pro", "adobe premiere": "premiere pro", "adobe after effect": "after effect", "adobe photoshop": "photoshop", "adobe illustrator": "illustrator", "adobe indesign": "indesign", arbitrage: "trade off", "trade offs": "trade off", tradeoff: "trade off" };

// For display: "roadmap" reads "Roadmap"; "iOS" and "SQL" stay as written.
export const skillLabel = (name: string) => (/^[a-zà-ÿ]/.test(name) && !/[A-Z]/.test(name.slice(1)) ? name.charAt(0).toUpperCase() + name.slice(1) : name);

// A skill is found in a text normalised this way, between spaces.
export const skillText = (d: string) => ` ${key(d)} `;

// A more precise skill that says the general one, as a recruiter reads it: MySQL is SQL, Scrum is
// Agile. The other way round never holds (SQL does not say MySQL).
const IMPLIED_BY: Record<string, string[]> = {
  sql: ["mysql", "postgresql", "postgre", "postgres", "sql server", "mssql", "t sql", "tsql", "pl sql", "plsql", "sqlite", "mariadb", "bigquery", "snowflake", "oracle sql"],
  agile: ["scrum", "kanban", "safe", "scrum master", "sprint"],
};
// Which precise skill of the text says this general one, if the general word itself is absent.
export function impliedBy(text: string, k: string): string | null {
  const t = ` ${key(text)} `;
  if (spellings(k).some((f) => t.includes(` ${f} `))) return null;
  return (IMPLIED_BY[k] ?? []).find((f) => t.includes(` ${f} `)) ?? null;
}

// Whether a CV says a skill: among the skills kept at the last analysis, or written in the CV summary,
// or through a more precise one (MySQL for SQL).
export function inCvCheck(cvText: string, cvSkills: string[]) {
  const cv = ` ${key(cvText)} `;
  const fromCv = new Set(cvSkills.map((n) => ALIASES[key(n)] ?? key(n)));
  const listed = ` ${[...fromCv].join(" ")} `;
  return (k: string) => fromCv.has(k) || spellings(k).some((f) => cv.includes(` ${f} `)) || (IMPLIED_BY[k] ?? []).some((f) => cv.includes(` ${f} `) || listed.includes(` ${f} `));
}

// A language is its name, whatever the level written ("anglais courant", "English").
const LANGUAGES: [RegExp, string][] = [
  [/\b(anglais|english)\b/, "Anglais"],
  [/\b(francais|french)\b/, "Français"],
  [/\b(espagnol|spanish)\b/, "Espagnol"],
  [/\b(allemand|german)\b/, "Allemand"],
  [/\b(italien|italian)\b/, "Italien"],
];

// What the offers of a selection ask for most, and whether the CV already says it.
export function topSkills(offers: { skills: Skill[] | null }[], cvText: string, perKind = 8, cvSkills: string[] = []): { read: number; byKind: Record<Skill["kind"], SkillStat[]> } {
  const read = offers.filter((o) => o.skills && o.skills.length > 0);
  const groups = new Map<string, { names: Map<string, number>; kind: Skill["kind"]; offers: Set<number> }>();
  read.forEach((o, index) => {
    for (const s of o.skills!) {
      const language = s.kind === "langue" ? LANGUAGES.find(([re]) => re.test(fold(s.name))) : undefined;
      const name = language ? language[1] : s.name;
      const k = ALIASES[key(name)] ?? key(name);
      if (!k) continue;
      const g = groups.get(k) ?? { names: new Map(), kind: s.kind, offers: new Set<number>() };
      g.offers.add(index);
      g.names.set(name, (g.names.get(name) ?? 0) + 1);
      groups.set(k, g);
    }
  });
  // "roadmap produit" joins "roadmap": the same skill with only a qualifier added. "data analysis" stays itself.
  const keys = [...groups.keys()].sort((a, b) => a.length - b.length);
  for (const long of keys) {
    const base = keys.find(
      (short) =>
        short !== long &&
        long.startsWith(`${short} `) &&
        long.slice(short.length + 1).split(" ").every((w) => QUALIFIERS.has(w)) &&
        groups.get(short)?.kind === groups.get(long)?.kind,
    );
    if (!base) continue;
    const from = groups.get(long)!;
    const to = groups.get(base)!;
    for (const i of from.offers) to.offers.add(i);
    groups.delete(long);
  }
  const cv = ` ${key(cvText)} `;
  const fromCv = new Set(cvSkills.map((n) => ALIASES[key(n)] ?? key(n)));
  const byKind: Record<Skill["kind"], SkillStat[]> = { outil: [], methode: [], savoir_etre: [], langue: [] };
  for (const [k, g] of groups) {
    // The spelling used most often is shown.
    const name = DISPLAY[k] ?? [...g.names.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const count = g.offers.size;
    byKind[g.kind].push({ name, kind: g.kind, count, share: Math.round((100 * count) / Math.max(1, read.length)), inCv: fromCv.has(k) || spellings(k).some((f) => cv.includes(` ${f} `)) });
  }
  for (const kind of Object.keys(byKind) as Skill["kind"][]) byKind[kind] = byKind[kind].filter((s) => s.count >= 2).sort((a, b) => b.count - a.count).slice(0, perKind);
  return { read: read.length, byKind };
}

// The skills (from Scout's list of skills asked by offers) that a CV mentions: kept instead of the CV.
export function cvSkillsFrom(cvText: string, names: string[]): string[] {
  const text = ` ${key(cvText)} `;
  const out = new Map<string, string>();
  for (const name of names) {
    const k = ALIASES[key(name)] ?? key(name);
    if (!k || out.has(k)) continue;
    // The whole phrase, as words: "redis" is not in "redistribution", "api" not in "apiculture".
    if (spellings(k).some((f) => text.includes(` ${f} `)) || (IMPLIED_BY[k] ?? []).some((f) => text.includes(` ${f} `))) out.set(k, name);
  }
  return [...out.values()];
}

// The same skill under another name in the text (English, abbreviation).
export const spellings = (k: string) => [k, ...Object.entries(ALIASES).filter(([, v]) => v === k).map(([a]) => a), ...(k === "anglai" ? ["english"] : [])];

// Words too general to be a skill on their own ("data", "produit"): never counted alone.
const TOO_GENERAL = new Set(["data", "analyse", "produit", "product", "digital", "projet", "project", "client", "gestion", "business", "management", "equipe", "outil", "process", "strategie", "it", "web", "tech", "technique", "service", "operation", "vision", "impact", "qualite", "suivi", "conseil", "performance", "informatique", "workflow", "impact direct", "outils digitaux", "digitalisation", "standard", "transformation"]);

const NEUTRAL = new Set(["produit", "product", "digital", "digitale", "professionnel", "professionnelle", "courant", "avance", "avancee", "solide", "efficace"]);
const SHORT_SKILLS = new Set(["ia", "ux", "ui", "qa", "bi", "ml", "r", "c"]);
// Job titles, perks and contract words are not skills.
const NOT_SKILLS = /^(product (manager|owner|designer)|chef de (projet|produit)|swile|ticket|mutuelle|teletravail|remote|cdi|cdd|stage|alternance|salaire|bspce|rtt)\b/;

// How many offers of the role really ask for each skill: every skill Scout has read in any offer is
// looked for, word for word, in the full text of each offer of the base. A skill the model did not list
// for a given offer is still counted when the offer names it.
export function skillDemand(descriptions: string[], vocabulary: Skill[], cvText: string, cvSkills: string[] = [], perKind = 10, parts: { required: string; bonus: string }[] = []): { read: number; byKind: Record<Skill["kind"], SkillStat[]> } {
  const groups = new Map<string, { names: Map<string, number>; kinds: Map<Skill["kind"], number> }>();
  for (const s of vocabulary) {
    const language = s.kind === "langue" ? LANGUAGES.find(([re]) => re.test(fold(s.name))) : undefined;
    const name = language ? language[1] : s.name;
    // The exact phrase: cutting "utilisateur" from "expérience utilisateur" would count every offer.
    const k = ALIASES[key(name)] ?? key(name);
    // Two letters only for known abbreviations ("go" is "go-to-market" more often than the language).
    if (!k || TOO_GENERAL.has(k) || NOT_SKILLS.test(k) || (k.length <= 2 && !SHORT_SKILLS.has(k))) continue;
    const g = groups.get(k) ?? { names: new Map(), kinds: new Map() };
    g.names.set(name, (g.names.get(name) ?? 0) + 1);
    g.kinds.set(s.kind, (g.kinds.get(s.kind) ?? 0) + 1);
    groups.set(k, g);
  }
  // "roadmap produit" and "roadmap digitale" are read as "roadmap" when that skill exists: only neutral
  // qualifiers, never "utilisateur" (which would turn "expérience utilisateur" into "expérience").
  for (const k of [...groups.keys()]) {
    const words = k.split(" ");
    const base = words.length > 1 && NEUTRAL.has(words[words.length - 1]) ? words.slice(0, -1).join(" ") : null;
    if (!base || !groups.has(base)) continue;
    const from = groups.get(k)!;
    const to = groups.get(base)!;
    for (const [n, c] of from.names) to.names.set(n, (to.names.get(n) ?? 0) + c);
    for (const [kd, c] of from.kinds) to.kinds.set(kd, (to.kinds.get(kd) ?? 0) + c);
    groups.delete(k);
  }
  const texts = descriptions.map((d) => ` ${key(d)} `);
  const split = parts.map((p) => ({ required: ` ${key(p.required)} `, bonus: ` ${key(p.bonus)} ` }));
  const cv = ` ${key(cvText)} `;
  const fromCv = new Set(cvSkills.map((n) => ALIASES[key(n)] ?? key(n)));
  const byKind: Record<Skill["kind"], SkillStat[]> = { outil: [], methode: [], savoir_etre: [], langue: [] };
  for (const [k, g] of groups) {
    const forms = spellings(k);
    const citing = texts.map((t, i) => (forms.some((f) => t.includes(` ${f} `)) ? i : -1)).filter((i) => i >= 0);
    const count = citing.length;
    if (count < 2) continue;
    // A common word ("recrutement" in "processus de recrutement") is everywhere but rarely what the offer
    // asks for: a single word must have been read as a skill in a fair share of the offers naming it.
    const extracted = [...g.names.values()].reduce((a, b) => a + b, 0);
    if (!k.includes(" ") && !SHORT_SKILLS.has(k) && extracted / count < 0.06 && extracted < 15) continue;
    const kind = [...g.kinds.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const name = DISPLAY[k] ?? [...g.names.entries()].filter(([n]) => (ALIASES[key(n)] ?? key(n)) === k).sort((a, b) => b[1] - a[1])[0]?.[0] ?? [...g.names.keys()][0];
    // Cited only in the "a plus" part of the offer: wanted, not required.
    const has = (t: string | undefined) => forms.some((f) => (t ?? "").includes(` ${f} `));
    const bonus = split.length ? citing.filter((i) => has(split[i]?.bonus) && !has(split[i]?.required)).length : 0;
    byKind[kind].push({ name, kind, key: k, count, bonus, share: Math.round((100 * count) / Math.max(1, texts.length)), inCv: fromCv.has(k) || spellings(k).some((f) => cv.includes(` ${f} `)) });
  }
  for (const kind of Object.keys(byKind) as Skill["kind"][]) byKind[kind] = byKind[kind].sort((a, b) => b.count - a.count).slice(0, perKind);
  return { read: texts.length, byKind };
}

// Every skill Scout has read in an offer (any role): the vocabulary a CV is matched against, word for
// word, without asking the model to summarise it.
export async function skillVocabulary(db: SupabaseClient): Promise<string[]> {
  const names = new Set<string>();
  for (let f = 0; ; f += 1000) {
    const { data } = await db.from("offers").select("skills").not("skills", "is", null).range(f, f + 999);
    for (const o of data ?? []) for (const sk of (o.skills as Skill[]) ?? []) names.add(sk.name);
    if (!data || data.length < 1000) break;
  }
  return [...names];
}
