import type { DatasetPackagePlan } from "./datasetPackage";
import { createZipBlob, type ZipEntryInput } from "./zipWriter";

export type DatasetZipResult = {
  readonly blob: Blob;
  readonly missingAudioFiles: readonly string[];
  readonly writtenFiles: number;
};

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
    const blob = await input.getAudioBlob(file.sourceFileName);

    if (blob === undefined) {
      missingAudioFiles.push(file.sourceFileName);
      continue;
    }

    entries.push({ path: file.path, data: blob });
  }

  return {
    blob: await createZipBlob(entries),
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
