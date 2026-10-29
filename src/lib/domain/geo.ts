import type { ZonePlace } from "./criteria";
import type { Place, Remote } from "./offer";

// Small, explicit gazetteer. Unknown places are kept as "unknown" rather than guessed:
// an offer whose location can't be read is never excluded for its location (recall first).

const COUNTRY_ALIASES: Record<string, string> = {
  france: "FR", fr: "FR",
  "united states": "US", usa: "US", us: "US", "u.s.": "US", "u.s.a.": "US", "etats-unis": "US", "états-unis": "US", america: "US",
  "united kingdom": "GB", uk: "GB", "u.k.": "GB", england: "GB", "great britain": "GB", "royaume-uni": "GB",
  germany: "DE", deutschland: "DE", allemagne: "DE",
  spain: "ES", espana: "ES", "españa": "ES", espagne: "ES",
  portugal: "PT", netherlands: "NL", "pays-bas": "NL", belgium: "BE", belgique: "BE",
  switzerland: "CH", suisse: "CH", italy: "IT", italie: "IT", ireland: "IE", irlande: "IE",
  canada: "CA", luxembourg: "LU", poland: "PL", pologne: "PL", sweden: "SE", denmark: "DK",
  austria: "AT", czechia: "CZ", "czech republic": "CZ", romania: "RO", greece: "GR",
  morocco: "MA", maroc: "MA", tunisia: "TN", tunisie: "TN", india: "IN", israel: "IL",
  singapore: "SG", australia: "AU", japan: "JP", brazil: "BR", mexico: "MX", argentina: "AR",
  turkey: "TR", turkiye: "TR", "türkiye": "TR", "south korea": "KR", korea: "KR", ukraine: "UA", estonia: "EE", latvia: "LV",
  lithuania: "LT", finland: "FI", norway: "NO", georgia: "GE", malta: "MT", hungary: "HU", bulgaria: "BG", croatia: "HR",
  serbia: "RS", egypt: "EG", nigeria: "NG", kenya: "KE", "south africa": "ZA", "united arab emirates": "AE", uae: "AE",
  "saudi arabia": "SA", china: "CN", "hong kong": "HK", taiwan: "TW", thailand: "TH", vietnam: "VN", philippines: "PH",
  indonesia: "ID", malaysia: "MY", "new zealand": "NZ", colombia: "CO", chile: "CL", peru: "PE", uruguay: "UY", algeria: "DZ", algerie: "DZ", senegal: "SN",
};

// city -> [country, region?]. French regions use short codes so a user can pick "Île-de-France".
const CITIES: Record<string, [string, string?]> = {
  paris: ["FR", "IDF"], "la defense": ["FR", "IDF"], "la défense": ["FR", "IDF"], "boulogne-billancourt": ["FR", "IDF"],
  "issy-les-moulineaux": ["FR", "IDF"], "levallois-perret": ["FR", "IDF"], "neuilly-sur-seine": ["FR", "IDF"], "saint-ouen": ["FR", "IDF"],
  montrouge: ["FR", "IDF"], puteaux: ["FR", "IDF"], courbevoie: ["FR", "IDF"], "velizy-villacoublay": ["FR", "IDF"], "vélizy-villacoublay": ["FR", "IDF"],
  clichy: ["FR", "IDF"], nanterre: ["FR", "IDF"], "saint-denis": ["FR", "IDF"], massy: ["FR", "IDF"], "rueil-malmaison": ["FR", "IDF"],
  lyon: ["FR", "ARA"], grenoble: ["FR", "ARA"], annecy: ["FR", "ARA"], "clermont-ferrand": ["FR", "ARA"], "saint-etienne": ["FR", "ARA"],
  marseille: ["FR", "PAC"], nice: ["FR", "PAC"], "aix-en-provence": ["FR", "PAC"], "sophia antipolis": ["FR", "PAC"], toulon: ["FR", "PAC"],
  toulouse: ["FR", "OCC"], montpellier: ["FR", "OCC"], perpignan: ["FR", "OCC"],
  bordeaux: ["FR", "NAQ"], pau: ["FR", "NAQ"], limoges: ["FR", "NAQ"], poitiers: ["FR", "NAQ"], "la rochelle": ["FR", "NAQ"],
  lille: ["FR", "HDF"], amiens: ["FR", "HDF"], nantes: ["FR", "PDL"], angers: ["FR", "PDL"], "le mans": ["FR", "PDL"],
  rennes: ["FR", "BRE"], brest: ["FR", "BRE"], strasbourg: ["FR", "GES"], metz: ["FR", "GES"], nancy: ["FR", "GES"], reims: ["FR", "GES"], mulhouse: ["FR", "GES"],
  rouen: ["FR", "NOR"], caen: ["FR", "NOR"], "le havre": ["FR", "NOR"], tours: ["FR", "CVL"], orleans: ["FR", "CVL"], "orléans": ["FR", "CVL"],
  dijon: ["FR", "BFC"], besancon: ["FR", "BFC"], "besançon": ["FR", "BFC"], ajaccio: ["FR", "COR"],
  "new york": ["US"], nyc: ["US"], boston: ["US"], "san francisco": ["US"], seattle: ["US"], austin: ["US"], chicago: ["US"],
  "los angeles": ["US"], denver: ["US"], atlanta: ["US"], miami: ["US"], "washington": ["US"],
  london: ["GB"], londres: ["GB"], manchester: ["GB"], edinburgh: ["GB"],
  berlin: ["DE"], munich: ["DE"], "münchen": ["DE"], hamburg: ["DE"], frankfurt: ["DE"], cologne: ["DE"], "köln": ["DE"], darmstadt: ["DE"], mainz: ["DE"], marburg: ["DE"], stuttgart: ["DE"],
  madrid: ["ES"], barcelona: ["ES"], barcelone: ["ES"], valencia: ["ES"], lisbon: ["PT"], lisboa: ["PT"], lisbonne: ["PT"], porto: ["PT"],
  amsterdam: ["NL"], rotterdam: ["NL"], brussels: ["BE"], bruxelles: ["BE"], zurich: ["CH"], "zürich": ["CH"], geneva: ["CH"], "genève": ["CH"], geneve: ["CH"], lausanne: ["CH"],
  milan: ["IT"], milano: ["IT"], rome: ["IT"], dublin: ["IE"], toronto: ["CA"], montreal: ["CA"], "montréal": ["CA"], vancouver: ["CA"],
  warsaw: ["PL"], stockholm: ["SE"], copenhagen: ["DK"], vienna: ["AT"], prague: ["CZ"], casablanca: ["MA"], tunis: ["TN"],
  bangalore: ["IN"], bengaluru: ["IN"], "tel aviv": ["IL"], singapore: ["SG"], sydney: ["AU"], tokyo: ["JP"], "sao paulo": ["BR"], "são paulo": ["BR"],
  istanbul: ["TR"], ankara: ["TR"], seoul: ["KR"], kyiv: ["UA"], kiev: ["UA"], lviv: ["UA"], kharkiv: ["UA"], karkiv: ["UA"], tallinn: ["EE"],
  riga: ["LV"], vilnius: ["LT"], helsinki: ["FI"], oslo: ["NO"], tbilisi: ["GE"], krakow: ["PL"], "kraków": ["PL"], wroclaw: ["PL"],
  bucharest: ["RO"], sofia: ["BG"], budapest: ["HU"], athens: ["GR"], belgrade: ["RS"], zagreb: ["HR"], cairo: ["EG"], lagos: ["NG"],
  nairobi: ["KE"], johannesburg: ["ZA"], "cape town": ["ZA"], dubai: ["AE"], "abu dhabi": ["AE"], riyadh: ["SA"], shanghai: ["CN"],
  beijing: ["CN"], shenzhen: ["CN"], taipei: ["TW"], bangkok: ["TH"], "ho chi minh": ["VN"], hanoi: ["VN"], manila: ["PH"], jakarta: ["ID"],
  "kuala lumpur": ["MY"], melbourne: ["AU"], auckland: ["NZ"], mumbai: ["IN"], "new delhi": ["IN"], delhi: ["IN"], hyderabad: ["IN"],
  pune: ["IN"], chennai: ["IN"], "mexico city": ["MX"], bogota: ["CO"], "bogotá": ["CO"], santiago: ["CL"], lima: ["PE"],
  "buenos aires": ["AR"], montevideo: ["UY"], "san diego": ["US"], "salt lake city": ["US"], ottawa: ["CA"],
  tarragona: ["ES"], seville: ["ES"], malaga: ["ES"], bilbao: ["ES"], valletta: ["MT"], dakar: ["SN"], algiers: ["DZ"], alger: ["DZ"],
  luxembourg: ["LU"], monaco: ["MC"], antwerp: ["BE"], gand: ["BE"], ghent: ["BE"], liege: ["BE"], "liège": ["BE"], basel: ["CH"], bern: ["CH"],
};

export const REGION_LABELS: Record<string, string> = {
  IDF: "Île-de-France", ARA: "Auvergne-Rhône-Alpes", PAC: "Provence-Alpes-Côte d'Azur", OCC: "Occitanie",
  NAQ: "Nouvelle-Aquitaine", HDF: "Hauts-de-France", PDL: "Pays de la Loire", BRE: "Bretagne", GES: "Grand Est",
  NOR: "Normandie", CVL: "Centre-Val de Loire", BFC: "Bourgogne-Franche-Comté", COR: "Corse",
};

// Region names as sources write them, French and English, matched hyphen-insensitively.
const REGION_ALIASES: [RegExp, string][] = [
  [/\b(ile de france|idf|region parisienne)\b/, "IDF"],
  [/\bauvergne( rhone alpes)?\b|\brhone alpes\b/, "ARA"],
  [/\bprovence( alpes cote d ?azur)?\b|\bpaca\b|\bcote d ?azur\b/, "PAC"],
  [/\boccitanie\b|\boccitania\b/, "OCC"],
  [/\bnouvelle aquitaine\b|\baquitaine\b/, "NAQ"],
  [/\bhauts de france\b|\bnord pas de calais\b/, "HDF"],
  [/\bpays de (la )?loire\b/, "PDL"],
  [/\bbretagne\b|\bbrittany\b/, "BRE"],
  [/\bgrand est\b|\balsace\b|\blorraine\b/, "GES"],
  [/\bnormandie\b|\bnormandy\b/, "NOR"],
  // "Centre" alone as a field, never "centre-ville" or "Paris Centre".
  [/\bcentre val de loire\b|(^|, ?)centre(,|$)/, "CVL"],
  [/\bbourgogne( franche comte)?\b|\bburgundy\b|\bfranche comte\b/, "BFC"],
  [/\bcorse\b|\bcorsica\b/, "COR"],
];
// French départements (first two digits of a postcode) by region.
const DEPARTMENTS: Record<string, string> = Object.fromEntries(
  Object.entries({
    IDF: "75 77 78 91 92 93 94 95", ARA: "01 03 07 15 26 38 42 43 63 69 73 74", PAC: "04 05 06 13 83 84", OCC: "09 11 12 30 31 32 34 46 48 65 66 81 82",
    NAQ: "16 17 19 23 24 33 40 47 64 79 86 87", HDF: "02 59 60 62 80", PDL: "44 49 53 72 85", BRE: "22 29 35 56", GES: "08 10 51 52 54 55 57 67 68 88",
    NOR: "14 27 50 61 76", CVL: "18 28 36 37 41 45", BFC: "21 25 39 58 70 71 89 90", COR: "20",
  }).flatMap(([region, codes]) => codes.split(" ").map((d) => [d, region])),
);

const EU = new Set(["FR", "DE", "ES", "PT", "NL", "BE", "IT", "IE", "LU", "PL", "SE", "DK", "AT", "CZ", "RO", "GR", "FI"]);
const US_STATES = /\b(NY|MA|CA|WA|TX|IL|CO|GA|FL|DC|NJ|PA|OR|VA|NC|MN|AZ|UT)\b/;

function norm(s: string) {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();
}

// Hyphens and spaces alike: "Aix en Provence" is "aix-en-provence".
const flat = (s: string) => norm(s).replace(/[-'’]/g, " ").replace(/\s+/g, " ");
const CITY_INDEX = new Map(Object.entries(CITIES).map(([k, v]) => [flat(k), v] as const));
const COUNTRY_INDEX = new Map(Object.entries(COUNTRY_ALIASES).map(([k, v]) => [norm(k), v] as const));

function findCountry(text: string): string | undefined {
  const n = norm(text);
  for (const [alias, code] of COUNTRY_INDEX) {
    if (alias.length <= 3) {
      if (new RegExp(`(^|[^a-z.])${alias.replace(/\./g, "\\.")}($|[^a-z])`).test(n)) return code;
    } else if (n.includes(alias)) return code;
  }
  if (US_STATES.test(text)) return "US";
  return undefined;
}

// Many cities share a name ("Paris, TX", "London, ON"): a state, province or country written after
// the city wins over the best-known city of that name.
const STATE_CODES = "AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC";
const US_STATE_NAMES = "alabama|alaska|arizona|arkansas|california|colorado|connecticut|delaware|florida|georgia|hawaii|idaho|illinois|indiana|iowa|kansas|kentucky|louisiana|maine|maryland|massachusetts|michigan|minnesota|mississippi|missouri|montana|nebraska|nevada|new hampshire|new jersey|new mexico|new york state|north carolina|north dakota|ohio|oklahoma|oregon|pennsylvania|rhode island|south carolina|south dakota|tennessee|texas|utah|vermont|virginia|washington state|west virginia|wisconsin|wyoming";
const CA_PROVINCES = "ON|QC|BC|AB|MB|SK|NS|NB|NL|PE";

function qualifiedCountry(segment: string, n: string): string | undefined {
  if (new RegExp(`,\\s*(${STATE_CODES})\\b`).test(segment) || new RegExp(`(^|[^a-z])(${US_STATE_NAMES})($|[^a-z])`).test(n)) return "US";
  if (new RegExp(`,\\s*(${CA_PROVINCES})\\b`).test(segment)) return "CA";
  return findCountry(segment) ?? undefined;
}

// Overseas France is not mainland France: an offer in La Réunion is not one in Paris ("Saint-Denis,
// Reunion" is not Saint-Denis 93). Each territory is its own place, by name or postcode (971 to 976).
const OVERSEAS: [RegExp, string][] = [
  // Towns named only there (never "Saint-Paul" or "Saint-Pierre", shared with the mainland).
  [/\b(la )?reunion\b|\b974\d\d\b|\b(sainte clotilde|le tampon|saint andre de la reunion|saint benoit de la reunion|la possession|sainte suzanne de la reunion|le port de la reunion)\b/, "RE"],
  [/\bmartinique\b|\b972\d\d\b|\b(fort de france|schoelcher|le lamentin)\b/, "MQ"],
  [/\bguadeloupe\b|\b971\d\d\b|\b(pointe a pitre|les abymes|baie mahault|le gosier)\b/, "GP"],
  [/\bguyane( francaise)?\b|\bfrench guiana\b|\b973\d\d\b|\b(cayenne|kourou|matoury|saint laurent du maroni)\b/, "GF"],
  [/\bmayotte\b|\b976\d\d\b|\b(mamoudzou|dzaoudzi)\b/, "YT"],
  [/\bnouvelle caledonie\b|\bnew caledonia\b|\bnoumea\b/, "NC"],
  [/\bpolynesie( francaise)?\b|\bfrench polynesia\b|\btahiti\b|\bpapeete\b/, "PF"],
];

function parseSegment(segment: string): Place | null {
  const n = flat(segment);
  if (!n) return null;
  // "Union européenne" is not La Réunion.
  for (const [re, code] of OVERSEAS) if (re.test(n) && !/\bunion europeenne\b/.test(n)) return { country: code };
  for (const [city, [country, region]] of CITY_INDEX) {
    if (new RegExp(`(^|[^a-z])${city}($|[^a-z])`).test(n)) {
      const name = city.replace(/(^|[\s-])\S/g, (m) => m.toUpperCase());
      const stated = qualifiedCountry(segment, n);
      if (stated && stated !== country) return { city: name, country: stated };
      return { city: name, country, region };
    }
  }
  // A US state after the town ("York, SC 29745"): its ZIP code is not a French postcode.
  const country = qualifiedCountry(segment, n);
  if (!country || country === "FR") {
    // A French postcode names its département, hence its region ("92130 Issy", "59000 Lille").
    const postcode = /\b(\d{5})\b/.exec(segment)?.[1];
    const department = postcode ? DEPARTMENTS[postcode.startsWith("20") ? "20" : postcode.slice(0, 2)] : undefined;
    if (department) return { region: department, country: "FR" };
    for (const [re, region] of REGION_ALIASES) if (re.test(n)) return { region, country: "FR" };
  }
  return country ? { country } : null;
}

const REMOTE_RE = /\b(full[- ]?remote|fully remote|remote|teletravail (complet|total|integral|100 ?%)|100 ?% (teletravail|remote)|anywhere)\b/;
const HYBRID_RE = /\b(hybrid|hybride|teletravail|home office|jours? (de|en) remote)\b/;

export type ParsedLocation = { places: Place[]; remote: Remote; remoteScope: string[] };

// `raw` is the source's location field; `context` (title, workplace type, description start)
// only helps detect remote/hybrid, never the city.
export function parseLocation(raw: string | null | undefined, context = ""): ParsedLocation {
  const text = raw ?? "";
  const segments = text.split(/[;|/]| - | · |\n/).map((s) => s.trim()).filter(Boolean);
  const places: Place[] = [];
  for (const seg of segments.length ? segments : [text]) {
    const p = parseSegment(seg);
    if (p && !places.some((q) => q.city === p.city && q.country === p.country && q.region === p.region)) places.push(p);
  }

  const nLoc = norm(text);
  const nCtx = norm(context);
  let remote: Remote = "unknown";
  if (REMOTE_RE.test(nLoc)) remote = "remote";
  else if (HYBRID_RE.test(nLoc) || HYBRID_RE.test(nCtx)) remote = "hybrid";
  else if (REMOTE_RE.test(nCtx)) remote = "remote";

  const remoteScope: string[] = [];
  if (remote === "remote") {
    if (/\b(emea|europe|eu)\b/.test(nLoc)) remoteScope.push("EU");
    else if (/\b(worldwide|anywhere|global)\b/.test(nLoc)) remoteScope.push("WORLD");
    else for (const p of places) if (p.country && !remoteScope.includes(p.country)) remoteScope.push(p.country);
  }
  return { places, remote, remoteScope };
}

export type ZoneVerdict = "in" | "out" | "unknown";

function placeMatches(offerPlace: Place, zonePlace: ZonePlace) {
  if (!offerPlace.country || offerPlace.country !== zonePlace.country) return false;
  if (zonePlace.kind === "country") return true;
  if (zonePlace.kind === "region") return offerPlace.region === regionCode(zonePlace.label) || norm(offerPlace.region ?? "") === norm(zonePlace.label);
  return Boolean(offerPlace.city) && flat(offerPlace.city!) === flat(zonePlace.label);
}

function regionCode(label: string) {
  const n = norm(label);
  return Object.entries(REGION_LABELS).find(([code, name]) => norm(name) === n || norm(code) === n)?.[0];
}

export function zoneVerdict(
  offer: { places: Place[]; remote: Remote; remote_scope: string[] },
  zone: { places: ZonePlace[]; remoteOk: boolean },
): ZoneVerdict {
  if (zone.places.length === 0) return "in";
  const zoneCountries = new Set(zone.places.map((p) => p.country));

  if (offer.places.some((p) => zone.places.some((z) => placeMatches(p, z)))) return "in";

  if (offer.remote === "remote" && zone.remoteOk) {
    const scope = offer.remote_scope;
    if (scope.includes("WORLD")) return "in";
    if (scope.includes("EU") && [...zoneCountries].some((c) => EU.has(c))) return "in";
    if (scope.some((c) => zoneCountries.has(c))) return "in";
    if (scope.length === 0) return "unknown";
    return "out";
  }

  const known = offer.places.filter((p) => p.country);
  if (known.length === 0) return "unknown";
  // "France" alone (search engines often say no more): maybe in the zone, the posting will tell.
  if (known.every((p) => !p.city && !p.region) && known.some((p) => zoneCountries.has(p.country!))) return "unknown";
  return "out";
}
