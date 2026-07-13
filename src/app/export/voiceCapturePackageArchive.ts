import { validatePcmWavBlob } from "../audio/wavValidation";
import { sha256Blob } from "../storage/sha256";
import { readStoredZipEntries } from "./zipReader";
import {
  VOICE_CAPTURE_PACKAGE_SCHEMA,
  type VoiceCapturePackageManifest,
  type VoiceCapturePackageSample,
  type VoiceCapturePackageValidation,
} from "./voiceCapturePackage";

const SHA256_PATTERN = /^[a-f0-9]{64}$/;

export async function validateVoiceCapturePackageArchive(
  archive: Blob,
): Promise<VoiceCapturePackageValidation> {
  const errors: string[] = [];
  let entries: ReadonlyMap<string, Blob>;
  try {
    entries = await readStoredZipEntries(archive);
  } catch (error) {
    return {
      valid: false,
      errors: [
        error instanceof Error ? error.message : "ZIP archive is invalid.",
      ],
    };
  }

  const manifest = await readJson<VoiceCapturePackageManifest>(
    entries,
    "manifest.json",
    errors,
  );
  const samples = await readJsonl<VoiceCapturePackageSample>(
    entries,
    "samples.jsonl",
    errors,
  );
  const checksums = await readChecksums(entries, errors);

  if (manifest?.schema_version !== VOICE_CAPTURE_PACKAGE_SCHEMA) {
    errors.push("Manifest schema is missing or unsupported.");
  }

  const payloadPaths = [...entries.keys()].filter(
    (path) => path !== "manifest.json" && path !== "checksums.sha256",
  );
  const artifactPaths = new Set(
    manifest?.artifacts.map((item) => item.path) ?? [],
  );
  for (const path of payloadPaths) {
    if (!artifactPaths.has(path))
      errors.push(`Unmanifested archive entry: ${path}`);
  }
  for (const path of artifactPaths) {
    if (!entries.has(path))
      errors.push(`Manifest artifact is missing: ${path}`);
  }

  for (const [path, blob] of entries) {
    if (path === "checksums.sha256") continue;
    const expected = checksums.get(path);
    if (expected === undefined) {
      errors.push(`Checksum row missing: ${path}`);
    } else if ((await sha256Blob(blob)) !== expected) {
      errors.push(`Checksum mismatch: ${path}`);
    }
  }
  for (const path of checksums.keys()) {
    if (!entries.has(path))
      errors.push(`Checksum references missing entry: ${path}`);
  }

  for (const artifact of manifest?.artifacts ?? []) {
    const blob = entries.get(artifact.path);
    if (blob === undefined) continue;
    if (blob.size !== artifact.byteSize)
      errors.push(`Artifact size mismatch: ${artifact.path}`);
    if ((await sha256Blob(blob)) !== artifact.sha256)
      errors.push(`Artifact hash mismatch: ${artifact.path}`);
  }

  const consentIds = await readJsonlIds(
    entries,
    "rights/consents.jsonl",
    "consentId",
    errors,
  );
  const licenseIds = await readJsonlIds(
    entries,
    "rights/licenses.jsonl",
    "licenseId",
    errors,
  );
  for (const [index, sample] of samples.entries()) {
    await validateSample(
      sample,
      index,
      entries,
      consentIds,
      licenseIds,
      errors,
    );
  }
  if (manifest !== null && samples.length !== manifest.counts.samples) {
    errors.push("Manifest sample count does not match samples.jsonl.");
  }

  return { valid: errors.length === 0, errors: [...new Set(errors)] };
}

async function validateSample(
  sample: VoiceCapturePackageSample,
  index: number,
  entries: ReadonlyMap<string, Blob>,
  consentIds: ReadonlySet<string>,
  licenseIds: ReadonlySet<string>,
  errors: string[],
): Promise<void> {
  const prefix = `Sample ${index}`;
  const audio = entries.get(sample.audio?.path);
  if (audio === undefined) {
    errors.push(`${prefix} audio path is missing.`);
  } else {
    if (audio.size !== sample.audio.byte_size)
      errors.push(`${prefix} audio byte size is inconsistent.`);
    if ((await sha256Blob(audio)) !== sample.audio.sha256)
      errors.push(`${prefix} audio SHA-256 is inconsistent.`);
    try {
      const wav = await validatePcmWavBlob(
        new Blob([await audio.arrayBuffer()], { type: "audio/wav" }),
      );
      if (
        wav.sampleRateHz !== sample.audio.sample_rate_hz ||
        wav.channels !== sample.audio.channels ||
        wav.bitDepth !== sample.audio.bit_depth ||
        wav.durationMs !== sample.audio.duration_ms
      ) {
        errors.push(`${prefix} audio declaration does not match its WAV.`);
      }
    } catch (error) {
      errors.push(
        `${prefix} WAV is invalid: ${error instanceof Error ? error.message : "invalid audio"}`,
      );
    }
  }
  for (const path of [
    sample.quality?.path,
    sample.alignment?.path,
    sample.capture_context_ref,
    sample.observations?.path,
    sample.observations?.evidence_path,
  ]) {
    if (path !== null && path !== undefined && !entries.has(path))
      errors.push(`${prefix} references missing artifact: ${path}`);
  }
  for (const id of sample.consent_refs ?? []) {
    if (!consentIds.has(id))
      errors.push(`${prefix} consent ref is missing: ${id}`);
  }
  for (const id of sample.license_refs ?? []) {
    if (!licenseIds.has(id))
      errors.push(`${prefix} license ref is missing: ${id}`);
  }
}

async function readChecksums(
  entries: ReadonlyMap<string, Blob>,
  errors: string[],
): Promise<ReadonlyMap<string, string>> {
  const blob = entries.get("checksums.sha256");
  const result = new Map<string, string>();
  if (blob === undefined) {
    errors.push("checksums.sha256 is missing.");
    return result;
  }
  for (const [index, line] of (await blob.text())
    .split("\n")
    .filter(Boolean)
    .entries()) {
    const match = /^([a-f0-9]{64})[ ]{2}(.+)$/.exec(line);
    if (match === null) {
      errors.push(`Invalid checksum row ${index + 1}.`);
      continue;
    }
    if (!SHA256_PATTERN.test(match[1]) || result.has(match[2])) {
      errors.push(`Invalid or duplicate checksum row for ${match[2]}.`);
      continue;
    }
    result.set(match[2], match[1]);
  }
  return result;
}

async function readJson<T>(
  entries: ReadonlyMap<string, Blob>,
  path: string,
  errors: string[],
): Promise<T | null> {
  const blob = entries.get(path);
  if (blob === undefined) {
    errors.push(`${path} is missing.`);
    return null;
  }
  try {
    return JSON.parse(await blob.text()) as T;
  } catch {
    errors.push(`${path} is not valid JSON.`);
    return null;
  }
}

async function readJsonl<T>(
  entries: ReadonlyMap<string, Blob>,
  path: string,
  errors: string[],
): Promise<readonly T[]> {
  const blob = entries.get(path);
  if (blob === undefined) {
    errors.push(`${path} is missing.`);
    return [];
  }
  const result: T[] = [];
  for (const [index, line] of (await blob.text())
    .split("\n")
    .filter(Boolean)
    .entries()) {
    try {
      result.push(JSON.parse(line) as T);
    } catch {
      errors.push(`${path} line ${index + 1} is not valid JSON.`);
    }
  }
  return result;
}

async function readJsonlIds(
  entries: ReadonlyMap<string, Blob>,
  path: string,
  field: string,
  errors: string[],
): Promise<ReadonlySet<string>> {
  const rows = await readJsonl<Record<string, unknown>>(entries, path, errors);
  const ids = new Set<string>();
  for (const row of rows) {
    const id = row[field];
    if (typeof id !== "string" || id.length === 0 || ids.has(id))
      errors.push(`${path} contains an invalid or duplicate ${field}.`);
    else ids.add(id);
  }
  return ids;
}
