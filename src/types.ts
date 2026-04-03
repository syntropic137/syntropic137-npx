/** CLI options parsed from argv. */
export interface CliOptions {
  command: "init" | "status" | "stop" | "start" | "logs" | "update" | "plugin" | "github-app" | "tunnel" | "cli" | "menu" | "help";
  org?: string;
  name?: string;
  dir?: string;
  skipGithub?: boolean;
  skipDocker?: boolean;
  webhookUrl?: string;
}

/** Values collected during the init flow and written to .env. */
export interface EnvValues {
  APP_ENVIRONMENT: string;
  SYN_VERSION: string;
  ANTHROPIC_API_KEY?: string;
  CLAUDE_CODE_OAUTH_TOKEN?: string;
  SYN_GITHUB_APP_ID?: string;
  SYN_GITHUB_APP_NAME?: string;
  SYN_GITHUB_APP_ORG?: string;
  SYN_GITHUB_WEBHOOK_SECRET?: string;
  SYN_GATEWAY_PORT?: string;
  MINIO_ROOT_USER?: string;
  [key: string]: string | undefined;
}

/** Result from the GitHub App Manifest flow. */
export interface ManifestResult {
  id: number;
  slug: string;
  pem: string;
  webhook_secret: string;
  client_id: string;
  client_secret: string;
  html_url: string;
}

/** GitHub App Manifest permissions. */
export interface AppPermissions {
  [key: string]: "read" | "write";
}
