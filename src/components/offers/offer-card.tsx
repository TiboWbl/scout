"use client";

import { useMemo, useState } from "react";
import { CONTRACT_LABELS } from "@/lib/domain/criteria";
import type { FeedItem } from "@/lib/domain/feed";
import { REMOTE_LABELS } from "@/lib/domain/offer";
import { tintStyle } from "@/lib/design/color";
import { freshness, placeLabel } from "@/lib/format";
import { isNewOffer, NEW_PILL } from "@/lib/domain/feed";
import { experienceText } from "@/lib/domain/signals";
import { CompanyLogo } from "@/components/company-logo";
import { NopeIcon, SaveIcon } from "@/components/icons";
import { LevelBadge } from "@/components/level-badge";
import { NopeMenu } from "./nope-menu";

type Props = {
  item: FeedItem;
  favorite?: boolean;
  selected: boolean;
  onOpen: () => void;
  onSave: () => void;
  onNope: (reason: string) => void;
  onApply: () => void;
};

export function OfferCard({ item, favorite = false, selected, onOpen, onSave, onNope, onApply }: Props) {
  const [nopeOpen, setNopeOpen] = useState(false);
  const [coverFailed, setCoverFailed] = useState(false);
  const { offer } = item;
  // The offer's own photo first, then the company's.
  const cover = !coverFailed ? (offer.image_url ?? offer.company.cover_url) : null;
  const style = useMemo(() => tintStyle(offer.company.accent_color), [offer.company.accent_color]);
  const seenAt = offer.published_at ?? offer.first_seen_at;
  // What the posting states (read deterministically) first, else what the model quoted from it.
  const experience = experienceText(offer.experience_min_years, offer.experience_max_years, offer.experience_level, offer.seniority_estimate) ?? item.experience_asked;
  // On the card, only what is known, in a few words: the details are one click away.
  const shortExperience = experience?.replace(/^Non précisée · missions de niveau (\S+) \(estimé\)$/, "Niveau $1 (estimé)").replace(/^Non précisée$/, "").replace(/^(\d.*)$/, "Expérience : $1") || null;
  const salary = offer.salary_text ?? item.salary;

  return (
    <article
      style={style}
      onClick={onOpen}
      className={`tinted group flex cursor-pointer flex-col gap-3 rounded-[22px] border border-[var(--halo)] p-[18px] transition-shadow hover:shadow-[0_8px_30px_-12px_rgba(23,21,31,0.25)] ${selected ? "outline outline-2 outline-offset-2 outline-[var(--accent)]" : ""}`}
    >
      {cover && (
        // The company's own share image, by URL only; hidden if it fails to load.
        // eslint-disable-next-line @next/next/no-img-element -- external image, referenced not copied
        <img src={cover} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setCoverFailed(true)} className="-mx-[18px] -mt-[18px] mb-1 h-24 w-[calc(100%+36px)] max-w-none rounded-t-[22px] object-cover sm:h-32" />
      )}
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <CompanyLogo name={offer.company.name} domain={offer.company.domain} brand={offer.company.brand} />
        {/* Wide enough to keep its two lines whole; the badges move under it on a narrow card. */}
        <div className="min-w-[9.5rem] flex-1">
          <p className="flex items-center gap-1.5 truncate text-sm font-semibold">
            {offer.company.name}
            {favorite && (
              <span className="text-[15px] leading-none text-[#f5a524]" title="Une de tes entreprises favorites" aria-label="Entreprise favorite">
                ★
              </span>
            )}
          </p>
          <p className="whitespace-nowrap text-[12.5px] text-muted">{seenAt ? `Publiée ${freshness(seenAt)}` : ""}</p>
        </div>
        <span className="ml-auto flex items-center gap-1.5">
          {/* Published in the last 48 hours: applying early matters. */}
          {isNewOffer(offer) && <span className={NEW_PILL}>Nouveau</span>}
          <LevelBadge level={item.level} />
        </span>
      </header>

      <h2 className="font-display text-xl font-bold leading-[1.15] tracking-tight">
        <button type="button" onClick={onOpen} className="text-left focus:outline-none focus-visible:underline">
          {offer.title}
        </button>
      </h2>

      <div className="flex flex-wrap gap-1.5 text-[12.5px] font-medium text-muted">
        <span className="rounded-full bg-pill px-2.5 py-1">{placeLabel(offer.places, offer.location_raw)}</span>
        {offer.remote !== "unknown" && <span className="rounded-full bg-pill px-2.5 py-1">{REMOTE_LABELS[offer.remote]}</span>}
        {offer.contract !== "unknown" && <span className="rounded-full bg-pill px-2.5 py-1">{CONTRACT_LABELS[offer.contract as keyof typeof CONTRACT_LABELS]}</span>}
        {salary && <span className="rounded-full bg-pill px-2.5 py-1 text-ink">{salary}</span>}
        {shortExperience && <span className="rounded-full bg-pill px-2.5 py-1 text-ink">{shortExperience}</span>}
      </div>

      {/* What the company does, in one line: often what decides whether to open the offer. */}
      {offer.company.product && <p className="line-clamp-1 text-[13.5px] text-muted">{offer.company.product}</p>}

      {/* One line on why, the rest (missions, what to check) is in the offer's detail. */}
      {item.why && (
        <p className="line-clamp-2 text-[14px] leading-snug text-muted">
          <span className="font-semibold text-[var(--accent)]">Pour toi : </span>
          {item.why}
        </p>
      )}

      <div className="mt-auto flex items-center gap-2 pt-1" onClick={(e) => e.stopPropagation()}>
        <button type="button" onClick={onApply} className="rounded-xl bg-button px-4 py-2 text-[13.5px] font-semibold text-button-ink hover:opacity-90">
          Postuler
        </button>
        <button
          type="button"
          onClick={onSave}
          aria-pressed={item.saved}
          aria-label={item.saved ? "Retirer des sauvegardes" : "Sauvegarder"}
          title={item.saved ? "Sauvegardée" : "Sauvegarder"}
          className={`grid h-9 w-9 place-items-center rounded-xl border border-line bg-pill ${item.saved ? "text-[var(--accent)]" : "text-muted hover:text-ink"}`}
        >
          <SaveIcon filled={item.saved} className="h-[17px] w-[17px]" />
        </button>
        <button
          type="button"
          onClick={() => setNopeOpen((v) => !v)}
          aria-label="Pas pour moi"
          title="Pas pour moi"
          className="grid h-9 w-9 place-items-center rounded-xl border border-line bg-pill text-muted hover:text-ink"
        >
          <NopeIcon className="h-[17px] w-[17px]" />
        </button>
      </div>
      {nopeOpen && (
        <div onClick={(e) => e.stopPropagation()}>
          <NopeMenu onPick={(r) => { setNopeOpen(false); onNope(r); }} onCancel={() => setNopeOpen(false)} />
        </div>
      )}
    </article>
  );
}
