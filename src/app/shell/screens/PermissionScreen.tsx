import { ArrowLeft, Download, Mic, ShieldCheck, Volume2 } from "lucide-react";
import type { PromptDefinition } from "@domains/corpus";
import type { RuntimeDiagnostics } from "../../system/runtimeDiagnostics";
import { formatEnergy, formatPace } from "../helpers";
import type { DubbingMediaSource } from "../types";
import { DubbingMediaStage } from "./DubbingMediaStage";

export function PermissionScreen(input: {
  readonly calibratesRoomTone: boolean;
  readonly diagnostics: RuntimeDiagnostics;
  readonly dubbingEndSeconds: number | null;
  readonly dubbingMedia: DubbingMediaSource | null;
  readonly dubbingMediaMuted: boolean;
  readonly dubbingStartSeconds: number;
  readonly insight: string | null;
  readonly isSpeakingReference: boolean;
  readonly message: string;
  readonly onAllow: () => void;
  readonly onBack: () => void;
  readonly onReference: () => void;
  readonly prompt: PromptDefinition | undefined;
}) {
  return (
    <div className="director-panel">
      <div className="director-heading">
        <div className="section-icon">
          <ShieldCheck aria-hidden="true" size={28} />
        </div>
        <div>
          <p className="soft-label">Seuil de prise</p>
          <h1>La surface attend ta voix.</h1>
        </div>
      </div>
      <p aria-live="polite">{input.message}</p>
      {!input.diagnostics.canRecord && (
        <p className="coach-note danger">{input.diagnostics.primaryAction}</p>
      )}
      {input.insight !== null && <p className="coach-note">{input.insight}</p>}
      {input.prompt !== undefined && (
        <article className="prompt-direction">
          <p className="soft-label">Phrase</p>
          <blockquote>{input.prompt.text}</blockquote>
          <dl>
            <div>
              <dt>Intention</dt>
              <dd>{input.prompt.intention.label}</dd>
            </div>
            <div>
              <dt>Situation</dt>
              <dd>{input.prompt.direction.context}</dd>
            </div>
            <div>
              <dt>Rythme</dt>
              <dd>{formatPace(input.prompt.delivery.pace)}</dd>
            </div>
            <div>
              <dt>Énergie</dt>
              <dd>{formatEnergy(input.prompt.delivery.energy)}</dd>
            </div>
            <div>
              <dt>Pause</dt>
              <dd>{input.prompt.direction.pauseInstruction}</dd>
            </div>
            <div>
              <dt>À souligner</dt>
              <dd>{input.prompt.direction.emphasis.join(", ")}</dd>
            </div>
            <div>
              <dt>Évite</dt>
              <dd>{input.prompt.direction.avoid.join(", ")}</dd>
            </div>
          </dl>
        </article>
      )}
      {input.dubbingMedia !== null && (
        <DubbingMediaStage
          autoplay={false}
          className="is-preparation"
          endSeconds={input.dubbingEndSeconds}
          muted={input.dubbingMediaMuted}
          source={input.dubbingMedia}
          startSeconds={input.dubbingStartSeconds}
        />
      )}
      <ul className="prep-checklist" aria-label="Avant de lancer">
        {input.calibratesRoomTone ? (
          <li>
            <ShieldCheck aria-hidden="true" size={17} />
            <span>Garde trois secondes de silence pour mesurer la pièce.</span>
          </li>
        ) : (
          <li>
            <ShieldCheck aria-hidden="true" size={17} />
            <span>La prise démarre immédiatement après validation.</span>
          </li>
        )}
        <li>
          <Mic aria-hidden="true" size={17} />
          <span>
            Reste à la même distance du micro pendant toute la phrase.
          </span>
        </li>
        <li>
          <Download aria-hidden="true" size={17} />
          <span>Vérifie les liens WAV et JSON dès que la prise est finie.</span>
        </li>
      </ul>
      <div
        className={`stacked-actions permission-actions${
          input.prompt === undefined ? " is-direct-start" : ""
        }`}
      >
        {input.prompt !== undefined && (
          <button
            className="folder-button"
            onClick={input.onReference}
            type="button"
          >
            <Volume2 aria-hidden="true" size={19} />
            <span>
              {input.isSpeakingReference
                ? "Arrêter la référence"
                : "Écouter la référence"}
            </span>
          </button>
        )}
        <button
          className="launch-button"
          disabled={!input.diagnostics.canRecord}
          onClick={input.onAllow}
          type="button"
        >
          <Mic aria-hidden="true" size={20} />
          <span>Démarrer la prise</span>
        </button>
        <button
          className="quiet-button standalone"
          onClick={input.onBack}
          type="button"
        >
          <ArrowLeft aria-hidden="true" size={17} />
          <span>Retour</span>
        </button>
      </div>
    </div>
  );
}
