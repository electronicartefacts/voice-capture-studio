export const LEXICAL_SEGMENTATION_MAX_DURATION_MS = 10 * 60_000;
export const LEXICAL_SEGMENTATION_MAX_FILE_SIZE_BYTES = 200 * 1_000_000;

export function assertImportedMediaWithinLimits(input: {
  readonly sizeBytes: number;
  readonly durationMs?: number | null;
}): void {
  if (input.sizeBytes > LEXICAL_SEGMENTATION_MAX_FILE_SIZE_BYTES) {
    throw new Error(
      "Ce média dépasse 200 Mo. Exporte un passage plus court pour préserver la mémoire de cet appareil.",
    );
  }

  if (
    input.durationMs !== undefined &&
    input.durationMs !== null &&
    Number.isFinite(input.durationMs) &&
    input.durationMs > LEXICAL_SEGMENTATION_MAX_DURATION_MS
  ) {
    throw new Error(
      "Ce média dépasse 10 minutes. Découpe-le en passages plus courts pour garantir une analyse locale stable.",
    );
  }
}
