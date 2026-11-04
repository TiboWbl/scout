import type { SupabaseClient } from "@supabase/supabase-js";
import { Criteria } from "@/lib/domain/criteria";
import { computeMarket, MARKET_METHOD, profileInputs, type MarketData, type MarketDataset } from "./compute";

const DAY = 86_400_000;
// The first day every source was in place: before it, the market looked smaller than it was.
export const MARKET_START = "2026-10-08";

export type Snapshot = { day: string; data: MarketData };

// The first day a picture of this person's market can be trusted.
export const historyStart = (historyFrom: string | null) => (historyFrom && historyFrom > MARKET_START ? historyFrom : MARKET_START);

// `role`: '' for the first role sought (with its equivalent titles), or the name of another role sought.
export async function snapshots(db: SupabaseClient, profileId: string, role = ""): Promise<Snapshot[]> {
  const { data } = await db.from("market_snapshots").select("day, data").eq("profile_id", profileId).eq("role", role).order("day", { ascending: false }).limit(60);
  return (data ?? []) as Snapshot[];
}

// Today's picture of the person's market, with a week of history rebuilt when there is none yet
// (from what was online each day).
export async function refreshMarket(db: SupabaseClient, set: MarketDataset, profileId: string) {
  const inputs = await profileInputs(db, profileId);
  const criteria = Criteria.parse(inputs.criteria ?? {});
  if (criteria.targetRoles.length === 0) return null;
  const known = await snapshots(db, profileId);
  const today = await computeMarket(set, criteria, { cvText: inputs.cvText, cvSkills: inputs.cvSkills, selection: inputs.selection, confirmed: inputs.confirmed });

  const rows: { profile_id: string; day: string; role?: string; data: MarketData }[] = [{ profile_id: profileId, day: today.day, data: today }];

  // History once a week back to the start (or to the day Scout started collecting these roles), for
  // the days not kept yet or counted another way.
  const from = historyStart(inputs.historyFrom);
  const days = new Set(known.filter((s) => s.data.method === MARKET_METHOD).map((s) => s.day));
  const back: number[] = [];
  for (let t = Date.now() - 7 * DAY; new Date(t).toISOString().slice(0, 10) >= from; t -= 7 * DAY) back.push(t);
  // The start itself, when the weekly steps miss it by more than three days.
  const start = Date.parse(`${from}T12:00:00Z`);
  if (Date.now() - start >= 5 * DAY && !back.some((t) => Math.abs(t - start) < 3 * DAY)) back.push(start);
  for (const t of back) {
    const day = new Date(t).toISOString().slice(0, 10);
    if (days.has(day)) continue;
    rows.push({ profile_id: profileId, day, data: await computeMarket(set, criteria, { at: new Date(t), cvText: inputs.cvText, cvSkills: inputs.cvSkills, confirmed: inputs.confirmed }) });
  }
  // The other roles sought, each on its own: the role alone, without the first role's equivalent titles.
  // Their history starts the day they are first counted.
  const others = otherRoles(criteria);
  for (const role of others) rows.push({ profile_id: profileId, day: today.day, role, data: await computeMarket(set, roleCriteria(criteria, role), { cvText: inputs.cvText, cvSkills: inputs.cvSkills, confirmed: inputs.confirmed }) });
  const { error } = await db.from("market_snapshots").upsert(rows.map((r) => ({ role: "", ...r })), { onConflict: "profile_id,day,role" });
  if (error) throw error;
  // A role no longer sought: its pictures go.
  const { data: kept } = await db.from("market_snapshots").select("role").eq("profile_id", profileId).neq("role", "");
  const gone = [...new Set((kept ?? []).map((r) => r.role as string))].filter((r) => !others.includes(r));
  if (gone.length) await db.from("market_snapshots").delete().eq("profile_id", profileId).in("role", gone);
  return today;
}

// At most three other roles, so the daily job stays short.
export const otherRoles = (c: Criteria) => [...new Set(c.targetRoles.slice(1).map((r) => r.trim()).filter((r) => r && r.toLowerCase() !== c.targetRoles[0]?.trim().toLowerCase()))].slice(0, 3);
const roleCriteria = (c: Criteria, role: string): Criteria => ({ ...c, targetRoles: [role], titleVariants: [] });

// One other role's picture of today, when it is opened before the daily job counted it.
export async function refreshRole(db: SupabaseClient, set: MarketDataset, profileId: string, role: string) {
  const inputs = await profileInputs(db, profileId);
  const criteria = Criteria.parse(inputs.criteria ?? {});
  if (!otherRoles(criteria).includes(role)) return null;
  const today = await computeMarket(set, roleCriteria(criteria, role), { cvText: inputs.cvText, cvSkills: inputs.cvSkills, confirmed: inputs.confirmed });
  const { error } = await db.from("market_snapshots").upsert({ profile_id: profileId, day: today.day, role, data: today }, { onConflict: "profile_id,day,role" });
  if (error) throw error;
  return today;
}
