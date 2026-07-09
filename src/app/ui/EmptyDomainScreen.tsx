import type { AppRoute } from "../shell/navigation";

type EmptyDomainScreenProps = {
  readonly route: AppRoute;
};

const domainResponsibilities: Record<AppRoute["id"], readonly string[]> = {
  workspace: [
    "Conserver la progression locale et l'historique des sessions.",
    "Séparer les prises audio des préférences de capture.",
    "Garder les données vocales sur l'appareil.",
  ],
  speakers: [
    "Identifier chaque voix sans imposer de compte utilisateur.",
    "Associer les langues disponibles à chaque voix.",
    "Préparer l'ajout de nouveaux profils.",
  ],
  corpus: [
    "Versionner les phrases, situations, intentions et consignes.",
    "Garder des identifiants stables pour chaque phrase.",
    "Préserver la compatibilité des sessions déjà enregistrées.",
  ],
  sessions: [
    "Planifier des sessions courtes avec une charge vocale limitée.",
    "Choisir les phrases selon les zones à compléter.",
    "Conserver un historique clair des prises finalisées.",
  ],
  coverage: [
    "Mesurer la progression à partir des prises validées.",
    "Afficher les manques en rythme, intention, énergie et sons.",
    "Transformer les métriques techniques en décisions de prise.",
  ],
  export: [
    "Créer les fichiers audio et les métadonnées de session.",
    "Séparer export, progression locale et stockage navigateur.",
    "Versionner les formats pour des traitements ultérieurs.",
  ],
  settings: [
    "Conserver uniquement des préférences locales.",
    "Éviter toute hypothèse de synchronisation distante.",
    "Distinguer les valeurs par défaut des règles de capture.",
  ],
};

export function EmptyDomainScreen({ route }: EmptyDomainScreenProps) {
  const Icon = route.icon;

  return (
    <section className="domain-panel">
      <div className="domain-heading">
        <div className="domain-icon">
          <Icon aria-hidden="true" size={26} />
        </div>
        <div>
          <p className="eyebrow">Section produit</p>
          <h3>{route.label}</h3>
          <p>{route.description}</p>
        </div>
      </div>

      <div className="responsibility-list">
        {domainResponsibilities[route.id].map((item) => (
          <article key={item}>
            <h4>{item}</h4>
            <p>Structure prête pour l'interface finale.</p>
          </article>
        ))}
      </div>
    </section>
  );
}
