"use client";

import { useState } from "react";
import { CONTRACT_LABELS, CONTRACTS, type Criteria, type ZonePlace } from "@/lib/domain/criteria";
import { parseLocation, REGION_LABELS } from "@/lib/domain/geo";
import { CloseIcon } from "@/components/icons";

const COUNTRY_LABELS: Record<string, string> = { FR: "France", BE: "Belgique", CH: "Suisse", LU: "Luxembourg", CA: "Canada", GB: "Royaume-Uni", US: "États-Unis", DE: "Allemagne", ES: "Espagne", PT: "Portugal", NL: "Pays-Bas", IE: "Irlande", IT: "Italie" };

// Plain blocks: the orange tags carry the colour and show what is selected.
function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-[22px] border border-line bg-surface p-5">
      <h3 className="font-display text-lg font-bold tracking-tight">{title}</h3>
      {hint && <p className="mt-0.5 text-sm text-muted">{hint}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Chips({ values, onChange, placeholder, label }: { values: string[]; onChange: (v: string[]) => void; placeholder: string; label: string }) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const v = draft.trim();
    if (v && !values.some((x) => x.toLowerCase() === v.toLowerCase())) onChange([...values, v]);
    setDraft("");
  };
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {values.map((v) => (
        <span key={v} className="flex items-center gap-1 rounded-full bg-peach-soft py-1.5 pl-3 pr-1.5 text-[13.5px] font-medium text-peach-ink">
          {v}
          <button type="button" onClick={() => onChange(values.filter((x) => x !== v))} aria-label={`Retirer ${v}`} className="grid h-5 w-5 place-items-center rounded-full hover:bg-peach-ink/15">
            <CloseIcon className="h-3 w-3" />
          </button>
        </span>
      ))}
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            add();
          }
        }}
        onBlur={add}
        placeholder={placeholder}
        aria-label={label}
        className="min-w-[160px] flex-1 rounded-full border border-dashed border-line bg-transparent px-3 py-1.5 text-[13.5px] placeholder:text-muted focus:border-ink focus:outline-none"
      />
    </div>
  );
}

function placeFromText(text: string): ZonePlace | null {
  const p = parseLocation(text).places[0];
  if (!p?.country) return null;
  if (p.city) return { label: p.city, kind: "city", country: p.country };
  if (p.region) return { label: REGION_LABELS[p.region] ?? p.region, kind: "region", country: p.country };
  return { label: COUNTRY_LABELS[p.country] ?? p.country, kind: "country", country: p.country };
}

function Places({ value, onChange }: { value: ZonePlace[]; onChange: (v: ZonePlace[]) => void }) {
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const add = () => {
    if (!draft.trim()) return;
    const place = placeFromText(draft);
    if (!place) return setError("Lieu non reconnu : essaie une ville, une région française ou un pays.");
    if (!value.some((p) => p.label === place.label)) onChange([...value, place]);
    setDraft("");
    setError(null);
  };
  const kindLabel = { city: "ville", region: "région", country: "pays" } as const;
  return (
    <div>
      <div className="flex flex-wrap items-center gap-1.5">
        {value.map((p) => (
          <span key={p.label} className="flex items-center gap-1 rounded-full bg-peach-soft py-1.5 pl-3 pr-1.5 text-[13.5px] font-medium text-peach-ink">
            {p.label}
            <span className="text-muted">· {kindLabel[p.kind]}</span>
            <button type="button" onClick={() => onChange(value.filter((x) => x.label !== p.label))} aria-label={`Retirer ${p.label}`} className="grid h-5 w-5 place-items-center rounded-full hover:bg-peach-ink/15">
              <CloseIcon className="h-3 w-3" />
            </button>
          </span>
        ))}
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          onBlur={add}
          placeholder="Ajouter une ville, une région, un pays"
          aria-label="Ajouter un lieu"
          className="min-w-[200px] flex-1 rounded-full border border-dashed border-line bg-transparent px-3 py-1.5 text-[13.5px] placeholder:text-muted focus:border-ink focus:outline-none"
        />
      </div>
      {error && <p className="mt-2 text-sm text-warn">{error}</p>}
    </div>
  );
}

function Toggle({ on, label, onClick }: { on: boolean; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={on} className={`rounded-xl border px-3.5 py-2 text-sm font-medium ${on ? "border-transparent bg-peach-soft font-semibold text-peach-ink" : "border-line bg-surface text-muted hover:text-ink"}`}>
      {label}
    </button>
  );
}

export function CriteriaEditor({ value, onChange }: { value: Criteria; onChange: (c: Criteria) => void }) {
  const set = <K extends keyof Criteria>(key: K, v: Criteria[K]) => onChange({ ...value, [key]: v });

  return (
    <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-2">
      <Section title="Métier prioritaire" hint="Ton métier n°1 : Mon CV se compare à son marché. Chaque métier qui te plaît a son propre marché.">
        <Chips values={value.targetRoles.slice(0, 1)} onChange={(v) => set("targetRoles", v.length === 0 ? value.targetRoles.slice(1) : [v[v.length - 1], ...value.targetRoles.filter((r) => r !== v[v.length - 1])])} placeholder="Ajouter ton métier n°1" label="Choisir ton métier prioritaire" />
        <p className="mb-2 mt-4 text-[13px] font-medium text-muted">Autres métiers qui te plaisent</p>
        <Chips values={value.targetRoles.slice(1)} onChange={(v) => set("targetRoles", [...value.targetRoles.slice(0, 1), ...v])} placeholder="Ajouter un métier" label="Ajouter un métier qui te plaît" />
        <p className="mb-2 mt-4 text-[13px] font-medium text-muted">Autres façons d&apos;écrire ces métiers</p>
        <p className="-mt-1 mb-2 text-[12.5px] text-muted">En anglais, en sigle, au niveau junior : elles servent à trouver les offres, jamais à compter un marché.</p>
        <Chips values={value.titleVariants} onChange={(v) => set("titleVariants", v)} placeholder="Ajouter un intitulé" label="Ajouter une autre façon d'écrire" />
        <p className="mb-2 mt-4 text-[13px] font-medium text-muted">Métiers passerelles acceptés</p>
        <Chips values={value.bridgeRoles} onChange={(v) => set("bridgeRoles", v)} placeholder="Ajouter une passerelle" label="Ajouter un métier passerelle" />
      </Section>

      <Section title="Zone" hint="Les offres hors de cette zone ne se mélangent jamais à ta sélection.">
        <Places value={value.zone.places} onChange={(places) => set("zone", { ...value.zone, places })} />
        <label className="mt-4 flex items-center gap-2.5 text-sm">
          <input type="checkbox" checked={value.zone.remoteOk} onChange={(e) => set("zone", { ...value.zone, remoteOk: e.target.checked })} className="h-4 w-4 accent-[var(--brand)]" />
          Le télétravail complet compte dans ma zone s&apos;il est ouvert à mon pays
        </label>
        <p className="mb-2 mt-4 text-[13px] font-medium text-muted">Offres hors de ma zone</p>
        <div className="flex flex-wrap gap-2">
          <Toggle on={value.outOfZone === "never"} label="Jamais" onClick={() => set("outOfZone", "never")} />
          <Toggle on={value.outOfZone === "exceptional"} label="Seulement si exceptionnelles" onClick={() => set("outOfZone", "exceptional")} />
          <Toggle on={value.outOfZone === "yes"} label="Oui" onClick={() => set("outOfZone", "yes")} />
        </div>
      </Section>

      <Section title="Secteurs">
        <p className="mb-2 text-[13px] font-medium text-muted">Prioritaires</p>
        <Chips values={value.sectorsPriority} onChange={(v) => set("sectorsPriority", v)} placeholder="Ajouter un secteur" label="Ajouter un secteur prioritaire" />
        <p className="mb-2 mt-4 text-[13px] font-medium text-muted">Acceptés</p>
        <Chips values={value.sectorsOk} onChange={(v) => set("sectorsOk", v)} placeholder="Ajouter un secteur" label="Ajouter un secteur accepté" />
        <p className="mb-2 mt-4 text-[13px] font-medium text-muted">À éviter</p>
        <Chips values={value.sectorsAvoid} onChange={(v) => set("sectorsAvoid", v)} placeholder="Ajouter un secteur" label="Ajouter un secteur à éviter" />
        <label className="mt-4 flex items-center gap-2.5 text-sm">
          <input type="checkbox" checked={value.otherSectors.open} onChange={(e) => set("otherSectors", { ...value.otherSectors, open: e.target.checked })} className="h-4 w-4 accent-[var(--brand)]" />
          Ouvert aux autres secteurs
        </label>
        {value.otherSectors.open && (
          <input
            value={value.otherSectors.condition ?? ""}
            onChange={(e) => set("otherSectors", { ...value.otherSectors, condition: e.target.value || null })}
            placeholder="À une condition ? Ex. une vraie culture produit"
            aria-label="Condition pour les autres secteurs"
            className="mt-2 w-full rounded-xl border border-line bg-pill-solid px-3 py-2 text-sm placeholder:text-muted"
          />
        )}
      </Section>

      <Section title="Contrat et expérience">
        <div className="flex flex-wrap gap-2">
          {CONTRACTS.map((c) => (
            <Toggle
              key={c}
              on={value.contracts.includes(c)}
              label={CONTRACT_LABELS[c]}
              onClick={() => set("contracts", value.contracts.includes(c) ? value.contracts.filter((x) => x !== c) : [...value.contracts, c])}
            />
          ))}
        </div>
        <p className="mt-2 text-[13px] text-muted">Aucun sélectionné = tous les contrats.</p>
        <label className="mt-4 flex items-center gap-3 text-sm">
          Ton expérience professionnelle
          <input
            type="number"
            min={0}
            max={45}
            step={0.5}
            value={value.experienceYears ?? ""}
            onChange={(e) => set("experienceYears", e.target.value === "" ? null : Number(e.target.value))}
            className="w-20 rounded-xl border border-line bg-pill-solid px-3 py-1.5 text-sm"
          />
          ans
        </label>
        <div className="mt-4 text-sm">
          <p>Travailler en anglais</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {(
              [
                ["oui", "Oui"],
                ["un_peu", "Un peu"],
                ["non", "Non"],
              ] as const
            ).map(([key, label]) => (
              <Toggle key={key} on={value.englishWork === key} label={label} onClick={() => set("englishWork", key)} />
            ))}
          </div>
          <p className="mt-2 text-[13px] text-muted">
            {value.englishWork === "non"
              ? "Les offres rédigées en anglais sont écartées : le poste se passe sans doute en anglais."
              : value.englishWork === "un_peu"
                ? "Une offre rédigée en anglais reste possible, jamais en coup de cœur, et elle le dit."
                : "Les offres en anglais comptent comme les autres."}
          </p>
        </div>
        <label className="mt-3 flex items-center gap-3 text-sm">
          Disponibilité
          <input
            value={value.availability ?? ""}
            onChange={(e) => set("availability", e.target.value || null)}
            placeholder="Ex. immédiate"
            className="min-w-0 flex-1 rounded-xl border border-line bg-pill-solid px-3 py-1.5 text-sm placeholder:text-muted"
          />
        </label>
      </Section>

      <Section title="Ouverture" hint="Pondère le classement entre ce qui te plaît le plus et tes chances d'être retenu·e.">
        <input
          type="range"
          min={0}
          max={100}
          value={value.openness}
          onChange={(e) => set("openness", Number(e.target.value))}
          aria-label="Ouverture"
          className="w-full accent-[var(--brand)]"
        />
        <div className="mt-1 flex justify-between text-[13px] text-muted">
          <span>Job de rêve uniquement</span>
          <span>Surtout commencer quelque part</span>
        </div>
      </Section>

      <Section title="Langues et entreprises">
        <p className="mb-2 text-[13px] font-medium text-muted">Langues</p>
        <Chips values={value.languages} onChange={(v) => set("languages", v)} placeholder="Ajouter une langue" label="Ajouter une langue" />
        <p className="mb-2 mt-4 text-[13px] font-medium text-muted">Entreprises exclues</p>
        <Chips values={value.companiesAvoid} onChange={(v) => set("companiesAvoid", v)} placeholder="Ajouter une entreprise" label="Ajouter une entreprise exclue" />
        <p className="mb-2 mt-4 text-[13px] font-medium text-muted">Deal-breakers</p>
        <Chips values={value.dealBreakers} onChange={(v) => set("dealBreakers", v)} placeholder="Ex. astreintes le week-end" label="Ajouter un deal-breaker" />
      </Section>
    </div>
  );
}
