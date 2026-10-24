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
| A | Que lit Cockpit, et avec quelle identité ? | `GET /api/projects/:id/health`, avec les mêmes barrières que les autres routes de projet (503 si l'App n'est pas configurée, 401, puis 404 si l'utilisateur n'est pas membre : `memberProject`, 011). Un projet archivé reste lisible. Cockpit lit le repo du projet (`full_name`) sur sa **branche par défaut** (aucun `ref`, aucun nom de branche : `HEAD`), avec le jeton d'installation de l'**installation enregistrée** du projet (011 B). **Un seul appel** : `GET /repos/{owner}/{repo}/git/trees/HEAD?recursive=1`, l'arbre Git complet. `claude_md`, `ci` et `agents` se décident sur cet arbre seul, et **seules les entrées `blob` comptent** : un lien symbolique est un blob (mode 120000) et compte comme présent, un sous-module (`type: commit`) ou un dossier non. **Un deuxième appel, seulement si `.mcp.json` est un blob de l'arbre** : `GET /repos/{owner}/{repo}/contents/.mcp.json`, pour lire son texte (un lien symbolique vers un fichier du repo est suivi par GitHub, qui sert le fichier visé, jugé par les mêmes règles ; un lien cassé ou sorti du repo, une autre forme ou un 404 compte comme absent) |
| B | Que répond-elle ? | `{ lines: [{ key, ok, detail }] }`, quatre lignes **toujours dans cet ordre** : `claude_md`, `ci`, `mcp`, `agents`. `detail` vaut `ok` quand la ligne est verte, sinon un **code fixe** : `missing` (partout), `invalid_json` et `secret_in_clear` (la ligne `mcp` seulement). Jamais de texte venu du repo : la page traduit les codes en français |
| C | Règle `claude_md` | Vert si `CLAUDE.md` ou `.claude/CLAUDE.md` existe (un fichier, pas un dossier) |
| D | Règle `ci` | Vert s'il y a au moins un fichier `*.yml` ou `*.yaml` directement dans `.github/workflows` |
| E | Règle `mcp` | Vert si `.mcp.json` déclare, dans `mcpServers`, une entrée dont l'`url` a l'**origine de l'adresse publique de l'instance** (012) et le chemin `/mcp`, et dont **chaque valeur d'en-tête et de `env` n'est faite que de références `${VAR}`**, après un `Bearer ` facultatif (un jeton en clair dans `env` est dans git même s'il ne sert pas). **Toutes** les entrées qui pointent vers Cockpit sont jugées, pas seulement la première. Une `url` avec une **query string** ou un **identifiant / mot de passe** est rouge aussi : le `/mcp` de Cockpit n'en prend pas, donc ils cacheraient un secret. Une valeur `${VAR:-défaut}` est rouge **volontairement** (le défaut pourrait être un secret : on reste du côté sûr). Une entrée sans en-têtes est verte (OAuth, 006). Rouge sinon : `missing` (pas de fichier, pas de `mcpServers`, pas d'entrée Cockpit), `invalid_json` (le fichier n'est pas un JSON), `secret_in_clear` (une valeur d'en-tête ou de `env` contient autre chose qu'une référence, ou l'`url` porte une query string ou des identifiants). Les autres serveurs du fichier ne comptent pas |
| F | Règle `agents` | Vert si `.claude/agents/test-writer.md`, `.claude/agents/developer.md`, `.claude/agents/reviewer.md` **et** `.claude/skills/dev-us/SKILL.md` existent. Sinon `missing`, sans dire lequel manque |
| G | Quand Cockpit relit-il ? | **À chaque affichage, sans cache et sans rien stocker** : pas de table, pas d'entrée dans l'historique (une lecture n'est pas une action, 010). Le bouton « Revérifier » relit |
| H | Que se passe-t-il si GitHub ne répond pas ? | Toute erreur de GitHub (réponse inattendue, 5xx, 403, réseau, jeton d'installation refusé, lecture de `.mcp.json` en erreur) donne **502 `github_unavailable`**, sans réponse partielle. Si l'arbre répond 404 (l'App n'a plus accès au repo), ou si GitHub répond 404 à la demande du jeton d'installation (l'App a été désinstallée), **409 `repo_unreachable`**. Si l'arbre répond 409 (**dépôt vide**, sans aucun commit), c'est un **200** normal où les quatre lignes sont `missing`. Un `.mcp.json` qui répond 404 ou qui n'est pas servi comme un fichier compte comme absent (`missing`), sans erreur |
| I | La page | `/projets/:id`, atteinte depuis le nom du projet dans la liste (011). Titre : le nom complet ; section « Bilan de santé » ; quatre lignes avec leur état **en mots** (« OK » / « À corriger ») et, pour une ligne rouge, une phrase d'explication en français ; « Revérifier » ; alertes pour le 502 (avec « Réessayer »), le 409 et le 404 (« Projet introuvable ») ; le lien « Se connecter avec GitHub » si la session a expiré (401) ; pas de relecture au retour sur la fenêtre (chaque lecture coûte des appels à GitHub) ; un lien de retour vers `/projets` |

## Ce qui est repoussé

- **La ligne « webhook installé et dernière livraison réussie »** (brief §6.1) arrive avec la tranche **5.1**, qui reçoit les webhooks. Avec une GitHub App, le webhook est celui de l'App et non un webhook par repo : comme l'écrit la 002, cette ligne devient « l'App est installée sur ce repo ».
- **Les corrections** (« Préparer pour Claude en un clic ») arrivent avec la tranche **6.2** : ici, aucune écriture sur GitHub.
- **La ligne `mcp` changera à la tranche OAuth** (006) : elle deviendra « Cockpit absent du `.mcp.json`, ou déclaré sans secret ». Une entrée absente ne sera alors plus rouge.

## Limites connues

- **Un appel GitHub par affichage, deux quand le repo a un `.mcp.json`**, plus le jeton d'installation (renouvelé toutes les heures, pas à chaque affichage). Raccourci assumé : sans cache, pour quelques utilisateurs. Un cache (court, vidé par « Revérifier » et par les webhooks) s'ajoutera quand les utilisateurs seront nombreux.
- **Un arbre tronqué, et lourd** : au-delà de 100 000 entrées ou de 7 Mo, GitHub coupe l'arbre (`truncated: true`). Sur un gros repo, chaque affichage télécharge donc jusqu'à 7 Mo, en moins de 10 secondes, sinon c'est une erreur 502. Cockpit s'en tient à ce que l'arbre contient, donc des lignes peuvent être rouges à tort sur un repo de cette taille. À corriger (lecture dossier par dossier) si le cas se présente.
- **Les noms sont comparés tels quels** (`Developer.md` n'est pas `developer.md`), comme le fait `/dev-us`.
- **L'entrée Cockpit est reconnue par son adresse** : un `.mcp.json` écrit pour une autre adresse publique de la même instance apparaît comme absent.

## Pistes écartées

- **Stocker le dernier bilan** : il se calcule (002), et une copie périmée dirait vert à tort.
- **Une lecture de l'API Contents par chemin** (version de départ : le repo, puis `CLAUDE.md`, `.claude/CLAUDE.md`, `.github/workflows`, `.mcp.json`, `.claude/agents` et `.claude/skills/dev-us`, soit sept appels) : sept fois plus d'appels GitHub pour la même réponse, que l'arbre Git donne en un seul.
- **L'API GraphQL de GitHub** : un seul appel aussi, mais on ne peut pas l'essayer depuis les sessions Claude Code d'ici, et il faudrait réécrire tout le faux GitHub des tests pour un appel de moins.
- **Chercher un secret par motifs** (`ghp_…`, `sk-…`) : des faux négatifs garantis. La règle inverse, « seulement des références », est plus sûre, sans être absolue : une référence `${VAR}` peut elle-même désigner une variable mal choisie, et Cockpit ne lit ni les autres fichiers ni les variables d'environnement.
