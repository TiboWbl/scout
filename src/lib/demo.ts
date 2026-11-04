import type { SupabaseClient } from "@supabase/supabase-js";
import { Criteria, CvSummary } from "@/lib/domain/criteria";

// Public demo: Camille, a fictional junior PM in Paris. Her profile is scored by the scheduled job on
// the real offers, like anyone's; visitors only read. Nothing here is about a real person.

const DEMO_EMAIL = "camille.demo@scout.invalid";

export const DEMO_CRITERIA = Criteria.parse({
  targetRoles: ["Product Manager", "Product Owner"],
  titleVariants: ["Junior Product Manager", "Associate Product Manager", "Chef de produit digital", "PO"],
  bridgeRoles: ["Product Analyst", "UX Researcher"],
  sectorsPriority: ["Santé", "Mobilité", "Éducation"],
  sectorsAvoid: ["Jeux d'argent"],
  otherSectors: { open: true, condition: "une équipe produit structurée" },
  zone: { places: [{ label: "Paris", kind: "city", country: "FR" }, { label: "Île-de-France", kind: "region", country: "FR" }], remoteOk: true },
  outOfZone: "never",
  contracts: ["cdi"],
  experienceYears: 1,
  languages: ["Français", "Anglais courant"],
  availability: "immédiate",
  openness: 60,
});

const DEMO_CAREER_TEXT = "J'aime parler aux utilisateurs, comprendre ce qui les bloque et trouver avec l'équipe la solution la plus simple. Les chiffres m'aident à décider. Je veux devenir Product Manager dans la santé ou l'éducation.";
const DEMO_SEARCH = "Je cherche un premier CDI de Product Manager à Paris, idéalement dans la santé, la mobilité ou l'éducation. J'ai un an d'expérience en stage de Product Owner.";
const DEMO_CV = {
  experienceYears: 1,
  roles: ["Product Owner, stage de 6 mois en scale-up", "Analyste produit, stage de 6 mois"],
  skills: ["Discovery", "Priorisation", "User stories", "SQL", "Figma", "Interviews utilisateurs"],
  languages: ["Français", "Anglais C1"],
  education: ["Master en management de l'innovation"],
  highlights: ["Refonte d'un parcours d'inscription (+12 % de conversion)"],
};

export async function getDemoUserId(db: SupabaseClient): Promise<string | null> {
  const { data } = await db.from("profiles").select("id").eq("is_demo", true).maybeSingle();
  return data?.id ?? null;
}

// Creates Camille if needed (no password, an address nobody can receive: she can never sign in).
export async function ensureDemoProfile(db: SupabaseClient): Promise<string> {
  const existing = await getDemoUserId(db);
  if (existing) {
    // Camille's search follows the code: a new version is sorted again by the next pass.
    const { data: p } = await db.from("profiles").select("criteria, criteria_version").eq("id", existing).single();
    if (JSON.stringify(p?.criteria) !== JSON.stringify(DEMO_CRITERIA)) await db.from("profiles").update({ criteria: DEMO_CRITERIA, criteria_version: (p?.criteria_version ?? 0) + 1 }).eq("id", existing);
    return existing;
  }
  const { data, error } = await db.auth.admin.createUser({ email: DEMO_EMAIL, email_confirm: true, user_metadata: { given_name: "Camille" } });
  if (error) throw error;
  const id = data.user!.id;
  await db
    .from("profiles")
    .update({ is_demo: true, display_name: "Camille", criteria: DEMO_CRITERIA, criteria_version: 1, search_text: DEMO_SEARCH, cv_summary: DEMO_CV, cv_filename: "cv-camille.pdf", cv_updated_at: new Date().toISOString(), onboarded_at: new Date().toISOString() })
    .eq("id", id);
  return id;
}

const DAY = 86_400_000;
const NOTES = [
  "Échange très agréable avec l'équipe produit.",
  "Candidature envoyée avec une lettre courte.",
  "Prévoir un cas pratique sur la priorisation.",
  "Offre repérée par Scout, à préparer ce week-end.",
  "Réponse négative, retour constructif sur l'expérience.",
];

// Rebuilt every day on offers still open, with dates relative to today, so the demo always looks alive.
export async function seedDemoApplications(db: SupabaseClient, userId: string) {
  const { data: scores } = await db
    .from("offer_scores")
    .select("level, offer:offers(id, title, apply_url, archived_at, company:companies(name))")
    .eq("user_id", userId)
    .neq("level", "ecartee")
    .limit(60);
  type Row = { offer: { id: string; title: string; apply_url: string; archived_at: string | null; company: { name: string } | null } | null };
  const offers = ((scores ?? []) as unknown as Row[]).map((r) => r.offer).filter((o): o is NonNullable<Row["offer"]> => Boolean(o && !o.archived_at));
  await db.from("applications").delete().eq("user_id", userId);
  const now = Date.now();
  const plan = [
    { stage: "entretien", applied: 12, interview: 3, followed: null },
    { stage: "postule", applied: 9, interview: null, followed: null },
    { stage: "postule", applied: 2, interview: null, followed: null },
    { stage: "a_postuler", applied: null, interview: null, followed: null },
    { stage: "refuse", applied: 20, interview: null, followed: 12 },
  ] as const;
  // Spread over the list, never the same offer twice.
  const picks = [...new Set(plan.map((_, i) => Math.min(i * 3, offers.length - 1)))].map((i) => offers[i]).filter(Boolean);
  const rows = plan.slice(0, picks.length).map((p, i) => {
    const o = picks[i];
    return {
      user_id: userId,
      offer_id: o.id,
      title: o.title,
      company: o.company?.name ?? "",
      url: o.apply_url,
      stage: p.stage,
      applied_at: p.applied === null ? null : new Date(now - p.applied * DAY).toISOString(),
      interview_at: p.interview === null ? null : new Date(new Date(now + p.interview * DAY).setHours(14, 30, 0, 0)).toISOString(),
      followed_up_at: p.followed === null ? null : new Date(now - p.followed * DAY).toISOString(),
      notes: NOTES[i],
      contact: i === 0 ? "Équipe recrutement" : "",
      origin: "scout",
      updated_at: new Date(now - i * 3600_000).toISOString(),
    };
  });
  if (rows.length > 0) await db.from("applications").insert(rows);
  return rows.length;
}

// Camille's CV, written for the demo (a fictional person: the address cannot receive email). Read by
// Scout's own CV analysis, like any CV, so the demo shows a real result.
export const DEMO_CV_TEXT = `Camille Exemple
camille@exemple.invalid · 06 00 00 00 00
Product Manager junior

Expérience professionnelle
Product Owner (stage), Scale-up Mobilité Exemple, janvier 2025 - juin 2025
• Piloté la refonte du parcours d'inscription : +12 % de conversion en trois mois
• Conduit 18 entretiens utilisateurs pour prioriser le backlog du trimestre
• Rédigé les user stories et animé les rituels Scrum avec une équipe de 6 développeurs
• Suivi des indicateurs d'activation dans un tableau de bord partagé
Analyste produit (stage), Application Éducation Exemple, juillet 2024 - décembre 2024
• Analysé les données d'usage en SQL pour identifier les fonctionnalités peu utilisées
• Participation aux ateliers de discovery avec l'équipe design
• Réalisé des maquettes de tests sur Figma pour trois nouvelles fonctionnalités

Formation
Master en management de l'innovation, École Exemple, 2023 - 2025
Licence d'économie, Université Exemple, 2020 - 2023

Compétences
Discovery, priorisation, user stories, roadmap, Scrum, SQL, Figma, interviews utilisateurs, KPIs

Langues
Français : langue maternelle
Anglais : courant (C1)`;

// What the demo shows beyond the sort: a CV analysis, an application kit and an interview preparation,
// written by the same code as for anyone. Prepared once (the CV) or after each daily rebuild.
export async function seedDemoExtras(db: SupabaseClient, userId: string) {
  const { getLlm } = await import("@/lib/llm");
  const { scoreCv } = await import("@/lib/cv/ats");
  const { KEYWORDS_SYSTEM, readAsRecruiter, strings } = await import("@/lib/cv/recruiter");
  const { cvSkillsFrom, inCvCheck } = await import("@/lib/views/skills");
  const { marketForCv } = await import("@/lib/market/view");
  const { redactPersonalData } = await import("@/lib/privacy/redact");
  const { writeKit, writePrep } = await import("@/lib/prep");
  const llm = getLlm();
  const done: string[] = [];
  const { data: profile } = await db.from("profiles").select("criteria, criteria_version, cv_summary").eq("id", userId).single();

  const { count } = await db.from("cv_analyses").select("id", { count: "exact", head: true }).eq("user_id", userId);
  if (!count) {
    const roles = [...DEMO_CRITERIA.targetRoles, ...DEMO_CRITERIA.titleVariants.slice(0, 4)].join(", ");
    // The same twelve skills as the demo's Mon marché, as for anyone.
    const market = await marketForCv(db, userId);
    const top = market.skills;
    const has = inCvCheck(DEMO_CV_TEXT, []);
    const keywords = top.length ? top.map((t) => t.name) : strings(((await llm.json({ system: KEYWORDS_SYSTEM, user: `Métier visé : ${roles}`, tier: "fast" })) as { mots_cles?: unknown }).mots_cles).slice(0, 12);
    const present = top.length ? top.filter((t) => has(t.key)).map((t) => t.name) : undefined;
    const result = scoreCv({ text: DEMO_CV_TEXT, layout: { pages: 1, columnRatio: 0.05, spacedTitles: 0 }, filename: "CV Camille Exemple - Product Manager.pdf", sizeBytes: 180_000 }, { expected: keywords, present, titles: market.titles, languages: top.filter((t) => t.kind === "langue").map((t) => t.name), keys: Object.fromEntries(top.map((t) => [t.name, t.key])), shares: Object.fromEntries(top.map((t) => [t.name, t.share])) });
    const { recruiter, suggestions } = await readAsRecruiter(llm, { text: DEMO_CV_TEXT, redacted: redactPersonalData(DEMO_CV_TEXT, ["Camille", "Exemple"]), roles, experienceYears: DEMO_CRITERIA.experienceYears, keywords, offer: null });
    await db.from("cv_analyses").insert({
      user_id: userId,
      filename: "CV Camille Exemple - Product Manager.pdf",
      total: result.total,
      categories: result.categories.map((c) => ({ key: c.key, score: c.score, max: c.max })),
      result,
      suggestions,
      comparison: null,
      recruiter,
    });
    const { data: asked } = await db.from("offer_scores").select("offer:offers(skills)").eq("user_id", userId).eq("scored_by", "llm").limit(1500);
    const names = ((asked ?? []) as unknown as { offer: { skills: { name: string }[] | null } | null }[]).flatMap((r) => (r.offer?.skills ?? []).map((s) => s.name));
    await db.from("profiles").update({ cv_skills: cvSkillsFrom(DEMO_CV_TEXT, [...names, ...top.map((t) => t.name)]) }).eq("id", userId);
    done.push("analyse de CV");
  }

  const { data: apps } = await db.from("applications").select("id, stage, title, company, offer_id, prep").eq("user_id", userId);
  const toApply = (apps ?? []).find((a) => a.stage === "a_postuler" && a.offer_id);
  if (toApply) {
    const { data: score } = await db.from("offer_scores").select("kit").eq("user_id", userId).eq("offer_id", toApply.offer_id).eq("criteria_version", profile?.criteria_version ?? 0).maybeSingle();
    const kit = (score?.kit ?? {}) as { message?: string; letter?: string };
    const { data: offer } = await db.from("offers").select("title, description, company:companies(name)").eq("id", toApply.offer_id).single();
    if (score && offer?.description && (!kit.message || !kit.letter)) {
      const post = { title: offer.title, company: (offer.company as unknown as { name: string } | null)?.name ?? "", description: offer.description };
      const next = { message: kit.message || (await writeKit(llm, profile, post, "message")), letter: kit.letter || (await writeKit(llm, profile, post, "letter")) };
      await db.from("offer_scores").update({ kit: next }).eq("user_id", userId).eq("offer_id", toApply.offer_id).eq("criteria_version", profile?.criteria_version ?? 0);
      done.push("kit de candidature");
    }
  }
  const interview = (apps ?? []).find((a) => a.stage === "entretien");
  if (interview && !interview.prep) {
    const { data: offer } = interview.offer_id ? await db.from("offers").select("description").eq("id", interview.offer_id).maybeSingle() : { data: null };
    const prep = await writePrep(llm, profile, { title: interview.title, company: interview.company, description: offer?.description ?? null });
    if (prep.presentation) {
      await db.from("applications").update({ prep }).eq("id", interview.id);
      done.push("préparation d'entretien");
    }
  }
  // A shared market card, as Camille would share it: refreshed each day from her latest market.
  const { data: snap } = await db.from("market_snapshots").select("data").eq("profile_id", userId).eq("role", "").order("day", { ascending: false }).limit(1).maybeSingle();
  const { data: card } = await db.from("market_cards").select("id, created_at").eq("profile_id", userId).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (snap?.data && (!card || Date.now() - Date.parse(card.created_at) > 20 * 3600_000)) {
    const m = snap.data as { mine: number; skills: Record<string, unknown>[] };
    await db.from("market_cards").insert({ profile_id: userId, data: { ...m, mine: 0, skills: m.skills.map((x) => ({ ...x, inCv: false, mine: 0 })) } });
    done.push("carte du marché");
  }
  // "Métiers": Camille's exploration, as she would write it, counted again each day.
  const { data: careers } = await db.from("profiles").select("criteria, cv_summary, career_at").eq("id", userId).single();
  if (!careers?.career_at || Date.now() - Date.parse(careers.career_at) > 20 * 3600_000) {
    const { exploreCareers } = await import("@/lib/careers");
    const ideas = await exploreCareers(db, llm, { text: DEMO_CAREER_TEXT, criteria: Criteria.parse(careers?.criteria ?? {}), cv: careers?.cv_summary ? (CvSummary.safeParse(careers.cv_summary).data ?? null) : null }).catch(() => null);
    if (ideas?.length) {
      await db.from("profiles").update({ career_text: DEMO_CAREER_TEXT, career_ideas: ideas, career_at: new Date().toISOString() }).eq("id", userId);
      done.push("métiers");
    }
  }
  return done;
}
