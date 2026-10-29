"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isExceptional, isStaleOffer, LEVEL_ORDER, type FeedItem } from "@/lib/domain/feed";
import { createClient } from "@/lib/supabase/browser";
import type { Level } from "@/lib/domain/offer";
import { rank } from "@/lib/scoring/judge";
import { isFresh, placeLabel, STALE_DAYS } from "@/lib/format";
import { OfferCard } from "@/components/offers/offer-card";
import { OfferPanel } from "@/components/offers/offer-panel";
import { CompanyLogo } from "@/components/company-logo";
import { EditSearchButton, SearchPanel } from "@/components/search-panel";
import { SortingBanner, useSorting } from "@/components/sorting-progress";
import { EXCLUDED_PAGE, loadExcludedPage } from "@/lib/views/excluded";
import { haystack, matchesSearch } from "@/lib/search";

type Filter = "all" | Exclude<Level, "ecartee"> | "ecartees";


const LEVEL_FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "Toutes" },
  { key: "coeur", label: "Coups de cœur" },
  { key: "solide", label: "Solides" },
  { key: "tremplin", label: "Tremplins" },
  { key: "ecartees", label: "Écartées" },
];

// What each level means for the person, in one short line.
const LEVEL_HELP: Partial<Record<Filter, string>> = {
  ecartees: "Chaque offre écartée affiche sa raison. Si une raison te semble fausse, c'est un réglage de Ma recherche à revoir.",
  coeur: "Le métier que tu vises, à ta portée : dans un secteur que tu préfères, chez une favorite ou ouvert aux juniors.",
  solide: "Le métier que tu vises, avec moins de chances ou dans un autre secteur.",
  tremplin: "Un poste proche qui peut te mener au métier que tu vises.",
};

// Junior: 2 years asked at most, or announced as such in the title or the requirements.
const JUNIOR_WORDS = /\b(junior|jr|associate|graduate|entry[- ]level|d[ée]butant|premi[eè]re exp[ée]rience|jeune dipl[oô]m)/i;
const isJunior = (i: FeedItem) =>
  (i.offer.experience_min_years !== null && i.offer.experience_min_years <= 2) ||
  i.offer.experience_level === "junior" ||
  JUNIOR_WORDS.test(i.offer.title) ||
  (i.offer.experience_min_years === null && i.offer.experience_level !== "experienced" && JUNIOR_WORDS.test(i.experience_asked ?? ""));

// Cards are drawn a screenful at a time: the page opens at once even with a hundred offers.
const BATCH = 24;

// Draws more cards when the end of the list comes into view.
function MoreOnScroll({ onMore }: { onMore: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && onMore(), { rootMargin: "800px" });
    io.observe(el);
    return () => io.disconnect();
  }, [onMore]);
  return <div ref={ref} aria-hidden className="h-px" />;
}

function Toggle({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={on}
      onClick={onClick}
      className={`flex items-center gap-1.5 whitespace-nowrap rounded-xl border px-3 py-2.5 text-sm font-medium ${on ? "border-transparent bg-violet-soft text-violet-ink" : "border-line bg-surface text-muted hover:text-ink"}`}
    >
      <span aria-hidden className={`grid h-4 w-4 place-items-center rounded-[5px] border text-[11px] leading-none ${on ? "border-violet-ink bg-violet-ink text-surface" : "border-line"}`}>
        {on ? "✓" : ""}
      </span>
      {children}
    </button>
  );
}

type Props = { sortHere?: boolean; items: FeedItem[]; openness: number; pending: number; total: number; excludedCount: number; favoriteCompanyIds: string[]; initialOpenId: string | null;
  // Public demo: everything works in the session, nothing is saved, no sorting is started.
  demo?: boolean;
  base?: string; criteriaVersion: number; hasOffers: boolean; isAdmin: boolean;
  // A fresh collection runs for a search the person just changed.
  collecting?: boolean;
  initialQuery?: string;
  // "Ma recherche", opened over the page by "Modifier ma recherche".
  searchEditor?: React.ReactNode };

export function Feed({ sortHere = true, items: initial, openness, pending, total, excludedCount, favoriteCompanyIds, initialOpenId, demo = false, criteriaVersion, hasOffers, isAdmin, collecting = false, initialQuery = "", searchEditor = null }: Props) {
  const router = useRouter();
  // Optimistic local changes (save, pas pour moi) layered over server data.
  const [overrides, setOverrides] = useState<Record<string, Partial<FeedItem>>>({});
  // "Écartées" can hold thousands of offers: loaded 100 at a time, only when that view is opened.
  const [excluded, setExcluded] = useState<{ items: FeedItem[]; loading: boolean; done: boolean }>({ items: [], loading: false, done: false });
  // With a search, the server looks through all of them (a company has hundreds), not only those loaded.
  const loadExcluded = useCallback(async (from: number, search: string) => {
    setExcluded((e) => ({ items: from === 0 ? [] : e.items, loading: true, done: false }));
    const data = demo
      ? ((await fetch(`/api/demo/excluded?from=${from}&q=${encodeURIComponent(search)}`).then((r) => r.json()).catch(() => ({ data: [] }))) as { data: unknown[] }).data
      : await loadExcludedPage(createClient(), { version: criteriaVersion, from, search });
    const rows = ((data ?? []) as unknown as (Omit<FeedItem, "saved" | "dismissed">)[]).filter((r) => r.offer).map((r) => ({ ...r, saved: false, dismissed: false }));
    setExcluded((e) => ({ items: from === 0 ? rows : [...e.items, ...rows], loading: false, done: rows.length < EXCLUDED_PAGE }));
  }, [criteriaVersion, demo]);
  const items = useMemo(
    () => [...initial, ...excluded.items].map((i) => (overrides[i.offer.id] ? { ...i, ...overrides[i.offer.id] } : i)),
    [initial, excluded.items, overrides],
  );
  const [filter, setFilter] = useState<Filter>("all");
  const [freshOnly, setFreshOnly] = useState(false);
  const [juniorOnly, setJuniorOnly] = useState(false);
  const [showStale, setShowStale] = useState(false);
  const [query, setQuery] = useState(initialQuery);
  const [drawn, setDrawn] = useState(BATCH);
  const drawMore = useCallback(() => setDrawn((n) => n + BATCH), []);
  // A new filter or search starts again from the top of its list.
  const listKey = `${filter}|${query}|${freshOnly}|${juniorOnly}|${showStale}`;
  const [lastKey, setLastKey] = useState(listKey);
  if (lastKey !== listKey) {
    setLastKey(listKey);
    setDrawn(BATCH);
  }
  const [openId, setOpenId] = useState<string | null>(initialOpenId);
  const favoriteIds = useMemo(() => new Set(favoriteCompanyIds), [favoriteCompanyIds]);
  const [applying, setApplying] = useState<FeedItem | null>(null);
  const [askApplied, setAskApplied] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const progress = useSorting(pending, !demo && sortHere);

  // Back on the tab after opening an offer: ask, once, whether the person applied.
  useEffect(() => {
    if (!applying) return;
    const onReturn = () => {
      if (document.visibilityState === "visible") setAskApplied(true);
    };
    window.addEventListener("focus", onReturn);
    document.addEventListener("visibilitychange", onReturn);
    return () => {
      window.removeEventListener("focus", onReturn);
      document.removeEventListener("visibilitychange", onReturn);
    };
  }, [applying]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  const { main, outOfZone, elsewhere, set_aside } = useMemo(() => {
    // Within a level, the newest first (applying early matters); fit breaks ties.
    const day = (i: FeedItem) => Math.floor(new Date(i.offer.published_at ?? i.offer.first_seen_at).getTime() / 86_400_000);
    const byRank = (a: FeedItem, b: FeedItem) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level] || day(b) - day(a) || rank(b, openness) - rank(a, openness);
    const visible = items.filter((i) => !i.dismissed);
    return {
      main: visible.filter((i) => i.level !== "ecartee" && !i.out_of_zone).sort(byRank),
      outOfZone: visible.filter((i) => i.level !== "ecartee" && i.out_of_zone && isExceptional(i)).sort(byRank),
      // A search looks everywhere: an offer outside the zone is still the one the person may be looking for.
      elsewhere: visible.filter((i) => i.level !== "ecartee" && i.out_of_zone).sort(byRank),
      set_aside: items.filter((i) => i.dismissed || i.level === "ecartee" || (i.out_of_zone && !isExceptional(i))),
    };
  }, [items, openness]);

  // Model-set-aside offers are counted server-side; dismissed and out-of-zone ones are already here.
  const excludedTotal = excludedCount + set_aside.filter((i) => i.level !== "ecartee").length;

  const published = (i: FeedItem) => i.offer.published_at ?? i.offer.first_seen_at;
  const stale = (i: FeedItem) => isStaleOffer(i.offer);
  const staleCount = main.filter(stale).length;
  // Search by company or title, accents and case ignored.
  const fold = (v: string) => v.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const q = fold(query.trim());
  const matches = (i: FeedItem) => !q || matchesSearch(haystack(i.offer), query);

  const shown = main
    .filter(matches)
    .filter((i) => filter === "all" || filter === "ecartees" || i.level === filter)
    .filter((i) => showStale || !stale(i))
    .filter((i) => !freshOnly || isFresh(published(i)))
    .filter((i) => !juniorOnly || isJunior(i));
  // Counts per level follow the refinements, so each option says what it would show.
  const refined = main.filter(matches).filter((i) => (showStale || !stale(i)) && (!freshOnly || isFresh(published(i))) && (!juniorOnly || isJunior(i)));
  const levelCount = (key: Filter) => (key === "all" ? refined.length : refined.filter((i) => i.level === key).length);
  const shownElsewhere = q ? elsewhere.filter(matches) : outOfZone;
  const searched = useRef(query.trim());
  const openExcluded = () => {
    setFilter("ecartees");
    searched.current = query.trim();
    loadExcluded(0, query.trim());
  };
  // A search also shows, below its results, the set-aside offers it matches (read on the server), so a
  // company never looks absent when Scout did find its offers.
  const [searchAside, setSearchAside] = useState<{ q: string; items: FeedItem[] }>({ q: "", items: [] });
  useEffect(() => {
    const term = query.trim();
    if (term.length < 2 || filter === "ecartees") return;
    const t = setTimeout(async () => {
      const data = demo
        ? ((await fetch(`/api/demo/excluded?from=0&q=${encodeURIComponent(term)}`).then((r) => r.json()).catch(() => ({ data: [] }))) as { data: unknown[] }).data
        : await loadExcludedPage(createClient(), { version: criteriaVersion, from: 0, search: term });
      const rows = ((data ?? []) as unknown as Omit<FeedItem, "saved" | "dismissed">[]).filter((r) => r.offer).map((r) => ({ ...r, saved: false, dismissed: false }));
      setSearchAside({ q: term, items: rows });
    }, 200);
    return () => clearTimeout(t);
  }, [query, filter, demo, criteriaVersion]);
  // The set-aside offers are still being looked up: said on screen, so an empty result never looks final.
  const asideLoading = query.trim().length >= 2 && filter !== "ecartees" && searchAside.q !== query.trim();
  const asideForQuery = searchAside.q === query.trim() && query.trim().length >= 2 ? [...set_aside.filter((i) => i.level !== "ecartee" && matches(i)), ...searchAside.items] : [];

  // In "Écartées", a new search reloads from the server once typing pauses.
  useEffect(() => {
    if (filter !== "ecartees" || searched.current === query.trim()) return;
    const t = setTimeout(() => {
      searched.current = query.trim();
      loadExcluded(0, query.trim());
    }, 350);
    return () => clearTimeout(t);
  }, [filter, query, loadExcluded]);
  const open = items.find((i) => i.offer.id === openId) ?? searchAside.items.find((i) => i.offer.id === openId) ?? null;

  const act = useCallback(async (id: string, body: Record<string, unknown>, patch: Partial<FeedItem>) => {
    setOverrides((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
    if (demo) return;
    await fetch(`/api/offers/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    // Aujourd'hui and Suivi, kept in the browser cache, must see the change.
    router.refresh();
  }, [demo, router]);

  const handlers = (item: FeedItem) => ({
    onOpen: () => setOpenId(item.offer.id),
    onSave: () => act(item.offer.id, { saved: !item.saved }, { saved: !item.saved }),
    onNope: (reason: string) => {
      act(item.offer.id, { dismissed: true, reason }, { dismissed: true });
      if (openId === item.offer.id) setOpenId(null);
      setToast("C'est noté, Scout en tiendra compte.");
    },
    onApply: () => {
      window.open(item.offer.apply_url, "_blank", "noopener,noreferrer");
      setApplying(item);
      setAskApplied(false);
    },
  });

  async function confirmApplied() {
    if (!applying) return;
    const { offer } = applying;
    setAskApplied(false);
    setApplying(null);
    if (demo) return setToast("En démo, rien n'est enregistré : dans ton compte, l'offre irait dans ton suivi.");
    const res = await fetch("/api/applications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ offerId: offer.id, title: offer.title, company: offer.company.name, url: offer.apply_url, stage: "postule" }),
    });
    setToast(res.ok ? "Candidature ajoutée au suivi. Bonne chance !" : "L'ajout au suivi n'a pas marché, réessaie depuis l'offre.");
    if (res.ok) router.refresh();
  }

  return (
    <div className="px-1 pb-16 pt-3 md:px-2">
      <h1 className="font-display text-4xl font-extrabold tracking-tight md:text-5xl">Offres</h1>
      <p className="mt-2 text-[15px] text-muted">
        {main.length - staleCount > 0
          ? `${main.length - staleCount} offre${main.length - staleCount > 1 ? "s" : ""} pour toi, par niveau, les plus récentes d'abord.`
          : "Ta sélection apparaît ici dès que des offres correspondent à ta recherche."}
      </p>

      {collecting && (
        <p className="mt-5 rounded-2xl bg-brand-soft px-4 py-3.5 text-sm" role="status">
          Scout va chercher les offres de ta recherche mise à jour sur toutes ses sources. Elles arriveront d&apos;ici une quinzaine de minutes : reviens un peu plus tard.
        </p>
      )}

      {progress && <SortingBanner progress={progress} total={total} excluded={excludedCount} />}

      <div className="mb-5 mt-5">
        {/* Two columns: the search over the level selector, "Modifier ma recherche" over the refinements,
            each pair as wide as its widest part, each line as tall as the search field. */}
        <div className="grid w-fit max-w-full grid-cols-1 gap-3 sm:grid-cols-[auto_auto]">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Rechercher une entreprise ou un intitulé"
            aria-label="Rechercher une entreprise ou un intitulé"
            className="w-full rounded-xl border border-line bg-surface px-4 py-2.5 text-sm placeholder:text-muted focus:border-ink focus:outline-none"
          />
          <EditSearchButton className="h-full w-full justify-center whitespace-nowrap" />
          <div role="radiogroup" aria-label="Niveau" className="inline-flex flex-nowrap overflow-x-auto rounded-xl border border-line bg-surface p-1 sm:flex-wrap">
            {LEVEL_FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                role="radio"
                aria-checked={filter === f.key}
                onClick={() => (f.key === "ecartees" ? openExcluded() : setFilter(f.key))}
                className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium ${filter === f.key ? "bg-button text-button-ink" : "text-muted hover:text-ink"}`}
              >
                {f.label}{" "}
                <span className={filter === f.key ? "opacity-70" : "opacity-60"}>{f.key === "ecartees" ? excludedTotal.toLocaleString("fr-FR") : levelCount(f.key)}</span>
              </button>
            ))}
          </div>
        {filter !== "ecartees" ? (
          <div className="flex flex-wrap gap-2" aria-label="Affiner">
            <Toggle on={juniorOnly} onClick={() => setJuniorOnly((v) => !v)}>
              Junior (2 ans max)
            </Toggle>
            <Toggle on={freshOnly} onClick={() => setFreshOnly((v) => !v)}>
              Moins de 48 h
            </Toggle>
            {staleCount > 0 && (
              <Toggle on={showStale} onClick={() => setShowStale((v) => !v)}>
                Inclure les +{STALE_DAYS} jours
              </Toggle>
            )}
          </div>
        ) : (
          <span />
        )}
        </div>
        {LEVEL_HELP[filter] && <p className="mt-2.5 text-sm text-muted">{LEVEL_HELP[filter]}</p>}
      </div>

      {!hasOffers && (
        <div className="rounded-3xl border border-line bg-surface p-8">
          <p className="font-display text-2xl font-bold">Les offres arrivent bientôt</p>
          <p className="mt-2 text-muted">La première collecte n&apos;a pas encore eu lieu.</p>
          {isAdmin && (
            <Link href="/admin" className="mt-5 inline-block rounded-xl bg-button px-4 py-2.5 text-sm font-semibold text-button-ink">
              Lancer la première collecte
            </Link>
          )}
        </div>
      )}

      {filter === "ecartees" ? (
        <SetAside
          items={set_aside.filter(matches)}
          searching={Boolean(q)}
          loading={excluded.loading}
          more={!excluded.done && excluded.items.length > 0}
          onMore={() => loadExcluded(excluded.items.length, query.trim())}
          onOpen={(id) => setOpenId(id)}
        />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 2xl:grid-cols-3">
            {shown.slice(0, drawn).map((item) => (
              <OfferCard key={item.offer.id} item={item} favorite={favoriteIds.has(item.offer.company.id)} selected={item.offer.id === openId} {...handlers(item)} />
            ))}
          </div>
          {shown.length > drawn && <MoreOnScroll onMore={drawMore} />}
          {hasOffers && shown.length === 0 && !progress && (
            q ? (
              <p className="rounded-2xl bg-surface p-6 text-muted">
                Rien dans ta sélection pour « {query.trim()} »{asideLoading ? ". Scout regarde aussi parmi les offres écartées…" : "."}
              </p>
            ) : (
              <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-surface p-6 text-muted">
                Rien ici pour l&apos;instant.
                <EditSearchButton label="Élargir ma recherche" />
              </div>
            )
          )}
          {shownElsewhere.length > 0 && (filter === "all" || q) && shown.length <= drawn && (
            <section className="mt-12">
              <h2 className="font-display text-2xl font-bold">Hors de ta zone</h2>
              <p className="mt-1 text-sm text-muted">{q ? "Elles correspondent à ta recherche, mais ailleurs que là où tu cherches." : "Gardées à part parce que tout le reste correspond très bien."}</p>
              <div className="mt-4 grid grid-cols-1 gap-3.5 sm:grid-cols-2 2xl:grid-cols-3">
                {shownElsewhere.filter((i) => filter === "all" || i.level === filter).map((item) => (
                  <OfferCard key={item.offer.id} item={item} favorite={favoriteIds.has(item.offer.company.id)} selected={item.offer.id === openId} {...handlers(item)} />
                ))}
              </div>
            </section>
          )}
          {asideLoading && (
            <p role="status" className="mt-8 flex items-center gap-2.5 text-sm text-muted">
              <span aria-hidden className="h-4 w-4 animate-spin rounded-full border-2 border-line border-t-brand" />
              Recherche parmi les offres écartées…
            </p>
          )}
          {!asideLoading && asideForQuery.length > 0 && (
            <section className="mt-12">
              <h2 className="font-display text-2xl font-bold">Écartées pour toi · {asideForQuery.length}</h2>
              <div className="mt-4">
                <SetAside items={asideForQuery} loading={false} more={false} searching onMore={() => undefined} onOpen={(id) => setOpenId(id)} />
              </div>
            </section>
          )}
        </>
      )}

      {searchEditor && <SearchPanel>{searchEditor}</SearchPanel>}

      {open && <OfferPanel
          key={open.offer.id}
          item={open}
          onClose={() => setOpenId(null)}
          loadDescription={demo ? (id) => fetch(`/api/demo/description?id=${id}`).then((r) => r.json()).then((d: { description?: string }) => d.description ?? "") : undefined}
          {...handlers(open)}
        />}

      {askApplied && applying && (
        <div className="fixed bottom-6 left-1/2 z-50 w-[min(92vw,460px)] -translate-x-1/2 animate-rise rounded-2xl border border-line bg-surface p-5 shadow-2xl" role="dialog" aria-label="As-tu postulé ?">
          <p className="font-display text-lg font-bold">Tu as postulé chez {applying.offer.company.name} ?</p>
          <p className="mt-1 text-sm text-muted">{applying.offer.title}</p>
          <div className="mt-4 flex gap-2">
            <button type="button" onClick={confirmApplied} className="flex-1 rounded-xl bg-button px-4 py-2.5 text-sm font-semibold text-button-ink">
              Oui, ajouter au suivi
            </button>
            <button type="button" onClick={() => { setAskApplied(false); setApplying(null); }} className="rounded-xl border border-line px-4 py-2.5 text-sm font-medium text-muted">
              Pas encore
            </button>
          </div>
        </div>
      )}

      {toast && (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 animate-rise rounded-full bg-button px-5 py-3 text-sm font-medium text-button-ink shadow-xl" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}

// Why an offer is out of the selection, as a short label the person recognises at a glance.
const ASIDE_KINDS: [RegExp, string, string][] = [
  [/annonce incompl/i, "Annonce illisible", "border border-dashed border-line text-muted"],
  [/type de contrat|stage ou alternance/i, "Contrat", "bg-peach-soft text-peach-ink"],
  [/exp[ée]rience|trop senior/i, "Expérience", "bg-violet-soft text-violet-ink"],
  [/zone|lieu/i, "Lieu", "bg-sky-soft text-sky-ink"],
  [/intitul[ée] ne correspond|ressemble à ton métier/i, "Métier éloigné", "bg-pill-solid text-ink"],
  [/une formation, pas une offre/i, "Formation", "bg-pill-solid text-ink"],
  [/secteur|entreprises que tu [ée]vites/i, "Secteur", "bg-mint-soft text-mint-ink"],
];
function asideKind(i: FeedItem): { label: string; tone: string; reason: string } {
  if (i.dismissed) return { label: "Ton choix", tone: "bg-pill-solid text-ink", reason: "Tu l'as marquée « Pas pour moi »." };
  if (i.level !== "ecartee") return { label: "Lieu", tone: "bg-sky-soft text-sky-ink", reason: "Hors de ta zone, et pas assez exceptionnelle pour être montrée à part." };
  const reason = i.excluded_reason ?? "Ne correspond pas à ta recherche.";
  const kind = ASIDE_KINDS.find(([re]) => re.test(reason));
  return kind ? { label: kind[1], tone: kind[2], reason } : { label: "Contenu du poste", tone: "bg-warn-soft text-warn", reason };
}

function SetAside({ items, loading, more, searching, onMore, onOpen }: { items: FeedItem[]; loading: boolean; more: boolean; searching: boolean; onMore: () => void; onOpen: (id: string) => void }) {
  if (items.length === 0)
    return (
      <p className="rounded-2xl border border-line bg-surface p-6 text-muted">
        {loading ? "Chargement des offres écartées…" : searching ? "Aucune offre écartée ne correspond à ta recherche." : "Aucune offre écartée pour l'instant."}
      </p>
    );
  return (
    <div>
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 2xl:grid-cols-3">
        {items.map((i) => {
          const kind = asideKind(i);
          const place = placeLabel(i.offer.places, i.offer.location_raw);
          return (
            <li key={i.offer.id}>
              <button type="button" onClick={() => onOpen(i.offer.id)} className="flex h-full w-full flex-col gap-3 rounded-2xl border border-line bg-surface p-4 text-left hover:border-ink">
                <span className="flex items-center gap-3">
                  <CompanyLogo name={i.offer.company.name} domain={i.offer.company.domain} brand={i.offer.company.brand} size={36} />
                  <span className="min-w-0">
                    <span className="block truncate text-[15px] font-semibold">{i.offer.title}</span>
                    <span className="block truncate text-[13px] text-muted">
                      {i.offer.company.name}
                      {place ? ` · ${place}` : ""}
                    </span>
                  </span>
                </span>
                <span className="flex items-start gap-2 text-[13.5px] leading-snug">
                  <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ${kind.tone}`}>{kind.label}</span>
                  <span className="line-clamp-2 text-muted">{kind.reason}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {more && (
        <button type="button" onClick={onMore} disabled={loading} className="btn-soft mt-4 disabled:opacity-50">
          {loading ? "Chargement…" : "Afficher plus"}
        </button>
      )}
    </div>
  );
}
