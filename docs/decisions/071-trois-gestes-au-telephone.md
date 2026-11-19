# 071 — Les trois gestes au téléphone

- **Statut** : proposée (à valider à la relecture de la PR) ; le code est construit (tranche 15.1)
- **Date** : 2026-11-09
- **Décidé par** : Dorian, avec Claude ([064](064-tranches-restantes.md) 15.1)
- **Dépend de** : [003 — Interface](003-interface.md) (point ouvert 4), [018 — Décisions humaines](018-decisions-humaines.md), [036 — Questions de Claude](036-questions-de-claude.md), [045 — L'interface « Quatre temps » et les écrans de référence](045-interface-quatre-temps.md) (F, J), [055 — Les tickets complets](055-tickets-complets.md) (D, le panneau « Noter une idée »), [061 — Les pièces jointes](061-pieces-jointes.md) (F)
- **Modifie** : 045 F (sous `lg`, le panneau de l'accueil suit « 1 · Maintenant », pas le bas de la page)
- **Tranche** : 15.1 du [découpage](../decoupage.md)
- **Écrans** : [S52](../ecrans/S52_Tel_Accueil.png), [S53](../ecrans/S53_Tel_Repondre.png), [S54](../ecrans/S54_Tel_ValiderUS.png), [S55](../ecrans/S55_Tel_NoterIdee.png)

## Contexte

Sur un téléphone, Cockpit montre aujourd'hui la barre latérale entière en haut de chaque page, la barre d'idée en bas, et le panneau de droite à la fin de la page (045 F : « sous `lg`, il suit le contenu »). Les trois gestes de la 003 (noter une idée, valider une US, répondre à Claude) existent tous, mais rien n'a été vérifié en largeur téléphone. La 045 J a fixé la barre du bas (Accueil, Idée, Nuit, Projets) et la 064 15.1 a tranché « Photo » oui, « Dicter » non.

## Les choix

| # | Question | Décision |
|---|---|---|
| A | Qu'est-ce que la « largeur téléphone » ? | Sous `md` (768 px), le point où la coque passe déjà d'une colonne à deux (`md:grid-cols-[224px_…]`). Vérifiée à **360 px** de large, la plus petite largeur courante |
| B | La barre du bas (045 J) | Sous `md`, la barre latérale est cachée et une barre fixe en bas de l'écran la remplace : **Accueil** (`/`), **Idée**, **Nuit** (`/nuit`), **Projets** (`/projets`), une icône au-dessus du mot comme sur S52, l'onglet de la page en cours en blanc (`NavLink`, `aria-current`). Un `<nav aria-label="Navigation du téléphone">`. Le contenu garde une marge en bas pour que la barre ne cache rien. Au-dessus de `md`, rien ne change |
| C | « Idée » | L'onglet est un bouton : il ouvre le panneau « Noter une idée » de la 055 D, **plein écran** sous `md` (S55). C'est le même panneau, avec le même brouillon que la barre d'idée : mêmes champs, même envoi, même message « Idée notée dans … ». La barre d'idée elle-même est cachée sous `md` (l'onglet la remplace). Sans projet, pas d'onglet Idée (la barre d'idée est cachée sans projet, 045 F) |
| D | « Photo » (064 15.1) | Dans le panneau, sous `md`, un bouton « Photo » : un `<input type="file" accept="image/*" capture="environment">` qui ouvre l'appareil photo. L'image suit le chemin des fichiers choisis avec « Joindre » (061 F) : mêmes contrôles, même liste, envoyée une fois le ticket créé. Au-dessus de `md`, pas de bouton Photo (« Joindre » ouvre déjà le choix de fichiers). **Pas de « Dicter »** : le micro du clavier du téléphone le fait déjà |
| E | Répondre à Claude (S53) | **Modifie la 045 F** : le panneau de l'accueil (l'élément ouvert, avec ses réponses proposées) vient dans la page **juste après « 1 · Maintenant »** au lieu de la fin de la page. Sous `lg`, la carte « Maintenant » se cache : le panneau, juste en dessous, montre le même élément avec de quoi y répondre. Au-dessus de `lg`, rien ne change (le panneau reste fixé à droite). « Répondre » d'une ligne de « 2 · Ensuite » ouvre l'élément dans ce panneau et y porte le focus, comme aujourd'hui. Sur la page d'un run, la question reste dans son panneau, sous le contenu |
| F | Valider une US (S54) | La page d'une US (`/us/:id`) : l'histoire et ses critères, puis le panneau avec « Valider » et « Renvoyer à Claude » (018), dans cet ordre, comme S54. Sur l'accueil, « Valider » d'une ligne agit sur place comme aujourd'hui. Pas de nouvel écran |
| G | « Sans zoom ni défilement latéral » | À 360 px de large, l'accueil, la page d'une US, la page d'un run avec une question et le panneau « Noter une idée » ne défilent pas de côté : ce qui déborde passe à la ligne ou se coupe (`min-w-0`, `truncate`, `break-words`, grilles qui passent à une colonne). Les champs de saisie font **16 px** sous `md` : en dessous, Safari sur iPhone zoome sur le champ touché. Les boutons et les onglets de la barre font au moins 44 px de haut (cible tactile) |

## Ce que le code a précisé (tranche 15.1)

- **La barre du bas est rendue par `IdeaBar`** (`Shell.tsx`), donc elle partage l'état du panneau ; elle apparaît quand `/api/home` a répondu (l'onglet Idée dépend des projets).
- **Toucher un autre onglet que Idée pendant que le panneau est ouvert** le ferme et garde le brouillon. À la fermeture, le focus revient à l'onglet Idée, ou au champ de la barre d'idée si l'onglet n'est pas affiché.
- **Seul « Idée » est en blanc** tant que le panneau est ouvert, avec `aria-expanded` ; les autres onglets ne le sont pas.
- **Sous `md`, panneau ouvert**, la colonne de la page derrière lui est `inert` ; la barre du bas ne l'est pas. C'est décidé à l'ouverture : redimensionner la fenêtre de part et d'autre de `md` pendant que le panneau est ouvert laisse l'état périmé (`shortcut:` du code).
- **Les jetons de `src/web/ui.ts` changent pour toutes les pages sous `md`**, pas seulement pour les trois gestes : `field` fait 16 px et 44 px de haut, `buttonSize` et `panelSize` font 44 px. Au-dessus de `md`, tailles et interligne sont inchangés.
- **L'en-tête de page** (`StateSentence`) passe à la ligne sous `md` seulement. **La colonne d'âge** des lignes de « 2 · Ensuite » est cachée sous `sm`.
- **Sur ordinateur aussi**, l'ordre de lecture et de Tab de l'accueil change : le panneau vient après « 1 · Maintenant » et avant « 2 · Ensuite ».
- **La ligne d'état de la barre d'idée** (erreur, « Idée notée… ») monte au-dessus de la barre du bas (`max-md:bottom-16`).

## Limites connues

- **Ce que la barre du bas n'atteint pas** : Claude, Équipes d'agents, Journal, Réglages et « Se déconnecter » n'ont pas d'onglet ; sur le téléphone, on y arrive par leur adresse. *Depuis la [084](084-le-telephone-deuxieme-passe.md) B, l'onglet « Menu » les atteint.* La 15.1 couvre les trois gestes (064), pas tout Cockpit en largeur téléphone.
- **Les autres pages** (Kanban, Conception, équipes, réglages…) ne sont pas vérifiées à 360 px, mais les jetons de 44 px et de 16 px (voir plus haut) les atteignent : leurs champs et leurs boutons y sont plus grands qu'avant.
- **« Sans défilement latéral » n'est pas testé par la CI** : les tests (jsdom) ne calculent pas la mise en page ; la vérification à 360 px se fait dans un vrai navigateur au développement.
- **Pas construits, de S52 à S55** : « à relire sur ordinateur » d'une PR, « Plus tard » de S54 et le titre de l'idée en gros de S55 ; le panneau « Noter une idée » montre aussi la priorité et les étiquettes, absentes de S55.
