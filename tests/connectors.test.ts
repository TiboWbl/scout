// Connectors read public feeds whose format we do not control: fixtures pin what we rely on.
import { afterEach, describe, expect, it, vi } from "vitest";
import { personio, teamtailor, welcomekit } from "@/lib/collect/connectors/ats-more";
import { slugGuesses } from "@/lib/collect/discover";
import { keepInScope } from "@/lib/collect/run";

const board = { name: "Entreprise Fictive", domain: null, token: "fictive" };

function serve(body: string) {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(body, { status: 200 })));
}

afterEach(() => vi.unstubAllGlobals());

describe("flux Teamtailor", () => {
  it("lit titre, lieu, télétravail, description et date", async () => {
    serve(`<rss><channel><title>Entreprise Fictive - Carrières</title>
      <item><title>Product Manager</title>
        <description>&lt;p&gt;Tu pilotes la &lt;strong&gt;discovery&lt;/strong&gt;.&lt;/p&gt;</description>
        <pubDate>Tue, 30 Sep 2026 10:00:00 +0200</pubDate>
        <link>https://fictive.teamtailor.com/jobs/1-product-manager</link>
        <remoteStatus>hybrid</remoteStatus>
        <tt:locations><tt:location><tt:city>Paris</tt:city><tt:country>France</tt:country></tt:location></tt:locations>
      </item></channel></rss>`);
    const [offer] = await teamtailor(board);
    expect(offer).toMatchObject({ title: "Product Manager", remote: "hybrid", company: { name: "Entreprise Fictive" }, applyUrl: "https://fictive.teamtailor.com/jobs/1-product-manager" });
    expect(offer.places[0]).toMatchObject({ city: "Paris", country: "FR" });
    expect(offer.description).toContain("Tu pilotes la discovery.");
    expect(offer.publishedAt).toBe("2026-09-30T08:00:00.000Z");
  });
});

describe("flux Personio", () => {
  it("lit le poste, le bureau, le contrat et les sections de description", async () => {
    serve(`<workzag-jobs><position><id>42</id><subcompany>Entreprise Fictive</subcompany><office>Lyon</office>
      <name>Chef de produit digital</name><employmentType>permanent</employmentType><createdAt>2026-09-20T09:00:00+00:00</createdAt>
      <jobDescriptions><jobDescription><name>Missions</name><value><![CDATA[<p>Construire la roadmap.</p>]]></value></jobDescription></jobDescriptions>
      </position></workzag-jobs>`);
    const [offer] = await personio(board);
    expect(offer).toMatchObject({ title: "Chef de produit digital", contract: "cdi", applyUrl: "https://fictive.jobs.personio.de/job/42" });
    expect(offer.places[0]).toMatchObject({ city: "Lyon", country: "FR" });
    expect(offer.description).toContain("Construire la roadmap.");
  });
});

describe("découverte", () => {
  it("devine les adresses de page carrière à partir du nom", () => {
    expect(slugGuesses("Acme Sport SAS")).toEqual(["acmesport", "acme-sport"]);
  });
});

describe("filtre géographique à la collecte", () => {
  const keep = keepInScope({ queries: [], countries: new Set(["FR"]), wanted: () => true });
  it("garde la France, écarte le reste et les lieux inconnus", () => {
    expect(keep([{ city: "Paris", country: "FR" }], "hybrid")).toBe(true);
    expect(keep([], "remote")).toBe(false);
    expect(keep([{ city: "Boston", country: "US" }], "onsite")).toBe(false);
  });
  it("garde tout tant qu'aucun profil n'existe", () => {
    expect(keepInScope({ queries: [], countries: new Set(), wanted: () => true })([{ city: "Boston", country: "US" }], "onsite")).toBe(true);
  });
});

describe("liste d'entreprises favorites", () => {
  it("lit une entreprise par ligne, des virgules, des URL et un CSV à deux colonnes", async () => {
    const { parseEntries } = await import("@/components/favorites");
    expect(parseEntries("Acme Sport\nExemple Santé, Autre Boîte\nhttps://jobs.lever.co/acme")).toEqual([{ name: "Acme Sport" }, { name: "Exemple Santé" }, { name: "Autre Boîte" }, { site: "https://jobs.lever.co/acme" }]);
    expect(parseEntries("entreprise,site\nAcme Sport,https://acme.fr\nExemple Santé,")).toEqual([{ name: "Acme Sport", site: "https://acme.fr" }, { name: "Exemple Santé", site: undefined }]);
  });
});

describe("descriptions restructurées", async () => {
  const { structureDescription } = await import("@/lib/format-description");
  it("isole les rubriques et transforme les tirets en liste", () => {
    const flat = "Rejoins une équipe produit en croissance à Paris. Tes missions : - Prioriser le backlog - Mener la discovery - Suivre les KPIs. Profil recherché : jusqu'à 2 ans d'expérience en produit.";
    const out = structureDescription(flat).split("\n");
    expect(out).toContain("Tes missions :");
    expect(out).toContain("• Prioriser le backlog");
    expect(out).toContain("Profil recherché :");
  });
  it("laisse intact un texte déjà structuré", () => {
    const ok = "Missions\n• Une\n• Deux\nProfil\n• Trois";
    expect(structureDescription(ok)).toBe(ok);
  });
});

describe("même entreprise, nom de page carrière différent", async () => {
  const { companyKey } = await import("@/lib/collect/normalize");
  it("ignore le suffixe numérique des adresses (Robeaute-1)", () => {
    expect(companyKey("Robeaute-1")).toBe(companyKey("Robeaute"));
    expect(companyKey("1&1")).not.toBe("");
  });
});

describe("page carrière reconnue dans une page web", async () => {
  const { atsFromText } = await import("@/lib/collect/resolve");
  it("lit la référence Welcome Kit telle quelle (sensible à la casse)", () => {
    expect(atsFromText(`<div data-job-reference="ACME_x1" data-organization-reference="jJ6jlll"></div>`)).toEqual({ ats: "welcomekit", token: "jJ6jlll" });
    expect(atsFromText(`new WelcomeKitEmbed('AbzqbMR')`)).toEqual({ ats: "welcomekit", token: "AbzqbMR" });
    expect(atsFromText(`<a href="https://jobs.polymer.co/acme-0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b/123">`)).toEqual({ ats: "polymer", token: "acme-0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b" }); // gitleaks:allow (fictional test identifier)
  });
  it("garde les autres plateformes en minuscules", () => {
    expect(atsFromText("https://jobs.lever.co/Acme-Sport/123")).toEqual({ ats: "lever", token: "acme-sport" });
  });
});

describe("Welcome Kit", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("lit les offres du widget public, sans les candidatures spontanées", async () => {
    serve(
      JSON.stringify({
        name: "Entreprise Fictive",
        jobs: [
          {
            reference: "FICT_1",
            name: "Product Manager Junior",
            description: "<p>Tu rejoins l'équipe produit.</p>",
            profile: "<ul><li>0 à 2 ans d'expérience</li></ul>",
            published_at: "2026-10-01T10:00:00+02:00",
            office: { city: "Paris", country: { en: "France" } },
            contract_type: { fr: "CDI" },
            websites_urls: [
              { website_reference: "wttj_fr", url: "https://www.welcometothejungle.com/companies/fictive/jobs/pm" },
              { website_reference: "fictive", url: "https://fictive.welcomekit.co/jobs/pm" },
            ],
          },
          { reference: "FICT_2", name: "Candidature spontanée", office: null, websites_urls: [{ website_reference: "fictive", url: "https://fictive.welcomekit.co/jobs/cs" }] },
        ],
      }),
    );
    const offers = await welcomekit({ ...board, token: "AbC12xY" });
    expect(offers).toHaveLength(1);
    expect(offers[0]).toMatchObject({ title: "Product Manager Junior", contract: "cdi", applyUrl: "https://fictive.welcomekit.co/jobs/pm", experienceMinYears: 0 });
    expect(offers[0].places[0]).toMatchObject({ city: "Paris", country: "FR" });
  });
});

describe("site carrière propre", async () => {
  const { jobLinks } = await import("@/lib/collect/connectors/site");
  it("garde les liens d'offres de l'entreprise, pas la navigation", () => {
    const own = `<a href="/fr/carrieres">Carrières</a><a href="/fr/carrieres/product-manager-junior-paris">Product Manager <b>Junior</b></a>
      <a href="https://autre-site.fr/jobs/product-manager-x">Ailleurs</a>`;
    expect(jobLinks(own, "https://exemple.fr/fr/carrieres")).toEqual([{ url: "https://exemple.fr/fr/carrieres/product-manager-junior-paris", label: "Product Manager Junior" }]);
    const shared = `<a href="/companies/autre/jobs/designer-paris">Autre</a><a href="/companies/fictive/jobs/data-analyst_paris?o=1">Data Analyst</a>`;
    expect(jobLinks(shared, "https://exemple.fr/companies/fictive")).toEqual([{ url: "https://exemple.fr/companies/fictive/jobs/data-analyst_paris", label: "Data Analyst" }]);
  });
});

describe("copie d'une offre vue sur un moteur", async () => {
  const { withoutEngineCopies } = await import("@/lib/domain/feed");
  const item = (id: string, title: string, sources: string[], companyId = "c1") => ({ offer: { id, title, sources, company: { id: companyId, name: "Fictive" } } as never });
  it("garde la version de la page carrière, pas la copie du moteur", () => {
    const kept = withoutEngineCopies([item("a", "Product Manager", ["teamtailor:fictive"]), item("b", "Product Manager H/F - CDI Paris", ["adzuna"]), item("c", "Product Designer", ["adzuna"]), item("d", "Product Manager", ["adzuna"], "c2")]);
    expect(kept.map((k) => (k.offer as { id: string }).id)).toEqual(["a", "c", "d"]);
  });
});

describe("Workday", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("lit la liste puis le détail des intitulés utiles", async () => {
    const { workday } = await import("@/lib/collect/connectors/ats-more");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        String(url).endsWith("/jobs")
          ? new Response(JSON.stringify({ total: 2, jobPostings: [{ title: "Product Manager", externalPath: "/job/Paris/PM_1", locationsText: "Paris" }, { title: "Comptable", externalPath: "/job/Paris/C_2", locationsText: "Paris" }] }))
          : new Response(JSON.stringify({ jobPostingInfo: { title: "Product Manager", jobDescription: "<p>Au moins 3 ans d'expérience produit.</p>", location: "Paris", country: { descriptor: "France" }, timeType: "Full time", externalUrl: "https://fictive.wd3.myworkdayjobs.com/Careers/job/Paris/PM_1" } })),
      ),
    );
    const offers = await workday({ ...board, token: "fictive.wd3.myworkdayjobs.com/Careers" }, undefined, (t) => /product/i.test(t));
    expect(offers).toHaveLength(1);
    expect(offers[0]).toMatchObject({ title: "Product Manager", experienceMinYears: 3, contract: "cdi" });
    expect(offers[0].places[0]).toMatchObject({ city: "Paris", country: "FR" });
  });
});

describe("offre fermée", async () => {
  const { isClosedPage } = await import("@/lib/collect/complete");
  it("reconnaît une annonce retirée, en anglais comme en français", () => {
    expect(isClosedPage("The job position is no longer available. Unfortunately, this job is no longer available.")).toBe(true);
    expect(isClosedPage("Cette offre n'est plus disponible")).toBe(true);
    expect(isClosedPage("Product Manager H/F : rejoins une équipe produit de 12 personnes")).toBe(false);
  });
});

describe("page d'offre sans JobPosting", async () => {
  const { fromHtmlPage } = await import("@/lib/collect/jsonld");
  const body = "<p>" + "Tu rejoins l'équipe logistique de notre entrepôt pour organiser les expéditions et suivre les stocks au quotidien. ".repeat(6) + "</p>";
  it("lit le titre, le texte et le lieu d'une page d'offre ordinaire", () => {
    const o = fromHtmlPage(`<html><head><title>Gestionnaire Logistique | Fictive</title></head><body><nav>Menu</nav><main><h1>Gestionnaire Logistique H/F</h1><p>CDD · Lyon</p>${body}</main><footer>Mentions</footer></body></html>`, "https://exemple.fr/jobs/gestionnaire-logistique");
    expect(o?.title).toBe("Gestionnaire Logistique H/F");
    expect(o?.contract).toBe("cdd");
    expect(o?.places[0]).toMatchObject({ city: "Lyon" });
  });
  it("écarte une candidature spontanée et une page trop courte", () => {
    expect(fromHtmlPage(`<main><h1>Rejoins-nous</h1><p>Candidature spontanée</p>${body}</main>`, "https://exemple.fr/jobs/spontanee")).toBeNull();
    expect(fromHtmlPage(`<main><h1>Chef de projet</h1><p>Bientôt.</p></main>`, "https://exemple.fr/jobs/chef")).toBeNull();
  });
});

describe("noms proposés par la recherche par secteur", async () => {
  const { cleanName } = await import("@/lib/collect/sectors");
  it.each([
    ["PayFit **Shine**", "Shine"],
    ["PayFit **Doctolib** **Keleo**", "Keleo"],
    ["Groupe Lagardère (Paris Match, JDD)", "Groupe Lagardère"],
    ["Strava", "Strava"],
  ])("« %s » → « %s »", (raw, name) => {
    expect(cleanName(raw)).toBe(name);
  });
});
