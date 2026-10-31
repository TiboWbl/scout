# Scout

Toute sa recherche d'emploi dans un seul onglet, quel que soit le métier : les offres qui correspondent vraiment, expliquées, ce que son marché demande, un CV prêt pour les ATS et le suivi des candidatures. Calme, transparent, gratuit, multi-utilisateurs.

**Démo, sans compte : [scout-tibow.vercel.app/demo](https://scout-tibow.vercel.app/demo)** (profil fictif, offres réelles, exactement le site).

La spécification complète, source de vérité produit et technique, est dans [SPEC.md](SPEC.md).

## Ce que fait Scout

- **Inscription en langage naturel** : quelques phrases, et un CV en option, deviennent des critères modifiables (métier, intitulés équivalents FR/EN, passerelles, zone, contrats, expérience). Connexion Google ou code par email. Le nom et les coordonnées sont retirés du CV avant tout envoi à l'IA.
- **Collecte légale et large** : API et flux publics de 12 ATS (Greenhouse, Lever, Ashby, SmartRecruiters, Workable, Recruitee, Teamtailor, Personio, Polymer, DigitalRecruiters, Welcome Kit, Workday), sites carrière propres (fiche schema.org `JobPosting`, ou la page elle-même, et les listes plus fines du plan du site quand la liste principale est coupée), moteurs Adzuna et Jooble. Les extraits des moteurs sont complétés par l'annonce entière, revérifiés tous les 3 jours (offres fermées archivées), et fusionnés avec la page de l'employeur quand c'est la même annonce.
- **Tri fiable, en deux temps** :
  1. des **portes** déterministes : zone, contrat, expérience (années ou mots : « profil junior », « expérience significative »), intitulé proche du métier ; les formations ne sont pas des offres ;
  2. un **LLM** qui juge le poste réel en répondant à des questions factuelles ; le niveau (Coup de cœur, Solide, Tremplin, Écartée) en découle par une règle fixe. Une exclusion cite l'offre mot pour mot, les faits affichés (expérience, contrat, salaire) sont vérifiés dans le texte, et une raison qui invente le métier (« monteur vidéo » pour un monteur de vélos) est détectée.
- **Offres** : sélection expliquée, offres écartées avec leur raison, et dans le détail « Ce que l'annonce ne dit pas » (republiée, en ligne depuis longtemps, compétences seulement souhaitées) et un kit de candidature (message au recruteur, lettre).
- **Mon marché** : ce que demandent vraiment les offres du métier, compté par des règles dans les textes complets, jamais estimé par l'IA. Les compétences les plus citées face au CV (« 9/12 »), l'expérience réellement demandée, les salaires affichés, les contrats, le télétravail, qui recrute, et l'évolution semaine après semaine. Carte publique partageable.
- **Mon CV** : test ATS sur 100 selon une grille transparente, lecture recruteur, lignes à renforcer, comparaison à une offre.
- **Suivi** : kanban des candidatures, relances, préparation d'entretien.
- **Email quotidien** des coups de cœur, **offres trouvées ailleurs** ajoutées par lien ou texte, **espace admin** (santé des sources, utilisateurs et dernière visite, chiffres agrégés).

## Fiabilité

Tout ce que Scout affiche doit pouvoir être vérifié dans les offres elles-mêmes.

- **Jamais d'information inventée** : chaque fait vient d'un détecteur déterministe ou d'une citation de l'offre vérifiée mot pour mot. Sans source, Scout ne dit rien.
- **Un chiffre de marché est un comptage** : une même annonce compte une fois, seuls les textes complets comptent, les salaires sont bruts et sans gratification de stage, « dans ton CV » veut dire écrit mot pour mot dans le CV, et une évolution n'est montrée qu'entre deux photos comptées de la même façon.
- **Les mêmes règles pour tous les métiers** : une suite de tests rejoue des profils fictifs (monteur vidéo, graphiste, product manager, développeur, infirmier, comptable, commercial) sur leurs pièges : homonymes, intitulés partiels, abréviations, formations, outils du CV. Chaque piège rencontré y est ajouté.
- **Mesurée, pas supposée** : chacun peut signaler une information fausse dans une offre, et l'admin contrôle le tri au hasard, offre par offre, avec le taux d'accord. Un petit marché le dit, chiffres à l'appui.
- **Si l'IA est indisponible**, Scout le dit et réessaie, jamais de résultat approximatif. Le mode simulé du LLM sert uniquement aux tests.

## Architecture

```
GitHub Actions (3 fois par jour) ──► collecte ──► tri ──► marché ──► email ──► démo
   ATS · sites carrière · moteurs        │
                                         ▼
                              Supabase Postgres  ◄──  Next.js sur Vercel (Paris)
                     offres, entreprises (partagées)    tri à la demande après un
                     profils, scores, suivi (RLS)       changement de recherche
```

| Dossier | Rôle |
|---|---|
| `src/lib/collect` | Connecteurs, normalisation, dédoublonnage, complétion et revérification des offres |
| `src/lib/domain` | Critères (zod), géographie, détecteurs (contrat, expérience, salaire, télétravail) |
| `src/lib/scoring` | Portes, pertinence des intitulés, jugement LLM, garde-fous après le jugement |
| `src/lib/market` | Comptage du marché, photos quotidiennes, conseils construits à partir des chiffres |
| `src/lib/cv` | Grille ATS et lecture recruteur |
| `src/lib/llm` | Fournisseur (Mistral), file d'attente au rythme du plan gratuit |
| `src/lib/privacy` | Retrait des données personnelles avant tout appel au LLM |
| `supabase/migrations` | Schéma, index et politiques row-level security |
| `tests` | Tests unitaires, non-régression multi-métiers, comptage du marché |

Choix notables :
- **Gratuit à 100 %** : Vercel Hobby, Supabase Free, Mistral (plan gratuit), GitHub Actions (repo public), logo.dev, Gmail pour les emails.
- **Tri en tranches de moins de 52 s**, pour tenir dans la limite Vercel Hobby ; après une collecte, le robot trie pour tout le monde.
- **Logs de collecte agrégés par source**, sans aucune donnée d'utilisateur : le repo et ses logs CI sont publics.

## Installation

```bash
npm install
cp .env.local.example .env.local   # puis remplir, voir ci-dessous
npm run db:migrate                 # applique supabase/migrations
npm run dev
```

**Supabase**
- Crée un projet (région Paris).
- Récupère l'URL, la clé publique et la clé secrète dans *Project Settings → API Keys*.
- Récupère l'URI du *Session pooler* pour `SUPABASE_DB_URL` : elle sert uniquement en local, pour les migrations.
- Dans *Authentication → URL Configuration*, ajoute `http://localhost:3000/**` et l'URL Vercel aux Redirect URLs.
- Pour le code par email, configure un SMTP personnalisé (Gmail et mot de passe d'application).

**Google OAuth**
- Dans Google Cloud Console, crée un client « Web application ».
- Origine : `http://localhost:3000`, plus l'URL Vercel.
- Redirect URI : `https://<ref-projet>.supabase.co/auth/v1/callback`.
- Colle l'ID et le secret dans Supabase, sous *Authentication → Providers → Google*.

**Mistral**
- Clé API du plan gratuit ; désactive « Anonymous improvement data » dans *Admin → Privacy*.
- Le plan gratuit ne sert que les modèles `ministral` : Scout utilise `ministral-14b-2512`.

**Autres variables** (voir `.env.local.example`)
- `ADMIN_EMAIL` : l'adresse qui accède à la page Admin. `INVITED_EMAILS` et `OPEN_SIGNUP_LIMIT` (10 par défaut) règlent qui peut entrer.
- `ADZUNA_APP_ID`, `ADZUNA_APP_KEY`, `JOOBLE_API_KEY` : moteurs de recherche (clés gratuites).
- `GITHUB_DISPATCH_TOKEN` : jeton limité à ce repo (« Actions: write ») pour lancer une collecte depuis le site.
- `GMAIL_USER`, `GMAIL_APP_PASSWORD` : email quotidien et alertes.
- Les mêmes clés vont dans Vercel et dans les secrets GitHub ; jamais dans le code.

## Scripts

| Commande | Effet |
|---|---|
| `npm run collect` | Une passe de collecte complète (comptes agrégés en sortie) |
| `npm run discover` | Agrandit l'annuaire de pages carrière |
| `npm run score:all` | Trie les nouvelles offres pour chaque profil |
| `npm run market` | Calcule la photo du jour du marché de chaque profil |
| `npm run digest` | Envoie l'email des coups de cœur |
| `npm run demo:seed` | Prépare le profil de démonstration |
| `npm run alert` | Prévient l'admin par email quand le robot échoue |
| `npm run brand` | Régénère le logo, les icônes et l'image de partage |
| `npm run dry-run` | Collecte réelle et portes en mémoire, sans base, pour contrôler la qualité |
| `npm test` | Tests unitaires et de non-régression (sans réseau ni LLM) |
| `npm run test:llm` | Cas complets avec prompts (nécessite `MISTRAL_API_KEY`) |

## Confidentialité

- **Le CV n'est pas conservé.** Il est lu dans le navigateur ; avant toute analyse, son texte est débarrassé du nom, de l'email, du téléphone, des liens et de l'adresse. Seuls un résumé, la liste des compétences qu'il cite et les analyses sont gardés, et chacun peut les supprimer.
- **Les données privées sont isolées par la base elle-même** (row-level security) : profil, scores, actions et suivi.
- **Les clés** sont uniquement en variables d'environnement ; chaque commit est vérifié avec gitleaks. Aucune donnée personnelle dans le code, les tests ou les logs.
