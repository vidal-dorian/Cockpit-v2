# 031 — L'équipe en graphe

- **Statut** : proposée (à valider à la relecture de la PR)
- **Date** : 2026-11-04
- **Décidé par** : Dorian, avec Claude
- **Dépend de** : [029 — Équipe d'agents](029-equipe-d-agents.md) (B, C, F), [030 — Éditeur d'agent](030-editeur-d-agent.md), [007 — Reprise d'une app existante](007-reprise-app-existante.md) (la librairie de graphe et la règle d'accessibilité), [026 — Écrire dans un repo](026-ecrire-dans-un-repo.md)
- **Modifie** : la [029](029-equipe-d-agents.md) F : l'écran « Équipe » est un **graphe** de cartes qu'on déplace et qu'on relie, en plus de la liste ; un ajout d'agent du catalogue passe par l'éditeur (030) avant l'équipe
- **Modifiée par** : [042](042-graphe-seul-un-commit.md) : C (condition par défaut), D (plus de « Modifier »), E (plus d'« Ajouter une étape »), F (plus de liste) et H
- **Tranche** : E3 du [découpage](../decoupage.md)

## Contexte

Demande de Dorian (2026-11-04), avec une capture d'un graphe de cartes reliées par des flèches étiquetées, à la manière de l'écran « Conception » de la 007 : **déplacer les agents, les modifier depuis des cartes, les relier autrement**. Ses choix : les flèches gardent le sens du format de la 029 B (une suite d'étapes et des boucles de retour, pas de branches parallèles) ; la mise en page est automatique, un déplacement n'est pas retenu.

## Les choix

| # | Question | Décision |
|---|---|---|
| A | Où ? | Dans l'onglet **« Agents »** (030 A), au-dessus de la liste des agents : une section **« Équipe »** |
| B | Le graphe ? | Une **carte par étape**, de gauche à droite dans l'ordre : le nom de l'agent, son modèle (« Celui de la session » sans `model`) et ce qu'il fait (`does`). Une flèche pleine **« puis »** d'une étape à la suivante ; une flèche pointillée **« boucle »** d'une étape vers son `loop_to`, étiquetée de son `until`. Mise en page calculée (une colonne par étape), pas de librairie de mise en page : les cartes se déplacent à la souris pour y voir clair et reviennent en place au rechargement. On zoome et on fait glisser le fond. Librairie : [React Flow](https://reactflow.dev) (`@xyflow/react`), déjà choisie par la 007 |
| C | Relier autrement ? | Tirer un lien de la sortie d'une étape A vers une étape C : **C avant A, ou A elle-même** : une boucle de A vers C (`loop_to: C`), dont la condition est demandée tout de suite ; **C après A** : C est déplacée juste après A (l'ordre change, les flèches « puis » suivent). Une boucle se retire en la sélectionnant puis « Retirer la boucle ». Une flèche « puis » ne se retire pas : la suite reste d'un seul tenant. Une étape n'a qu'une boucle ; en tirer une nouvelle remplace l'ancienne. Une boucle qui ne pointe plus en arrière après un réordonnancement est retirée |
| D | Modifier depuis une carte ? | Un clic sur une carte (ou « Modifier » dans la liste) ouvre le panneau de l'étape : l'**agent** (un des agents du repo pas encore dans l'équipe, ou le sien), **ce qu'il fait**, la **boucle** (« Aucune » ou une étape précédente ou elle-même, et sa condition, obligatoire), **« Retirer l'étape »**, et **« Modifier l'agent »**, qui ouvre le formulaire de la 030 (un commit à part). Retirer une étape retire les boucles qui pointaient vers elle ; retirer `test-writer` ou `reviewer` affiche l'avertissement de la 029 F (« Le TDD du CLAUDE.md du projet s'appuie sur cette étape »), sans bloquer |
| E | Ajouter une étape ? | **« Ajouter une étape »** : un agent du repo qui n'est pas encore dans l'équipe, mis en dernier. Un agent n'est qu'**une fois** dans l'équipe (sinon `loop_to` serait ambigu). Un agent du catalogue absent du repo s'ajoute d'abord par « Ajouter un agent » (030 D) |
| F | Le clavier et le téléphone ? | Comme la 007 : **la liste des étapes** édite la même chose, sous le graphe : pour chaque étape, son numéro, l'agent, ce qu'il fait, sa boucle, « Monter », « Descendre » et « Modifier ». En largeur téléphone le graphe n'est pas affiché, la liste suffit. Le graphe et la liste partagent un seul brouillon |
| G | Le fichier ? | Lu par la route de la 030 B, qui rend en plus **`team`** : le texte de `.claude/team.md`, `null` sans fichier. Sans fichier, le brouillon part des trois étapes par défaut (029 C) : `test-writer` (« writes the acceptance tests from the criteria; they must fail, for the right reason »), `developer` (« implements until those tests pass, without touching them »), `reviewer` (« reviews the diff with a fresh context », `loop_to: developer`, `until: "the verdict is ready"`), les agents absents du repo étant signalés sur leur carte (« Agent absent du repo »). À l'enregistrement, Cockpit **réécrit l'en-tête** au format de la 029 B (`steps:`, puis pour chaque étape `  - agent: <nom>` en première clé, `    does:`, `    loop_to:`, `    until:`, `does` et `until` en chaînes JSON) et **garde le texte après l'en-tête** octet pour octet. **Un `team.md` que Cockpit ne sait pas réécrire sans rien perdre** (illisible pour la 029 B, ou un en-tête qui contient autre chose que `steps:` et, dans les étapes, ces quatre clés et des lignes vides : un commentaire, y compris dans une valeur sans guillemets, une autre clé, une valeur sur plusieurs lignes, un agent nommé deux fois, un `until` sans `loop_to`, ou un `loop_to` qui ne nomme ni l'étape elle-même ni une étape précédente) : pas de graphe ni de liste modifiable, « Ce team.md contient des lignes que Cockpit ne sait pas réécrire : modifie-le sur GitHub » |
| H | Enregistrer ? | **« Voir les changements »** montre le diff de `team.md` (025 E ; tout le fichier quand il est créé), puis **« Faire le commit »**, désactivé sans différence, sans étape, ou avec une boucle sans condition. `POST /api/projects/:id/team/apply`, corps `{ before, after }` (`before` `null` quand le fichier est créé ; `after` jamais `null` : revenir à l'équipe par défaut n'est pas dans cette tranche), écrit par `applyRepoChanges` (030 E) avec le message `feat: update the team (Cockpit)`. Le serveur refuse en 400 un `after` que `parseTeam` (029 B) ne lit pas, ou de plus de 1 Mio : Cockpit n'écrit jamais un `invalid_team`. Barrières, refus et messages comme la 030 E et H |
| I | L'historique ? | `save_team` (029 I) : humain, `ui`, `project_id`, `args: { path: ".claude/team.md" }`, `github_effects: { commitSha, pullRequest }` ; aucun texte de `does` ni de `until`. Refus `refused`, erreur `error`, rien sur un 400. Le journal l'affiche « Équipe enregistrée » |

## Ce qui est repoussé

- **Les branches parallèles** (un agent qui mène à plusieurs agents lancés ensemble) : il faudrait changer le format de la 029 B, le bilan et le texte de `/dev-us`.
- **Retenir la position des cartes** : la mise en page automatique suffit tant que l'équipe est une suite.
- **Ajouter un agent du catalogue et l'étape en un seul commit** (029 F) : deux commits, l'agent puis l'équipe.
- **Revenir à l'équipe par défaut** (supprimer `team.md`).
- **Renommer un agent** (030) : toujours en ajoutant puis en supprimant.

## Limites connues

- **Une nouvelle dépendance** (`@xyflow/react`, ~50 Ko compressés) pour une seule section : elle servira aussi aux graphes de la reprise (007).
- **Tirer un lien à la souris ne se fait pas au clavier** : la liste (F) fait tout ce que fait le graphe.
- **Les commentaires et les autres clés d'un `team.md` écrit à la main** empêchent de le modifier dans Cockpit (G) : c'est le prix de « sans rien perdre ».
- **Un `team.md` écrit à la main que Cockpit ne ferait que remettre en forme** (valeurs sans guillemets, lignes vides) n'est pas proposé au commit tant que rien n'est modifié ; au premier changement, le diff montre aussi la remise en forme.
- **Ce qu'on modifie pendant qu'un commit est en cours est perdu quand il réussit** : le brouillon repart du fichier relu. Le graphe et la liste restent modifiables pendant ce temps.
- **`team.md` reste une consigne** que Claude suit, pas un programme (029, limites).
- **Non vérifiable ici** : le glisser-déposer dans un vrai navigateur (les tests passent par les fonctions du brouillon et la liste) et un vrai commit sur un vrai repo.
