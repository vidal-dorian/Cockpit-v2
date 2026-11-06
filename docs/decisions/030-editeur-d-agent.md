# 030 — L'éditeur d'agent

- **Statut** : validée
- **Date** : 2026-11-04
- **Décidé par** : Dorian, avec Claude
- **Dépend de** : [029 — Équipe d'agents](029-equipe-d-agents.md) (A), [026 — Écrire dans un repo](026-ecrire-dans-un-repo.md), [027 — Préparer pour Claude](027-preparer-pour-claude.md), [013 — Bilan de santé](013-bilan-de-sante.md), [010 — Historique](010-historique.md), [025 — Issue modifiée](025-issue-modifiee-sur-github.md) (E, le diff)
- **Modifie** : la [026](026-ecrire-dans-un-repo.md), qui n'écrivait que des fichiers absents : une écriture peut maintenant **remplacer ou supprimer** un fichier, seulement à la demande de l'utilisateur et seulement s'il est encore celui qu'on lui a montré (E). « Préparer pour Claude » (027) n'écrase toujours rien. La [029](029-equipe-d-agents.md) I, qui gagne l'entrée `delete_agent` (F)
- **Tranche** : E2 du [découpage](../decoupage.md)

## Contexte

La 029 A veut un éditeur pour les fichiers `.claude/agents/*.md` : en ajouter (du catalogue ou de zéro), les modifier (description, outils, modèle, prompt, aperçu du fichier), les supprimer, chaque enregistrement étant un commit montré avant. Démo : je change le modèle du `developer` et j'ajoute un `doc-writer`.

Un fichier d'agent est du Markdown avec un en-tête YAML entre deux lignes `---` : `name` et `description` obligatoires, `tools` (liste séparée par des virgules ; absente, l'agent a tous les outils), `model` (`sonnet`, `opus`, `haiku`, `fable`, `inherit` ou un identifiant complet ; absent, celui de la session), puis le prompt ([documentation Claude Code, « Subagents »](https://code.claude.com/docs/en/sub-agents)).

## Les choix

| # | Question | Décision |
|---|---|---|
| A | Où ? | Un cinquième onglet **« Agents »** de `/projets/:id`, à `/projets/:id/agents` (028 G) |
| B | La lecture ? | `GET /api/projects/:id/agents` rend `{ agents: [{ name, text }], catalog: [{ name, text }] }`. `agents` : les simples fichiers de `.claude/agents` dont le nom est `<nom>.md`, `<nom>` au format de la 029 B (`a-z`, `0-9`, `-`, sans tiret au début), par nom ; `text` est `null` quand GitHub ne rend pas le contenu (fichier trop gros). `catalog` : les agents du catalogue (027 A) absents du repo. Pas de dossier `.claude/agents` : `agents` vide. Mêmes barrières que le bilan (503, 401, 404 pour le projet d'un autre) ; `repo_unreachable` et `empty_repo` en 409 ; une autre erreur de GitHub, 502. Une lecture n'écrit rien dans l'historique (013 G) |
| C | Le formulaire ? | Pour un agent : **description** (une ligne, obligatoire), **outils** (une ligne ; vide, la clé est retirée), **modèle** (liste : « Celui de la session » qui retire la clé, `sonnet`, `opus`, `haiku`, `fable`, et la valeur du fichier si elle n'y est pas), **prompt** (le texte après l'en-tête). Le nom d'un agent existant ne change pas (voir « repoussé »). Seules les lignes des clés modifiées sont réécrites : les autres clés, leur ordre et le prompt intact restent tels quels ; `description` et `tools` réécrites le sont entre guillemets doubles (une chaîne JSON, que YAML lit telle quelle). **En-tête illisible** (pas de `---` en première ligne, ou une ligne de l'en-tête qui n'est ni `clé: valeur` en début de ligne, ni vide, ni un commentaire, par exemple une liste YAML) : pas de formulaire, « L'en-tête de ce fichier n'est pas lisible par Cockpit : modifie-le sur GitHub » ; la suppression reste possible |
| D | Ajouter ? | **« Ajouter un agent »** : un nom (format de B, pas déjà pris) et un point de départ, « Vide » (en-tête `name`, `description`, prompt vide) ou un agent de `catalog`. Puis le même formulaire |
| E | Écrire ? | Le formulaire montre **le diff** du fichier actuel au fichier produit (025 E ; tout le fichier pour un nouvel agent) ; **« Faire le commit »** est désactivé tant qu'il n'y a pas de différence ou qu'une description manque. `POST /api/projects/:id/agents/apply`, corps `{ name, before, after }` : `before` est le texte montré (`null` pour un ajout), `after` le texte voulu (`null` pour une suppression) ; jamais les deux `null`, jamais égaux, `after` d'au plus 1 Mio, sinon 400. Le client GitHub gagne **`applyRepoChanges(installationId, fullName, changes, message)`**, `changes` une liste `{ path, before, after }` : il relit chaque chemin à la tête de la branche par défaut avec les règles de la 026 B ; si l'un n'est pas **exactement** `before` (absent pour `null`, un simple fichier de ce texte sinon), **refus `repo_changed`** et rien n'est écrit. Sinon **un commit** (un arbre sur l'arbre du commit, `sha: null` pour une suppression), la branche avancée sans forcer, et la pull request de la 026 G si elle est protégée. Refus et erreurs comme la 027 D (409 avec le code, `appSettingsUrl` pour `pull_request_forbidden`, 502). Pas de signature (026 H) : la comparaison à `before` relit toujours, une lecture par fichier. Messages : `feat: add the agent <nom> (Cockpit)`, `feat: update the agent <nom> (Cockpit)`, `feat: remove the agent <nom> (Cockpit)` |
| F | L'historique ? | `save_agent` (ajout et modification) et `delete_agent` (suppression), humain, `ui`, `project_id`, `args: { path }`, et dans `github_effects` `{ commitSha, pullRequest }` (029 I, 027 E) ; aucun texte de prompt. Un refus écrit une entrée `refused` avec son code, une erreur de GitHub `error` (010 D). Un corps mal formé (400) n'écrit rien. Le journal les affiche « Agent enregistré » et « Agent supprimé » |
| G | Supprimer ? | **« Supprimer l'agent »** demande confirmation (« Le fichier sera retiré du repo par un commit »), puis passe par E avec `after: null` |
| H | Après ? | « C'est fait » avec le lien du commit, ou « La branche par défaut est protégée : une pull request est ouverte » avec son lien ; la liste est relue. `repo_changed` : « Le repo a changé entre-temps : regarde de nouveau » et la liste est relue. Projet archivé : boutons désactivés, 409 `project_archived` côté serveur |

## Ce qui est repoussé

- **Renommer un agent** : il faudrait mettre à jour `team.md` dans le même commit ; avec l'écran « Équipe » (E3). En attendant : ajouter sous le nouveau nom, puis supprimer l'ancien.
- Les autres clés de l'en-tête (`disallowedTools`, `permissionMode`, `effort`…) dans le formulaire : elles sont gardées telles quelles.
- Choisir les outils dans une liste : la ligne de texte suffit.
- Mettre à jour un agent du catalogue quand le catalogue change (027, brief §6.10).

## Limites connues

- **Un en-tête que Cockpit ne sait pas lire se modifie sur GitHub**, dont `tools` écrit en liste YAML, pourtant documenté. Lecteur ligne à ligne, comme celui de `team.md` (029 B).
- **`description` et `tools` passent entre guillemets** dès qu'on les modifie : même valeur pour Claude Code, une ligne de diff de plus.
- **Supprimer un agent que `team.md` nomme, ou un des trois agents par défaut sans `team.md`**, fait passer la ligne `agents` du bilan au rouge (029, limites). L'écran ne le signale pas encore.
- **Un agent trop gros pour que GitHub rende son contenu** est listé (« Fichier trop gros ») mais ne s'ouvre ni ne se supprime depuis Cockpit : il faudrait son texte pour `before`. Idem pour un nom de plus de 237 caractères (le chemin dépasserait 255).
- **Deux onglets ouverts sur le même agent** : le second commit est refusé (`repo_changed`), rien n'est écrasé.
- **Une pull request ouverte (branche protégée)** : la liste relue montre encore l'ancien agent tant qu'elle n'est pas mergée ; une nouvelle modification partirait de cet ancien texte.
- **Non vérifiable ici** : un vrai commit sur un vrai repo (les tests passent par le faux GitHub de la 6.1).
