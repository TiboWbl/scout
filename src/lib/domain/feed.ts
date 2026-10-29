import type { Level, Place, Remote } from "./offer";
import { isStale } from "@/lib/format";

export type FeedOffer = {
  id: string;
  title: string;
  location_raw: string | null;
  places: Place[];
  remote: Remote;
  contract: string;
  experience_min_years: number | null;
  experience_max_years: number | null;
  experience_level: "junior" | "experienced" | null;
  salary_text: string | null;
  seniority_estimate: "junior" | "confirme" | "senior" | null;
  image_url: string | null;
  apply_url: string;
  published_at: string | null;
  first_seen_at: string;
  sources: string[];
  skills?: { name: string; kind: string }[] | null;
  repost_count?: number;
  reposted_at?: string | null;
  company: { id: string; name: string; domain: string | null; brand: string | null; accent_color: string | null; cover_url: string | null; product: string | null };
};

export type FeedItem = {
  offer: FeedOffer;
  level: Level;
  out_of_zone: boolean;
  excluded_reason: string | null;
  missions: string[];
  salary: string | null;
  experience_asked: string | null;
  score_interet: number | null;
  score_chances: number | null;
  score_tremplin: number | null;
  why: string | null;
  watch: string[];
  scored_by: string;
  saved: boolean;
  dismissed: boolean;
};

const OFFER_FIELDS =
  "id, title, location_raw, places, remote, contract, experience_min_years, experience_max_years, experience_level, salary_text, seniority_estimate, image_url, apply_url, published_at, first_seen_at, sources, skills, repost_count, reposted_at, archived_at, company:companies(id, name, domain, brand, accent_color, cover_url, product)";

// One shape for every feed query, server-side for the selection and client-side for "Écartées".
export const SCORE_SELECT = `level, out_of_zone, excluded_reason, missions, salary, experience_asked, score_interet, score_chances, score_tremplin, why, watch, scored_by, offer:offers(${OFFER_FIELDS})`;

// Search engines keep postings long after they close; a career page lists only open ones (an offer
// gone from it is archived). So only an offer known from engines alone grows stale with age.
const ENGINES = new Set(["adzuna", "jooble", "careerjet", "france-travail"]);
export function isStaleOffer(offer: Pick<FeedOffer, "published_at" | "first_seen_at" | "sources">, now = Date.now()) {
  return (offer.sources ?? []).every((s) => ENGINES.has(s)) && isStale(offer.published_at ?? offer.first_seen_at, now);
}

// The same posting seen on a search engine and on the company's own page, under a slightly different
// title ("Product Manager H/F" and "Product Manager"): only the company's version is shown.
const titleWords = (title: string, company: string) => {
  const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const noise = new Set(["cdi", "cdd", "stage", "alternance", "paris", "france", "remote", "hybride", ...fold(company).split(/[^a-z0-9]+/)]);
  return new Set(fold(title).replace(/\((?:h|f|x|m|n|w|d)(?:\/(?:h|f|x|m|n|w|d))+\)|\b(?:h|f|x|m|n|w|d)(?:\/(?:h|f|x|m|n|w|d))+\b/g, " ").split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !noise.has(w)));
};
export function withoutEngineCopies<T extends { offer: Pick<FeedOffer, "title" | "sources" | "company"> }>(items: T[]): T[] {
  const own = items.filter((i) => !(i.offer.sources ?? []).every((s) => ENGINES.has(s)));
  return items.filter((i) => {
    if (!(i.offer.sources ?? []).every((s) => ENGINES.has(s))) return true;
    const mine = titleWords(i.offer.title, i.offer.company.name);
    if (mine.size < 2) return true;
    return !own.some((o) => {
      if (o.offer.company.id !== i.offer.company.id) return false;
      const theirs = titleWords(o.offer.title, o.offer.company.name);
      const [small, big] = mine.size <= theirs.size ? [mine, theirs] : [theirs, mine];
      return small.size >= 2 && [...small].every((w) => big.has(w));
    });
  });
}

// "Nouveau": published (or, without a date, first seen) in the last 48 hours. One rule everywhere.
export function isNewOffer(offer: Pick<FeedOffer, "published_at" | "first_seen_at">, now = Date.now()) {
  return now - new Date(offer.published_at ?? offer.first_seen_at).getTime() < 48 * 3_600_000;
}

// The "Nouveau" pill, shared by the cards and Aujourd'hui.
export const NEW_PILL = "rounded-full bg-brand px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-button-ink";

export const LEVEL_ORDER: Record<Level, number> = { coeur: 0, solide: 1, tremplin: 2, ecartee: 3 };

// "Seulement si exceptionnelle": an out-of-zone offer only surfaces when everything else is excellent.
export function isExceptional(item: Pick<FeedItem, "level" | "score_interet" | "score_chances">) {
  return item.level === "coeur" && (item.score_interet ?? 0) >= 85 && (item.score_chances ?? 0) >= 70;
}
