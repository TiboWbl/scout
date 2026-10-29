import { z } from "zod";

// What a user is looking for. Produced by the LLM from free text (+ CV), then edited as chips.
// Nothing here has a default value tied to a specific job or person.

export const CONTRACTS = ["cdi", "cdd", "stage", "alternance", "freelance", "vie"] as const;
export type Contract = (typeof CONTRACTS)[number];

export const CONTRACT_LABELS: Record<Contract | "unknown", string> = {
  cdi: "CDI",
  cdd: "CDD",
  stage: "Stage",
  alternance: "Alternance",
  freelance: "Freelance",
  vie: "V.I.E.",
  unknown: "Contrat non précisé",
};

export const ZonePlace = z.object({
  label: z.string().min(1),
  kind: z.enum(["city", "region", "country"]),
  // ISO 3166-1 alpha-2, e.g. "FR"
  country: z.string().length(2).transform((c) => c.toUpperCase()),
});
export type ZonePlace = z.infer<typeof ZonePlace>;

const list = () => z.array(z.string().trim().min(1)).default([]);

export const Criteria = z.object({
  targetRoles: list(),
  titleVariants: list(),
  bridgeRoles: list(),
  sectorsPriority: list(),
  sectorsOk: list(),
  sectorsAvoid: list(),
  // Whether sectors outside the priority/accepted lists are welcome, and on what condition.
  otherSectors: z
    .object({ open: z.boolean().default(true), condition: z.string().trim().nullable().default(null) })
    .default({ open: true, condition: null }),
  zone: z
    .object({
      places: z.array(ZonePlace).default([]),
      // A full-remote role open to one of the zone's countries counts as inside the zone.
      remoteOk: z.boolean().default(true),
    })
    .default({ places: [], remoteOk: true }),
  // What to do with offers outside the zone: never shown, shown apart if exceptional, or treated normally.
  outOfZone: z.enum(["never", "exceptional", "yes"]).default("never"),
  contracts: z.array(z.enum(CONTRACTS)).default([]),
  experienceYears: z.number().min(0).max(45).nullable().default(null),
  languages: list(),
  availability: z.string().trim().nullable().default(null),
  companiesAvoid: list(),
  companiesFollow: list(),
  dealBreakers: list(),
  // 0 = dream job only, 100 = mostly want to start somewhere
  openness: z.number().min(0).max(100).default(50),
});
export type Criteria = z.infer<typeof Criteria>;

export function emptyCriteria(): Criteria {
  return Criteria.parse({});
}

export function hasMinimumCriteria(c: Criteria) {
  return c.targetRoles.length > 0 && c.zone.places.length > 0;
}

// Structured CV extraction. Built from a redacted CV: never contains name or contact details.
export const CvSummary = z.object({
  experienceYears: z.number().min(0).max(45).nullable().default(null),
  roles: list(),
  skills: list(),
  languages: list(),
  education: list(),
  highlights: list(),
});
export type CvSummary = z.infer<typeof CvSummary>;
