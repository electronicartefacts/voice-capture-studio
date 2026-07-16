# Audit produit et technologique global — 16 juillet 2026

## Verdict

Voice Capture Studio possède déjà un socle rare pour un produit audio web :
capture PCM locale, mesures signal, calibration de pièce, guidage temps réel,
historique IndexedDB, archives restaurables, exports de dataset avec provenance,
PWA, accessibilité automatisée et modèles servis depuis la même origine.

Le principal plafond observé n'était pas l'absence de fonctions. C'était la
dispersion des décisions : le temps réel, l'analyse après prise et l'import de
média avaient chacun de bonnes heuristiques, mais pas un protocole partagé pour
adapter le coût et le niveau de preuve à la scène acoustique. Cette passe ajoute
ce protocole sans serveur, sans entraînement et sans rendre l'interface plus
complexe.

L'application ne peut pas être déclarée « parfaite » au sens scientifique sans
un corpus audio de référence, une matrice d'appareils physiques et une campagne
manuelle avec technologies d'assistance. Elle peut en revanche devenir une
référence vérifiable : chaque promesse ci-dessous est reliée à du code, un
contrat exporté ou un test.

## Surface auditée

- cinq modes et leurs entrées, critères de réussite, reprises et exports;
- capture Web Audio, AudioWorklet et repli ScriptProcessor;
- gain automatique, PCM 48 kHz / 24-bit, métriques et calibration;
- guidage navigateur, endpointing acoustique et comportement du chant;
- analyses Whisper Tiny/Base, Silero, WebGPU/WASM et cache local;
- import audio/vidéo, focus vocal, séparation spectrale et consensus lexical;
- alignements estimés, locaux et forcés externes;
- stockage, archives, restauration, téléchargement et File System Access;
- rendu de la courbe, chargements, responsive, PWA et hors-ligne;
- métadonnées, droits, checksums et paquets de dataset;
- documentation, CI, budgets et parcours Playwright.

## Architecture adaptative livrée

### 1. Temps réel : priorité absolue à la continuité

Le chemin de prise reste déterministe et léger. Il combine le PCM, une activité
énergétique calibrée sur la pièce et la reconnaissance navigateur uniquement
quand elle existe. Aucun modèle lourd n'entre en compétition avec le callback
audio. Le rendu est piloté hors du cycle React et ne se dégrade pas pendant une
capture visible.

### 2. Après la prise : éclaireur puis vérification conditionnelle

L'analyse manuelle d'une prise suit maintenant ce protocole :

1. Whisper Tiny produit l'hypothèse rapide; Silero mesure les zones vocales.
2. Le moteur classe la scène avec l'intention parlée/chantée, le SNR, la
   réverbération et le ratio d'activité vocale.
3. Une voix nette et cohérente s'arrête là.
4. Une voix chantée, contrainte ou incohérente déclenche Whisper Base avec un
   faisceau court.
5. Si Silero confirme l'absence de voix, le moteur n'appelle pas un second
   modèle susceptible d'halluciner. Le chant reste l'exception prudente, car un
   VAD de parole peut manquer des voyelles soutenues.
6. Avec un texte attendu, l'arbitrage privilégie la correspondance au prompt et
   l'accord des frontières acoustiques. Sans texte, il privilégie le soutien
   vocal et pénalise densité anormale et répétitions.

Le workspace conserve la scène, la profondeur, les modèles, providers,
décodages, scores, transcripts et raison de sélection. L'hypothèse perdante
n'est donc pas effacée de la provenance.

### 3. Import de média : budget de une à quatre hypothèses

Le mode Découpe lexicale ne lance plus systématiquement le même coût :

| Scène et appareil                            | Pipeline maximum                                        |
| -------------------------------------------- | ------------------------------------------------------- |
| Voix nette sur chemin compatible             | Tiny original                                           |
| Voix nette sur chemin équilibré              | Tiny + Base original                                    |
| Voix contrainte ou incertaine, fichier court | original + focus vocal                                  |
| Mix musical court sur appareil équilibré     | original Tiny/Base + focus vocal + séparation spectrale |
| Média de trois à cinq minutes                | deux hypothèses maximum                                 |
| Média de plus de cinq minutes                | éclaireur borné; isolation lourde désactivée            |

La décision croise le profil WASM/WebGPU, la durée, la qualité initiale, la
couverture Silero, l'activité chantée, la différence du focus vocal et la
cohérence stéréo. Les passages instrumentaux peuvent être masqués uniquement
pour l'inférence. La durée, les timecodes et les WAV proviennent toujours de
l'original non filtré.

Le manifeste `voice.word_segmentation.v7` rend la stratégie inspectable : scène,
profondeur réelle, budget, hypothèses, modèle, signal, provider, décodage,
couverture du masque, vitesses réelles de l'éclaireur et du renfort, et compte
des mots récupérés ou rejetés.

### 4. Adaptation au coût réellement observé

Le moteur ne déduit plus la puissance d'un appareil depuis une mémoire déclarée
ou un nombre de cœurs peu représentatif de Safari. Il mesure la durée réelle de
la première transcription et de son VAD, sans compter le téléchargement du
modèle, puis la compare à la durée du média. Si Base est lancé, sa vitesse est
mesurée à son tour et peut encore réduire le travail restant :

- chemin rapide : jusqu'à quatre hypothèses sur un mix musical court;
- chemin modéré : focus vocal conservé, séparation spectrale évitée;
- chemin contraint : une vérification Base reste possible, mais le coût ne peut
  plus être multiplié par quatre;
- fichier long ou profil compatible : les bornes conservatrices restent
  prioritaires.

La classe et les deux facteurs temps réel sont affichés dans le résultat et
écrits dans le manifeste. Le comportement devient ainsi inclusif, explicable et
testable sur n'importe quel moteur de navigateur.

## Expérience utilisateur

### Ce qui a été conservé

- les cinq modes restent organisés par résultat utilisateur, pas par technologie;
- le rituel d'entrée, la courbe et la douceur visuelle ne sont pas redessinés;
- les parcours média restent accessibles sans autoriser le microphone;
- les fonctions expertes demeurent en divulgation progressive;
- les résultats incertains demandent une vérification au lieu d'afficher une
  fausse certitude.

### Ce qui a été simplifié

- la longue explication du mode lexical devient une promesse courte suivie d'un
  détail facultatif;
- le renfort Base n'est téléchargé que lorsque la scène ou le premier résultat
  le justifie;
- le résultat explique en langage humain la scène, la profondeur et le modèle
  retenu;
- le chargement continue d'être matérialisé par la seconde courbe globale pour
  tous les traitements;
- les consoles Découpe lexicale et Doublage sont chargées uniquement à leur
  ouverture. Le JavaScript initial passe de 168,8 à 166,4 Kio compressés, sans
  retirer de fonction et avec la même courbe pendant le chargement du module.

## Inclusivité et appareils

- Chromium peut utiliser WebGPU; une erreur réelle désactive ce chemin pour le
  reste de l'onglet et reconstruit proprement en WASM.
- Safari, Firefox et les contextes sans threads WASM gardent un plan compatible
  avec moins d'hypothèses coûteuses.
- Les fichiers longs réduisent automatiquement le travail et la mémoire.
- WebKit, Firefox, mobile portrait/paysage, tablette et desktop font partie de
  la matrice de mise en page.
- Les contrôles restent nommés, utilisables au clavier et compatibles avec la
  réduction de mouvement; les violations WCAG A/AA sérieuses et critiques sont
  bloquantes en CI.
- Les capacités absentes restent des limitations explicites, jamais des erreurs
  qui empêchent la capture essentielle.

## Chargement, réseau et confidentialité

- aucun audio ni transcript n'est envoyé par le pipeline local;
- les poids Tiny, Base, Silero et le runtime ONNX viennent de la même origine et
  utilisent le cache navigateur;
- la première hypothèse est utile seule, ce qui évite le téléchargement Base
  sur une prise nette;
- les sessions d'inférence sont sérialisées dans un worker partagé;
- l'annulation termine le worker et les travaux ZIP/séparation observent le même
  signal d'annulation;
- le service worker change de révision afin qu'une installation existante ne
  mélange pas ancien shell et nouveau moteur;
- YouTube demeure la seule ressource distante optionnelle et explicite dans le
  mode Doublage.

## Données et export

Les sorties restent conçues comme des preuves et non comme de simples fichiers :

- identité SHA-256 du WAV exact;
- provenance du périphérique et du traitement navigateur;
- métriques de signal et contexte de capture;
- distinction entre G2P estimé, comparaison locale et alignement forcé;
- consensus multi-aligneur importable;
- droits et consentements explicites;
- archives ZIP vérifiées, restauration atomique et refus des collisions;
- compatibilité avec `voice.capture.package.v1` et rapports de préparation.

## Limites qui restent réelles

1. Whisper Tiny/Base ne devient pas un modèle spécialisé paroles par magie. Le
   consensus réduit les erreurs; il ne garantit pas les paroles d'un mix dense.
2. La séparation spectrale livrée est un DSP local déterministe, pas Demucs ou
   MDX-Net. Ajouter un vrai séparateur neuronal demande des poids, un budget de
   cache et une validation WebGPU/WASM par appareil.
3. L'alignement phonétique navigateur reste préparatoire. Un aligneur acoustique
   externe demeure nécessaire avant acceptation premium ou entraînement final.
4. Le français et l'anglais sont couverts; l'interface entière n'est pas encore
   internationalisée.
5. `App.tsx` et plusieurs écrans sont trop grands. Leur décomposition est un
   chantier de maintenabilité, pas un bénéfice utilisateur à mélanger avec ce
   changement audio.

## Prochaine frontière mesurable

Le meilleur prochain investissement n'est pas une cinquième heuristique. C'est
un banc d'essai local et redistribuable : voix nette, bruit, réverbération,
microphone de téléphone, chant a cappella, pop dense, rap, chœurs, voix décentrée,
instrumental pur, français et anglais. Chaque fixture doit fournir transcript,
zones vocales et frontières de mots de référence. Le gate peut alors mesurer :

- WER/CER par scène;
- insertions sur intro, pont et outro instrumentaux;
- mots supprimés par le masque;
- erreur absolue moyenne des frontières;
- temps réel, mémoire de pointe et téléchargement froid/chaud par profil;
- gain ou régression de chaque hypothèse par rapport à l'original.

Sans ce corpus, ajouter un séparateur neuronal serait une promesse. Avec lui, il
devient possible de comparer objectivement un modèle spécialisé chant, un
Demucs/MDX quantifié, ou un autre ASR compact avant de faire payer son poids à
tous les appareils.

Le banc de mesure sait désormais calculer séparément les mots proposés hors des
zones vocales annotées, en plus du WER, CER et de l'erreur de frontières. Cette
métrique bloque le cas trompeur où un pipeline semble récupérer davantage de
paroles uniquement parce qu'il invente des mots dans les passages instrumentaux.

## Références primaires

- Exploiting Music Source Separation for Automatic Lyrics Transcription with
  Whisper: https://arxiv.org/abs/2506.15514
- Investigation of Whisper ASR Hallucinations Induced by Non-Speech Audio:
  https://arxiv.org/abs/2501.11378
- Enhancing Lyrics Transcription on Music Mixtures with Consistency Loss:
  https://arxiv.org/abs/2506.02339
- ONNX Runtime Web — WebGPU execution provider:
  https://onnxruntime.ai/docs/tutorials/web/ep-webgpu.html
- ONNX Runtime Web — execution providers and browser inference:
  https://onnxruntime.ai/docs/tutorials/web/
- Hugging Face Transformers.js generation controls:
  https://huggingface.co/docs/transformers.js/en/api/utils/generation
- MDN SpeechRecognition:
  https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition

## Validation de livraison

### Prépublication locale

- `npm run validate` : formatage, lint et TypeScript validés;
- 200 tests réussis, aucun échec ni test ignoré;
- couverture : 90,07 % lignes, 80,86 % branches, 89,75 % fonctions;
- build de production validé : 166,4 Kio de JavaScript initial pour un budget
  de 170 Kio, 16,0 Kio de CSS pour un budget de 16 Kio;
- 56 parcours Playwright réussis en 45,8 s sur Chromium, WebKit et Firefox;
- matrice vérifiée : téléphones compacts, portrait/paysage, tablette, desktop,
  rotation, PWA hors ligne, accessibilité WCAG A/AA, capture, replay, archives,
  IndexedDB, doublage et vraie analyse locale Tiny/Silero;
- audit navigateur manuel à 390 × 844 : aucun débordement horizontal, aucune
  erreur ou alerte console, aucune ressource issue d'une origine tierce;
- `npm audit --omit=dev` : zéro vulnérabilité connue.

La publication GitHub Pages et les deux workflows distants sont contrôlés après
le push du commit de livraison. Leur résultat final est consigné dans le compte
rendu de livraison afin de ne jamais présenter une validation distante comme
acquise avant son exécution.
