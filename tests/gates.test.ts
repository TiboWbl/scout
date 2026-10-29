import { describe, expect, it } from "vitest";
import { parseLocation, zoneVerdict } from "@/lib/domain/geo";
import { detectContract, detectExperienceYears, titleSeniorityYears } from "@/lib/domain/signals";
import { prefilter } from "@/lib/scoring/prefilter";
import { PROFILE } from "./fixtures/regression";

const PARIS = { places: [{ label: "Paris", kind: "city" as const, country: "FR" }], remoteOk: true };

function offerAt(location: string, context = "") {
  const loc = parseLocation(location, context);
  return { places: loc.places, remote: loc.remote, remote_scope: loc.remoteScope };
}

describe("zone", () => {
  it("reconnaît les villes multiples des ATS", () => {
    expect(parseLocation("Boston, Massachusetts, USA; New York, New York, USA").places).toEqual([
      { city: "Boston", country: "US", region: undefined },
      { city: "New York", country: "US", region: undefined },
    ]);
    expect(parseLocation("Paris, Paris, France").places[0]).toMatchObject({ city: "Paris", country: "FR", region: "IDF" });
  });

  it("ne confond pas Paris (Texas, Ontario) avec Paris", () => {
    expect(parseLocation("Paris, TX").places[0]).toMatchObject({ city: "Paris", country: "US" });
    expect(parseLocation("Paris, Texas, United States").places[0]).toMatchObject({ country: "US" });
    expect(parseLocation("Paris, ON, Canada").places[0]).toMatchObject({ country: "CA" });
    expect(parseLocation("Paris, Île-de-France, France").places[0]).toMatchObject({ country: "FR", region: "IDF" });
  });

  it("garde Paris, écarte New York et Boston", () => {
    expect(zoneVerdict(offerAt("Paris offices"), PARIS)).toBe("in");
    expect(zoneVerdict(offerAt("New York, New York, USA"), PARIS)).toBe("out");
    expect(zoneVerdict(offerAt("Boston, Massachusetts, USA"), PARIS)).toBe("out");
  });

  it("compte un full remote ouvert à la France, pas un remote réservé aux US", () => {
    expect(zoneVerdict(offerAt("Remote - France"), PARIS)).toBe("in");
    expect(zoneVerdict(offerAt("Remote (EMEA)"), PARIS)).toBe("in");
    expect(zoneVerdict(offerAt("Remote (US)"), PARIS)).toBe("out");
    expect(zoneVerdict(offerAt("Remote US only"), PARIS)).toBe("out");
  });

  it("ne refuse jamais un lieu illisible", () => {
    expect(zoneVerdict(offerAt("HQ"), PARIS)).toBe("unknown");
    // A search engine that only says "France": the city is to be checked, not ruled out.
    expect(zoneVerdict({ ...offerAt("France"), places: [{ country: "FR" }] }, PARIS)).toBe("unknown");
  });

  it("accepte une région ou un pays comme zone", () => {
    const idf = { places: [{ label: "Île-de-France", kind: "region" as const, country: "FR" }], remoteOk: false };
    expect(zoneVerdict(offerAt("Boulogne-Billancourt"), idf)).toBe("in");
    expect(zoneVerdict(offerAt("Lyon"), idf)).toBe("out");
    const france = { places: [{ label: "France", kind: "country" as const, country: "FR" }], remoteOk: false };
    expect(zoneVerdict(offerAt("Lyon"), france)).toBe("in");
  });
});

describe("réglage « Offres hors de ma zone »", () => {
  const ny = { title: "Product Manager", companyName: "X", contract: "cdi", experience_min_years: null, ...offerAt("New York, NY") };
  it("jamais : écartée", () => {
    expect(prefilter(ny, { ...PROFILE, outOfZone: "never" }, 1).pass).toBe(false);
  });
  it("seulement si exceptionnelle : une autre région est gardée mais marquée hors zone", () => {
    const lyon = { title: "Product Manager", companyName: "X", contract: "cdi", experience_min_years: null, ...offerAt("Lyon") };
    expect(prefilter(lyon, { ...PROFILE, outOfZone: "exceptional" }, 1)).toMatchObject({ pass: true, outOfZone: true });
  });
  it("seulement si exceptionnelle : un autre pays ou l'outre-mer est écarté", () => {
    expect(prefilter(ny, { ...PROFILE, outOfZone: "exceptional" }, 1)).toMatchObject({ pass: false, reason: "Hors de ta zone, dans un autre pays ou territoire (États-Unis)." });
    const reunion = { title: "Product Manager", companyName: "X", contract: "cdi", experience_min_years: null, ...offerAt("SAINTE-CLOTILDE, NON SPÉCIFIÉ, FRANCE") };
    expect(prefilter(reunion, { ...PROFILE, outOfZone: "exceptional" }, 1).pass).toBe(false);
  });
  it("oui : traitée normalement", () => {
    expect(prefilter(ny, { ...PROFILE, outOfZone: "yes" }, 1)).toMatchObject({ pass: true, outOfZone: false });
  });
});

describe("contrat, séniorité, expérience", () => {
  const paris = { companyName: "X", experience_min_years: null, ...offerAt("Paris") };
  it("détecte le contrat sans jamais deviner", () => {
    expect(detectContract("Stage Product Manager")).toBe("stage");
    expect(detectContract("Product Manager", "Full-time")).toBe("cdi");
    expect(detectContract("Product Management Intern", "Full-time")).toBe("stage");
    expect(detectContract("Product Manager")).toBe("unknown");
    expect(detectContract("Product Manager", null, "Profil : première expérience (stage ou alternance acceptés). CDI.")).toBe("cdi");
    expect(detectContract("Product Manager", null, "Profil : première expérience en stage appréciée.")).toBe("unknown");
  });
  it("écarte un contrat non retenu, garde un contrat inconnu", () => {
    expect(prefilter({ ...paris, title: "PM", contract: "stage" }, PROFILE, 1).pass).toBe(false);
    expect(prefilter({ ...paris, title: "PM", contract: "unknown" }, PROFILE, 1).pass).toBe(true);
  });
  it("lit l'expérience demandée en français et en anglais", () => {
    expect(detectExperienceYears("Vous avez 3 ans d'expérience minimum")).toBe(3);
    expect(detectExperienceYears("5+ years of product management experience")).toBe(5);
    expect(detectExperienceYears("2 à 4 ans d'expérience")).toBe(2);
    expect(detectExperienceYears("Débutant accepté")).toBeNull();
  });
  it("la séniorité dépend de l'expérience de la personne", () => {
    expect(titleSeniorityYears("Senior Product Manager")).toBeGreaterThan(0);
    const senior = { ...paris, title: "Senior Product Manager", contract: "cdi" };
    expect(prefilter(senior, PROFILE, 1).pass).toBe(false);
    expect(prefilter(senior, PROFILE, 5).pass).toBe(true);
  });
  it("un écart d'expérience est une porte, pas un point", () => {
    const sixYears = { ...paris, title: "Product Manager", contract: "cdi", experience_min_years: 6 };
    expect(prefilter(sixYears, PROFILE, 1).pass).toBe(false);
    expect(prefilter({ ...sixYears, experience_min_years: 3 }, PROFILE, 1).pass).toBe(true);
  });
});

describe("séniorité et écart d'expérience (portes)", () => {
  const offer = (title: string, experience_min_years: number | null = null) => ({
    title,
    companyName: "Entreprise fictive",
    places: [{ city: "Paris", country: "FR", region: "IDF" }],
    remote: "hybrid" as const,
    remote_scope: [],
    contract: "cdi",
    experience_min_years,
  });

  it("écarte Senior et Lead pour 1 an d'expérience, les garde avec chances basses pour 2 ans", () => {
    expect(prefilter(offer("Senior Product Manager"), PROFILE, 1).pass).toBe(false);
    expect(prefilter(offer("Lead Product Manager"), PROFILE, 1).pass).toBe(false);
    expect(prefilter(offer("Senior Product Manager"), PROFILE, 2)).toMatchObject({ pass: true, experienceGap: 3 });
  });

  it("garde un écart de 2 ans, écarte un écart de 4 ans", () => {
    expect(prefilter(offer("Product Manager II"), PROFILE, 1)).toMatchObject({ pass: true, experienceGap: 2 });
    expect(prefilter(offer("Product Manager", 3), PROFILE, 1)).toMatchObject({ pass: true, experienceGap: 2 });
    expect(prefilter(offer("Product Manager", 5), PROFILE, 1).pass).toBe(false);
  });

  it("réduit les chances en proportion de l'écart", async () => {
    const { chancesCap } = await import("@/lib/scoring/prefilter");
    expect([0, 1, 2, 3].map(chancesCap)).toEqual([100, 80, 60, 35]);
  });
});

describe("expérience demandée lue dans l'offre", () => {
  const cases: [string, number | null][] = [
    ["Must-haves - 3+ years in product management, ideally in a mobile-first consumer app", 3],
    ["At least 5 years in a product role (or equivalent product ownership)", 5],
    ["You have 6+ years of experience as a Backend Engineer", 6],
    ["4 years as a Product Manager in a B2B SaaS", 4],
    ["Tu as 2 ans d'expérience minimum en tant que Product Owner", 2],
    ["Vous justifiez de 3 ans en gestion de produit digital", 3],
    ["2 à 4 ans sur un poste similaire", 2],
    ["Expérience de 3 ans minimum dans le produit", 3],
    ["Une première expérience de 1 an est un plus", 1],
    ["3-5 years' experience in product", 3],
    ["Depuis 15 ans, nous accompagnons nos clients", null],
    ["Fondée il y a 10 ans, notre entreprise compte 200 personnes", null],
    ["We've grown 3x over the past 2 years in Europe", null],
    ["Theodo connait une croissance exceptionnelle depuis 15 ans", null],
  ];
  for (const [text, years] of cases) {
    it(`« ${text.slice(0, 50)} » → ${years ?? "rien"}`, () => {
      expect(detectExperienceYears(text)).toBe(years);
    });
  }
});

describe("expérience en fourchette", async () => {
  const { detectExperience, experienceLabel } = await import("@/lib/domain/signals");
  const cases: [string, number | null, number | null, string | null][] = [
    ["Tu es diplômé(e) d'une école d'ingénieur avec jusqu'à 2 ans d'expérience professionnelle", 0, 2, "0 à 2 ans"],
    ["Expérience : 3-6 ans dans un rôle produit", 3, 6, "3 à 6 ans"],
    ["Vous avez entre 2 à 4 ans d'expérience en gestion de projet", 2, 4, "2 à 4 ans"],
    ["Must-haves - 3+ years in product management", 3, null, "3 ans et plus"],
    ["Up to 2 years of experience in a product team", 0, 2, "0 à 2 ans"],
    ["Moins de 3 ans d'expérience", 0, 3, "0 à 3 ans"],
    ["Diplômé·e d'une grande école d'ingénieur, entre 2 et 5 ans d'expérience, idéalement en conseil", 2, 5, "2 à 5 ans"],
    ["Between 1 and 3 years of experience in product", 1, 3, "1 à 3 ans"],
    // Cases seen in real postings (texts rewritten, no company named).
    ["Expérience : 4 à 8 ans en Product Management, idéalement sur un produit e-commerce", 4, 8, "4 à 8 ans"],
    ["An office manager with 2–4 years of experience, from a scale-up", 2, 4, "2 à 4 ans"],
    ["Expérience confirmée (7+ ans) en environnement Android", 7, null, "7 ans et plus"],
    ["Vous disposez d’une expérience professionnelle significative (> 5 ans) dans l’industrie", 5, null, "5 ans et plus"],
    ["Une expérience en droit privé d’au moins 5/6 ans au sein d’une direction juridique", 5, 6, "5 à 6 ans"],
    ["Expérience minimale de&#xa0;3 ans&#xa0;en assurance qualité", 3, null, "3 ans et plus"],
    ["Profil recherché - expérience, minium 3 ans, en gestion de projets digitaux", 3, null, "3 ans et plus"],
    ["Avec près de 80 ans d'expérience à l'échelle mondiale, nous accompagnons les entreprises", null, null, null],
    ["Nos 50 ans d'expérience au service de l'industrie. Contrat CDD de 2 ans, expérience en vente souhaitée", null, null, null],
    ["8–12+ years of engineering experience, including 3–5+ years managing multiple teams", 8, 12, "8 à 12 ans"],
    ["Avantages : prime d'ancienneté à partir de 3 ans. Diplôme bac+2/3 ans en sciences", null, null, null],
  ];
  for (const [text, min, max, label] of cases) {
    it(`« ${text.slice(0, 45)} » → ${label}`, () => {
      expect(detectExperience(text)).toEqual({ min, max });
      expect(experienceLabel(min, max)).toBe(label);
    });
  }
});

describe("expérience écrite en toutes lettres", async () => {
  const { detectExperienceLevel, experienceText } = await import("@/lib/domain/signals");
  const cases: [string, "junior" | "experienced" | null][] = [
    ["Vous justifiez d'une expérience significative en gestion de produit digital.", "experienced"],
    ["Profil junior accepté, curiosité et rigueur avant tout.", "junior"],
    ["Une première expérience significative en product management (stage inclus).", "junior"],
    ["Tu es peu expérimenté mais motivé ? Postule !", "junior"],
    ["Proven track record shipping consumer products.", "experienced"],
    ["Tu accompagneras les PM juniors de l'équipe.", null],
  ];
  for (const [text, level] of cases) it(`« ${text.slice(0, 45)} » → ${level}`, () => expect(detectExperienceLevel(text)).toBe(level));
  it("un nombre d'années l'emporte sur les mots, jamais de nombre inventé", () => {
    expect(experienceText(3, null, "junior")).toBe("3 ans et plus");
    expect(experienceText(null, null, "experienced")).toBe("Expérience significative demandée");
  });
  it("une expérience significative compte comme quelques années d'écart, sans exclure", () => {
    const offer = { title: "Product Manager", companyName: "Fictive", places: [{ city: "Paris", country: "FR" }], remote: "onsite" as const, remote_scope: [], contract: "cdi", experience_min_years: null, experience_level: "experienced" as const };
    const r = prefilter(offer, { ...PROFILE, zone: { places: [], remoteOk: true }, contracts: [] }, 1);
    expect(r.pass && r.experienceGap).toBe(3);
  });
});

describe("lieux français moins connus", () => {
  it("lit la région, le code postal et les villes à tirets ou à espaces", () => {
    expect(zoneVerdict(offerAt("Niort, Nouvelle-Aquitaine, France"), PARIS)).toBe("out");
    expect(zoneVerdict(offerAt("Vannes, Brittany, France"), PARIS)).toBe("out");
    expect(zoneVerdict(offerAt("AIX EN PROVENCE, FR-U, France"), PARIS)).toBe("out");
    expect(zoneVerdict(offerAt("Ormes, Centre, France"), PARIS)).toBe("out");
    expect(parseLocation("4 rue Langevin, 59000 Lille, France").places[0]).toMatchObject({ country: "FR", region: "HDF" });
    expect(parseLocation("12 rue X, 92130 Ville Inconnue").places[0]).toMatchObject({ region: "IDF" });
    expect(zoneVerdict(offerAt("Paris Centre"), PARIS)).toBe("in");
    const idf = { places: [{ label: "Île-de-France", kind: "region" as const, country: "FR" }], remoteOk: false };
    expect(zoneVerdict(offerAt("12 rue X, 92130 Ville Inconnue"), idf)).toBe("in");
  });
});

describe("salaire lu dans l'offre", async () => {
  const { detectSalary } = await import("@/lib/domain/signals");
  const cases: [string, string | null][] = [
    ["Salaire : 45-55 k€ brut annuel selon profil", "45 à 55 k€ brut par an"],
    ["Rémunération : entre 50 000 € et 60 000 € bruts par an", "50 à 60 k€ brut par an"],
    ["Compensation: €60,000 – €75,000 base salary", "60 à 75 k€ par an"],
    ["Salaire : 1867.02 € à 2133.68 € + variable", "1 867 € à 2 134 € par mois"],
    ["Nous avons levé 30 M€ en 2024, rémunération selon profil", null],
    ["Ticket restaurant 9,48€ / jour travaillé", null],
    ["Négociation sur les projets inférieurs à 100k€", null],
  ];
  for (const [text, salary] of cases) it(`« ${text.slice(0, 40)} » → ${salary}`, () => expect(detectSalary(text)).toBe(salary));
});

describe("contrat et télétravail écrits dans la description", async () => {
  const { detectRemote } = await import("@/lib/domain/signals");
  it("lit un contrat annoncé, où qu'il soit dans le texte", () => {
    expect(detectContract("Product Designer", null, `${"Présentation de l'équipe. ".repeat(200)} Infos pratiques — Contrat : CDI, Paris`)).toBe("cdi");
    expect(detectContract("Product Manager Junior (H/F)", null, "Fictive cherche un·e product manager junior en stage pour rejoindre l'équipe produit.")).toBe("stage");
    expect(detectContract("Product Manager", null, "Première expérience (stage ou alternance acceptés) en produit.")).toBe("unknown");
  });
  it("lit le télétravail, pas les « rituels hybrides »", () => {
    expect(detectRemote("Télétravail jusqu'à 3 jours par semaine")).toBe("hybrid");
    expect(detectRemote("Hybrid work, with 2 days of remote work per week")).toBe("hybrid");
    expect(detectRemote("Poste en full remote depuis la France")).toBe("remote");
    expect(detectRemote("Animer les rituels agiles ou hybrides avec les équipes")).toBeNull();
  });
});

describe("faits relevés par le contrôle du 7 octobre", async () => {
  const { detectExperience, detectSalary, detectRemote } = await import("@/lib/domain/signals");
  it("ne lit pas « bac +4 year » comme de l'expérience", () => {
    expect(detectExperience("Education: Bac +4 year or equivalent degree. Background & expected experiences: - 10+ years in security operations")).toEqual({ min: 10, max: null });
  });
  it("lit un salaire suivi des avantages", () => {
    expect(detectSalary("🤑 une rémunération comprise entre 50 et 60k€ 🍽️ tickets restaurant Swile")).toBe("50 à 60 k€ par an");
  });
  it("lit le contrat en fin d'annonce, le stage d'abord", () => {
    expect(detectContract("Product Support Manager", null, `${"Missions et contexte. ".repeat(300)} Détails du poste • CDI • Temps plein • Nantes`)).toBe("cdi");
    expect(detectContract("Assistant·e Product Manager", null, "Le premier objectif de ton stage est d'appréhender le métier. Une embauche en CDI est possible ensuite.")).toBe("stage");
  });
  it("lit les formes courantes du télétravail, jamais une négation", () => {
    expect(detectRemote("The possibility to work remotely (up to 2 days a week)")).toBe("hybrid");
    expect(detectRemote("Avantages : tickets restaurant, télétravail possible")).toBe("hybrid");
    expect(detectRemote("Poste 100 % présentiel, pas de télétravail")).toBeNull();
  });
});

describe("exigé ou souhaité", async () => {
  const { splitRequirements } = await import("@/lib/domain/requirements");
  it("une section « Un plus » et une ligne « serait un plus » sont souhaitées, le reste exigé", () => {
    const r = splitRequirements("Profil recherché :\n• Tu maîtrises Jira\n• SQL serait un plus\nLes petits plus :\n• Python\n• Figma\nPourquoi nous rejoindre ?\n• Une équipe produit de 12 personnes");
    expect(r.required).toContain("Jira");
    expect(r.required).toContain("équipe produit");
    expect(r.bonus).toContain("SQL");
    expect(r.bonus).toContain("Python");
    expect(r.bonus).toContain("Figma");
    expect(r.required).not.toContain("Python");
  });
});

describe("métier inventé et formations", async () => {
  const { inventedRoleWords, isTraining } = await import("@/lib/scoring/relevance");
  const { Criteria } = await import("@/lib/domain/criteria");
  const c = Criteria.parse({ targetRoles: ["Monteur vidéo"], titleVariants: ["Motion Designer"] });
  it("une raison qui parle de vidéo pour un monteur de vélos est une invention", () => {
    expect(inventedRoleWords("Monteur vidéo en CDD dans le sport.", "Monteur.euse Cycle (H/F)", "Tu montes et répares les vélos en atelier.", c)).toEqual(["video"]);
    expect(inventedRoleWords("Montage vidéo de formats YouTube.", "Monteur (H/F)", "Tu réalises le montage vidéo de nos formats.", c)).toEqual([]);
  });
  it("une formation n'est pas une offre d'emploi, un chargé de formation si", () => {
    expect(isTraining("Formation Monteur audiovisuel - Paris")).toBe(true);
    expect(isTraining("Chargé de formation (H/F)")).toBe(false);
  });
});
