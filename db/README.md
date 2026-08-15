# Base de données — Neon Postgres

Schéma de persistance pour meta-ads-mcp : un seul projet Neon, une seule base, cloisonnement par `client_id`. Ce dossier contient le schéma (migrations SQL + runner, `db/migrations/` + `db/migrate.ts`) et le job de synchronisation Meta → Neon (`db/sync/`) qui les remplit. Le transport HTTP et le frontend restent des chantiers séparés (voir `docs/AUDIT.md`).

## Setup

```bash
cp .env.example .env
# Renseigne DATABASE_URL avec la connection string OWNER de ton projet Neon
# (Neon console > ton projet > Connect > sélectionne le rôle owner, PAS le
# rôle "-pooler"/pooled — les migrations ont besoin d'une session persistante
# pour les transactions BEGIN/COMMIT).
npm install
npm run db:migrate
```

Le script applique les fichiers de `db/migrations/` dans l'ordre, dans une table `_migrations` qui garde trace de ce qui a déjà tourné — relancer `npm run db:migrate` après avoir ajouté un nouveau fichier n'applique que le nouveau.

### Étape manuelle obligatoire après la première migration

`db/migrations/0008_rls.sql` crée un rôle `svc_sync` **sans mot de passe** (jamais de secret en clair dans un fichier commité). Avant que le job de sync puisse s'y connecter :

```sql
-- Dans la console SQL Neon, PAS dans un fichier du repo :
ALTER ROLE svc_sync WITH PASSWORD 'un-mot-de-passe-fort-genere';
```

Construis ensuite `DATABASE_URL_SYNC` avec ce mot de passe et ajoute-le à `.env` (jamais commité, `.gitignore` le protège déjà). Le job refuse de démarrer tant que cette variable n'est pas configurée avec un rôle qui répond bien `svc_sync` à `SELECT current_user` — voir "Garde-fou svc_sync" ci-dessous.

## Job de synchronisation Meta → Neon (`db/sync/`)

```bash
npm run db:sync -- --client gr-adlab-main --days 7      # sync courante, 7 derniers jours
npm run db:sync -- --all --days 3                        # tous les clients actifs
npm run db:sync -- --client gr-adlab-main --dry-run       # aperçu, aucune écriture
npm run db:sync -- --client gr-adlab-main --since 2026-01-01 --until 2026-08-01 --backfill
npm run db:sync -- --client gr-adlab-main --breakdown age --days 30
```

### Architecture : pas de MCP ici

Ce job **n'utilise pas le protocole MCP**. Il importe directement les fonctions des tools de lecture (`src/tools/read/*.ts`) et le client HTTP partagé (`src/client/meta-api.ts`) — exactement comme `test/manual-check.ts` le fait déjà depuis l'Étape 1. Le MCP est un protocole pour qu'un client conversationnel (Claude) parle aux tools ; un job serveur qui tourne en CLI n'a aucun usage de cette indirection, qui n'ajouterait que de la latence et un point de panne de plus. Aucune logique n'a été dupliquée pour ça — la réutilisation était déjà possible parce que chaque tool de lecture exporte sa logique en fonction simple, séparée de son enregistrement MCP.

### Garde-fou svc_sync

`db/sync/guard.ts` exécute `SELECT current_user` juste après la connexion et refuse de continuer si la réponse n'est pas `svc_sync` — **avant** la moindre autre requête. Pas de flag pour désactiver ce contrôle. La raison : le rôle owner de Neon porte `BYPASSRLS` (voir "Modèle de sécurité" ci-dessus) — une connexion accidentelle avec `DATABASE_URL` au lieu de `DATABASE_URL_SYNC` contournerait le RLS intégralement, silencieusement. Vérifié en conditions réelles pendant cette session : pointer `DATABASE_URL_SYNC` vers la connection string owner fait échouer le job immédiatement avec un message explicite, jamais un contournement silencieux.

### Options

| Option | Effet |
|---|---|
| `--client <slug>` | Synchronise ce seul client (le `client_id` d'`accounts.config.json`) |
| `--all` | Synchronise tous les clients d'`accounts.config.json` dont le client Neon correspondant est actif (`clients.is_active`) — un nouveau client est actif par défaut à son premier bootstrap |
| `--days <N>` | Fenêtre d'insights = N derniers jours (défaut 7) |
| `--since` / `--until` | Fenêtre explicite `YYYY-MM-DD`, prioritaire sur `--days` |
| `--backfill` | Découpe la fenêtre en lots de 30 jours, un appel insights séquentiel par lot — voir "Rattrapage" ci-dessous |
| `--breakdown <dim>` | Une seule dimension de ventilation (`age`, `gender`, `publisher_platform`, `platform_position`, `impression_device`, `device_platform`, `region`, `country`). **Passer ce flag plusieurs fois est une erreur bloquante** — combiner des ventilations multiplie le nombre de lignes par leur produit cartésien, jamais autorisé depuis ce CLI |
| `--dry-run` | Affiche ce qui serait écrit, n'écrit rien — pas même une ligne `sync_runs` |

### Ce que fait chaque étape

0. **Bootstrap client** : upsert dans `clients` à partir de l'entrée `accounts.config.json` (clé de correspondance : `clients.config_client_id`, voir `db/migrations/0009_clients_config_bridge.sql`). Le job de sync est la seule chose qui crée des lignes `clients` — cohérent avec le RLS qui restreint déjà `INSERT` sur `clients` à `svc_sync`.
1. **Ouverture `sync_runs`** : une ligne `status='running'` est insérée **avant** le premier appel Meta, pas après — un crash en cours de route laisse une ligne visible "en cours", jamais rien du tout.
2. **`ad_accounts`** : devise, fuseau, portefeuille business.
3. **Snapshots** : campagnes → ad sets (par campagne) → ads (par ad set), upsertés dans `campaigns_snapshot`/`adsets_snapshot`/`ads_snapshot` avec la date du jour (UTC) comme `captured_date`. La phase d'apprentissage est normalisée ici (voir Conventions ci-dessus).
4. **Creatives** : liste complète du compte (`/adcreatives`), pas un appel par ad — bien plus efficace. **Limite de page abaissée à 50** (pas 500) : Meta rejette une page de 500 creatives avec `object_story_spec` inclus ("reduce the amount of data you're asking for"), confirmé en conditions réelles pendant cette session.
5. **`creative_angles`** : parsing optionnel du nom de l'ad (voir "Angles créatifs" ci-dessous). Ni écriture ni tentative sur les lignes déjà taguées manuellement.
6. **`insights_daily`** : un appel par ad, sur la fenêtre demandée (ou par lot si `--backfill`).
7. **Clôture `sync_runs`** : statut (`success`/`partial`/`failed`), `entities_processed`, `error_message`, `rate_limit_usage_peak_percent`.

### Isolation des erreurs

- **Par client** : une exception non rattrapée pendant le sync d'un client (ex. token expiré) est catchée au niveau de la boucle principale — les autres clients passés à `--all` se synchronisent quand même.
- **Par étape** : chaque étape (campagnes, ad sets par campagne, ads par ad set, creatives, insights) a son propre `try/catch`. Une erreur sur une étape n'empêche pas les étapes suivantes de tourner, et n'annule jamais ce qui a déjà été écrit — pas de rollback global. Le statut final est `partial` si au moins une étape a échoué mais que d'autres ont réussi, `failed` si même la récupération du compte publicitaire échoue (rien d'exploitable n'a pu être écrit), `success` sinon. Observé en conditions réelles pendant cette session : un vrai rate limit Meta (code 17) sur un appel `adsets_snapshot` a produit un run `partial` sans toucher aux données déjà écrites par les étapes précédentes.

### Rattrapage initial (`--backfill`)

La fenêtre demandée est découpée en lots de 30 jours, traités séquentiellement — un appel insights par lot et par ad, pas un seul appel géant. Reprenable après interruption **sans mécanisme de checkpoint dédié** : chaque upsert `insights_daily` est idempotent sur sa clé naturelle, donc relancer la même commande après un Ctrl+C ré-upserte sans risque les lots déjà faits (coût : quelques appels Meta redondants) et continue au-delà. Choix délibéré plus simple qu'un système de suivi de progression, suffisant tant que les fenêtres de rattrapage restent de l'ordre de quelques mois.

### Rate limits

Backoff réactif (déjà en place depuis l'Étape 1, `src/client/meta-api.ts`) **et** ralentissement proactif désormais : le header `X-Business-Use-Case-Usage` est lu après chaque appel ; au-delà de `META_RATE_LIMIT_THROTTLE_THRESHOLD_PERCENT` (80% par défaut), le job dort `META_RATE_LIMIT_THROTTLE_DELAY_MS` (3s par défaut) avant l'appel suivant, plutôt que d'attendre l'erreur. Le pic observé pendant le run est journalisé dans `sync_runs.rate_limit_usage_peak_percent`.

Point important observé en conditions réelles : ce header reste bas (4-6 % pendant les tests de cette session) même quand un **autre** mécanisme de rate limit Meta (la fréquence d'appels sur un compte publicitaire donné, erreur code 17) se déclenche. Les deux sont indépendants — le throttling proactif sur le header ne dispense pas du backoff réactif, qui reste la vraie protection contre ce second type de limite.

### Angles créatifs (`creative_angles`)

- **Invariant `first_seen_date`** : à chaque upsert d'une ligne parsée, la date retenue est la plus ancienne entre la propre date de lancement de l'ad courante et le minimum des `first_seen_date` déjà enregistrés pour ce même `angle_label` chez ce client (`db/sync/upserts.ts:upsertParsedCreativeAngle`, requête `LEAST(...)`). Un angle réutilisé sur une nouvelle ad ne fait donc jamais avancer sa date de première apparition.
- **Jamais d'écrasement d'une saisie manuelle** : la clause `ON CONFLICT ... WHERE creative_angles.source = 'parsed'` fait que la mise à jour est silencieusement ignorée si la ligne existante a `source = 'manual'` — appliqué au niveau SQL, pas seulement en logique applicative.
- **Parsing désactivable et paramétrable** : contrôlé par `AD_NAME_ANGLE_PATTERN` (regex avec groupes nommés `(?<category>...)`, `(?<label>...)`, `(?<hook>...)`, `(?<format>...)`). Vide par défaut = parsing désactivé, aucune convention codée en dur. Seul `label` est requis pour qu'une ligne soit créée ; si le pattern ne matche pas ou que `label` est absent, l'ad reste simplement non taguée, disponible pour une saisie manuelle future — jamais de catégorie inventée par défaut.

## Relations (diagramme textuel)

```
clients (partitionnement racine ; config_client_id = pont vers accounts.config.json, voir db/sync/)
 ├─ user_clients ──────────► qui (user Neon Auth) voit quel client
 ├─ ad_accounts ───────────► comptes Meta rattachés au client
 │   ├─ campaigns_snapshot ─► un enregistrement par jour de capture
 │   ├─ adsets_snapshot ────► idem, + phase d'apprentissage
 │   ├─ ads_snapshot ───────► idem
 │   ├─ creatives ──────────► assets créatifs (dimension, pas de snapshot quotidien)
 │   └─ insights_daily ─────► métriques journalières, la plus grosse table
 ├─ creative_angles ────────► tagging d'angle (ad/adset/campagne), fatigue par concept
 ├─ optimization_reports ───► un rapport par date d'analyse
 │   └─ optimization_actions ► recommandations normalisées extraites du rapport
 ├─ sync_runs ───────────────► journal des synchronisations
 └─ client_schedule_config ─► planification par client (1:1)

campaigns_latest / adsets_latest / ads_latest = vues "état le plus récent"
(DISTINCT ON sur les tables *_snapshot correspondantes)
```

Toutes les tables enfants portent `client_id` en dur (dénormalisé depuis `ad_accounts.client_id` ou `optimization_reports.client_id`), même quand il est dérivable via jointure — c'est un choix délibéré, voir "Modèle de sécurité" ci-dessous.

## Modèle de sécurité

RLS activé sur **toutes** les tables, sans exception. Trois rôles :

| Rôle | Accès | Comment |
|---|---|---|
| **owner** (celui qui fait tourner les migrations, ex. `neondb_owner`) | Total, RLS entièrement contourné | **Porte explicitement l'attribut `BYPASSRLS`** — confirmé dans la doc Neon, corrigé après une première version de ce document qui minimisait ça à "propriétaire exempté par défaut". Ce n'est pas une nuance : `BYPASSRLS` ignore le RLS même sur des tables où l'owner ne serait pas propriétaire, et surtout, ça veut dire qu'une connexion accidentelle avec `DATABASE_URL` (au lieu de `DATABASE_URL_SYNC`) contourne intégralement l'isolation par client, silencieusement, sans la moindre erreur. C'est précisément pour ça que `db/sync/guard.ts` vérifie `current_user` côté base avant de laisser tourner la moindre requête du job de sync — voir "Garde-fou svc_sync" ci-dessous. Cette connection string doit être gardée aussi précieusement qu'un identifiant superuser. |
| **svc_sync** | Lecture/écriture sur tous les clients, sans passer par `user_clients` | Rôle applicatif pour le futur job de sync côté serveur. Toutes les policies vérifient explicitement `current_user = 'svc_sync'` en OR — pas de `BYPASSRLS` utilisé (voir note ci-dessous). |
| **authenticated** | Lecture/écriture scoped par `user_clients`, via le JWT Neon Auth | Rôle attendu du Data API de Neon (PostgREST) pour un accès direct navigateur. |

**Pourquoi pas `BYPASSRLS` pour `svc_sync`** : accorder l'attribut `BYPASSRLS` à un rôle est en Postgres standard réservé aux superusers. Je n'ai pas pu vérifier si le rôle owner d'un projet Neon a ce privilège sur une instance managée — plutôt que de parier dessus dans une migration, chaque policy OR explicitement `current_user = 'svc_sync'`, ce qui fonctionne sans privilège élevé, sur n'importe quel hébergeur Postgres. Si tu confirmes que `BYPASSRLS` est accordable sur ton projet, c'est une simplification possible plus tard — pas faite ici par prudence.

**Hypothèse à vérifier avant de brancher le Data API** : le nom de rôle `authenticated` suit la convention Supabase/PostgREST, sur laquelle le Data API de Neon est modélisé. Je n'ai pas de confirmation ferme que Neon utilise exactement ce nom sur ton projet — à vérifier dans la doc Neon Data API au moment de câbler l'accès navigateur (phase UI, pas cette session), et à ajuster les `GRANT` de `0008_rls.sql` si besoin.

### Qui peut écrire quoi

| Table | Lecture (accès client) | Écriture |
|---|---|---|
| `clients`, `ad_accounts`, `*_snapshot`, `creatives`, `insights_daily`, `optimization_*`, `sync_runs`, `client_schedule_config` | `authenticated` + `svc_sync` | `svc_sync` uniquement |
| `creative_angles` | `authenticated` + `svc_sync` | **`authenticated` + `svc_sync`** — seule table où un utilisateur navigateur peut écrire directement (saisie manuelle d'angle prévue par la spec) |
| `user_clients` | `authenticated` (ses propres lignes uniquement) + `svc_sync` (tout) | `svc_sync` uniquement — **jamais** un utilisateur, même sur ses propres lignes, sinon n'importe quel compte authentifié pourrait s'auto-attribuer l'accès à n'importe quel client |

### Vérifier que les policies marchent en lecture ET en écriture

```sql
-- Se connecter en tant que svc_sync (après avoir défini son mot de passe) :
SET ROLE svc_sync;
INSERT INTO clients (name) VALUES ('Test RLS') RETURNING id; -- doit réussir
SELECT * FROM clients; -- doit tout voir

-- Simuler un utilisateur authentifié (sans compte Neon Auth réel, on force le claim) :
RESET ROLE;
SET ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"usr_test_sans_acces"}', true);
SELECT * FROM clients; -- doit ne RIEN retourner (aucune ligne dans user_clients pour cet id)
INSERT INTO clients (name) VALUES ('Devrait échouer'); -- doit échouer (policy WITH CHECK)
RESET ROLE;
```

Une fois qu'un client existe et qu'une ligne `user_clients` lui donne accès (créée par `svc_sync`), refaire le test avec le bon `sub` : le `SELECT` doit alors retourner ce client, et lui seul.

## Conventions

- **Montants monétaires** : toujours `bigint` en unité mineure (centimes), jamais `float`/`numeric` pour un montant, toujours une colonne `currency` (`CHECK (currency ~ '^[A-Z]{3}$')`) juste à côté. Ne jamais comparer deux montants sans vérifier que `currency` est identique.
- **Dates** : deux régimes distincts, volontairement différents.
  - `insights_daily.date` : `date` (pas `timestamptz`) — c'est une date calendaire dans le fuseau du **compte publicitaire** (`ad_accounts.timezone_name`), exactement comme Meta la retourne. Ne jamais la réinterpréter en UTC.
  - `*_snapshot.captured_date` : `date` aussi, mais c'est la date **UTC serveur** du run de sync — un concept différent (bookkeeping interne, pas une donnée Meta), qui n'a pas à suivre la règle de fuseau du compte.
  - Les horodatages techniques (`row_created_at`, `meta_created_time`, `meta_updated_time`, `learning_last_significant_edit`, etc.) sont tous `timestamptz` en UTC — ce sont de vrais instants, pas des dates calendaires.
- **Champs énumération venant de Meta** (`status`, `effective_status`, `objective`, `bid_strategy`, `billing_event`, `optimization_goal`, `learning_status_raw`, `quality_ranking`, `engagement_rate_ranking`, `conversion_rate_ranking`) : toujours `text` sans `CHECK`. Meta fait évoluer ces vocabulaires entre versions d'API ; une contrainte ici ferait échouer un sync sur une valeur qu'on n'a simplement jamais vue. À l'inverse, les champs énumération que **cette codebase** contrôle elle-même (`creative_angles.source`, `entity_type`, `sync_runs.status`) sont contraints par `CHECK` — ils ne peuvent jamais être cassés par un changement côté Meta.
- **`adsets_snapshot.learning_status_normalized`** : dérivé de `learning_status_raw` par le futur job de sync, volontairement non contraint lui non plus (un bug de normalisation ne doit pas non plus bloquer un sync). Mapping actuellement prévu (à ajuster une fois `LEARNING_LIMITED` confirmé ou infirmé en conditions réelles — voir `docs/AUDIT.md`) :
  - `LEARNING` → `learning`
  - `SUCCESS` → `success`
  - `FAIL` → `failed`
  - `NULL` (ad set pas en delivery active) → `not_delivering`
  - toute valeur inattendue → `unknown`
- **Idempotence** : chaque table de snapshot/métriques a une contrainte `UNIQUE` sur sa clé naturelle (compte + entité + date [+ ventilations pour `insights_daily`]). Le futur job de sync doit utiliser `INSERT ... ON CONFLICT (...) DO UPDATE` sur cette clé, jamais un `INSERT` nu.
- **`insights_daily` et les ventilations** : colonnes `breakdown_*` en `text NOT NULL DEFAULT ''` plutôt que nullable — Postgres traite deux `NULL` comme distincts dans une contrainte `UNIQUE`, ce qui aurait cassé l'upsert idempotent pour le cas le plus courant (aucune ventilation). `''` = "pas de ventilation sur cette dimension".

## Stratégie de rétention — `insights_daily`

C'est de loin la table qui grossira le plus (voir estimation de volume dans le résumé de session). Rien n'est implémenté dans cette session (pas de job planifié), mais la stratégie prévue :

- **Lignes sans aucune ventilation** (tous les `breakdown_*` = `''`) : ce sont celles dont dépendent les graphiques de tendance et le pipeline d'analyse. Conserver longtemps (24 mois, à revoir une fois le volume réel connu).
- **Lignes avec ventilation** (au moins un `breakdown_*` ≠ `''`) : utilisées surtout pour des questions de diagnostic court-terme ("quelle tranche d'âge sous-performe ce mois-ci"). Purger ou agréger plus agressivement (90 jours par défaut).
- **Risque combinatoire à surveiller** : demander plusieurs dimensions de ventilation à la fois pour chaque entité chaque jour multiplie le nombre de lignes par le produit cartésien des valeurs de dimension, pas par le nombre d'entités. Le sync quotidien de base ne devrait tirer aucune ou une seule dimension de ventilation ; les combinaisons plus riches doivent être tirées à la demande, pas planifiées.

## Reset complet (dev uniquement)

```sql
DROP TABLE IF EXISTS _migrations CASCADE;
-- puis DROP chaque table listée dans le diagramme ci-dessus, ou DROP SCHEMA public CASCADE; CREATE SCHEMA public;
```
Jamais à faire sur une base contenant des données clients réelles.
