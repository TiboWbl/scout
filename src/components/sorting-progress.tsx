"use client";

import { usePathname, useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useRef, useState } from "react";

// `toRead`: the offers the model reads, known once the quick gates have set the rest aside.
type Progress = { remaining: number; toRead?: number; note?: string };

// The sort runs for the whole app, not one page: started once per search (its version), it goes on while
// the person moves between pages, and every page reads the same progress. Each call fits a serverless
// time budget; interruptions are retried on their own. A few new offers (after a collection) are sorted
// in silence: a banner for them would be noise.
const SHOWN_FROM = 30;
const SortingContext = createContext<Progress | null>(null);
export const useSortingProgress = () => useContext(SortingContext);

export function SortingProvider({ pending, enabled, version, children }: { pending: number; enabled: boolean; version: number; children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [progress, setProgress] = useState<Progress | null>(enabled && pending >= SHOWN_FROM ? { remaining: pending } : null);
  // Offres is refreshed as verdicts land; other pages do not depend on them.
  const onOffres = useRef(pathname.startsWith("/offres"));
  useEffect(() => {
    onOffres.current = pathname.startsWith("/offres");
    // Back on Offres during a sort: show what landed meanwhile.
    if (onOffres.current && progress) router.refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- on arrival only
  }, [pathname]);
  useEffect(() => {
    // A new search (new version) starts a new sort, with what it has left to read.
    const initial = pending;
    if (!enabled || initial <= 0) return;
    const shown = initial >= SHOWN_FROM;
    let cancelled = false;
    const abort = new AbortController();
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
    (async () => {
      if (shown) setProgress({ remaining: initial });
      let remaining = initial;
      let toRead: number | undefined;
      let failures = 0;
      let idle = 0;
      for (let call = 0; call < 120 && !cancelled && remaining > 0; call++) {
        const res = await fetch("/api/score", { method: "POST", signal: abort.signal }).catch(() => null);
        if (cancelled) return;
        if (!res?.ok) {
          const body = (await res?.json().catch(() => null)) as { error?: string; retry?: boolean } | null;
          failures++;
          // The model is unreachable: say so and keep trying, never fall back to a rough guess.
          const delay = body?.retry ? 30_000 : Math.min(5_000 * failures, 30_000);
          if (shown) setProgress({ remaining, toRead, note: body?.retry ? `${body.error} Nouvel essai dans 30 secondes.` : "Petite coupure, Scout reprend dans un instant." });
          if (failures >= 10) {
            if (shown) setProgress({ remaining, toRead, note: "Le classement n'avance plus. Reviens un peu plus tard, il reprendra là où il s'est arrêté." });
            return;
          }
          await wait(delay);
          continue;
        }
        failures = 0;
        const data = (await res.json()) as { remaining: number; scoredNow: number };
        if (cancelled) return;
        // Progress only moves forward on screen, even when the estimate of what is left is revised.
        remaining = Math.min(remaining, data.remaining);
        // The first answer sets the clear-cut cases aside: what is left is what the model reads.
        toRead ??= remaining;
        idle = data.scoredNow === 0 ? idle + 1 : 0;
        if (shown) setProgress({ remaining, toRead });
        if (onOffres.current) router.refresh();
        if (idle >= 3) break;
      }
      if (!cancelled) {
        setProgress(null);
        // The final selection, counted once and for all.
        if (onOffres.current) router.refresh();
      }
    })();
    return () => {
      cancelled = true;
      abort.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per search version
  }, [router, version, enabled]);
  return <SortingContext.Provider value={progress}>{children}</SortingContext.Provider>;
}

// Shown in the menu on the other pages: the sort goes on, and where it stands.
export function sortingPercent(p: Progress): number | null {
  return p.toRead ? Math.max(0, Math.min(99, Math.round((100 * (p.toRead - p.remaining)) / p.toRead))) : null;
}

// `excluded`: offers already set aside (place, contract, experience, role): said, so an empty selection
// during the sort never looks like a bug.
// `shown`: offers on screen now (new verdicts and, after a search change, the previous selection).
export function SortingBanner({ progress, total, excluded = null, shown = 1 }: { progress: Progress; total: number; excluded?: number | null; shown?: number }) {
  // Two steps: the quick gates over the whole stock, then the model on the offers close to the role.
  // The count shown is the step under way, never 10 000 offers "read" one by one.
  const reading = progress.toRead !== undefined && progress.toRead > 0;
  const of = reading ? progress.toRead! : total;
  const done = Math.max(0, of - progress.remaining);
  // About 80 offers read a minute on the site.
  const minutes = Math.max(1, Math.ceil(progress.remaining / 80));
  return (
    <div className="mt-5 rounded-2xl bg-brand-soft px-4 py-3.5 text-sm" role="status">
      <div className="flex items-center gap-3">
        <span aria-hidden className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-brand/25 border-t-brand" />
        <p className="font-semibold">
          {reading
            ? `Scout lit les ${of.toLocaleString("fr-FR")} offres proches de ton métier : ${done.toLocaleString("fr-FR")} lues, encore ${minutes} min environ`
            : "Scout écarte d'abord les offres hors de ta recherche…"}
        </p>
      </div>
      {/* The quick first step has no count worth a bar: it only appears for the reading. */}
      {reading && (
        <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-brand/15">
          <div className="h-full rounded-full bg-brand transition-[width] duration-700" style={{ width: `${Math.round((100 * done) / of)}%` }} />
        </div>
      )}
      <p className="mt-2 text-muted">
        {progress.note ??
          (reading
            ? `${excluded ? `${excluded.toLocaleString("fr-FR")} offres hors de ta recherche sont déjà écartées. ` : ""}${shown > 0 ? "Les plus proches d'abord : ta sélection se remplit au fur et à mesure, tu peux déjà la parcourir." : "Les plus proches d'abord : les premières offres arrivent d'ici une minute."}`
            : "Lieu, contrat, expérience, métier : quelques secondes.")}
      </p>
    </div>
  );
}
