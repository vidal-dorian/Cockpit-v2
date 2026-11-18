# 083 — Le téléphone, deuxième passe

- **Statut** : proposée (à valider à la relecture de la PR)
- **Date** : 2026-11-18
- **Décidé par** : Dorian (le constat, avec cinq captures d'écran de l'app sur iPhone : la liste d'import sans fin, la barre du bas trop petite, l'US qui ne s'ouvre pas depuis le projet, les Réglages introuvables, l'accueil trop chargé, la nuit en double et difficile à lire), avec Claude (les réponses de A à E)
- **Dépend de** : [011 — Import des projets](011-import-projets.md), [040 — L'accueil](040-accueil.md), [044 — La nuit de Claude](044-la-nuit-de-claude.md), [045 — L'interface « Quatre temps »](045-interface-quatre-temps.md) (C, J), [069 — Les finitions](069-finitions.md) (G), [070 — Le matin de la nuit](070-le-matin-de-la-nuit.md), [071 — Les trois gestes au téléphone](071-trois-gestes-au-telephone.md), [075 — La mise en route](075-mise-en-route.md)
- **Modifie** : [045](045-interface-quatre-temps.md) J et [071](071-trois-gestes-au-telephone.md) B (la barre du bas a un cinquième onglet, « Menu ») ; [071](071-trois-gestes-au-telephone.md) « Limites connues » (Claude, Équipes d'agents, Journal, Réglages et « Se déconnecter » sont atteints au téléphone) ; [069](069-finitions.md) G (sous `lg`, une carte du Kanban ouvre la page de l'US ou du ticket) ; [044](044-la-nuit-de-claude.md) J et M', [070](070-le-matin-de-la-nuit.md) E et F (le bloc « Cette nuit » quitte l'accueil pour `/nuit`, et la frise n'est plus qu'un dessin) ; [075](075-mise-en-route.md) C (sous `md`, le guide ne montre que l'étape suivante)
- **Tranche** : aucune du [découpage](../decoupage.md) (retours de Dorian du 2026-11-18)
- **Écrans** : [S11](../ecrans/S11_Importer.png), [S52](../ecrans/S52_Tel_Accueil.png), [S00b](../ecrans/S00b_Kanban.png), [N1](../ecrans/N1_Nuit_Soir.png), [N2](../ecrans/N2_Nuit_Matin.png)

## Contexte

La 071 a rendu les trois gestes possibles au téléphone, sans vérifier le reste de Cockpit. Utilisée pour de vrai sur un iPhone, l'app bute sur cinq points :

1. **Importer depuis GitHub** liste tous les repos ouverts à l'App, sans fin ni recherche ; les noms longs débordent sous le bouton « Importer ».
2. **La barre du bas** est trop petite pour le pouce (des glyphes de 11 px), et rien ne mène aux Réglages, au Journal, à Claude ou aux équipes : quand le lancement dans le cloud est mal configuré, on est bloqué.
3. **Depuis un projet, une US ne s'ouvre pas** : la carte du Kanban ouvre le panneau de droite (069 G), qui, sous `lg`, vient après les six colonnes empilées, des dizaines de cartes plus bas. Rien ne semble se passer. Et sans la page de l'US, pas de « Développer avec Claude » au téléphone.
4. **L'accueil** empile le guide de mise en route en entier, le bloc « Cette nuit » (avec une ligne par US de la nuit), « 1 · Maintenant », « 2 · Ensuite », « Claude en ce moment » et « Dernièrement ». Le bloc de la nuit fait double emploi avec l'onglet Nuit.
5. **L'onglet Nuit** est une suite de listes de texte, sans rien qui se lise d'un coup d'œil ; le bouton pour lancer la nuit est tout en bas.

## Les choix

### A — Importer depuis GitHub (S11), à toutes les largeurs

| # | Question | Décision |
|---|---|---|
| A1 | Chercher | Au-dessus de la liste, dès qu'il y a un repo, un champ `type="search"` nommé **« Chercher un repo »** (placeholder « Chercher un repo… »). Il filtre sans tenir compte de la casse, sur une partie du nom complet (`owner/nom`) |
| A2 | Combien | La liste montre **10 repos**, ceux pas encore importés d'abord (dans l'ordre du serveur), puis ceux déjà importés. Tant qu'il en reste, un bouton **« Afficher plus (23 restants) »** en ajoute 10. Changer la recherche revient à 10 |
| A3 | Aucun résultat | « Aucun repo ne correspond à « xyz ». » |
| A4 | Une ligne | Le nom du repo sans son propriétaire (`repoName`) en gras, en mono, qui passe à la ligne n'importe où plutôt que de déborder (`break-all`) ; dessous, en atténué, « propriétaire · branche par défaut ». Le bouton « Importer » (ou « Déjà importé ») reste à droite |

### B — La barre du bas et le menu (modifie 045 J et 071 B)

| # | Question | Décision |
|---|---|---|
| B1 | La taille | Chaque onglet fait **64 px de haut** au moins ; une icône dessinée en SVG de **24 px** au-dessus du mot, en 12 px. La barre ajoute en dessous la zone de sécurité de l'iPhone (`env(safe-area-inset-bottom)`, avec `viewport-fit=cover` dans `index.html`) ; la marge du bas du contenu et la ligne d'état de la barre d'idée montent d'autant |
| B2 | Le cinquième onglet | **« Menu »**, à droite de « Projets » : un bouton (`aria-expanded`, `aria-haspopup="dialog"`) qui ouvre, en plein écran, une fenêtre nommée « Menu » (la `Modal` de Cockpit). Elle reprend **le contenu de la barre latérale** : Chercher, Accueil, Claude, ☾ Cette nuit, les projets favoris et actifs, Tous les projets, + Importer un repo, Équipes d'agents, Journal, Réglages, le compte, « Se déconnecter » et la version. Chaque ligne y fait au moins 44 px de haut. En haut, un bouton « Fermer » ; Échap et le geste retour d'Android la ferment aussi |
| B3 | Toucher une ligne du menu | Ferme le menu et ouvre la page. « Chercher » ferme le menu et ouvre la fenêtre de recherche (073) |
| B4 | L'onglet en blanc | « Menu » est en blanc quand la fenêtre est ouverte, et aussi sur une page que seul le menu atteint (`/claude…`, `/equipes…`, `/journal`, `/reglages…`), avec `aria-current="page"` dans ce dernier cas. Ouvrir le menu ferme le panneau « Noter une idée » en gardant le brouillon, comme les autres onglets (071) |
| B5 | Le bilan de la nuit à lire | Tant qu'un bloc « Cette nuit » attend (la charge `night` de `GET /api/home`, voir E1), l'onglet « Nuit » porte un point vert (`Dot tone="done"`) et son nom accessible devient « Nuit, bilan à lire » |
| B6 | Au-dessus de `md` | Rien ne change : pas de barre du bas, la barre latérale à gauche |

### C — Le Kanban au téléphone (modifie 069 G sous `lg`)

| # | Question | Décision |
|---|---|---|
| C1 | Une colonne à la fois | Sous `sm` (640 px), une rangée de puces au-dessus du tableau, une par colonne avec son nombre (« À valider 2 », « Prêtes 32 »…), des boutons `aria-pressed` dans un groupe nommé « Colonne affichée ». Seule la colonne choisie s'affiche sous `sm` ; à partir de `sm`, les puces disparaissent et les six colonnes sont là comme aujourd'hui |
| C2 | La colonne par défaut | La première non vide parmi « À valider », « Prêtes » et « En revue » (ce qui attend l'utilisateur) ; sinon la première non vide du tableau ; sinon « Idées » |
| C3 | Toucher une carte | Sous `lg` (1024 px, là où le panneau de droite n'est plus fixé à droite), une carte d'US ouvre **la page de l'US** (`/us/:id`, où sont Valider, Renvoyer et « Développer avec Claude ») et une carte d'idée **la page du ticket** (`/tickets/:id`). La largeur est lue au moment du toucher (`matchMedia`). À partir de `lg`, rien ne change : `?us=` et `?ticket=` ouvrent le panneau (069 G) |
| C4 | La phrase d'aide | « Pas de glisser-déposer : un clic ouvre la carte à droite. » ne s'affiche qu'à partir de `lg`, la seule largeur où elle est vraie |

### D — L'accueil allégé au téléphone (modifie 075 C sous `md`)

| # | Question | Décision |
|---|---|---|
| D1 | Le guide de mise en route | Sous `md`, il ne montre que **l'étape suivante** (avec « Faire ») ; un bouton **« Voir les 7 étapes »** (`aria-expanded`) déplie les autres et « Pourquoi cet ordre », et devient « Masquer les étapes ». À partir de `md`, le guide est entier comme aujourd'hui, sans ce bouton |
| D2 | « Dernièrement » | Caché sous `md` : le Journal est dans le menu (B2) |
| D3 | Une ligne de « 2 · Ensuite » | Sous `sm`, ses boutons passent sous le titre, alignés sur le texte : le titre s'affiche sur deux lignes au plus au lieu d'être coupé après quelques lettres. À partir de `sm`, rien ne change |
| D4 | Le bloc « Cette nuit » | Il quitte l'accueil, à toutes les largeurs : voir E1 |

### E — La nuit, plus simple et plus visuelle (modifie 044 J et M', 070 E et F)

| # | Question | Décision |
|---|---|---|
| E1 | Où est le matin | Le bloc « Cette nuit » quitte l'accueil et vient **en tête de `/nuit`**, avec les mêmes données (`night` de `GET /api/home`), le même « Masquer » et la même durée de vie (jusqu'à la nuit suivante ou « Masquer »). Le lien « Voir ce que Claude a fait cette nuit » de `/nuit` disparaît. La notification du matin (072) mène déjà à Cockpit ; la barre du bas le signale (B5) |
| E2 | Le bilan d'un coup d'œil | Sous le titre « ☾ Cette nuit, Claude a livré N PR sur M » (et « 1 question t'attend » quand il y en a), **quatre cases** : « PR livrées » (`N/M`), « Travail » (la durée, « 0 min »), « Critères prouvés », « Échecs » (« aucun » à 0). Le nombre en grand (22 px), le mot dessous en atténué ; deux colonnes sous `sm`, quatre à partir de `sm`. Puis **une barre empilée** (`role="img"`) : une part par issue, PR ouvertes (`bg-done`), en pause (`bg-you`), en échec (`bg-border-strong`), sautées ou non lancées (`bg-raised`), avec pour nom accessible le décompte (« 1 PR ouverte, 1 en pause, 3 en échec, 32 sautées ou non lancées ») |
| E3 | Les US de la nuit | **Rangées par issue**, chaque groupe avec son point, son nom et son nombre : « PR ouvertes », « En pause : attend ta réponse », « En échec » (`failed`, `ci_failed`), « Sautées ou non lancées » (`skipped`, `not_started`). Un groupe vide ne s'affiche pas ; le dernier est replié (`<details>`). Chaque ligne : « US 12 · … » en lien vers `/us/12`, et ses heures quand elle a tourné (« 1 h 05 → 1 h 40 ») |
| E4 | La frise (070 F) | Gardée, mais **seulement à partir de `md`** et comme un dessin (`aria-hidden`) : ses graduations ne tiennent pas en 360 px, et la liste de E3 dit déjà tout |
| E5 | Le soir (N1) | Le bouton **« ☾ Lancer la nuit · N user stories »** (ou « Annuler la nuit », « Arrêter la nuit ») monte **juste sous la phrase d'état**, avant les listes ; quand il est désactivé faute de lanceur, la raison dit « Connecte le lanceur dans les Réglages. » avec un lien « Réglages » vers `/reglages/taches-cloud` |
| E6 | Le programme | Chaque ligne commence par son rang (un rond « 1 », « 2 »…), puis l'US et le nom du repo sans son propriétaire. Les boutons ↑ ↓ ✕ font 44 px sous `md`. Pendant la nuit, au-dessus de la liste, « 2 sur 5 finies » et une barre de progression (`role="progressbar"`) ; chaque ligne porte son état avec son point : « En cours » (point Claude qui pulse) pour la première US sans issue d'une nuit qui tourne (une US à la fois, 044), « À venir » pour les suivantes, sinon son issue |
| E7 | Les règles | « Les règles de la nuit » se replient (`<details>`, fermé par défaut) |

## Ce qui ne change pas

- Au-dessus de `md` : la barre latérale, l'accueil (sauf le bloc « Cette nuit », E1), le Kanban à partir de `lg`.
- Les routes du serveur : aucune nouvelle, aucune modifiée. Le filtre et la pagination de A sont dans la page.
- Les trois gestes de la 071 (C à G).

## Limites connues

- **La mise en page n'est pas testée par la CI** (jsdom ne la calcule pas, 071) : les tests lisent les classes responsives et `matchMedia` est simulé ; la vérification à 360 px se fait dans un vrai navigateur.
- **La largeur de C3 est lue au toucher** : une carte garde son lien `?us=` (un appui long ou un clic du milieu ouvre le panneau, en bas de page).
