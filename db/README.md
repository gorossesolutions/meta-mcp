# Base de données — Neon Postgres

Schéma de persistance pour meta-ads-mcp : un seul projet Neon, une seule base, cloisonnement par `client_id`. Ce dossier ne contient que le schéma (migrations SQL + runner) — le job de synchronisation qui remplit ces tables, le transport HTTP et le frontend sont des chantiers séparés (voir `docs/AUDIT.md`).

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

`db/migrations/0008_rls.sql` crée un rôle `svc_sync` **sans mot de passe** (jamais de secret en clair dans un fichier commité). Avant que le futur job de sync puisse s'y connecter :

```sql
-- Dans la console SQL Neon, PAS dans un fichier du repo :
ALTER ROLE svc_sync WITH PASSWORD 'un-mot-de-passe-fort-genere';
```

Construis ensuite `DATABASE_URL_SYNC` avec ce mot de passe et ajoute-le à `.env` (jamais commité, `.gitignore` le protège déjà).

## Relations (diagramme textuel)

```
clients (partitionnement racine)
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
| **owner** (celui qui fait tourner les migrations, ex. `neondb_owner`) | Total, sans restriction RLS | Propriétaire des tables — Postgres exempte le propriétaire des policies RLS par défaut, et ce schéma ne force pas `FORCE ROW LEVEL SECURITY`. À garder aussi précieusement qu'un identifiant superuser. |
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
