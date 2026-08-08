import { useEffect, useId, useMemo, useState } from "react";
import { Download } from "lucide-react";
import type {
  TimedTextDocument,
  TimedTextExportFormat,
} from "../../../domains/timedText/index";
import {
  createTimedTextExportArtifact,
  TIMED_TEXT_EXPORT_FORMATS,
} from "../../export/timedTextExport";

type ExportRecipe = "complete" | TimedTextExportFormat;

export type CompleteExportDownload = {
  readonly fileName: string;
  readonly href: string;
  readonly label: string;
};

export function ExportChooser(input: {
  readonly baseName: string;
  readonly completeDownloads: readonly CompleteExportDownload[];
  readonly completeLabel?: string;
  readonly defaultRecipe?: ExportRecipe;
  readonly document: TimedTextDocument | null;
}) {
  const selectId = useId();
  const availableDefault =
    input.defaultRecipe !== undefined &&
    input.defaultRecipe !== "complete" &&
    input.document !== null
      ? input.defaultRecipe
      : "complete";
  const [recipe, setRecipe] = useState<ExportRecipe>(availableDefault);
  const artifact = useMemo(
    () =>
      recipe === "complete" || input.document === null
        ? null
        : createTimedTextExportArtifact({
            baseName: input.baseName,
            document: input.document,
            format: recipe,
          }),
    [input.baseName, input.document, recipe],
  );

  useEffect(() => {
    setRecipe(availableDefault);
  }, [availableDefault, input.baseName]);

  function downloadArtifact() {
    if (artifact === null) return;
    const url = URL.createObjectURL(
      new Blob([artifact.text], { type: artifact.mimeType }),
    );
    const anchor = window.document.createElement("a");
    anchor.href = url;
    anchor.download = artifact.fileName;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  return (
    <div className="export-chooser">
      <label htmlFor={selectId}>
        <span>Format de sortie</span>
        <select
          id={selectId}
          onChange={(event) => setRecipe(event.target.value as ExportRecipe)}
          value={recipe}
        >
          <option value="complete">
            {input.completeLabel ?? "Prise complète — WAV + JSON"}
          </option>
          {TIMED_TEXT_EXPORT_FORMATS.map((format) => {
            const option =
              input.document === null
                ? null
                : createTimedTextExportArtifact({
                    baseName: input.baseName,
                    document: input.document,
                    format,
                  });
            return (
              <option
                disabled={input.document === null}
                key={format}
                value={format}
              >
                {option?.label ?? formatLabel(format)}
              </option>
            );
          })}
        </select>
      </label>

      {recipe === "complete" ? (
        <div className="export-choice-actions">
          {input.completeDownloads.map((download) => (
            <a
              className="download-action"
              download={download.fileName}
              href={download.href}
              key={`${download.label}:${download.fileName}`}
            >
              <Download aria-hidden="true" size={18} />
              <span>{download.label}</span>
            </a>
          ))}
        </div>
      ) : artifact !== null ? (
        <div className="export-choice-actions">
          <button
            className="download-action"
            onClick={downloadArtifact}
            type="button"
          >
            <Download aria-hidden="true" size={18} />
            <span>Télécharger {artifact.label}</span>
          </button>
          <p>{artifact.description}.</p>
        </div>
      ) : null}

      {input.document === null && (
        <p className="export-unavailable-note">
          Les formats synchronisés apparaîtront après un alignement mot par mot
          exploitable. Le WAV et le JSON restent disponibles sans approximation.
        </p>
      )}
      {input.completeDownloads.length === 0 && recipe === "complete" && (
        <p className="empty-export-state">
          La prise est conservée localement, mais aucun lien de téléchargement
          direct n'est disponible dans ce navigateur.
        </p>
      )}
    </div>
  );
}

function formatLabel(format: TimedTextExportFormat): string {
  if (format === "lrc") return "Paroles synchronisées";
  if (format === "enhanced-lrc") return "Karaoké mot par mot";
  if (format === "srt") return "Sous-titres SRT";
  if (format === "vtt") return "Sous-titres WebVTT";
  return "Données d'analyse CSV";
}
