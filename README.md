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

🚧 En cours de développement. Les 7 tools de lecture sont implémentés et testables via `npm run test:manual`. Les tools d'écriture (pause, budgets, création) arrivent ensuite.

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

Remplis `.env` avec tes identifiants Meta (voir tableau ci-dessous), puis déclare chaque client dans `accounts.config.json` (fichier ignoré par git — ne jamais le commiter s'il contient des tokens en clair).

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
| `list_ad_accounts` | Liste les comptes publicitaires accessibles |
| `get_campaigns` | Liste des campagnes (statut, objectif, budget) |
| `get_adsets` | Ad sets, avec résumé du targeting |
| `get_ads` | Ads, avec creative associé |
| `get_insights` | Métriques (impressions, reach, CTR, CPC, CPM, ROAS, conversions), filtres `date_range` et `breakdown` (âge, genre, placement, device) |
| `get_creatives` | Assets créatifs utilisés (image/vidéo, texte, hook) |
| `get_audience_estimate` | Taille d'audience estimée pour un targeting donné |

### Écriture (priorité 2)

| Tool | Description |
|---|---|
| `update_campaign_status` | Pause / resume / archive |
| `update_adset_budget` | Ajustement du budget quotidien / lifetime |
| `update_adset_bid` | Ajustement de la stratégie d'enchère |
| `create_campaign` | Création — toujours en statut `PAUSED` |
| `duplicate_campaign` / `duplicate_adset` | Duplication pour tests A/B |
| `update_targeting_exclusions` | Gestion des audiences d'exclusion |

**Règle de sécurité non négociable** : toute action qui modifie un budget de plus de `BUDGET_CHANGE_CONFIRMATION_THRESHOLD_PERCENT` (20% par défaut) ou qui active une campagne renvoie un objet de confirmation explicite avant exécution — jamais d'exécution silencieuse sur les actions à fort impact budgétaire.

## Gestion des erreurs et rate limits

Meta limite à 200 appels/heure/utilisateur. Le client HTTP (`src/client/meta-api.ts`) implémente un retry avec backoff exponentiel sur les erreurs `429` et les codes d'erreur Meta 17, 32 et 613 (rate limit). Les erreurs API Meta remontent au niveau MCP sous forme de message clair, jamais de stack trace brute.

## Tests manuels

```bash
npm run test:manual
```

Exécute chaque tool directement (hors transport MCP) et affiche le résultat, pour validation avant connexion à Claude Code en usage réel.

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
- [ ] Tools d'écriture + garde-fou de confirmation budgétaire
- [ ] Transport Streamable HTTP pour déploiement remote
- [ ] UI de pilotage (multi-comptes, plages de dates, sélection de métriques) — phase séparée, branchée sur ce MCP
