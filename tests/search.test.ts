import { describe, expect, it } from "vitest";
import { haystack, matchesSearch } from "@/lib/search";

const offer = (o: Partial<Parameters<typeof haystack>[0]>) => haystack({ title: "Product Manager", location_raw: null, places: [], contract: "unknown", remote: "unknown", company: { name: "Acme", brand: null }, ...o });

describe("barre de recherche des offres", () => {
  const vie = offer({ title: "Product Manager - Singapore", contract: "vie", places: [{ city: "Singapore", country: "SG" }] });
  const lyon = offer({ title: "Product Owner", contract: "cdi", places: [{ city: "Lyon", region: "ARA", country: "FR" }], remote: "hybrid", company: { name: "Decathlon", brand: null } });
  it.each([
    ["V.I.E.", vie, true],
    ["VIE", vie, true],
    ["vie singapore", vie, true],
    ["V.I.E.", lyon, false],
    ["lyon", lyon, true],
    ["CDI Lyon", lyon, true],
    ["decath", lyon, true],
    ["hybride", lyon, true],
    ["cdd", lyon, false],
  ] as const)("« %s »", (query, text, expected) => {
    expect(matchesSearch(text, query)).toBe(expected);
  });
});
