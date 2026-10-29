import type { Criteria } from "@/lib/domain/criteria";
import { CONTRACT_LABELS } from "@/lib/domain/criteria";
import { zoneVerdict } from "@/lib/domain/geo";
import type { Place, Remote } from "@/lib/domain/offer";
import { EXPERIENCED_YEARS, titleSeniorityYears } from "@/lib/domain/signals";

// Hard constraints are gates, never points: an offer that breaks one is set aside, whatever
// its other qualities. Only safe exclusions live here; everything else is the LLM's job.

export type GateInput = {
  title: string;
  companyName: string;
  places: Place[];
  remote: Remote;
  remote_scope: string[];
  contract: string;
  experience_min_years: number | null;
  experience_level?: "junior" | "experienced" | null;
};

export type GateResult =
  // experienceGap: years asked (in the text or implied by the title) beyond the person's experience.
  | { pass: true; outOfZone: boolean; experienceGap: number; notes: string[] }
  | { pass: false; reason: string };

// From this gap on (required − real, in years) an offer is set aside rather than scored lower: a recruiter
// bends on a year, sometimes two for a strong junior, almost never three.
export const EXPERIENCE_GAP_EXCLUDE = 3;
export const gapReason = (required: number, years: number) => `${required} an${plural(required)} d'expérience demandé${plural(required)}, ${years} de ton côté : un écart que les recruteurs comblent rarement.`;

// Chances cap by experience gap: up to 2 years the offer stays, with chances lowered in proportion;
// at 3 years it stays with low chances.
export function chancesCap(gap: number): number {
  if (gap <= 0) return 100;
  if (gap <= 2) return 100 - gap * 20;
  return 35;
}

function norm(s: string) {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
}

function plural(n: number) {
  return n > 1 ? "s" : "";
}

// Gates in reading order: zone, contract, seniority, experience gap, companies avoided.
// (Sectors to avoid are judged on the real company by the LLM step, also as a gate.)
export function prefilter(offer: GateInput, criteria: Criteria, experienceYears: number | null): GateResult {
  const notes: string[] = [];

  let outOfZone = false;
  const zone = zoneVerdict(offer, criteria.zone);
  // A V.I.E. is abroad by definition: for someone looking for one, its country is not out of zone.
  const vieSought = offer.contract === "vie" && criteria.contracts.includes("vie");
  if (zone === "out" && !vieSought) {
    if (criteria.outOfZone === "never") return { pass: false, reason: "Hors de ta zone de recherche." };
    // "Exceptionally elsewhere" means another region, never another country or overseas territory: an
    // offer in La Réunion or in the United States is not an exceptional offer near Paris.
    const zoneCountries = new Set(criteria.zone.places.map((p) => p.country));
    const countries = offer.places.map((p) => p.country).filter((c): c is string => Boolean(c));
    if (criteria.outOfZone === "exceptional" && countries.length > 0 && !countries.some((c) => zoneCountries.has(c))) {
      const names = new Intl.DisplayNames(["fr"], { type: "region" });
      const where = [...new Set(countries)].map((c) => names.of(c) ?? c).join(", ");
      return { pass: false, reason: `Hors de ta zone, dans un autre pays ou territoire (${where}).` };
    }
    if (criteria.outOfZone === "exceptional") outOfZone = true;
  } else if (zone === "unknown") {
    notes.push("Lieu à vérifier sur l'annonce.");
  }

  if (criteria.contracts.length > 0 && offer.contract !== "unknown" && !criteria.contracts.includes(offer.contract as Criteria["contracts"][number])) {
    return { pass: false, reason: `${CONTRACT_LABELS[offer.contract as keyof typeof CONTRACT_LABELS] ?? offer.contract}, un type de contrat que tu n'as pas retenu.` };
  }

  let experienceGap = 0;
  if (experienceYears !== null) {
    const implied = titleSeniorityYears(offer.title);
    // A title's seniority is an estimate ("Senior" is 3 to 5 years depending on the company): one more year
    // of leeway than for years written in the offer.
    if (implied - experienceYears >= EXPERIENCE_GAP_EXCLUDE + 1) {
      return { pass: false, reason: `Intitulé trop senior pour ton expérience (${experienceYears} an${plural(experienceYears)}).` };
    }
    const required = offer.experience_min_years;
    if (required !== null && required - experienceYears >= EXPERIENCE_GAP_EXCLUDE) {
      return { pass: false, reason: gapReason(required, experienceYears) };
    }
    // "Expérience significative" without a number counts as a few years asked; never enough to exclude.
    const worded = required === null && offer.experience_level === "experienced" ? EXPERIENCED_YEARS : 0;
    experienceGap = Math.max(0, implied - experienceYears, (required ?? 0) - experienceYears, worded - experienceYears);
  }

  if (criteria.companiesAvoid.some((c) => norm(c) && norm(offer.companyName).includes(norm(c)))) {
    return { pass: false, reason: `${offer.companyName} fait partie des entreprises que tu évites.` };
  }

  return { pass: true, outOfZone, experienceGap, notes };
}
