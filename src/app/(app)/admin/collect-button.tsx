"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function CollectButton() {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "running" | "done" | "error">("idle");
  const [summary, setSummary] = useState<string | null>(null);

  async function run() {
    setState("running");
    const res = await fetch("/api/admin/collect", { method: "POST" });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      setState("error");
      setSummary(data?.error ?? "La collecte a échoué.");
      return;
    }
    if (data.already) {
      const at = new Date(data.already).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" });
      setSummary(`Une collecte est déjà en cours, lancée à ${at} : elle prend une quinzaine de minutes, tri compris. Inutile d'en relancer une.`);
      setState("done");
      return;
    }
    if (data.dispatched) {
      setSummary("Collecte complète lancée sur GitHub : les offres et le tri seront à jour d'ici une quinzaine de minutes.");
      setState("done");
      return;
    }
    const reports = (data.reports ?? []) as { seen: number; created: number; error?: string }[];
    setSummary(
      `${reports.length} sources, ${reports.reduce((n, r) => n + r.seen, 0)} offres vues, ${reports.reduce((n, r) => n + r.created, 0)} nouvelles, ${reports.filter((r) => r.error).length} en erreur.`,
    );
    setState("done");
    router.refresh();
  }

  return (
    <div>
      <p className="mb-3 text-sm text-muted">
        Le robot collecte déjà trois fois par jour, vers 7 h, 13 h et 19 h (ces horaires de GitHub glissent parfois). Ce bouton lance tout de suite une collecte complète, suivie du tri.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={run} disabled={state === "running"} className="rounded-xl bg-button px-5 py-2.5 text-sm font-semibold text-button-ink disabled:opacity-50">
          {state === "running" ? "Lancement…" : "Collecter maintenant"}
        </button>
        {summary && <p className={`text-sm ${state === "error" ? "text-warn" : "text-muted"}`}>{summary}</p>}
      </div>
    </div>
  );
}
