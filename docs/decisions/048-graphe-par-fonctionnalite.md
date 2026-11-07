# 048 — Le graphe par fonctionnalité

- **Statut** : proposée (à valider à la relecture de la PR)
- **Date** : 2026-11-07
- **Décidé par** : Claude, pour Dorian (« lance la prochaine étape s'il ne manque aucune information ») ; à valider à la relecture
- **Dépend de** : [007 — Reprendre une app existante](007-reprise-app-existante.md) (l'écran « Conception », la vue « Par fonctionnalité », l'export Markdown), [043 — La carte du code](043-carte-du-code.md), [047 — Les règles et l'écran de reprise](047-ecran-de-reprise.md)
- **Tranche** : R3 du [découpage](../decoupage.md), phase 10
- **Écran** : [S43](../ecrans/S43_Reprise_Graphe.png)

## Contexte

La 007 décrit la vue « Par fonctionnalité » de l'écran « Conception » : un graphe sur le modèle de grepo, avec quatre sortes de nœuds (acteur, fonctionnalité, règle, objet), où un clic sur une règle mène à l'écran de reprise. Démo : je clique une règle dans le graphe et j'arrive sur l'écran de reprise.

La 007 ne laisse aucun point ouvert pour R3. Cette décision fixe seulement ce qu'elle ne dit pas : d'où viennent les données, la route, le placement, ce que fait chaque clic et le format de l'export. Elle ne revient sur aucun choix de la 007, de la 043 ni de la 047.

## Les choix

| # | Question | Décision |
|---|---|---|
| A | D'où vient le graphe ? | Rien n'est stocké de plus. **Fonctionnalité** = un ticket « Reprise : … » du projet, non abandonné (son titre sans « Reprise : »). **Acteur** = le « en tant que » de ses US de reprise non abandonnées, sans doublon (comparé sans tenir compte de la casse ni des espaces au bord). **Règle** = un critère de reprise de ces US, quel que soit le statut de l'US. **Objet** = un nom de `object_names`, résolu contre la carte (043) : présent ou « non cartographié » |
| B | Les liens ? | Ceux de la 007 : un acteur **utilise** une fonctionnalité (une de ses US a ce « en tant que ») ; une fonctionnalité **respecte** une règle ; une règle **manipule** un objet ; un objet **référence** un objet (les liens de la carte entre deux objets affichés) |
| C | La route ? | `GET /api/projects/:id/features` : les fonctionnalités de reprise du projet, chacune avec ses acteurs et ses règles (phrase, état, statut de l'US, Étant donné / Quand / Alors, sources, objets avec `inMap`), et les liens de la carte entre les objets cités. Réservée aux membres, comme les autres routes de la carte (043 G) ; une lecture, sans entrée d'historique |
| D | L'état d'une règle ? | Un mot sur son nœud, pas une couleur (045 C) : **« à trancher »** (`pending`), **« voulue »** (`kept`). « Figée » arrive avec R4. Un bug a quitté l'US (047 E) et n'apparaît plus |
| E | Où est l'écran ? | La troisième puce de l'onglet « Conception », **« Fonctionnalités »** (S43), sur `/projets/:id/conception/fonctionnalites` ; `?f=<id du ticket>` choisit la fonctionnalité, la première par défaut. Phrase d'état : « « Facturer » : 2 acteurs, 3 règles, 2 objets. » et « Un clic sur une règle ouvre l'écran de reprise. ». Bouton secondaire « Exporter en Markdown » en haut à droite |
| F | Le placement ? | **Quatre colonnes fixes** comme S43 : Acteurs, Fonctionnalités, Règles, Objets, chacune avec son titre. React Flow (déjà là, 031) dessine les nœuds et les liens ; l'ordre dans chaque colonne limite les croisements (`@dagrejs/dagre`, déjà là, 043). **Toutes les fonctionnalités** sont dessinées : la fonctionnalité choisie et ce qui la touche sont « en clair », le reste en gris (S43 : « En clair : ce qui touche « Facturer ». En gris : le reste de l'application. ») |
| G | Les clics ? | **Fonctionnalité** : la choisit (`?f=`). **Règle** : si son US est à valider, l'écran de reprise sur cette règle (`/conception/regles?regle=<id>`, 047 I) ; sinon, la page de son US. **Objet de la carte** : la vue « Modèle » sur cet objet (`?objet=`, 047). **Objet non cartographié** : gris, en pointillé, avec la phrase et le bouton « Relancer l'analyse » de la 047 J. **Acteur** : rien, il n'a pas de page |
| H | Clavier, lecteurs d'écran, téléphone ? | Comme la 043 J : la bascule « Graphe / Liste », et la liste montre les quatre catalogues (acteurs, fonctionnalités, règles avec leur état, objets), chaque élément cliquable comme dans le graphe. En dessous de `md`, la liste seule (007) |
| I | L'export Markdown ? | « Exporter en Markdown » télécharge la fonctionnalité choisie (`conception-<nom>.md`) ; une seconde entrée, « Tout le projet », télécharge toutes les fonctionnalités (`conception-<projet>.md`). Le fichier est construit **dans le navigateur**, à partir de la route C et de la carte, sans route de plus. Pour chaque fonctionnalité : son titre, ses acteurs, puis chaque règle (sa phrase, son état, l'Étant donné / Quand / Alors, et un lien permanent GitHub par source, au commit cité), puis les objets touchés avec leurs champs (« non cartographié » pour un objet absent de la carte). C'est la documentation métier de la 007 (« Conséquences ») |
| J | Sans fonctionnalité ? | « Pas encore de fonctionnalité reprise. Choisis-en une dans « Analyser avec Claude ». » et le bouton « Analyser avec Claude » (la fenêtre de la 047 L, case « Règles ») |

## Ce qui est repoussé

- **L'état « figée »** d'une règle et son nœud : R4.
- **Les constats** (puce « Constats » de S41 et S43) : R5.

## Limites connues

- **Un acteur dépend des mots de Claude** : « Client » et « Le client » font deux acteurs. La consigne du `rules-analyst` (047 M) demande des « en tant que » courts et stables, sans le garantir.
- **Un gros projet donne un graphe dense** : toutes les fonctionnalités sont dessinées (F). Le gris garde la fonctionnalité choisie lisible ; la liste reste le recours.
