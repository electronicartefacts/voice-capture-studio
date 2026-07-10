import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { readStoredZipEntries } from "../src/app/export/zipReader";
import { createZipBlob } from "../src/app/export/zipWriter";

test("zip writer produces an archive readable by a standard unzip tool", async () => {
  const blob = await createZipBlob([
    { path: "README.md", data: new Blob(["hello dataset"]) },
    {
      path: "metadata/take.1.json",
      data: new Blob([JSON.stringify({ a: 1 })]),
    },
  ]);
  const buffer = Buffer.from(await blob.arrayBuffer());
  const directory = mkdtempSync(path.join(tmpdir(), "vcs-zip-test-"));
  const zipPath = path.join(directory, "dataset.zip");

  writeFileSync(zipPath, buffer);

  try {
    execFileSync("unzip", ["-o", zipPath, "-d", directory]);

    const readmeContents = execFileSync("cat", [
      path.join(directory, "README.md"),
    ]).toString("utf-8");
    const metadataContents = execFileSync("cat", [
      path.join(directory, "metadata", "take.1.json"),
    ]).toString("utf-8");

    assert.equal(readmeContents, "hello dataset");
    assert.deepEqual(JSON.parse(metadataContents), { a: 1 });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("zip reader verifies and restores every stored entry", async () => {
  const archive = await createZipBlob([
    { path: "manifest.json", data: new Blob(["manifest"]) },
    { path: "audio/hash.wav", data: new Blob([new Uint8Array([1, 2, 3])]) },
  ]);
  const entries = await readStoredZipEntries(archive);

  assert.deepEqual([...entries.keys()], ["manifest.json", "audio/hash.wav"]);
  assert.equal(await entries.get("manifest.json")?.text(), "manifest");
  assert.deepEqual(
    new Uint8Array(await entries.get("audio/hash.wav")!.arrayBuffer()),
    new Uint8Array([1, 2, 3]),
  );
});

test("zip reader rejects bytes that no longer match the stored checksum", async () => {
  const archive = await createZipBlob([
    { path: "manifest.json", data: new Blob(["manifest"]) },
  ]);
  const bytes = new Uint8Array(await archive.arrayBuffer());

  bytes[30 + "manifest.json".length] ^= 0xff;

  await assert.rejects(
    () => readStoredZipEntries(new Blob([bytes])),
    /checksum mismatch/,
  );
});

test("zip writer preserves multiple nested entries and byte-for-byte content", async () => {
  const first = "a".repeat(5000);
  const second = "b".repeat(3);
  const blob = await createZipBlob([
    { path: "raw/take.a.wav", data: new Blob([first]) },
    { path: "raw/take.b.wav", data: new Blob([second]) },
  ]);
  const buffer = Buffer.from(await blob.arrayBuffer());
  const directory = mkdtempSync(path.join(tmpdir(), "vcs-zip-test-"));
  const zipPath = path.join(directory, "dataset.zip");

  writeFileSync(zipPath, buffer);

  try {
    execFileSync("unzip", ["-o", zipPath, "-d", directory]);

    const firstContents = execFileSync("cat", [
      path.join(directory, "raw", "take.a.wav"),
    ]).toString("utf-8");
    const secondContents = execFileSync("cat", [
      path.join(directory, "raw", "take.b.wav"),
    ]).toString("utf-8");

    assert.equal(firstContents, first);
    assert.equal(secondContents, second);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
