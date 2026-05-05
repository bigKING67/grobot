#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = process.cwd();
const semverPattern = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
const staleStartupDisplayConstant = ["STARTUP", "DISPLAY", "VERSION"].join("_");
const staleStartupLabel = ["0.10.0", " developed by 67"].join("");
const stalePortableVersionPrint = ['println!("grobot ', '0.1.0")'].join("");
const failures = [];

function readText(relativePath) {
  return readFileSync(resolve(repoRoot, relativePath), "utf8");
}

function fail(message) {
  failures.push(message);
}

function assertIncludes(relativePath, needle, message) {
  const content = readText(relativePath);
  if (!content.includes(needle)) {
    fail(`${relativePath}: ${message}`);
  }
}

function assertNotIncludes(relativePath, needle, message) {
  const content = readText(relativePath);
  if (content.includes(needle)) {
    fail(`${relativePath}: ${message}`);
  }
}

const packageJson = JSON.parse(readText("package.json"));
const packageVersion = String(packageJson.version ?? "");
if (!semverPattern.test(packageVersion)) {
  fail(`package.json: version must be SemVer x.y.z, got ${JSON.stringify(packageVersion)}`);
}

const cargoToml = readText("runtime/Cargo.toml");
const cargoVersion = cargoToml.match(/^version\s*=\s*"([^"]+)"/m)?.[1] ?? "";
if (cargoVersion !== packageVersion) {
  fail(`runtime/Cargo.toml: version ${JSON.stringify(cargoVersion)} must match package.json ${JSON.stringify(packageVersion)}`);
}

const bannerSource = readText("gateway/src/cli/start/startup/banner.ts");
if (bannerSource.includes(staleStartupDisplayConstant)) {
  fail(`gateway/src/cli/start/startup/banner.ts: startup version must use product identity instead of ${staleStartupDisplayConstant}`);
}
if (!bannerSource.includes("resolveCliVersionDisplay(process.env.GROBOT_VERSION)")) {
  fail("gateway/src/cli/start/startup/banner.ts: startup version must normalize GROBOT_VERSION through product identity");
}

assertIncludes(
  "gateway/src/cli/product-identity.ts",
  "CLI_PRODUCT_VERSION",
  "product identity must expose CLI_PRODUCT_VERSION",
);
assertIncludes(
  "gateway/src/cli/product-identity.ts",
  "CLI_PRODUCT_USER_AGENT = `grobot-cli/${CLI_PRODUCT_VERSION}`",
  "user agent must derive from CLI_PRODUCT_VERSION",
);

assertNotIncludes(
  "gateway/src/extensions/contracts/cli-ui-renderer-contract.ts",
  staleStartupLabel,
  "contract must not assert stale startup display version",
);
assertNotIncludes(
  "gateway/src/extensions/contracts/cli-ui-renderer-contract/fixtures.ts",
  staleStartupLabel,
  "fixture must not carry stale startup display version",
);
assertIncludes(
  "gateway/src/extensions/contracts/cli-ui-renderer-contract.ts",
  `Grobot ${packageVersion} developed by 67`,
  "contract must assert package-aligned startup display version",
);
assertIncludes(
  "gateway/src/extensions/contracts/cli-ui-renderer-contract/fixtures.ts",
  `Grobot ${packageVersion} developed by 67`,
  "fixture must use package-aligned startup display version",
);

assertIncludes(
  "scripts/package-release-bundles.sh",
  "fn cli_display_version()",
  "portable launcher must derive CLI display version from bundle version",
);
assertNotIncludes(
  "scripts/package-release-bundles.sh",
  stalePortableVersionPrint,
  "portable launcher must not hardcode grobot 0.1.0",
);

for (const [relativePath, needles] of [
  ["README.md", [
    "## 版本号规范",
    "x.y.z",
    "v<x.y.z>",
    "package.json.version",
    "runtime/Cargo.toml",
    "npm run check:version",
  ]],
  ["gateway/README.md", [
    "版本号规范",
    "../README.md",
  ]],
]) {
  for (const needle of needles) {
    assertIncludes(relativePath, needle, `missing version policy marker ${JSON.stringify(needle)}`);
  }
}

if (failures.length > 0) {
  console.error("version consistency check failed:");
  for (const item of failures) {
    console.error(`- ${item}`);
  }
  process.exit(1);
}

console.log(`version consistency check passed: ${packageVersion}`);
