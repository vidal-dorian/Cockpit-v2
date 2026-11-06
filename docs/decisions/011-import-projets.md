# 011 — Importer et archiver un projet

- **Statut** : validée
- **Date** : 2026-10-22
- **Décidé par** : Dorian, avec Claude
- **Dépend de** : [002 — Modèle de données](002-modele-donnees.md), [008 — Service en ligne](008-service-en-ligne.md), [009 — Connexion avec GitHub](009-connexion-github.md), [010 — Historique](010-historique.md)
- **Tranche** : 2.1 du [découpage](../decoupage.md)
- **Modifiée par 012** : la configuration de l'App ne vient plus de l'environnement (créée par l'assistant, secrets en base) et ses permissions sont demandées d'un coup à la création — voir la [012](012-configuration-automatique.md)
- **Confirme** : le choix B de la [009](009-connexion-github.md) (aucun jeton GitHub d'utilisateur gardé)

## Contexte

Un projet est un repo GitHub suivi par Cockpit (brief §4). L'utilisateur choisit lui-même, sur GitHub, les repos qu'il ouvre à Cockpit en **installant la GitHub App** sur ces repos (brief §6.19, 002). Cockpit doit ensuite lister ces repos, en importer un, montrer la liste des projets et permettre d'archiver, sans jamais rien modifier sur GitHub (brief §6.1).

## Comment Cockpit lit les repos d'un utilisateur

Sans jeton d'utilisateur (009 B), avec l'**identité de l'App** ([docs GitHub](https://docs.github.com/en/rest/apps/apps)) :

1. Cockpit signe un **JWT** avec la clé privée de l'App, et demande l'installation du compte : `GET /users/{login}/installation`. Il vérifie que `account.id` est bien le `github_id` de l'utilisateur connecté (un login peut changer, l'identifiant non). Pas d'installation : la page propose de l'installer.
2. Il obtient un **jeton d'installation** (valable une heure, limité aux repos choisis) et lit `GET /installation/repositories` ([docs GitHub](https://docs.github.com/en/rest/apps/installations)).
3. **Octokit** (`@octokit/app`, 001) fait la signature et l'obtention des jetons. La liste est lue page par page (100 repos par page) par une petite boucle de Cockpit, testée à part.

Le choix B de la 009 est donc confirmé : rien de propre à l'utilisateur n'est gardé, et chaque appel est limité à ce qu'il a ouvert.

## Les choix

| # | Question | Décision |
|---|---|---|
| A | Comptes concernés | Les **comptes personnels** seulement : l'installation est celle dont `account.id` = `github_id`. Les organisations sont hors périmètre (brief §9) |
| B | Que croit-on du navigateur ? | **Rien d'autre qu'un identifiant de repo.** À l'import, Cockpit relit la liste des repos de l'installation sur GitHub et refuse un `github_repo_id` qui n'y est pas ; le nom, la branche par défaut et l'installation viennent de GitHub, jamais de la requête |
| C | Repo déjà suivi | Refus neutre, « Ce repo est déjà suivi dans Cockpit » (002, 008), y compris s'il est archivé. Le désarchivage viendra s'il manque |
| D | Données | `projects` (`github_repo_id` unique pour l'instance, `full_name`, `default_branch`, `installation_id`, `archived_at`, `created_at`) et `project_members` (le seul membre, `role = owner`, un index unique sur `project_id` en garantit un seul) comme prévu par la 002 et la 008 |
| E | Accès | **Une seule fonction** dit si un utilisateur est membre d'un projet ; un projet d'un autre compte répond `404` comme s'il n'existait pas (004) |
| F | Archiver | `archived_at` rempli, rien sur GitHub. Le projet reste dans la liste, marqué « Archivé », en fin de liste. Le bouton demande une confirmation sur place, car il n'y a pas encore de désarchivage (règle 4 de la 003) |
| G | Historique | `import_project` et `archive_project` passent par `act` (010), avec `args: { projectId }`. La colonne `project_id` de l'historique (002) arrive avec cette tranche |
| H | Configuration | Trois variables de plus : `GITHUB_APP_ID`, `GITHUB_APP_SLUG` (pour le lien « Installer l'App ») et `GITHUB_APP_PRIVATE_KEY`, la clé privée **encodée en base64 sur une ligne** (un fichier d'environnement ne garde pas bien un texte sur plusieurs lignes) |
| I | Permissions de l'App | **Metadata en lecture seule**, la seule nécessaire pour lister les repos. Les suivantes (contenu pour le bilan de santé, issues…) seront demandées par les tranches qui en ont besoin |

## Limites connues

- **Chaque affichage de la liste à importer appelle GitHub** : deux ou trois requêtes, sans cache. Suffisant pour quelques utilisateurs.
- **Un repo retiré de l'installation reste un projet** : Cockpit le saura par les webhooks (5.1). D'ici là, les appels futurs sur ce repo échoueront avec un message clair.
- **Pas de désarchivage ni de suppression** de projet. La règle des offres (« 3 repos au total », [offres](../offres.md)) compte sur cette absence de suppression.

## Pistes écartées

- **Garder le jeton de l'utilisateur pour appeler `GET /user/installations`** : un secret de plus à chiffrer et à rafraîchir, alors que l'identité de l'App suffit (009 B).
- **Enregistrer l'installation au retour de GitHub (Setup URL)** : l'identifiant reçu dans l'adresse ne prouve rien et devrait être revérifié ; relire l'installation à la demande est plus simple et toujours à jour.
- **Clé privée dans un fichier monté** : dépend des droits du fichier sur le Pi et de l'utilisateur du conteneur ; une variable en base64 passe partout.
