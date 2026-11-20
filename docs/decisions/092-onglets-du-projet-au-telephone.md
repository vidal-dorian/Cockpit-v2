# 092 — Au téléphone, un dégradé montre qu'il reste des onglets (ticket #53)

- **Statut** : proposée (à valider à la relecture de la PR) ; le code est construit
- **Date** : 2026-11-20
- **Décidé par** : Dorian (ticket #53 : « au téléphone, voir qu'il reste des onglets »), avec Claude
- **Dépend de** : [080 — Le polish](080-polish-mouvement-et-retours.md) (I), [045 — L'interface « Quatre temps »](045-interface-quatre-temps.md) (le budget de couleur)
- **Modifie** : 080, choix I (la barre d'onglets défile toujours sans barre visible, mais ne le cache plus : un dégradé signale la suite)

## Le choix

| Question | Décision |
|---|---|
| Le constat | Sous `md`, la rangée d'onglets d'un projet défile sans barre de défilement (080 I) : sur 360 px, « CI / CD », « Historique » et « Réglages » sont hors de l'écran, sans rien qui le dise |
| Le signal | Tant qu'il reste des onglets cachés à droite, le bord droit de la barre s'efface en dégradé (masque de 40 px) ; arrivé au bout, le dégradé disparaît. Un masque, pas une couleur : aucun jeton ni couleur en dur, et le fond (sombre ou clair) reste celui de la page |
| L'état | `ProjectPage.tsx` mesure la barre au montage et à chaque défilement : cachés à droite quand `scrollLeft + clientWidth < scrollWidth - 1`. Il l'expose en `data-more-right` (`true` / `false`) sur le `<nav>` « Sections du projet », ce qui le rend testable dans jsdom |
| Ce qui reste de 080 I | Une seule ligne, défilement horizontal, barre de défilement cachée ; au-dessus de `md`, les onglets passent à la ligne comme avant |

## Limites connues

- Seul le bord droit est traité : la barre part de la gauche, et un défilement vers la gauche ne cache rien d'important.
- L'état se mesure au montage et au défilement, pas quand la fenêtre change de taille (une rotation de l'écran ne le remesure qu'au prochain défilement).
- Le masque n'utilise aucune transformation : le panneau fixe de droite n'est pas décroché.
