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

- **Fait** : étape 0 (décisions 001 à 006 validées), tranches 1.1 et 1.1 bis.
- **Fait** : tranche 1.2 (déploiement sur le Pi, en service : plusieurs déploiements réels et la boucle complète sur un vrai repo).
- **Fait** : tranche 1.3 (connexion GitHub, [décision 009](decisions/009-connexion-github.md)).
- **Fait** : tranche 1.4 (historique inaltérable, [décision 010](decisions/010-historique.md)).
- **Fait** : tranche 2.1 (importer et archiver un projet, [décision 011](decisions/011-import-projets.md)).
- **Fait** : tranche 1.5 (assistant de démarrage, [décision 012](decisions/012-configuration-automatique.md)).
- **Fait** : tranche 1.6 (accueil des utilisateurs, [décision 012](decisions/012-configuration-automatique.md)).
- **Fait** : tranche 2.2 (bilan de santé en lecture, [décision 013](decisions/013-bilan-de-sante.md)).
- **Fait** : tranche 3.1 (ticket, [décision 014](decisions/014-tickets.md)).
- **Fait** : tranche 4.1 (jetons MCP, [décision 015](decisions/015-jetons-mcp.md)).
- **Fait** : tranche 4.2 (serveur MCP minimal, [décision 016](decisions/016-serveur-mcp.md)).
- **Fait** : tranche 4.3 (Claude écrit les US, [décision 017](decisions/017-user-stories.md)).
- **Fait** : tranche 4.4 (décisions humaines sur une US, [décision 018](decisions/018-decisions-humaines.md)).
- **Fait** : tranche 4.5 (Kanban par projet, [décision 019](decisions/019-kanban.md)).
- **Fait** : tranche 4.6 (publication en issue GitHub, [décision 020](decisions/020-issues-github.md)).
- **Fait** : tranche 4.7 (connecter Claude en un minimum de clics, [décision 021](decisions/021-connecter-claude.md), qui met en œuvre la [006](decisions/006-connexion-oauth.md)).
- **Fait** : tranche 4.8 (programmer l'écriture des US, [décision 022](decisions/022-routine-ecriture-us.md)).
- **Fait** : tranche 5.1 (recevoir les webhooks, [décision 024](decisions/024-webhooks.md)).
- **Fait** : tranche 5.2 (issue modifiée sur GitHub, [décision 025](decisions/025-issue-modifiee-sur-github.md)).
- **Fait** : tranche 6.1 (écrire dans un repo sans rien écraser, [décision 026](decisions/026-ecrire-dans-un-repo.md)).
- **Fait** : tranche 6.2 (préparer un repo pour Claude en un clic, [décision 027](decisions/027-preparer-pour-claude.md)).
- **Fait** : décision 028 (style « Crème sombre », onglets) et tranche E1 (`/dev-us` lit `.claude/team.md`, [décision 029](decisions/029-equipe-d-agents.md)).
- **Fait** : tranche E2 (éditeur d'agent, [décision 030](decisions/030-editeur-d-agent.md)).
- **Fait** : tranche E3 (l'équipe en graphe, [décision 031](decisions/031-equipe-en-graphe.md)).
- **Fait** : tranche E4 (plusieurs équipes, [décision 032](decisions/032-plusieurs-equipes.md)), puis « Nouvelle équipe » dans une fenêtre ([décision 042](decisions/042-nouvelle-equipe-fenetre.md)).
- **Fait** : tranche 7.1 (run minimal, [décision 033](decisions/033-run-minimal.md)).
- **Fait** : tranche 7.2 (fenêtre « Développer avec Claude », [décision 034](decisions/034-developper-avec-claude.md)).
- **Fait** : tranche 7.3 (critères et PR, [décision 035](decisions/035-criteres-et-pr.md)).
- **Fait** : tranche 7.4 (questions de Claude, [décision 036](decisions/036-questions-de-claude.md)).
- **Fait** : tranche 7.5 (arrêter, relancer, fermer, [décision 037](decisions/037-arreter-relancer-fermer.md)).
- **Fait** : tranche 7.6 (suivi de la PR, [décision 038](decisions/038-suivi-de-la-pr.md)).
- **Fait** : tranche 7.7 (aide à la décision, [décision 039](decisions/039-aide-a-la-decision.md)), et avec elle la phase 7.
- **Fait** : tranche 8.1 (l'accueil, [décision 040](decisions/040-accueil.md)), et avec elle le MVP.
- **Fait** : tranche 9.2 (changelog complet : la prochaine release liste chaque tranche une fois, et chaque PR y ajoute une ligne, son titre).
- **Fait** : tranche 9.3 (l'interface « Quatre temps », [décision 045](decisions/045-interface-quatre-temps.md) : jetons, polices, coque et écrans existants, alignés sur leurs maquettes ; le reste de la décision suit avec la tranche de chaque écran).
- **Feuille de route** : les phases après le MVP, plus bas, sont ordonnées (décidé le 2026-11-06).
- **Fait** : tranche 9.1 (ménage de la doc : `decoupage.md`, `architecture.md`, README et décisions relus contre le code).
- **Fait** : tranche 9.4 (logo « la boucle », [décision 046](decisions/046-logo-la-boucle.md)).
- **Fait** : tranche R1 (la carte du code, [décision 043](decisions/043-carte-du-code.md)), la première de la phase 10.
- **Fait** : tranche R2 (les règles et l'écran de reprise, [décision 047](decisions/047-ecran-de-reprise.md)).
- **Fait** : tranche R3 (le graphe par fonctionnalité, [décision 048](decisions/048-graphe-par-fonctionnalite.md)).
- **Fait** : tranche C1 (la mise à jour du catalogue, [décision 049](decisions/049-mise-a-jour-du-catalogue.md)).
- **Fait** : tranche R4 (figer l'existant, [décision 050](decisions/050-figer-l-existant.md)).
- **Fait** : tranche R5 (les constats de Claude, [décision 051](decisions/051-constats-de-claude.md)).
- **Fait** : tranche R6 (les constats de GitHub et les versions, [décision 052](decisions/052-constats-de-github-et-versions.md)).
- **Fait** : tranche 11.1 (le Journal filtrable et l'historique par projet, [décision 053](decisions/053-journal-filtrable.md)).
- **Fait** : tranche 14.1 (lancer dans le cloud, [décision 054](decisions/054-lancer-dans-le-cloud.md)).
- **Fait** : tranche 14.2 (les routines, [décision 056](decisions/056-routines.md)).
- **Fait** : tranche 14.3 (la file d'attente, [décision 058](decisions/058-file-d-attente.md)).
- **Fait** : tranche 11.2 (les tickets complets, [décision 055](decisions/055-tickets-complets.md)).
- **Fait** : tranche 11.3 (importer les issues GitHub, [décision 057](decisions/057-importer-les-issues.md)).
- **Fait** : tranche 14.4 (la relance automatique, [décision 059](decisions/059-relance-automatique.md)).
- **Fait** : tranche 14.5 (le coût et le budget, [décision 060](decisions/060-cout-et-budget.md)).
- **Fait** : tranche 11.4 (les pièces jointes, [décision 061](decisions/061-pieces-jointes.md)).
- **Fait** : tranche 14.6 (la nuit de Claude, [décision 044](decisions/044-la-nuit-de-claude.md)) ; la phase 14 est terminée.
- **Fait** : tranche 11.5 (après le merge : le changelog et les branches à nettoyer, [décision 062](decisions/062-apres-le-merge.md)).
- **Fait** : tranche 11.6 (les équipes de départ Éco, Standard, Premium et Max, [décision 063](decisions/063-equipes-de-depart.md)) ; la phase 11 est terminée.
- **Fait** : tranche 12.1 (la configuration Claude du repo : `CLAUDE.md`, règles, skills et `.mcp.json`, [décision 065](decisions/065-configuration-du-repo.md)).
- **Fait** : tranche 12.3 (la configuration commune à tous les projets : un repo de plugins relié, ses agents et skills, installés dans chaque projet par `.claude/settings.json`, [décision 066](decisions/066-configuration-commune.md)).
- **Fait** : tranche 12.4 (l'onglet CI / CD : les workflows, une CI de départ, les changements que Claude propose, [décision 067](decisions/067-ci-cd.md)).
- **Fait** : tranche 12.5 (un nouveau projet depuis un repo modèle, [décision 068](decisions/068-repo-modele.md)) ; la phase 12 est terminée (la 12.2 est couverte par la 11.6).
- **Fait** : tranche 9.5 (les étapes à venir et « Pourquoi Claude demande » sur un run, la carte du Kanban ouverte dans le panneau de droite, [décision 069](decisions/069-finitions.md)).
- **Fait** : tranche 14.7 (le matin de la nuit : le bilan avec les critères prouvés, la frise à l'échelle des heures sur l'accueil, « Relire en série » et la touche R, [décision 070](decisions/070-le-matin-de-la-nuit.md)).
- **Fait** : tranche 15.1 (les trois gestes au téléphone : la barre du bas, le panneau « Noter une idée » en plein écran avec « Photo », le panneau de l'accueil sous « 1 · Maintenant », [décision 071](decisions/071-trois-gestes-au-telephone.md)).
- **Fait** : tranche 15.2 (PWA et notifications : l'application installable, quatre notifications sur le téléphone avec un silence réglable, « Cockpit ne répond plus », [décision 072](decisions/072-pwa-et-notifications.md)).
- **Fait** : tranche 15.3 (ergonomie : recherche `Ctrl K`, raccourcis clavier, thème clair (palette acceptée par Dorian le 2026-11-09), projets favoris, [décision 073](decisions/073-ergonomie.md)).
- **Fait** : hors tranche, des demandes de Dorian du 2026-11-09 (le niveau de l'équipe de départ choisi après « Importer », dans un carrousel ; des équipes d'agents créées une fois et ajoutées à un projet, avec un avertissement au lancement quand l'équipe du repo a changé, [décision 074](decisions/074-equipes-a-la-demande.md)).
- **Prêt à développer** : chaque tranche restante a ses points ouverts tranchés avec Dorian le 2026-11-08, dans la [064](decisions/064-tranches-restantes.md). L'ordre : phase 12, puis 9.5 et 14.7 (faites), puis phase 15 (15.1 à 15.3 faites), puis E6, puis phase 13 dans l'ordre 13.1, 13.2, 13.5 (13.3 et 13.4 attendent Dorian ; ordre précisé par Dorian le 2026-11-09).

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
| 0.14 | Les tickets (tranche 3.1) | `014-tickets.md` |
| 0.15 | Les jetons MCP (tranche 4.1) | `015-jetons-mcp.md` |
| 0.16 | Le serveur MCP (tranche 4.2) | `016-serveur-mcp.md` |
| 0.17 | Claude écrit les user stories (tranche 4.3) | `017-user-stories.md` |

---

## Phase 1 — Fondations

| # | Tranche | Démo |
|---|---|---|
| 1.1 | **Squelette** : serveur, page React vide servie par le serveur, base SQLite avec sa première migration (remplacée par PostgreSQL en 1.1 bis), tests, lint, CI remplie | `npm test` passe, la CI est verte, une page « Cockpit » s'affiche en local |
| 1.1 bis | **Passer à PostgreSQL** : pilote `pg`, PGlite dans les tests, migration de départ régénérée, conventions de `CLAUDE.md` mises à jour (008) | `npm test` passe sans serveur de base ; `npm start` fonctionne avec un PostgreSQL local |
| 1.2 | **Déploiement sur le Pi** : `deploy.sh` réel, Docker Compose (Cockpit, PostgreSQL dans un volume, `cloudflared`), sauvegarde quotidienne de la base | La page s'affiche à l'adresse publique du Pi après un lancement du CD |
| 1.3 | **Connexion GitHub** : connexion via la GitHub App, liste des comptes autorisés en configuration (remplacée en 1.6 par l'inscription ouverte, [012](decisions/012-configuration-automatique.md)), déconnexion | Je me connecte avec GitHub et je vois mon nom |
| 1.4 | **Historique inaltérable** : table du journal protégée par la base, fonction « action métier » (vérifie le droit → applique → journalise, dans une seule transaction), connexion et déconnexion journalisées, page Journal simple | Ma connexion apparaît dans le journal ; un test prouve qu'une entrée ne peut être ni modifiée ni supprimée |
| 1.5 | **Assistant de démarrage** ([012](decisions/012-configuration-automatique.md)) : code de démarrage, création de la GitHub App par le flux du manifeste avec toutes les permissions du MVP, secrets chiffrés en base et clé dans son volume, adresse publique détectée puis confirmée (sans confirmation depuis la [028](decisions/028-creme-sombre-onglets-journal.md) J), premier compte administrateur ; suppression des variables GitHub et de `PUBLIC_URL` ; `deploy.sh` génère le mot de passe de la base ; README réécrit | Sur une installation neuve, j'entre le code, je clique « Créer l'App GitHub » puis « Create GitHub App » sur GitHub, et je me connecte en administrateur, sans rien écrire dans le fichier d'environnement que le jeton du tunnel |
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
| 4.7 | **Connecter Claude en un minimum de clics** ([021](decisions/021-connecter-claude.md)) : Cockpit devient un connecteur claude.ai (métadonnées OAuth, client reconnu par son document CIMD, page `/autoriser`, `/oauth/token` avec rotation), section « Connecter Claude » en trois étapes dans « Réglages », ligne MCP du bilan de santé qui accepte l'absence de Cockpit dans le `.mcp.json` | J'ajoute l'adresse de Cockpit comme connecteur sur claude.ai, je clique « Autoriser », et Claude liste mes projets, sans jeton à copier |
| 4.8 | **Programmer l'écriture des US** (routine) : depuis Cockpit, créer une routine Claude qui écrit les US des tickets en attente, avec les connecteurs du compte (brief §6.14) | Je programme la routine depuis Cockpit ; à l'heure dite, les US des tickets « Nouveau » apparaissent « à valider » |

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
| 6.2 | **Catalogue + « Préparer pour Claude en un clic »** : skills `/dev-us` et `/write-us`, agents test-writer, developer, reviewer, `CLAUDE.md` de départ s'il n'y en a pas (ni `.mcp.json` ni CI, [027](decisions/027-preparer-pour-claude.md)) ; un seul commit montré fichier par fichier | Sur un repo rouge, un clic → je vois les fichiers → je valide → le bilan passe au vert |

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
| 8.1 | **« Qu'est-ce qui m'attend ? »** : À toi de jouer, Claude travaille, Projets ; pastille par projet dans la section « Projets » (Cockpit n'a pas de barre latérale, [040](decisions/040-accueil.md) D) | L'accueil liste exactement ce qui attend mon action, chaque élément mène où agir |

**→ Fin du MVP : la boucle complète idée → US → validation → développement → PR → merge fonctionne en local.**

---

## Après le MVP : la feuille de route

L'ordre ci-dessous a été décidé le 2026-11-06, avec Dorian. Chaque phase est une suite de tranches, une tranche = une PR, comme plus haut.

### Pourquoi cet ordre

- **La reprise d'abord** : c'est la fonctionnalité qui distingue Cockpit et qui justifie l'offre Pro, et elle ne demande rien d'autre que ce qui existe.
- **Le confort ensuite** : c'est ce que Dorian sent chaque jour, de petites tranches à faible risque.
- **La configuration de Claude avant le payant**, pour que le produit vendu soit complet.
- **Le payant avant le cloud et les automatisations**, qui coûtent plus cher en complexité : les premiers clients peuvent attendre.
- **Le téléphone en dernier** : ce n'est pas une priorité.

L'ordre des phases 11 à 14 peut changer : rien ne dépend d'elles, la seule dépendance dure est C1 (mise à jour du catalogue) avant R4, qui change `/dev-us`.

**Mise à jour du 2026-11-08** ([064](decisions/064-tranches-restantes.md)) : la suite se fait dans l'ordre **12 → 9.5 et 14.7 → 15 → 13**. La phase 13 dépend de choix hors du code (statut, hébergeur, marque), elle passe en dernier.

## Phase 9 — Remise au propre

| # | Tranche | Démo |
|---|---|---|
| 9.1 | **Ménage de la doc** : `decoupage.md` et `architecture.md` disent la vérité, la décision en double devient la [042](decisions/042-nouvelle-equipe-fenetre.md), les statuts des décisions sont justes | Les docs décrivent le code d'aujourd'hui, et chaque décision implémentée est « validée » (007 et 041 restent à valider) |
| 9.2 | **Changelog complet** : les tranches 1.5 à 4.8, commitées avant la règle `feat:`, apparaissent dans la prochaine release | La PR de release liste toutes les tranches |
| 9.3 | **L'interface « Quatre temps »** ([045](decisions/045-interface-quatre-temps.md)) : jetons et polices, la coque (barre latérale, panneau de droite, barre d'idée), et les écrans qui existent déjà refaits comme dans [`docs/ecrans/`](ecrans/README.md) (alignés ensuite sur leurs maquettes, logo mis à part ; ce qui reste est dans la 045, « Ce que la tranche 9.3 a laissé de côté ») | L'accueil, un projet, une US et un run ressemblent à leurs écrans (S00a, S00b, S22, S29), avec les mêmes fonctions qu'avant |
| 9.5 | **Finitions** ([064](decisions/064-tranches-restantes.md)) : les barres d'étapes d'un run et la carte « Pourquoi Claude demande » (S29) ; la carte du Kanban ouverte dans le panneau de droite | Sur un run, je vois où en est chaque étape ; je clique une carte du Kanban, elle s'ouvre à droite sans quitter le tableau |
| 9.4 | **Le logo « la boucle »** ([046](decisions/046-logo-la-boucle.md)) : quatre arcs aux couleurs des quatre temps, vortex au survol, favicon | Le logo de la barre du haut et l'onglet du navigateur montrent la boucle, qui tourne au survol |

## Phase 10 — Reprendre une app existante (la fonctionnalité phare)

Sur un repo construit sans Cockpit (par exemple la v1), Claude dépose par le MCP la carte du modèle (un diagramme par sous-projet), les règles métier et des constats (bugs, failles, architecture, stack, versions), chacun en citant le code, vérifié sur GitHub ; je valide chaque règle en regard du code lu, un test la fige, et chaque constat retenu devient un ticket. C'est l'argument de l'offre Pro. Voir [`decisions/007-reprise-app-existante.md`](decisions/007-reprise-app-existante.md).

| # | Tranche | Démo |
|---|---|---|
| R1 | **Carte** : vérification des citations, `submit_code_map`, écran « Conception », vue « Modèle », skill `/analyser` | Sur un repo web + API, je vois deux diagrammes ; un clic sur un objet montre son code |
| R2 | **Règles** : `create_takeover_stories`, écran de reprise | Je vois le code à gauche et la règle à droite, je la valide |
| R3 | **Graphe par fonctionnalité** : acteurs, fonctionnalités, règles, objets ; export Markdown | Je clique une règle dans le graphe et j'arrive sur l'écran de reprise |
| C1 | **Mise à jour du catalogue** : quand Cockpit améliore `/dev-us` ou un agent, un repo déjà préparé reçoit un bouton « Mettre à jour » (diff, puis un seul commit), seulement si sa copie n'a pas été modifiée à la main. **À faire avant R4**, qui change `/dev-us` | Je change le catalogue, un repo préparé affiche « Mettre à jour », je vois le diff et je valide ; une copie modifiée à la main n'est pas touchée |
| R4 | **Figer l'existant** : mode de `/dev-us` | La règle validée a son test, qui passe |
| R5 | **Constats de Claude** : bugs, failles, architecture, stack ; page Constats et tri | Une faille trouvée devient un ticket en un clic |
| R6 | **Constats de GitHub et versions** : alertes Dependabot, code scanning, secret scanning ; fin de vie des runtimes | Node 20 en fin de vie est signalé sur la carte |

## Phase 11 — Le confort de tous les jours

| # | Tranche | Démo |
|---|---|---|
| 11.1 | **Journal filtrable et historique par projet** : filtrer par projet, outil, origine, auteur, résultat et période ; un onglet « Historique » dans chaque projet (brief §6.12, repoussé par 010 et 028) | Je filtre le Journal sur « Claude, refus, cette semaine » ; l'onglet d'un projet n'affiche que ses entrées |
| 11.2 | **Tickets complets** : capture rapide depuis n'importe quel écran, priorité et tags, recherche plein texte sur les tickets et les US (brief §6.2) | Depuis n'importe quelle page, je note une idée en deux clics ; je retrouve un ticket par un mot de sa description |
| 11.3 | **Importer les issues GitHub** : une issue déjà écrite comme une US devient un ticket avec son US validée, les autres des tickets « Nouveau » ; rien n'est écrit sur GitHub, et on peut relancer sans doublon | J'importe les issues d'un repo, je les retrouve en tickets ; je relance, rien n'est dupliqué |
| 11.4 | **Pièces jointes** : images, PDF et texte sur un ticket, que Claude lit quand il écrit les US | J'ajoute une capture à un ticket, Claude en tient compte dans les US |
| 11.5 | **Après le merge** : supprimer la branche d'une US mergée (sur clic, après vérification) ; changelog par projet (brief §6.8) | Je merge, je clique « Supprimer la branche » ; le projet affiche son changelog |
| 11.6 | **E5, équipes de départ** ([063](decisions/063-equipes-de-depart.md)) : quatre niveaux Éco, Standard, Premium et Max, choisis à l'import, écrits par « Préparer pour Claude » ou repris dans l'onglet Agents | J'importe un projet en Premium, je le prépare : les agents et `team.md` du niveau sont dans le plan ; plus tard, « Repartir d'une équipe de départ » change l'équipe en un commit |

## Phase 12 — Configurer Claude depuis Cockpit (brief §6.9 et §6.10)

| # | Tranche | Démo |
|---|---|---|
| 12.1 | **Éditer la configuration du repo** : `CLAUDE.md`, règles (`.claude/rules/`), skills et `.mcp.json`, chaque fois avec un diff puis un commit, comme l'éditeur d'agent (030) ; dans l'onglet Agents, devenu « Ce que Claude lit » ([064](decisions/064-tranches-restantes.md)) | Je modifie le `CLAUDE.md` d'un projet depuis Cockpit, je vois le diff, je valide |
| 12.2 | **Catalogue enrichi** : **couvert par la 11.6** ([063](decisions/063-equipes-de-depart.md) C) : `doc-writer` et `doc-reviewer` sont au catalogue, `security-reviewer` y était ; pas d'`analyst` ([064](decisions/064-tranches-restantes.md)) | Dans l'éditeur d'agent, j'ajoute un `doc-writer` du catalogue |
| 12.3 | **Configuration globale** : les agents et skills communs à tous les projets, dans un repo de plugins personnel, déclaré dans `.claude/settings.json` de chaque projet ([064](decisions/064-tranches-restantes.md)) | Un agent défini une fois est disponible dans tous mes projets |
| 12.4 | **CI/CD** : lister les workflows ; proposer une CI de départ adaptée au repo ; Claude propose un changement de workflow et l'humain le committe (permission `workflows` à ajouter à la GitHub App) ; outil MCP `propose_workflow_change` ([064](decisions/064-tranches-restantes.md)) | Sur un repo sans CI, je vois la CI proposée, je valide, la ligne CI du bilan passe au vert |
| 12.5 | **Repo modèle** : créer un projet à partir d'un repo modèle déjà prêt pour Claude (brief §6.1), gérer ce repo modèle ([064](decisions/064-tranches-restantes.md)) | Je crée un projet depuis le modèle, le bilan est vert d'emblée |

## Phase 13 — Le service payant (au passage chez l'hébergeur)

| # | Tranche | Démo |
|---|---|---|
| 13.1 | **Plusieurs utilisateurs** : invitations, partager un projet, l'administrateur voit l'activité des comptes (008, brief §6.19) ; trois rôles, invitation par login GitHub ([064](decisions/064-tranches-restantes.md)) | J'invite quelqu'un, il voit le projet partagé et rien d'autre |
| 13.2 | **Offres et quotas** : gratuit (3 repos) et Pro (la reprise), bloqués côté serveur dans l'API et le MCP ; paiement. Idées d'offres et de prix : [`offres.md`](offres.md) ; Pro à 10 € par mois, repos illimités, codes Pro donnés par l'administrateur, paiement branché plus tard ([064](decisions/064-tranches-restantes.md)) | Un compte gratuit se voit refuser le 4e repo, par l'API comme par le MCP |
| 13.3 | **Hébergeur** : choisir l'hébergeur (en Europe, PostgreSQL géré), y déplacer l'image et la base, faire tenir le serveur sur plusieurs instances (008). **Attend Dorian** : l'hébergeur est choisi au premier client payant ([064](decisions/064-tranches-restantes.md)) | Cockpit répond à son adresse chez l'hébergeur, avec ses données |
| 13.4 | **Dirigo** : renommer l'app, la passer sur `app.dirigo.dev`, et un site vitrine dans un repo à part ([041](decisions/041-nom-et-site-vitrine.md)). **Attend Dorian** : marque vérifiée et domaine acheté ([064](decisions/064-tranches-restantes.md)) | `dirigo.dev` affiche la vitrine, `app.dirigo.dev` l'application |
| 13.5 | **RGPD** : une page qui dit ce que Cockpit garde, l'export et la suppression de son compte (une empreinte garde le compteur Gratuit, [064](decisions/064-tranches-restantes.md)) | Je supprime mon compte, mes données disparaissent |

## Phase 14 — Cloud et automatisations (brief §6.5, §6.14 à §6.16)

| # | Tranche | Démo |
|---|---|---|
| 14.1 | **Lancer dans le cloud** : « Développer avec Claude » propose aussi une session cloud, pas seulement Claude Desktop | Je choisis « Cloud », la session démarre sans PC allumé |
| 14.2 | **Routines** : d'autres routines que l'écriture des US (consigne libre, agents, planning) | Je programme une routine de mon choix, elle se lance à l'heure dite |
| 14.3 | **File d'attente** : je mets des US prêtes en file, Cockpit les lance une par une | Trois US en file, la suivante démarre quand la précédente est finie |
| 14.4 | **Relance automatique** : CI rouge, Claude relancé sur la même branche. À comparer d'abord avec l'Auto-fix natif de Claude Code | Une CI rouge relance le développement sans que je clique |
| 14.5 | **Coût et budget** : le coût de chaque run (télémétrie OpenTelemetry) et un plafond qui demande l'arrêt du run | La page d'un run affiche son coût ; au plafond, l'arrêt est demandé |
| 14.6 | **La nuit de Claude** ([044](decisions/044-la-nuit-de-claude.md)) : le soir, je compose le programme ; Claude développe les US une par une dans le cloud ; le matin, l'accueil raconte la nuit | Je lance la nuit avec deux US, PC éteint ; le matin, l'accueil montre la frise, une PR et la question de l'autre US |
| 14.7 | **Le matin de la nuit** ([070](decisions/070-le-matin-de-la-nuit.md), 044 N') : le bilan (temps de travail, critères prouvés, échecs), « Relire en série », la frise à l'échelle des heures (N2) | Le matin, l'accueil montre le bilan de la nuit ; « Relire en série » m'enchaîne les PR à relire |

## Phase 15 — Téléphone et ergonomie (pas prioritaire)

| # | Tranche | Démo |
|---|---|---|
| 15.1 | **Les trois gestes au téléphone** : noter une idée, valider une US et répondre à Claude, vérifiés et corrigés en largeur téléphone ; « Photo » dans Noter une idée ([071](decisions/071-trois-gestes-au-telephone.md), [064](decisions/064-tranches-restantes.md)) | Sur mon téléphone, je fais les trois gestes sans zoom ni défilement latéral |
| 15.2 | **PWA et notifications** : icône sur l'écran d'accueil ; notifications pour une question de Claude, un run en échec ou une PR à relire (brief §6.17), le récap de la nuit, le silence la nuit, l'écran « Cockpit ne répond plus » (S56) ([072](decisions/072-pwa-et-notifications.md), [064](decisions/064-tranches-restantes.md)) | Claude pose une question, mon téléphone vibre |
| 15.3 | **Ergonomie** : raccourcis clavier, recherche globale, thème clair (brief §6.20), favoris ([073](decisions/073-ergonomie.md), [064](decisions/064-tranches-restantes.md)) | `Ctrl+K` ouvre la recherche globale ; je bascule en thème clair |
| 15.4 | **Page « Mise en route »** : un guide pas à pas dont chaque étape se coche toute seule (brief §6.18), les sept étapes de S06, en haut de l'accueil ([064](decisions/064-tranches-restantes.md)) | Un nouvel utilisateur suit la page, chaque étape se coche quand elle est faite |

## Équipe d'agents (E1 à E4 faites, E6 à faire)

Demande du 2026-11-03 : `/dev-us` reste le défaut, mais l'utilisateur ajoute, modifie ou retire des agents dans ce schéma, et définit d'autres structures par projet. Voir [`decisions/029-equipe-d-agents.md`](decisions/029-equipe-d-agents.md) :

| # | Tranche | Démo |
|---|---|---|
| E1 | **`/dev-us` lit `.claude/team.md`** (trois étapes par défaut sans fichier), règle `agents` du bilan adaptée | Un `team.md` sans `reviewer` : le bilan reste vert, `/dev-us` saute l'étape |
| E2 | **Éditeur d'agent** ([030](decisions/030-editeur-d-agent.md)) : description, outils, modèle, prompt, aperçu ; ajouter, supprimer ; un commit, diff avant | Je change le modèle du `developer` et j'ajoute un `doc-writer` |
| E3 | **Écran « Équipe »** en graphe ([031](decisions/031-equipe-en-graphe.md)) : cartes déplaçables, liens « puis » et « boucle », liste pour le clavier, un commit | J'ajoute `doc-writer` après `developer` et j'enregistre |
| E4 | **Plusieurs équipes par projet** ([032](decisions/032-plusieurs-equipes.md)) : `.claude/teams/<nom>.md`, `--team` | `/dev-us 42 --team leger` suit l'équipe « leger » |
| E6 | **Nouvelle équipe en canevas** ([045](decisions/045-interface-quatre-temps.md) G, écrans S38 à S38c) : plein écran, glisser des agents, tracer des liens, boucles avec limite, intercaler un agent sur un lien. Les branches en parallèle, un worktree par branche, et la condition écrite en une phrase ([064](decisions/064-tranches-restantes.md)) | Je crée une équipe en traçant ses liens sur le canevas, puis un commit |

Suite : « Nouvelle équipe » s'ouvre dans une fenêtre ([042](decisions/042-nouvelle-equipe-fenetre.md)). Les équipes de départ (E5) sont faites, voir la tranche 11.6. La [074](decisions/074-equipes-a-la-demande.md) construit « une équipe globale à tous les projets » que la 029 et la 032 repoussaient.

## Après la V1

- **Ouvrir le MCP aux autres IA** (demande du 2026-11-05, **après la V1**) : ChatGPT et les autres assistants qui parlent MCP se branchent sur Cockpit, pas seulement Claude. Les outils MCP (004) n'ont rien de propre à Claude ; ce qui l'est, c'est la connexion et le reste :
  - **OAuth** : seuls les deux clients de Claude (claude.ai et Claude Code) sont acceptés, et seulement par CIMD (006 C, 021 B). Il faudra accepter d'autres clients, et sans doute l'enregistrement dynamique (DCR), que la 006 écarte : ChatGPT semble encore s'en servir. **Cette tranche rouvre donc la 006 C.**
  - **Les jetons MCP (015)** marchent déjà avec tout client capable d'envoyer un en-tête `Authorization` : à vérifier avant de développer quoi que ce soit.
  - **Restent propres à Claude** : les skills `/write-us` et `/dev-us`, les agents de `.claude/agents/`, le lancement par `claude://` (005) et les routines (022). Une autre IA pourra lire et écrire tickets et US par le MCP, mais pas développer avec `/dev-us`.

Deux sujets déjà tranchés ne sont pas des tranches de plus : la connexion OAuth de Claude (cloud et téléphone sans jeton à copier) est faite en 4.7 ([006](decisions/006-connexion-oauth.md), [021](decisions/021-connecter-claude.md)), et « brancher un PC en une commande » est couvert par elle.

## Points ouverts

Ce qui reste ouvert dans les décisions, à trancher dans la tranche concernée :

| Sujet | Où |
|---|---|
| Permissions de l'App ajoutées après le MVP (12.4, R6). Tranché par la 052 en R6 : Cockpit guide (ligne « Alertes GitHub » du bilan et ligne grise de l'écran des constats), la modification de l'App et l'approbation restent manuelles | [012](decisions/012-configuration-automatique.md), [052](decisions/052-constats-de-github-et-versions.md) |
| Plusieurs instances : quatre choses en mémoire à passer en base (phase 13.3) | [008](decisions/008-service-en-ligne.md), [architecture](architecture.md) « Montée en charge » |
| Hébergeur (13.3) et prestataire de paiement (13.2) : décidés plus tard. Facturation **par personne**, un projet partagé compte chez son propriétaire, tranché par la [064](decisions/064-tranches-restantes.md) (13.2 D) | [008](decisions/008-service-en-ligne.md) points ouverts 1 et 2, [offres](offres.md) |
| Disponibilité de `dirigo.dev` et de la marque « Dirigo » (classes 9 et 42), avant l'achat du domaine (13.4) | [041](decisions/041-nom-et-site-vitrine.md) |
| Reprise : doublons entre analyses de Claude (R5, reste ouvert ; ceux des alertes GitHub sont évités par le numéro d'alerte, 052 E). Tranché par la 051 en R5 : modèle de chaque agent d'analyse (modifiable dans l'onglet Agents). Tranchés par la 047 en R2 : granularité des règles (5 au plus par US), coloration du code (Shiki), `object_names` absent de la carte (accepté, en gris). Tranché par la 050 en R4 : contrôle du mode « figer » (le reviewer et Cockpit, sur les fichiers de la PR) | [007](decisions/007-reprise-app-existante.md), points ouverts 2 (tranché), 4 (tranché) et 5 ; [047](decisions/047-ecran-de-reprise.md), [050](decisions/050-figer-l-existant.md), [051](decisions/051-constats-de-claude.md) |
| Reprise dans l'offre Pro, bloquée côté serveur dans l'API et le MCP (13.2) | [007](decisions/007-reprise-app-existante.md) point ouvert 7, [offres](offres.md) |
| Version téléphone (phase 15) | [003](decisions/003-interface.md), point ouvert 4 (les trois gestes : faits par la [071](decisions/071-trois-gestes-au-telephone.md)), limites de la 071 |

- ~~**Relancer une US en revue**~~ : tranché par la [037](decisions/037-arreter-relancer-fermer.md) E, `start_run` accepte une US `in_review`.
- ~~**Repo déjà suivi par un autre compte**~~ : confirmé en 2.1 par la [011](decisions/011-import-projets.md) C, le refus neutre est gardé ([008](decisions/008-service-en-ligne.md), point ouvert 3).
- ~~**Une routine déclenchée par API reçoit-elle les connecteurs claude.ai ?**~~ : oui, la [022](decisions/022-routine-ecriture-us.md) s'en sert en 4.8 ([006](decisions/006-connexion-oauth.md), point ouvert 1).
