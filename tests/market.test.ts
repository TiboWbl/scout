// Mon marché drives direct changes to a CV: every figure must be the one counted in the offers.
// A small fictional market where each expected number is known in advance.
import { describe, expect, it } from "vitest";
import { Criteria } from "@/lib/domain/criteria";
import { computeMarket, salaryMidpoint, type MarketDataset } from "@/lib/market/compute";
import { marketInsights } from "@/lib/market/advice";

const AT = new Date("2026-10-15T12:00:00Z");
const criteria = Criteria.parse({ targetRoles: ["Comptable"], titleVariants: ["Accountant"] });
const pad = "Tu rejoins une équipe à taille humaine et tu participes à la vie du service au quotidien. ".repeat(14);

type Over = Partial<MarketDataset["rows"][number]> & { id: string; title: string; text: string };
let n = 0;
function dataset(offers: Over[]): MarketDataset {
  const rows = offers.map((o) => ({
    company_id: `c${n++}`,
    first_seen_at: "2026-10-01T00:00:00Z",
    published_at: "2026-10-01T00:00:00Z",
    archived_at: null,
    skills: [
      { name: "SAP", kind: "outil" as const },
      { name: "Excel", kind: "outil" as const },
      { name: "Autonomie", kind: "savoir_etre" as const },
    ],
    experience_min_years: null,
    experience_level: null,
    salary_text: null,
    remote: "unknown",
    contract: "cdi",
    sources: ["greenhouse:x"],
    ...o,
    text: undefined,
  }));
  const texts = new Map(offers.map((o) => [o.id, o.text]));
  return { rows, vocabulary: rows.flatMap((r) => r.skills ?? []), description: async () => texts, company: async () => new Map() };
}

describe("Mon marché : chaque chiffre est celui compté", () => {
  it("une même annonce trouvée deux fois compte une fois, la page de l'employeur gardée", async () => {
    const same = `Tu tiens la comptabilité sur SAP et Excel. ${pad}`;
    const m = await computeMarket(
      dataset([
        { id: "a", title: "Comptable (H/F)", text: same },
        { id: "b", title: "Comptable (H/F)", text: same, sources: ["adzuna"] },
        { id: "c", title: "Comptable fournisseurs", text: `Tu tiens la comptabilité sur Excel. ${pad}` },
      ]),
      criteria,
      { at: AT },
    );
    expect(m.total).toBe(2);
    expect(m.skills.find((s) => s.key === "excel")).toMatchObject({ count: 2, share: 100 });
    expect(m.skills.find((s) => s.key === "sap")).toBeUndefined(); // cited by one offer only: not a trend
  });

  it("le salaire débutant ne compte ni gratification de stage, ni salaire net", async () => {
    const offers: Over[] = [
      ...[30, 32, 34, 36, 38].map((k, i) => ({ id: `j${i}`, title: "Comptable junior", text: `Poste ${i}. ${pad}`, salary_text: `${k} k€ brut par an`, experience_min_years: 1 })),
      { id: "s1", title: "Stage - Comptable", text: `Stage 1. ${pad}`, salary_text: "1 400 € par mois", contract: "stage" },
      { id: "s2", title: "Comptable en alternance", text: `Alternance. ${pad}`, salary_text: "1 300 € par mois", contract: "alternance" },
      { id: "n1", title: "Comptable junior", text: `Poste net. ${pad}`, salary_text: "25 k€ net par an", experience_min_years: 0 },
    ];
    const m = await computeMarket(dataset(offers), criteria, { at: AT });
    expect(m.salaries.junior).toMatchObject({ median: 34, n: 5 });
  });

  it("« affichée junior » veut dire junior dans l'intitulé, jamais un stage ni « première expérience de 5 ans »", async () => {
    const m = await computeMarket(
      dataset([
        { id: "1", title: "Comptable junior", text: `Un. ${pad}`, experience_min_years: 2 },
        { id: "2", title: "Comptable junior", text: `Deux. ${pad}`, experience_min_years: 0 },
        { id: "3", title: "Comptable (H/F)", text: `Une première expérience de 5 ans. ${pad}`, experience_min_years: 5, experience_level: "junior" },
        { id: "4", title: "Stagiaire comptable", text: `Quatre. ${pad}`, contract: "stage" },
      ]),
      criteria,
      { at: AT },
    );
    expect(m.experience.juniorLabeled).toBe(2);
    expect(m.experience.juniorAsking2).toBe(1);
  });

  it("le savoir-être n'entre pas dans les compétences à ajouter", async () => {
    const offers: Over[] = Array.from({ length: 6 }, (_, i) => ({ id: `o${i}`, title: "Comptable", text: `Autonomie et Excel. ${i} ${pad}` }));
    const m = await computeMarket(dataset(offers), criteria, { at: AT });
    const insights = marketInsights(m);
    expect([...insights.add, ...insights.show].map((i) => i.name)).toEqual(["Excel"]);
  });
});

describe("salaire annuel", () => {
  it.each([
    ["45 à 55 k€ brut par an", 50],
    ["1 867 € à 2 134 € par mois", 24],
    ["2 000 € à 3 000 € par mois", 30],
    ["30 k€ net par an", null],
  ] as const)("« %s » → %s k€", (text, expected) => {
    expect(salaryMidpoint(text)).toBe(expected);
  });
});

describe("Mon CV et Mon marché disent la même chose", () => {
  it("la grille du CV reprend les compétences du marché et leur verdict", async () => {
    const { scoreCv } = await import("@/lib/cv/ats");
    const { inCvCheck } = await import("@/lib/views/skills");
    const cv = "Expérience\nPiloté la roadmap produit et le backlog, en méthode agile.\nCompétences\nSQL";
    const top = [
      { name: "Roadmap", key: "roadmap" },
      { name: "Vision produit", key: "vision produit" },
      { name: "Backlog", key: "backlog" },
    ];
    const has = inCvCheck(cv, []);
    const result = scoreCv({ text: cv, layout: { pages: 1, columnRatio: 0, spacedTitles: 0 }, filename: "cv.pdf", sizeBytes: 100_000 }, { expected: top.map((t) => t.name), present: top.filter((t) => has(t.key)).map((t) => t.name) });
    const check = result.categories.flatMap((c) => c.checks).find((c) => c.label.startsWith("Mots-clés"))!;
    // "vision" and "produit" are both in the CV, but not the phrase "vision produit": absent, as in Mon marché.
    expect(check.label).toBe("Mots-clés du métier visé (2/3)");
    expect(check.fix).toContain("Vision produit");
    expect(result.keywords).toEqual(["Roadmap", "Vision produit", "Backlog"]);
  });
});

describe("conseils du CV tirés du marché", () => {
  const layout = { pages: 1, columnRatio: 0, spacedTitles: 0 };
  const find = async (cv: string) => {
    const { scoreCv } = await import("@/lib/cv/ats");
    const result = scoreCv(
      { text: cv, layout, filename: "CV Alex Martin - Comptable.pdf", sizeBytes: 100_000 },
      { expected: ["SAP", "Excel", "Consolidation", "Anglais"], present: ["SAP", "Excel", "Anglais"], languages: ["Anglais"], shares: { SAP: 40, Excel: 70, Consolidation: 25 }, titles: [{ title: "Comptable", count: 120 }, { title: "Comptable général", count: 30 }] },
    );
    return (label: string) => result.categories.flatMap((c) => c.checks).find((c) => c.label.startsWith(label))!;
  };
  const missions = "Expérience\nTenu la comptabilité fournisseurs de 3 filiales sous SAP, clôtures mensuelles en 5 jours\nCompétences\nExcel\nLangues\nAnglais";

  it("l'intitulé du marché en tête du CV, avec les mots des offres", async () => {
    expect((await find(`Alex Martin\nComptable\n${missions}`))("Intitulé visé").ok).toBe(true);
    const missing = (await find(`Alex Martin\nGestionnaire\n${missions}`))("Intitulé visé");
    expect(missing.ok).toBe(false);
    expect(missing.fix).toContain("« Comptable » (120 offres)");
  });
  it("une compétence seulement listée est à montrer dans une mission", async () => {
    const check = (await find(`Comptable\n${missions}`))("Compétences prouvées");
    // Excel only in a list; English is shown by its level, never asked in a mission.
    expect(check.fix).toContain("Citées seulement dans une liste : Excel.");
    expect(check.points).toBe(2);
  });
  it("les absentes sont données avec leur part des offres", async () => {
    expect((await find(missions))("Mots-clés").fix).toContain("Consolidation (25 % des offres)");
  });
  it("une langue sans niveau ne suffit pas", async () => {
    expect((await find(missions))("Langues").ok).toBe(false);
    expect((await find(missions.replace("Anglais", "Anglais : courant (C1)")))("Langues").ok).toBe(true);
  });
});

describe("grille du CV : missions lues comme un recruteur", () => {
  const cv = [
    "Alex Martin",
    "Product Manager",
    "Expérience",
    "Product Manager, Acme (2023-2025)",
    "• Rédigé les User Stories et priorisé le backlog avec",
    "l'équipe de développement, en méthode agile",
    "• Mené 20 entretiens utilisateurs pour cadrer la discovery",
    "• Accompagné le lancement de 3 fonctionnalités, +15 % d'adoption",
    "• Encadré un stagiaire et animé les rituels Scrum de l'équipe",
    "Compétences",
    "Roadmap, KPIs, SQL",
  ].join("\n");
  const run = async () => {
    const { scoreCv } = await import("@/lib/cv/ats");
    const result = scoreCv(
      { text: cv, layout: { pages: 1, columnRatio: 0, spacedTitles: 0 }, filename: "CV Alex Martin.pdf", sizeBytes: 100_000 },
      { expected: ["User stories", "Backlog", "Roadmap"], present: ["User stories", "Backlog", "Roadmap"], keys: { "User stories": "user storie", Backlog: "backlog", Roadmap: "roadmap" }, titles: [{ title: "Product Manager", count: 300 }] },
    );
    return (label: string) => result.categories.flatMap((c) => c.checks).find((c) => c.label.startsWith(label))!;
  };
  it("compte les verbes au début de chaque mission, même coupée sur deux lignes", async () => {
    expect((await run())("Verbes d'action").fix).toContain("4 missions sur 4");
  });
  it("voit une compétence au pluriel ou en majuscules dans les expériences", async () => {
    // "User Stories" and "backlog" are in a mission; "Roadmap" only in the skills list.
    expect((await run())("Compétences prouvées").fix).toContain("Citées seulement dans une liste : Roadmap.");
  });
});

describe("le marché ne compte que le poste, pas la présentation de l'entreprise", async () => {
  const { roleText } = await import("@/lib/domain/requirements");
  const offer = [
    "Qui sommes-nous ?",
    "Acme est au cœur de la transformation du marché de l'immobilier, avec une culture agile et bienveillante.",
    "Tes missions :",
    "• Construire la roadmap produit avec les équipes tech et design, et la défendre auprès de la direction.",
    "• Mener la discovery : entretiens utilisateurs, tests, analyse des KPIs pour décider des priorités.",
    "Profil recherché :",
    "• 2 ans d'expérience en product management, à l'aise avec SQL et les arbitrages.",
    "Avantages :",
    "• Tickets restaurant, mutuelle, télétravail, budget formation et équipe en méthode agile.",
  ].join("\n");
  it("garde les missions et le profil, retire la présentation et les avantages", () => {
    const t = roleText(offer);
    expect(t).toContain("roadmap");
    expect(t).toContain("SQL");
    expect(t).not.toContain("transformation");
    expect(t).not.toContain("Tickets restaurant");
  });
  it("une offre sans titres de section reste entière", () => {
    const plain = "Nous cherchons un Product Manager pour construire la roadmap et mener la discovery avec les équipes, au cœur de la transformation de notre marché. ".repeat(3);
    expect(roleText(plain)).toBe(plain);
  });
});

describe("une compétence précise dit la générale (MySQL est du SQL)", async () => {
  const { inCvCheck, cvSkillsFrom } = await import("@/lib/views/skills");
  it("MySQL compte pour SQL, Scrum pour Agile, jamais l'inverse", () => {
    const has = inCvCheck("Requêtes sur MySQL, rituels Scrum", []);
    expect(has("sql")).toBe(true);
    expect(has("agile")).toBe(true);
    expect(inCvCheck("SQL", [])("mysql")).toBe(false);
    expect(cvSkillsFrom("Requêtes sur MySQL", ["SQL"])).toEqual(["SQL"]);
  });
  it("la grille conseille d'écrire aussi le mot général", async () => {
    const { scoreCv } = await import("@/lib/cv/ats");
    const r = scoreCv({ text: "Expérience\nAnalysé les données produit sur MySQL pour prioriser la roadmap", layout: { pages: 1, columnRatio: 0, spacedTitles: 0 }, filename: "cv.pdf", sizeBytes: 1000 }, { expected: ["SQL"], present: ["SQL"], keys: { SQL: "sql" } });
    const k = r.categories.flatMap((c) => c.checks).find((c) => c.label.startsWith("Mots-clés"))!;
    expect(k.good).toContain("« SQL (MySQL) »");
  });
});

describe("CV : chiffres et lignes à réécrire", async () => {
  const { figuresIn, strongLine } = await import("@/lib/cv/ats");
  const { readAsRecruiter } = await import("@/lib/cv/recruiter");
  it("compte tous les chiffres d'une mission, sauf les années et les durées", () => {
    expect(figuresIn("Atteint 300 000 vues et un NPS de 45, note 4,8/5, +15 % d'adoption")).toEqual(["300 000 vues", "45", "4,8/5", "+15 %"]);
    expect(figuresIn("Stage de 6 mois en 2024")).toEqual([]);
  });
  it("une ligne déjà solide n'est jamais proposée à la réécriture", () => {
    expect(strongLine("Piloté le lancement de 3 fonctionnalités, +15 % d'adoption")).toBe(true);
    expect(strongLine("Participation au lancement de fonctionnalités")).toBe(false);
  });
  it("une réécriture qui ferait perdre un chiffre ou le verbe n'est pas proposée", async () => {
    const text = "Expérience\nGestion du backlog pour 3 équipes\nPiloté le lancement de 3 fonctionnalités, +15 % d'adoption";
    const llm = { json: async () => ({ avis: "", atouts: [], manques: [], personnaliser: [], lignes: [
      { ligne: "Gestion du backlog pour 3 équipes", proposition: "Priorisé le backlog de plusieurs équipes", pourquoi: "" },
      { ligne: "Gestion du backlog pour 3 équipes", proposition: "Priorisé le backlog de 3 équipes, livraisons [chiffre] % plus rapides", pourquoi: "" },
      { ligne: "Piloté le lancement de 3 fonctionnalités, +15 % d'adoption", proposition: "Lancé 3 fonctionnalités", pourquoi: "" },
    ] }) } as never;
    const { suggestions } = await readAsRecruiter(llm, { text, redacted: text, roles: "Product Manager", experienceYears: 1, keywords: ["Backlog"], offer: null });
    expect(suggestions.map((s) => s.proposition)).toEqual(["Priorisé le backlog de 3 équipes, livraisons [chiffre] % plus rapides"]);
  });
});
