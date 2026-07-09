import {
  Archive,
  BookOpenText,
  ChartNoAxesColumnIncreasing,
  FolderOpen,
  Mic,
  Settings,
  UserRound,
  type LucideIcon,
} from "lucide-react";

export type AppRouteId =
  | "workspace"
  | "speakers"
  | "corpus"
  | "sessions"
  | "coverage"
  | "export"
  | "settings";

export type AppRoute = {
  readonly id: AppRouteId;
  readonly label: string;
  readonly description: string;
  readonly icon: LucideIcon;
};

export const appRoutes: readonly AppRoute[] = [
  {
    id: "workspace",
    label: "Espace local",
    description: "Créer ou ouvrir la progression conservée sur cet appareil.",
    icon: FolderOpen,
  },
  {
    id: "speakers",
    label: "Voix",
    description: "Gérer les profils de voix et leurs langues.",
    icon: UserRound,
  },
  {
    id: "corpus",
    label: "Phrases",
    description: "Consulter les phrases, intentions et situations guidées.",
    icon: BookOpenText,
  },
  {
    id: "sessions",
    label: "Sessions",
    description: "Préparer des sessions courtes et guidées.",
    icon: Mic,
  },
  {
    id: "coverage",
    label: "Progression",
    description: "Suivre les zones déjà couvertes et celles à compléter.",
    icon: ChartNoAxesColumnIncreasing,
  },
  {
    id: "export",
    label: "Export",
    description: "Préparer les fichiers audio et les métadonnées de session.",
    icon: Archive,
  },
  {
    id: "settings",
    label: "Réglages",
    description: "Préférences locales de l'application.",
    icon: Settings,
  },
];
