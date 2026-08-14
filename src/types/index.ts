// Shared domain types for the Meta Marketing API wrapper and MCP tools.

export interface ClientAccountConfig {
  client_id: string;
  ad_account_id: string;
  access_token_env_var: string;
  label?: string;
}

export interface AccountsConfig {
  clients: ClientAccountConfig[];
}

/** Resolved credentials used to call the Graph API for a given request. */
export interface ResolvedCredentials {
  accessToken: string;
  /** act_XXXXXXXXXX, when resolved from a client_id */
  adAccountId?: string;
  clientId?: string;
}

export interface MetaApiErrorPayload {
  message: string;
  type?: string;
  code?: number;
  error_subcode?: number;
  fbtrace_id?: string;
  error_user_title?: string;
  error_user_msg?: string;
}

export interface GraphApiPaging {
  cursors?: { before?: string; after?: string };
  next?: string;
  previous?: string;
}

export interface GraphApiListResponse<T> {
  data: T[];
  paging?: GraphApiPaging;
}
