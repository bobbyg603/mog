import fs from "fs";
import path from "path";

export function parseMogIncludeFile(repoRoot: string): string[] {
  const mogIncludePath = path.join(repoRoot, ".moginclude");

  if (!fs.existsSync(mogIncludePath)) {
    return [];
  }

  const content = fs.readFileSync(mogIncludePath, "utf-8");
  return content
    .split("\n")
    .map(line => line.trim())
    .filter(line => line !== "" && !line.startsWith("#"))
    .map(line => path.resolve(repoRoot, line));
}

export function copyIncludeFiles(includeFiles: string[], repoRoot: string, worktreeDir: string): string[] {
  const copiedFiles: string[] = [];
  for (const filePath of includeFiles) {
    const relativePath = path.relative(repoRoot, filePath);
    const dest = path.join(worktreeDir, relativePath);
    const isDir = fs.statSync(filePath).isDirectory();
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    if (isDir) {
      fs.cpSync(filePath, dest, { recursive: true });
    } else {
      fs.copyFileSync(filePath, dest);
    }
    copiedFiles.push(dest);
  }
  return copiedFiles;
}

export function cleanupIncludeFiles(copiedFiles: string[], worktreeDir: string): void {
  for (const filePath of copiedFiles) {
    try {
      const isDir = fs.statSync(filePath).isDirectory();
      const relativePath = path.relative(worktreeDir, filePath);
      const gitRmArgs = ["git", "rm", "--cached", "--ignore-unmatch", ...(isDir ? ["-r"] : []), relativePath];
      Bun.spawnSync(gitRmArgs, { cwd: worktreeDir });
    } catch {
      // File/directory may already be gone
    }
  }
}
