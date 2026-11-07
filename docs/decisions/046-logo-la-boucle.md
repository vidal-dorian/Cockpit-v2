# 046 — Le logo : la boucle

- **Statut** : validée
- **Date** : 2026-11-07
- **Décidé par** : Dorian, avec Claude
- **Dépend de** : [045 — L'interface « Quatre temps »](045-interface-quatre-temps.md) (les quatre temps et leurs couleurs), [041 — Le nom du produit](041-nom-et-site-vitrine.md) (le logo doit aussi marcher avec « Dirigo »)
- **Modifie** :
  - la [028](028-creme-sombre-onglets-journal.md), choix D : le logo n'est plus les deux mains qui se serrent, mais la boucle ; l'animation au survol change ;
  - la [045](045-interface-quatre-temps.md), « Ce qui est repoussé » : le logo est tranché.
- **Amendée le 2026-11-07, à la demande de Dorian** (qui a vu le point sur les écrans de référence) : le point du centre est visible au repos, dans le logo et dans le favicon, et non plus seulement pendant le vortex (choix A, C, E et limites connues). Le reste est inchangé.
- **Maquettes** : rangées « Logo » et « la boucle » du canevas (https://claude.ai/artifact/XAteTYa7tQBcCGq8HpRF7C), planches L0 à L9

## Contexte

Le logo des deux mains (028 D) a été dessiné pour « Crème sombre ». Il est très large (2,2 fois plus large que haut), donc illisible en icône carrée et en favicon, et ses couleurs ne sont plus celles de l'interface (045). Six pistes ont été comparées aux tailles où un logo doit tenir : icône d'app, favicon de 16 px, barre latérale, avec le nom, en une seule couleur. Dorian a choisi **la boucle**, puis sa variante « dans le sens de la boucle ».

Pour l'animation, il a proposé **le vortex**, comparé à trois autres idées (chaque temps à son tour, l'arc rouge qui respire, le tracé). Il n'a gardé que le vortex.

## Les choix

| # | Question | Décision |
|---|---|---|
| A | La forme ? | **Quatre arcs** sur un cercle, dans un carré de 120 × 120 (centre 60, 60 ; rayon 40). Les angles se comptent depuis le haut, dans le sens des aiguilles d'une montre. L'arc `i` (0 à 3) va de `90 × i + 10°` à `90 × i + 72°`. Chaque arc **part fin et finit épais**, dans le sens de la boucle : sa largeur passe de **7** à **22**, en suivant `7 + 15 × t^0,8` (`t` de 0 à 1 le long de l'arc), avec un bout arrondi à chaque extrémité. Au centre, **un point** de rayon 7, de la couleur du texte, visible au repos. Rien d'autre dans le logo |
| B | Les couleurs ? | Les quatre temps de la 045, dans l'ordre de la boucle : arc 0 **idée** `#f5c542`, arc 1 **tu décides** `#ff5d6e`, arc 2 **Claude développe** `#7c8cff`, arc 3 **terminé** `#34d399`. Ce sont des jetons de `styles.css` (`--logo-idea`, `--logo-you`, `--logo-claude`, `--logo-done`), comme les couleurs de l'ancien logo : aucune couleur en dur dans le composant (003). Le logo est le seul endroit de l'interface où les quatre couleurs apparaissent ensemble ; partout ailleurs, le budget de couleur de la 045 C s'applique |
| C | L'animation ? | **Le vortex, au survol du logo**, une fois par survol (3,6 s). La boucle est d'abord au repos (0 à 14 %), puis elle tourne de plus en plus vite (deux tours à 50 %). Elle s'aspire au centre en tournant encore (un tour et demi de plus, réduite à 6 % entre 68 et 76 %), pendant que le **point du centre**, déjà là au repos, gonfle à 150 % (de 64 à 78 %, au plus fort à 70 %) puis reprend sa taille. Puis elle revient d'un coup, un peu trop grande (110 % à 92 %), avant de se poser (100 %). Courbe d'ensemble `cubic-bezier(.4, 0, .2, 1)`, accélération `cubic-bezier(.6, 0, 1, 1)` entre 50 et 68 %. Avec « réduire les animations » (`prefers-reduced-motion: reduce`), rien ne bouge |
| D | Le composant ? | `Logo` garde la même interface : décoratif (`aria-hidden`) sans `label`, image nommée avec un `label`, et la classe donnée s'ajoute à `logo`. Il dessine les quatre arcs (`.logo-arc`, un par temps, dans l'ordre) dans un groupe qui tourne (`.logo-loop`), et le point du centre (`.logo-core`). Dans la barre du haut, il est carré, à côté de « Cockpit » |
| E | Le favicon ? | Le même dessin, point du centre compris, en SVG, dans `src/web/public/favicon.svg`, déclaré par `index.html` (`<link rel="icon" type="image/svg+xml">`). Il n'y avait pas de favicon jusqu'ici. Le point y est clair (`#f2f4f8`) et devient sombre (`#0e1015`) sur un onglet clair (règle `prefers-color-scheme: light` dans le SVG) |
| F | Avec le nom ? | Le logo, carré, vaut 1,15 fois la taille du texte du nom (`font-size`), à gauche du nom, espacé d'un tiers de cette taille : dans la barre du haut, `size-5` à côté de « Cockpit » en `text-lg`, avec `gap-1.5`. Il marche aussi avec « Dirigo » si le nom change (041) : seul le mot change |

## Ce qui est repoussé

- **Une version en une couleur** (les quatre arcs dans la couleur du texte), pour les fonds chargés ou l'impression : à ajouter quand le besoin vient.
- **Les icônes d'app pour le téléphone** (PNG en plusieurs tailles, manifeste) : avec la PWA, tranche 15.2.
- **Le logo animé comme indicateur de chargement** et les autres idées d'animation : pas retenues.

## Limites connues

- Si la souris quitte le logo pendant le vortex, l'animation s'arrête et la boucle revient d'un coup à sa place, comme l'ancien logo.
- Le favicon garde les couleurs des arcs sur un onglet clair comme sur un onglet sombre : le jaune y est moins contrasté sur fond blanc. Seul le point du centre change de couleur selon l'onglet.
