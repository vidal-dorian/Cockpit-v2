# 013 — Bilan de santé d'un projet (lecture)

- **Statut** : proposée (à valider à la relecture de la PR)
- **Date** : 2026-10-24
- **Décidé par** : Dorian, avec Claude
- **Dépend de** : [002 — Modèle de données](002-modele-donnees.md), [004 — Outils MCP](004-outils-mcp.md), [006 — Connexion OAuth](006-connexion-oauth.md), [011 — Importer un projet](011-import-projets.md)
- **Tranche** : 2.2 du [découpage](../decoupage.md)

## Contexte

Avant de développer une US avec Claude, un repo doit contenir ce dont Claude a besoin : un `CLAUDE.md`, une CI, le serveur MCP de Cockpit déclaré **sans secret**, les agents et la skill de développement (brief §6.1). La 002 dit que ce bilan n'a pas de table : il est relu sur GitHub à chaque affichage. Cette tranche ne fait que **lire et afficher** ; elle ne corrige rien.

## Les choix

| # | Question | Décision |
|---|---|---|
| A | Que lit Cockpit, et avec quelle identité ? | `GET /api/projects/:id/health`, avec les mêmes barrières que les autres routes de projet (503 si l'App n'est pas configurée, 401, puis 404 si l'utilisateur n'est pas membre : `memberProject`, 011). Un projet archivé reste lisible. Cockpit lit le repo du projet (`full_name`) par l'**API Contents de GitHub**, sur la **branche par défaut** (aucun `ref`), avec le jeton d'installation de l'**installation enregistrée** du projet (011 B) |
| B | Que répond-elle ? | `{ lines: [{ key, ok, detail }] }`, quatre lignes **toujours dans cet ordre** : `claude_md`, `ci`, `mcp`, `agents`. `detail` vaut `ok` quand la ligne est verte, sinon un **code fixe** : `missing` (partout), `invalid_json` et `secret_in_clear` (la ligne `mcp` seulement). Jamais de texte venu du repo : la page traduit les codes en français |
| C | Règle `claude_md` | Vert si `CLAUDE.md` ou `.claude/CLAUDE.md` existe (un fichier, pas un dossier) |
| D | Règle `ci` | Vert s'il y a au moins un fichier `*.yml` ou `*.yaml` directement dans `.github/workflows` |
| E | Règle `mcp` | Vert si `.mcp.json` déclare, dans `mcpServers`, une entrée dont l'`url` a l'**origine de l'adresse publique de l'instance** (012) et le chemin `/mcp`, et dont **chaque valeur d'en-tête et de `env` n'est faite que de références `${VAR}`**, après un `Bearer ` facultatif (un jeton en clair dans `env` est dans git même s'il ne sert pas). **Toutes** les entrées qui pointent vers Cockpit sont jugées, pas seulement la première. Une `url` avec une **query string** ou un **identifiant / mot de passe** est rouge aussi : le `/mcp` de Cockpit n'en prend pas, donc ils cacheraient un secret. Une valeur `${VAR:-défaut}` est rouge **volontairement** (le défaut pourrait être un secret : on reste du côté sûr). Une entrée sans en-têtes est verte (OAuth, 006). Rouge sinon : `missing` (pas de fichier, pas de `mcpServers`, pas d'entrée Cockpit), `invalid_json` (le fichier n'est pas un JSON), `secret_in_clear` (une valeur d'en-tête ou de `env` contient autre chose qu'une référence, ou l'`url` porte une query string ou des identifiants). Les autres serveurs du fichier ne comptent pas |
| F | Règle `agents` | Vert si `.claude/agents/test-writer.md`, `.claude/agents/developer.md`, `.claude/agents/reviewer.md` **et** `.claude/skills/dev-us/SKILL.md` existent. Sinon `missing`, sans dire lequel manque |
| G | Quand Cockpit relit-il ? | **À chaque affichage, sans cache et sans rien stocker** : pas de table, pas d'entrée dans l'historique (une lecture n'est pas une action, 010). Le bouton « Revérifier » relit |
| H | Que se passe-t-il si GitHub ne répond pas ? | Toute erreur de GitHub (réponse inattendue, 5xx, réseau, jeton d'installation refusé) donne **502 `github_unavailable`**, sans réponse partielle. Si `GET /repos/{owner}/{repo}` répond 404 (l'App n'a plus accès au repo), ou si GitHub répond 404 à la demande du jeton d'installation (l'App a été désinstallée), **409 `repo_unreachable`**. Un 404 sur un **fichier** n'est pas une erreur : c'est une ligne rouge `missing`. Un chemin que l'API Contents décrit autrement qu'en fichier ou en dossier (sous-module, lien symbolique) compte aussi comme absent, sans erreur |
| I | La page | `/projets/:id`, atteinte depuis le nom du projet dans la liste (011). Titre : le nom complet ; section « Bilan de santé » ; quatre lignes avec leur état **en mots** (« OK » / « À corriger ») et, pour une ligne rouge, une phrase d'explication en français ; « Revérifier » ; alertes pour le 502 (avec « Réessayer »), le 409 et le 404 (« Projet introuvable ») ; le lien « Se connecter avec GitHub » si la session a expiré (401) ; pas de relecture au retour sur la fenêtre (chaque lecture coûte des appels à GitHub) ; un lien de retour vers `/projets` |

## Ce qui est repoussé

- **La ligne « webhook installé et dernière livraison réussie »** (brief §6.1) arrive avec la tranche **5.1**, qui reçoit les webhooks. Avec une GitHub App, le webhook est celui de l'App et non un webhook par repo : comme l'écrit la 002, cette ligne devient « l'App est installée sur ce repo ».
- **Les corrections** (« Préparer pour Claude en un clic ») arrivent avec la tranche **6.2** : ici, aucune écriture sur GitHub.
- **La ligne `mcp` changera à la tranche OAuth** (006) : elle deviendra « Cockpit absent du `.mcp.json`, ou déclaré sans secret ». Une entrée absente ne sera alors plus rouge.

## Limites connues

- **Environ sept appels GitHub par affichage** : le repo, puis `CLAUDE.md`, `.claude/CLAUDE.md`, `.github/workflows`, `.mcp.json`, `.claude/agents` et `.claude/skills/dev-us` (les six derniers en parallèle). Raccourci assumé : sans cache, pour quelques utilisateurs. Un cache (court, vidé par « Revérifier » et par les webhooks) s'ajoutera quand les utilisateurs seront nombreux.
- **Les noms sont comparés tels quels** (`Developer.md` n'est pas `developer.md`), comme le fait `/dev-us`.
- **Un dossier de plus de 1 000 fichiers** dans `.github/workflows` serait tronqué par GitHub ; sans importance en pratique.
- **L'entrée Cockpit est reconnue par son adresse** : un `.mcp.json` écrit pour une autre adresse publique de la même instance apparaît comme absent.

## Pistes écartées

- **Stocker le dernier bilan** : il se calcule (002), et une copie périmée dirait vert à tort.
- **Lire tout le repo (arbre Git) en un appel** : moins d'appels, mais une réponse énorme sur un gros repo pour quatre questions simples.
- **Chercher un secret par motifs** (`ghp_…`, `sk-…`) : des faux négatifs garantis. La règle inverse, « seulement des références », est plus sûre, sans être absolue : une référence `${VAR}` peut elle-même désigner une variable mal choisie, et Cockpit ne lit ni les autres fichiers ni les variables d'environnement.
