import type { DatasetPackagePlan } from "./datasetPackage";
import type { VoiceCapturePackagePlan } from "./voiceCapturePackage";
import { createZipBlobOffThread } from "./zipService";
import type { ZipEntryInput } from "./zipWriter";

export type DatasetZipResult = {
  readonly blob: Blob;
  readonly missingAudioFiles: readonly string[];
  readonly writtenFiles: number;
};

export async function createVoiceCapturePackageZip(input: {
  readonly plan: VoiceCapturePackagePlan;
}): Promise<{ readonly blob: Blob; readonly writtenFiles: number }> {
  const blob = await createZipBlobOffThread(
    input.plan.files.map((entry) => ({ path: entry.path, data: entry.data })),
  );
  const { validateVoiceCapturePackageArchive } =
    await import("./voiceCapturePackageArchive");
  const validation = await validateVoiceCapturePackageArchive(blob);
  if (!validation.valid) {
    throw new Error(
      `Serialized package failed validation: ${validation.errors.join("; ")}`,
    );
  }
  return {
    blob,
    writtenFiles: input.plan.files.length,
  };
}

export async function createDatasetZip(input: {
  readonly getAudioBlob: (fileName: string) => Promise<Blob | undefined>;
  readonly plan: DatasetPackagePlan;
}): Promise<DatasetZipResult> {
  const entries: ZipEntryInput[] = [
    { path: "README.md", data: textBlob(input.plan.readme) },
  ];
  const missingAudioFiles: string[] = [];

  for (const file of input.plan.jsonFiles) {
    entries.push({ path: file.path, data: jsonBlob(file.json) });
  }

  for (const file of input.plan.textFiles) {
    entries.push({ path: file.path, data: textBlob(file.text) });
  }

  for (const file of input.plan.audioFiles) {
    const sourceBlob = await input.getAudioBlob(file.sourceFileName);

    if (sourceBlob === undefined) {
      missingAudioFiles.push(file.sourceFileName);
      continue;
    }

    const blob =
      file.processing === "voice_isolated"
        ? (
            await (
              await import("../analysis/processedVoiceArtifact")
            ).createProcessedVoiceArtifact({ audioBlob: sourceBlob })
          ).blob
        : sourceBlob;
    entries.push({ path: file.path, data: blob });
  }

  return {
    blob: await createZipBlobOffThread(entries),
    missingAudioFiles: Array.from(new Set(missingAudioFiles)),
    writtenFiles: entries.length,
  };
}

function jsonBlob(value: unknown): Blob {
  return new Blob([JSON.stringify(value, null, 2)], {
    type: "application/json",
  });
}

function textBlob(value: string): Blob {
  return new Blob([value], { type: "text/plain;charset=utf-8" });
}
