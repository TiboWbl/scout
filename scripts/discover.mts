// Grows the directory of career pages. Usage: npm run discover -- [--crawls 3] [--names 300]
// Prints aggregated counts only (these logs may end up public in CI).
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

const arg = (name: string, fallback: number) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? Number(process.argv[i + 1]) : fallback;
};

const { createAdminClient } = await import("@/lib/supabase/admin");
const { crawlCandidates, discover, markNamesChecked, nameCandidates } = await import("@/lib/collect/discover");

const db = createAdminClient();
const started = Date.now();
const log = (line: string) => console.log(line);

const crawls = arg("crawls", 3);
const fromCrawl = crawls > 0 ? await crawlCandidates(crawls, log) : [];
log(`index public : ${fromCrawl.length} pages carrière candidates`);
const { candidates: fromNames, companyIds } = await nameCandidates(db, arg("names", 300));
log(`noms d'entreprises vus dans les offres : ${companyIds.length} à vérifier`);

const report = await discover(db, [...fromCrawl, ...fromNames], { log });
await markNamesChecked(db, companyIds);
// The sectors people put first: their companies, start-ups included, looked for by name (counts only).
const { getLlm } = await import("@/lib/llm");
const { discoverSector, discoverSimilar, favoritesSought, sectorsSought } = await import("@/lib/collect/sectors");
for (const sector of await sectorsSought(db)) {
  const r = await discoverSector(db, getLlm(), sector).catch(() => null);
  if (r) log(`secteur prioritaire : ${r.proposed} entreprises proposées, ${r.added} pages carrière ajoutées, ${r.offers} offres lues`);
}
// Companies like each person's favourites (counts only).
for (const favorites of await favoritesSought(db)) {
  const r = await discoverSimilar(db, getLlm(), favorites).catch(() => null);
  if (r) log(`comme les favorites : ${r.proposed} entreprises proposées, ${r.added} pages carrière ajoutées, ${r.offers} offres lues`);
}
log(`\n${report.added} entreprises ajoutées sur ${report.checked} vérifiées ${JSON.stringify(report.byAts)}, ${Math.round((Date.now() - started) / 1000)} s`);
