# Grille d'expérience des modes

Cette grille sépare les modes par résultat attendu, pas par format de fichier. Un nouveau mode n'est
justifié que s'il change à la fois le parcours de capture, les critères de réussite et la forme de
l'export.

| Mode visible     | Utilisateur type                                                 | Besoin principal                                                                  | Entrées                                                          | Expérience de prise                                                                                       | Sortie utile                                                             | Critère de réussite                                                                         |
| ---------------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| Capture libre    | Journaliste, podcasteur, sound designer, créateur en déplacement | Conserver immédiatement une voix, un chant ou une ambiance sans préparer de texte | Micro, voix, langue, dossier optionnel                           | Démarrage direct, chronomètre, arrêt manuel, transcription opportuniste                                   | WAV local et manifeste de provenance                                     | La prise complète est récupérable sans faux indicateur de lecture ou de dataset             |
| Dataset ML       | Donneur de voix, chercheur, studio constituant un corpus         | Produire une matière vocale cohérente, comparable et traçable                     | Corpus intégré, profil de voix, calibration de salle             | Phrases choisies selon les lacunes de couverture, guidage vocal, contrôle qualité                         | Prises, phonèmes estimés, qualité, manifeste d'entraînement candidat     | La couverture progresse uniquement avec des prises acceptées et vérifiables                 |
| Doublage         | Comédien, localisateur, vidéaste, créateur de contenu            | Jouer une réplique contre une image et un rythme de scène                         | Script ou sous-titres, vidéo locale ou YouTube, repère de départ | Répliques dans l'ordre, image visible avant et pendant la prise, timecodes SRT/VTT repris automatiquement | Voix isolée, script structuré et repères de scène dans le corpus exporté | L'utilisateur peut voir, caler, jouer et reprendre chaque réplique sans quitter le studio   |
| Interprétation   | Chanteur, narrateur, comédien voix, créateur musical             | Enregistrer une performance continue ou segmentée avec un support sonore          | Texte, paroles, support audio optionnel, casque                  | Retour audio séparé, mode continu pour des paroles complètes ou prises segmentées                         | Voix isolée et manifeste de performance                                  | Le support guide la performance sans être mélangé au WAV voix                               |
| Découpe lexicale | Chercheur, monteur, linguiste, créateur de dataset               | Transformer un média parlé en extraits audio mot par mot                          | Audio ou vidéo locale, langue parlée                             | Analyse Whisper locale secondaire, validation indépendante par activité vocale et profil automatique      | ZIP de WAV, manifeste JSON enrichi et timeline CSV                       | Les hypothèses sans soutien vocal sont rejetées; le résultat reste explicitement à vérifier |

## Décisions de cohérence

- Le nom interne `mastering` reste stable pour la compatibilité des workspaces, mais le mode visible
  devient **Interprétation**. L'application ne réalise pas un mastering audio et ne doit pas le
  promettre.
- Seul le mode Dataset affiche une couverture phonétique. Dans les autres modes, le même anneau à
  `0 %` était une fausse mesure.
- Les scripts de doublage et d'interprétation sont planifiés dans leur ordre source. L'optimisation
  de couverture reste réservée au Dataset ML.
- Les fichiers SRT et VTT conservent maintenant leurs débuts et fins de cue. Une réplique de
  doublage peut donc ouvrir la vidéo au bon repère.
- Une vidéo locale reste sur l'appareil. Une vidéo YouTube n'est activée qu'après une action
  explicite et reste une ressource distante ; elle n'est ni copiée ni incluse dans le workspace.
- Le son de l'image est coupé par défaut afin de protéger la prise. Il peut être activé avec un
  casque.
- La Découpe lexicale n'utilise jamais le microphone. Pour une source vidéo, l'image est ignorée et
  seul le son décodé alimente les extraits WAV.

## Modes envisagés mais non ajoutés

| Hypothèse                  | Décision actuelle                                  | Déclencheur qui justifierait un vrai mode                                                          |
| -------------------------- | -------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Podcast / interview        | Variante de Capture libre                          | Plusieurs intervenants simultanés, marqueurs, prises longues et montage multipiste                 |
| Livre audio / narration    | Couvert par Interprétation segmentée               | Gestion de chapitres, continuité inter-session, personnages et contrôle éditorial dédié            |
| Foley / bruitage à l'image | Partiellement couvert par Doublage + Capture libre | Timeline d'événements non verbaux et métadonnées de bruitage distinctes du transcript              |
| Voix off vidéo             | Couvert par Doublage                               | Parcours réellement différent du lip-sync, avec mesure de durée globale et mix de prévisualisation |

Ajouter ces cartes avant leurs capacités propres rendrait la plateforme plus complexe sans rendre un
nouveau travail possible. Elles doivent rester des scénarios des cinq modes actuels jusqu'à ce que
leurs contraintes imposent un moteur différent.
