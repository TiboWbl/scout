"use client";

import { useState } from "react";
import type { CareerIdea } from "@/lib/careers";
import type { Criteria } from "@/lib/domain/criteria";

// "Explorer d'autres métiers": the person says what they like and want; Scout suggests nearby jobs, each
// with why it fits, where it leads, and the offers open now (to a beginner first). One click adds a job to
// the search, as a target or as a bridge; saving the search then sorts the offers again.
export function CareerExplorer({ criteria, onChange }: { criteria: Criteria; onChange: (c: Criteria) => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ideas, setIdeas] = useState<CareerIdea[] | null>(null);
  const inSearch = (title: string) => [...criteria.targetRoles, ...criteria.titleVariants, ...criteria.bridgeRoles].some((t) => t.toLowerCase() === title.toLowerCase());
  const add = (title: string, as: "titleVariants" | "bridgeRoles") => onChange({ ...criteria, [as]: [...criteria[as], title] });

  async function explore() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/careers/explore", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) }).catch(() => null);
    const data = await res?.json().catch(() => null);
    setBusy(false);
    if (!res?.ok) return setError(res?.status === 401 ? "Avec un compte, Scout te propose des métiers à partir de ce que tu aimes." : (data?.error ?? "La recherche n'a pas abouti, réessaie."));
    setIdeas(data.ideas ?? []);
  }

  return (
    <section className="rounded-[22px] border border-line bg-surface p-5 md:p-6">
      <h2 className="font-display text-xl font-bold tracking-tight">Explorer d&apos;autres métiers</h2>
      <p className="mt-1 max-w-[70ch] text-sm text-muted">
        Dis ce que tu aimes, ce que tu veux faire et ce qui compte pour toi. Scout te propose des métiers proches, dont certains que tu ne connais peut-être pas, avec les offres ouvertes en ce moment, et d&apos;abord celles ouvertes aux débutants.
      </p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value.slice(0, 2000))}
        rows={3}
        placeholder="Ex. J'aime comprendre les utilisateurs, analyser des données pour décider, travailler avec les équipes tech. Je veux devenir Product Manager et progresser vite."
        className="mt-3 w-full rounded-xl border border-line bg-pill-solid px-3 py-2 text-[14.5px] placeholder:text-muted"
      />
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <button type="button" onClick={explore} disabled={busy || text.trim().length < 10} className="btn-soft disabled:opacity-50">
          {busy ? "Scout cherche des métiers…" : ideas ? "Chercher à nouveau" : "Proposer des métiers"}
        </button>
        {error && <span className="text-[13px] text-peach-ink">{error}</span>}
      </div>
      {ideas && ideas.length === 0 && <p className="mt-4 text-sm text-muted">Aucun métier proposé : dis-en un peu plus sur ce que tu aimes faire.</p>}
      {ideas && ideas.length > 0 && (
        <ul className="mt-5 grid grid-cols-1 gap-3 lg:grid-cols-2">
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
                <div className="mt-3 flex flex-wrap gap-2">
                  {there ? (
                    <span className="text-[13px] font-medium text-mint-ink">Déjà dans ta recherche</span>
                  ) : (
                    <>
                      <button type="button" onClick={() => add(idea.title, "titleVariants")} className="btn-soft py-1.5 text-[13px]">
                        Ajouter comme métier visé
                      </button>
                      <button type="button" onClick={() => add(idea.title, "bridgeRoles")} className="btn-soft py-1.5 text-[13px]">
                        Ajouter comme passerelle
                      </button>
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {ideas && ideas.some((i) => inSearch(i.title)) && <p className="mt-3 text-[13px] text-muted">Pense à enregistrer ta recherche : Scout triera alors les offres de ces métiers.</p>}
    </section>
  );
}
