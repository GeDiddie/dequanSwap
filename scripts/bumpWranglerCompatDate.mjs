import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(new URL("..", import.meta.url).pathname);
const wranglerTomlPath = path.join(repoRoot, "wrangler.toml");

function todayUtcYmd() {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

const today = todayUtcYmd();

let toml = "";
if (fs.existsSync(wranglerTomlPath)) {
  toml = fs.readFileSync(wranglerTomlPath, "utf8");
}

const line = `compatibility_date = "${today}"`;

if (/^\s*compatibility_date\s*=\s*"\d{4}-\d{2}-\d{2}"\s*$/m.test(toml)) {
  toml = toml.replace(
    /^\s*compatibility_date\s*=\s*"\d{4}-\d{2}-\d{2}"\s*$/m,
    line,
  );
} else {
  const prefix = toml.trim().length ? toml.replace(/\s*$/, "\n") : "";
  toml = `${prefix}${line}\n`;
}

fs.writeFileSync(wranglerTomlPath, toml, "utf8");
console.log(`Updated wrangler.toml compatibility_date -> ${today}`);
