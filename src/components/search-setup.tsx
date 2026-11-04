"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { hasMinimumCriteria, type Criteria, type CvSummary } from "@/lib/domain/criteria";
import { extractTextFromPdf } from "@/lib/pdf-extract";
import { CareerExplorer } from "@/components/career-explorer";
import { CriteriaEditor } from "./criteria-editor";
import { AutoTextarea } from "./auto-textarea";
import { addFavorites, parseEntries } from "./favorites";

type Props = {
  mode: "onboarding" | "edit";
  initialText?: string;
  initialCriteria?: Criteria | null;
  initialCvSummary?: CvSummary | null;
  // The CV already read for this profile (the file itself is never kept).
  savedCv?: { filename: string | null; updatedAt: string | null } | null;
};

// What Scout kept from the CV, folded into one line: opened only to check it. The years of experience
// are not repeated here: the editable field below is the one the sort uses.
function CvDigest({ cv, title }: { cv: CvSummary; title: React.ReactNode }) {
  const rows: [string, string[]][] = [
    ["Postes", cv.roles],
    ["Formation", cv.education],
    ["Réalisations", cv.highlights],
    ["Langues", cv.languages],
  ];
  return (
    <details className="mt-4 rounded-2xl bg-pill-solid px-4 py-3 text-[14px] leading-relaxed">
      <summary className="cursor-pointer font-semibold">{title}</summary>
      <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-3 md:grid-cols-2">
        {rows
          .filter(([, values]) => values.length > 0)
          .map(([label, values]) => (
            <div key={label}>
              <dt className="text-[12.5px] font-semibold text-muted">{label}</dt>
              <dd>
                <ul className="mt-0.5 space-y-0.5">{values.map((v) => <li key={v}>{v}</li>)}</ul>
              </dd>
            </div>
          ))}
        {cv.skills.length > 0 && (
          <div className="md:col-span-2">
            <dt className="text-[12.5px] font-semibold text-muted">Compétences</dt>
            <dd className="mt-1 flex flex-wrap gap-1.5">
              {cv.skills.map((k) => (
                <span key={k} className="rounded-full bg-surface px-2.5 py-1 text-[13px]">{k}</span>
              ))}
            </dd>
          </div>
        )}
      </dl>
    </details>
  );
}

// Shared by onboarding and "Ma recherche": free text (+ optional CV) → editable chips → saved.
export function SearchSetup({ mode, initialText = "", initialCriteria = null, initialCvSummary = null, savedCv = null }: Props) {
  const router = useRouter();
  const [text, setText] = useState(initialText);
  const [cvText, setCvText] = useState<string | null>(null);
  const [cvName, setCvName] = useState<string | null>(null);
  const [criteria, setCriteria] = useState<Criteria | null>(initialCriteria);
  const [cvSummary, setCvSummary] = useState<CvSummary | null | undefined>(undefined);
  const [cvSkills, setCvSkills] = useState<string[] | undefined>(undefined);
  const shownCv = cvSummary ?? initialCvSummary;
  const [busy, setBusy] = useState<"cv" | "interpret" | "save" | null>(null);
  const [dream, setDream] = useState("");
  const [dreamProgress, setDreamProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function onFile(file: File) {
    setError(null);
    setBusy("cv");
    try {
      const extracted = await extractTextFromPdf(file);
      if (extracted.trim().length < 40) throw new Error("empty");
      setCvText(extracted);
      setCvName(file.name);
    } catch {
      setError("Ce PDF ne se lit pas bien (souvent un CV en image). Tu peux continuer sans, ou essayer une autre version.");
    } finally {
      setBusy(null);
    }
  }

  async function interpret() {
    setError(null);
    setBusy("interpret");
    const res = await fetch("/api/profile/interpret", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, cvText: cvText ?? undefined }),
    }).catch(() => null);
    setBusy(null);
    if (!res) return setError("Connexion perdue. Vérifie ta connexion et réessaie.");
    const data = await res.json().catch(() => null);
    if (!res.ok) return setError(data?.error ?? "L'analyse n'a pas abouti, réessaie dans un instant.");
    setCriteria(data.criteria);
    if (data.cvSummary) setCvSummary(data.cvSummary);
    if (Array.isArray(data.cvSkills)) setCvSkills(data.cvSkills);
  }

  async function save() {
    if (!criteria) return;
    setError(null);
    setBusy("save");
    const res = await fetch("/api/profile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ criteria, searchText: text, ...(cvSummary !== undefined ? { cvSummary, cvFilename: cvName ?? undefined } : {}), ...(cvSkills ? { cvSkills } : {}) }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      setBusy(null);
      return setError(data?.error ?? "Enregistrement impossible, réessaie.");
    }
    const dreams = parseEntries(dream);
    if (dreams.length > 0) {
      setDreamProgress(`Scout cherche la page carrière de tes entreprises de rêve : 0 / ${dreams.length}`);
      await addFavorites(dreams, (done) => setDreamProgress(`Scout cherche la page carrière de tes entreprises de rêve : ${done} / ${dreams.length}`));
    }
    router.push("/offres");
    router.refresh();
  }

  const ready = criteria && hasMinimumCriteria(criteria);

  return (
    <div className="space-y-6">
      <section className="rounded-[22px] border border-line bg-surface p-5 md:p-6">
        <label htmlFor="search-text" className="font-display text-xl font-bold tracking-tight">
          {mode === "onboarding" ? "Dis-moi ce que tu cherches, avec tes mots" : "Redis-le avec tes mots"}
        </label>
        {mode === "onboarding" && <p className="mt-1 text-sm text-muted">Le métier, le lieu, ce qui te plaît, ce que tu veux éviter. Quelques phrases suffisent, et tout reste modifiable.</p>}
        <AutoTextarea
          id="search-text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          minRows={5}
          placeholder="Ex. Je termine mes études et je cherche un premier poste en marketing digital à Lyon, ou en télétravail. J'aimerais une entreprise à impact, et j'évite la grande distribution."
          className="mt-4 w-full resize-none rounded-2xl border border-line bg-pill-solid p-4 text-[15px] leading-relaxed placeholder:text-muted focus:border-ink focus:outline-none"
        />

        {savedCv && !cvName && initialCvSummary && (
          <CvDigest
            cv={initialCvSummary}
            title={`Ce que Scout a retenu de ton CV${savedCv.filename ? ` (${savedCv.filename})` : ""}${savedCv.updatedAt ? `, lu le ${new Date(savedCv.updatedAt).toLocaleDateString("fr-FR", { day: "numeric", month: "long" })}` : ""}`}
          />
        )}

        {mode === "onboarding" && (
          <div className="mt-4">
            <label htmlFor="dream" className="text-sm font-semibold">
              Tes entreprises de rêve <span className="font-normal text-muted">(facultatif)</span>
            </label>
            <p className="text-[13px] text-muted">Elles aident Scout à cerner ce que tu aimes, et il surveillera leurs offres. Une par ligne ou séparées par des virgules.</p>
            <textarea
              id="dream"
              value={dream}
              onChange={(e) => setDream(e.target.value)}
              rows={2}
              placeholder="Ex. Acme Sport, Exemple Santé"
              className="mt-2 w-full resize-y rounded-2xl border border-line bg-pill-solid p-3 text-[15px] placeholder:text-muted focus:border-ink focus:outline-none"
            />
          </div>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <input ref={fileRef} type="file" accept="application/pdf" className="hidden" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
          <button type="button" onClick={() => fileRef.current?.click()} disabled={busy !== null} className="rounded-xl border border-line bg-pill px-4 py-2.5 text-sm font-medium hover:border-ink">
            {busy === "cv" ? "Lecture du CV…" : cvName ? `CV : ${cvName}` : savedCv ? "Remplacer mon CV" : "Ajouter mon CV (PDF, facultatif)"}
          </button>
          <button
            type="button"
            onClick={interpret}
            disabled={busy !== null || (!text.trim() && !cvText)}
            className="rounded-xl bg-button px-5 py-2.5 text-sm font-semibold text-button-ink disabled:opacity-40"
          >
            {busy === "interpret" ? "Analyse en cours…" : criteria ? "Réanalyser" : "Analyser ma recherche"}
          </button>
        </div>

        {mode === "onboarding" ? (
          <p className="mt-3 text-[13px] text-muted">Ton nom et tes coordonnées sont retirés du CV avant l&apos;IA, et le fichier n&apos;est pas conservé.</p>
        ) : (
          <p className="mt-3 text-[13px] text-muted">Ton nom et tes coordonnées sont retirés du CV avant l&apos;IA, et le fichier n&apos;est pas conservé.</p>
        )}
        {error && <p className="mt-3 rounded-xl bg-warn-soft px-4 py-3 text-sm text-warn">{error}</p>}
      </section>

      {busy === "interpret" && (
        <div role="status" className="flex items-center gap-4 rounded-[22px] border border-line bg-surface p-5">
          <span aria-hidden className="h-5 w-5 shrink-0 animate-spin rounded-full border-2 border-line border-t-brand" />
          <div>
            <p className="font-display text-lg font-bold tracking-tight">Scout lit ta recherche…</p>
            <p className="text-sm text-muted">{cvText ? "Il lit aussi ton CV, sans tes coordonnées. Compte une vingtaine de secondes." : "Compte une dizaine de secondes."}</p>
          </div>
        </div>
      )}

      {criteria && busy !== "interpret" && (
        <>
          <div>
            <h2 className="font-display text-2xl font-bold tracking-tight">Ce que j&apos;ai compris</h2>
            <p className="mt-1 text-sm text-muted">Tout se corrige ici : une puce se retire d&apos;un clic, Entrée en ajoute une.</p>
            {shownCv && cvName && <CvDigest cv={shownCv} title="Ce que Scout a retenu de ton CV" />}
          </div>
          <CriteriaEditor value={criteria} onChange={setCriteria} />
          <CareerExplorer criteria={criteria} onAdd={(title, as) => setCriteria({ ...criteria, [as]: [...criteria[as], title] })} />
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" onClick={save} disabled={!ready || busy !== null} className="rounded-xl bg-button px-6 py-3 text-[15px] font-semibold text-button-ink disabled:opacity-40">
              {busy === "save" ? "Enregistrement…" : mode === "onboarding" ? "C'est parti" : "Enregistrer"}
            </button>
            {dreamProgress && (
              <p role="status" className="flex items-center gap-2 text-sm text-muted">
                <span aria-hidden className="h-4 w-4 animate-spin rounded-full border-2 border-line border-t-brand" />
                {dreamProgress}
              </p>
            )}
            {!ready && <p className="text-sm text-muted">Il faut au moins un métier et un lieu.</p>}
          </div>
        </>
      )}
    </div>
  );
}
