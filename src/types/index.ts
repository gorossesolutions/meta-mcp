// Shared domain types for the Meta Marketing API wrapper and MCP tools.
// Populated incrementally as each tool is implemented (see src/tools/).

export interface ClientAccountConfig {
  client_id: string;
  ad_account_id: string;
  access_token_env_var: string;
  label?: string;
}

export interface AccountsConfig {
  clients: ClientAccountConfig[];
}
