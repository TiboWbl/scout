"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { CareerExplorer } from "@/components/career-explorer";
import type { CareerIdea } from "@/lib/careers";
import type { Criteria } from "@/lib/domain/criteria";

// On the "Métiers" page an added job is saved at once: a new version of the search, sorted right away.
export function CareersPage(props: { criteria: Criteria; demo: boolean; initialText: string; initialIdeas: CareerIdea[] | null; countedAt: string | null }) {
  const router = useRouter();
  const [criteria, setCriteria] = useState(props.criteria);
  return (
    <CareerExplorer
      {...props}
      page
      criteria={criteria}
      onAdd={async (title, as) => {
        const next = { ...criteria, [as]: [...criteria[as], title] };
        const res = await fetch("/api/profile", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ criteria: next }) });
        if (!res.ok) throw new Error("save");
        setCriteria(next);
        router.refresh();
      }}
    />
  );
}
