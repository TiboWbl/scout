import type { SupabaseClient } from "@supabase/supabase-js";
import { Criteria } from "@/lib/domain/criteria";
import type { NormalizedOffer } from "@/lib/domain/offer";
import { fetchBoard, SEED_BOARDS, type Ats, type Board } from "./connectors/ats";
import type { Keep, Wanted } from "./connectors/ats-more";
import { titleRelevance } from "@/lib/scoring/relevance";
import { detectExperience, detectExperienceLevel, detectRemote, detectSalary } from "@/lib/domain/signals";
import { fetchAdzuna, isAdzunaConfigured, type SearchQuery } from "./connectors/adzuna";
import { fetchJooble, isJoobleConfigured } from "./connectors/jooble";
import { extractAccent } from "./colors";
import { mergeEngineCopies, verifyEngineOffers } from "./complete";
import { fillCovers, fillOfferImages } from "./cover";
import { enrichCompanies, guessDomains } from "./enrich";
import { companyKey, offerKey } from "./normalize";

export type SourceReport = { source: string; seen: number; created: number; archived: number; error?: string };

// Adzuna's free plan allows about 250 calls a day over five collections: 10 searches of 3 pages and
// 15 favourite companies (one page each) per collection.
const MAX_GENERATED_QUERIES = 10;
const MAX_FAVORITE_QUERIES = 15;
const COLOR_BATCH = 150;
const RETENTION_DAYS = 60;
// Search engines never say when an offer is withdrawn: unseen for this long, it is archived.
const ENGINE_STALE_DAYS = 21;
const ENGINE_SOURCES = ["adzuna", "jooble", "careerjet", "france-travail"];
const BOARD_CONCURRENCY = 6;

// Logs stay aggregated: counts per source, never anything about a user.
type Log = (line: string) => void;
type Options = { log?: Log; budgetMs?: number };

// wanted: whether a title is close to a role or bridge someone looks for (big boards fetch details only for those).
type Scope = { queries: SearchQuery[]; countries: Set<string>; wanted: Wanted };

export async function runCollection(db: SupabaseClient, { log = () => {}, budgetMs = Infinity }: Options = {}): Promise<SourceReport[]> {
  const startedAt = Date.now();
  await seedBoards(db);
  const scope = await scopeFromProfiles(db);
  const keep = keepInScope(scope);
  const wanted = scope.wanted;
  const reports: SourceReport[] = [];

  // Search engines first: they bring the most offers for the people actually using Scout.
  const engines: { source: string; run: () => Promise<NormalizedOffer[]> }[] = [];
  if (scope.queries.length && isAdzunaConfigured()) engines.push({ source: "adzuna", run: () => fetchAdzuna(scope.queries) });
  if (scope.queries.length && isJoobleConfigured()) engines.push({ source: "jooble", run: () => fetchJooble(scope.queries) });
  reports.push(...(await Promise.all(engines.map((e) => collectSource(db, e.source, e.run, false, keep)))));

  // Then career pages, least recently collected first, as many as the time budget allows.
  const boards = await loadBoards(db);
  const byAts = new Map<string, SourceReport>();
  let next = 0;
  const worker = async () => {
    while (next < boards.length && Date.now() - startedAt < budgetMs) {
      const board = boards[next++];
      const r = await collectBoard(db, board, keep, wanted);
      const agg = byAts.get(board.ats) ?? { source: board.ats, seen: 0, created: 0, archived: 0 };
      agg.seen += r.seen;
      agg.created += r.created;
      agg.archived += r.archived;
      if (r.error && !agg.error) agg.error = `${board.token}: ${r.error}`;
      byAts.set(board.ats, agg);
    }
  };
  await Promise.all(Array.from({ length: BOARD_CONCURRENCY }, worker));
  for (const agg of byAts.values()) {
    reports.push(agg);
    await recordRun(db, agg, new Date(startedAt).toISOString());
  }
  log(`pages carrière lues : ${next} sur ${boards.length}`);
  for (const r of reports) log(`${r.source}: ${r.seen} vues, ${r.created} nouvelles, ${r.archived} archivées${r.error ? " (erreur)" : ""}`);

  if (Date.now() - startedAt < budgetMs) {
    // Who really recruits (group, institution) and a verified domain, before logos are coloured.
    await enrichCompanies(db).catch(() => null);
    // Employers of offers someone sees, known by name only: their site, checked against their postings.
    await guessDomains(db, await shownCompanyIds(db)).catch(() => 0);
    await fillCompanyColors(db);
    await fillCovers(db).catch(() => null);
    await fillOfferImages(db).catch(() => null);
    // Search engines keep closed postings: their offers are checked again, closed ones archived.
    const checked = await verifyEngineOffers(db).catch(() => null);
    if (checked) log(`moteurs revérifiés : ${checked.gone} fermées, ${checked.full} complétées, ${checked.excerpt} extraits illisibles, ${checked.alive} toujours en ligne`);
    const merged = await mergeEngineCopies(db).catch(() => null);
    if (merged) log(`copies de moteurs fusionnées : ${merged}`);
    await archiveStaleEngineOffers(db);
    await purgeOldDescriptions(db);
  }
  return reports;
}

async function seedBoards(db: SupabaseClient) {
  const rows = SEED_BOARDS.map((b) => ({ name: b.name, name_key: companyKey(b.name), domain: b.domain, ats: b.ats, ats_token: b.token, discovered_via: "seed" }));
  await db.from("companies").upsert(rows, { onConflict: "name_key", ignoreDuplicates: true });
}

async function loadBoards(db: SupabaseClient): Promise<(Board & { id: string })[]> {
  const out: (Board & { id: string })[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from("companies")
      .select("id, name, domain, ats, ats_token")
      .not("ats", "is", null)
      .order("last_collected_at", { ascending: true, nullsFirst: true })
      .range(from, from + 999);
    if (error) throw error;
    out.push(...(data ?? []).map((c) => ({ id: c.id, name: c.name, domain: c.domain, ats: c.ats as Ats, token: c.ats_token })));
    if (!data || data.length < 1000) return out;
  }
}

// Search queries and kept countries come only from the profiles in the database: every user widens
// the coverage, and nothing is stored for places nobody is looking at (the free database is 500 MB).
export async function scopeFromProfiles(db: SupabaseClient): Promise<Scope> {
  const { data } = await db.from("profiles").select("criteria, is_demo").not("onboarded_at", "is", null);
  // Each person's titles, their roles first: searched in turns, one per person, so no profile takes
  // every search (ties used to go to whoever came first in the table).
  const perPerson: SearchQuery[][] = [];
  const countries = new Set<string>();
  const sought: Criteria[] = [];
  for (const row of data ?? []) {
    const parsed = Criteria.safeParse(row.criteria);
    if (!parsed.success) continue;
    const c = parsed.data;
    sought.push(c);
    for (const p of c.zone.places) countries.add(p.country);
    // The demo persona does not spend the search engines' quotas.
    if (row.is_demo) continue;
    const place = c.zone.places.find((p) => p.kind !== "country") ?? c.zone.places[0] ?? null;
    const where = place?.label ?? null;
    perPerson.push([...c.targetRoles, ...c.titleVariants].map((what) => ({ what: what.trim(), where, country: place?.country ?? null })));
  }
  const queries: SearchQuery[] = [];
  const seen = new Set<string>();
  for (let round = 0; queries.length < MAX_GENERATED_QUERIES && perPerson.some((list) => list.length > round); round++) {
    for (const list of perPerson) {
      const q = list[round];
      const key = q ? `${q.what.toLowerCase()}|${q.where ?? ""}` : "";
      if (!q || seen.has(key) || queries.length >= MAX_GENERATED_QUERIES) continue;
      seen.add(key);
      queries.push(q);
    }
  }
  // Favourite companies whose career page Scout cannot read: searched by name, so none is missed.
  const { data: favs } = await db.from("favorite_companies").select("company:companies(name, ats)");
  const favNames = [...new Set((favs ?? []).map((f) => f.company as unknown as { name: string; ats: string | null } | null).filter((c) => c && !c.ats).map((c) => c!.name))];
  queries.push(...favNames.slice(0, MAX_FAVORITE_QUERIES).map((company) => ({ what: "", where: null, country: [...countries][0] ?? "FR", company })));
  const wanted: Wanted = (title) => sought.length === 0 || sought.some((c) => titleRelevance(title, c) >= 3);
  return { queries, countries, wanted };
}

export function keepInScope(scope: Scope): Keep {
  // No profile yet: keep everything rather than nothing.
  if (scope.countries.size === 0) return () => true;
  // An explicit country is required: "Remote" alone is usually a US-only posting.
  return (places) => places.some((p) => p.country !== undefined && scope.countries.has(p.country));
}

export async function collectBoard(db: SupabaseClient, board: Board & { id: string }, keep: Keep, wanted?: Wanted): Promise<SourceReport> {
  const startedAt = new Date().toISOString();
  const source = `${board.ats}:${board.token}`;
  const report: SourceReport = { source, seen: 0, created: 0, archived: 0 };
  try {
    const all = await fetchBoard(board, keep, wanted);
    // A board's offers belong to the company that owns the board, whatever name its feed shows
    // (Yousign's Teamtailor feed is titled "Youtrust"): the favourite and its offers stay together.
    const offers = all.filter((o) => keep(o.places, o.remote)).map((o) => ({ ...o, company: { ...o.company, name: board.name } }));
    report.seen = offers.length;
    report.created = await upsertOffers(db, offers);
    // The board lists every open position: what is no longer there has been filled or withdrawn.
    const { data } = await db
      .from("offers")
      .update({ archived_at: new Date().toISOString() })
      .contains("sources", [source])
      .lt("last_seen_at", startedAt)
      .is("archived_at", null)
      .select("id");
    report.archived = data?.length ?? 0;
    await db.from("companies").update({ last_collected_at: new Date().toISOString() }).eq("id", board.id);
  } catch (error) {
    report.error = (error as Error).message.slice(0, 120);
    // A board that no longer exists is dropped from the rotation; discovery may find it again.
    if (/HTTP 404/.test(report.error)) await db.from("companies").update({ ats: null, ats_token: null }).eq("id", board.id);
    else await db.from("companies").update({ last_collected_at: new Date().toISOString() }).eq("id", board.id);
  }
  return report;
}

async function recordRun(db: SupabaseClient, r: SourceReport, startedAt: string) {
  await db.from("collection_runs").insert({
    source: r.source,
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    offers_seen: r.seen,
    offers_new: r.created,
    offers_archived: r.archived,
    errors: r.error ? 1 : 0,
    error_sample: r.error ?? null,
  });
}

async function collectSource(db: SupabaseClient, source: string, fetchOffers: () => Promise<NormalizedOffer[]>, archiveStale: boolean, keep: Keep): Promise<SourceReport> {
  const startedAt = new Date().toISOString();
  const report: SourceReport = { source, seen: 0, created: 0, archived: 0 };
  try {
    const offers = (await fetchOffers()).filter((o) => keep(o.places, o.remote));
    report.seen = offers.length;
    report.created = await upsertOffers(db, offers);
    if (archiveStale && offers.length > 0) {
      const { data } = await db
        .from("offers")
        .update({ archived_at: new Date().toISOString() })
        .contains("sources", [source])
        .lt("last_seen_at", startedAt)
        .is("archived_at", null)
        .select("id");
      report.archived = data?.length ?? 0;
    }
  } catch (error) {
    report.error = (error as Error).message.slice(0, 200);
  }
  await recordRun(db, report, startedAt);
  return report;
}

async function ensureCompanies(db: SupabaseClient, offers: NormalizedOffer[]) {
  const byKey = new Map<string, NormalizedOffer["company"]>();
  for (const o of offers) byKey.set(companyKey(o.company.name), o.company);
  const keys = [...byKey.keys()];
  const ids = new Map<string, string>();
  for (let i = 0; i < keys.length; i += 200) {
    const slice = keys.slice(i, i + 200);
    const { data: existing } = await db.from("companies").select("id, name_key").in("name_key", slice);
    for (const c of existing ?? []) ids.set(c.name_key, c.id);
    const missing = slice.filter((k) => !ids.has(k)).map((k) => ({ name: byKey.get(k)!.name, name_key: k, domain: byKey.get(k)!.domain ?? null }));
    if (missing.length) {
      const { data: inserted, error } = await db.from("companies").upsert(missing, { onConflict: "name_key" }).select("id, name_key");
      if (error) throw error;
      for (const c of inserted ?? []) ids.set(c.name_key, c.id);
    }
  }
  return ids;
}

export async function upsertOffers(db: SupabaseClient, offers: NormalizedOffer[]): Promise<number> {
  if (offers.length === 0) return 0;
  const companyIds = await ensureCompanies(db, offers);
  const now = new Date().toISOString();

  const byKey = new Map<string, NormalizedOffer>();
  for (const o of offers) {
    // Among true duplicates, the most complete version wins.
    const key = offerKey(o);
    const prev = byKey.get(key);
    if (!prev || o.description.length > prev.description.length) byKey.set(key, o);
  }
  const keys = [...byKey.keys()];
  let created = 0;

  for (let i = 0; i < keys.length; i += 100) {
    const slice = keys.slice(i, i + 100);
    const { data: existing, error } = await db.from("offers").select("dedup_key, sources, urls, description, published_at, archived_at, repost_count, reposted_at").in("dedup_key", slice);
    if (error) throw error;
    const known = new Map((existing ?? []).map((e) => [e.dedup_key, e]));

    const rows = slice.map((key) => {
      const o = byKey.get(key)!;
      const range = detectExperience(o.description);
      const prev = known.get(key);
      const urls: { source: string; url: string }[] = prev?.urls ?? [];
      if (!urls.some((u) => u.url === o.sourceUrl)) urls.push({ source: o.sourceKey, url: o.sourceUrl });
      // Prefer the company's own page for applying when one is known.
      const direct = urls.find((u) => /greenhouse|lever|ashby|smartrecruiters|workable|recruitee|teamtailor|personio|digitalrecruiters|welcomekit/.test(u.source));
      const prevDesc: string = prev?.description ?? "";
      // Gone for more than two days, then back with a later publication date: the employer posted it
      // again. Without the new date, the gap may be a page or a list Scout could not read in full.
      const reposted = Boolean(
        prev?.archived_at && Date.parse(now) - Date.parse(prev.archived_at) > 2 * 86_400_000 && o.publishedAt && prev.published_at && Date.parse(o.publishedAt) - Date.parse(prev.published_at) > 2 * 86_400_000,
      );
      return {
        dedup_key: key,
        company_id: companyIds.get(companyKey(o.company.name)),
        title: o.title,
        location_raw: o.locationRaw,
        places: o.places,
        // The location field may say nothing about remote work while the description does.
        remote: o.remote === "unknown" ? (detectRemote(o.description) ?? "unknown") : o.remote,
        remote_scope: o.remoteScope,
        contract: o.contract,
        experience_min_years: o.experienceMinYears ?? range.min,
        experience_max_years: range.max,
        experience_level: detectExperienceLevel(o.description),
        salary_text: detectSalary(o.description),
        description: o.description.length >= prevDesc.length ? o.description : prevDesc,
        apply_url: direct?.url ?? o.applyUrl,
        ...(o.imageUrl ? { image_url: o.imageUrl } : {}),
        urls,
        sources: Array.from(new Set([...(prev?.sources ?? []), o.sourceKey])),
        published_at: o.publishedAt,
        last_seen_at: now,
        archived_at: null,
        repost_count: (prev?.repost_count ?? 0) + (reposted ? 1 : 0),
        reposted_at: reposted ? now : (prev?.reposted_at ?? null),
      };
    });
    created += rows.filter((r) => !known.has(r.dedup_key)).length;
    const { error: upsertError } = await db.from("offers").upsert(rows, { onConflict: "dedup_key" });
    if (upsertError) throw upsertError;
  }
  return created;
}

async function fillCompanyColors(db: SupabaseClient) {
  const { data } = await db.from("companies").select("id, name, domain, brand").is("color_checked_at", null).limit(COLOR_BATCH);
  for (const c of data ?? []) {
    let accent: string | null = null;
    try {
      accent = await extractAccent(c.domain, c.brand ?? c.name);
    } catch {
      accent = null;
    }
    await db.from("companies").update({ accent_color: accent, color_checked_at: new Date().toISOString() }).eq("id", c.id);
  }
}

async function shownCompanyIds(db: SupabaseClient): Promise<string[]> {
  const ids = new Set<string>();
  for (let f = 0; ; f += 1000) {
    const { data } = await db.from("offer_scores").select("offer:offers(company_id, archived_at)").neq("level", "ecartee").range(f, f + 999);
    for (const r of (data ?? []) as unknown as { offer: { company_id: string; archived_at: string | null } | null }[]) if (r.offer && !r.offer.archived_at) ids.add(r.offer.company_id);
    if (!data || data.length < 1000) break;
  }
  return [...ids].slice(0, 150);
}

async function archiveStaleEngineOffers(db: SupabaseClient) {
  const cutoff = new Date(Date.now() - ENGINE_STALE_DAYS * 86_400_000).toISOString();
  // Only offers known from engines alone: a career page lists its offers, so its own archiving is exact.
  await db.from("offers").update({ archived_at: new Date().toISOString() }).is("archived_at", null).lt("last_seen_at", cutoff).containedBy("sources", ENGINE_SOURCES);
}

async function purgeOldDescriptions(db: SupabaseClient) {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 86_400_000).toISOString();
  await db.from("offers").update({ description: null }).lt("archived_at", cutoff).not("description", "is", null);
}
