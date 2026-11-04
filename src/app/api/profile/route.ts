import { after, NextResponse } from "next/server";
import { z } from "zod";
import { badRequest, requireUser } from "@/lib/api";
import { requestCollection } from "@/lib/collect/dispatch";
import { Criteria, CvSummary, hasMinimumCriteria } from "@/lib/domain/criteria";
import { loadMarketDataset } from "@/lib/market/compute";
import { refreshMarket } from "@/lib/market/store";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 60;

const Body = z.object({
  criteria: Criteria,
  searchText: z.string().max(6000).optional(),
  cvSummary: CvSummary.nullable().optional(),
  cvSkills: z.array(z.string().max(80)).max(300).optional(),
  cvFilename: z.string().max(200).optional(),
});

// Saving bumps the profile version: every active offer gets re-scored against the new criteria.
export async function POST(request: Request) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  const body = Body.safeParse(await request.json().catch(() => null));
  if (!body.success) return badRequest("Critères invalides");
  if (!hasMinimumCriteria(body.data.criteria)) return badRequest("Indique au moins un métier et un lieu.");

  const { supabase, user } = auth;
  const { data: current } = await supabase.from("profiles").select("criteria, criteria_version, onboarded_at").eq("id", user.id).single();
  const update: Record<string, unknown> = {
    criteria: body.data.criteria,
    criteria_version: (current?.criteria_version ?? 0) + 1,
    onboarded_at: current?.onboarded_at ?? new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  if (body.data.searchText !== undefined) update.search_text = body.data.searchText;
  if (body.data.cvSkills) update.cv_skills = body.data.cvSkills;
  if (body.data.cvSummary !== undefined) {
    update.cv_summary = body.data.cvSummary;
    update.cv_filename = body.data.cvFilename ?? null;
    update.cv_updated_at = new Date().toISOString();
  }

  // New roles, places or contracts: the offers to read change, so a full collection starts at once
  // instead of waiting for the next scheduled one.
  const c = body.data.criteria;
  const before = current?.criteria ? Criteria.safeParse(current.criteria).data : null;
  const searched = (x: Criteria) => JSON.stringify([x.targetRoles, x.titleVariants, x.bridgeRoles, x.zone, x.contracts, x.outOfZone]);
  // The role's market is collected from now on: its history starts here.
  // (Mon marché counts the first role and its equivalent titles: another role added changes nothing.)
  if (!before || JSON.stringify([before.targetRoles[0], before.titleVariants]) !== JSON.stringify([c.targetRoles[0], c.titleVariants])) update.roles_changed_at = new Date().toISOString();
  if (!before || searched(before) !== searched(c)) {
    if (await requestCollection()) update.collect_requested_at = new Date().toISOString();
  }

  const { error } = await supabase.from("profiles").update(update).eq("id", user.id);
  if (error) return NextResponse.json({ error: "Enregistrement impossible" }, { status: 500 });
  // A new role: its market is ready when the person opens it, without waiting for the daily job.
  if (JSON.stringify(before?.targetRoles ?? []) !== JSON.stringify(c.targetRoles)) {
    after(async () => {
      const db = createAdminClient();
      await refreshMarket(db, await loadMarketDataset(db), user.id).catch(() => null);
    });
  }
  return NextResponse.json({ ok: true, version: update.criteria_version, collecting: Boolean(update.collect_requested_at) });
}
