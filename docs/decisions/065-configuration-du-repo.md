# 065 — Éditer la configuration Claude du repo

- **Statut** : validée ; le code est construit (tranche 12.1)
- **Date** : 2026-11-08
- **Décidé par** : Dorian, avec Claude ([064](064-tranches-restantes.md) 12.1 A à C)
- **Dépend de** : [026 — Écrire dans un repo](026-ecrire-dans-un-repo.md), [030 — L'éditeur d'agent](030-editeur-d-agent.md), [013 — Le bilan de santé](013-bilan-de-sante.md) (la ligne MCP), [049 — La mise à jour du catalogue](049-mise-a-jour-du-catalogue.md)
- **Tranche** : 12.1 du [découpage](../decoupage.md)
- **Écran** : [S18](../ecrans/S18_ConfigClaude.png)

## Contexte

Le brief (§6.9) veut modifier depuis Cockpit tout ce que Claude lit dans un repo : `CLAUDE.md`, les règles (`.claude/rules/`), les agents, les skills et `.mcp.json`, chaque fois avec le diff montré avant, puis un commit, sans jamais écraser un fichier modifié sur GitHub entre-temps. Les agents ont leur éditeur depuis E2 (030). La 064 a tranché la place (l'onglet Agents), la règle des secrets de `.mcp.json` et la forme de l'éditeur de skill.

## Les choix

| # | Question | Décision |
|---|---|---|
| A | Lire ? | `GET /api/projects/:id/claude-config`, réservé aux membres (404 sinon), lisible sur un projet archivé. Il rend `{ claudeMd, rules, skills, mcpJson }` : `claudeMd` et `mcpJson`, le texte de `CLAUDE.md` et de `.mcp.json` à la racine (`null` sans fichier) ; `rules`, `[{ name, text }]` pour chaque fichier `.claude/rules/<name>.md` ; `skills`, `[{ name, text }]` pour chaque `.claude/skills/<name>/SKILL.md`, **sans les skills du catalogue** (`dev-us`, `write-us`, `analyser`), que la mise à jour du catalogue tient (049). Les noms suivent le format des agents (029 B), triés ; un fichier qui ne se lit pas (lien symbolique, trop gros) a un texte vide, comme pour les agents. Lu sur la branche par défaut, rien n'est stocké, la lecture ne laisse pas d'entrée. GitHub injoignable : 502 `github_unavailable` ; un repo vide ou injoignable : 409 avec le code de la 026 |
| B | Écrire ? | `POST /api/projects/:id/claude-config/apply` avec `{ kind, name?, before, after }`. `kind` est `claude_md`, `rule`, `skill` ou `mcp_json` ; **le chemin est construit par le serveur** (`CLAUDE.md`, `.claude/rules/<name>.md`, `.claude/skills/<name>/SKILL.md`, `.mcp.json`), jamais reçu, et `name` (obligatoire pour `rule` et `skill`, interdit sinon) suit le format des agents. `after: null` supprime une règle ou un skill, et seulement eux. `before` est le texte lu (`null` pour un ajout) ; `after` fait au plus 1 Mio et diffère de `before`. Un skill du catalogue est refusé (400). L'écriture passe par le même chemin que l'éditeur d'agent (026, 030 E) : un seul commit, refusé si le fichier a changé sur GitHub entre-temps (409 `repo_changed`), une PR quand la branche par défaut est protégée. Projet archivé : 409 `project_archived`. Message du commit : `feat: update CLAUDE.md (Cockpit)`, `feat: add the rule <name> (Cockpit)` (`update`, `remove`), `feat: add the skill <name> (Cockpit)` (`update`, `remove`), `feat: update .mcp.json (Cockpit)`. Historique : `save_claude_md`, `save_rule` / `delete_rule`, `save_skill` / `delete_skill`, `save_mcp_json`, avec `{ path }` |
| C | Les secrets de `.mcp.json` | Avant toute écriture, `after` doit être un objet JSON (sinon 409 `invalid_json`). Pour **chaque** serveur de `mcpServers` (pas seulement Cockpit), chaque valeur de `headers` et de `env` doit être une référence, avec la règle de la ligne MCP du bilan : `${VAR}`, éventuellement après `Bearer ` ; et son `url` ne porte ni nom d'utilisateur ni mot de passe. Sinon 409 `secret_in_clear` avec `at`, le chemin de la première valeur fautive (`mcpServers.github.headers.Authorization`). Le refus est journalisé, la valeur jamais (010 D). Supprimer `.mcp.json` n'est pas possible depuis Cockpit |
| D | L'écran | L'onglet **Agents** du projet garde son nom ; il gagne en haut les puces de S18 : **CLAUDE.md**, **Règles · N**, **Skills · N**, **Agents · N** (par défaut, ce qui existe aujourd'hui, inchangé), **.mcp.json**. L'adresse garde la puce : `/projets/:id/agents?fichier=claude-md`, `regles`, `skills`, `mcp` (sans paramètre : Agents). Sur une puce autre qu'Agents, la phrase d'état est « Ce que Claude lit dans `<projet>`. », puis « Chaque modification passe par un diff, puis un commit. » |
| E | Éditer un texte (`CLAUDE.md`, une règle, `.mcp.json`) | Comme S18 : à gauche **« Ton texte »** (une zone de texte en police mono), à droite **« Ce qui change »** (le diff, `DiffList`), dessous **« Faire le commit »** (bouton principal, grisé tant que rien ne change) et **« Annuler les changements »**, puis « N lignes changées · refusé si `<fichier>` a changé sur GitHub entre-temps ». Sans `CLAUDE.md` ni `.mcp.json` : la zone est vide et le commit crée le fichier. Les règles : une liste, « + Nouvelle règle » (un nom, puis l'éditeur vide), et « Supprimer la règle », qui demande une confirmation sur place. Après le commit, un lien vers le commit (ou la PR) ; la page relit le repo et le bilan de santé |
| F | Éditer un skill | Comme l'éditeur d'agent (030) : une liste, « + Nouveau skill », et un formulaire **Nom** (à la création seulement), **Description**, **Outils autorisés** (`allowed-tools`, séparés par des virgules, vide = pas de ligne), **Consigne** (le corps de `SKILL.md`), avec l'aperçu du fichier et son diff avant « Faire le commit ». L'entête écrit : `---`, `name: <nom>`, `description: <description>`, `allowed-tools: <outils>` si non vide, `---`, une ligne vide, puis la consigne. Un skill dont l'entête ne se lit pas s'ouvre en texte brut, comme un agent. « Supprimer le skill » avec confirmation sur place |
| G | Les refus | Chaque refus est dit en français, à côté du bouton : le fichier a changé sur GitHub (« Recharge la page pour repartir de la version de GitHub. »), le projet est archivé, le JSON n'est pas valide, une valeur n'est pas une référence (« `<at>` doit être une référence comme `${GITHUB_TOKEN}` : un secret n'est jamais écrit dans un repo. »), GitHub injoignable (« Réessayer »). Sur un projet archivé, tout se lit et les boutons sont grisés avec la raison |
| H | La couleur | Le budget de la 045 : rien en rouge sauf un refus ; « Faire le commit » est le seul bouton blanc de la zone |

## Ce que le code a précisé (tranche 12.1)

- **`at`** est dans la réponse HTTP du refus `secret_in_clear`, pas dans l'entrée de l'historique.
- **Un fichier vide ou illisible** (lien symbolique, trop gros) est montré comme non modifiable : l'éditeur ne s'ouvre pas dessus. Un fichier illisible serait de toute façon refusé à l'écriture (`repo_changed`, 026) ; un fichier vide, que Cockpit ne distingue pas d'un illisible, se modifie sur GitHub.
- **Ce qui ne se juge pas est refusé** : une valeur de `mcpServers`, d'un serveur, de `headers` ou de `env` qui n'est pas un objet (ou une valeur qui n'est pas une chaîne) pourrait cacher un secret, donc `secret_in_clear` à son propre chemin. Une `url` que `URL.parse` ne lit pas est jugée à son allure : un `//…@` y est refusé, un `${MCP_URL}` passe.
- **L'entête d'un skill** : `description` et `allowed-tools` sont écrits en texte simple quand YAML le lit tel quel, sinon en chaîne JSON entre guillemets (`a : b`, `x #y`, espaces aux bords). Ouvrir un skill sans toucher aux champs ne change pas le texte.
- **Les noms** : un nom de skill du catalogue est refusé en 400 aussi à la création ; la longueur maximale est celle qui garde `.claude/skills/<nom>/SKILL.md` sous les 255 caractères de la 026 D.
- **Les puces** sont toujours affichées, même sans fichier ni règle ; un paramètre `fichier` inconnu ouvre Agents.

## Ce qui est repoussé

- **Renommer** une règle ou un skill : supprimer puis recréer.
- **Les fichiers d'un skill autres que `SKILL.md`** (scripts, exemples) : lus sur GitHub, pas édités ici.
- **Les règles dans des sous-dossiers** de `.claude/rules/` : seules celles du premier niveau sont listées.
- **Une coloration du Markdown ou du JSON** dans la zone de texte.
