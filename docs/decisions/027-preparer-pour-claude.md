# 027 — Préparer un repo pour Claude en un clic

- **Statut** : validée
- **Date** : 2026-10-31
- **Décidé par** : Dorian, avec Claude
- **Dépend de** : [026 — Écrire dans un repo](026-ecrire-dans-un-repo.md), [013 — Bilan de santé](013-bilan-de-sante.md), [021 — Connecter Claude](021-connecter-claude.md), [005 — Lancement local](005-lancement-local.md), [017 — User stories](017-user-stories.md) (M), [010 — Historique](010-historique.md)
- **Modifiée par** : [045](045-interface-quatre-temps.md) : le plan est une liste de fichiers avec l'aperçu du fichier choisi, plus seulement un contenu replié (F)
- **Tranche** : 6.2 du [découpage](../decoupage.md)

## Contexte

Le brief (§6.1) veut un bouton « Préparer pour Claude en un clic » : **un seul commit qui ajoute tout ce qui manque, montré fichier par fichier avant d'être fait, sans rien écraser**. Le mécanisme existe (026). Il manque le catalogue des fichiers, les routes et l'écran. Démo : sur un repo rouge, un clic, je vois les fichiers, je valide, et le bilan passe au vert.

## Les choix

| # | Question | Décision |
|---|---|---|
| A | Le catalogue ? | Des fichiers livrés avec Cockpit, dans `catalog/` (002 : pas des données) : les agents **`test-writer`**, **`developer`** (`model: sonnet`) et **`reviewer`** (`model: opus`), repris de ceux qui développent Cockpit et rendus indépendants du projet (005) ; le skill **`/dev-us`** (nouveau) ; le skill **`/write-us`** (déjà là, 017 M) ; et un **`CLAUDE.md` de départ**, court, qui dit ce qu'il faut y écrire (commandes, organisation, conventions) |
| B | Où vont-ils dans le repo ? | `.claude/agents/test-writer.md`, `.claude/agents/developer.md`, `.claude/agents/reviewer.md`, `.claude/skills/dev-us/SKILL.md`, `.claude/skills/write-us/SKILL.md`, et `CLAUDE.md` à la racine **seulement si ni `CLAUDE.md` ni `.claude/CLAUDE.md` n'existent** (013 C). Pas de `.mcp.json` : Claude passe par le connecteur (021), et la ligne `mcp` du bilan est verte sans lui. Pas de workflow de CI : il faudrait à l'App la permission `workflows` (012 D), qui vient après le MVP ; la ligne `ci` le dit |
| C | `/dev-us` dans cette tranche ? | Les étapes du brief §6.6 que Cockpit sait déjà servir : vérifier le dossier, l'arbre de travail propre et la branche par défaut à jour ; lire l'US (`get_user_story`) et refuser si elle n'est pas `ready` ; créer ou reprendre la branche (`--branch`, 005 D) ; **test-writer**, **developer**, **reviewer** jusqu'au verdict prêt ; tous les tests et le lint ; pousser et ouvrir la pull request, qui ferme l'issue (`Closes #<n>`) ; **ne jamais merger**. Le run dans Cockpit (`start_run`, étapes, questions, compte rendu par critère) vient avec la phase 7, qui complétera le skill |
| D | Les routes ? | `POST /api/projects/:id/prepare` (lire) rend le plan de 026 tel quel pour l'écran : chaque fichier avec son chemin, son statut (`create`, `same`, `exists`), son contenu, le contenu actuel quand il y en a un, et la signature. `POST /api/projects/:id/prepare/apply`, corps `{ plan }`, écrit avec le message `feat: prepare the repo for Claude (Cockpit)`. Mêmes barrières que le bilan de santé (503, 401, 404 pour le projet d'un autre), plus 409 `project_archived` ; les refus de 026 (`empty_repo`, `repo_unreachable`, `repo_changed`, `pull_request_forbidden`) répondent **409** avec leur code ; un plan mal formé, 400. Le plan voyage par le navigateur : c'est pour cela qu'il est signé (026 H) |
| E | L'historique ? | `prepare_repo` (humain, `ui`, `project_id`), `args: { created }` (un nombre de fichiers), et dans `github_effects` `{ commitSha, pullRequest }` (le numéro, ou rien). Un refus écrit une entrée `refused` avec son code ; une erreur de GitHub, `error` (010 D). La lecture du plan n'écrit rien (une lecture n'est pas une action, 013 G) |
| F | L'écran ? | Dans la section « Bilan de santé » de `/projets/:id`, quand la ligne `claude_md` ou `agents` est rouge : **« Préparer pour Claude »**. Il ouvre, sur place, la liste des fichiers : « Sera ajouté » (contenu replié), « Déjà là, identique », « Déjà là, différent : laissé tel quel » (avec le diff de la 5.2), « Déjà là, pas un simple fichier : laissé tel quel ». Puis **« Faire le commit »**, désactivé s'il n'y a rien à ajouter. Après : « C'est fait » avec le lien du commit, ou « La branche par défaut est protégée : une pull request est ouverte » avec son lien ; le bilan est relu. Les refus en français (`repo_changed` : « Le repo a changé entre-temps : regarde de nouveau » et la liste est relue ; `pull_request_forbidden` : il faut donner à l'App Pull requests en écriture, avec le lien de ses réglages). Désactivé sur un projet archivé |

## Ce qui est repoussé

- Mettre à jour une copie du catalogue non modifiée quand le catalogue change (brief §6.10) : il faudra savoir quelle version a été copiée.
- Le workflow de CI : avec la permission `workflows`.
- Le run de `/dev-us` dans Cockpit : phase 7.
- Choisir les fichiers un par un : tout ce qui manque est ajouté, comme le demande le brief.

## Limites connues

- **Une pull request peut être ouverte deux fois** si le même plan signé est renvoyé après une erreur (réponse perdue, deux onglets) sur une branche protégée : la branche par défaut n'a pas bougé, donc rien n'est relu. Rien n'est écrasé ; il faudra fermer la seconde.
- **Un projet archivé pendant l'écriture** reçoit quand même son commit : l'archivage ne touche pas GitHub, et l'action avait commencé avant.
- **Le `CLAUDE.md` de départ ne remplace pas un vrai** : il fait passer la ligne au vert, mais il faut le remplir ; il le dit lui-même.
- **Les fichiers déjà là et différents ne sont jamais mis à jour** : un agent modifié à la main reste tel quel, c'est voulu (« sans rien écraser »).
- **`unlessExists` n'est pas revérifié à l'application** : si `.claude/CLAUDE.md` apparaît entre le plan et l'application, un `CLAUDE.md` à la racine peut encore être ajouté à côté (rien n'est écrasé).
- **Un `.claude/CLAUDE.md` qui est un dossier** : la 013 C garde la ligne rouge alors que `CLAUDE.md` est laissé de côté, le bouton reste.
- **Un fichier `exists` modifié à la main de plus de ~230 Ko** fait dépasser au plan la limite de corps de 256 Kio (413).
- **Non vérifiable ici** : un vrai commit sur un vrai repo (les tests passent par le faux GitHub de la 6.1).
