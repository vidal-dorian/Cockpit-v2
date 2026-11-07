# 043 — La carte du code

- **Statut** : proposée (à valider à la relecture de la PR) ; le code est construit (tranche R1)
- **Date** : 2026-11-06
- **Décidé par** : Dorian, avec Claude
- **Dépend de** : [007 — Reprendre une app existante](007-reprise-app-existante.md) (la carte, la vérification des citations, l'écran « Conception »), [026 — Écrire dans un repo](026-ecrire-dans-un-repo.md), [031 — L'équipe en graphe](031-equipe-en-graphe.md) (React Flow), [034 — Développer avec Claude](034-developper-avec-claude.md) (le lancement)
- **Tranche** : R1 du [découpage](../decoupage.md), phase 10

## Contexte

La 007 décrit la reprise d'une app existante. R1 en pose la base : Claude lit le repo et dépose la **carte** (sous-projets, objets métier, champs, liens, runtimes), Cockpit **vérifie chaque citation sur GitHub**, et l'écran « Conception » montre un diagramme par sous-projet. Démo : sur un repo qui contient un web et une API, je vois deux diagrammes ; un clic sur un objet montre son code.

Cette décision ne fixe que ce que la 007 laisse ouvert pour R1. Elle ne revient sur aucun de ses choix.

## Les choix

| # | Question | Décision |
|---|---|---|
| A | Ce que dépose `submit_code_map` ? | `project_id`, `commit_sha` (40 caractères hexadécimaux), et 1 à 10 `modules`. Un module : `path` (le dossier depuis la racine, `.` pour la racine), `name`, `kind` (`web`, `api`, `mobile`, `library`, `other`), `manifest` (chemin du fichier), `runtimes` (0 à 20 : `name`, `version`, `citation`, la ligne du manifeste qui fixe la version), `objects` (1 à 200 : `name`, `kind` `table` \| `type` \| `class`, `fields` 0 à 100 de `{ name, type }`, `citation`), `links` (0 à 500 : `from`, `to`, `kind` `contains` \| `references` \| `extends`, `cardinality` facultative `1` \| `0..1` \| `n`). Une citation : `{ path, start_line, end_line }`, `1 <= start_line <= end_line` |
| B | Les refus ? | Ceux de la 007, chacun avec **l'endroit fautif** (`modules[1].objects[3].citation`) pour que Claude corrige : commit inconnu sur GitHub, fichier absent à ce commit, chemin qui n'est pas un fichier lisible (dossier, lien, sous-module, trop gros), lignes au-delà de la fin du fichier, manifeste absent, deux objets du même nom dans un module, lien vers un objet inconnu **du même module**, deux modules au même `path` dans l'appel, projet archivé. Plus de **100 fichiers distincts cités** dans un appel : refusé, Claude envoie les modules en plusieurs appels (limite de 5 000 requêtes par heure de l'App, 007) |
| C | La vérification des citations ? | **Une seule fonction**, `verifyCitations` (`src/server/citations.ts`), que R2 et R5 réutiliseront. Elle lit **chaque fichier distinct une seule fois** au commit cité, avec la lecture déjà écrite pour la 026 (`inspect`, qui descend l'arbre et garde les dossiers lus pendant l'appel). Elle rend le nombre de lignes de chaque fichier ou le premier refus. Testée contre le faux GitHub (`test-github.ts`) |
| D | Le rangement ? | La table `code_maps` de la 007, unique par `(project_id, module_path)`. Tous les modules d'un appel sont remplacés **dans une seule transaction** (tout ou rien). `data` est validé par le même schéma Zod à l'écriture et à la lecture. Un module que Claude ne renvoie plus reste : le retirer est repoussé |
| E | L'historique ? | Rien de plus : l'enrobage du serveur MCP (016) journalise déjà chaque appel, réussi, en erreur ou refusé |
| F | Les liens entre sous-projets ? | **Aucun** en R1 : un lien relie deux objets du même module. Un type de l'API repris par le web est un objet de chacun |
| G | La lecture ? | `GET /api/projects/:id/code-map` : les modules, chacun avec son commit, sa date et son `data`, et pour chaque commit distinct le **nombre de commits depuis** sur la branche par défaut (`compare`, un appel par commit distinct ; `null` si GitHub ne le retrouve plus, par exemple après un force-push). Réservé aux membres du projet |
| H | Le code d'un objet ? | `GET /api/projects/:id/code?sha=&path=&start=&end=` : les lignes citées et trois lignes avant et après, **lues sur GitHub à l'affichage**, sans copie gardée (007). Réservé aux membres, et seulement pour un fichier et un commit qui figurent dans la carte du projet, pour que la route ne lise pas n'importe quoi dans le repo. R2 s'en servira pour l'écran de reprise. Pas de coloration du code (point ouvert 3 de la 007, en R2) |
| I | L'écran ? | Un onglet **« Conception »** dans la page du projet (`/projets/:id/conception`), entre « Tickets » et « Santé » (l'ordre de la 045 H ; l'« après Agents » d'origine est plus ancien que la 045). En R1, la vue **« Modèle »** seule : un onglet par sous-projet (nom et type), avec ses runtimes (« node 20 · react 18.3 ») ; en tête, « Analysé au commit a1b2c3d · 12 commits depuis » et « Relancer l'analyse ». Le graphe : React Flow (déjà là pour la 031), une carte par objet (nom, nature, les huit premiers champs, puis « + 4 champs »), les liens nommés avec leur cardinalité, et la mise en page automatique de la 007, **`@dagrejs/dagre`**, la seule dépendance ajoutée. **Clic sur un objet** : un panneau avec tous ses champs, « Défini dans `src/db/schema.ts`, lignes 18 à 24 », le code (H) et « Voir sur GitHub » (lien permanent au commit) |
| J | Clavier, lecteurs d'écran, téléphone ? | Chaque sous-projet existe aussi **en liste** (objets, champs, liens), derrière une bascule « Graphe / Liste ». En dessous de `md`, la liste seule (007) |
| K | Sans carte ? | « Pas encore de carte. Claude lit le repo et dessine le modèle de chaque sous-projet. » et le bouton principal **« Analyser avec Claude »** |
| L | Le lancement ? | « Analyser avec Claude » (et « Relancer l'analyse ») ouvre une fenêtre comme celle de la 034 : le dossier du clone, **déjà retenu par le navigateur pour ce projet** (034), puis « Ouvrir Claude », qui ouvre Claude Desktop sur le clone avec `/analyser` prérempli, et « Copier le prompt » en secours. **Pas encore de cases** : la carte est la seule analyse de R1. Les cases de la 007 arrivent avec R2 et R5 |
| M | `/analyser` et `cartographer` ? | Deux fichiers de plus dans `catalog/` (`skills/analyser/SKILL.md`, `agents/cartographer.md`), donc dans « Préparer pour Claude » (027) pour un nouveau repo. Le skill appelle `get_project`, lance `cartographer` (modèle `opus`, point ouvert 4 de la 007), qui lit le repo au commit de `HEAD` et appelle `submit_code_map`, puis corrige et renvoie sur un refus. **Un repo déjà préparé n'a pas ces deux fichiers**, et la mise à jour du catalogue (C1) vient après R3 : la fenêtre (L) le dit et propose **« Ajouter /analyser au repo »**, qui montre le diff des deux fichiers et les ajoute en un commit, avec l'écriture de la 026. Un fichier déjà présent et différent n'est jamais écrasé : c'est la copie du projet |

## Ce qui est repoussé

- **La vue « Par fonctionnalité »** et l'export Markdown : R3.
- **Les liens entre sous-projets.**
- **Retirer un sous-projet** de la carte quand il disparaît du repo.
- **Les cases de la fenêtre d'analyse** (règles, bugs, sécurité…) : R2 et R5.
- **La coloration du code** : R2.
- **Le blocage dans l'offre Pro** (point ouvert 7 de la 007) : 13.2.

## Limites connues

- **On vérifie ce qui est cité, pas ce qui manque** (007) : un objet oublié par Claude ne se voit pas.
- **Une citation juste peut montrer le mauvais code** : Cockpit prouve que les lignes existent, pas qu'elles définissent l'objet. Le panneau (I) sert à le voir.
- **« Commits depuis »** compte les commits de la branche par défaut, pas seulement ceux qui touchent un sous-projet.
- **Un gros repo** demande plusieurs appels de `submit_code_map` (B), et beaucoup de crédits Claude (007).

## Ce que le code a précisé (tranche R1)

Là où la décision laissait le choix, le code a retenu :

- **Le texte d'un refus** (B) : `modules[1].objects[3].citation: <ce qui ne va pas>`, l'endroit puis la raison, pour Claude seulement ; l'historique garde le code fixe du refus. Les refus sans GitHub (chemin en double, objet en double, lien vers un objet inconnu, plus de 100 fichiers) sont vérifiés avant tout appel à GitHub.
- **Les 100 fichiers** (B) comptent les manifestes, les runtimes et les objets : un fichier cité plusieurs fois compte une fois.
- **Le commit inconnu** (B) : l'arbre de la racine est lu **une seule fois par appel**, au commit déposé ; un 404 de GitHub est le refus « commit inconnu ».
- **La lecture** (G) : `commitsSince` vaut `null` si GitHub ne retrouve pas le commit **et aussi si la comparaison échoue** (erreur ou App non configurée) : la carte s'affiche quand même. Une ligne de `code_maps` dont `data` ne passe plus le schéma est **ignorée et journalisée** (`console.error`), les autres modules restent affichés.
- **Le code d'un objet** (H) : la réponse est `{ firstLine, lines }`, `firstLine` étant la première ligne rendue (au plus trois avant la citation, jamais avant la 1). Le fichier ou le commit absent de la carte, un commit disparu de GitHub et un fichier introuvable répondent tous 404.
- **« Ajouter /analyser au repo »** (M) réutilise `POST /api/projects/:id/prepare` puis `/prepare/apply` avec les deux fichiers du skill et de l'agent : pas de route nouvelle, et un fichier déjà présent reste hors du plan.
- **La vérification** (C) passe par `fileReader` de `github.ts`, la lecture `inspect` de la 026 seule, sans le reste de l'écriture ; `inspect` encode maintenant chaque segment du chemin (un fichier dont le nom a un caractère spécial se lit).
