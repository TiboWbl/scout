import { redirect } from "next/navigation";
import { after } from "next/server";
import { AppShell } from "@/components/app-shell";
import { SortingProvider } from "@/components/sorting-progress";
import { createAdminClient } from "@/lib/supabase/admin";
import { isInvited } from "@/lib/access";
import { followUpDue, isUpcoming, type Application } from "@/lib/domain/application";
import { getUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { supabase, user } = await getUser();
  if (!user) redirect("/");
  // Both checks at once: every tab waits for them.
  const [invited, { data: profile }, { data: apps }] = await Promise.all([
    isInvited(user.email, user.id),
    supabase.from("profiles").select("display_name, onboarded_at, last_seen_at, criteria_version, updated_at").eq("id", user.id).single(),
    supabase.from("applications").select("stage, applied_at, interview_at, followed_up_at, created_at").eq("user_id", user.id),
  ]);
  if (!invited) redirect("/invitation");
  if (!profile?.onboarded_at) redirect("/onboarding");
  // Follow-ups due and interviews coming: shown on "Suivi", where they are handled.
  // eslint-disable-next-line react-hooks/purity -- server component, rendered once per request
  const now = Date.now();
  // The last visit, for the admin's list of users: written at most every 15 minutes, after the page.
  if (!profile.last_seen_at || now - Date.parse(profile.last_seen_at) > 15 * 60_000)
    after(async () => {
      await supabase.from("profiles").update({ last_seen_at: new Date(now).toISOString() }).eq("id", user.id);
    });
  const todo = ((apps ?? []) as Application[]).filter((a) => followUpDue(a, now) || isUpcoming(a.interview_at, now)).length;

  // What is left to sort for the current search, for the sort that runs across the whole app.
  const version: number = profile.criteria_version ?? 0;
  const [active, scored, { data: lastRun }] = await Promise.all([
    supabase.from("offers").select("id", { count: "exact", head: true }).is("archived_at", null),
    supabase.from("offer_scores").select("offer_id, offer:offers!inner(archived_at)", { count: "exact", head: true }).eq("user_id", user.id).eq("criteria_version", version).is("offer.archived_at", null),
    createAdminClient().from("collection_runs").select("started_at").order("started_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const pending = Math.max(0, (active.count ?? 0) - (scored.count ?? 0));
  // A collection that just ran sorts everyone's new offers itself: the visit does not do it a second
  // time, unless the search was just changed and is awaited.
  const ciSorting = Boolean(lastRun && now - new Date(lastRun.started_at).getTime() < 40 * 60_000);
  const searchChanged = Boolean(profile.updated_at && now - new Date(profile.updated_at).getTime() < 60 * 60_000);

  return (
    <SortingProvider pending={pending} enabled={!ciSorting || searchChanged} version={version}>
      <AppShell user={user} firstName={profile.display_name || null} todo={todo}>
        {children}
      </AppShell>
    </SortingProvider>
  );
}
