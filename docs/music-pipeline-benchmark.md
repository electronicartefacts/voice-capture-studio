# Banc de qualité parole et chant

Le pipeline musical ne doit pas être évalué uniquement avec des signaux
synthétiques. Chaque évolution doit être mesurée sur des extraits dont le
projet possède les droits, avec paroles et frontières de mots de référence.

## Matrice minimale

- texte lu propre et texte lu avec musique de fond ;
- a cappella ;
- pop stéréo avec voix centrée ;
- mix mono ;
- rap rapide ;
- rock dense ;
- voix classique ou très vibrée ;
- réverbération, harmonies et chœurs ;
- français et anglais, puis chaque langue réellement supportée.

Chaque famille doit contenir au moins deux voix et deux qualités d'encodage.
Les médias restent locaux et ne sont jamais intégrés au dépôt sans droits.

## Mesures de sortie

`evaluateMusicPipeline()` calcule le taux d'erreur par mot, le taux d'erreur
par caractère, les insertions, suppressions, substitutions, la couverture des
mots et l'erreur absolue moyenne des frontières temporelles.

Une livraison est acceptable si elle ne régresse pas la parole lue, réduit les
hallucinations musicales et garde une erreur moyenne de frontière inférieure à
120 ms sur les mots correctement reconnus. Il faut également relever le temps
réel de traitement, le pic mémoire, le poids téléchargé et les échecs par
navigateur/appareil.
