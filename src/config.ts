import fs from "fs";
import path from "path";

export interface MogConfig {
  "user.name"?: string;
  "user.email"?: string;
}

export interface GitIdentity {
  name: string;
  email: string;
}

function getConfigPath(): string {
  return path.join(process.env.HOME || "~", ".mog", "config.json");
}

function getRepoConfigPath(repo: string): string {
  return path.join(process.env.HOME || "~", ".mog", "repos", repo, "config.json");
}

export function loadConfig(): MogConfig {
  const configPath = getConfigPath();
  try {
    const raw = fs.readFileSync(configPath, "utf-8");
    return JSON.parse(raw) as MogConfig;
  } catch {
    return {};
  }
}

export function saveConfig(config: MogConfig): void {
  const configPath = getConfigPath();
  const dir = path.dirname(configPath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
}

export function loadRepoConfig(repo: string): MogConfig {
  const configPath = getRepoConfigPath(repo);
  try {
    const raw = fs.readFileSync(configPath, "utf-8");
    return JSON.parse(raw) as MogConfig;
  } catch {
    return {};
  }
}

export function saveRepoConfig(repo: string, config: MogConfig): void {
  const configPath = getRepoConfigPath(repo);
  const dir = path.dirname(configPath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
}

export function detectHostGitIdentity(): GitIdentity | null {
  const nameResult = Bun.spawnSync(["git", "config", "user.name"]);
  const emailResult = Bun.spawnSync(["git", "config", "user.email"]);

  const name = nameResult.exitCode === 0 ? nameResult.stdout.toString().trim() : "";
  const email = emailResult.exitCode === 0 ? emailResult.stdout.toString().trim() : "";

  if (name && email) {
    return { name, email };
  }

  return null;
}

function identityFromConfig(config: MogConfig): GitIdentity | null {
  const name = config["user.name"];
  const email = config["user.email"];
  if (name && email) {
    return { name, email };
  }
  return null;
}

export function getGitIdentity(repo?: string): GitIdentity | null {
  // 1. Per-repo mog config (explicit override)
  if (repo) {
    const repoIdentity = identityFromConfig(loadRepoConfig(repo));
    if (repoIdentity) return repoIdentity;
  }

  // 2. Host git config (auto-detected from cwd)
  const hostIdentity = detectHostGitIdentity();
  if (hostIdentity) return hostIdentity;

  // 3. Global mog config (fallback)
  return identityFromConfig(loadConfig());
}
