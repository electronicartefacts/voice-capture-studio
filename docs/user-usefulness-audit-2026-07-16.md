# Audit d'utilité utilisateur — 16 juillet 2026

## Verdict

Voice Capture Studio est déjà très utile pour son cœur de cible : une personne qui doit capturer,
qualifier, reprendre et exporter de la matière vocale sans remettre ses fichiers à un service
distant. Son avantage n'est pas de remplacer un studio audio complet. Il rend cinq travaux vocaux
précis possibles depuis un navigateur, avec une provenance et des sorties réutilisables.

Le produit était cependant moins convaincant à deux moments décisifs : avant d'entrer, sa promesse
était trop abstraite; après une découpe lexicale, le résultat n'était pas directement vérifiable.
Cette passe corrige ces deux ruptures sans ajouter de réseau, de compte, ni de modèle au chargement
initial.

Les scores ci-dessous évaluent la complétude du parcours présent dans le code. Ce ne sont pas des
scores scientifiques de reconnaissance, qui exigeraient un corpus annoté et des appareils réels.

## Utilité par travail

| Travail utilisateur                                    | Complétude actuelle | Ce que le produit permet réellement                                                                       | Limite déterminante                                                                             |
| ------------------------------------------------------ | ------------------: | --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Capturer rapidement une voix, un chant ou une ambiance |              8,5/10 | WAV local, contrôle signal, reprise, provenance et export sans compte                                     | Pas de marqueurs ni de montage multipiste pour une interview longue                             |
| Constituer un corpus vocal pour le ML                  |                9/10 | Corpus guidé, couverture, acceptation explicite, métadonnées, archives restaurables et paquets auditables | L'alignement navigateur reste préparatoire avant un entraînement premium                        |
| Enregistrer un doublage contre une image               |              7,5/10 | Vidéo locale, sous-titres minutés, repères de scène, reprises et voix isolée                              | Pas encore de rendu vidéo assemblé ni d'échange DAW/AAF                                         |
| Interpréter un texte ou des paroles sur un support     |                8/10 | Prise continue ou segmentée, retour casque séparé, support non mélangé au WAV voix                        | Pas de comping multipiste, punch-in ou automatisation musicale                                  |
| Découper une voix parlée ou chantée mot par mot        |                8/10 | Analyse adaptative multi-hypothèse, ZIP WAV/JSON/CSV, preuves, timecodes et écoute locale de chaque mot   | La correction manuelle ne reconstruit pas encore le ZIP; un mix dense ne peut pas être garanti  |
| Travailler sur mobile ou un appareil modeste           |              8,5/10 | PWA, chemins Safari/Firefox, budget adaptatif mesuré, annulation et chargements visibles                  | La matrice physique iPhone/iPad/Android et technologies d'assistance doit rester un gate manuel |

## Manques adressés dans cette passe

### 1. Comprendre la valeur avant de donner un accès

Le rituel d'entrée annonce maintenant l'action utile — capturer, organiser ou découper une voix
dans le navigateur — et distingue l'autorisation du microphone du parcours média qui n'en a pas
besoin. L'utilisateur ne doit plus connaître le produit pour comprendre ses deux portes d'entrée.

### 2. Comprendre les cinq icônes sans les essayer

Le sélecteur conserve sa forme compacte, mais le mode actif et sa finalité sont toujours écrits sous
la molette. Ce libellé est également annoncé aux technologies d'assistance et vérifié dans le
parcours de bout en bout.

### 3. Vérifier une segmentation avant de lui faire confiance

Après l'analyse, une revue facultative permet maintenant de :

- lire chaque mot détecté avec son début, sa fin et la nature de la preuve;
- lancer directement le passage correspondant sur le média original non filtré;
- arrêter la lecture à la frontière du segment et comparer au contexte réel;
- parcourir les longs résultats par pages de 40 mots sans saturer le rendu;
- conserver le ZIP comme sortie stable si le navigateur ne sait pas relire le format source.

Le fichier ne quitte jamais l'appareil. Son URL locale n'est créée qu'à l'ouverture de la revue et
est libérée ensuite. Le lecteur et les styles sont dans le module lexical chargé à la demande : le
lecteur n'ajoute aucun module au chargement initial.

### 4. Éviter une mise à jour PWA hybride

La révision du cache applicatif change avec le shell. Une installation existante ne conserve donc
pas une ancienne interface devant de nouveaux modules.

## Manques réels qui restent

### Priorité 1 — corriger puis reconstruire

La prochaine fonction à plus forte valeur est un éditeur local des mots et frontières, suivi d'une
reconstruction déterministe du ZIP. L'écoute livrée ici ferme le diagnostic; l'édition fermerait le
travail complet. Elle doit conserver l'original, journaliser les corrections et ne jamais présenter
une frontière manuelle comme une inférence automatique.

### Priorité 2 — mesurer sur un corpus de référence

La qualité sur chant ne peut pas être déclarée « parfaite » à partir du code. Il faut un corpus
redistribuable et annoté couvrant voix nette, réverbération, téléphone, a cappella, pop dense, rap,
chœurs, passages instrumentaux, français et anglais. Le gate doit mesurer WER/CER, hallucinations
hors voix, mots manqués, erreur de frontières, durée, mémoire et téléchargement froid/chaud. Sans
ce banc, un nouveau modèle ou séparateur serait seulement plus lourd, pas démontré meilleur.

### Priorité 3 — valider les appareils et l'accessibilité réelle

Les contrôles automatiques couvrent clavier, noms accessibles, contrastes sérieux et plusieurs
moteurs. Ils ne remplacent pas VoiceOver sur iPhone/iPad, TalkBack, navigation par commutateur,
microphones Bluetooth, interruptions téléphoniques et faible mémoire. Cette matrice doit devenir une
checklist de sortie versionnée.

### Priorité 4 — finir les parcours professionnels spécialisés

- correction et chapitrage des prises longues ou multi-intervenants;
- export de doublage vers une vidéo assemblée ou un format de montage interopérable;
- comping et punch-in non destructifs pour l'interprétation;
- interface entièrement français/anglais;
- alignement acoustique externe ou importé avant qualification d'un dataset final.

Ces capacités ne doivent pas devenir de nouveaux modes avant de produire une sortie réellement
différente. Elles enrichissent d'abord les cinq parcours existants.

## Conclusion produit

Le site est proche d'une référence pour la capture vocale locale structurée, particulièrement pour
les corpus ML et les prises privées. Il est désormais plus honnête et plus actionnable aux deux
moments où l'utilisateur décide de lui faire confiance. Sa frontière suivante n'est pas une nouvelle
promesse marketing : c'est la correction locale des résultats et leur mesure contre une vérité
terrain versionnée.
