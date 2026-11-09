// Downloads a pinned Pandoc build into src-tauri/resources/pandoc/ so it ships
// inside the installer (the converter then works offline with zero setup).
// Usage: npm run fetch:pandoc   (idempotent — skips if the binary is present)
import { existsSync, mkdirSync, writeFileSync, rmSync, readdirSync, renameSync, statSync, chmodSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";

const VERSION = "3.13";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dest = join(root, "src-tauri", "resources", "pandoc");
const exe = process.platform === "win32" ? "pandoc.exe" : "pandoc";

if (existsSync(join(dest, exe))) {
  console.log(`pandoc already present in ${dest}`);
  process.exit(0);
}

const asset =
  process.platform === "win32"
    ? `pandoc-${VERSION}-windows-x86_64.zip`
    : process.platform === "darwin"
      ? `pandoc-${VERSION}-${process.arch === "arm64" ? "arm64" : "x86_64"}-macOS.zip`
      : `pandoc-${VERSION}-linux-${process.arch === "arm64" ? "arm64" : "amd64"}.tar.gz`;
const url = `https://github.com/jgm/pandoc/releases/download/${VERSION}/${asset}`;

console.log(`Downloading ${url}`);
const res = await fetch(url);
if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`);
const work = join(tmpdir(), `devomni-pandoc-${Date.now()}`);
mkdirSync(work, { recursive: true });
const archive = join(work, asset);
writeFileSync(archive, Buffer.from(await res.arrayBuffer()));

// bsdtar (bundled with Windows 10+, macOS and Linux) extracts both zip and tar.gz.
execFileSync("tar", ["-xf", archive, "-C", work], { stdio: "inherit" });

const find = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      const hit = find(p);
      if (hit) return hit;
    } else if (name === exe) return p;
  }
  return null;
};
const bin = find(work);
if (!bin) throw new Error(`${exe} not found in ${asset}`);
mkdirSync(dest, { recursive: true });
renameSync(bin, join(dest, exe));
if (process.platform !== "win32") chmodSync(join(dest, exe), 0o755);
rmSync(work, { recursive: true, force: true });
console.log(`pandoc ${VERSION} -> ${join(dest, exe)}`);
