import { after } from "next/server";
import { isDispatchConfigured, requestCollection } from "@/lib/collect/dispatch";
import { isAdminEmail } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUser } from "@/lib/supabase/server";
import { loadFeed } from "@/lib/views/feed";
import { SearchEditor } from "@/components/search-editor";
import { Feed } from "./feed";

export const metadata = { title: "Offres" };

// ?offre=<id> opens that offer directly (links from Aujourd'hui); ?q= starts with a search (Entreprises).
export default async function OffresPage({ searchParams }: { searchParams: Promise<{ offre?: string; q?: string }> }) {
  const { offre, q } = await searchParams;
  const { supabase, user } = await getUser();
  const [data, { data: profile }, { data: lastRun }] = await Promise.all([
    loadFeed(supabase, user!.id),
    supabase.from("profiles").select("collect_requested_at, updated_at").eq("id", user!.id).single(),
    // Only the time of the latest collection (shared, no personal data).
    createAdminClient().from("collection_runs").select("started_at").order("started_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  // A collection asked for after a change of search, not run yet (it takes about ten minutes).
  const requested = profile?.collect_requested_at ? new Date(profile.collect_requested_at).getTime() : 0;
  // eslint-disable-next-line react-hooks/purity -- server component, rendered once per request
  const now = Date.now();
  const collecting = requested > now - 45 * 60_000 && (!lastRun || new Date(lastRun.started_at).getTime() < requested);
  // GitHub's schedule is sometimes late or skipped: past 8 hours without a collection, the visit starts one
  // (at most once every 45 minutes per person).
  const stale = !lastRun || now - new Date(lastRun.started_at).getTime() > 8 * 3_600_000;
  // Started quietly: the person did not ask for it, the new offers simply appear.
  if (stale && !collecting && isDispatchConfigured()) {
    const userId = user!.id;
    // After the response, without request cookies: the service client records the request time.
    after(async () => {
      if (await requestCollection()) await createAdminClient().from("profiles").update({ collect_requested_at: new Date().toISOString() }).eq("id", userId);
    });
  }
  // A collection that just ran sorts everyone's new offers itself: the visit does not do it a second time
  // (the same work twice slowed the whole site), unless the search was just changed and is awaited.
  const ciSorting = Boolean(lastRun && now - new Date(lastRun.started_at).getTime() < 40 * 60_000);
  const searchChanged = Boolean(profile?.updated_at && now - new Date(profile.updated_at).getTime() < 60 * 60_000);
  return <Feed {...data} sortHere={!ciSorting || searchChanged} collecting={collecting} collectingSince={collecting ? (profile?.collect_requested_at ?? null) : null} initialOpenId={offre ?? null} initialQuery={q?.slice(0, 80) ?? ""} searchEditor={<SearchEditor />} isAdmin={isAdminEmail(user!.email)} />;
}
