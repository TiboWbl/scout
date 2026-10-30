import type { SupabaseClient } from "@supabase/supabase-js";
import { Criteria } from "@/lib/domain/criteria";
import { SCORE_SELECT, withoutEngineCopies, type FeedItem } from "@/lib/domain/feed";

// Data for the Offres screen. The same loader serves a signed-in person (their own client, RLS) and
// the public demo (service role, the demo persona's id): every query filters on the user explicitly.
export async function loadFeed(db: SupabaseClient, userId: string) {
  const { data: profile } = await db.from("profiles").select("criteria, criteria_version").eq("id", userId).single();
  const criteria = Criteria.parse(profile?.criteria ?? {});
  const version: number = profile?.criteria_version ?? 0;

  // Set-aside offers are only counted here; the "Écartées" view loads them on demand.
  const [selected, actions, favorites, activeCount, scoredCount] = await Promise.all([
    db.from("offer_scores").select(SCORE_SELECT).eq("user_id", userId).eq("criteria_version", version).neq("level", "ecartee").limit(1500),
    db.from("user_offers").select("offer_id, saved, dismissed").eq("user_id", userId),
    db.from("favorite_companies").select("company_id").eq("user_id", userId),
    db.from("offers").select("id", { count: "exact", head: true }).is("archived_at", null),
    // Sorted offers still active: scores of archived offers must not hide offers waiting to be sorted.
    db.from("offer_scores").select("offer_id, offer:offers!inner(archived_at)", { count: "exact", head: true }).eq("user_id", userId).eq("criteria_version", version).is("offer.archived_at", null),
  ]);

  const actionByOffer = new Map((actions.data ?? []).map((a) => [a.offer_id, a]));
  type Row = Omit<FeedItem, "offer" | "saved" | "dismissed"> & { offer: (FeedItem["offer"] & { archived_at: string | null }) | null };
  const items: FeedItem[] = withoutEngineCopies(((selected.data ?? []) as unknown as Row[])
    .filter((r) => r.offer && !r.offer.archived_at)
    .map((r) => ({
      ...r,
      offer: r.offer!,
      saved: actionByOffer.get(r.offer!.id)?.saved ?? false,
      dismissed: actionByOffer.get(r.offer!.id)?.dismissed ?? false,
    })));

  // Set aside = sorted and still online, minus the selection: one count fewer to wait for (the
  // direct count was the slowest query of the page).
  const shownOnline = ((selected.data ?? []) as unknown as Row[]).filter((r) => r.offer && !r.offer.archived_at).length;
  const pending = Math.max(0, (activeCount.count ?? 0) - (scoredCount.count ?? 0));

  // A search just changed and is being sorted: the previous selection stays on screen, marked as such,
  // until each offer gets its new verdict (never an empty page while Scout reads).
  if (pending > 0 && version > 1) {
    const { data: older } = await db.from("offer_scores").select(`criteria_version, ${SCORE_SELECT}`).eq("user_id", userId).lt("criteria_version", version).neq("level", "ecartee").order("criteria_version", { ascending: false }).limit(1500);
    const latest = (older ?? []) as unknown as (Row & { criteria_version: number })[];
    const last = latest[0]?.criteria_version;
    const candidates = latest.filter((r) => r.criteria_version === last && r.offer && !r.offer.archived_at);
    const shown = new Set(items.map((i) => i.offer.id));
    const ids = candidates.map((r) => r.offer!.id).filter((id) => !shown.has(id));
    // Offers already judged for the new search keep only their new verdict.
    const judged = new Set<string>();
    for (let i = 0; i < ids.length; i += 300) {
      const { data } = await db.from("offer_scores").select("offer_id").eq("user_id", userId).eq("criteria_version", version).in("offer_id", ids.slice(i, i + 300));
      for (const r of data ?? []) judged.add(r.offer_id as string);
    }
    for (const r of candidates)
      if (!shown.has(r.offer!.id) && !judged.has(r.offer!.id))
        items.push({ ...r, offer: r.offer!, previous: true, saved: actionByOffer.get(r.offer!.id)?.saved ?? false, dismissed: actionByOffer.get(r.offer!.id)?.dismissed ?? false });
  }

  return {
    items,
    openness: criteria.openness,
    pending,
    excludedCount: Math.max(0, (scoredCount.count ?? 0) - shownOnline),
    favoriteCompanyIds: (favorites.data ?? []).map((f) => f.company_id as string),
    criteriaVersion: version,
    total: activeCount.count ?? 0,
    hasOffers: (activeCount.count ?? 0) > 0,
  };
}
