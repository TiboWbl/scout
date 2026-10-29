import { CONTRACT_LABELS } from "@/lib/domain/criteria";
import { words } from "@/lib/search";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SCORE_SELECT } from "@/lib/domain/feed";

export const EXCLUDED_PAGE = 100;

// Set-aside offers, a page at a time. With a search, only those whose title or company matches: a
// company searched by name shows every offer Scout set aside there, each with its reason.
// Serves the signed-in person (browser client, RLS) and the demo (service role, `userId` given).
export async function loadExcludedPage(db: SupabaseClient, opts: { userId?: string; version?: number; from: number; search?: string }) {
  let ids: string[] | null = null;
  const term = (opts.search ?? "").replace(/[%_,()*\\]/g, " ").trim();
  if (term) {
    // By title and by company at once: one round trip less while the person waits.
    // By title or place, by contract ("V.I.E.", "CDI") and by company at once.
    const contract = Object.entries(CONTRACT_LABELS).find(([key, label]) => key !== "unknown" && (words(label) === words(term) || key === words(term)))?.[0];
    const [byTitle, byCompany, byContract] = await Promise.all([
      db.from("offers").select("id").is("archived_at", null).or(`title.ilike.%${term}%,location_raw.ilike.%${term}%`).limit(150),
      (async () => {
        const { data } = await db.from("companies").select("id").ilike("name", `%${term}%`).limit(50);
        const companyIds = (data ?? []).map((c) => c.id as string);
        return companyIds.length ? await db.from("offers").select("id").is("archived_at", null).in("company_id", companyIds).limit(150) : { data: [] };
      })(),
      contract ? db.from("offers").select("id").is("archived_at", null).eq("contract", contract).limit(300) : Promise.resolve({ data: [] }),
    ]);
    ids = [...new Set([...(byTitle.data ?? []), ...(byCompany.data ?? []), ...(byContract.data ?? [])].map((o) => o.id as string))];
    if (ids.length === 0) return [];
  }
  // Closed offers are neither listed nor counted.
  let query = db.from("offer_scores").select(SCORE_SELECT.replace("offer:offers(", "offer:offers!inner(")).eq("level", "ecartee").is("offer.archived_at", null);
  if (opts.userId) query = query.eq("user_id", opts.userId);
  if (opts.version !== undefined) query = query.eq("criteria_version", opts.version);
  if (ids) query = query.in("offer_id", ids);
  const { data } = await query.order("created_at", { ascending: false }).range(opts.from, opts.from + EXCLUDED_PAGE - 1);
  return data ?? [];
}
