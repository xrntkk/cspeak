#!/usr/bin/env node
// Sync project version with the git tag before CI builds release artifacts.
// Usage: node .github/scripts/bump-version.js <version>
// Example: node .github/scripts/bump-version.js 0.1.2

const fs = require("fs");
const path = require("path");

const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+/.test(version)) {
  console.error("Usage: node bump-version.js <semver>");
  process.exit(1);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
}

const root = process.cwd();

const packageJsonPath = path.join(root, "package.json");
const packageJson = readJson(packageJsonPath);
packageJson.version = version;
writeJson(packageJsonPath, packageJson);

const cargoTomlPath = path.join(root, "src-tauri", "Cargo.toml");
let cargoToml = fs.readFileSync(cargoTomlPath, "utf8");
cargoToml = cargoToml.replace(
  /^(version\s*=\s*")[^"]+(")/m,
  `$1${version}$2`,
);
fs.writeFileSync(cargoTomlPath, cargoToml);

const tauriConfPath = path.join(root, "src-tauri", "tauri.conf.json");
const tauriConf = readJson(tauriConfPath);
tauriConf.version = version;
writeJson(tauriConfPath, tauriConf);

console.log(`Version synced to ${version}`);
