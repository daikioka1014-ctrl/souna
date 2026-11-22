
"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

function stop(message) {
  console.error(`[souna deploy] ${message}`);
  process.exit(1);
}

const required = ["TURNSTILE_SITE_KEY", "TURNSTILE_SECRET", "ADMIN_TOKEN"];

for (const name of required) {
  if (!process.env[name] || !process.env[name].trim()) {
    stop(`${name} がBuild variablesに設定されていません。`);
  }
}

const configPath = path.resolve(process.cwd(), "wrangler.jsonc");

if (!fs.existsSync(configPath)) {
  stop("wrangler.jsonc が見つかりません。");
}

let config;

try {
  config = JSON.parse(fs.readFileSync(configPath, "utf8"));
} catch (error) {
  stop("wrangler.jsonc の読み込みに失敗しました。");
}

if (config.name !== "souna") {
  stop('Worker名が "souna" ではありません。');
}

config.vars = {
  ...(config.vars || {}),
  TURNSTILE_SITE_KEY: process.env.TURNSTILE_SITE_KEY,
};

fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");

const secretFile = path.join(
  os.tmpdir(),
  `souna-secrets-${process.pid}.json`
);

try {
  fs.writeFileSync(
    secretFile,
    JSON.stringify({
      TURNSTILE_SECRET: process.env.TURNSTILE_SECRET,
      ADMIN_TOKEN: process.env.ADMIN_TOKEN,
    }),
    { encoding: "utf8", mode: 0o600 }
  );

  const result = spawnSync(
    "npx",
    ["wrangler", "deploy", "--secrets-file", secretFile],
    { stdio: "inherit", shell: false }
  );

  if (result.error) {
    stop("Wranglerの起動に失敗しました。");
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
} finally {
  try {
    fs.rmSync(secretFile, { force: true });
  } catch (_) {}
}
