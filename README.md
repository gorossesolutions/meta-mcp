# Meta Ads MCP

Serveur [MCP](https://modelcontextprotocol.io) self-hosted qui expose l'API Meta Marketing (Facebook/Instagram Ads) à Claude, pour analyser et piloter des comptes publicitaires clients directement depuis Claude Code / Claude Desktop.

## Objectif

- **Analyser** des comptes clients : insights, campagnes, ad sets, ads, creatives, audiences
- **Agir** dessus : pause/resume, ajustement de budgets, création de campagnes (toujours en `PAUSED` par défaut)
- **Multi-comptes** : une base réutilisable pour plusieurs clients, un token par client

Pas de dépendance à un SaaS tiers (type Pipeboard) : le code appelle directement la Graph API Marketing de Meta via `fetch` natif, et reste 100% self-hosted.

## Stack

- TypeScript / Node.js 18+
- [`@modelcontextprotocol/sdk`](https://www.npmjs.com/package/@modelcontextprotocol/sdk) (SDK officiel Anthropic)
- Appels REST directs à la Graph API Marketing (`v26.0` par défaut, configurable via `META_API_VERSION`)
- Transport MCP : stdio pour le dev local (Claude Code / Claude Desktop). Le code est structuré pour ajouter un transport Streamable HTTP plus tard, en vue d'un déploiement remote (Cloud Run ou équivalent).

## État du projet

🚧 En cours de développement. Les 14 tools (7 lecture + 7 écriture) sont implémentés. Les tools de lecture sont testables via `npm run test:manual` ; les tools d'écriture ont été validés en mode preview contre un vrai compte (aucune mutation réelle testée en dehors d'une confirmation explicite de l'utilisateur).

## Structure du projet

```
meta-ads-mcp/
  src/
    server.ts          # point d'entrée MCP
    client/
      meta-api.ts       # wrapper HTTP vers la Graph API Marketing
      auth.ts            # gestion des tokens (long-lived / System User)
    tools/
      read/               # tools de lecture (insights, campagnes, ...)
      write/              # tools d'écriture (pause, budgets, création, ...)
    config/
      accounts.ts         # mapping multi-comptes client -> ad_account_id/token
    types/
  test/
    manual-check.ts      # script de validation manuelle tool par tool
  .github/workflows/ci.yml
  .env.example
  accounts.config.json.example
  .mcp.json.example
```

## Setup

### 1. Prérequis

- Node.js 18+
- Un compte développeur Meta (developers.facebook.com) avec une app configurée pour la Marketing API
- Accès à un Business Manager Meta

### 2. Installation

```bash
npm install
npm run build
```

### 3. Obtenir un token Meta

1. Crée une app sur [developers.facebook.com](https://developers.facebook.com/) et récupère `META_APP_ID` / `META_APP_SECRET`.
2. Génère un access token utilisateur avec les permissions `ads_read`, `ads_management`, `business_management` via l'[Explorateur d'API Graph](https://developers.facebook.com/tools/explorer/) ou le flow OAuth complet.
3. Échange ce token contre un **long-lived token** (~60 jours) :
   ```
   GET /oauth/access_token
     ?grant_type=fb_exchange_token
     &client_id={META_APP_ID}
     &client_secret={META_APP_SECRET}
     &fb_exchange_token={SHORT_LIVED_TOKEN}
   ```
4. **Recommandé pour la prod** : crée un **System User** dans le Business Manager (Paramètres de l'entreprise > Utilisateurs > Utilisateurs système), assigne-lui les comptes publicitaires nécessaires, et génère un token System User — il n'expire pas et évite la gestion de renouvellement.

### 4. Configuration

```bash
cp .env.example .env
cp accounts.config.json.example accounts.config.json
```

Remplis `.env` avec tes identifiants Meta (voir tableau ci-dessous), puis déclare chaque client dans `accounts.config.json` (fichier ignoré par git — ne jamais le commiter s'il contient des tokens en clair). Ce fichier est mis en cache 30s en mémoire (`src/config/accounts.ts`) : ajouter un client n'exige pas de redémarrer le serveur, juste d'attendre jusqu'à 30s.

| Variable | Description |
|---|---|
| `META_APP_ID` | ID de l'app Meta |
| `META_APP_SECRET` | Secret de l'app Meta |
| `META_ACCESS_TOKEN` | Token long-lived ou System User par défaut |
| `META_BUSINESS_ID` | ID du Business Manager |
| `META_API_VERSION` | Version de la Graph API à cibler (défaut `v26.0`) |
| `ACCOUNTS_CONFIG_PATH` | Chemin vers le fichier de mapping multi-comptes |
| `BUDGET_CHANGE_CONFIRMATION_THRESHOLD_PERCENT` | Seuil (%) au-delà duquel un changement de budget doit être confirmé explicitement avant exécution |

### 5. Connexion à Claude Code / Claude Desktop

Copie `.mcp.json.example` vers `.mcp.json` à la racine du projet (ou dans la config Claude Desktop équivalente) et adapte les variables d'environnement :

```bash
cp .mcp.json.example .mcp.json
```

Claude Code détecte automatiquement `.mcp.json` à la racine du repo. Pour Claude Desktop, ajoute la même entrée dans `claude_desktop_config.json` sous `mcpServers`.

## Tools MCP disponibles

### Lecture (priorité 1)

| Tool | Description |
|---|---|
| `list_ad_accounts` | Liste les comptes publicitaires accessibles, avec le portefeuille business propriétaire (`business.id`/`business.name`), la devise et le fuseau horaire |
| `get_campaigns` | Liste des campagnes (statut, objectif, budget, `created_time`/`updated_time`) |
| `get_adsets` | Ad sets, avec résumé du targeting, `created_time`/`updated_time`, et `learning_phase` (phase d'apprentissage) |
| `get_ads` | Ads, avec creative associé et `created_time`/`updated_time` |
| `get_insights` | Métriques (impressions, reach, CTR, CPC, CPM, ROAS, conversions, `inline_link_clicks`, `cost_per_action_type`), filtres `date_range` et `breakdown` (âge, genre, placement, device). Avec `level: "ad"`, inclut aussi les diagnostics de pertinence Meta (`quality_ranking`, `engagement_rate_ranking`, `conversion_rate_ranking`) |
| `get_creatives` | Assets créatifs utilisés (image/vidéo, texte, hook) |
| `get_audience_estimate` | Taille d'audience estimée pour un targeting donné |

#### Champs pouvant revenir vides selon le volume/l'état du compte

- **`get_adsets.learning_phase`** (`status`, `conversions`, `last_significant_edit`) : Meta ne renseigne ces sous-champs que pendant que l'ad set **délivre activement** (`effective_status: ACTIVE`). Sur un ad set en pause (ou dont la campagne parente est en pause), ils reviennent à `null` — seul `attribution_windows` reste renseigné. `status` prend l'une des valeurs `LEARNING` / `SUCCESS` / `FAIL` d'après la documentation Meta v26.0 ; à date, ce repo n'a pas pu confirmer ces valeurs sur un ad set réellement en apprentissage (aucune campagne active sur le compte de test) — à vérifier dès qu'un client aura une campagne active.
- **`get_insights` (niveau `ad`) `.quality_ranking` / `.engagement_rate_ranking` / `.conversion_rate_ranking`** : reviennent à `"UNKNOWN"` en dessous d'environ 500 impressions sur l'ad — comportement confirmé en conditions réelles, ce n'est pas un bug du MCP.
- **Aucun champ Meta n'expose la part d'impressions sur audience nouvelle vs déjà exposée** (saturation d'audience) — recherché explicitement dans la référence Insights, non trouvé. Utiliser `frequency` comme proxy.

### Écriture (priorité 2)

| Tool | Description |
|---|---|
| `update_campaign_status` | Pause / resume / archive |
| `update_adset_budget` | Ajustement du budget quotidien / lifetime |
| `update_adset_bid` | Ajustement du montant ou de la stratégie d'enchère |
| `create_campaign` | Création — toujours en statut `PAUSED` |
| `duplicate_campaign` / `duplicate_adset` | Duplication pour tests A/B — la copie est toujours créée `PAUSED` |
| `update_targeting_exclusions` | Gestion des audiences/zones/intérêts d'exclusion |

**Règle de sécurité non négociable** : aucun tool d'écriture n'exécute quoi que ce soit au premier appel. Chaque tool suit un pattern **preview → confirm** :

1. Appelé sans `confirm: true`, il renvoie un aperçu structuré (`status: "preview_only"`) avec l'état actuel, le changement proposé, et — pour les budgets — le delta en % calculé automatiquement (avertissement si supérieur à `BUDGET_CHANGE_CONFIRMATION_THRESHOLD_PERCENT`, 20% par défaut). Aucun appel d'écriture n'est fait à la Graph API à ce stade.
2. Il faut un second appel explicite avec `confirm: true` pour que la mutation soit réellement exécutée.

Cette validation humaine systématique est non négociable, quel que soit le type ou l'ampleur de l'action. Elle est conçue pour rester compatible avec un futur mode **Autopilot** (UI séparée) : quand ce toggle sera actif, l'orchestrateur pourra passer `confirm: true` automatiquement pour les actions à faible risque, mais devra **toujours** exiger une confirmation explicite (modale) pour toute hausse de budget — cette exception ne peut pas être appliquée par le serveur MCP lui-même (il ne sait pas qui l'appelle), elle doit être respectée par la couche orchestratrice qui pilotera l'Autopilot.

## Gestion des erreurs et rate limits

Meta limite à 200 appels/heure/utilisateur. Le client HTTP (`src/client/meta-api.ts`) implémente un retry avec backoff exponentiel sur les erreurs `429` et les codes d'erreur Meta 17, 32 et 613 (rate limit). Les erreurs API Meta remontent au niveau MCP sous forme de message clair, jamais de stack trace brute.

## Tests manuels

```bash
npm run test:manual
```

Exécute chaque tool directement (hors transport MCP) et affiche le résultat, pour validation avant connexion à Claude Code en usage réel. Termine par un **rapport de disponibilité des champs** qui affiche explicitement ce qui revient `null`/`UNKNOWN`/`MISSING` sur le compte testé (phase d'apprentissage, diagnostics de pertinence) — c'est l'info utile pour savoir ce qui sera réellement exploitable par l'UI et l'analyste plus tard.

## Développement

```bash
npm run dev     # lance le serveur via tsx (hot reload TS)
npm run build   # compile vers dist/
npm run lint    # ESLint
npm start       # lance la version compilée
```

## Roadmap

- [x] Scaffold du repo, CI, structure du projet
- [x] Authentification Meta (résolution multi-comptes, long-lived token exchange, support System User)
- [x] Retry / backoff et gestion d'erreurs Meta (codes 17, 32, 613, HTTP 429)
- [x] Tools de lecture (7/7)
- [x] Tools d'écriture (7/7) + garde-fou preview/confirm systématique
- [x] Champs fondation pour l'UI/l'autopilot : `learning_phase`, timestamps ad set/ad, diagnostics de pertinence, `business` portfolio, cache config avec TTL (voir `docs/AUDIT.md`)
- [ ] Transport Streamable HTTP pour déploiement remote
- [ ] Persistance Neon (comptes, snapshots, insights journaliers, rapports, angles créatifs)
- [ ] Pipeline d'analyse autopilot (calcul déterministe, format JSON strict, règles anti-sur-optimisation, playbook versionné, planification)
- [ ] UI de pilotage (multi-comptes, plages de dates, sélection de métriques) — phase séparée, branchée sur ce MCP
