import { parseLocation } from "@/lib/domain/geo";
import { detectContract, detectExperienceYears } from "@/lib/domain/signals";
import type { NormalizedOffer, Place } from "@/lib/domain/offer";
import { htmlToText } from "../normalize";

// Public career-page APIs beyond Greenhouse, Lever and Ashby: the endpoints each company's own
// jobs page calls. One request per board, except SmartRecruiters whose list has no description.

export type BoardRef = { name: string; domain: string | null; token: string };
// Lets a connector skip detail requests for offers that would be dropped anyway (outside every zone).
// `title`: a V.I.E. is kept whatever its country when someone looks for one.
export type Keep = (places: Place[], remote: NormalizedOffer["remote"], title?: string) => boolean;
// Whether someone's search could use this title: big boards fetch details only for those.
export type Wanted = (title: string) => boolean;

const TIMEOUT_MS = 30_000;
const HEADERS = { "User-Agent": "Scout job aggregator", Accept: "application/json" };

async function get(url: string): Promise<Response> {
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: HEADERS });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res;
}

function base(ats: string, board: BoardRef, name = board.name) {
  return { sourceKey: `${ats}:${board.token}`, company: { name, domain: board.domain ?? undefined, ats, atsToken: board.token } };
}

function remoteFrom(remote: boolean | undefined, hybrid: boolean | undefined, fallback: NormalizedOffer["remote"]): NormalizedOffer["remote"] {
  if (remote) return "remote";
  if (hybrid) return "hybrid";
  return fallback;
}

// SmartRecruiters ---------------------------------------------------------------------------

type SrPosting = {
  id: string;
  name: string;
  releasedDate?: string;
  company?: { name?: string };
  location?: { city?: string; region?: string; country?: string; remote?: boolean; hybrid?: boolean; fullLocation?: string };
  typeOfEmployment?: { id?: string };
};
const SR_EMPLOYMENT: Record<string, string> = { permanent: "permanent", "full-time": "permanent", intern: "internship", contract: "contractor", temporary: "fixed-term" };
const SR_DETAILS_PER_BOARD = 80;

export async function smartrecruiters(board: BoardRef, keep?: Keep): Promise<NormalizedOffer[]> {
  const postings: SrPosting[] = [];
  for (let offset = 0; offset < 1000; offset += 100) {
    const data = (await (await get(`https://api.smartrecruiters.com/v1/companies/${board.token}/postings?limit=100&offset=${offset}`)).json()) as { content?: SrPosting[]; totalFound?: number };
    postings.push(...(data.content ?? []));
    if (!data.content || data.content.length < 100) break;
  }
  const out: NormalizedOffer[] = [];
  for (const p of postings) {
    const raw = p.location?.fullLocation ?? [p.location?.city, p.location?.country?.toUpperCase()].filter(Boolean).join(", ");
    const loc = parseLocation(raw, p.name);
    loc.remote = remoteFrom(p.location?.remote, p.location?.hybrid, loc.remote);
    if (keep && !keep(loc.places, loc.remote, p.name)) continue;
    if (out.length >= SR_DETAILS_PER_BOARD) break;
    const detail = (await (await get(`https://api.smartrecruiters.com/v1/companies/${board.token}/postings/${p.id}`)).json()) as {
      postingUrl?: string;
      jobAd?: { sections?: Record<string, { title?: string; text?: string }> };
    };
    const sections = detail.jobAd?.sections ?? {};
    const description = ["jobDescription", "qualifications", "additionalInformation", "companyDescription"]
      .map((k) => (sections[k]?.text ? `${sections[k]?.title ?? ""}\n${htmlToText(sections[k]!.text!)}` : ""))
      .filter(Boolean)
      .join("\n\n");
    const url = detail.postingUrl ?? `https://jobs.smartrecruiters.com/${board.token}/${p.id}`;
    out.push({
      ...base("smartrecruiters", board, p.company?.name || board.name),
      sourceUrl: url,
      title: p.name.trim(),
      locationRaw: raw || null,
      ...loc,
      contract: detectContract(p.name, SR_EMPLOYMENT[p.typeOfEmployment?.id ?? ""] ?? null, description),
      experienceMinYears: detectExperienceYears(description),
      description,
      applyUrl: url,
      publishedAt: p.releasedDate ?? null,
    });
  }
  return out;
}

// Discovery only needs to know whether a board lists an offer in scope: the list is enough.
export async function smartrecruitersHasOffer(token: string, keep: Keep): Promise<{ name: string } | null> {
  const data = (await (await get(`https://api.smartrecruiters.com/v1/companies/${token}/postings?limit=100`)).json()) as { content?: SrPosting[] };
  for (const p of data.content ?? []) {
    const raw = p.location?.fullLocation ?? [p.location?.city, p.location?.country?.toUpperCase()].filter(Boolean).join(", ");
    const loc = parseLocation(raw, p.name);
    if (keep(loc.places, remoteFrom(p.location?.remote, p.location?.hybrid, loc.remote))) return { name: p.company?.name || token };
  }
  return null;
}

// Workable --------------------------------------------------------------------------------------

type WorkableJob = {
  title: string;
  shortcode: string;
  employment_type?: string;
  telecommuting?: boolean;
  url?: string;
  application_url?: string;
  published_on?: string;
  created_at?: string;
  city?: string;
  country?: string;
  locations?: { country?: string; city?: string; region?: string }[];
  description?: string;
};
const WORKABLE_EMPLOYMENT: Record<string, string> = { "Full-time": "permanent", Contract: "contractor", Internship: "internship", Temporary: "fixed-term" };

export async function workable(board: BoardRef): Promise<NormalizedOffer[]> {
  const data = (await (await get(`https://apply.workable.com/api/v1/widget/accounts/${board.token}?details=true`)).json()) as { name?: string; jobs?: WorkableJob[] };
  return (data.jobs ?? []).map((j) => {
    const raw = (j.locations?.length ? j.locations : [{ city: j.city, country: j.country }]).map((l) => [l.city, l.region, l.country].filter(Boolean).join(", ")).join("; ");
    const loc = parseLocation(raw, j.title);
    if (j.telecommuting) loc.remote = "remote";
    const description = htmlToText(j.description ?? "");
    const url = j.url ?? j.application_url ?? `https://apply.workable.com/${board.token}/j/${j.shortcode}`;
    return {
      ...base("workable", board, data.name || board.name),
      sourceUrl: url,
      title: j.title.trim(),
      locationRaw: raw || null,
      ...loc,
      contract: detectContract(j.title, WORKABLE_EMPLOYMENT[j.employment_type ?? ""] ?? null, description),
      experienceMinYears: detectExperienceYears(description),
      description,
      applyUrl: url,
      publishedAt: j.published_on ?? j.created_at ?? null,
    };
  });
}

// Recruitee -------------------------------------------------------------------------------------

type RecruiteeOffer = {
  title: string;
  description?: string;
  requirements?: string;
  city?: string;
  country?: string;
  location?: string;
  remote?: boolean;
  hybrid?: boolean;
  employment_type_code?: string;
  careers_url?: string;
  published_at?: string;
  company_name?: string;
};
function recruiteeEmployment(code = ""): string | null {
  if (code.includes("permanent")) return "permanent";
  if (code.includes("fixed_term")) return "fixed-term";
  if (/intern|trainee/.test(code)) return "internship";
  if (code.includes("apprentice")) return "alternance";
  if (code.includes("freelance")) return "contractor";
  return null;
}

export async function recruitee(board: BoardRef): Promise<NormalizedOffer[]> {
  const data = (await (await get(`https://${board.token}.recruitee.com/api/offers/`)).json()) as { offers?: RecruiteeOffer[] };
  return (data.offers ?? []).map((o) => {
    const raw = o.location || [o.city, o.country].filter(Boolean).join(", ");
    const loc = parseLocation(raw, o.title);
    loc.remote = remoteFrom(o.remote, o.hybrid, loc.remote);
    const description = [htmlToText(o.description ?? ""), htmlToText(o.requirements ?? "")].filter(Boolean).join("\n\n");
    const url = o.careers_url ?? `https://${board.token}.recruitee.com/`;
    return {
      ...base("recruitee", board, o.company_name || board.name),
      sourceUrl: url,
      title: o.title.trim(),
      locationRaw: raw || null,
      ...loc,
      contract: detectContract(o.title, recruiteeEmployment(o.employment_type_code), description),
      experienceMinYears: detectExperienceYears(description),
      description,
      applyUrl: url,
      publishedAt: o.published_at ?? null,
    };
  });
}

// Teamtailor and Personio publish feeds, not JSON ---------------------------------------------

const decode = (s: string) =>
  s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
const tag = (xml: string, name: string) => decode(xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`))?.[1] ?? "").trim();
const tags = (xml: string, name: string) => [...xml.matchAll(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "g"))].map((m) => m[1]);

export async function teamtailor(board: BoardRef): Promise<NormalizedOffer[]> {
  // A token with a dot is a career site on the company's own domain (career.spendesk.com).
  const host = board.token.includes(".") ? board.token : `${board.token}.teamtailor.com`;
  const xml = await (await get(`https://${host}/jobs.rss`)).text();
  const company = tag(xml.split("<item>")[0], "title").replace(/\s*[-–|].*$/, "") || board.name;
  return tags(xml, "item").map((item) => {
    const title = tag(item, "title");
    const raw = tags(item, "tt:location").map((l) => [tag(l, "tt:city"), tag(l, "tt:country")].filter(Boolean).join(", ")).join("; ");
    const loc = parseLocation(raw, title);
    const status = tag(item, "remoteStatus");
    if (status === "fully") loc.remote = "remote";
    else if (status === "hybrid") loc.remote = "hybrid";
    const description = htmlToText(tag(item, "description"));
    const url = tag(item, "link");
    const date = tag(item, "pubDate");
    return {
      ...base("teamtailor", board, company),
      sourceUrl: url,
      title,
      locationRaw: raw || null,
      ...loc,
      contract: detectContract(title, null, description),
      experienceMinYears: detectExperienceYears(description),
      description,
      applyUrl: url,
      publishedAt: date ? new Date(date).toISOString() : null,
    };
  });
}

const PERSONIO_EMPLOYMENT: Record<string, string> = { permanent: "permanent", temporary: "fixed-term", intern: "internship", trainee: "alternance", freelance: "contractor" };

export async function personio(board: BoardRef): Promise<NormalizedOffer[]> {
  const xml = await (await get(`https://${board.token}.jobs.personio.de/xml?language=fr`)).text();
  return tags(xml, "position").map((p) => {
    const id = tag(p, "id");
    const title = tag(p, "name");
    const raw = [tag(p, "office"), ...tags(p, "additionalOffice")].filter(Boolean).join("; ");
    const loc = parseLocation(raw, title);
    const description = tags(p, "jobDescription")
      .map((d) => `${tag(d, "name")}\n${htmlToText(tag(d, "value"))}`)
      .join("\n\n");
    const url = `https://${board.token}.jobs.personio.de/job/${id}`;
    return {
      ...base("personio", board, tag(p, "subcompany") || board.name),
      sourceUrl: url,
      title,
      locationRaw: raw || null,
      ...loc,
      contract: detectContract(title, PERSONIO_EMPLOYMENT[tag(p, "employmentType")] ?? null, description),
      experienceMinYears: detectExperienceYears(description),
      description,
      applyUrl: url,
      publishedAt: tag(p, "createdAt") || null,
    };
  });
}

// DigitalRecruiters ---------------------------------------------------------------------------
// The API the company's own careers site calls; the board is identified by the site's domain.

type DrListItem = { job_ad_id: number; title: string; contract?: string; location?: string; url: string; image_wide?: { src?: string } };
type DrDetail = {
  title?: string;
  contract?: string;
  working_time?: string;
  job_experience?: string;
  location?: string;
  formatted_address?: string;
  brand_name?: string;
  description?: string;
  profile?: string;
  catch_phrase?: string;
  republished_at?: string;
};
const DR_API = "https://api.digitalrecruiters.com/public/v1/careers-site/job-ads";
const DR_DETAILS_PER_BOARD = 150;

export async function digitalrecruiters(board: BoardRef, keep?: Keep, wanted?: Wanted): Promise<NormalizedOffer[]> {
  const items: DrListItem[] = [];
  for (let page = 1; page <= 30; page++) {
    const res = await fetch(`${DR_API}?domainName=${board.token}&limit=100&page=${page}&locale=fr_FR`, {
      method: "POST",
      headers: { ...HEADERS, "Content-Type": "application/json" },
      body: "{}",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { count?: number; items?: DrListItem[] };
    items.push(...(data.items ?? []));
    if (!data.items || data.items.length < 100) break;
  }
  const out: NormalizedOffer[] = [];
  let details = 0;
  for (const item of items) {
    const loc = parseLocation(item.location ?? "", item.title);
    if (!loc.places.length) loc.places = [{ country: "FR" }];
    if (keep && !keep(loc.places, loc.remote, item.title)) continue;
    const url = `https://${board.token}/fr/annonce/${item.url}`;
    const image = item.image_wide?.src ? `https://${board.token}${item.image_wide.src}` : undefined;
    // Details (description, experience) only where a search could use them, within a cap.
    let detail: DrDetail | null = null;
    if ((!wanted || wanted(item.title)) && details < DR_DETAILS_PER_BOARD) {
      details++;
      detail = (await (await get(`${DR_API}/${item.job_ad_id}?domainName=${board.token}&locale=fr_FR`)).json().catch(() => null)) as DrDetail | null;
    }
    const description = detail ? [htmlToText(detail.catch_phrase ?? ""), htmlToText(detail.description ?? ""), htmlToText(detail.profile ?? "")].filter(Boolean).join("\n\n") : "";
    const experience = detail?.job_experience && !/pas de pr[ée]f[ée]rence/i.test(detail.job_experience) ? `${detail.job_experience}\n` : "";
    out.push({
      ...base("digitalrecruiters", board, detail?.brand_name || board.name),
      sourceUrl: url,
      title: item.title.trim(),
      locationRaw: detail?.formatted_address ?? item.location ?? null,
      ...loc,
      contract: detectContract(item.title, item.contract ?? detail?.contract ?? null, description),
      experienceMinYears: detectExperienceYears(experience + description),
      description: experience + description,
      applyUrl: url,
      publishedAt: detail?.republished_at ? new Date(detail.republished_at.replace(" ", "T") + "Z").toISOString() : null,
      imageUrl: image,
    });
  }
  return out;
}

// Welcome Kit (the Welcome to the Jungle ATS) -------------------------------------------------
// The public endpoint behind the jobs widget companies embed on their own career page. The board
// token is the company's organisation reference (case-sensitive), read from one of its job pages.

type WkJob = {
  reference: string;
  name: string;
  description?: string;
  profile?: string;
  published_at?: string;
  office?: { city?: string; district?: string; zip_code?: string; country?: { fr?: string; en?: string } } | null;
  contract_type?: { fr?: string; en?: string } | null;
  websites_urls?: { website_reference: string; url: string }[];
};

export async function welcomekit(board: BoardRef, keep?: Keep): Promise<NormalizedOffer[]> {
  const data = (await (await get(`https://www.welcomekit.co/api/v1/embed?organization_reference=${encodeURIComponent(board.token)}`)).json()) as { name?: string; jobs?: WkJob[] };
  const out: NormalizedOffer[] = [];
  for (const job of data.jobs ?? []) {
    if (/candidature[s]? spontan/i.test(job.name)) continue;
    const raw = [job.office?.city, job.office?.country?.en].filter(Boolean).join(", ");
    const loc = parseLocation(raw, job.name);
    if (keep && !keep(loc.places, loc.remote, job.name)) continue;
    const description = [htmlToText(job.description ?? ""), htmlToText(job.profile ?? "")].filter(Boolean).join("\n\n");
    // The company's own career site first, the Welcome to the Jungle page otherwise.
    const urls = job.websites_urls ?? [];
    const url = (urls.find((u) => !u.website_reference.startsWith("wttj") && !u.url.includes("/companies/")) ?? urls.find((u) => u.website_reference.startsWith("wttj")) ?? urls[0])?.url;
    if (!url) continue;
    out.push({
      ...base("welcomekit", board, data.name?.trim() || board.name),
      sourceUrl: url,
      title: job.name.trim(),
      locationRaw: raw || null,
      ...loc,
      contract: detectContract(job.name, job.contract_type?.fr ?? null, description),
      experienceMinYears: detectExperienceYears(description),
      description,
      applyUrl: url,
      publishedAt: job.published_at ?? null,
    });
  }
  return out;
}

// Workday ---------------------------------------------------------------------------------------
// The public endpoint behind a company's Workday career site. The board token is "host/site"
// (e.g. "acme.wd3.myworkdayjobs.com/AcmeCareers"). The list gives titles and cities; details are read
// only for titles a search could use and places someone looks at.

type WdItem = { title: string; externalPath: string; locationsText?: string; startDate?: string };
type WdDetail = {
  jobPostingInfo?: {
    title: string;
    jobDescription?: string;
    location?: string;
    additionalLocations?: string[];
    country?: { descriptor?: string };
    timeType?: string;
    startDate?: string;
    externalUrl?: string;
  };
};
const WD_PAGES = 60;
const WD_DETAILS = 80;

export async function workday(board: BoardRef, keep?: Keep, wanted?: Wanted): Promise<NormalizedOffer[]> {
  const [host, site] = board.token.split("/");
  const tenant = host.split(".")[0];
  const api = `https://${host}/wday/cxs/${tenant}/${site}`;
  const items: WdItem[] = [];
  // The total comes with the first page only.
  let total = Infinity;
  for (let page = 0; page < WD_PAGES; page++) {
    const res = await fetch(`${api}/jobs`, {
      method: "POST",
      headers: { ...HEADERS, "Content-Type": "application/json" },
      body: JSON.stringify({ appliedFacets: {}, limit: 20, offset: page * 20, searchText: "" }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { total?: number; jobPostings?: WdItem[] };
    if (page === 0 && data.total) total = data.total;
    // Workday sometimes lists a posting without its title or link: there is nothing to read in it.
    items.push(...(data.jobPostings ?? []).filter((j) => j?.title && j.externalPath));
    if (!data.jobPostings || data.jobPostings.length < 20 || items.length >= total) break;
  }
  const out: NormalizedOffer[] = [];
  for (const item of items) {
    if (out.length >= WD_DETAILS) break;
    if (wanted && !wanted(item.title)) continue;
    const listed = parseLocation(item.locationsText ?? "", item.title);
    // "2 Locations" says nothing yet: the detail decides.
    if (keep && listed.places.length > 0 && !keep(listed.places, listed.remote, item.title)) continue;
    const detail = (await (await get(`${api}${item.externalPath}`)).json().catch(() => null)) as WdDetail | null;
    const info = detail?.jobPostingInfo;
    if (!info?.title) continue;
    const country = info.country?.descriptor ?? "";
    const raw = [info.location, ...(info.additionalLocations ?? [])].filter(Boolean).map((l) => (country ? `${l}, ${country}` : l)).join("; ");
    const loc = parseLocation(raw, info.title);
    if (keep && !keep(loc.places, loc.remote, item.title)) continue;
    const description = htmlToText(info.jobDescription ?? "");
    const url = info.externalUrl ?? `https://${host}/${site}${item.externalPath}`;
    out.push({
      ...base("workday", board),
      sourceUrl: url,
      title: info.title.trim(),
      locationRaw: raw || null,
      ...loc,
      contract: detectContract(info.title, info.timeType ?? null, description),
      experienceMinYears: detectExperienceYears(description),
      description,
      applyUrl: url,
      publishedAt: info.startDate ? new Date(info.startDate).toISOString() : null,
    });
  }
  return out;
}

// Polymer (jobs.polymer.co, used by Getaround): a public JSON API, the list then each posting's text.
type PolymerItem = { id: number; title: string; city: string | null; country: string | null; kind_pretty?: string | null; remoteness_pretty?: string | null; published_at?: string | null; job_post_url: string };

export async function polymer(board: BoardRef, keep?: Keep, wanted?: Wanted): Promise<NormalizedOffer[]> {
  const api = `https://api.polymer.co/v1/hire/organizations/${board.token}/jobs`;
  const items: PolymerItem[] = [];
  for (let page = 1; page <= 10; page++) {
    const data = (await (await get(`${api}?page=${page}`)).json()) as { items?: PolymerItem[]; meta?: { next_page?: number | null } };
    items.push(...(data.items ?? []));
    if (!data.meta?.next_page) break;
  }
  const out: NormalizedOffer[] = [];
  for (const item of items) {
    const raw = [item.city, item.country].filter(Boolean).join(", ");
    const loc = parseLocation(raw, item.title);
    const remoteness = (item.remoteness_pretty ?? "").toLowerCase();
    if (/no remote/.test(remoteness)) loc.remote = "onsite";
    else if (/hybrid/.test(remoteness)) loc.remote = "hybrid";
    else if (/remote/.test(remoteness)) loc.remote = "remote";
    // Spontaneous applications are not offers.
    if (/open application|candidature[s]? spontan/i.test(item.title)) continue;
    if ((keep && !keep(loc.places, loc.remote, item.title)) || (wanted && !wanted(item.title))) continue;
    const detail = (await (await get(`${api}/${item.id}`)).json()) as { description?: string | null; data?: { description?: string | null } };
    const description = htmlToText(detail.description ?? detail.data?.description ?? "");
    out.push({
      ...base("polymer", board),
      sourceUrl: item.job_post_url,
      title: item.title.trim(),
      locationRaw: raw || null,
      ...loc,
      contract: detectContract(item.title, /intern/i.test(item.kind_pretty ?? "") ? "internship" : null, description),
      experienceMinYears: detectExperienceYears(description),
      description,
      applyUrl: item.job_post_url,
      publishedAt: item.published_at ?? null,
    });
  }
  return out;
}
