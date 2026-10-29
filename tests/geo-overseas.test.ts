import { describe, expect, it } from "vitest";
import { parseLocation, zoneVerdict } from "@/lib/domain/geo";

const zone = { places: [{ kind: "country" as const, label: "France", country: "FR" }], remoteOk: false };
const at = (raw: string) => parseLocation(raw).places;

describe("lieux : outre-mer et États-Unis", () => {
  it.each([
    ["Saint-Denis, Saint-Denis, Reunion", "RE"],
    ["Ile de la Réunion, , France", "RE"],
    ["Fort-de-France, Fort-de-France, Martinique", "MQ"],
    ["97400 Saint-Denis", "RE"],
    ["Mamoudzou, Mayotte", "YT"],
    ["SAINTE-CLOTILDE, NON SPÉCIFIÉ, FRANCE", "RE"],
    ["Pointe-à-Pitre", "GP"],
  ])("« %s » est en outre-mer (%s), pas en France métropolitaine", (raw, code) => {
    expect(at(raw)[0]?.country).toBe(code);
    expect(zoneVerdict({ places: at(raw), remote: "onsite", remote_scope: [] }, zone)).toBe("out");
  });
  it.each(["York, SC 29745", "Wabash, IN 46992", "Charleston, SC 29403"])("« %s » est aux États-Unis, pas en France", (raw) => {
    expect(at(raw)[0]?.country).toBe("US");
  });
  it("Saint-Denis (93) reste en Île-de-France, et l'Union européenne n'est pas La Réunion", () => {
    expect(at("93200 Saint-Denis")[0]).toMatchObject({ country: "FR", region: "IDF" });
    expect(at("Union Européenne, , France")[0]?.country).not.toBe("RE");
  });
});
