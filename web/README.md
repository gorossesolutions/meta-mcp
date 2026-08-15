# Dashboard GR AdLab — Meta Ads

Interface web de consultation/navigation des données Meta Ads synchronisées dans Neon (`db/sync/`). React + Vite + TypeScript + Tailwind, lit et écrit directement via le **Neon Data API** (Postgres derrière RLS), sans backend applicatif intermédiaire.

Périmètre de cette version (Étape 5) : navigation à la Ads Manager + saisie manuelle des angles créatifs. Pas de vue "Rapports" — `optimization_reports` est vide jusqu'à l'étape 8, pas d'écran construit pour des données qui n'existent pas encore.

## Setup

```bash
cd web
cp .env.example .env
npm install
npm run dev
```

### Piège de l'URL Data API — lis ça avant de perdre du temps

**Correction post-test réel (deuxième correction, celle-ci confirmée par `curl` direct)** : deux erreurs successives dans cette note pendant la session de build. D'abord supposé que `VITE_NEON_DATA_API_URL` et `VITE_NEON_AUTH_URL` partagent la même URL courte — faux, ce sont deux URLs distinctes sur deux sous-domaines différents. Ensuite supposé qu'il fallait raccourcir l'URL du Data API (retirer `.apirest` et `/rest/v1`) — faux aussi : un test `curl` direct sur les deux formes montre que la forme raccourcie répond `"query is not supported"` sans header CORS (mauvais endpoint), alors que la forme **longue, telle qu'affichée dans la console**, répond correctement avec `access-control-allow-origin` et une vraie erreur PostgREST. **Coller les deux URLs exactement comme la console les affiche, sans rien retirer.**

**`VITE_NEON_DATA_API_URL`** — la console Neon (Data API → Connection details), utilisée **telle quelle** :

```
https://ep-xxx.apirest.us-east-1.aws.neon.tech/neondb/rest/v1
```

**`VITE_NEON_AUTH_URL`** — la console Neon (onglet **Auth**, pas Data API), sa **propre** URL, sur un sous-domaine différent (`.neonauth`, pas `.apirest`), avec un chemin `/auth` — aussi **telle quelle** :

```
https://ep-xxx.neonauth.us-east-1.aws.neon.tech/neondb/auth
```

Utiliser la même URL pour les deux variables échoue avec des erreurs CORS ("No 'Access-Control-Allow-Origin' header") sur les appels d'authentification — c'est le piège le plus probable si le sign up/sign in ne fonctionne pas alors que le reste du dashboard charge. Voir `.env.example` pour le détail complet.

Autre point de config Neon à ne pas oublier : ajouter l'origine du dashboard (`http://localhost:5173` en dev, l'URL Netlify en prod) aux **CORS Allowed Origins** du projet — sans ça, même les bonnes URLs échouent en CORS.

### Variables d'environnement

| Variable | Description |
|---|---|
| `VITE_NEON_DATA_API_URL` | URL longue "Data API → Connection details" de la console Neon, collée telle quelle (voir piège ci-dessus) |
| `VITE_NEON_AUTH_URL` | URL de l'onglet "Auth" de la console Neon, distincte de la précédente, collée telle quelle |

Ce sont les **deux seules** variables attendues, et elles sont publiques par conception (URL d'un endpoint protégé par RLS + token, pas un secret). Voir "Sécurité" ci-dessous.

## Sécurité

- **Aucun secret dans ce dossier, jamais** : ni chaîne de connexion Postgres (`DATABASE_URL`), ni token Meta, ni mot de passe `svc_sync`. Le Data API + Neon Auth sont conçus pour être appelés depuis un navigateur — l'isolation vient du RLS (`db/migrations/0008_rls.sql`, `0011`, `0012`), pas de la confidentialité de l'URL.
- `web/.gitignore` couvre explicitement `.env`/`.env.*` (le scaffold Vite par défaut ne couvrait que `*.local`, pas `.env` — corrigé). Le `.gitignore` racine du repo couvre aussi `web/node_modules`, `web/dist` et `web/.env` via ses patterns globaux.
- Seule `creative_angles` est écrite depuis le navigateur (rôle `authenticated`, policy `client_access_all`). Toutes les autres tables sont en lecture seule côté navigateur — écriture réservée à `svc_sync` (le job de sync). Testé en conditions réelles, voir résumé de session.

## Test RLS obligatoire

Un utilisateur connecté sans ligne dans `user_clients` doit voir une interface fonctionnelle mais strictement vide (`RootPage`, message "Aucun client ne vous est attribué"), jamais les données d'un autre client. Si des données apparaissent avant la création de ta propre ligne `user_clients`, c'est que le RLS ne s'applique pas — s'arrêter et le signaler, ne pas contourner.

## Conventions d'affichage (pièges déjà identifiés — voir `db/README.md`)

- **Montants** : toujours stockés en unité mineure entière (centimes) + devise à côté (`lib/money.ts`). `formatMoney(minorUnits, currency)` pour un montant, `formatMoneyByCurrency(...)` pour un total qui peut mélanger plusieurs devises — dans ce cas il affiche chaque devise séparément (`"12,30 € + 5,00 $"`), jamais un total unique faux. Ne jamais sommer des `minorUnits` sans vérifier la devise.
- **Dates** : `insights_daily.date` est une date calendaire dans le fuseau du **compte publicitaire**, pas un instant UTC — le pilote Postgres la renvoie comme un objet `Date` JS qui se sérialise en UTC, et `.toISOString()` dessus produirait un décalage d'un jour selon l'heure locale du navigateur. `lib/dates.ts:toDateOnlyString()` lit les champs UTC du `Date` directement (safe uniquement parce qu'une colonne `date` n'a pas d'heure à perdre) plutôt que de repasser par un fuseau. Ne jamais utiliser `new Date(...).toLocaleDateString()` sur cette colonne.
- **État courant** : toutes les pages de navigation lisent `campaigns_latest` / `adsets_latest` / `ads_latest` (vues `DISTINCT ON`), jamais les tables `*_snapshot` brutes — sinon on afficherait une ligne par jour de capture au lieu d'une ligne par entité.
- **Phase d'apprentissage** : `lib/learningPhase.ts` traite explicitement les 5 valeurs (`learning`, `success`, `failed`, `not_delivering`, `unknown`) avec un libellé dédié — `not_delivering` (le cas le plus fréquent actuellement) ne s'affiche jamais comme une erreur. La valeur brute Meta est toujours visible en infobulle sur le badge, pour repérer une valeur inattendue (ex. confirmer si `LEARNING_LIMITED` existe réellement).
- **Champs vides** : jamais de `null` brut ni de "erreur" à l'écran — un tiret (`—`) ou une mention neutre ("volume insuffisant" pour les classements de qualité `UNKNOWN`).
- **Conversions** : Meta n'a pas de champ canonique unique pour "les conversions" — `lib/metrics.ts` additionne un ensemble d'`action_type` courants (lead, purchase, complete_registration, submit_application, ...), affiché avec un astérisque et une note. Une approximation assumée, pas une vérité — voir "Ce qui manque" dans le résumé de session.

## Structure

```
web/src/
  lib/            money.ts, dates.ts, learningPhase.ts, metrics.ts, neon.ts
  types/db.ts     types des tables/vues lues (pas de génération auto — cohérent avec "pas d'ORM" côté db/)
  hooks/          usePeriod, useEntityMetrics, useFreshness, useAccessibleClients, useDarkMode
  components/     layout/ (AppShell, Breadcrumb, PeriodSelector, FreshnessBadge, EmptyState)
                  table/ (StatusBadge, LearningPhaseBadge, MetricsCells, LoadingTable)
                  auth/ (RequireAuth)
                  angles/ (AngleForm)
  pages/          RootPage, BusinessesPage, AccountsPage, CampaignsPage, AdsetsPage, AdsPage,
                  AdDetailPage, AnglesPage, AuthPage
```

## Déploiement Netlify

`netlify.toml` (dans ce dossier) : build depuis `web/`, publie `dist/`, redirection SPA pour que les routes React Router profondes (`/clients/:id/accounts/:id/...`) ne 404 pas au rechargement. Configurer le site Netlify avec **base directory = `web`**, puis ajouter `VITE_NEON_DATA_API_URL`/`VITE_NEON_AUTH_URL` dans les variables d'environnement du site (valeurs publiques, mais toujours définies par environnement plutôt que commitées en dur dans le code).

## Limites connues (volumes actuels : ~1 compte, 5 campagnes, 8 ad sets, 14 annonces)

- **Agrégation des métriques côté navigateur** : `useEntityMetrics`/`lib/metrics.ts` récupèrent les lignes `insights_daily` brutes pour la période et additionnent en JS. Tient largement à ce volume ; avec des centaines d'annonces ou des fenêtres longues, ça devrait devenir une agrégation SQL (vue ou RPC) plutôt que de faire transiter chaque ligne journalière au navigateur.
- **Pas de pagination** sur les listes (campagnes/ad sets/annonces/creatives/angles) — tout est chargé en un seul appel. Pareil : correct à ce volume, à revoir avant un compte avec beaucoup plus d'entités.
- **`get_ads`/`get_creatives` sans pagination côté sync** (hérité de l'Étape 3) se répercute ici : au-delà d'une page Meta, des entités resteraient invisibles dans le dashboard sans qu'aucune erreur ne le signale.
