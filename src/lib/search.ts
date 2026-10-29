import { CONTRACT_LABELS } from "@/lib/domain/criteria";
import { REMOTE_LABELS, type Remote } from "@/lib/domain/offer";
import { placeLabel } from "@/lib/format";

// The offers' search bar: every word typed must be found somewhere in the offer as the person sees it
// (title, company, place, contract, remote work), whatever accents, case or dots ("V.I.E." is "vie").
export const words = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/(\w)\.(?=\w\.?)/g, "$1")
    .replace(/[^a-z0-9+#]+/g, " ")
    .trim();

type Searchable = {
  title: string;
  location_raw: string | null;
  places: { city?: string; region?: string; country?: string }[];
  contract: string;
  remote: string;
  company: { name: string; brand: string | null };
};

export function haystack(o: Searchable): string {
  const contract = CONTRACT_LABELS[o.contract as keyof typeof CONTRACT_LABELS] ?? "";
  return ` ${words([o.title, o.company.name, o.company.brand ?? "", placeLabel(o.places, o.location_raw), o.location_raw ?? "", o.contract === "unknown" ? "" : `${o.contract} ${contract}`, REMOTE_LABELS[o.remote as Remote] ?? ""].join(" "))} `;
}

// Each word typed, as the start of a word of the offer ("lyo" finds Lyon, "vie" finds V.I.E.).
export function matchesSearch(text: string, query: string): boolean {
  const terms = words(query).split(" ").filter(Boolean);
  return terms.every((t) => text.includes(` ${t}`));
}
