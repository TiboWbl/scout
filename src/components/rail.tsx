"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { AccountMenu } from "./account-menu";
import { sortingPercent, useSortingProgress } from "./sorting-progress";

// `badge`: something waiting there (a follow-up to send, an interview coming).
type Item = { href: string; label: string; badge?: number };

// The sidebar on a computer; on a phone, a slim top bar with the account and a menu button that
// opens the pages. `footer` replaces the account menu (the public demo has no account).
export function Rail({ items, firstName, avatarUrl, isAdmin, home = "/", footer }: { items: Item[]; firstName: string | null; avatarUrl: string | null; isAdmin: boolean; home?: string; footer?: React.ReactNode }) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  // A page opened from the menu closes it.
  const [lastPath, setLastPath] = useState(pathname);
  if (lastPath !== pathname) {
    setLastPath(pathname);
    setMenuOpen(false);
  }
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenuOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen]);
  const waiting = items.reduce((n, i) => n + (i.badge ?? 0), 0);
  // The sort goes on while the person is elsewhere: where it stands, one click from Offres.
  const sorting = useSortingProgress();
  const percent = sorting ? sortingPercent(sorting) : null;
  const sortingPill = sorting && !pathname.startsWith("/offres") && (
    <Link href="/offres" className="flex items-center gap-2 rounded-[14px] px-3.5 py-2 text-[13px] text-muted hover:bg-pill-solid hover:text-ink" role="status">
      <span aria-hidden className="h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-brand/25 border-t-brand" />
      {percent !== null ? `Tri en cours · ${percent} %` : "Tri en cours…"}
    </Link>
  );

  return (
    <aside className="sticky top-0 z-30 -mx-4 -mt-4 flex shrink-0 flex-col border-b border-line bg-rail px-4 py-2.5 md:top-4 md:mx-0 md:mt-0 md:h-[calc(100vh-2rem)] md:w-[220px] md:gap-1 md:rounded-3xl md:border md:px-3.5 md:py-5">
      <div className="flex items-center justify-between gap-3 md:block">
        <Link href={home} className="font-display text-[24px] font-extrabold tracking-tight text-rail-text md:block md:px-2.5 md:pb-2 md:text-[26px]">
          Scout<span className="text-brand">.</span>
        </Link>
        <div className="flex items-center gap-1.5 md:hidden">
          {sortingPill && (
            <Link href="/offres" aria-label={percent !== null ? `Tri en cours, ${percent} %` : "Tri en cours"} className="grid h-10 w-10 place-items-center rounded-xl">
              <span aria-hidden className="h-4 w-4 animate-spin rounded-full border-2 border-brand/25 border-t-brand" />
            </Link>
          )}
          {/* The demo has no account: its banner already says the profile is fictional. */}
          {!footer && <AccountMenu firstName={firstName} avatarUrl={avatarUrl} isAdmin={isAdmin} />}
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            aria-expanded={menuOpen}
            aria-controls="rail-nav"
            aria-label={menuOpen ? "Fermer le menu" : "Ouvrir le menu"}
            className="relative grid h-10 w-10 place-items-center rounded-xl text-rail-text hover:bg-pill-solid"
          >
            <span aria-hidden className="flex w-5 flex-col gap-[5px]">
              <span className={`h-0.5 rounded-full bg-current transition-transform ${menuOpen ? "translate-y-[7px] rotate-45" : ""}`} />
              <span className={`h-0.5 rounded-full bg-current transition-opacity ${menuOpen ? "opacity-0" : ""}`} />
              <span className={`h-0.5 rounded-full bg-current transition-transform ${menuOpen ? "-translate-y-[7px] -rotate-45" : ""}`} />
            </span>
            {waiting > 0 && !menuOpen && <span aria-hidden className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-peach-ink" />}
          </button>
        </div>
      </div>
      <nav id="rail-nav" className={`flex-col gap-1 pb-1 pt-2 md:flex md:pb-0 md:pt-0 ${menuOpen ? "flex" : "hidden"}`}>
        {items.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              // Each tab is loaded in full in the background: the first click opens it at once too.
              // Any change made in the app refreshes these copies.
              prefetch
              aria-current={active ? "page" : undefined}
              className={`flex items-center whitespace-nowrap rounded-[14px] px-3.5 py-2.5 text-[15px] outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand/50 ${active ? "bg-rail-active font-semibold text-rail-active-ink" : "font-medium text-rail-ink hover:bg-pill-solid hover:text-rail-text"}`}
            >
              {item.label}
              {item.badge ? (
                <span className="ml-2 inline-grid h-5 min-w-5 place-items-center rounded-full bg-peach-soft px-1.5 text-[11.5px] font-semibold text-peach-ink" aria-label={`${item.badge} à faire`}>
                  {item.badge}
                </span>
              ) : null}
            </Link>
          );
        })}
      </nav>
      {sortingPill && <div className="hidden pt-2 md:block">{sortingPill}</div>}
      <div className="mt-auto hidden pt-4 md:block">{footer ?? <AccountMenu firstName={firstName} avatarUrl={avatarUrl} isAdmin={isAdmin} />}</div>
    </aside>
  );
}
