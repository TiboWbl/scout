"use client";

import { useState } from "react";
import type { CareerIdea } from "@/lib/careers";
import type { Criteria } from "@/lib/domain/criteria";

export type CareerAdd = (title: string, as: "targetRoles" | "bridgeRoles") => void | Promise<void>;

// "Explorer d'autres métiers": the person says what they like and want; Scout suggests nearby jobs, each
// with why it fits, where it leads, and the offers open now (to a beginner first). One click adds a job to
// the search, as a target or as a bridge. In the search panel the change waits for "Enregistrer"; on the
// "Métiers" page it is saved at once.
export function CareerExplorer({
  criteria,
  onAdd,
  page = false,
  demo = false,
  initialText = "",
  initialIdeas = null,
  countedAt = null,
}: {
  criteria: Criteria;
  onAdd: CareerAdd;
  page?: boolean;
  demo?: boolean;
  initialText?: string;
  initialIdeas?: CareerIdea[] | null;
  countedAt?: string | null;
}) {
  const [text, setText] = useState(initialText);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ideas, setIdeas] = useState<CareerIdea[] | null>(initialIdeas);
  const [fresh, setFresh] = useState(false);
  const inSearch = (title: string) => [...criteria.targetRoles, ...criteria.titleVariants, ...criteria.bridgeRoles].some((t) => t.toLowerCase() === title.toLowerCase());

  async function explore() {
    if (demo) return setError("Avec un compte, Scout te propose des métiers à partir de ce que tu aimes.");
    setBusy(true);
    setError(null);
    const res = await fetch("/api/careers/explore", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) }).catch(() => null);
    const data = await res?.json().catch(() => null);
    setBusy(false);
    if (!res?.ok) return setError(res?.status === 401 ? "Avec un compte, Scout te propose des métiers à partir de ce que tu aimes." : (data?.error ?? "La recherche n'a pas abouti, réessaie."));
    setIdeas(data.ideas ?? []);
    setFresh(true);
  }

  async function add(title: string, as: "targetRoles" | "bridgeRoles") {
    if (demo) return setError("Avec un compte, un clic ajoute ce métier à ta recherche.");
    setAdding(title);
    setError(null);
    try {
      await onAdd(title, as);
    } catch {
      setError("L'ajout n'a pas abouti, réessaie.");
    }
    setAdding(null);
  }

  return (
    <section className="rounded-[22px] border border-line bg-surface p-5 md:p-6">
      <h2 className="font-display text-xl font-bold tracking-tight">{page ? "Ce que tu aimes, ce que tu veux faire" : "Explorer d'autres métiers"}</h2>
      <p className="mt-1 max-w-[70ch] text-sm text-muted">
        {page
          ? "Ce qui te plaît dans le travail, ce que tu as aimé faire, ce que tu vises plus tard. Scout te propose des métiers proches, dont certains que tu ne connais peut-être pas, et compte les offres ouvertes aux débutants en ce moment."
          : "Dis ce que tu aimes et ce que tu veux faire. Scout te propose des métiers proches, avec les offres ouvertes en ce moment, et d'abord celles ouvertes aux débutants."}
      </p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value.slice(0, 2000))}
        rows={page ? 4 : 3}
        placeholder="Ex. J'aime comprendre les utilisateurs, analyser des données pour décider, travailler avec les équipes tech. Je veux devenir Product Manager et progresser vite."
        className="mt-3 w-full rounded-xl border border-line bg-pill-solid px-3 py-2 text-[14.5px] placeholder:text-muted"
      />
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <button type="button" onClick={explore} disabled={busy || (!demo && text.trim().length < 10)} className="btn-soft disabled:opacity-50">
          {busy ? "Scout cherche des métiers…" : ideas ? "Chercher à nouveau" : "Proposer des métiers"}
        </button>
        {busy && <span className="text-[13px] text-muted">Compte une vingtaine de secondes.</span>}
        {error && <span className="text-[13px] text-peach-ink">{error}</span>}
      </div>
      {ideas && ideas.length === 0 && <p className="mt-4 text-sm text-muted">Aucun métier proposé : dis-en un peu plus sur ce que tu aimes faire.</p>}
      {ideas && ideas.length > 0 && (
        <>
          {countedAt && !fresh && <p className="mt-5 text-[13px] text-muted">Offres comptées le {new Date(countedAt).toLocaleDateString("fr-FR", { day: "numeric", month: "long" })}. Cherche à nouveau pour les chiffres du jour.</p>}
          <ul className={`${countedAt && !fresh ? "mt-2" : "mt-5"} grid grid-cols-1 gap-3 lg:grid-cols-2`}>
            {ideas.map((idea) => {
              const there = inSearch(idea.title);
              return (
                <li key={idea.title} className="flex flex-col rounded-2xl bg-pill-solid p-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <h3 className="font-display text-lg font-bold">{idea.title}</h3>
                    <span className="text-[12.5px] tabular-nums text-muted">
                      {idea.open === 0 ? "Aucune offre en ce moment" : `${idea.open} offre${idea.open > 1 ? "s" : ""} en ligne${idea.junior ? `, dont ${idea.junior} ouverte${idea.junior > 1 ? "s" : ""} aux débutants` : ""}`}
                    </span>
                  </div>
                  {idea.missions && <p className="mt-1.5 text-[14px]">{idea.missions}</p>}
                  {idea.why && (
                    <p className="mt-1.5 text-[13.5px] text-muted">
                      <span className="font-semibold text-ink">Pour toi : </span>
                      {idea.why}
                    </p>
                  )}
                  {idea.path && (
                    <p className="mt-1 text-[13.5px] text-muted">
                      <span className="font-semibold text-ink">Pour la suite : </span>
                      {idea.path}
                    </p>
                  )}
                  <div className="mt-auto flex flex-wrap gap-2 pt-3">
                    {there ? (
                      <span className="text-[13px] font-medium text-mint-ink">Dans ta recherche</span>
                    ) : adding === idea.title ? (
                      <span className="text-[13px] text-muted">Ajout en cours…</span>
                    ) : (
                      <>
                        <button type="button" onClick={() => add(idea.title, "targetRoles")} disabled={adding !== null} className="btn-soft py-1.5 text-[13px] disabled:opacity-50">
                          Ajouter comme métier visé
                        </button>
                        <button type="button" onClick={() => add(idea.title, "bridgeRoles")} disabled={adding !== null} className="btn-soft py-1.5 text-[13px] disabled:opacity-50">
                          Ajouter comme passerelle
                        </button>
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
          <p className="mt-3 text-[13px] text-muted">
            {page
              ? "Métier visé : ses offres peuvent être des coups de cœur. Passerelle : un poste qui te rapproche de ton objectif, rangé en Tremplin. Scout trie les offres dès l'ajout."
              : ideas.some((i) => inSearch(i.title))
                ? "Pense à enregistrer ta recherche : Scout triera alors les offres de ces métiers."
                : "Métier visé : ses offres peuvent être des coups de cœur. Passerelle : rangé en Tremplin."}
          </p>
        </>
      )}
    </section>
  );
}
