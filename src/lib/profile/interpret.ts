import { CONTRACTS, Criteria, CvSummary, type Contract, type ZonePlace } from "@/lib/domain/criteria";
import { parseLocation, REGION_LABELS } from "@/lib/domain/geo";
import { getLlm, LlmUnavailableError } from "@/lib/llm";

const COUNTRY_NAMES: Record<string, string> = { FR: "France", US: "États-Unis", GB: "Royaume-Uni", DE: "Allemagne", ES: "Espagne", PT: "Portugal", BE: "Belgique", CH: "Suisse", NL: "Pays-Bas", CA: "Canada", IT: "Italie", IE: "Irlande", LU: "Luxembourg" };

const CRITERIA_SYSTEM = `Tu aides une personne à formaliser sa recherche d'emploi. Tu reçois sa description en langage naturel et, parfois, un résumé de son CV (sans données personnelles).
Réponds uniquement avec un objet JSON de cette forme :
{
  "targetRoles": [1 à 3 métiers visés, intitulés courts et génériques, sans niveau (pas "junior"), jamais une phrase],
  "titleVariants": [6 à 14 intitulés équivalents tels qu'ils apparaissent dans de vraies offres, en français ET en anglais : d'abord TOUS ceux que la personne cite, puis les niveaux d'entrée (junior, associate) et sigles usuels. Sans intitulés seniors, sans parenthèses ni précisions, sans répéter les métiers visés],
  "bridgeRoles": [métiers passerelles : TOUS ceux que la personne cite, avec ses mots ; si elle n'en cite aucun, 0 à 4 évidents],
  "sectorsPriority": [secteurs que la personne préfère],
  "sectorsOk": [secteurs explicitement acceptés, sinon vide],
  "sectorsAvoid": [secteurs ou types de postes que la personne veut éviter],
  "otherSectors": { "open": true si la personne accepte d'autres secteurs que ses préférés, "condition": condition éventuelle en quelques mots ou null },
  "zone": { "places": [{ "label": "nom du lieu", "kind": "city" | "region" | "country", "country": "code ISO à 2 lettres" }], "remoteOk": true si le télétravail complet depuis son pays lui convient },
  "outOfZone": "never" | "exceptional" | "yes",
  "contracts": contrats souhaités parmi ["cdi","cdd","stage","alternance","freelance","vie"] (« vie » pour un V.I.E., volontariat international en entreprise),
  "experienceYears": années d'expérience professionnelle cumulée telles que la personne les décrit (stages compris), nombre ou null. Si la description donne ce chiffre, il prime sur le CV,
  "languages": [langues avec niveau],
  "availability": disponibilité en quelques mots ou null,
  "companiesAvoid": [entreprises que la personne ne veut pas voir],
  "companiesFollow": [entreprises que la personne veut suivre],
  "dealBreakers": [autres contraintes rédhibitoires, phrases courtes],
  "openness": 0 à 100
}
Règles :
- Respecte chaque négation. « Pas de stage ni d'alternance » veut dire que stage et alternance sont EXCLUS : ne les mets pas dans "contracts". Un secteur « à éviter » ne va jamais dans les secteurs prioritaires.
- "contracts" ne contient que les contrats voulus. Si la personne ne cherche qu'un CDI, réponds ["cdi"]. Vide seulement si rien n'est dit.
- "outOfZone" : "exceptional" si la personne accepte un poste hors de sa zone seulement s'il est exceptionnel, "yes" si elle est ouverte partout, sinon "never".
- Une région française s'écrit en entier (ex. « Île-de-France »), avec "kind": "region".
- "languages" : si la description est rédigée en français et qu'aucune langue maternelle n'est indiquée, ajoute « Français ».
- "openness" : 0 = uniquement le poste idéal, 100 = veut surtout décrocher un premier poste. Place-le d'après les indices du texte (exigence, urgence, ouverture aux passerelles) ; 50 s'il n'y a aucun indice.
- N'invente rien qui contredise la description. Reprends les termes de métier de la personne.`;

export const CV_SYSTEM = `Tu lis un CV dont les données personnelles ont été retirées. Réponds uniquement avec un objet JSON :
{ "experienceYears": nombre ou null (expérience professionnelle cumulée, stages compris),
  "roles": [postes occupés, avec le type de structure], "skills": [compétences clés et outils ou logiciels, 5 à 15 ; les outils écrits tels quels dans le CV (ex. "Figma", "Premiere Pro", "After Effects", "SQL"), jamais reformulés en catégorie], "languages": [langues avec niveau],
  "education": [diplômes], "highlights": [3 à 5 réalisations concrètes, chiffrées si possible] }
Chaque élément de liste est une simple chaîne de caractères, jamais un objet (ex. "Product Owner, startup sport connecté, 6 mois").
N'invente rien.`;

export async function extractCvSummary(redactedCv: string): Promise<CvSummary> {
  const raw = await getLlm().json({ system: CV_SYSTEM, user: redactedCv.slice(0, 12_000), tier: "strong" });
  const parsed = CvSummary.safeParse(flattenLists(raw));
  if (!parsed.success) throw new LlmUnavailableError("CV summary did not match the schema");
  return parsed.data;
}

export async function interpretSearch(text: string, cv: CvSummary | null): Promise<Criteria> {
  const user = `Description :\n${text.slice(0, 4000)}\n\nRésumé du CV :\n${cv ? JSON.stringify(cv) : "aucun"}`;
  const llm = getLlm();
  // One retry: a smaller model occasionally returns a malformed object.
  for (let attempt = 0; attempt < 2; attempt++) {
    const raw = await llm.json({ system: CRITERIA_SYSTEM, user, tier: "strong" });
    const parsed = Criteria.safeParse(coerce(raw));
    if (parsed.success) return reconcile(withCvFallbacks(parsed.data, cv), text);
  }
  throw new LlmUnavailableError("criteria did not match the schema");
}

function withCvFallbacks(c: Criteria, cv: CvSummary | null): Criteria {
  if (c.experienceYears === null && cv?.experienceYears != null) c.experienceYears = cv.experienceYears;
  if (c.languages.length === 0 && cv?.languages.length) c.languages = cv.languages;
  return c;
}

// Models often return list items as objects ({poste, entreprise, durée}); a readable string is what we keep.
function asText(v: unknown): string | null {
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  if (v && typeof v === "object") {
    const parts = Object.values(v as Record<string, unknown>).map(asText).filter((x): x is string => Boolean(x && x.trim()));
    return parts.length ? parts.join(", ") : null;
  }
  return null;
}

export function flattenLists(raw: unknown): unknown {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const r = { ...(raw as Record<string, unknown>) };
  for (const [key, value] of Object.entries(r)) {
    if (Array.isArray(value) && key !== "contracts") r[key] = value.map(asText).filter((x): x is string => Boolean(x && x.trim()));
  }
  if (typeof r.experienceYears === "string") r.experienceYears = Number.parseFloat(r.experienceYears) || null;
  return r;
}

// Repairs the shapes a model gets slightly wrong (country names, numbers as strings) before validation.
function coerce(input: unknown): unknown {
  const raw = flattenLists(input);
  if (!raw || typeof raw !== "object") return raw;
  const r = { ...(raw as Record<string, unknown>) };
  const zone = (r.zone ?? {}) as { places?: unknown[]; remoteOk?: unknown };
  const places: ZonePlace[] = [];
  for (const p of zone.places ?? []) {
    const label = typeof p === "string" ? p : (p as { label?: unknown })?.label;
    if (typeof label !== "string" || !label.trim()) continue;
    const given = p as { kind?: string; country?: string };
    const place = typeof given.country === "string" && given.country.length === 2 && ["city", "region", "country"].includes(given.kind ?? "") ? { label: label.trim(), kind: given.kind as ZonePlace["kind"], country: given.country.toUpperCase() } : placeFromLabel(label);
    if (place && !places.some((x) => x.label === place.label)) places.push(place);
  }
  r.zone = { places, remoteOk: typeof zone.remoteOk === "boolean" ? zone.remoteOk : true };
  if (Array.isArray(r.contracts)) r.contracts = r.contracts.map((c) => String(c).toLowerCase()).filter((c): c is Contract => (CONTRACTS as readonly string[]).includes(c));
  for (const key of ["experienceYears", "openness"] as const) {
    if (typeof r[key] === "string") r[key] = Number.parseFloat(r[key] as string);
    if (typeof r[key] === "number" && !Number.isFinite(r[key])) r[key] = null;
  }
  if (r.openness === null) delete r.openness;
  if (!["never", "exceptional", "yes"].includes(r.outOfZone as string)) delete r.outOfZone;
  return r;
}

function placeFromLabel(label: string): ZonePlace | null {
  const p = parseLocation(label).places[0];
  if (!p?.country) return null;
  if (p.city) return { label: p.city, kind: "city", country: p.country };
  if (p.region) return { label: REGION_LABELS[p.region] ?? p.region, kind: "region", country: p.country };
  return { label: COUNTRY_NAMES[p.country] ?? p.country, kind: "country", country: p.country };
}

const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[’']/g, "'").replace(/\s+/g, " ").trim();

function uniq(values: string[], exclude: string[] = []) {
  const seen = new Set(exclude.map(fold));
  return values.filter((v) => {
    const k = fold(v);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

const CONTRACT_WORDS: Record<Contract, string> = { cdi: "cdi", cdd: "cdd", stage: "stages?", alternance: "alternances?", freelance: "freelances?", vie: "v\\.?i\\.?e\\.?" };

// Deterministic safety net over the model's answer: negations, duplicates, contradictions.
export function reconcile(c: Criteria, text: string): Criteria {
  const t = fold(text);
  const out: Criteria = structuredClone(c);

  out.targetRoles = uniq(out.targetRoles.filter((r) => r.length <= 60 && !/\bje\b/i.test(r)));
  // A role named only where the person talks about a bridge ("un poste passerelle (…) peut m'intéresser")
  // is a bridge, not a target, even when the model promoted it.
  const sentences = t.split(/[.!?\n]+/);
  const bridgeTalk = sentences.filter((x) => /passerelle|tremplin|evolution vers|evoluer vers/.test(x));
  const seekTalk = sentences.filter((x) => /cherche|recherche|vise|souhaite|aimerais/.test(x) && !bridgeTalk.includes(x));
  const onlyBridge = (role: string) => bridgeTalk.some((x) => x.includes(fold(role))) && !seekTalk.some((x) => x.includes(fold(role)));
  const demoted = out.targetRoles.slice(1).filter(onlyBridge);
  if (demoted.length > 0) {
    out.targetRoles = out.targetRoles.filter((r) => !demoted.includes(r));
    out.bridgeRoles = [...demoted, ...out.bridgeRoles];
  }
  // "Product Manager (Growth)" is not how offers are titled: keep the searchable part only.
  out.titleVariants = uniq(out.titleVariants.map((v) => v.replace(/\s*\([^)]*\)/g, "").trim()).filter(Boolean), out.targetRoles);
  out.bridgeRoles = uniq(out.bridgeRoles, out.targetRoles);
  // A bridge is not an equivalent title: "Product Owner Junior" stays out of the variants when
  // "Product Owner orienté discovery" is a bridge. The core of a bridge drops its qualifiers.
  const bridgeCores = out.bridgeRoles.map((b) => fold(b).split(/\s+(?:oriente|orientee|avec|en|pour|vers|dans)\b/)[0].replace(/\s*\(.*$/, "").trim());
  out.titleVariants = out.titleVariants.filter((v) => !bridgeCores.some((core) => core.length > 2 && fold(v).includes(core)));
  out.sectorsAvoid = uniq(out.sectorsAvoid);
  const avoided = new Set(out.sectorsAvoid.map(fold));
  out.sectorsPriority = uniq(out.sectorsPriority).filter((s) => !avoided.has(fold(s)));
  out.sectorsOk = uniq(out.sectorsOk, out.sectorsPriority).filter((s) => !avoided.has(fold(s)));
  out.languages = uniq(out.languages);
  out.companiesAvoid = uniq(out.companiesAvoid);
  out.companiesFollow = uniq(out.companiesFollow, out.companiesAvoid);

  // "pas de stage ni d'alternance", "sans CDD", "stage exclu"…
  const excluded = new Set<Contract>();
  for (const [contract, word] of Object.entries(CONTRACT_WORDS) as [Contract, string][]) {
    const negated = new RegExp(`\\b(pas|ni|sans|aucun|aucune|jamais|exclu\\w*)\\s+(de |d'|du |d'un |d'une |en |un |une )?(contrat (de |d')?)?${word}\\b`);
    const excludedAfter = new RegExp(`\\b${word}\\s+(exclus?|non merci|a exclure)\\b`);
    if (negated.test(t) || excludedAfter.test(t)) excluded.add(contract);
  }
  if (/\b(uniquement|seulement|que) (en |un |des )?cdi\b|\bcdi (uniquement|seulement)\b/.test(t)) out.contracts = ["cdi"];
  out.contracts = out.contracts.filter((x) => !excluded.has(x));
  // An empty list means "every contract": keep the exclusions meaningful.
  if (out.contracts.length === 0 && excluded.size > 0) out.contracts = CONTRACTS.filter((x) => !excluded.has(x));

  // What the person writes beats what was inferred from the CV: "environ 1 an d'expérience".
  const years = t.match(/(\d+(?:[.,]\d+)?)\s*(?:ans?|annees?)\s+(?:d'experience|d'xp|d'exp)/);
  if (years) out.experienceYears = Number.parseFloat(years[1].replace(",", "."));

  if (/(etranger|international|hors de france|autre pays)[^.]{0,80}exceptionn|exceptionn[^.]{0,80}(etranger|international|hors de france)/.test(t)) out.outOfZone = "exceptional";

  return out;
}
