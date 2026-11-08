# Cockpit v2

Service en ligne de pilotage des repos GitHub développés avec Claude Code. Le produit est décrit dans [`cockpit-v2-brief.md`](cockpit-v2-brief.md), l'ordre de construction dans [`docs/decoupage.md`](docs/decoupage.md), les choix dans [`docs/decisions/`](docs/decisions/) et leur résumé dans [`docs/architecture.md`](docs/architecture.md).

## Créer la GitHub App

Rien à faire à la main : Cockpit crée lui-même sa GitHub App au premier lancement, avec ton accord ([décision 012](docs/decisions/012-configuration-automatique.md)). L'assistant « Installer Cockpit » s'ouvre tout seul à l'adresse de Cockpit tant que l'App n'existe pas :

1. Entrer le **code de démarrage** que le serveur affiche dans ses logs (`Cockpit setup code: …`).
2. Rien à saisir pour l'adresse : Cockpit utilise celle avec laquelle tu l'ouvres (derrière un tunnel Cloudflare, l'en-tête `CF-Visitor` donne le bon protocole) ; c'est celle que GitHub utilisera pour renvoyer vers Cockpit. Elle doit commencer par `https://` (claude.ai l'exige) ; seul `http://localhost` (ou `127.0.0.1`, `[::1]`) est accepté pour développer sur sa machine.
3. Cliquer sur « Créer l'App GitHub » : GitHub affiche l'App et ses permissions (lecture des repos, de la CI et des alertes Dependabot, de code scanning et de secret scanning ; écriture du contenu, des issues et des PR).
4. Cliquer sur « Create GitHub App » sur GitHub. Cockpit récupère l'App, chiffre ses secrets en base et te renvoie vers la connexion GitHub : **le premier compte qui se connecte devient administrateur**.

Pour que Cockpit voie des repos, il faut ensuite **installer l'App sur le compte** en choisissant les repos : `https://github.com/apps/<slug>/installations/new`, ou le lien « Installer l'App sur mes repos » de la page Projets. Seuls les repos cochés peuvent être importés. L'App est publique (« Any account ») et l'inscription est ouverte : tout compte GitHub qui se connecte à Cockpit obtient un compte non administrateur, sans que l'administrateur ait rien à accepter.

### Donner « Pull requests » en écriture à une App déjà créée

Une App créée avant la [décision 026](docs/decisions/026-ecrire-dans-un-repo.md) n'a que la lecture des PR, et Cockpit ne peut alors pas ouvrir de PR quand la branche par défaut d'un repo est protégée. Sur GitHub : réglages de l'App → Permissions → Pull requests : **Read and write**, puis, en tant que propriétaire de l'installation, accepter la nouvelle permission sur l'installation (GitHub envoie un message à ce sujet).

### Lire les alertes GitHub avec une App déjà créée

Une App créée avant la [décision 052](docs/decisions/052-constats-de-github-et-versions.md) ne demande pas les alertes : Cockpit ne peut pas les lire et la ligne **« Alertes GitHub »** du bilan de santé (et une ligne grise sur l'écran des constats, après « Actualiser ») le dit, avec le lien. Cockpit ne peut pas modifier l'App : sur GitHub, réglages de l'App → « Permissions & events » → lecture de **Dependabot alerts**, **Code scanning alerts** et **Secret scanning alerts**, puis « Subscribe to events » : **Dependabot alert**, **Code scanning alert** et **Secret scanning alert**. Ensuite, chaque compte qui a installé l'App doit **approuver** les nouvelles permissions sur son installation (GitHub envoie un message ; le lien « Approuver sur GitHub » de la ligne y mène). Tant que ce n'est pas fait, la ligne dit quoi cocher sur l'App (« L'App ne demande pas les permissions des alertes… ») ou, une fois l'App modifiée, « GitHub attend ton accord pour les nouvelles permissions de l'App », et aucune alerte n'est lue. Une App créée après cette version n'a rien à faire.

### Réglages

La page « Réglages » (en bas de la barre latérale) a un menu à gauche : « Connecter Claude » (avec les jetons MCP ; l'ancienne adresse `/reglages/jetons` renvoie à `/reglages`), « Tâches cloud » (l'écriture automatique des US et le lanceur cloud, voir plus bas) et « Instance » (pour l'administrateur seulement : les utilisateurs). L'adresse publique est celle de l'installation : elle n'a plus d'écran, changer de domaine demande de reprendre l'installation. Décision [028](docs/decisions/028-creme-sombre-onglets-journal.md).

### La page d'un projet

La page d'un projet a sept onglets : « Kanban » (`/projets/:id`, six colonnes dont « Idées », les tickets qui attendent leurs US), « Tickets », « Conception » (voir plus bas), « Santé » (le bilan, « Revérifier », « Préparer pour Claude »), « Agents », « Historique » (voir « Le Journal ») et « Réglages » (l'écriture automatique des US, l'ancien onglet « Écriture des US » ; « Sur ce PC · Dossier du clone », le même que celui de « Développer avec Claude », retenu par le navigateur ; « Archiver le projet »). L'onglet Santé dit « Santé · N à corriger » quand le bilan a des lignes rouges. Décisions [028](docs/decisions/028-creme-sombre-onglets-journal.md) et [045](docs/decisions/045-interface-quatre-temps.md).

L'onglet « Agents » (`/projets/:id/agents`) modifie les agents de `.claude/agents/` du repo et ses équipes (`.claude/team.md` et `.claude/teams/<nom>.md`, au choix « Graphe » ou « Liste » ; l'éditeur d'un agent s'ouvre à côté de son fichier) : chaque changement montre son diff, puis fait un seul commit. Une section « Agents d'analyse » liste ceux de `/analyser` (`cartographer`, `rules-analyst`, `bug-hunter`, `security-reviewer`, `architect`, `upgrade-advisor`) : tu peux changer le modèle de chacun pour ce projet (plus petit sur l'abonnement Pro, `opus` partout sur Max) sans perdre les mises à jour du catalogue, car la ligne `model:` n'est pas comparée et « Mettre à jour » garde celle du repo. Décisions [030](docs/decisions/030-editeur-d-agent.md), [031](docs/decisions/031-equipe-en-graphe.md), [032](docs/decisions/032-plusieurs-equipes.md) et [042](docs/decisions/042-nouvelle-equipe-fenetre.md).

### Noter une idée et les tickets

La barre « Noter une idée » (en bas de chaque page, `N` pour y aller) est la seule façon de créer un ticket. On tape le titre, puis **Entrée** l'agrandit en un panneau : titre, description (Markdown), projet, priorité (basse, normale, haute) et étiquettes (« + étiquette », Entrée l'ajoute ; 10 au plus, en minuscules ; les étiquettes déjà utilisées dans le projet sont proposées). **« Noter »** (`Ctrl Entrée`) crée le ticket ; « Annuler » ou Échap referme le panneau et garde ce que tu as écrit, Entrée le rouvre. Seuls le titre et le projet sont obligatoires.

L'onglet « Tickets » liste les tickets du projet, ceux de priorité haute d'abord : étape, détail de leurs US (« 4 US · 1 à valider, 2 prêtes »), étiquettes et âge. Les puces « Ouverts » (par défaut ; un second clic montre tous les tickets) et « Nouveaux », le menu « Étiquette » et la case de recherche (dans les tickets et dans les US, sans tenir compte de la casse ; les US trouvées ouvrent leur page) filtrent la liste. Si l'écriture automatique des US est connectée, « Écrire les US maintenant » est là aussi. Un clic sur une ligne ouvre le ticket à droite (« Ouvrir le ticket », « Modifier », « Supprimer »). Décision [055](docs/decisions/055-tickets-complets.md).

### Le Journal

Le Journal est groupé par jour et affiche les 25 dernières entrées, puis « Afficher plus » ajoute les 25 suivantes. Décision [028](docs/decisions/028-creme-sombre-onglets-journal.md).

Il se filtre : une case « Chercher… » (un numéro de ticket, d'US, de run ou de PR, avec ou sans `#`, ou un bout de nom d'action ou de code de refus ; pas de texte libre, le journal n'en garde pas) et des puces Auteur, Résultat, Projet, Outil, Origine et période (Aujourd'hui, Cette semaine depuis lundi, Ce mois-ci, Tout). Les filtres sont dans l'adresse (`/journal?auteur=claude&resultat=refuse&periode=semaine`) : une vue filtrée se recharge et se partage. Un clic sur une ligne ouvre l'entrée à droite (quand, acteur, origine, projet, résultat, arguments ; ↑ et ↓ pour passer à la suivante) ; pour un refus ou une erreur, le panneau dit si l'acteur a réessayé dans l'heure et ouvre ce réessai. « Exporter » télécharge un CSV des entrées filtrées (les 10 000 plus récentes).

L'onglet « Historique » d'un projet (`/projets/:id/historique`) est ce même journal limité au projet, en phrases (« Claude a fini l'étape reviewer »), avec les puces Tout, Toi, Claude, GitHub, Refus et erreurs, une période et un lien « Exporter ». Décision [053](docs/decisions/053-journal-filtrable.md).

### Webhooks GitHub

Cockpit reçoit les webhooks de l'App sur `POST /api/webhooks/github` : la signature (`X-Hub-Signature-256`, secret de l'App) est vérifiée sur le corps brut, la livraison est enregistrée (`webhook_deliveries`, gardée 30 jours) avec une entrée « Webhook reçu » du Journal, puis Cockpit répond 202. Cockpit les traite ensuite, juste après sa réponse puis chaque minute (cinq essais au plus par livraison) ; Cockpit traite la modification d'une issue (voir plus bas) et le suivi de la PR d'une US (`pull_request`, `pull_request_review`, `check_suite` : voir « Développer une US avec Claude »). Le bilan de santé d'un projet a une ligne « Webhook de Cockpit » (la cinquième) : verte quand l'adresse du webhook de l'App est `<adresse publique>/api/webhooks/github` et que sa dernière livraison a réussi (ou qu'il n'y en a pas encore), lue sur GitHub avec l'identité de l'App et gardée une minute. Cockpit traite aussi les événements `dependabot_alert`, `code_scanning_alert` et `secret_scanning_alert` (voir « Les constats de GitHub » ; la valeur d'un secret est retirée de la livraison avant qu'elle soit enregistrée). Le bilan a deux lignes de plus, « Alertes GitHub » (les permissions de l'App, relues à chaque affichage) et « Mises à jour automatiques » (voir plus bas). Décision [024](docs/decisions/024-webhooks.md).

### Une issue modifiée sur GitHub

L'issue d'une user story est un rendu de Cockpit : on modifie l'US dans Cockpit, pas sur GitHub. Si quelqu'un modifie quand même le titre ou le corps de l'issue sur GitHub (pas l'App elle-même), Cockpit garde sa version, **n'écrit plus sur cette issue** et le dit : la carte du Kanban porte « Issue modifiée sur GitHub » et la page de l'US (`/us/:id`) montre la date, le titre s'il a changé et le diff ligne à ligne du corps. Deux choix : « Garder la version Cockpit » efface l'écart et réécrit l'issue avec le rendu de Cockpit (quel que soit le statut de l'US) ; « Garder la version GitHub » relit le récit, les notes et les critères de l'issue et les applique comme « Modifier » (US à valider, à réécrire ou prête), puis réécrit l'issue. Si le corps ne suit plus le gabarit de Cockpit, la reprise est refusée : garde la version de Cockpit ou recopie les changements avec « Modifier ». Le Journal garde « Issue modifiée sur GitHub », « Version de Cockpit gardée » et « Version de GitHub reprise », jamais le texte. Décision [025](docs/decisions/025-issue-modifiee-sur-github.md).

### La carte du code (Conception)

L'onglet « Conception » (`/projets/:id/conception`) montre ce que Claude a compris du code : un onglet par sous-projet (nom, type, runtimes), avec ses objets (tables, types, classes), leurs champs et leurs liens, en graphe ou en liste (la liste seule sur un téléphone). Un clic sur un objet ouvre un panneau : tous ses champs, le fichier et les lignes cités, le code lu sur GitHub à cet instant et « Voir sur GitHub ». En tête : le commit analysé et le nombre de commits depuis. Sans carte, **« Analyser avec Claude »** ouvre une fenêtre : le dossier du clone (retenu par le navigateur), puis « Ouvrir Claude » lance Claude Desktop sur le clone avec `/analyser` prérempli (ou « Copier le prompt »). Claude lit le repo et dépose la carte par l'outil MCP `submit_code_map` ; Cockpit vérifie chaque ligne citée sur GitHub et refuse l'appel, en disant où, si l'une n'existe pas. « Relancer l'analyse » refait la même chose. Tant que l'App GitHub n'est pas configurée, la carte ne se charge pas. Un repo préparé avant cette version n'a pas `/analyser` : la fenêtre propose **« Ajouter /analyser au repo »** (le diff, puis un commit). Décision [043](docs/decisions/043-carte-du-code.md).

#### Les règles et l'écran de reprise

Trois puces en haut de l'onglet : « Modèle » (la carte), **« Règles · N »** (`/projets/:id/conception/regles`) et « Fonctionnalités » (voir plus bas). La fenêtre « Analyser avec Claude » a deux cases, **Carte** et **Règles** ; pour les règles, un champ « Fonctionnalités à reprendre » (obligatoire, par exemple « Connexion, Facturation ») : « Ouvrir Claude » préremplit `/analyser regles Connexion, Facturation`. Claude lit le code, écrit 5 règles au plus par US et les dépose par l'outil MCP `create_takeover_stories` : un ticket « Reprise : <fonctionnalité> » et ses US, dont chaque règle cite ses lignes de code, vérifiées sur GitHub.

L'écran de reprise montre le code (coloré selon le langage, les lignes citées en relief, un onglet par fichier cité) au centre et la règle à droite : sa phrase, le raisonnement de Claude, ce qu'il n'a pas pu trancher, l'Étant donné / Quand / Alors et les objets touchés (un objet absent de la carte est gris, avec « Relancer l'analyse »). Quatre choix, au bouton ou au clavier : **« Valider la règle »** (`V`, avec « Annuler » pendant 8 secondes), **« Corriger le texte »** (`M`), **« C'est un bug »** (`B`, tout de suite : un ticket « Bug : … » est créé et la règle quitte l'US) et **« Plus tard »** (`P`). `J` et `K` passent d'une règle à l'autre ; les raccourcis ne marchent pas avec Maj, Ctrl, Alt ou Cmd, ni pendant une saisie. Sur la page d'une US de reprise, chaque règle montre son état et un lien « Juger dans l'écran de reprise » ; l'US ne se valide pas tant qu'une règle reste à trancher (le bouton dit lesquelles). Le récit d'une US de reprise ne se modifie pas et elle ne se renvoie pas à Claude. Décision [047](docs/decisions/047-ecran-de-reprise.md).

#### Le graphe par fonctionnalité

La puce **« Fonctionnalités »** (`/projets/:id/conception/fonctionnalites`, `?f=` choisit la fonctionnalité, la première par défaut) dessine une fonctionnalité reprise (un ticket « Reprise : … » non abandonné) en quatre colonnes : Acteurs, Fonctionnalités, Règles, Objets. Un acteur utilise une fonctionnalité, qui respecte des règles, qui manipulent des objets, eux-mêmes liés entre eux comme dans la carte. La fonctionnalité choisie et ce qui la touche sont en clair, le reste de l'application en gris ; chaque règle dit en un mot si elle est « à trancher », « voulue » ou « figée » (son US est terminée et son test passe). Les clics : une fonctionnalité se choisit ; une règle ouvre l'écran de reprise si son US est à valider, sinon la page de l'US ; un objet de la carte ouvre la vue « Modèle » sur lui ; un objet non cartographié est gris, avec « Relancer l'analyse » ; un acteur n'a pas de page. La bascule « Graphe / Liste » donne les quatre catalogues au clavier et aux lecteurs d'écran, et seule la liste s'affiche sur un téléphone. Sans fonctionnalité, **« Analyser avec Claude »** ouvre la fenêtre avec « Règles » cochée. En haut de la page, à côté de « Ouvrir sur GitHub ↗ », **« Exporter en Markdown »** télécharge la fonctionnalité choisie (`conception-<nom>.md`) et **« Tout le projet »** toutes les fonctionnalités (`conception-<projet>.md`) : titre, acteurs, règles (phrase, état, Étant donné / Quand / Alors, un lien permanent GitHub par source) et objets touchés avec leurs champs. Le fichier est construit dans le navigateur. Décision [048](docs/decisions/048-graphe-par-fonctionnalite.md).

#### Les constats de Claude

La puce **« Constats · N »** (`/projets/:id/conception/constats`) liste ce que Claude a trouvé dans le code : bugs, failles, avis d'architecture et de stack, chacun avec le code qu'il cite, vérifié sur GitHub. Les filtres sont Tous, Bugs, Failles, Versions, Architecture et Stack, et « Rejetés » pour retrouver un constat écarté. Les constats à trancher sont triés par gravité, puis du plus récent au plus ancien : le plus grave est seul en tête, « À corriger d'abord », les autres dessous. Un clic ouvre un constat dans le panneau de droite (texte, gravité, effort, code cité avec un onglet par fichier) et tu le tranches : **« En faire un ticket »** (un ticket prérempli, avec les liens GitHub du code, que Claude écrit ensuite en US), **« Rejeter »** (raison facultative) ou **« Plus tard »**. Un constat transformé en ticket ou rejeté ne se tranche plus ; « Plus tard » se retranche. Sur un constat d'architecture ou de stack dont le code n'est couvert par aucune règle figée, une ligne le dit : reprends d'abord la fonctionnalité concernée. « C'est un bug » (écran des règles) ajoute aussi un constat à la liste. Claude ne trie jamais : il dépose par `submit_findings`.

La fenêtre « Analyser avec Claude » gagne les cases **Bugs**, **Sécurité**, **Architecture et stack** et **Versions** (052) (« Ouvrir Claude » préremplit `/analyser bugs securite architecture versions` selon les cases) ; sans aucune case cochée, la fenêtre demande d'en cocher une. Décision [051](docs/decisions/051-constats-de-claude.md).

#### Les constats de GitHub et les versions

**« Actualiser »** (en haut à droite des constats) lit les alertes **ouvertes** de Dependabot, de code scanning (branche par défaut) et de secret scanning, sans crédit Claude, puis chaque événement de l'App les met à jour. Une alerte est un constat (« dépendance · GitHub », « faille · GitHub », « secret · GitHub »), sans doublon ; Cockpit ne copie **jamais la valeur d'un secret**, il cite son premier emplacement. Une alerte relue ne change pas ton tri. Une alerte fermée sur GitHub n'est plus à trancher : elle apparaît dans « Rejetés », « fermée sur GitHub » ; rouverte, elle revient. Le panneau a « Voir l'alerte sur GitHub ↗ ». Au plus 1 000 alertes ouvertes par outil sont lues à « Actualiser » (les suivantes viennent par webhook). Si l'App n'a pas les permissions, ou si un outil n'est pas activé sur le repo, une ligne grise le dit.

La **fin de vie des runtimes** de la carte est lue sur [endoflife.date](https://endoflife.date) à l'affichage (5 secondes au plus, gardée 24 heures en mémoire, rien en base) : la carte écrit « node 18 · fin de vie en avr. 2025 », et un runtime en fin de vie ou qui le sera dans six mois est une ligne de « Tous » et « Versions » (une seule ligne pour un même runtime et la même version dans plusieurs sous-projets). Son panneau a **« Demander un plan à Claude »** : la fenêtre d'analyse avec la case **Versions**, que l'agent `upgrade-advisor` traite (il dépose des constats « mise à jour »). La ligne **« Mises à jour automatiques »** du bilan est verte avec `.github/dependabot.yml` ou une configuration Renovate ; sa correction **« Ajouter .github/dependabot.yml »** montre le fichier (une entrée hebdomadaire par écosystème trouvé) puis l'écrit comme « Préparer pour Claude ». Décision [052](docs/decisions/052-constats-de-github-et-versions.md).

### Préparer pour Claude

Quand la ligne « CLAUDE.md » ou « Agents et skill de développement » du bilan de santé est rouge, la page du projet propose **« Préparer pour Claude »**. Le bouton lit le repo (sans rien écrire) et montre, fichier par fichier, ce qui serait ajouté : les agents `test-writer`, `developer` et `reviewer`, les agents `cartographer`, `rules-analyst`, `bug-hunter`, `security-reviewer`, `architect` et `upgrade-advisor`, les skills `/dev-us`, `/write-us` et `/analyser` (le dossier `catalog/`, livré avec Cockpit) et un `CLAUDE.md` de départ, seulement s'il n'y a ni `CLAUDE.md` ni `.claude/CLAUDE.md`. Un fichier déjà là est laissé tel quel (avec le diff s'il est différent), sauf une ancienne copie d'origine d'un fichier du catalogue, qui est mise à jour. **« Faire le commit »** fait un seul commit sur la branche par défaut ; si elle est protégée, une pull request est ouverte, ce qui demande à l'App la permission « Pull requests » en écriture (réglages de l'App sur GitHub). Le bilan est relu ensuite, et le Journal garde « Préparer pour Claude ». Il n'y a ni `.mcp.json` ni workflow de CI : Claude passe par le connecteur, et la ligne CI reste à ta charge. Le `CLAUDE.md` de départ ne fait que passer la ligne au vert : il faut le remplir. Décision [027](docs/decisions/027-preparer-pour-claude.md).

**Fichiers de Claude à jour.** Pour un repo déjà préparé, l'onglet Santé a une ligne « Fichiers de Claude à jour ». Elle devient rouge quand un fichier du catalogue a une nouvelle version ou manque, avec le bouton **« Mettre à jour »** : le diff de chaque fichier, puis un seul commit (ou une pull request si la branche est protégée). Un fichier modifié à la main n'est jamais touché : la ligne le liste, « modifié à la main, gardé tel quel ». Le `CLAUDE.md`, fait pour être réécrit par chaque projet, n'est jamais proposé et n'apparaît pas dans la ligne. Cockpit reconnaît une copie non modifiée à l'empreinte qu'il a gardée en l'écrivant, ou à `catalog/history.json` pour un repo préparé avant. Décisions [049](docs/decisions/049-mise-a-jour-du-catalogue.md) et [051](docs/decisions/051-constats-de-claude.md) (le modèle d'un agent, choisi dans l'onglet Agents, ne compte pas comme une modification à la main).

Pour qui change un fichier de `catalog/` : lancer `npm run catalog:history` (dans un clone complet) et committer `catalog/history.json`, sinon un test échoue.

### Bloquer quelqu'un

Chaque personne crée son compte Cockpit en se connectant avec GitHub ; si elle n'a pas encore installé l'App, elle arrive sur une page qui explique l'installation, et un bandeau le lui rappelle tant qu'elle n'est pas installée. Pour écarter quelqu'un, l'administrateur ouvre « Réglages » (lien en haut de la page), clique sur « Bloquer » en face de son login puis confirme : ses sessions ouvertes sont fermées et il ne peut plus se connecter, même s'il change de login GitHub. « Débloquer » annule le blocage. Un administrateur ne peut pas être bloqué. Chaque utilisateur trouve aussi dans « Réglages » ses **jetons MCP** : « Nouveau jeton » affiche le jeton une seule fois (à copier tout de suite, Cockpit n'en garde que l'empreinte), « Révoquer » le désactive et le retire de la liste (Cockpit le supprime définitivement 3 mois plus tard).

## Connecter Claude Code

Cockpit se branche à Claude comme un **connecteur claude.ai**, en trois étapes et sans jeton à copier. Ouvre « Réglages » : la section « Connecter Claude » les reprend.

1. **Copier l'adresse** du connecteur, `<adresse publique>/mcp` (en local : `http://localhost:3000/mcp`).
2. **Ouvrir claude.ai** ([claude.ai/customize/connectors](https://claude.ai/customize/connectors)), choisir « Ajouter un connecteur personnalisé » et coller l'adresse.
3. **Se connecter** : claude.ai ouvre Cockpit ; connecte-toi avec GitHub si besoin, puis clique « Autoriser ».

C'est fait : Claude voit tes projets partout (Claude Code en local et dans le cloud, claude.ai, le téléphone, les tâches planifiées). La connexion apparaît dans les jetons MCP de « Connecter Claude », où tu peux la révoquer. Sans compte claude.ai, Claude Code fait la même connexion au premier usage : `claude mcp add --transport http cockpit <adresse publique>/mcp`. Pour que claude.ai joigne Cockpit, l'adresse doit être publique : en local, seul Claude Code sur ton PC peut se connecter. Un `.mcp.json` qui déclare Cockpit masque le connecteur : mieux vaut ne pas l'y mettre. Détails dans la décision [021](docs/decisions/021-connecter-claude.md) (et la [006](docs/decisions/006-connexion-oauth.md)).

### Plan B : un jeton créé à la main

Pour Claude Code avec une clé API (donc sans connecteur), ou si la connexion ci-dessus ne marche pas, les jetons manuels restent possibles. Il faut un jeton : le créer dans « Réglages » (« Nouveau jeton »), puis le mettre dans une variable d'environnement sans le laisser dans l'historique du shell, jamais dans un fichier du repo :

```sh
read -rs COCKPIT_MCP_TOKEN; export COCKPIT_MCP_TOKEN   # coller le jeton, puis Entrée
```

Dans le repo, un fichier `.mcp.json` ne garde que le nom de la variable (le type `http` est obligatoire ; Claude Code remplace `${VAR}` dans `url` et `headers`) :

```json
{
  "mcpServers": {
    "cockpit": {
      "type": "http",
      "url": "https://cockpit.example.com/mcp",
      "headers": { "Authorization": "Bearer ${COCKPIT_MCP_TOKEN}" }
    }
  }
}
```

Sans fichier : `claude mcp add --transport http cockpit https://cockpit.example.com/mcp --header 'Authorization: Bearer ${COCKPIT_MCP_TOKEN}'`. Source : la [documentation de Claude Code sur MCP](https://code.claude.com/docs/en/mcp). Puis demander à Claude « liste mes projets » ou « note cette idée sur X » (ou « écris les user stories de mes tickets » : `create_user_stories`, avec le skill `/write-us` du dossier `catalog/skills/write-us/`, à copier dans `.claude/skills/` du repo ; les stories attendent ta validation, que tu donnes sur la page de la story ; si tu en renvoies une avec un commentaire, Claude la réécrit avec `update_user_story`, toujours avec le skill `/write-us`, et ne valide jamais rien lui-même) : chaque appel apparaît dans le Journal. Un faux jeton est refusé et inscrit dans l'historique, mais cette ligne n'a pas d'utilisateur et n'est donc visible par personne pour l'instant ; elle le sera avec l'administration (010 G). La décision [016](docs/decisions/016-serveur-mcp.md) donne le détail).

## Développer une US avec Claude

Sur la page d'une US prête, ou en revue pour la reprendre (`/us/:id`), « Développer avec Claude » ouvre un panneau à droite (cible « Sur ce PC » ; pour le cloud, voir « Lancer dans le cloud ») : la branche (nouvelle ou existante), le dossier du clone sur ton PC (retenu par le navigateur) et un prompt complémentaire facultatif (`Ctrl Entrée` lance, comme la réponse à une question de Claude). « Lancer Claude » ouvre Claude Desktop dans ce dossier avec `/dev-us` prérempli ; « Copier le prompt » sert si le lien ne marche pas. Le skill `/dev-us` (du catalogue, voir « Préparer pour Claude ») suit l'équipe du projet et rend compte par le MCP : la page du run (`/runs/:id`) montre ses étapes en direct, les résultats des critères et la PR liée ; Claude y pose ses questions, auxquelles tu réponds sur place ou depuis l'accueil. « Demander l'arrêt » arrête Claude à l'étape suivante, « Fermer le run » ferme un run muet (après la confirmation « Fermer le run ? »), « Relancer » ramène à la page de l'US pour en lancer un autre. À la fin, le run dit « Acceptable » ou « À vérifier », avec ses raisons. Pour une US de reprise, `/dev-us` passe en mode « figer l'existant » : le test-writer écrit un test par règle, qui doit passer sans toucher au code de l'app, puis le reviewer vérifie ; les autres étapes sont sautées, et un test qui échoue n'entre pas dans la PR (critère en échec, « À vérifier »). Cockpit lit aussi les fichiers de la PR d'une US de reprise : s'il y en a hors des tests, le verdict ajoute « La PR modifie du code de l'app, pas seulement des tests », avec la liste des fichiers sur la page du run. Le merge reste à faire sur GitHub : Cockpit suit la PR par ses webhooks (« Actualiser » la relit) et passe l'US « terminée » au merge. Décisions [033](docs/decisions/033-run-minimal.md) à [039](docs/decisions/039-aide-a-la-decision.md), et [050](docs/decisions/050-figer-l-existant.md) pour le mode « figer ».

L'accueil (`/`) répond à « qu'est-ce qui m'attend ? » : « À toi de jouer » (questions, US à valider, PR à relire, runs à vérifier), « Claude travaille ». Les projets qui ne sont pas au repos sont dans la barre latérale, avec leur pastille. Décision [040](docs/decisions/040-accueil.md).

## Écrire les US automatiquement

Cockpit peut lancer lui-même l'écriture des user stories, à la fréquence que tu choisis pour chaque projet. Il faut d'abord relier une tâche planifiée de claude.ai, une seule fois : « Réglages », entrée « Tâches cloud » (section « Écrire les US automatiquement »), donne les étapes.

1. **Créer la tâche** sur [claude.ai/code/routines](https://claude.ai/code/routines) : déclencheur « API » seulement, le modèle de ton choix, seulement le connecteur Cockpit coché (claude.ai les coche tous : retire les autres ; voir « Connecter Claude Code »), et la consigne fournie par le bouton « Copier la consigne ».
2. **Coller dans Cockpit** l'« Adresse de lancement » et le « Jeton » que claude.ai affiche une seule fois, puis « Enregistrer ». Le jeton est chiffré avec la clé de l'instance et n'est plus jamais affiché. Si claude.ai le refuse un jour, Cockpit l'indique (« à reconnecter ») : clique « Régénérer » sur la tâche et recolle le jeton.
3. **Choisir la fréquence** (des cartes à choisir) dans l'onglet « Réglages » du projet : désactivée, à la demande, chaque jour ou chaque semaine, à l'heure de ton navigateur. « Écrire les US maintenant » lance tout de suite. Au planning, rien n'est lancé s'il n'y a aucune US à écrire.

Le lancement de la tâche est en préversion chez Anthropic et ne se vérifie pas dans les tests, qui le simulent. Détails dans la décision [022](docs/decisions/022-routine-ecriture-us.md).

## Lancer dans le cloud

Sur une US prête, « Développer avec Claude » propose « Dans le cloud » : la session démarre sans PC allumé. Il faut relier une seconde tâche planifiée, le « Lanceur Cockpit », une seule fois : « Réglages », « Tâches cloud », carte « Lanceur Cockpit » (mêmes étapes que ci-dessus, avec sa propre consigne), puis cocher les projets dont le repo est dans la tâche. Après un changement du catalogue, « Mettre à jour » les repos préparés (`/dev-us --launch`). Décision [054](docs/decisions/054-lancer-dans-le-cloud.md).

La page « Claude » → « Tâches programmées » (`/claude/taches`) ajoute tes propres routines par le même lanceur : un nom, une consigne (texte libre ou skill), des agents, des projets cochés dans le lanceur et un planning (à la demande, chaque jour, chaque semaine). Tu peux les lancer tout de suite, les mettre en pause ou les supprimer, et le panneau montre le résultat du dernier passage. Claude ne peut ni créer ni modifier une routine. Décision [056](docs/decisions/056-routines.md).

## Lancer en local

Il faut Node.js 24 ou plus récent et une base PostgreSQL 18. Pour avoir une base en local :

```sh
docker run --name cockpit-db -e POSTGRES_PASSWORD=cockpit -p 5432:5432 -d postgres:18
```

La seule variable à fournir :

```sh
export DATABASE_URL=postgres://postgres:cockpit@localhost:5432/postgres
```

```sh
npm install
npm run build
npm start
```

Les migrations sont appliquées au démarrage. Au premier lancement, le serveur crée sa clé de chiffrement dans `secrets/master.key` (`COCKPIT_KEY_FILE` pour la changer) et affiche le code de démarrage. Ouvrir http://localhost:3000 : l'assistant crée la GitHub App de développement (voir « Créer la GitHub App »).

Pour développer, lancer `npm run dev:server` et `npm run dev:web` dans deux terminaux, puis ouvrir http://localhost:5173 : la page se recharge à chaque modification. L'App est créée avec l'adresse par laquelle tu ouvres l'assistant : pour `npm run dev:web`, ouvrir `http://localhost:5173` (le proxy de Vite garde l'en-tête `Host`).

## Vérifier

```sh
npm test
npm run lint
npm run typecheck
npm run build
```

La CI lance ces quatre commandes, plus `scripts/smoke-test.sh` (voir « Tester la pile »).

## Déployer sur le Pi

Cockpit tourne sur le Raspberry Pi avec Docker Compose (Cockpit, PostgreSQL, `cloudflared`), derrière un Cloudflare Tunnel : aucun port ouvert sur la box.

### Installation, une seule fois

1. Installer Docker et le plugin Compose sur le Pi.
2. Installer le runner GitHub auto-hébergé avec les labels `self-hosted, raspberry`, et ajouter son utilisateur au groupe `docker`.
3. Dans le tableau de bord Cloudflare, créer un tunnel géré à distance, avec un nom d'hôte public qui pointe vers `http://app:3000`. Garder son jeton.
4. Créer les dossiers et le fichier d'environnement, au nom de l'utilisateur du runner (`<runner-user>`), lisible par lui seul. Il ne contient que le jeton du tunnel : le mot de passe de la base est généré par le premier déploiement, et GitHub est configuré par l'assistant.

   ```sh
   sudo install -d -o <runner-user> -m 700 /etc/cockpit /var/backups/cockpit
   echo 'TUNNEL_TOKEN=<jeton du tunnel>' | sudo tee /etc/cockpit/cockpit.env > /dev/null
   sudo chown <runner-user> /etc/cockpit/cockpit.env && sudo chmod 600 /etc/cockpit/cockpit.env
   ```

   Le fichier reste hors du repo, car `actions/checkout` supprime à chaque déploiement les fichiers non suivis.

### Déployer

Dans GitHub : Actions → CD → Run workflow. `scripts/deploy.sh` vérifie le fichier d'environnement (il ajoute `POSTGRES_PASSWORD` s'il manque), construit l'image, démarre les services, contrôle que `/api/health` renvoie la version de `version.txt`, puis supprime les anciennes images. Un autre fichier peut être indiqué avec `COCKPIT_ENV_FILE`.

### Premier lancement : l'assistant

Le premier déploiement affiche dans son journal la ligne `Cockpit setup code: XXXX-XXXX-XXXX-XXXX — open …/installation` (on la retrouve avec `docker compose --env-file /etc/cockpit/cockpit.env logs app`). Ensuite :

1. Ouvrir l'adresse publique de Cockpit, entrer le code de démarrage (étape « Code de démarrage »).
2. Lire les permissions demandées, cliquer sur « Créer l'App GitHub », puis sur « Create GitHub App » sur GitHub (étape « GitHub App »).
3. Se connecter avec GitHub : on devient administrateur (étape « Premier compte »).

### Garder une copie de la clé de chiffrement

Les secrets de la GitHub App sont chiffrés en base ; la clé est dans le volume Docker `secrets` (`/app/secrets/master.key`), jamais dans la base ni dans ses sauvegardes. **Une seule fois, après l'assistant**, copier cette clé hors du Pi (gestionnaire de mots de passe, autre machine) :

```sh
docker compose --env-file /etc/cockpit/cockpit.env cp app:/app/secrets/master.key ~/cockpit-master.key
chmod 600 ~/cockpit-master.key
```

Perdre le volume sans cette copie oblige à refaire l'assistant (nouvelle App) et chaque utilisateur à réinstaller l'App.

**Clé perdue ou changée.** Au démarrage, si la base contient la GitHub App mais que la clé ne la déchiffre pas (volume perdu, clé recréée, mauvaise clé), Cockpit s'arrête avec un message qui nomme le fichier de clé. Deux issues :

- remettre la copie de la clé (voir « Restaurer », étape de la clé), puis relancer ;
- ou refaire l'assistant avec une nouvelle App (chaque utilisateur devra réinstaller l'App) : effacer la configuration enregistrée, puis relancer.

  ```sh
  docker compose --env-file /etc/cockpit/cockpit.env exec db psql -U postgres -d cockpit -c 'DELETE FROM instance_settings;'
  ```

  La base tourne pendant que l'application redémarre en boucle ; une fois la ligne effacée, le prochain redémarrage ouvre l'assistant.

**Administrateur perdu.** Si l'App existe mais qu'aucun compte n'est administrateur (par exemple l'assistant s'est arrêté avant la première connexion), Cockpit réaffiche son code de démarrage au lancement, et la page d'accueil propose de redevenir administrateur avec ce code.

### Sauvegarde

`scripts/backup.sh` écrit un `pg_dump` compressé dans `/var/backups/cockpit` (`BACKUP_DIR`) et supprime ceux de plus de 14 jours (`KEEP_DAYS`). Une sauvegarde par jour, avec `crontab -e` sous l'utilisateur du runner :

```cron
0 3 * * * /chemin/du/runner/_work/Cockpit-v2/Cockpit-v2/scripts/backup.sh >> $HOME/cockpit-backup.log 2>&1
```

En cas de doute, lire `~/cockpit-backup.log` : les erreurs du script y sont écrites.

### Restaurer

Il faut la sauvegarde de la base **et** la clé de chiffrement (volume `secrets`) : sans la clé, les secrets de la GitHub App stockés en base ne se relisent pas.

**Ne jamais lancer `docker compose down -v` sur la vraie pile** : `-v` supprime aussi le volume `secrets`, donc la clé. On arrête avec `down` seul, et on ne supprime que le volume de la base.

Depuis le dossier du checkout (celui de `compose.yaml`), avec `ENV=/etc/cockpit/cockpit.env` :

```sh
docker compose --env-file "$ENV" --profile tunnel down       # sans -v
docker volume rm cockpit_db-data                             # efface la base actuelle, et elle seule
# La clé, écrite par l'utilisateur de l'image (un `cp` garderait le propriétaire de l'hôte, illisible pour l'application) :
docker compose --env-file "$ENV" run --rm -T --no-deps app sh -c 'cat > secrets/master.key && chmod 600 secrets/master.key' < ~/cockpit-master.key
docker compose --env-file "$ENV" up -d --wait db             # la base seule, avant que l'application crée ses tables
gzip -dc /var/backups/cockpit/cockpit-AAAAMMJJ-HHMMSS.sql.gz |
  docker compose --env-file "$ENV" exec -T db psql -v ON_ERROR_STOP=1 --single-transaction -U postgres -d cockpit
```

Puis relancer le CD (ou `scripts/deploy.sh`) pour démarrer l'application et le tunnel.

### Tester la pile

`scripts/smoke-test.sh` démarre la pile dans son propre projet Compose (`cockpit-smoke`), avec un mot de passe jetable et sans le tunnel, puis la supprime : les vraies données ne sont pas touchées. La CI le lance dans le job `docker`.
