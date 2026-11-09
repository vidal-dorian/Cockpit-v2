# 066 — La configuration commune à tous les projets

- **Statut** : validée ; le code est construit (tranche 12.3)
- **Date** : 2026-11-08
- **Décidé par** : Dorian, avec Claude ([064](064-tranches-restantes.md) 12.3 A à C)
- **Dépend de** : [026 — Écrire dans un repo](026-ecrire-dans-un-repo.md), [030 — L'éditeur d'agent](030-editeur-d-agent.md), [065 — La configuration du repo](065-configuration-du-repo.md) (l'éditeur de skill), [049 — La mise à jour du catalogue](049-mise-a-jour-du-catalogue.md)
- **Revient sur** : le brief §9 (`settings.json` hors périmètre), pour deux clés seulement (064 12.3 B)
- **Modifiée par** : [074 — Les équipes à la demande](074-equipes-a-la-demande.md) : l'entrée « Équipes d'agents » (A) ouvre `/equipes`, les équipes de l'utilisateur ; cette page reste sur `/equipes/commun`, avec un lien depuis `/equipes`
- **Tranche** : 12.3 du [découpage](../decoupage.md)
- **Écran** : [S39](../ecrans/S39_ConfigGlobale.png)

## Contexte

Le brief (§6.9) veut des agents et des skills définis une fois et disponibles dans tous les projets, dans un repo de plugins personnel. La 064 a tranché : une **marketplace de plugins Claude Code** dans un repo que l'utilisateur crée lui-même, et, dans chaque projet, les seules clés `extraKnownMarketplaces` et `enabledPlugins` de `.claude/settings.json`. La doc de Claude Code : une marketplace est un repo avec `.claude-plugin/marketplace.json` (`name`, `owner`, `plugins` avec `name` et `source`) ; un plugin a `.claude-plugin/plugin.json` (`name`), ses agents dans `agents/` et ses skills dans `skills/<nom>/SKILL.md` ; un projet la déclare dans son `.claude/settings.json` ([marketplaces](https://code.claude.com/docs/en/plugin-marketplaces), [par repository](https://code.claude.com/docs/en/plugins/org.md#require-plugins-per-repository)).

## Les choix

| # | Question | Décision |
|---|---|---|
| A | Où ? | Une page **« Équipes d'agents › Commun »** sur `/equipes/commun`, ouverte par une entrée **« Équipes d'agents »** dans la section « Configurer » de la barre latérale. Phrase d'état : « Ce que tous tes projets partagent. », puis « Défini une fois, dans ton repo de plugins. » |
| B | Relier le repo | Sans repo relié, la page dit « Crée un repo sur GitHub avec un premier commit (un README suffit), ouvre-le à Cockpit, puis relie-le ici. » (un repo sans aucun commit ne peut pas recevoir le premier commit de Cockpit, 026) et propose les repos que l'installation de l'App de l'utilisateur atteint (comme l'import, 011), avec « Relier ». `PUT /api/plugins/repo` avec `{ fullName }` : le repo doit être atteint par l'installation de l'utilisateur (sinon 409 `repo_unreachable`). Gardé sur l'utilisateur (une colonne `users.plugin_repo`, nouvelle migration), journalisé `link_plugin_repo` ; « Délier » (`fullName: null`) le retire, `unlink_plugin_repo`. Délier ne touche ni le repo ni les projets ; « Délier » reste proposé quand le repo relié ne se lit plus (409) |
| C | Ce que Cockpit écrit dans le repo de plugins | La marketplace s'appelle `cockpit-<login>` (le login GitHub en minuscules), le plugin `commun`. Fichiers : `.claude-plugin/marketplace.json` = `{ "name": "cockpit-<login>", "owner": { "name": "<login>" }, "plugins": [{ "name": "commun", "source": "./plugins/commun", "description": "Les agents et skills communs de <login>, écrits par Cockpit" }] }` ; `plugins/commun/.claude-plugin/plugin.json` = `{ "name": "commun", "description": "…" }` ; les agents dans `plugins/commun/agents/<nom>.md`, les skills dans `plugins/commun/skills/<nom>/SKILL.md`. Les deux fichiers `.claude-plugin` sont ajoutés **dans le même commit** que le premier agent ou skill, s'ils manquent ; s'ils existent, Cockpit ne les réécrit pas |
| D | Lire | `GET /api/plugins` rend `{ repo, agents, skills }` : `repo` le `owner/name` relié ou `null` ; `agents` et `skills` comme la 065 A (noms au format des agents, triés, texte vide pour un fichier illisible). GitHub injoignable : 502 ; repo plus atteint : 409 `repo_unreachable`. Pas d'entrée d'historique |
| E | Éditer un agent ou un skill commun | Les formulaires existants : celui de l'éditeur d'agent (030) et celui du skill (065 F), avec diff et « Faire le commit ». `POST /api/plugins/apply` avec `{ kind: "agent" \| "skill", name, before, after }` (`after: null` supprime), chemin construit par le serveur, écriture par le même chemin que 026 (refus `repo_changed`, PR si la branche est protégée). Messages : `feat: add the shared agent <nom> (Cockpit)` (`update`, `remove`), de même pour `skill`. Historique : `save_shared_agent` / `delete_shared_agent`, `save_shared_skill` / `delete_shared_skill`, avec `{ path }` |
| F | Installer dans un projet | Sur la page, la liste des projets non archivés de l'utilisateur, chacun **« installé »** ou non, avec **« Installer »** ou **« Retirer »**, et en tête « installé dans N projets sur M ». `GET /api/plugins/projects` lit le `.claude/settings.json` de chaque projet. Installer pose `extraKnownMarketplaces["cockpit-<login>"] = { "source": { "source": "github", "repo": "<owner/name>" } }` et `enabledPlugins["commun@cockpit-<login>"] = true` ; retirer enlève ces deux entrées (et une clé devenue vide). **Les autres clés ne changent pas.** Le texte écrit est `JSON.stringify(objet, null, 2)` suivi d'un saut de ligne ; un projet sans fichier le reçoit. Un « installé » est un `enabledPlugins["commun@cockpit-<login>"] === true` |
| G | Le diff de `settings.json` | Une seule fonction pure, dans `src/server/`, calcule le texte écrit à partir du texte lu ; la page l'importe pour montrer le diff avant « Faire le commit », le serveur la rejoue : `POST /api/projects/:id/plugins/apply` avec `{ install, before }` recalcule `after` depuis `before` et écrit seulement si le fichier n'a pas changé sur GitHub (026). Un `settings.json` qui n'est pas un objet JSON : 409 `invalid_settings` (« modifie-le sur GitHub »). Repo de plugins non relié : 409 `no_plugin_repo`. Message : `feat: install the shared plugin (Cockpit)` ou `remove`, historique `install_shared_plugin` / `remove_shared_plugin` |
| H | Ce que S39 montre et qui n'est pas construit | Les skills du catalogue (`/dev-us`, `/write-us`) dans le repo de plugins : ils restent copiés dans chaque repo et tenus par la mise à jour du catalogue (049). « utilisé par 3 équipes » : retiré |

## Ce que le code a précisé (tranche 12.3)

- **Le calcul de G** est `pluginSettings` : les clés déjà là gardent leur ordre, les nouvelles sont ajoutées à la fin.
- **Un refus du lien est journalisé** (010 C) : `repo_unreachable` à `link_plugin_repo` ; un échec GitHub l'est aussi, en 502.
- **Un projet que l'installation de l'App n'atteint plus** est rendu non installé, sans appel à GitHub (limite connue : « Installer » y échouera à l'écriture).
- **Un repo sans aucun commit** : 409 `empty_repo`, à la lecture comme à l'écriture.
- **« Délier »** est proposé sur tout 409 de la lecture, pas seulement `repo_unreachable`.

## Limites connues

- **Repo de plugins privé** : Claude Code le clone avec les accès git de la machine ; une session cloud doit pouvoir le lire. À vérifier à l'usage.
- **Les noms dans Claude Code** : un skill du plugin s'appelle `/commun:<nom>`. Les équipes (`team.md`) ne référencent pas les agents communs dans cette tranche.
- **Dossier de confiance** : en local, Claude Code n'applique la marketplace d'un repo qu'après que l'utilisateur a accepté la confiance du dossier.
