import { readFile, readdir } from "node:fs/promises";
import { gzipSync } from "node:zlib";

const MAX_INITIAL_JAVASCRIPT_BYTES = 170 * 1024;
const MAX_INITIAL_CSS_BYTES = 16 * 1024;
const assetsDirectory = new URL("./dist/assets/", import.meta.url);
const html = await readFile(
  new URL("./dist/index.html", import.meta.url),
  "utf8",
);
const assetNames = new Set(
  [...html.matchAll(/(?:src|href)="[^"]*\/assets\/([^"?]+)/g)].map(
    (match) => match[1],
  ),
);
const assets = new Map(
  await Promise.all(
    (await readdir(assetsDirectory)).map(async (name) => [
      name,
      gzipSync(await readFile(new URL(name, assetsDirectory))).byteLength,
    ]),
  ),
);
const initialJavaScriptBytes = [...assetNames]
  .filter((name) => name.endsWith(".js"))
  .reduce((total, name) => total + (assets.get(name) ?? 0), 0);
const initialCssBytes = [...assetNames]
  .filter((name) => name.endsWith(".css"))
  .reduce((total, name) => total + (assets.get(name) ?? 0), 0);

assertBudget(
  "Initial JavaScript",
  initialJavaScriptBytes,
  MAX_INITIAL_JAVASCRIPT_BYTES,
);
assertBudget("Initial CSS", initialCssBytes, MAX_INITIAL_CSS_BYTES);

function assertBudget(label, actual, maximum) {
  if (actual > maximum) {
    throw new Error(
      `${label} is ${formatBytes(actual)} gzip; budget is ${formatBytes(maximum)}.`,
    );
  }

  console.log(
    `${label}: ${formatBytes(actual)} gzip (budget ${formatBytes(maximum)})`,
  );
}

function formatBytes(bytes) {
  return `${(bytes / 1024).toFixed(1)} KiB`;
}
