import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { exploreCareers } from "@/lib/careers";
import { Criteria } from "@/lib/domain/criteria";

// Fictional profile and offers. The model's answer is fixed: the test checks what Scout does with it.
const offers = [
  { title: "Product Owner Junior", experience_level: "junior", experience_min_years: null },
  { title: "Product Owner", experience_level: null, experience_min_years: 5 },
  { title: "Product Analyst", experience_level: null, experience_min_years: 1 },
  { title: "Product Analyst H/F", experience_level: null, experience_min_years: 2 },
  { title: "Head of Product", experience_level: null, experience_min_years: 8 },
];
const db = { from: () => ({ select: () => ({ is: () => ({ range: async () => ({ data: offers }) }) }) }) } as unknown as SupabaseClient;
const llm = {
  name: "test",
  json: async () => ({
    metiers: [
      { titre: "Product Owner (PO) junior", pourquoi: "a", chemin: "b", missions: "c" },
      { titre: "Product Analyst", pourquoi: "a", chemin: "b", missions: "c" },
      { titre: "product owner", pourquoi: "doublon" },
      { titre: "Product Builder", pourquoi: "a" },
      { pourquoi: "sans titre" },
    ],
  }),
};
const criteria = Criteria.parse({ targetRoles: ["Product Manager"] });

describe("explorer d'autres métiers", () => {
  it("nettoie les intitulés, retire les doublons et compte les offres par règles", async () => {
    const ideas = await exploreCareers(db, llm, { text: "J'aime analyser des données", criteria, cv: null });
    expect(ideas.map((i) => i.title)).toEqual(["Product Analyst", "Product Owner", "Product Builder"]);
    expect(ideas[0]).toMatchObject({ open: 2, junior: 2 });
    expect(ideas[1]).toMatchObject({ open: 2, junior: 1 });
    expect(ideas[2]).toMatchObject({ open: 0, junior: 0 });
  });
});

describe("intitulés précisés à la main", () => {
  it("un intitulé visé suivi d'une précision reconnaît le métier", async () => {
    const { namesRole } = await import("@/lib/scoring/relevance");
    const c = Criteria.parse({ targetRoles: ["Product Manager"], titleVariants: ["Customer Success Manager - Produits SaaS", "Business Analyst (tech)"] });
    expect(namesRole("Customer Success Manager", "", c)).toBe(true);
    expect(namesRole("Business Analyst IT H/F", "", c)).toBe(true);
    expect(namesRole("Customer Service Agent", "", c)).toBe(false);
  });
});
