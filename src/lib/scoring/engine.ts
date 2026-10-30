import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { CONTRACT_LABELS, Criteria, CvSummary } from "@/lib/domain/criteria";
import type { Place, Remote } from "@/lib/domain/offer";
import { chancesCap, EXPERIENCE_GAP_EXCLUDE, gapReason, prefilter } from "./prefilter";
import { completeOffers, isExcerptOnly } from "@/lib/collect/complete";

export const languageReason = (l: { language: string; quote: string }) => `L'offre demande de parler ${l.language} : « ${l.quote} ». Si tu le parles, ajoute-le à ta recherche.`;
export const INVENTED_REASON = "L'intitulé ressemble à ton métier, mais l'offre décrit un autre métier.";
export const EXCERPT_REASON = "Annonce incomplète : Scout n'a pu en lire qu'un extrait, il ne juge pas une offre sans l'avoir lue en entier.";
import { MIN_INTERVAL_MS } from "@/lib/llm";
import { missingLanguage } from "@/lib/domain/languages";
import { inventedRoleWords, isTraining, titleRelevance } from "./relevance";
import { judgeBatch, type Feedback, type JudgeInput, type Judgement } from "./judge";

// Six offers per request: shorter answers, finished in time, none skipped by the model.
const BATCH_SIZE = 6;
// A batch of 6 takes ~20 s on the free model; with 2.1 s between starts, ~10 start in one call.
const BATCH_DURATION_MS = 25_000;
// On the site (a serverless call of under a minute) at most 12 batches; the scheduled job, with a longer
// budget, keeps as many in flight as the rate limit allows.
const MAX_BATCHES_PER_CALL = 12;
// A role sought (even half named) or a full bridge: half a bridge ("FP&A Analyst" for "Product Analyst") is not enough.
const MIN_TITLE_RELEVANCE = 5;
// Offers of favourite companies skip the title pre-sort, judged after the closest titles.
const FAVORITE_RELEVANCE = 1;
// Leaves the serverless call before its 60 s limit; a longer budget (scheduled job) moves it.
const HARD_STOP_MARGIN_MS = 7_000;
const PAGE = 1000;

type LightOffer = {
  id: string;
  title: string;
  location_raw: string | null;
  places: Place[];
  remote: Remote;
  remote_scope: string[];
  contract: string;
  experience_min_years: number | null;
  experience_level: "junior" | "experienced" | null;
  company_id: string;
  has_description: boolean;
  company: { name: string } | null;
};

// Bumped whenever the prompt or the level rules change: older judgements are then redone.
const JUDGE_RULES = 10;

// Everything the model's judgement depends on. A profile change outside it (zone, openness, out-of-zone
// setting) keeps the judgements: only the gates run again, in a second.
export function judgeKeyOf(criteria: Criteria, cv: CvSummary | null, experienceYears: number | null, favorites: string[]) {
  const c = criteria;
  const basis = [JUDGE_RULES, c.targetRoles, c.titleVariants, c.bridgeRoles, c.sectorsPriority, c.sectorsOk, c.sectorsAvoid, c.otherSectors, c.contracts, c.languages, c.dealBreakers, experienceYears, [...favorites].sort(), cv];
  return createHash("sha1").update(JSON.stringify(basis)).digest("hex").slice(0, 16);
}

export type ScoringProgress = { scoredNow: number; remaining: number; total: number };

async function pages<T>(fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await fetchPage(from, from + PAGE - 1);
    if (error) throw error;
    out.push(...(data ?? []));
    if (!data || data.length < PAGE) return out;
  }
}

// Runs as the signed-in user: reads shared offers, writes only this user's scores (RLS).
// `service` (service role) lets the engine complete search-engine excerpts before judging them.
export async function runScoring(db: SupabaseClient, userId: string, budgetMs = 45_000, service: SupabaseClient | null = null): Promise<ScoringProgress> {
  const startedAt = Date.now();
  const { data: profile, error } = await db.from("profiles").select("criteria, criteria_version, cv_summary").eq("id", userId).single();
  if (error || !profile) throw error ?? new Error("profile not found");
  const criteria = Criteria.parse(profile.criteria);
  const cvParsed = profile.cv_summary ? CvSummary.safeParse(profile.cv_summary) : null;
  const cv = cvParsed?.success ? cvParsed.data : null;
  const version: number = profile.criteria_version;
  const experienceYears = criteria.experienceYears ?? cv?.experienceYears ?? null;

  const scored = new Set(
    (await pages<{ offer_id: string }>((f, t) => db.from("offer_scores").select("offer_id").eq("user_id", userId).eq("criteria_version", version).range(f, t))).map(
      (r) => r.offer_id,
    ),
  );
  const offers = await pages<LightOffer>((f, t) =>
    db
      .from("offers")
      .select("id, title, location_raw, places, remote, remote_scope, contract, experience_min_years, experience_level, company_id, has_description, company:companies(name)")
      .is("archived_at", null)
      .order("first_seen_at", { ascending: false })
      .range(f, t) as unknown as PromiseLike<{ data: LightOffer[] | null; error: unknown }>,
  );
  const unscored = offers.filter((o) => !scored.has(o.id));
  // All sorted: the rows of older versions are no longer needed.
  if (unscored.length === 0) {
    await db.from("offer_scores").delete().eq("user_id", userId).lt("criteria_version", version);
    return { scoredNow: 0, remaining: 0, total: offers.length };
  }

  const base = { user_id: userId, criteria_version: version };
  const gateRows: Record<string, unknown>[] = [];
  const { data: favoriteRows } = await db.from("favorite_companies").select("company_id, company:companies(name)").eq("user_id", userId);
  const favoriteIds = new Set((favoriteRows ?? []).map((f) => f.company_id as string));
  const favoriteNames = (favoriteRows ?? []).map((f) => (f.company as unknown as { name: string } | null)?.name).filter((n): n is string => Boolean(n));
  const judgeKey = judgeKeyOf(criteria, cv, experienceYears, favoriteNames);
  const passed: { offer: LightOffer; outOfZone: boolean; gap: number }[] = [];
  for (const offer of unscored) {
    const gate = prefilter({ ...offer, companyName: offer.company?.name ?? "" }, criteria, experienceYears);
    if (gate.pass) passed.push({ offer, outOfZone: gate.outOfZone, gap: gate.experienceGap });
    else gateRows.push({ ...base, offer_id: offer.id, level: "ecartee", excluded_reason: gate.reason, scored_by: "prefilter" });
  }

  // Only offers whose title is close to a role sought or a bridge reach the LLM; the others are
  // set aside with that reason, still visible under "Écartées".
  const candidates: { offer: LightOffer; outOfZone: boolean; gap: number; rel: number; titleMatch: boolean }[] = [];
  for (const p of passed) {
    const rel = titleRelevance(p.offer.title, criteria);
    // A favourite company's offers are always read: a good role there may carry an unexpected title.
    // A V.I.E. sought is read whatever its title: they are few, and a nearby role (Project Manager for a
    // Product Manager) is often the way in.
    const vieSought = p.offer.contract === "vie" && criteria.contracts.includes("vie");
    if (rel >= MIN_TITLE_RELEVANCE || vieSought || (favoriteIds.has(p.offer.company_id) && p.offer.has_description)) candidates.push({ ...p, rel: Math.max(rel, FAVORITE_RELEVANCE), titleMatch: rel >= MIN_TITLE_RELEVANCE });
    else
      gateRows.push({
        ...base,
        offer_id: p.offer.id,
        level: "ecartee",
        excluded_reason: "L'intitulé ne correspond à aucun de tes métiers ni de tes passerelles.",
        scored_by: "prefilter",
      });
  }
  // Judgements made under the same key (an earlier version differing only by zone or openness) are reused.
  const reused: Record<string, unknown>[] = [];
  for (let i = 0; i < candidates.length; i += 200) {
    const chunk = candidates.slice(i, i + 200);
    const { data: previous } = await db
      .from("offer_scores")
      .select("*")
      .eq("user_id", userId)
      .eq("judge_key", judgeKey)
      .lt("criteria_version", version)
      .in("offer_id", chunk.map((c) => c.offer.id));
    const latest = new Map<string, Record<string, unknown>>();
    for (const row of previous ?? []) if (!latest.has(row.offer_id) || (latest.get(row.offer_id)!.criteria_version as number) < row.criteria_version) latest.set(row.offer_id, row);
    for (const c of chunk) {
      const row = latest.get(c.offer.id);
      if (!row) continue;
      const { created_at: _created, ...rest } = row;
      void _created;
      reused.push({ ...rest, criteria_version: version, out_of_zone: c.outOfZone });
    }
  }
  if (reused.length > 0) {
    const ids = new Set(reused.map((r) => r.offer_id));
    for (let i = candidates.length - 1; i >= 0; i--) if (ids.has(candidates[i].offer.id)) candidates.splice(i, 1);
  }
  // Written apart: rows of one write must share their columns, or the missing ones become null.
  for (const rows of [gateRows, reused]) {
    for (let i = 0; i < rows.length; i += 500) {
      const { error: e } = await db.from("offer_scores").upsert(rows.slice(i, i + 500));
      if (e) throw e;
    }
  }
  const quickRows = gateRows.length + reused.length;
  // The gates take a second: report them at once so progress moves before the slower LLM part.
  if (quickRows > 0) return { scoredNow: quickRows, remaining: candidates.length, total: offers.length };

  candidates.sort((a, b) => b.rel - a.rel);
  const feedback = await loadFeedback(db, userId);
  const descriptions = new Map<string, string>();
  const maxBatches = budgetMs > 60_000 ? Math.floor((budgetMs - BATCH_DURATION_MS) / MIN_INTERVAL_MS) : MAX_BATCHES_PER_CALL;
  const toLoad = candidates.slice(0, maxBatches * BATCH_SIZE).map((c) => c.offer.id);
  // Read the full posting behind search-engine excerpts first: judging 500 characters misleads.
  if (service) await completeOffers(service, toLoad);
  const fresh = new Map<string, { description: string | null; experience_min_years: number | null; experience_level: LightOffer["experience_level"]; contract: string; archived_at: string | null; sources: string[] }>();
  for (let i = 0; i < toLoad.length; i += 100) {
    const { data } = await db.from("offers").select("id, description, experience_min_years, experience_level, contract, archived_at, sources").in("id", toLoad.slice(i, i + 100));
    for (const d of data ?? []) fresh.set(d.id, d);
  }
  const spoken = [...criteria.languages, ...(cv?.languages ?? [])];
  // Completed offers may now ask for more experience, or be gone: the gates are applied again.
  const regated: Record<string, unknown>[] = [];
  for (let i = candidates.length - 1; i >= 0; i--) {
    const c = candidates[i];
    const f = fresh.get(c.offer.id);
    if (!f) continue;
    if (f.archived_at) {
      candidates.splice(i, 1);
      continue;
    }
    c.offer = { ...c.offer, experience_min_years: f.experience_min_years, experience_level: f.experience_level, contract: f.contract };
    const gate = prefilter({ ...c.offer, companyName: c.offer.company?.name ?? "" }, criteria, experienceYears);
    if (!gate.pass) {
      regated.push({ ...base, offer_id: c.offer.id, level: "ecartee", excluded_reason: gate.reason, scored_by: "prefilter" });
      candidates.splice(i, 1);
      continue;
    }
    // Only an excerpt could be read (the engine's link is blocked or gone): Scout never judges an offer
    // it has not read in full. It stays visible under "Écartées", with that reason.
    if (isExcerptOnly({ description: f.description, sources: f.sources })) {
      regated.push({ ...base, offer_id: c.offer.id, level: "ecartee", excluded_reason: EXCERPT_REASON, scored_by: "prefilter" });
      candidates.splice(i, 1);
      continue;
    }
    // A training course or school programme is not a job offer.
    if (isTraining(c.offer.title)) {
      regated.push({ ...base, offer_id: c.offer.id, level: "ecartee", excluded_reason: "Une formation, pas une offre d'emploi.", scored_by: "prefilter" });
      candidates.splice(i, 1);
      continue;
    }
    // A language the offer requires and the person does not speak (from their search or CV), with the
    // offer's own sentence as proof. French and English are never set aside this way.
    const language = missingLanguage(`${c.offer.title}\n${f.description ?? ""}`, spoken);
    if (language) {
      regated.push({ ...base, offer_id: c.offer.id, level: "ecartee", excluded_reason: languageReason(language), scored_by: "prefilter" });
      candidates.splice(i, 1);
      continue;
    }
    c.gap = gate.experienceGap;
    descriptions.set(c.offer.id, f.description ?? "");
  }
  if (regated.length > 0) {
    const { error: e } = await db.from("offer_scores").upsert(regated);
    if (e) throw e;
  }

  // Batches start every ~2 s (rate limit) and run side by side; none starts too late to finish
  // within the serverless time limit.
  let scoredNow = 0;
  let missed = 0;
  let finished = 0;
  const running: Promise<void>[] = [];
  while (candidates.length > 0 && running.length < maxBatches && Date.now() - startedAt < budgetMs - BATCH_DURATION_MS) {
    const batch = candidates.splice(0, BATCH_SIZE);
    const batchTitle = new Map(batch.map((c) => [c.offer.id, c.titleMatch]));
    const inputs: JudgeInput[] = batch.map(({ offer }) => ({
      id: offer.id,
      title: offer.title,
      company: offer.company?.name ?? "",
      location: offer.location_raw ?? "",
      contract: offer.contract,
      experienceRequired: offer.experience_min_years,
      experienceLevel: offer.experience_level,
      description: descriptions.get(offer.id) ?? "",
      favorite: favoriteIds.has(offer.company_id),
      titleMatch: batchTitle.get(offer.id),
    }));
    running.push(
      judgeBatch(inputs, criteria, cv, experienceYears, favoriteNames, feedback).then(async (results) => {
        const rows = batch
          .filter(({ offer }) => results.has(offer.id))
          .map(({ offer, outOfZone, gap }) => {
            const row = scoreRow({ ...base, judge_key: judgeKey }, offer.id, outOfZone, gap, results.get(offer.id)!, experienceYears, offer.experience_min_years, service, offer.contract, criteria.contracts, offer.company_id);
            // A reason built on a role word the offer never uses ("vidéo" for a bike mechanic) is an invention.
            const why = typeof row.why === "string" ? row.why : "";
            return row.level !== "ecartee" && inventedRoleWords(why, offer.title, descriptions.get(offer.id) ?? "", criteria).length > 0
              ? { ...row, level: "ecartee", excluded_reason: INVENTED_REASON }
              : row;
          });
        if (rows.length > 0) {
          const { error: e } = await db.from("offer_scores").upsert(rows);
          if (e) throw e;
        }
        scoredNow += rows.length;
        // Offers the model skipped stay unscored and are picked up again by the next call.
        missed += batch.length - rows.length;
      }).finally(() => finished++),
    );
    // Launch at the queue's pace, so the time check above reflects when the batch really starts.
    await new Promise((r) => setTimeout(r, MIN_INTERVAL_MS));
  }
  // Hard stop before the platform limit: unfinished batches are simply scored again next call.
  const all = Promise.allSettled(running);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const settled = await Promise.race([all, new Promise<null>((r) => (timer = setTimeout(() => r(null), Math.max(0, startedAt + Math.max(52_000, budgetMs + HARD_STOP_MARGIN_MS) - Date.now()))))]);
  // A pending timer would keep the scheduled job alive minutes after the work is done.
  clearTimeout(timer);
  const failures = settled ? settled.filter((r): r is PromiseRejectedResult => r.status === "rejected") : [];
  if (failures.length > 0 && scoredNow === 0) throw failures[0].reason;
  const unfinished = running.length - finished + failures.length;

  return { scoredNow, remaining: candidates.length + missed + unfinished * BATCH_SIZE, total: offers.length };
}

// The person's own signals, newest first: kept or applied to (liked), set aside with a reason (disliked).
async function loadFeedback(db: SupabaseClient, userId: string): Promise<Feedback> {
  const [actions, applied] = await Promise.all([
    db.from("user_offers").select("saved, dismissed, dismiss_reason, offer:offers(title, company:companies(name))").eq("user_id", userId).order("updated_at", { ascending: false }).limit(40),
    db.from("applications").select("title, company").eq("user_id", userId).order("updated_at", { ascending: false }).limit(10),
  ]);
  type Row = { saved: boolean; dismissed: boolean; dismiss_reason: string | null; offer: { title: string; company: { name: string } | null } | null };
  const rows = (actions.data ?? []) as unknown as Row[];
  const label = (r: Row) => `${r.offer?.title} (${r.offer?.company?.name ?? "?"})`;
  return {
    liked: [...(applied.data ?? []).map((a) => `${a.title} (${a.company})`), ...rows.filter((r) => r.saved && r.offer).map(label)].slice(0, 10),
    disliked: rows.filter((r) => r.dismissed && r.offer).map((r) => `${label(r)} : ${r.dismiss_reason ?? "sans raison"}`).slice(0, 12),
  };
}

// The experience gate keeps its word whatever the model thought of the chances. When the model found
// the years asked (with a verified quote) and the detector had not, the gate applies with them, and the
// shared offer learns them for everyone.
export function scoreRow(
  base: { user_id: string; criteria_version: number; judge_key?: string },
  offerId: string,
  outOfZone: boolean,
  gap: number,
  judged: Judgement,
  experienceYears: number | null,
  knownYears: number | null,
  service: SupabaseClient | null,
  knownContract = "unknown",
  wanted: string[] = [],
  companyId: string | null = null,
): Record<string, unknown> {
  const { experience_years: found, contract_found: contract, company_product: product, skills, seniority, ...rest } = judged;
  // The level the missions describe, kept on the offer as an estimate (shown as such).
  if (service && seniority) service.from("offers").update({ seniority_estimate: seniority }).eq("id", offerId).is("seniority_estimate", null).then(() => undefined);
  // The posting's skills, read once for everyone.
  if (service && skills && skills.length) service.from("offers").update({ skills }).eq("id", offerId).is("skills", null).then(() => undefined);
  // The company learns what it does, once, for every offer and everyone.
  if (service && companyId && product) service.from("companies").update({ product }).eq("id", companyId).is("product", null).then(() => undefined);
  // Same for the contract: an internship found in the text never reaches a CDI-only search.
  if (knownContract === "unknown" && contract) {
    // Query builders only run when awaited or then-ed: started here, without delaying the score.
    if (service) service.from("offers").update({ contract }).eq("id", offerId).eq("contract", "unknown").then(() => undefined);
    if (wanted.length > 0 && !wanted.includes(contract))
      return { ...base, offer_id: offerId, out_of_zone: outOfZone, ...rest, level: "ecartee", excluded_reason: `${CONTRACT_LABELS[contract as keyof typeof CONTRACT_LABELS] ?? contract}, un type de contrat que tu n'as pas retenu.`, scored_by: "llm" };
  }
  let effectiveGap = gap;
  if (knownYears === null && found !== null) {
    if (service) service.from("offers").update({ experience_min_years: found }).eq("id", offerId).is("experience_min_years", null).then(() => undefined);
    if (experienceYears !== null) {
      effectiveGap = Math.max(gap, found - experienceYears);
      if (found - experienceYears >= EXPERIENCE_GAP_EXCLUDE) return { ...base, offer_id: offerId, out_of_zone: outOfZone, ...rest, level: "ecartee", excluded_reason: gapReason(found, experienceYears), scored_by: "llm" };
    }
  }
  // No years anywhere: the missions' level weighs as an estimate (confirmé ≈ 3 years, senior ≈ 5).
  if (knownYears === null && found === null && seniority && experienceYears !== null) effectiveGap = Math.max(effectiveGap, (seniority === "senior" ? 5 : seniority === "confirme" ? 3 : 0) - experienceYears);
  // A crush is a match within reach: 2 years or more above the person's experience is Solide at best.
  let level = rest.level === "coeur" && effectiveGap >= 2 ? "solide" : rest.level;
  // Two years more written in the offer: a stretch, worth a try, not a solid match.
  const statedYears = knownYears ?? found;
  let watch = rest.watch;
  if (statedYears !== null && experienceYears !== null && statedYears - experienceYears >= 2) {
    if (level === "coeur" || level === "solide") level = "tremplin";
    watch = [`Demande ${statedYears} ans, toi ${experienceYears} : à tenter si tes missions s'en rapprochent.`, ...watch.filter((w) => !/ans d'expérience|expérience demandée/i.test(w))].slice(0, 2);
  }
  return { ...base, offer_id: offerId, out_of_zone: outOfZone, ...rest, watch, level, score_chances: Math.min(rest.score_chances, chancesCap(effectiveGap)), scored_by: "llm" };
}

// An offer the person added themselves: same gates and judgement, no title pre-sort, right away.
export async function scoreOffersNow(db: SupabaseClient, userId: string, offerIds: string[]) {
  const { data: profile, error } = await db.from("profiles").select("criteria, criteria_version, cv_summary").eq("id", userId).single();
  if (error || !profile) throw error ?? new Error("profile not found");
  const criteria = Criteria.parse(profile.criteria);
  const cvParsed = profile.cv_summary ? CvSummary.safeParse(profile.cv_summary) : null;
  const cv = cvParsed?.success ? cvParsed.data : null;
  const experienceYears = criteria.experienceYears ?? cv?.experienceYears ?? null;
  const base = { user_id: userId, criteria_version: profile.criteria_version as number };

  const { data: offers } = await db
    .from("offers")
    .select("id, title, location_raw, places, remote, remote_scope, contract, experience_min_years, experience_level, description, company_id, company:companies(name)")
    .in("id", offerIds);
  const rows: Record<string, unknown>[] = [];
  const toJudge: { offer: LightOffer & { description: string | null }; outOfZone: boolean; gap: number }[] = [];
  for (const offer of (offers ?? []) as unknown as (LightOffer & { description: string | null })[]) {
    const gate = prefilter({ ...offer, companyName: offer.company?.name ?? "" }, criteria, experienceYears);
    const language = gate.pass ? missingLanguage(`${offer.title}\n${offer.description ?? ""}`, [...criteria.languages, ...(cv?.languages ?? [])]) : null;
    if (language) rows.push({ ...base, offer_id: offer.id, level: "ecartee", excluded_reason: languageReason(language), scored_by: "prefilter" });
    else if (gate.pass) toJudge.push({ offer, outOfZone: gate.outOfZone, gap: gate.experienceGap });
    else rows.push({ ...base, offer_id: offer.id, level: "ecartee", excluded_reason: gate.reason, scored_by: "prefilter" });
  }
  if (toJudge.length > 0) {
    const { data: favs } = await db.from("favorite_companies").select("company_id, company:companies(name)").eq("user_id", userId);
    const favoriteNames = (favs ?? []).map((f) => (f.company as unknown as { name: string } | null)?.name).filter((n): n is string => Boolean(n));
    const favoriteIds = new Set((favs ?? []).map((f) => f.company_id as string));
    const results = await judgeBatch(
      toJudge.map(({ offer }) => ({
        id: offer.id,
        title: offer.title,
        company: offer.company?.name ?? "",
        location: offer.location_raw ?? "",
        contract: offer.contract,
        experienceRequired: offer.experience_min_years,
        experienceLevel: offer.experience_level,
        description: offer.description ?? "",
        favorite: favoriteIds.has(offer.company_id),
      })),
      criteria,
      cv,
      experienceYears,
      favoriteNames,
      await loadFeedback(db, userId),
    );
    for (const { offer, outOfZone, gap } of toJudge) {
      const judged = results.get(offer.id);
      if (judged) rows.push(scoreRow(base, offer.id, outOfZone, gap, judged, experienceYears, offer.experience_min_years, null, offer.contract, criteria.contracts));
    }
  }
  if (rows.length > 0) {
    const { error: e } = await db.from("offer_scores").upsert(rows);
    if (e) throw e;
  }
  return rows;
}

// A posting online for more than six months on the company's own page is almost always a standing
// listing (a pool of candidates), not a post to fill now: never a crush, and said so. Run after each
// sort, for every person. Needs the service role.
export const PERMANENT_DAYS = 180;
export async function capStandingPostings(db: SupabaseClient): Promise<number> {
  const before = new Date(Date.now() - PERMANENT_DAYS * 86_400_000).toISOString();
  const { data } = await db
    .from("offer_scores")
    .select("user_id, offer_id, criteria_version, watch, offer:offers!inner(published_at, archived_at)")
    .eq("level", "coeur")
    .is("offer.archived_at", null)
    .lt("offer.published_at", before)
    .limit(2000);
  let n = 0;
  for (const r of (data ?? []) as unknown as { user_id: string; offer_id: string; criteria_version: number; watch: string[] | null; offer: { published_at: string } }[]) {
    const months = Math.round((Date.now() - Date.parse(r.offer.published_at)) / (30 * 86_400_000));
    const note = `En ligne depuis ${months} mois : sans doute une annonce permanente. Postule si l'entreprise te plaît, sans trop compter dessus.`;
    const watch = [note, ...(r.watch ?? []).filter((w) => !/annonce permanente/.test(w))].slice(0, 2);
    await db.from("offer_scores").update({ level: "solide", watch }).eq("user_id", r.user_id).eq("offer_id", r.offer_id).eq("criteria_version", r.criteria_version);
    n++;
  }
  return n;
}
