import { describe, expect, it } from "vitest";
import { Criteria } from "@/lib/domain/criteria";
import { parseLocation } from "@/lib/domain/geo";
import { detectContract, isVie } from "@/lib/domain/signals";
import { prefilter } from "@/lib/scoring/prefilter";
import { keepInScope } from "@/lib/collect/run";

describe("V.I.E.", () => {
  it.each(["Ingénieur Méthodes Industrialisation (H/F) - VIE Chine", "V.I.E - Product Manager - Singapore", "VIE Marketing Analyst (12 mois) - New York"])("« %s » est un V.I.E.", (title) => {
    expect(isVie(title)).toBe(true);
    expect(detectContract(title)).toBe("vie");
  });
  it.each(["Auxiliaire de vie H/F", "AUXILIAIRE DE VIE SOCIALE / RELAYEUR H/F", "Responsable Equipe Projets Vie Série - Robotique", "Chargé de vie scolaire"])("« %s » n'en est pas un", (title) => {
    expect(isVie(title)).toBe(false);
  });
  it("un V.I.E. à l'étranger n'est pas hors zone pour qui en cherche un", () => {
    const offer = { title: "VIE - Product Manager", companyName: "X", contract: "vie", experience_min_years: null, ...parseLocation("Singapore"), remote_scope: [] };
    const paris = { places: [{ kind: "city" as const, label: "Paris", country: "FR" }], remoteOk: false };
    expect(prefilter(offer, Criteria.parse({ targetRoles: ["Product Manager"], zone: paris, contracts: ["cdi", "vie"] }), 1).pass).toBe(true);
    expect(prefilter(offer, Criteria.parse({ targetRoles: ["Product Manager"], zone: paris, contracts: ["cdi"] }), 1).pass).toBe(false);
  });
  it("la collecte garde un V.I.E. de n'importe quel pays quand quelqu'un en cherche", () => {
    const keep = keepInScope({ queries: [], countries: new Set(["FR"]), wanted: () => true, vie: true });
    expect(keep(parseLocation("Singapore").places, "onsite", "VIE - Product Manager")).toBe(true);
    expect(keep(parseLocation("Singapore").places, "onsite", "Product Manager")).toBe(false);
  });
});
