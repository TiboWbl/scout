// Non-regression set for the scoring prompt. Fictional offers, invented company names.
// Test profile: junior PM, ~1 year of experience, Paris, sport and health as priority sectors.
import { Criteria } from "@/lib/domain/criteria";
import { parseLocation } from "@/lib/domain/geo";
import { detectContract, detectExperienceYears } from "@/lib/domain/signals";
import type { Level } from "@/lib/domain/offer";

export const PROFILE = Criteria.parse({
  targetRoles: ["Product Manager"],
  titleVariants: ["Product Manager", "Product Owner", "Associate Product Manager", "Junior Product Manager", "Chef de produit", "Responsable produit", "PM junior"],
  bridgeRoles: ["Product Analyst", "Product Operations", "Business Analyst", "Customer Success Manager"],
  sectorsPriority: ["Sport", "Santé"],
  sectorsOk: ["SaaS", "Tech", "E-commerce", "Maison et décoration"],
  zone: { places: [{ label: "Paris", kind: "city", country: "FR" }], remoteOk: true },
  outOfZone: "never",
  contracts: ["cdi"],
  experienceYears: 1,
  languages: ["Français", "Anglais courant"],
  openness: 60,
});

export const CV = {
  experienceYears: 1,
  roles: ["Product Owner (stage de fin d'études)", "Chef de projet et support technique (stage)"],
  skills: ["Discovery", "User stories", "Priorisation", "Spécifications", "Interviews utilisateurs", "SQL", "Figma"],
  languages: ["Français natif", "Anglais C1"],
  education: ["Diplôme d'ingénieur, majeure Product Engineering"],
  highlights: ["Projet B2B piloté de la discovery à la livraison", "Plus de 1 000 demandes utilisateurs traitées"],
};

export type Expectation =
  | { stage: "prefilter"; excluded: true }
  | { stage: "llm"; levels: Level[]; interetBelow?: number; chancesBelow?: number; hasWatch?: boolean };

export type Case = { name: string; title: string; company: string; location: string; description: string; expect: Expectation };

export const CASES: Case[] = [
  {
    name: "1. Senior PM 7+ ans pour un junior : écartée au préfiltre",
    title: "Senior Product Manager",
    company: "Nordwave Analytics",
    location: "Paris, France",
    description: "Tu piloteras la stratégie produit de notre plateforme. Profil recherché : 7+ years of product management experience, leadership d'équipes.",
    expect: { stage: "prefilter", excluded: true },
  },
  {
    name: "2. Offre à New York pour une recherche à Paris : écartée au préfiltre",
    title: "Product Manager",
    company: "Lumen Grid",
    location: "New York, New York, USA",
    description: "Join our New York team to own the onboarding experience. 1-2 years of experience.",
    expect: { stage: "prefilter", excluded: true },
  },
  {
    name: "3. Intitulé trompeur (PM événementiel) : intérêt bas",
    title: "Product Manager",
    company: "Festivo Events",
    location: "Paris",
    description:
      "Au sein de l'agence, tu organiseras nos salons et séminaires clients : sélection des lieux, négociation avec les traiteurs, coordination des prestataires, gestion du budget événementiel et accueil des participants le jour J. Profil recherché : formation en école de commerce ou événementiel, 1 à 2 ans d'expérience en organisation d'événements, permis B.",
    expect: { stage: "llm", levels: ["tremplin", "ecartee"], interetBelow: 45 },
  },
  {
    name: "4. Poste commercial déguisé : intérêt bas, point d'attention",
    title: "Business Developer Produit",
    company: "Salvo Software",
    location: "Paris",
    description:
      "Ta mission : générer du chiffre d'affaires. 80 % de ton temps sera consacré à la prospection téléphonique et à la prise de rendez-vous, avec des objectifs mensuels de signatures. Tu feras remonter quelques retours clients à l'équipe produit. Rémunération fixe + variable déplafonné. Profil recherché : chasseur, à l'aise au téléphone, première expérience commerciale.",
    expect: { stage: "llm", levels: ["tremplin", "ecartee"], interetBelow: 45, hasWatch: true },
  },
  {
    name: "5. Bon poste sous un autre intitulé : coup de cœur ou solide",
    title: "Responsable produit digital",
    company: "Atlas Mobilités",
    location: "Paris",
    description:
      "Tu définis la roadmap de notre application mobile, mènes la discovery avec les utilisateurs, rédiges les user stories et priorises le backlog avec l'équipe de développement. Tu suis les KPIs d'adoption après chaque lancement. Profil recherché : première expérience en product management (stage ou alternance acceptés), à l'aise avec la donnée, anglais courant. CDI.",
    expect: { stage: "llm", levels: ["coeur", "solide"] },
  },
  {
    // Changed on 4 November 2026 at the user's request: a recruiter does not hire someone with one year for
    // a post that writes three; such offers crowded the selection without a real chance.
    name: "6. 3 ans d'expérience demandés pour un junior : écartée",
    title: "Product Owner",
    company: "Bricks Platform",
    location: "Paris",
    description:
      "Tu gères le backlog d'une squad de 6 développeurs, rédiges les spécifications et animes les rituels agiles. Profil recherché : 3 ans d'expérience minimum en tant que Product Owner, maîtrise de Jira, anglais courant. CDI.",
    expect: { stage: "prefilter", excluded: true },
  },
  {
    name: "7. Associate PM healthtech, profil ingénieur, mentorat : coup de cœur",
    title: "Associate Product Manager",
    company: "Kinetika Santé",
    location: "Paris",
    description:
      "Kinetika Santé développe une plateforme de rééducation à distance pour les patients et les kinésithérapeutes. Tu rejoins l'équipe produit comme Associate PM : discovery avec les patients et praticiens, spécifications, priorisation et suivi des indicateurs. Programme de mentorat structuré : un PM senior référent, un point hebdomadaire et un plan de progression sur 12 mois. Profil recherché : formation d'ingénieur, première expérience produit (stage ou alternance), goût pour la recherche utilisateur. CDI à Paris, hybride.",
    expect: { stage: "llm", levels: ["coeur"] },
  },
  {
    name: "8. Junior PM scale-up ameublement financée, vrai poste produit, 0 à 2 ans : coup de cœur",
    title: "Junior Product Manager",
    company: "Maison Ondine",
    location: "Paris",
    description:
      "Maison Ondine, scale-up de mobilier et de décoration en ligne qui vient de lever 30 millions d'euros, renforce son équipe produit. Tu travailles sur le parcours d'achat du site e-commerce : discovery, tests A/B, spécifications et priorisation avec les développeurs. Profil recherché : 0 à 2 ans d'expérience en product management, esprit analytique, anglais professionnel. CDI.",
    expect: { stage: "llm", levels: ["coeur"] },
  },
  {
    name: "9. « Junior PM » dans une marque de mode, en réalité collection textile : écartée",
    title: "Junior Product Manager",
    company: "Atelier Sève",
    location: "Paris",
    description:
      "Au sein du bureau de style, tu participes au développement de la collection prêt-à-porter femme : suivi des prototypes avec les ateliers de confection, choix des matières et des tissus, suivi des fiches techniques et des tailles, relation avec les fournisseurs textiles en Europe. Profil recherché : formation en mode ou textile, connaissance des matières, première expérience en développement produit textile.",
    expect: { stage: "llm", levels: ["ecartee"] },
  },
  {
    name: "10. QA Analyst avec passerelle annoncée QA → PO → PM : tremplin",
    title: "QA Analyst",
    company: "Orbe Conseil Produit",
    location: "Paris",
    description:
      "Cabinet de conseil spécialisé en produit digital, nous accompagnons nos clients de la discovery à la mise en production. Tu rejoins l'équipe qualité : rédaction et exécution des plans de test, recette fonctionnelle, suivi des anomalies avec les Product Owners. Parcours d'évolution affiché : nos QA Analysts deviennent Product Owner après 12 à 18 mois, puis Product Manager. Profil recherché : formation d'ingénieur, rigueur, première expérience en test ou en produit appréciée. CDI.",
    expect: { stage: "llm", levels: ["tremplin"] },
  },
  {
    name: "11. Customer Experience Specialist, objets connectés santé : tremplin, score bas",
    title: "Customer Experience Specialist",
    company: "Pulsea Devices",
    location: "Paris",
    description:
      "Pulsea conçoit des tensiomètres et balances connectés pour le suivi de santé à domicile. Tu réponds aux demandes des utilisateurs par email et chat, diagnostiques les problèmes de synchronisation, rédiges les articles d'aide et fais remonter les irritants récurrents à l'équipe produit. Profil recherché : excellent relationnel, patience, première expérience en support client. CDI.",
    expect: { stage: "llm", levels: ["tremplin"], interetBelow: 60 },
  },
];

export function gateInput(c: Case) {
  const loc = parseLocation(c.location, c.title);
  return {
    title: c.title,
    companyName: c.company,
    places: loc.places,
    remote: loc.remote,
    remote_scope: loc.remoteScope,
    contract: detectContract(c.title, null, c.description),
    experience_min_years: detectExperienceYears(c.description),
  };
}
