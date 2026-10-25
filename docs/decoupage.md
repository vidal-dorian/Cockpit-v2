# Cockpit v2 — Découpage en tranches

> Une tranche = une pull request = quelque chose que Dorian peut **tester lui-même** à la fin.
> Chaque tranche traverse toute la stack (base → noyau → API → écran → tests), en petit.
> On ne commence une tranche que quand la précédente est mergée.

## Règles du découpage

- **Vertical, pas horizontal** : pas de « toute la base », puis « toute l'API », puis « toute l'interface ».
- **Petit** : si une tranche ne se relit pas en une séance, on la coupe.
- **Démontrable** : chaque tranche finit par une démo concrète (« je clique ici, je vois ça »).
- **Les règles non négociables sont là dès le début** : accès à chaque donnée par les membres de son projet, historique inaltérable, aucun secret en clair, erreurs visibles.
- **Chaque PR** contient une section « Notions TS utilisées ici ».

## Avancement

- **Fait** : étape 0 (décisions 001 à 006 validées ; 007 et 008 proposées, à valider), tranches 1.1 et 1.1 bis.
- **En cours** : tranche 1.2 (déploiement sur le Pi) : écrite et testée, le premier déploiement réel sur le Pi reste à faire.
- **Fait** : tranche 1.3 (connexion GitHub, [décision 009](decisions/009-connexion-github.md)).
- **Fait** : tranche 1.4 (historique inaltérable, [décision 010](decisions/010-historique.md)).
- **Fait** : tranche 2.1 (importer et archiver un projet, [décision 011](decisions/011-import-projets.md)).
- **Fait** : tranche 1.5 (assistant de démarrage, [décision 012](decisions/012-configuration-automatique.md)).
- **En cours** : tranche 1.6 (accueil des utilisateurs, [décision 012](decisions/012-configuration-automatique.md)) : écrite et testée, en relecture.
- **En cours** : tranche 2.2 (bilan de santé en lecture, [décision 013](decisions/013-bilan-de-sante.md)) : écrite et testée, en relecture.
- **Ensuite** : tranche 3.1.

L'architecture d'ensemble est résumée dans [`architecture.md`](architecture.md).

## Décisions déjà prises

| Sujet | Décision |
|---|---|
| Langage | TypeScript (Dorian l'apprend) |
| Distribution | Un service en ligne : les clients se connectent, ils n'installent rien, voir [`decisions/008-service-en-ligne.md`](decisions/008-service-en-ligne.md) |
| Hébergement | Sur le Raspberry Pi (Cloudflare Tunnel) tant que seuls Dorian et des proches l'utilisent ; chez un hébergeur dès les premiers clients payants (008) |
| Utilisateurs | Membres d'un projet et connexion GitHub dès le début, avec un seul membre par projet au MVP ; invitations, admin et partage plus tard (008) |
| Données v1 | Aucune reprise, aucun code de la v1 |
| Périmètre de départ | La boucle cœur, en local seulement |
| Lancement local | Claude Desktop installé sur le PC ; Cockpit ouvre la session via `claude://code/new`, voir [`decisions/005-lancement-local.md`](decisions/005-lancement-local.md) |
| Relecture | Dorian relit toutes les PR |
| Stack | Node + Hono + React/Vite + PostgreSQL/Drizzle + Zod + SSE, voir [`decisions/001-stack.md`](decisions/001-stack.md) et [`decisions/008-service-en-ligne.md`](decisions/008-service-en-ligne.md) |

---

## Étape 0 — Concevoir (sans code)

Des discussions, chacune conclue par un court fichier dans `docs/decisions/`.

| # | Sujet | Résultat |
|---|---|---|
| 0.1 | Stack technique | `001-stack.md` validé |
| 0.2 | Modèle de données (projets, tickets, US, runs, historique, utilisateurs) | `002-modele-donnees.md` + schéma |
| 0.3 | Interface : carte de navigation et maquettes des écrans de la boucle | `003-interface.md` + maquettes |
| 0.4 | Liste des outils MCP et ce que chacun a le droit de faire | `004-outils-mcp.md` |
| 0.5 | Lancement local via Claude Desktop (modèle, mode, chemin du clone) | `005-lancement-local.md` |
| 0.6 | Connexion de Claude à Cockpit par OAuth (connecteur claude.ai), après le MVP | `006-connexion-oauth.md` |
| 0.7 | Analyser et reprendre une app existante (fonctionnalité phare), après le MVP | `007-reprise-app-existante.md` |
| 0.8 | Cockpit service en ligne : PostgreSQL, membres d'un projet, hébergement | `008-service-en-ligne.md` |
| 0.9 | Connexion avec GitHub (tranche 1.3) | `009-connexion-github.md` |
| 0.10 | Historique inaltérable (tranche 1.4) | `010-historique.md` |
| 0.11 | Importer et archiver un projet (tranche 2.1) | `011-import-projets.md` |
| 0.12 | Configuration automatique et consentements (tranches 1.5 et 1.6) | `012-configuration-automatique.md` |
| 0.13 | Bilan de santé d'un projet (tranche 2.2) | `013-bilan-de-sante.md` |

---

## Phase 1 — Fondations

| # | Tranche | Démo |
|---|---|---|
| 1.1 | **Squelette** : serveur, page React vide servie par le serveur, base SQLite avec sa première migration (remplacée par PostgreSQL en 1.1 bis), tests, lint, CI remplie | `npm test` passe, la CI est verte, une page « Cockpit » s'affiche en local |
| 1.1 bis | **Passer à PostgreSQL** : pilote `pg`, PGlite dans les tests, migration de départ régénérée, conventions de `CLAUDE.md` mises à jour (008) | `npm test` passe sans serveur de base ; `npm start` fonctionne avec un PostgreSQL local |
| 1.2 | **Déploiement sur le Pi** : `deploy.sh` réel, Docker Compose (Cockpit, PostgreSQL dans un volume, `cloudflared`), sauvegarde quotidienne de la base | La page s'affiche à l'adresse publique du Pi après un lancement du CD |
| 1.3 | **Connexion GitHub** : connexion via la GitHub App, liste des comptes autorisés en configuration (remplacée en 1.6 par l'inscription ouverte, [012](decisions/012-configuration-automatique.md)), déconnexion | Je me connecte avec GitHub et je vois mon nom |
| 1.4 | **Historique inaltérable** : table du journal protégée par la base, fonction « action métier » (vérifie le droit → applique → journalise, dans une seule transaction), connexion et déconnexion journalisées, page Journal simple | Ma connexion apparaît dans le journal ; un test prouve qu'une entrée ne peut être ni modifiée ni supprimée |
| 1.5 | **Assistant de démarrage** ([012](decisions/012-configuration-automatique.md)) : code de démarrage, création de la GitHub App par le flux du manifeste avec toutes les permissions du MVP, secrets chiffrés en base et clé dans son volume, adresse publique détectée puis confirmée, premier compte administrateur ; suppression des variables GitHub et de `PUBLIC_URL` ; `deploy.sh` génère le mot de passe de la base ; README réécrit | Sur une installation neuve, j'entre le code, je clique « Créer l'App GitHub » puis « Create GitHub App » sur GitHub, et je me connecte en administrateur, sans rien écrire dans le fichier d'environnement que le jeton du tunnel |
| 1.6 | **Accueil des utilisateurs** ([012](decisions/012-configuration-automatique.md)) : inscription ouverte, liste des utilisateurs et blocage dans la page « Réglages » de l'administrateur ; renvoi automatique vers une page d'accueil et bandeau tant que l'App n'est pas installée | Un proche se connecte avec son compte GitHub, sans que j'aie rien à accepter ; je peux le bloquer dans « Réglages » ; à sa première connexion, il arrive sur la page qui explique l'installation de l'App, et un bandeau le lui rappelle tant qu'elle n'est pas installée |

## Phase 2 — Projets

| # | Tranche | Démo |
|---|---|---|
| 2.1 | **Importer un projet** : l'utilisateur choisit ses repos sur GitHub (installation de la GitHub App), Cockpit les liste, j'en importe un ; liste de mes projets ; archiver | J'importe un repo, il apparaît ; un autre utilisateur ne le voit pas (test d'isolation) |
| 2.2 | **Bilan de santé (lecture)** : `CLAUDE.md`, CI, serveur MCP déclaré sans secret, agents et skill présents — vert ou rouge | La page du projet affiche chaque ligne avec son état réel |

## Phase 3 — Tickets

| # | Tranche | Démo |
|---|---|---|
| 3.1 | **Ticket** : créer (titre + projet suffisent), description markdown, modifier, supprimer ; liste par projet ; étape « Nouveau » calculée | Je crée un ticket, je le modifie, il s'affiche « Nouveau » ; chaque action est dans le journal |

## Phase 4 — Serveur MCP et user stories

| # | Tranche | Démo |
|---|---|---|
| 4.1 | **Jetons MCP** : créer (affiché une seule fois, stocké haché), nommer, révoquer | Je crée un jeton, je ne peux plus le revoir, je le révoque |
| 4.2 | **Serveur MCP minimal** : authentification par jeton, enrobage qui journalise **chaque** appel (réussite, erreur, refus), outils `list_projects`, `get_project`, `search`, `get_ticket` et `create_ticket` (voir [`decisions/004-outils-mcp.md`](decisions/004-outils-mcp.md)) | Dans Claude Code, « liste mes projets » et « note cette idée sur X » fonctionnent ; l'appel est dans le journal ; un faux jeton est refusé et journalisé |
| 4.3 | **Claude écrit les US** : outils `list_tickets_needing_us`, `create_user_stories` (tout ou rien, refus si un champ ou un critère manque) et `get_user_story` ; `search` couvre aussi les US ; page d'une US, étape du ticket calculée, skill `/write-us` dans le catalogue de Cockpit | Je demande à Claude d'écrire les US d'un ticket : elles apparaissent « à valider », le ticket passe « À valider » |
| 4.4 | **Décisions humaines sur une US** : valider, modifier, renvoyer avec commentaire obligatoire, abandonner ; outil `update_user_story` pour la réécriture ; **table des droits** (qui peut faire quelle transition) testée ligne par ligne ; historique de l'US (Claude et humain distingués) | Je renvoie une US, Claude la réécrit, je la valide ; Claude ne peut ni valider ni abandonner (refus journalisé) |
| 4.5 | **Kanban par projet** : colonnes à valider, prêtes, en cours, en revue, terminées ; sans glisser-déposer | Le tableau reflète l'état réel des US |
| 4.6 | **Publication en issue GitHub** : à la validation, l'US devient une issue (gabarit unique, label de statut), tenue à jour | Je valide une US, l'issue apparaît sur GitHub ; je modifie l'US, l'issue suit |

## Phase 5 — Webhooks GitHub

| # | Tranche | Démo |
|---|---|---|
| 5.1 | **Recevoir les webhooks** : vérification de la signature, livraison enregistrée avant d'être traitée (008), journalisation, ligne « webhook installé et dernière livraison réussie » du bilan de santé | Un événement GitHub apparaît dans le journal ; le bilan passe au vert |
| 5.2 | **Issue modifiée sur GitHub** : Cockpit le signale avec le diff ; l'humain choisit la version à garder | Je modifie l'issue sur GitHub, Cockpit me montre le diff et me laisse choisir |

## Phase 6 — Préparer les repos pour Claude

Doit précéder le développement : le skill `/dev-us` et ses agents doivent être dans le repo.

| # | Tranche | Démo |
|---|---|---|
| 6.1 | **Écrire dans un repo sans rien écraser** : diff montré avant, un commit, refus si le fichier a changé sur GitHub entre-temps | Mécanisme testé contre un faux GitHub |
| 6.2 | **Catalogue + « Préparer pour Claude en un clic »** : skill `/dev-us`, agents test-writer, developer, reviewer, `.mcp.json` sans secret ; un seul commit montré fichier par fichier | Sur un repo rouge, un clic → je vois les fichiers → je valide → le bilan passe au vert |

## Phase 7 — Développer une US en local

| # | Tranche | Démo |
|---|---|---|
| 7.1 | **Run minimal** : outils `start_run` (US → « en cours », un seul run actif par US), `report_step`, `finish_run` ; page du run mise à jour en direct (SSE) | Depuis une session Claude Code, un run démarre et ses étapes s'affichent en direct dans Cockpit |
| 7.2 | **Fenêtre « Développer avec Claude »** : branche (nouvelle, au nom proposé selon la convention, ou existante ; créée et poussée par `/dev-us`), prompt complémentaire, rappel des dépendances ; chemin du clone retenu par le navigateur, par projet ; le bouton ouvre Claude Desktop sur le clone avec `/dev-us` prérempli, et « Copier le prompt » en secours (voir [`decisions/005-lancement-local.md`](decisions/005-lancement-local.md)) | Un clic dans Cockpit → Desktop s'ouvre dans le bon dossier avec le prompt prêt |
| 7.3 | **Critères et PR** : `report_criterion` (résultat + preuve), `link_pull_request` (US → « en revue ») | À la fin du run, chaque critère a son résultat et la PR est liée |
| 7.4 | **Questions de Claude** : `ask_user` / `get_answer`, champ de réponse sur la page du run | Claude pose une question, je réponds dans Cockpit, il reprend |
| 7.5 | **Arrêter, relancer, fermer** : arrêt demandé (lu à la prochaine étape), relance avec commentaire sur la même branche, fermeture à la main d'un run muet ; run échoué → US « prête » | Je demande l'arrêt, Claude s'arrête à l'étape suivante |
| 7.6 | **Suivi de la PR** : par webhooks — ouverte, mergée → US terminée, fermée → US prête ; CI et revue ; bloc GitHub sur la page de l'US ; bouton « Actualiser » | Je merge sur GitHub, l'US passe « terminée » toute seule |
| 7.7 | **Aide à la décision** : critères + CI → verdict « acceptable » ou « à vérifier » avec les raisons | La fin d'un run affiche le verdict |

## Phase 8 — Accueil

| # | Tranche | Démo |
|---|---|---|
| 8.1 | **« Qu'est-ce qui m'attend ? »** : À toi de jouer, Claude travaille, Projets ; pastille par projet dans la barre latérale | L'accueil liste exactement ce qui attend mon action, chaque élément mène où agir |

**→ Fin du MVP : la boucle complète idée → US → validation → développement → PR → merge fonctionne en local.**

---

## Après le MVP (ordre à rediscuter le moment venu)

- **Analyser et reprendre une app existante** (fonctionnalité phare) : sur un repo construit sans Cockpit, Claude dépose par le MCP la carte du modèle (un diagramme par sous-projet), les règles métier et des constats (bugs, failles, architecture, stack, versions), chacun en citant le code, vérifié sur GitHub ; je valide chaque règle en regard du code lu, un test la fige, et chaque constat retenu devient un ticket. Six tranches, voir [`decisions/007-reprise-app-existante.md`](decisions/007-reprise-app-existante.md) :

  | # | Tranche | Démo |
  |---|---|---|
  | R1 | **Carte** : vérification des citations, `submit_code_map`, écran « Conception », vue « Modèle », skill `/analyser` | Sur un repo web + API, je vois deux diagrammes ; un clic sur un objet montre son code |
  | R2 | **Règles** : `create_takeover_stories`, écran de reprise | Je vois le code à gauche et la règle à droite, je la valide |
  | R3 | **Graphe par fonctionnalité** : acteurs, fonctionnalités, règles, objets ; export Markdown | Je clique une règle dans le graphe et j'arrive sur l'écran de reprise |
  | R4 | **Figer l'existant** : mode de `/dev-us` | La règle validée a son test, qui passe |
  | R5 | **Constats de Claude** : bugs, failles, architecture, stack ; page Constats et tri | Une faille trouvée devient un ticket en un clic |
  | R6 | **Constats de GitHub et versions** : alertes Dependabot, code scanning, secret scanning ; fin de vie des runtimes | Node 20 en fin de vie est signalé sur la carte |
- **Projets** : créer depuis un repo modèle, gérer le repo modèle.
- **Configuration Claude** : éditer `CLAUDE.md`, règles, agents, skills et `.mcp.json` depuis Cockpit ; configuration globale (repo de plugins).
- **Tickets** : pièces jointes, priorité et tags, capture rapide depuis n'importe quel écran, recherche plein texte, import des issues GitHub existantes.
- **GitHub** : supprimer la branche d'une US mergée, changelog par projet.
- **Plusieurs utilisateurs** : invitations, administration, plusieurs membres par projet (008).
- **Service payant** : passage chez un hébergeur ; facturation, offre gratuite et offre payante, fonctions payantes bloquées côté serveur (008). Idées d'offres et de prix : [`offres.md`](offres.md).
- **Connexion OAuth** : Cockpit devient un connecteur claude.ai, disponible en local, dans le cloud et sur le téléphone sans jeton à copier ; démo : j'ajoute Cockpit sur claude.ai, je me connecte, « liste mes projets » marche depuis le téléphone. Voir [`decisions/006-connexion-oauth.md`](decisions/006-connexion-oauth.md). À faire avant ou avec le cloud.
- **Cloud** : sessions cloud, routines.
- **Automatisations** : file d'attente ; la relance automatique est peut-être remplacée par l'Auto-fix natif de Claude Code (à étudier).
- **Coût et budget** (télémétrie OpenTelemetry), **notifications** sur le téléphone, **CI/CD proposée par Claude** (« brancher un PC en une commande » est couvert par la connexion OAuth).
- **Ergonomie** : raccourcis clavier, recherche globale, thème clair/sombre, version mobile (PWA).

## Points ouverts

- **Relancer une US en revue** (CI rouge après l'ouverture de la PR) : à trancher en 7.5, voir [`decisions/004-outils-mcp.md`](decisions/004-outils-mcp.md).
