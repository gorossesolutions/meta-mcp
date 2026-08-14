# Audit — État actuel vs vision cible

Date : 2026-08-15
Portée : audit en lecture seule du repo `meta-ads-mcp`, à l'instant où le serveur MCP self-hosted (14 tools, lecture + écriture) est fonctionnel et testé en conditions réelles, mais où aucune brique cloud, persistance ou UI n'a été commencée.

## 1. Résumé exécutif

Le serveur MCP lui-même (partie A de la vision) est solide et quasiment complet : 14 tools fonctionnels, multi-clients natif, garde-fou d'écriture strict, gestion d'erreurs propre, testé sur un vrai compte. Tout ce qui suit (B. cloud, C. Neon, D. pipeline autopilot, E. UI) est à **0%** — non commencé, ce qui est cohérent avec l'avancement réel du projet. Aucun choix d'architecture actuel ne bloque ou ne contredit la suite : le code est modulaire et transport-agnostic, donc le travail restant est additif, pas un refactor. Le point de blocage principal est simple : **rien n'est accessible en dehors de la machine locale de Guillaume** (pas de transport HTTP, pas de persistance), ce qui bloque mécaniquement tout ce qui vient après (autopilot, UI, Cowork).

## 2. Inventaire factuel

### Architecture générale

- **Langage / runtime** : TypeScript, Node.js ≥18 (`package.json:11`), compilé en ESM (`"type": "module"`)
- **Gestionnaire de paquets** : npm (`package-lock.json` présent et commité)
- **Structure des dossiers** : `src/{server.ts, client/{meta-api.ts, auth.ts}, config/accounts.ts, tools/{read,write}, types}`, `test/manual-check.ts`, `.github/workflows/ci.yml` — conforme à la structure prévue dès le scaffold initial
- **Version Graph API** : `v26.0`, définie comme constante par défaut (`DEFAULT_API_VERSION` dans `src/client/meta-api.ts:8`) mais **surchageable en variable d'env** `META_API_VERSION` — pas en dur de façon rigide
- **Transport MCP** : **stdio uniquement**. `src/server.ts` instancie `StdioServerTransport` et rien d'autre. Aucune trace de code HTTP/SSE.
- **Dépendances principales** : `@modelcontextprotocol/sdk` (SDK officiel), `zod` (validation des schémas d'input). Dev : `typescript`, `eslint`+`typescript-eslint`, `tsx` (exécution TS en dev). Aucune dépendance vers un SDK Meta officiel ni vers un SaaS tiers — appels `fetch` natifs uniquement (`src/client/meta-api.ts`).

### Les tools MCP (14, tous implémentés — aucun stub)

| Tool | Type | Endpoint(s) Meta appelé(s) |
|---|---|---|
| `list_ad_accounts` | Lecture | `GET /me/adaccounts` |
| `get_campaigns` | Lecture | `GET /{ad_account_id}/campaigns` |
| `get_adsets` | Lecture | `GET /{campaign_id ou ad_account_id}/adsets` |
| `get_ads` | Lecture | `GET /{adset_id/campaign_id/ad_account_id}/ads` |
| `get_insights` | Lecture | `GET /{object_id}/insights` |
| `get_creatives` | Lecture | `GET /{creative_id}`, `GET /{ad_id}`, ou `GET /{ad_account_id}/adcreatives` |
| `get_audience_estimate` | Lecture | `GET /{ad_account_id}/delivery_estimate` |
| `update_campaign_status` | Écriture | `GET` puis `POST /{campaign_id}` |
| `update_adset_budget` | Écriture | `GET` puis `POST /{adset_id}` |
| `update_adset_bid` | Écriture | `GET` puis `POST /{adset_id}` |
| `create_campaign` | Écriture | `POST /{ad_account_id}/campaigns` |
| `duplicate_campaign` | Écriture | `GET` puis `POST /{campaign_id}/copies` |
| `duplicate_adset` | Écriture | `GET` puis `POST /{adset_id}/copies` |
| `update_targeting_exclusions` | Écriture | `GET` puis `POST /{adset_id}` (targeting fusionné) |

Chaque tool accepte `client_id` (résolution via `accounts.config.json`) et/ou `account_id`/l'id d'objet directement — aucun compte en dur nulle part dans le code des tools.

### Données remontées

- **Campagne** (`src/tools/read/get-campaigns.ts:8`) : `id,name,status,effective_status,objective,daily_budget,lifetime_budget,budget_remaining,start_time,stop_time,created_time,updated_time`
- **Ad set** (`src/tools/read/get-adsets.ts:9`) : `id,name,status,effective_status,campaign_id,daily_budget,lifetime_budget,billing_event,optimization_goal,bid_amount,bid_strategy,targeting,start_time,end_time`
- **Ad** (`src/tools/read/get-ads.ts:9`) : `id,name,status,effective_status,adset_id,campaign_id,creative{id,name,thumbnail_url,body,title,image_url,video_id,object_story_spec}`
- **Creative** (`src/tools/read/get-creatives.ts:9`) : `id,name,status,body,title,image_url,video_id,thumbnail_url,call_to_action_type,object_story_spec,object_type` — **assets complets** (image/vidéo/thumbnail/texte/CTA)
- **Insights** (`src/tools/read/get-insights.ts:9`) : `date_start,date_stop,impressions,reach,frequency,clicks,ctr,cpc,cpm,spend,actions,action_values,purchase_roas` ; breakdowns supportés : `age, gender, publisher_platform, platform_position, impression_device, device_platform, region, country` ; fenêtres : presets relatifs (`today` → `maximum`) ou `since`/`until` custom

**Question spécifique — `learning_stage_info`** : **ABSENT**. Ce champ n'apparaît dans aucune des listes de champs ci-dessus (vérifié directement dans `get-adsets.ts:9`, seul endroit pertinent). Aucun statut LEARNING / LEARNING_LIMITED / SUCCESS n'est donc actuellement exposé par le MCP.

### Auth et secrets

- Token : **System User** (recommandé et utilisé en pratique — celui configuré dans `.env` local de Guillaume est un token System User Business Manager, sans expiration)
- Résolution : `src/client/auth.ts:resolveCredentials()` — via `client_id` → lookup dans `accounts.config.json` → token lu depuis la variable d'env pointée par `access_token_env_var`, avec fallback sur `META_ACCESS_TOKEN` global
- **Multi-comptes** : natif, pas mono-compte en dur. `accounts.config.json` liste `{client_id, ad_account_id, access_token_env_var, label}[]`, et chaque tool expose un paramètre `client_id` (voir `accountSelectorSchema` dans `src/tools/shared.ts`)
- **Secrets dans l'historique git** : vérifié via `git log -p --all -- .env` et `git log -p --all -- accounts.config.json` → **aucune trace**, ces fichiers n'ont jamais été trackés. `git log -p --all` grepé pour des patterns de token/secret en clair → **aucun résultat**. `.gitignore` couvre `.env`, `.env.*`, `accounts.config.json`. Le token System User réel a cependant été collé en clair dans la conversation Claude Code (jamais dans un fichier commité) — voir section Risques.

### Robustesse

- **Rate limits** : gestion **réactive** — retry avec backoff exponentiel (`src/client/meta-api.ts:66-87`, base 1s, ×2 par tentative, 5 tentatives max) déclenché sur HTTP 429 et les codes d'erreur Meta 4, 17, 32, 613. **Aucune lecture du header `X-Business-Use-Case-Usage`** — pas de gestion proactive/anticipative de la limite, uniquement réaction après coup.
- **Gestion d'erreurs** : propre. `MetaApiError` normalise chaque erreur Meta et privilégie `error_user_msg` (message utilisateur lisible) sur le `message` technique brut (`src/client/meta-api.ts:23-25`, corrigé durant cette session après un test réel qui a révélé que le message générique masquait l'info utile). Jamais de stack trace brute remontée au client MCP.
- **Tests** : `test/manual-check.ts` couvre les **7 tools de lecture uniquement**, exécutés contre l'API réelle. Les 7 tools d'écriture ont été validés manuellement au cours de cette session (appels JSON-RPC ad hoc, mode preview et un `confirm:true` réel), mais **aucun script de test n'existe pour eux dans le repo** — validation non répétable en l'état.

### Persistance

**Aucune.** Grep exhaustif sur `src/` pour tout pattern d'écriture disque/DB (`writeFile`, `pg`, `postgres`, `neon`, `sqlite`, `fs.write`) → zéro résultat. Le serveur est un pur passthrough : requête MCP → appel Graph API → réponse JSON renvoyée au client MCP. Rien n'est stocké nulle part, y compris `accounts.config.json` qui n'est lu qu'en local, jamais écrit par le serveur.

### Hygiène repo

- `.gitignore` : couvre `node_modules/`, `.env`, `.env.*` (avec exception `.env.example`), `dist/`, `*.log`, `accounts.config.json`, `.DS_Store` — complet et correct
- `README.md` : présent, à jour, couvre objectif/stack/setup complet (obtention token Meta pas à pas, tableau des variables d'env, liste des 14 tools, connexion Claude Code/Desktop, règle de sécurité du garde-fou)
- CI : `.github/workflows/ci.yml` — `npm install` → `build` → `lint` sur chaque push. Pas d'étape de test automatisé (cohérent avec l'absence de tests scriptés pour les tools d'écriture)
- Historique : 17 commits, tous atomiques et bien nommés (convention `feat/fix/docs/chore/ci/test`), aucun commit "gros paquet fourre-tout"

## 3. Tableau de comparaison

| # | Point cible | Statut | Justification |
|---|---|---|---|
| 1 | Serveur self-hosted, zéro dépendance SaaS tiers | **FAIT** | `fetch` natif direct vers Graph API, aucune lib Meta officielle ni SaaS intermédiaire (`src/client/meta-api.ts`) |
| 2 | Tools de lecture complets | **FAIT** | 7/7 présents et testés réel (`src/tools/read/*`) |
| 3 | Tools d'écriture complets | **FAIT** | 7/7 présents, testés réel en preview + 1 exécution confirmée (`src/tools/write/*`) |
| 4 | Garde-fou confirmation budget/activation | **FAIT** (dépasse la cible) | Le garde-fou couvre **toute** action d'écriture, pas seulement budget>seuil ou activation (`src/tools/shared.ts`, pattern preview/confirm) |
| 5 | Multi-clients via `client_id`, pas de compte en dur | **FAIT** | `accounts.config.json` + `client_id` sur chaque tool (`src/config/accounts.ts`, `src/client/auth.ts`) |
| 6 | Rate limits avec backoff exponentiel | **PARTIEL** | Backoff réactif sur erreurs/429 présent ; aucune lecture proactive du header `X-Business-Use-Case-Usage` (`src/client/meta-api.ts`) |
| 7 | Transport Streamable HTTP | **ABSENT** | Seul `StdioServerTransport` instancié (`src/server.ts`) |
| 8 | Couche d'auth sur endpoint MCP public | **ABSENT** | N'existe pas — dépend du point 7, jamais construit |
| 9 | Déployable sur hébergeur requêtes longues | **ABSENT** | Aucun Dockerfile, aucune config de déploiement dans le repo |
| 10 | Tokens chiffrés au repos | **ABSENT** | Seul stockage actuel = `.env` local en clair (non commité) ; aucun mécanisme de chiffrement dans le code |
| 11 | Base Neon Postgres + RLS | **ABSENT** | Zéro dépendance DB dans `package.json`, zéro code SQL |
| 12 | Tool `export_report` qui écrit en base | **ABSENT** | Aucun tool de ce type ; aucune écriture disque/DB nulle part |
| 13 | Tables cibles (comptes, snapshots, insights, rapports, planification) | **ABSENT** | Aucun schéma, aucune table |
| 14 | Table angles créatifs (fatigue par angle) | **ABSENT** | Aucune notion d'"angle créatif" dans le code ; `get_creatives` renvoie les assets bruts sans catégorisation |
| 15 | Séparation calcul déterministe / jugement LLM | **ABSENT** | Aucun code de calcul de delta/anomalie ; le MCP renvoie des données brutes, aucune couche d'analyse |
| 16 | Format JSON strict validé côté code | **ABSENT** | Pas de pipeline de rapport ; les réponses des tools sont du JSON libre non contraint par un schéma de sortie métier |
| 17 | Règles anti-sur-optimisation codées en dur | **ABSENT** | Rien n'empêche aujourd'hui de proposer une action sur un ad set en apprentissage — c'est un choix laissé à l'humain/au modèle appelant, pas une règle du serveur |
| 18 | Playbook expert versionné | **ABSENT** | Aucun fichier de playbook/skill dans le repo |
| 19 | Déclenchement planifié + manuel | **ABSENT** | Aucun scheduler ; le serveur ne s'exécute que sur invocation directe |
| 20 | Dashboard React/Vite/TS/Tailwind sur Netlify | **ABSENT** | Aucun code frontend dans le repo |
| 21 | Lecture Neon via Data API + Neon Auth + RLS | **ABSENT** | Dépend des points 11 et 20, aucun des deux n'existe |
| 22 | Navigation type Ads Manager | **ABSENT** | Pas d'UI |
| 23 | Colonne phase d'apprentissage + jours depuis lancement | **ABSENT** | Dépend du point 21 (learning_stage_info) et du point 20 (UI), aucun des deux n'existe |
| 24 | Vue Rapports par client/date avec export | **ABSENT** | Dépend des points 12-13 et 20 |
| 25 | Bouton déclenchement manuel snapshot | **ABSENT** | Dépend du point 20 |

**Aucun point classé CONTRADICTOIRE** : rien dans l'architecture actuelle ne va dans une direction qui bloquera la cible. Le code est modulaire (`client/` / `config/` / `tools/read/` / `tools/write/`) et le transport est déjà découplé de la logique des tools — ajouter HTTP plus tard ne touchera pas au code métier.

## 4. Écarts classés par criticité

### Bloquants (empêchent de passer à cloud + UI)

- **#7/#8 — Pas de transport HTTP ni de couche d'auth associée.** Tant que le serveur ne parle que stdio, rien d'externe (Cowork, claude.ai, une UI hébergée, un scheduler cloud) ne peut s'y connecter. C'est le prérequis technique commun à quasiment tout le reste de la vision (B, C, D, E en dépendent tous indirectement, puisqu'un pipeline autopilot planifié ou une UI distante ont besoin d'un serveur MCP joignable autrement qu'en process local).
- **#11-14 — Absence totale de persistance Neon.** Le pipeline autopilot (D) calcule des deltas vs période précédente — impossible sans historique stocké. L'UI (E) lit depuis Neon, pas depuis des appels Meta en direct. Sans base, ni D ni E ne peuvent démarrer, même si le reste était prêt.

### Structurels (à corriger maintenant, sinon refonte plus tard)

- **`learning_stage_info` absent de `get_adsets`.** Peu coûteux à ajouter aujourd'hui (un champ de plus dans `ADSET_FIELDS`, `src/tools/read/get-adsets.ts:9`) ; en revanche, le pipeline autopilot (règle anti-sur-optimisation #17) et l'UI (colonne phase d'apprentissage #23) en dépendent tous les deux directement. Le découvrir manquant au milieu du développement de D ou E forcera un aller-retour évitable.
- **Chiffrement des tokens au repos non anticipé.** Le modèle actuel (token en clair dans `.env` local) ne se transpose pas tel quel dès qu'un token doit être stocké côté serveur distant (pour du multi-device, un scheduler, ou simplement une base Neon qui référencerait des credentials). Pas un risque aujourd'hui (rien n'est déployé), mais le design du stockage credentials doit être pensé **avant** la migration cloud, pas pendant.
- **Cache de config mono-instance (`src/config/accounts.ts:7`).** Le cache module-level suppose un process court-vécu (une session stdio). En déploiement HTTP long-running, ajouter/modifier un client dans `accounts.config.json` n'aura aucun effet sans redémarrage du serveur — anodin aujourd'hui, à traiter explicitement lors du passage au transport HTTP (point B).

### Incréments (peuvent s'ajouter proprement plus tard, sans refonte)

- Lecture proactive du header `X-Business-Use-Case-Usage` (le backoff réactif actuel suffit tant que l'usage reste faible volume/solo)
- Tests automatisés scriptés pour les 7 tools d'écriture (aujourd'hui validés manuellement, pas de régression détectable automatiquement)
- L'ensemble du pipeline autopilot (D) et de l'UI (E) — tous deux naturellement postérieurs aux blocs Bloquants ci-dessus, aucune dépendance inverse identifiée

## 5. Risques et dettes

- **Token System User exposé en clair dans la conversation Claude Code** (jamais dans un fichier commité, vérifié). Si ce transcript est un jour exporté/partagé, le token qu'il contient reste valide jusqu'à révocation. Recommandation : le régénérer depuis Business Settings avant tout partage de cette conversation, par simple hygiène — ce n'est pas une fuite constatée dans le repo, seulement dans l'historique de chat.
- **Aucun chiffrement au repos nulle part** (cf. Structurel ci-dessus) — actuellement faible risque réel (rien n'est stocké à distance), mais deviendra un vrai sujet dès la première ligne de code touchant Neon.
- **Le garde-fou preview/confirm repose sur une discipline de l'appelant, pas sur une contrainte technique irréversible.** Rien n'empêche structurellement un futur orchestrateur (l'Autopilot) de passer `confirm: true` sans réelle validation humaine — ce n'est pas un défaut du MCP (il fait ce qu'on lui demande), mais une limite à garder en tête : la vraie garantie "jamais d'auto-confirm sur une hausse de budget" devra être appliquée et auditée côté code de l'orchestrateur, pas supposée acquise parce que le MCP expose un paramètre `confirm`.
- **Pas de rate-limiting propre au serveur MCP lui-même** — seule la réaction aux erreurs Meta existe. Si l'Autopilot programme des runs fréquents multi-clients en parallèle, il faudra probablement un rate-limiting/orchestration en amont du MCP, pas seulement compter sur le retry réactif actuel.

## 6. Séquence recommandée

1. **Combler les écarts structurels à faible coût maintenant** : ajouter `learning_stage_info` à `get_adsets`, éventuellement scripter un test manuel minimal pour les tools d'écriture. Coût faible aujourd'hui, coût croissant plus tard si oublié pendant le dev de D/E.
2. **Transport HTTP + couche d'auth (#7, #8)** en premier bloc lourd : c'est le prérequis technique commun à tout ce qui suit — sans lui, ni la persistance distante ni l'UI ne sont joignables depuis l'extérieur de la machine locale. Traiter le cache de config mono-instance à ce moment-là, puisque c'est précisément ce changement qui le rend problématique.
3. **Persistance Neon (#11-14)** ensuite : nécessaire avant tout calcul de delta (le pipeline D ne peut pas comparer à une période précédente sans historique stocké), et c'est la fondation que l'UI (E) lira. Penser le chiffrement des credentials à ce stade, pas après coup.
4. **Pipeline autopilot (#15-19)** : dépend directement des données désormais stockées en 3. C'est là que les règles anti-sur-optimisation prennent tout leur sens, une fois `learning_stage_info` déjà disponible depuis l'étape 1.
5. **UI (#20-25)** en dernier : elle ne fait que lire ce que 2, 3 et 4 auront déjà rendu disponible (Neon Data API + Auth ne peuvent exposer que des données qui existent).

Cet ordre suit la chaîne de dépendances réelle du projet, pas un ordre arbitraire de priorité produit — chaque étape est un prérequis technique dur de la suivante.
