# 080 — Le polish : mouvement, chargements et retours

- **Statut** : proposée (à valider à la relecture de la PR) ; le code est construit
- **Date** : 2026-11-09
- **Décidé par** : Dorian (« repasse sur toute l'application : animations, affichage, UX »), avec Claude
- **Dépend de** : [003 — Interface](003-interface.md) (focus visible, Tailwind + shadcn/ui), [045 — L'interface « Quatre temps »](045-interface-quatre-temps.md) (C, les jetons et le budget de couleur ; E, les formes : pas d'ombre sur ce qui est posé), [073 — L'ergonomie](073-ergonomie.md) (les fenêtres `Modal`, le thème clair)
- **Modifie** : rien ; précise 045 E pour le mouvement, qu'elle ne réglait pas
- **Écrans** : tous

## Contexte : l'audit

Toute l'application a été parcourue dans Chromium (bureau 1440 px et téléphone 390 px, données de démonstration : un projet avec tickets, US à chaque étape, un run en cours avec une question), puis le code de `src/web` relu pour les mêmes points. Le dessin est cohérent (jetons, formes de la 045, budget de couleur) ; ce qui manque, c'est **le mouvement et les retours** : l'application change d'état sans transition, ce qui la fait paraître sèche et parfois cassée.

| # | Constat | Où | Gravité |
|---|---|---|---|
| 1 | **Aucune transition** : survol, focus, onglet actif, bouton pressé changent d'un coup. Deux fichiers seulement en ont une (les interrupteurs de Préférences, la fenêtre d'import). | partout | haute |
| 2 | **En changeant de page, on garde le défilement de la page d'avant** : `BrowserRouter` ne remet pas en haut, on arrive au milieu (ou au bas) de la nouvelle page. | navigation | haute |
| 3 | **Les boutons ont le curseur flèche** : Tailwind 4 ne met plus `cursor: pointer` sur `<button>` ; un bouton désactivé ne dit pas qu'il l'est au survol. | partout | moyenne |
| 4 | **50 « Chargement… » bruts** : un texte gris qui apparaît dès la première milliseconde, puis disparaît ; sur une réponse rapide, il clignote. | 37 écrans | moyenne |
| 5 | **Les pages, le panneau de droite et les fenêtres apparaissent d'un bloc** : seule la fenêtre d'import (074) a une entrée ; la recherche `Ctrl K`, `?`, les confirmations n'en ont pas, et leur fond n'isole pas la page. | `Modal`, `Panel`, `<main>` | moyenne |
| 6 | **Les messages de retour** (« Idée notée dans recettes. », les erreurs) surgissent sans signal. | `role="status"`, `role="alert"` | basse |
| 7 | **Le point « Claude travaille »** clignote (`animate-pulse` : il s'éteint à moitié), ce qui ressemble à une alerte plus qu'à une activité. | barre latérale, accueil | basse |
| 8 | **Au téléphone, les onglets d'un projet passent sur deux lignes** (« CI / CD · Historique · Réglages » à la ligne). | page d'un projet | moyenne |
| 9 | **Le contenu passe sous la barre d'idée** et y est coupé net. | toutes les pages à projet | basse |
| 10 | **Les sections repliables** (« Historique », « Connecter Claude depuis le CLI ») s'ouvrent d'un coup, leur flèche saute. | `<details>` | basse |
| 11 | La sélection de texte et les barres de défilement gardent les couleurs du système, hors jetons. | partout | basse |
| 12 | Aucun respect global de « réduire les animations » : seules les deux animations existantes le testent. | partout | moyenne (accessibilité) |

Vus et **gardés tels quels** : les états vides en une phrase (« Aucune équipe pour l'instant. ») restent sobres, comme les veut la 045 ; le champ « Autre réponse… » centré suit S29 ; les erreurs GitHub (« GitHub ne répond pas comme prévu ») ont déjà leur phrase et leur bouton « Réessayer ».

## Les choix

| # | Question | Décision |
|---|---|---|
| A | Les durées et la courbe | Trois durées dans `styles.css` : **120 ms** (`--duration-fast` : survol, pression), **180 ms** (`--duration-base` : couleurs, apparition d'un message), **280 ms** (`--duration-slow` : une page, le panneau, une fenêtre). Une seule courbe, qui part vite et se pose (`--ease-out`, `cubic-bezier(0.22, 1, 0.36, 1)`, celle de la fenêtre d'import). Rien au-delà de 320 ms pour une réponse à un geste |
| B | Les transitions (1, 3) | Une règle de base sur `a`, `button`, `summary`, `input`, `select`, `textarea`, `[role="button"]` : couleur, fond, bordure, contour, ombre, opacité et transformation (`transform`, `translate`, `scale`) glissent en 120 ms. Le curseur est une main sur ce qui se clique, « interdit » sur ce qui est désactivé |
| C | La pression | Les boutons de `ui.ts` (et les flèches du panneau) se tassent à 97 % quand on appuie, s'ils sont actifs (ni `disabled`, ni `aria-disabled`) |
| D | Le défilement (2) | À chaque nouvelle page (lien, `navigate`), la fenêtre remonte en haut ; **Précédent / Suivant** gardent ce que fait le navigateur. Un changement de `?us=` ou `?ticket=` (le panneau du Kanban) ne fait pas remonter |
| E | Les entrées (5) | Une page (`<main>`) apparaît en fondu (280 ms), sans montée : une transformation sur `<main>` ou un de ses enfants décrocherait le panneau fixe, et l'exclure de l'animation la ferait rejouer à la fermeture du panneau ; le panneau de droite glisse de 16 px depuis la droite (lg ; en dessous, où il suit le contenu, il apparaît seulement en fondu) ; chaque `Modal` reprend l'entrée de la fenêtre d'import et son fond floute légèrement la page. Pas d'animation de sortie : fermer doit être immédiat |
| F | Les chargements (4) | La classe `loading` sur chaque « Chargement… » : le texte reste (lecteurs d'écran, tests), précédé d'un petit anneau qui tourne, et **n'apparaît qu'après 300 ms** : une réponse rapide ne fait plus clignoter la page |
| G | Les messages (6) | Tout `role="status"` et `role="alert"` apparaît en fondu, en montant de 4 px (180 ms) |
| H | Le point vivant (7) | Le point reste allumé ; un halo de sa couleur s'en échappe toutes les 2 s, comme une respiration ; sous « réduire les animations », un anneau fixe |
| I | Les onglets au téléphone (8) | Sous `md`, la rangée d'onglets d'un projet défile horizontalement sur une ligne, sans barre de défilement visible |
| J | La barre d'idée (9) | Un dégradé du fond, de 16 px (la marge au-dessus de la barre), au-dessus de la barre : le contenu s'efface en passant dessous |
| K | Les sections repliables (10) | La flèche tourne de 90° à l'ouverture ; le contenu s'ouvre en hauteur dans les navigateurs qui savent animer `::details-content` (Chromium), d'un coup ailleurs |
| L | Sélection et défilement (11) | La sélection prend la teinte « Claude » à 35 % ; les barres de défilement sont fines, couleur `border-strong`. Aucun nouveau jeton de couleur |
| M | Réduire les animations (12) | Sous `prefers-reduced-motion: reduce`, toute animation et toute transition durent 0,01 ms : les états changent, sans mouvement |

## Limites connues

- **Pas d'animation de sortie** (fenêtres, panneau, messages) : elle demanderait de garder l'élément monté le temps de l'animation. Choisi : fermer est immédiat.
- **Un même écran qui change de paramètre** (`/us/1` → `/us/2`) garde son `<main>` : il ne rejoue pas l'entrée, seul le défilement remonte.
- **Un message déjà affiché dont seul le texte change** (`role="status"` qui reste monté) ne rejoue pas le fondu ; le panneau de droite qui change de clé (J / K, une autre carte) rejoue son entrée.
- **Le titre « Chargement… » du Kanban** (dans le `h1`) n'a pas d'anneau : un anneau n'a pas sa place dans un titre.
- **Les boutons ne montraient pas d'attente** pendant une requête : fait par la [081](081-retours-d-action.md).
- **Les animations ne sont vérifiées qu'à l'œil dans Chromium** : les tests (jsdom) ne jouent pas le CSS ; ils vérifient le défilement, la classe des fenêtres et des chargements.
