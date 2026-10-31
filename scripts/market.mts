// Today's market for every person (what the offers of their role ask for), after each sort.
// Usage: npm run market. Logs aggregated counts only (CI logs are public).
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

const { createAdminClient } = await import("@/lib/supabase/admin");
const { loadMarketDataset } = await import("@/lib/market/compute");
const { refreshMarket } = await import("@/lib/market/store");

const db = createAdminClient();
const started = Date.now();
const { data: profiles } = await db.from("profiles").select("id").not("onboarded_at", "is", null);
// One picture a day: the market moves slowly, and loading every offer is the free plan's costliest read.
// A new role gets its market as soon as it is saved, without waiting for this job.
const day = new Date().toISOString().slice(0, 10);
const { count } = await db.from("market_snapshots").select("profile_id", { count: "exact", head: true }).eq("day", day);
if ((count ?? 0) >= (profiles?.length ?? 0)) {
  console.log("Marchés : déjà à jour aujourd'hui");
  process.exit(0);
}
const set = await loadMarketDataset(db);
let done = 0;
let failed = 0;
for (const { id } of profiles ?? []) {
  const ok = await refreshMarket(db, set, id).catch(() => null);
  if (ok) done++;
  else failed++;
}
console.log(`Marchés : ${done} à jour, ${failed} en échec, ${set.rows.length} offres lues, ${Math.round((Date.now() - started) / 1000)} s`);
