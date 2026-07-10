import { useEffect, useState } from "react";

export type SurfaceProfile =
  | "mobile-focus"
  | "mobile-landscape-lab"
  | "tablet-dashboard"
  | "tablet-lab"
  | "desktop-lab";

export type SurfaceProfileDetails = {
  readonly label: string;
  readonly description: string;
};

export const surfaceProfileDetails: Record<
  SurfaceProfile,
  SurfaceProfileDetails
> = {
  "mobile-focus": {
    label: "Focus",
    description: "Capture essentielle, pensée pour le portrait.",
  },
  "mobile-landscape-lab": {
    label: "Lab compact",
    description: "Contrôle rapide et visualisation en paysage.",
  },
  "tablet-dashboard": {
    label: "Dashboard",
    description: "Pilotage de session et état global.",
  },
  "tablet-lab": {
    label: "Lab",
    description: "Capture, réglages et qualité côte à côte.",
  },
  "desktop-lab": {
    label: "Lab complet",
    description: "Contrôle avancé, analyse et exports détaillés.",
  },
};

export function getSurfaceProfile(): SurfaceProfile {
  if (typeof window === "undefined") {
    return "desktop-lab";
  }

  const width = window.innerWidth;
  const height = window.innerHeight;
  const isLandscape = width > height;

  if (isLandscape && height < 540 && width < 1000) {
    return "mobile-landscape-lab";
  }

  if (width < 720) {
    return isLandscape ? "mobile-landscape-lab" : "mobile-focus";
  }

  if (width < 1180) {
    return isLandscape ? "tablet-lab" : "tablet-dashboard";
  }

  return "desktop-lab";
}

export function useSurfaceProfile(): SurfaceProfile {
  const [profile, setProfile] = useState<SurfaceProfile>(getSurfaceProfile);

  useEffect(() => {
    const update = () => setProfile(getSurfaceProfile());

    window.addEventListener("resize", update, { passive: true });
    window.addEventListener("orientationchange", update, { passive: true });

    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
    };
  }, []);

  return profile;
}
