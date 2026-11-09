# 068 — Un nouveau projet depuis un repo modèle

- **Statut** : proposée (à valider à la relecture de la PR) ; le code est construit (tranche 12.5)
- **Date** : 2026-11-08
- **Décidé par** : Dorian, avec Claude ([064](064-tranches-restantes.md) 12.5 A et B)
- **Dépend de** : [009 — La connexion GitHub](009-connexion-github.md) (le flux OAuth), [011 — Importer un projet](011-import-projets.md), [012 — La configuration automatique](012-configuration-automatique.md) (D, le manifeste), [013 — Le bilan de santé](013-bilan-de-sante.md), [052 — Les constats de GitHub](052-constats-de-github-et-versions.md) (une permission ajoutée après coup)
- **Modifie** : 012 D (le manifeste demande `repository_creation` en écriture)
- **Tranche** : 12.5 du [découpage](../decoupage.md)
- **Écran** : [S20](../ecrans/S20_NouveauDepuisModele.png)

## Contexte

Le brief (§6.1) veut créer un projet à partir d'un repo modèle déjà prêt pour Claude, et vérifier qu'il naît avec un bilan vert. La 064 a tranché : les modèles sont les repos de l'utilisateur marqués « Template repository » sur GitHub, et Cockpit crée le repo lui-même. Créer un repo demande une permission que l'App n'a pas : GitHub a ajouté le 13 octobre 2026 `repository_creation`, plus étroite qu'`administration` ([changelog GitHub](https://github.blog/changelog/2026-10-13-github-app-improvements-for-least-privilege-and-management)). Sur un compte personnel, un jeton d'installation ne crée pas de repo ; un **jeton d'utilisateur** de l'App le fait ([discussion GitHub](https://github.com/orgs/community/discussions/171040)). Cockpit ne garde aucun jeton d'utilisateur (009) : il en obtient un, le temps de la création, par le même flux OAuth que la connexion.

## Les choix

| # | Question | Décision |
|---|---|---|
| A | Où ? | « Tous les projets » gagne **« Nouveau depuis un modèle »** à côté d'« Importer un repo » (S10), vers `/projets/nouveau`. Phrase d'état : « Un nouveau projet, déjà prêt pour Claude. », puis « Cockpit crée le repo à partir de ton modèle. » |
| B | Les modèles | `GET /api/templates` : les repos que l'installation de l'utilisateur atteint et que GitHub marque `is_template`, chacun avec les lignes de son bilan de santé (013, lues comme pour un projet). Pas d'entrée d'historique. Sans modèle : « Tu n'as pas encore de repo modèle. Coche « Template repository » dans les réglages d'un repo sur GitHub, puis reviens. » |
| C | Le formulaire (S20) | **Propriétaire** (le compte de l'installation de l'utilisateur ; s'il y en a plusieurs, une liste), **Nom du repo** (les caractères que GitHub accepte, 100 au plus ; « Disponible. » ou « Ce nom est déjà pris. », lu sur GitHub après la frappe), **Description** (facultative), **Modèle** (une carte par modèle : son nom, son repo, ses lignes vertes en résumé), **Visibilité** (Privé par défaut, ou Public). À droite, **« Le bilan sera vert d'emblée »** avec les lignes du bilan du modèle choisi ; une ligne rouge s'y montre rouge : « Ce modèle n'est pas tout vert : prépare-le d'abord pour Claude. » (lien « Gérer mes modèles »). « Créer le projet » (grisé tant que le nom n'est pas disponible) et « Annuler » |
| D | Créer | `POST /api/projects/from-template` avec `{ template, owner, name, description, private }` vérifie tout (le modèle est un modèle atteint par l'installation, le nom est libre), garde la demande côté serveur (dix minutes au plus, à usage unique) et rend l'adresse d'autorisation GitHub de l'App, avec un `state` comme la connexion (009). **Le retour passe par l'adresse de la connexion, `/api/auth/callback`** : c'est la seule que l'App déclare à GitHub (012 D), et GitHub n'accepte de renvoyer que vers une adresse déclarée ; Cockpit y reconnaît une création à son `state` (un cookie à part, propre à la création), si bien qu'une App déjà créée n'a rien à changer. La page y va ; au retour, le serveur échange le code contre un jeton d'utilisateur, crée le repo par `POST /repos/{modèle}/generate` (`owner`, `name`, `description`, `private`, sans les autres branches), **oublie le jeton**, puis importe le repo comme la 011 et renvoie vers le projet. Historique `create_from_template` avec `{ template, fullName }` |
| E | Le nouveau repo hors de l'installation | Si l'installation de l'App ne porte que sur des repos choisis et que le nouveau repo n'y est pas, le projet n'est pas importé : la page dit « Le repo est créé. Ouvre-le à Cockpit sur GitHub, puis importe-le. » avec le lien de l'installation et un lien vers l'import |
| F | La permission | Le manifeste (012 D) demande `repository_creation` en écriture. Une installation qui ne l'a pas encore approuvée : « Créer le projet » est grisé avec « Cockpit n'a pas encore le droit de créer des repos. Approuve la nouvelle permission sur GitHub. » et le lien, comme la 052. Si GitHub refuse quand même : « GitHub a refusé la création : `<raison>` », et rien n'est importé |
| G | Les refus | Chacun en français, à côté du bouton : le nom est pris (409 `name_taken`), le modèle n'en est plus un (409 `not_a_template`), la demande a expiré ou a déjà servi (« Recommence la création. »), l'utilisateur a refusé l'autorisation sur GitHub (« La création est annulée. »), GitHub injoignable (« Réessayer ») |
| H | Gérer les modèles | « Gérer mes modèles » mène à « Tous les projets » filtré sur rien de neuf : un modèle se prépare pour Claude comme un projet (027), une fois importé. Pas d'écran à part |

## Ce que le code a précisé (tranche 12.5)

- **Les routes** : `GET /api/templates` rend `owners` (le seul login de l'utilisateur), les modèles avec leurs lignes et `permission` (`repositoryCreation`, `installationUrl`, `appMissing` si l'App elle-même n'a pas la permission, lue d'abord comme celle de la 067) ; `GET /api/templates/name?owner=&name=` rend `available` ; `POST /api/projects/from-template` rend `authorizeUrl`.
- **La demande en attente** : table `template_requests`, clé le `sha256` du `state`. Une seule lecture : le retour la supprime (`DELETE … RETURNING`), un second retour ne trouve rien. Elle vaut dix minutes d'après `createdAt` ; les périmées sont purgées à chaque nouvelle demande. Le cookie `cockpit_template_state` (chemin `/api/auth/callback`) vit une heure, plus que la ligne, pour qu'un retour tardif arrive jusqu'au serveur et dise « Recommence la création. » plutôt qu'un échec de connexion.
- **Le passage de relais** : le callback de la connexion appelle d'abord le retour de la création ; sans cookie de création, ou avec un autre `state`, il rend la main et la connexion se déroule.
- **Les retours** : `/projets/nouveau?erreur=` suivi de `demande-expiree`, `annulee`, `github-injoignable`, `refusee` (avec `raison`, 200 caractères au plus, le message de GitHub), `hors-installation` (E) ou `creee-non-importee` (le repo a pu être créé, l'import a échoué : la page dit de l'importer). Chacun a sa phrase en français sur la page.
- **Le jeton d'utilisateur** n'est jamais écrit : ni en base, ni dans l'historique, qui ne garde que des codes fixes.
- **Limite** : la disponibilité du nom est lue avec le jeton de l'installation. Un repo privé de l'utilisateur que l'installation n'atteint pas paraît libre ; GitHub refuse alors la création et l'utilisateur arrive sur `refusee`.

## Limites connues

- **La permission `repository_creation` pour un compte personnel** : le changelog la donne pour les Apps ; ni le manifeste ni le jeton d'utilisateur n'ont pu être essayés contre le vrai GitHub (les tests n'appellent jamais GitHub, et la doc GitHub n'était pas joignable depuis la session qui a écrit cette décision). À vérifier au premier essai sur le Pi ; si GitHub refuse la clé dans le manifeste, la remplacer par `administration`.
- **L'adresse de retour** : la création revient par `/api/auth/callback`, comme la connexion (D). Une adresse à part aurait demandé de la déclarer sur l'App, à la main pour une App déjà créée.
- **Un aller-retour vers GitHub** à chaque création : GitHub ne redemande rien si l'App est déjà autorisée.
