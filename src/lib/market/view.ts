import type { SupabaseClient } from "@supabase/supabase-js";
import { marketInsights, type MarketInsights } from "./advice";
import { loadMarketDataset, MARKET_METHOD, profileInputs, type MarketData } from "./compute";
import { inCvCheck } from "@/lib/views/skills";
import { historyStart, refreshMarket, snapshots } from "./store";

const DAY = 86_400_000;

// `cvKnown`: the CV's own words are known (found word for word in it), so it can be compared.
export type MarketPage = { today: MarketData; since: string | null; trend: Record<string, number>; insights: MarketInsights; cvKnown: boolean };

// The twelve skills most asked in the person's market, most asked first: the same list Mon CV checks
// the CV against, so the two pages never disagree. Empty when the market cannot be computed.
export async function marketTop(db: SupabaseClient, userId: string): Promise<{ name: string; key: string; share: number; kind: string }[]> {
  return (await marketForCv(db, userId)).skills;
}

// What Mon CV needs from the market: its twelve skills (with their share of offers) and the role's
// titles as the offers write them.
export async function marketForCv(db: SupabaseClient, userId: string): Promise<{ skills: { name: string; key: string; share: number; kind: string }[]; titles: { title: string; count: number }[] }> {
  const page = await marketPage(db, userId).catch(() => null);
  if (!page) return { skills: [], titles: [] };
  return {
    skills: [...page.insights.show, ...page.insights.add].sort((a, b) => b.share - a.share).map((i) => ({ name: i.name, key: i.key, share: i.share, kind: i.kind })),
    titles: page.today.titles ?? [],
  };
}

// The latest picture, compared with the one about a week before (or the oldest kept). The very first
// visit computes it on the spot; the daily job keeps it fresh afterwards.
export async function marketPage(db: SupabaseClient, userId: string): Promise<MarketPage | null> {
  let kept = await snapshots(db, userId);
  if (kept.length === 0) {
    await refreshMarket(db, await loadMarketDataset(db), userId);
    kept = await snapshots(db, userId);
  }
  const latest = kept[0]?.data;
  if (!latest) return null;
  // "In your CV" as of now: a CV analysed since the snapshot counts at once. Only the skills found word
  // for word in the CV itself: a summary written by the model can turn "Premiere Pro" into "montage",
  // and the page would then ask to add what the CV already says.
  const { cvSkills, historyFrom } = await profileInputs(db, userId, { selection: false });
  const cvKnown = cvSkills.length > 0;
  const has = inCvCheck("", cvSkills);
  const today: MarketData = { ...latest, skills: latest.skills.map((s) => ({ ...s, inCv: cvKnown && has(s.key ?? "") })) };
  const t = Date.parse(kept[0].day);
  // Only pictures counted the same way: a change of method must never show as a change of the market.
  // Never before Scout collected these roles: the market would look like it grew.
  const older = kept.filter((s) => s.day >= historyStart(historyFrom) && Date.parse(s.day) <= t - 5 * DAY && s.data.role === today.role && s.data.method === today.method && today.method === MARKET_METHOD);
  const ref = older.sort((a, b) => Math.abs(Date.parse(a.day) - (t - 7 * DAY)) - Math.abs(Date.parse(b.day) - (t - 7 * DAY)))[0];
  const trend: Record<string, number> = {};
  if (ref)
    for (const s of today.skills) {
      const before = ref.data.skills.find((r) => r.key === s.key);
      // A move of one or two offers is not a trend, however large in points on a small market.
      if (before && Math.abs(s.count - before.count) >= 3) trend[s.key ?? s.name] = s.share - before.share;
    }
  // Each skill's average share over the pictures of the last two weeks counted the same way.
  const recent = kept.filter((s) => s.data.method === today.method && s.day >= historyStart(historyFrom) && Date.parse(s.day) > t - 14 * DAY);
  const steady: Record<string, number> = {};
  for (const s of today.skills) {
    const k = s.key ?? s.name;
    const shares = recent.map((r) => r.data.skills.find((x) => (x.key ?? x.name) === k)?.share ?? 0);
    steady[k] = shares.length ? shares.reduce((a, b) => a + b, 0) / shares.length : s.share;
  }
  return { today, since: ref?.day ?? null, trend, insights: marketInsights(today, steady), cvKnown };
}
