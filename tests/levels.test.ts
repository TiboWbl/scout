// The level is derived from the model's answers by a fixed rule: constraints are gates, never averaged.
import { describe, expect, it } from "vitest";
import { Criteria } from "@/lib/domain/criteria";
import { deriveLevel, type Facts } from "@/lib/scoring/judge";

const open = Criteria.parse({});
const closed = Criteria.parse({ otherSectors: { open: false } });
const facts = (f: Partial<Facts>): Facts => ({ match: "metier_vise", sector: "prioritaire", trap: null, dealBreaker: null, chances: 70, ...f });

describe("niveau dérivé des réponses du modèle", () => {
  it("métier visé dans un secteur prioritaire avec des chances : coup de cœur", () => {
    expect(deriveLevel(facts({}), open).level).toBe("coeur");
  });
  it("métier visé mais chances faibles : solide", () => {
    expect(deriveLevel(facts({ chances: 30 }), open).level).toBe("solide");
  });
  it("métier visé dans un autre secteur : solide si la personne est ouverte, écartée sinon", () => {
    expect(deriveLevel(facts({ sector: "autre" }), open).level).toBe("solide");
    expect(deriveLevel(facts({ sector: "autre" }), closed).level).toBe("ecartee");
  });
  it("métier visé hors secteur prioritaire : coup de cœur chez une favorite ou si l'offre est à la portée d'un junior", () => {
    expect(deriveLevel(facts({ sector: "autre" }), open).level).toBe("solide");
    expect(deriveLevel(facts({ sector: "autre", favorite: true }), open).level).toBe("coeur");
    expect(deriveLevel(facts({ sector: "accepte", reach: true }), open).level).toBe("coeur");
    expect(deriveLevel(facts({ sector: "autre", reach: true, chances: 30 }), open).level).toBe("solide");
  });
  it("passerelle : tremplin", () => {
    expect(deriveLevel(facts({ match: "passerelle" }), open).level).toBe("tremplin");
  });
  it("un secteur à éviter écarte même un excellent poste", () => {
    expect(deriveLevel(facts({ sector: "a_eviter" }), open)).toEqual({ level: "ecartee", reason: "Secteur que tu as choisi d'éviter." });
  });
  it("un piège écarte le poste et donne sa raison", () => {
    expect(deriveLevel(facts({ trap: "Poste commercial déguisé." }), open)).toEqual({ level: "ecartee", reason: "Poste commercial déguisé." });
  });
  it("un deal-breaker l'emporte sur tout le reste", () => {
    expect(deriveLevel(facts({ dealBreaker: "Astreintes le week-end." }), open).level).toBe("ecartee");
  });
});

describe("secteur évité et deal-breaker nommés par la personne", async () => {
  const { namedItem } = await import("@/lib/scoring/judge");
  const avoid = ["Paris sportifs et jeux d'argent", "Produit non digital (collection textile, retail)"];
  it("accepte un élément recopié, refuse une raison inventée", () => {
    expect(namedItem("Paris sportifs et jeux d'argent", avoid)).toBe(true);
    expect(namedItem("produit non digital", avoid)).toBe(true);
    expect(namedItem("Fintech non prioritaire", avoid)).toBe(false);
    expect(namedItem(null, avoid)).toBe(false);
  });
});

describe("preuve d'un secteur évité ou d'un deal-breaker", async () => {
  const { proves } = await import("@/lib/scoring/judge");
  it("la phrase de l'offre doit nommer le sujet de l'élément", () => {
    expect(proves("Jeu vidéo", "Nous éditons des jeux vidéo mobiles")).toBe(true);
    expect(proves("Produit non digital (collection textile, retail)", "Tu développeras la collection textile automne-hiver")).toBe(true);
    expect(proves("Produit non digital (collection textile, retail)", "Tu piloteras notre produit digital B2B")).toBe(false);
    expect(proves("Paris sportifs et jeux d'argent", "Basé à Paris, dans nos bureaux du 9e")).toBe(false);
  });
});

describe("intitulé qui nomme le métier visé", async () => {
  const { namesTargetRole } = await import("@/lib/scoring/relevance");
  const pm = Criteria.parse({ targetRoles: ["Product Manager"], titleVariants: ["PM", "Associate Product Manager"] });
  it("reconnaît le métier dans un intitulé plus long, pas dans un autre métier", () => {
    expect(namesTargetRole("Healthcare Product Manager Junior - CDI Paris", pm)).toBe(true);
    expect(namesTargetRole("Product Support Manager", pm)).toBe(false);
    expect(namesTargetRole("PM Office Coordinator", pm)).toBe(false);
  });
});

describe("faits vérifiés dans l'offre (jamais inventés)", async () => {
  const { verifiedExperience, verifiedSalary } = await import("@/lib/scoring/judge");
  it("la lecture du texte l'emporte sur l'IA", () => {
    expect(verifiedExperience("3 ans et plus", 5, "At least 5 years in a product role").label).toBe("5 ans et plus");
  });
  it("refuse une expérience absente du texte (cas d'un extrait de 500 caractères)", () => {
    expect(verifiedExperience("3 ans et plus", null, "Product Manager Sales AI, CDI à Paris, rejoins une équipe en croissance.").label).toBeNull();
  });
  it("accepte la lecture de l'IA seulement avec une citation exacte qui contient les années", () => {
    const text = "Preferred experience. Must-haves - 3+ years in product management, ideally in a mobile-first consumer app.";
    expect(verifiedExperience("3 ans et plus", null, text, "3+ years in product management")).toEqual({ label: "3 ans et plus", years: 3 });
    expect(verifiedExperience("5 ans et plus", null, text, "5+ years in product management")).toEqual({ label: null, years: null });
  });
  it("garde un salaire seulement s'il est écrit", () => {
    expect(verifiedSalary("45-55 k€", "Salaire : 45 000 - 55 000 € brut")).toBe("45-55 k€");
    expect(verifiedSalary("50 k€", "Rémunération attractive selon profil")).toBeNull();
  });
});

describe("contrat lu dans l'offre (avec preuve)", async () => {
  const { verifiedContract } = await import("@/lib/scoring/judge");
  const text = "Nous recherchons un(e) stagiaire Product Manager pour un stage de 6 mois à Paris.";
  it("garde un stage cité mot pour mot", () => {
    expect(verifiedContract("stage", "un stage de 6 mois", text)).toBe("stage");
  });
  it("refuse une citation absente ou qui ne parle pas du contrat", () => {
    expect(verifiedContract("cdi", "un CDI à Paris", text)).toBeNull();
    expect(verifiedContract("stage", "à Paris", text)).toBeNull();
  });
});

describe("pré-tri par intitulé : abréviations", async () => {
  const { titleRelevance } = await import("@/lib/scoring/relevance");
  const qa = Criteria.parse({ targetRoles: ["Product Manager"], bridgeRoles: ["QA avec évolution vers le produit"] });
  it("« Quality Assurance Analyst » est reconnu comme « QA »", () => {
    expect(titleRelevance("Quality Assurance Analyst, Paris", qa)).toBeGreaterThanOrEqual(5);
    expect(titleRelevance("Comptable fournisseurs", qa)).toBe(0);
  });
});

describe("estimation de niveau gardée sur l'offre", () => {
  it("le tri suit l'estimation que la carte affiche", async () => {
    const { sameEstimate, forStarter } = await import("@/lib/scoring/engine");
    const judged = sameEstimate({ seniority: "junior" } as never, "confirme");
    expect(judged.seniority).toBe("confirme");
    expect(forStarter({ level: "coeur" }, { years: 1, stated: null, juniorSignal: false, seniority: judged.seniority }).level).toBe("tremplin");
    expect(sameEstimate({ seniority: "junior" } as never, null).seniority).toBe("junior");
  });
});
