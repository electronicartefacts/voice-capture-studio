export type AcousticFieldFeatures = {
  readonly ambience: number;
  readonly bass: number;
  readonly presence: number;
  readonly air: number;
};

const EMPTY_FEATURES: AcousticFieldFeatures = {
  ambience: 0,
  bass: 0,
  presence: 0,
  air: 0,
};

/**
 * Converts the analyser's dB-normalized byte spectrum into four bounded visual
 * controls. The bands are intentionally broad: the field should represent the
 * room and vocal presence, rather than behave like a literal spectrum chart.
 */
export function measureAcousticField(
  frequencyData: Uint8Array,
  sampleRate: number,
  fftSize: number,
): AcousticFieldFeatures {
  if (frequencyData.length === 0 || sampleRate <= 0 || fftSize <= 0) {
    return EMPTY_FEATURES;
  }

  const hertzPerBin = sampleRate / fftSize;

  return {
    ambience: normalizeEnergy(
      averageBand(frequencyData, hertzPerBin, 40, 8_000),
    ),
    bass: normalizeEnergy(averageBand(frequencyData, hertzPerBin, 40, 180)),
    presence: normalizeEnergy(
      averageBand(frequencyData, hertzPerBin, 300, 3_400),
    ),
    air: normalizeEnergy(
      averageBand(frequencyData, hertzPerBin, 3_400, 10_000),
    ),
  };
}

function averageBand(
  frequencyData: Uint8Array,
  hertzPerBin: number,
  minimumHz: number,
  maximumHz: number,
): number {
  const start = Math.max(0, Math.ceil(minimumHz / hertzPerBin));
  const end = Math.min(
    frequencyData.length,
    Math.floor(maximumHz / hertzPerBin) + 1,
  );

  if (end <= start) return 0;

  let sum = 0;

  for (let index = start; index < end; index += 1) {
    sum += frequencyData[index];
  }

  return sum / (end - start);
}

function normalizeEnergy(value: number): number {
  // A gentle power curve preserves low-level room activity without allowing
  // loud plosives or music to flatten the field at full scale.
  return Math.min(1, Math.pow(Math.max(0, value / 255), 0.7));
}
