# 026 — Écrire dans un repo sans rien écraser

- **Statut** : proposée (à valider à la relecture de la PR)
- **Date** : 2026-10-30
- **Décidé par** : Dorian, avec Claude
- **Dépend de** : [012 — Configuration automatique](012-configuration-automatique.md) (l'App a déjà Contents en écriture), [013 — Bilan de santé](013-bilan-de-sante.md), [011 — Import des projets](011-import-projets.md)
- **Tranche** : 6.1 du [découpage](../decoupage.md)

## Contexte

La 6.2 (« Préparer pour Claude en un clic ») ajoutera à un repo le skill `/dev-us`, ses agents et un `.mcp.json` : **un seul commit, montré fichier par fichier avant d'être fait, sans rien écraser** (brief §6.1). Le catalogue fera de même plus tard (brief §6.10 : il n'écrase jamais une copie modifiée). Cette tranche construit le mécanisme commun, sans écran : lire ce qui est là, dire ce qui serait fait, puis le faire en un commit, et refuser si le repo a changé entre-temps d'une façon qui compte. Elle est testée contre un faux GitHub.

## Les choix

| # | Question | Décision |
|---|---|---|
| A | La forme ? | Deux fonctions du client GitHub, sur la branche par défaut du repo, avec l'identité de l'installation (jamais celle d'un utilisateur, 011). **`planRepoWrite(installationId, fullName, files)`**, `files` étant une liste `{ path, content }`, rend un **plan** : le commit de départ (`baseSha`) et, pour chaque fichier, `create` (absent : il sera ajouté), `same` (déjà là avec ce contenu : rien à faire) ou `exists` (déjà là avec un **autre** contenu : **jamais écrasé**, le plan donne alors le contenu actuel pour que la 6.2 montre la différence). **Tout ce qui n'est pas un simple fichier** compte aussi comme `exists`, sans contenu : un dossier, un lien symbolique ou un sous-module au chemin, un fichier trop gros pour être lu (GitHub ne rend pas son contenu), et un chemin dont **un dossier parent** n'est pas un vrai dossier (un lien symbolique, un sous-module ou un fichier) : y écrire remplacerait ce parent. **`applyRepoWrite(installationId, fullName, plan, message)`** fait **un seul commit** qui ajoute les fichiers `create`, et rien d'autre. Rien n'est écrit si aucun fichier n'est à créer |
| B | Comment GitHub est-il appelé ? | Lecture : la branche par défaut et son commit, puis, pour chaque fichier, l'arbre Git de son dossier à ce commit (`GET git/trees/<sha>:<dossier>`, qui dit si l'entrée est un fichier, un dossier, un lien ou un sous-module) ; si le dossier manque, son parent, jusqu'au premier qui existe, qui doit être un vrai dossier ; le contenu d'un simple fichier est lu à ce commit (`GET contents/{path}?ref=<sha>`). Écriture par l'API Git : un arbre sur l'arbre du commit (`POST git/trees` avec `base_tree`, mode `100644`, contenu en UTF-8), un commit qui a ce commit pour parent, puis la branche avancée **sans forcer** (`PATCH git/refs/heads/<branche>`, `force: false`) : GitHub refuse alors tout ce qui n'est pas une avance rapide |
| C | Et si le repo a changé entre le plan et l'écriture ? | `applyRepoWrite` relit **toujours** chaque fichier `create` au commit de la branche (le plan peut venir de loin : il ne fait pas foi), avec les mêmes règles que le plan ; s'il est **encore absent** partout, le commit est fait sur le nouveau commit (un push sans rapport ne doit pas bloquer) ; si l'un d'eux est apparu, **refus `repo_changed`**, rien n'est écrit, et l'appelant refait un plan. Si GitHub refuse l'avance de la branche (un autre push au même moment), même refus : on ne réessaie pas en boucle. Les fichiers `same` et `exists` ne sont pas relus : ils ne sont pas écrits |
| D | Quels chemins sont acceptés ? | Relatifs, en `/`, sans segment vide, `.` ou `..`, sans `.git` comme segment (en majuscules ou minuscules), sans caractère de contrôle, 255 caractères au plus ; au plus 50 fichiers et 1 Mio de contenu par plan ; un chemin donné deux fois est refusé. Tout autre plan est une erreur de programmation (une exception), pas un refus montré à l'utilisateur : les fichiers viennent du catalogue de Cockpit, pas d'une saisie |
| E | Les autres refus ? | `empty_repo` (le repo n'a aucun commit : GitHub répond 409), `repo_unreachable` (404 : l'App n'y a plus accès), `branch_protected` (la branche par défaut refuse les pushs directs : GitHub répond 403 ou 422 à l'avance de la branche avec une règle de protection). Les autres erreurs de GitHub remontent telles quelles à l'appelant, comme pour le bilan de santé (013 H) |
| F | Que rend l'écriture ? | `{ commitSha, created: [chemins] }`. L'historique (`github_effects`) et l'écran viennent avec la 6.2, qui saura pour qui et pourquoi on écrit |

## Ce qui est repoussé

- L'écran, l'historique, le diff montré à l'utilisateur et le bouton : 6.2.
- Écrire sur une branche à part et ouvrir une pull request quand la branche par défaut est protégée : si le besoin se présente, la 6.2 le proposera à la place du refus `branch_protected`.
- Mettre à jour une copie du catalogue **non modifiée** (brief §6.10) : avec le catalogue ; il faudra savoir quelle version a été copiée.
- Les fichiers binaires et les liens symboliques : rien ne les demande.

## Limites connues

- **Un fichier `exists` est laissé tel quel** même s'il n'a qu'une fin de ligne de différence : c'est le prix de « sans rien écraser ».
- **Entre la relecture (C) et l'avance de la branche**, un push peut ajouter un des fichiers : GitHub refuse alors l'avance (elle n'est plus rapide), et le refus est `repo_changed`. Aucun fichier n'est jamais écrasé.
- **La branche par défaut est relue à chaque appel** : un renommage entre le plan et l'écriture donne `repo_changed`.
- **Non vérifiable ici** : le statut exact que GitHub rend à un push refusé par une règle de protection (403 ou 422 selon le type de règle) ; les deux sont traités comme `branch_protected` quand le corps parle de protection.
