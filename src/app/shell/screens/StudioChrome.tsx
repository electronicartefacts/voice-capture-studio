import { Mic } from "lucide-react";
import type { RitualStatus } from "../types";

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="site-footer-brand">
        <span>
          <em>electronic</em>
          <b>Artefacts</b>
        </span>
        <small>Voice Capture Studio — capture vocale locale et précise.</small>
      </div>
      <nav className="site-footer-links" aria-label="Liens externes">
        <a
          href="https://www.electronicartefacts.com"
          rel="noreferrer"
          target="_blank"
        >
          www.electronicartefacts.com
        </a>
        <a
          href="https://github.com/electronicartefacts/voice-capture-studio"
          rel="noreferrer"
          target="_blank"
        >
          GitHub
        </a>
        <a
          href="https://github.com/electronicartefacts/voice-capture-studio/blob/main/LICENSE"
          rel="noreferrer"
          target="_blank"
        >
          Licence MIT
        </a>
      </nav>
      <p className="site-footer-note">
        100 % local — aucune donnée n'est envoyée en ligne. ©{" "}
        {new Date().getFullYear()} electronicArtefacts.
      </p>
    </footer>
  );
}

export function OpeningRitual(input: {
  readonly onAwaken: () => void;
  readonly status: RitualStatus;
}) {
  const buttonLabel =
    input.status === "requesting"
      ? "Activation du microphone…"
      : input.status === "denied"
        ? "Réessayer le microphone"
        : "Activer le microphone";

  return (
    <section className="opening-ritual" aria-live="polite">
      <div>
        <h1>Bienvenue dans Voice Capture Studio.</h1>
        <button
          className={`ritual-button is-${input.status}`}
          disabled={input.status === "requesting"}
          onClick={input.onAwaken}
          type="button"
        >
          <Mic aria-hidden="true" size={18} />
          <span>{buttonLabel}</span>
        </button>
        {input.status === "denied" && (
          <p>
            L’accès au microphone est nécessaire pour entrer dans le studio.
          </p>
        )}
      </div>
    </section>
  );
}

export function AmbientBackdrop(input: { readonly awake: boolean }) {
  return (
    <div
      aria-hidden="true"
      className={`ambient-backdrop${input.awake ? " is-awake" : ""}`}
    >
      <span className="voice-halo halo-a" />
      <span className="voice-halo halo-b" />
      <span className="voice-halo halo-c" />
      <span className="voice-halo halo-d" />
    </div>
  );
}
