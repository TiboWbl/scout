import type { SupabaseClient } from "@supabase/supabase-js";
import type { Criteria } from "@/lib/domain/criteria";
import { roleText, splitRequirements } from "@/lib/domain/requirements";
import { isExcerptOnly } from "@/lib/collect/complete";
import { slug } from "@/lib/collect/normalize";
import type { Skill } from "@/lib/scoring/judge";
import { namesRole, titleRelevance } from "@/lib/scoring/relevance";
import { skillDemand, skillText, spellings, type SkillStat } from "@/lib/views/skills";

// The person's market: every offer whose title is the role sought (any level, any contract, that is the
// market), read the way a recruiter reads it. Counted by rules in the full texts, never estimated by the
// model. Computed once a day and kept, so the market can be followed as it moves.

const DAY = 86_400_000;
const MAX_BASE = 1500;
// The way the figures are counted. Pictures counted another way are never compared with today's:
// a change of method is not a change of the market.
export const MARKET_METHOD = 4;

export type Range = { low: number; median: number; high: number; n: number };
export type MarketSkill = SkillStat & { mine: number };
export type MarketCompany = { id: string; name: string; domain: string | null; brand: string | null; recent: number; before: number };
export type MarketData = {
  day: string;
  method?: number;
  role: string;
  total: number;
  newThisWeek: number;
  skills: MarketSkill[];
  experience: { buckets: { label: string; count: number }[]; juniorLabeled: number; juniorAsking2: number };
  salaries: { n: number; junior: Range | null; experienced: Range | null };
  remote: { remote: number; hybrid: number; onsite: number; unknown: number };
  // Absent from pictures taken before 14 October 2026.
  contracts?: Record<string, number>;
  // The role's titles as the offers write them, most frequent first (absent before 16 October 2026).
  titles?: { title: string; count: number }[];
  companies: MarketCompany[];
  // The person's own selection (offers Scout kept for them), to say where a skill would count.
  mine: number;
};

type Row = {
  id: string;
  title: string;
  company_id: string;
  first_seen_at: string;
  published_at: string | null;
  archived_at: string | null;
  skills: Skill[] | null;
  experience_min_years: number | null;
  experience_level: string | null;
  salary_text: string | null;
  remote: string;
  contract: string;
  sources: string[];
};

export type MarketDataset = { rows: Row[]; vocabulary: Skill[]; description: (ids: string[]) => Promise<Map<string, string>>; company: (ids: string[]) => Promise<Map<string, { name: string; domain: string | null; brand: string | null }>> };

// Every offer ever seen (active or archived), loaded once: enough to rebuild the market of any past day.
export async function loadMarketDataset(db: SupabaseClient): Promise<MarketDataset> {
  const rows: Row[] = [];
  for (let f = 0; ; f += 1000) {
    const { data, error } = await db
      .from("offers")
      .select("id, title, company_id, first_seen_at, published_at, archived_at, skills, experience_min_years, experience_level, salary_text, remote, contract, sources")
      .order("id")
      .range(f, f + 999);
    if (error) throw error;
    rows.push(...((data ?? []) as Row[]));
    if (!data || data.length < 1000) break;
  }
  const vocabulary = rows.flatMap((r) => (Array.isArray(r.skills) ? r.skills : []));
  const texts = new Map<string, string>();
  const companies = new Map<string, { name: string; domain: string | null; brand: string | null }>();
  return {
    rows,
    vocabulary,
    async description(ids) {
      const missing = [...new Set(ids)].filter((id) => !texts.has(id));
      for (let i = 0; i < missing.length; i += 150) {
        const { data } = await db.from("offers").select("id, description").in("id", missing.slice(i, i + 150));
        for (const o of data ?? []) texts.set(o.id as string, (o.description as string | null) ?? "");
      }
      return texts;
    },
    async company(ids) {
      const missing = [...new Set(ids)].filter((id) => !companies.has(id));
      for (let i = 0; i < missing.length; i += 150) {
        const { data } = await db.from("companies").select("id, name, domain, brand").in("id", missing.slice(i, i + 150));
        for (const c of data ?? []) companies.set(c.id as string, { name: c.name as string, domain: c.domain as string | null, brand: c.brand as string | null });
      }
      return companies;
    },
  };
}

// Freelance platforms and job boards post for others: they are not who hires.
const INTERMEDIARY = /collective\.?work|free-?work|malt\b|creme de la creme|freelance|jobs?\b|interim|staffing|talents?\b|recrutement|hays|michael page|robert half|nexton/;
// When the offer went out: the posting's own date when it gives one, else the day Scout first saw it.
const postedAt = (r: Row) => Date.parse(r.published_at ?? r.first_seen_at);

// What the offer itself displays: "junior" in its title. Internships and work-study are not junior jobs.
const JUNIOR_TITLE = /\b(junior|jr|debutant|debutante|jeune diplome|graduate|entry[- ]level)\b/;
const STUDENT = /\b(stage|stagiaire|intern|internship|alternance|alternant|alternante|apprenti|apprentie|apprentice|apprentissage|work[- ]study)\b/;
const isStudent = (r: Row) => r.contract === "stage" || r.contract === "alternance" || STUDENT.test(fold(r.title));
const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

// "45 à 55 k€ brut par an" → 50; "1 867 € à 2 134 € par mois" → 24. Thousands of euros a year.
export function salaryMidpoint(text: string): number | null {
  // The figures are gross a year: a net pay would read about 22 % too low.
  if (/\bnet\b/.test(text)) return null;
  const monthly = /par mois/.test(text);
  const values = [...text.matchAll(/(\d{1,3}(?:[  ]\d{3})*|\d+)(?:,\d+)?/g)].map((m) => Number(m[1].replace(/[  ]/g, "")));
  if (values.length === 0) return null;
  const mid = values.slice(0, 2).reduce((a, b) => a + b, 0) / Math.min(2, values.length);
  const yearly = monthly ? (mid * 12) / 1000 : mid >= 1000 ? mid / 1000 : mid;
  return yearly >= 15 && yearly <= 300 ? Math.round(yearly) : null;
}

function range(values: number[]): Range | null {
  if (values.length < 5) return null;
  const s = [...values].sort((a, b) => a - b);
  const at = (p: number) => s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))];
  return { low: at(0.25), median: at(0.5), high: at(0.75), n: s.length };
}

export async function computeMarket(
  set: MarketDataset,
  criteria: Criteria,
  { at = new Date(), cvText = "", cvSkills = [], selection = [], confirmed = [] }: { at?: Date; cvText?: string; cvSkills?: string[]; selection?: string[]; confirmed?: string[] } = {},
): Promise<MarketData> {
  const t = at.getTime();
  const ENGINE_ONLY = (r: Row) => r.sources.every((x) => ["adzuna", "jooble", "careerjet", "france-travail"].includes(x));
  const roleOnly = { ...criteria, bridgeRoles: [] };
  const relevance = new Map<string, number>();
  const isRole = (title: string) => {
    if (!relevance.has(title)) relevance.set(title, titleRelevance(title, roleOnly));
    return relevance.get(title)! >= 5;
  };
  const active = (r: Row) => Date.parse(r.first_seen_at) <= t && (!r.archived_at || Date.parse(r.archived_at) > t);
  const online = set.rows.filter((r) => active(r) && isRole(r.title)).slice(0, MAX_BASE);
  const texts = await set.description([...online.map((r) => r.id), ...selection]);
  // Only offers read in full count: an engine's 500-character excerpt would skew every figure.
  // The role itself: named in full by the title, or in part with the rest in the text ("Chef de projet"
  // saying "digital"); one shared word alone ("Designer") is another job.
  // Or a title close to the role that the model confirmed as the person's job ("Monteur audiovisuel",
  // "Cadreur monteur" for a video editor): creative and trade titles vary far more than the variants listed.
  const sure = new Set(confirmed);
  const named = online.filter((r) => !isExcerptOnly({ description: texts.get(r.id) ?? null, sources: r.sources }) && (namesRole(r.title, texts.get(r.id) ?? "", roleOnly) || sure.has(r.id)));
  // One posting, one count: the same text found twice (an engine's copy of the employer's page, the
  // same job posted twice) would weigh double in every share. The employer's own page is kept.
  const byText = new Map<string, Row>();
  for (const r of [...named].sort((a, b) => Number(ENGINE_ONLY(a)) - Number(ENGINE_ONLY(b)))) {
    const k = slug(texts.get(r.id) ?? "").slice(0, 3000);
    if (!byText.has(k)) byText.set(k, r);
  }
  const base = named.filter((r) => byText.get(slug(texts.get(r.id) ?? "").slice(0, 3000)) === r);
  const read = base;
  const known = new Set(base.map((r) => r.id));
  const copies = new Set(named.filter((r) => !known.has(r.id)).map((r) => r.id));

  // Skills are counted in the job itself (missions, profile), never in the company's presentation or
  // its perks: "au cœur des transformations du marché" asks nothing of the candidate.
  const withText = read.filter((r) => (texts.get(r.id) ?? "").length > 300);
  const descriptions = withText.map((r) => roleText(texts.get(r.id)!));
  const parts = descriptions.map((d) => splitRequirements(d));
  const demand = skillDemand(descriptions, set.vocabulary, cvText, cvSkills, 12, parts);

  // Where each skill would count for the person: the offers of their own selection that cite it.
  const mineTexts = selection.map((id) => skillText(roleText(texts.get(id) ?? ""))).filter((x) => x.length > 300);
  const skills: MarketSkill[] = (Object.values(demand.byKind) as SkillStat[][]).flat().map((s) => {
    const forms = spellings(s.key ?? "");
    return { ...s, mine: mineTexts.filter((x) => forms.some((f) => x.includes(` ${f} `))).length };
  });

  const junior = base.filter((r) => JUNIOR_TITLE.test(fold(r.title)) && !isStudent(r));
  const bucket = (r: Row) => {
    const y = r.experience_min_years;
    if (y === null || y === undefined) return r.experience_level === "experienced" ? "Expérimenté, sans durée" : "Non précisée";
    if (y <= 1) return "0 à 1 an";
    if (y < 3) return "2 ans";
    if (y < 5) return "3 à 4 ans";
    return "5 ans et plus";
  };
  const labels = ["0 à 1 an", "2 ans", "3 à 4 ans", "5 ans et plus", "Expérimenté, sans durée", "Non précisée"];
  const counts = new Map<string, number>();
  for (const r of base) counts.set(bucket(r), (counts.get(bucket(r)) ?? 0) + 1);

  // A job's pay only: an internship allowance or a work-study wage is not a junior salary.
  const pay = base.filter((r) => !isStudent(r)).map((r) => ({ r, k: r.salary_text ? salaryMidpoint(r.salary_text) : null })).filter((x): x is { r: Row; k: number } => x.k !== null);
  // Open to a beginner: at most a year asked, or no number and a junior title or wording.
  const isJunior = (r: Row) => (r.experience_min_years !== null ? r.experience_min_years <= 1 : junior.includes(r) || r.experience_level === "junior");

  const remote = { remote: 0, hybrid: 0, onsite: 0, unknown: 0 };
  for (const r of base) remote[(["remote", "hybrid", "onsite"].includes(r.remote) ? r.remote : "unknown") as keyof typeof remote]++;

  // Which of the role's titles the offers use, and how often: the words to write at the top of a CV.
  // Written in full ("Junior Product Manager" only when the title says "junior"); abbreviations
  // ("PM") are not titles to write on a CV.
  const words = (s: string) => ` ${fold(s).replace(/[^a-z0-9+#]+/g, " ").trim()} `;
  const titles = [...new Set([...criteria.targetRoles, ...criteria.titleVariants])]
    .filter((title) => title.trim().length > 4)
    .map((title) => ({ title, count: base.filter((r) => words(r.title).includes(words(title))).length }))
    .filter((t) => t.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  const contracts: Record<string, number> = {};
  for (const r of base) if (r.contract && r.contract !== "unknown") contracts[r.contract] = (contracts[r.contract] ?? 0) + 1;

  // Who hires for this role: offers first seen in the last 30 days, and in the 30 days before.
  const recent = new Map<string, number>();
  const before = new Map<string, number>();
  for (const r of set.rows) {
    // Offers of the base, or older ones whose title names the role in full.
    if (copies.has(r.id) || (!known.has(r.id) && (ENGINE_ONLY(r) || !isRole(r.title) || relevance.get(r.title)! < 7.5))) continue;
    const seen = postedAt(r);
    if (seen <= t && seen > t - 30 * DAY) recent.set(r.company_id, (recent.get(r.company_id) ?? 0) + 1);
    else if (seen <= t - 30 * DAY && seen > t - 60 * DAY) before.set(r.company_id, (before.get(r.company_id) ?? 0) + 1);
  }
  const ranked = [...recent.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20);
  const names = await set.company(ranked.map(([id]) => id));
  const top = ranked.filter(([id]) => names.get(id) && !INTERMEDIARY.test(fold(names.get(id)!.name))).slice(0, 8);

  return {
    day: at.toISOString().slice(0, 10),
    method: MARKET_METHOD,
    role: criteria.targetRoles[0] ?? "",
    total: base.length,
    newThisWeek: base.filter((r) => postedAt(r) > t - 7 * DAY && postedAt(r) <= t).length,
    skills,
    experience: {
      buckets: labels.map((label) => ({ label, count: counts.get(label) ?? 0 })).filter((b) => b.count > 0),
      juniorLabeled: junior.length,
      juniorAsking2: junior.filter((r) => (r.experience_min_years ?? 0) >= 2).length,
    },
    salaries: {
      n: pay.length,
      junior: range(pay.filter((p) => isJunior(p.r)).map((p) => p.k)),
      experienced: range(pay.filter((p) => (p.r.experience_min_years ?? 0) >= 3).map((p) => p.k)),
    },
    remote,
    contracts,
    titles,
    companies: top.map(([id, n]) => ({ id, name: names.get(id)?.name ?? "", domain: names.get(id)?.domain ?? null, brand: names.get(id)?.brand ?? null, recent: n, before: before.get(id) ?? 0 })).filter((c) => c.name),
    mine: mineTexts.length,
  };
}

// What the person's profile brings to the computation: the role, the CV's skills, their selection.
export async function profileInputs(db: SupabaseClient, profileId: string, { selection: withSelection = true } = {}) {
  const { data: p } = await db.from("profiles").select("criteria, criteria_version, cv_summary, cv_skills, roles_changed_at, onboarded_at").eq("id", profileId).single();
  const summary = (p?.cv_summary ?? {}) as Record<string, unknown>;
  const cvText = ["skills", "roles", "highlights", "education", "languages"].flatMap((k) => (Array.isArray(summary[k]) ? (summary[k] as string[]) : [])).join(" · ");
  const selection: string[] = [];
  // Offers the model judged a good match for the person: their role, confirmed on the missions.
  const confirmed: string[] = [];
  for (let f = 0; withSelection; f += 1000) {
    const { data } = await db
      .from("offer_scores")
      .select("offer_id, level, offer:offers!inner(archived_at)")
      .eq("user_id", profileId)
      .eq("criteria_version", p?.criteria_version ?? 0)
      .neq("level", "ecartee")
      .is("offer.archived_at", null)
      .range(f, f + 999);
    selection.push(...(data ?? []).map((r) => r.offer_id as string));
    confirmed.push(...(data ?? []).filter((r) => r.level === "coeur" || r.level === "solide").map((r) => r.offer_id as string));
    if (!data || data.length < 1000) break;
  }
  // The first full day of collection for these roles (the person's own search brings their offers in).
  const changed = (p?.roles_changed_at ?? p?.onboarded_at) as string | null;
  const historyFrom = changed ? new Date(Date.parse(changed) + 86_400_000).toISOString().slice(0, 10) : null;
  return { criteria: p?.criteria, historyFrom, cvText, cvSkills: Array.isArray(p?.cv_skills) ? (p!.cv_skills as string[]) : [], selection, confirmed };
}
