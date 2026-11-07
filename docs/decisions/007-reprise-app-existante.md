# 007 — Analyser et reprendre une app existante

- **Statut** : proposée (à valider à la relecture de la PR)
- **Date** : 2026-10-22, complétée le 2026-10-25 (carte du modèle, constats, écran « Conception »)
- **Décidé par** : Dorian, avec Claude
- **Dépend de** : [002 — Modèle de données](002-modele-donnees.md), [003 — Interface](003-interface.md), [004 — Outils MCP](004-outils-mcp.md), [005 — Lancement local](005-lancement-local.md), [012 — Configuration automatique](012-configuration-automatique.md)
- **Ajoute** : une fonctionnalité au brief, après le MVP. Ne revient sur aucune décision prise ; ajoute une ligne à la table des droits de la 004 (le tri des constats)

## Contexte

La boucle du brief (§2) ne sert qu'aux projets démarrés avec Cockpit. Or beaucoup d'apps sont aujourd'hui construites avec une IA par quelqu'un qui n'a pas relu le code : c'est le cas de la v1 de Cockpit (brief §1). Le jour où il faut les faire évoluer, personne ne connaît leurs règles, chaque changement casse quelque chose, et la seule issue est de tout réécrire.

**Reprendre une app** : Cockpit importe un repo construit sans lui, Claude en tire les **règles métier**, l'humain les valide **une par une en regard du code**, puis Claude écrit un test par règle validée. L'app entre ensuite dans la boucle normale, comprise et protégée.

**Analyser une app** (complément du 2026-10-25) : comprendre les règles ne suffit pas pour reprendre une app. Il faut aussi savoir de quoi elle est faite et ce qui ne va pas. Cockpit doit donc montrer :

1. le **modèle métier** de l'app (ses objets, leurs champs et leurs liens), **un diagramme par sous-projet** quand le repo en contient plusieurs (web, API, mobile) ;
2. un **avis sur l'architecture**, avec des changements qu'on peut faire sans tout casser, réalisables ensuite par Claude dans la boucle normale ;
3. un **avis sur la stack** : ce qu'une librairie connue ferait mieux que du code maison, pour la maintenabilité ;
4. les **bugs** trouvés ;
5. les **failles de sécurité** trouvées ;
6. **toutes les règles métier dans un graphe**, comme l'outil « Conception » de [grepo.app](https://grepo.app), pour les valider ou non ;
7. les **montées de version** à prévoir (langages, runtimes, frameworks), pour ne pas prendre de retard.

C'est la fonctionnalité qui distingue Cockpit. En octobre 2026, l'extraction de règles avec validation humaine existe pour moderniser du COBOL ([AgentModernize](https://arxiv.org/html/2605.17535v1), [codetospec](https://github.com/StevenACoffman/codetospec), [EvolveWare](https://evolveware.com/agile-business-rules-extraction/)) ; les outils de documentation (DeepWiki, Code Wiki) décrivent le code sans le faire valider ni le tester ; Kiro et Spec Kit partent d'une nouvelle spécification ; grepo décrit une conception écrite à la main. Aucun ne reprend une app récente pour continuer à la développer.

## Le principe

**Cockpit n'appelle jamais Claude** (architecture). Toutes les analyses sont faites par une session Claude Code de l'utilisateur, lancée par le skill `/analyser`, qui **dépose** ses résultats par le MCP. Cockpit vérifie, range, affiche, et fait trier par l'humain.

Claude dépose trois choses, avec **une seule garantie** : chacune **cite le code** (fichier, lignes, commit), et **Cockpit vérifie chaque citation sur GitHub** avant de l'accepter.

| Ce que Claude dépose | Sert aux besoins | Outil MCP |
|---|---|---|
| La **carte** : sous-projets, objets métier, liens entre objets, runtimes et frameworks avec leur version | 1, et la base de 6 et 7 | `submit_code_map` |
| Les **règles** : critères d'acceptation d'US de reprise | 6 | `create_takeover_stories` |
| Les **constats** : bugs, failles, architecture, stack, versions | 2, 3, 4, 5, 7 | `submit_findings` |

## Les choix

| # | Question | Décision |
|---|---|---|
| A | Où vit une règle ? | **Un critère d'acceptation** d'une US. Une fonctionnalité de l'app = un ticket « Reprise : … », ses règles = les critères de ses US. Les tables, la validation, les runs et le Kanban existants servent tels quels |
| B | Comment distinguer une US de reprise ? | Une colonne `kind` sur `user_stories` : `feature` (par défaut) ou `takeover` (`CHECK`). Elle change ce que fait le run (choix E) |
| C | Comment l'humain sait-il d'où vient ce que Claude affirme ? | **Tout ce que Claude dépose cite le code** qu'il a lu : fichier, lignes, commit. **Cockpit vérifie la citation sur GitHub** avant d'accepter. Une seule fonction de vérification sert aux règles, aux objets de la carte et aux constats |
| D | Que peut répondre l'humain à une règle ? | **C'est voulu**, **C'est un bug**, **Modifier**, **Plus tard** (voir l'écran de reprise) |
| E | Que fait le run d'une US de reprise ? | `/dev-us` en mode **« figer l'existant »** : le test-writer écrit un test par règle, qui doit **passer tout de suite**, et aucun fichier de l'app n'est modifié. Un test qui échoue veut dire que la règle est fausse : le critère est `failed` et le verdict « à vérifier » |
| F | Combien de règles à la fois ? | **Fonctionnalité par fonctionnalité**, en commençant par celles qu'on veut faire évoluer. Une reprise n'a pas à couvrir toute l'app |
| G | Que montre le « diagramme de classe » ? | **Le modèle métier** : les objets (tables, types, classes quand il y en a), leurs champs et leurs liens. Une app TypeScript ou React a peu de vraies classes : un diagramme UML strict y serait presque vide. Ces objets sont aussi les « objets » du graphe des règles (choix K) |
| H | Comment repérer les sous-projets d'un repo ? | **Claude les déclare** dans la carte, chacun avec son dossier et son **manifeste** (`package.json`, `build.gradle`, `pyproject.toml`…), que Cockpit vérifie à ce commit. Un diagramme par sous-projet |
| I | Sous quelle forme les bugs, failles et avis ? | **Une seule liste de constats**, avec un type (`bug`, `security`, `architecture`, `stack`, `upgrade`). Le « document des bugs » ou « des failles » est la liste filtrée par type, exportable en Markdown. Chaque constat se **trie** : un constat retenu devient un ticket, et entre dans la boucle normale |
| J | Qui sait quoi sur la sécurité et les versions ? | **GitHub et Claude.** Cockpit lit ce que GitHub sait déjà, sans crédits Claude et toujours à jour : alertes Dependabot, code scanning, secret scanning. Il lit les dates de fin de vie des runtimes sur [endoflife.date](https://endoflife.date). Claude ajoute ce que ces outils ne voient pas (une faille de logique, un plan de migration) |
| K | Comment voir toutes les règles d'un coup ? | Un écran **« Conception »**, un graphe sur le modèle de grepo : **acteurs**, **fonctionnalités**, **règles**, **objets**. On y navigue ; on valide toujours dans l'écran de reprise |
| L | Comment rendre les refontes sans risque ? | Un **rappel sans interdire** (comme les dépendances, brief §6.5) : un constat d'architecture, de stack ou de version dont le code cité n'est couvert par **aucune règle figée** le dit, et propose de reprendre d'abord la fonctionnalité concernée |

## La carte (besoin 1)

Ce que Claude déclare pour chaque sous-projet :

- son **nom**, son **dossier**, son **type** (`web`, `api`, `mobile`, `library`, `other`) et son **manifeste** ;
- ses **runtimes et frameworks**, avec leur version et la ligne du manifeste qui la fixe (« node 20 », « react 18.3 ») ;
- ses **objets** : nom, nature (`table`, `type`, `class`), champs (nom et type), et **une citation** (là où l'objet est défini) ;
- les **liens** entre objets : `contains`, `references`, `extends`, avec une cardinalité facultative (`1`, `0..1`, `n`).

La carte décrit le code **à un commit**. L'écran dit « Analysé au commit a1b2c3d · 12 commits depuis » et propose de relancer l'analyse. Une nouvelle carte d'un sous-projet **remplace** l'ancienne ; l'historique garde la trace du dépôt.

## Les constats (besoins 2 à 5 et 7)

Un constat a : un **type**, une **source** (`claude` ou `github`), un titre, un texte en Markdown, une **gravité** (`critical`, `high`, `medium`, `low`), un **effort** facultatif (`small`, `medium`, `large`), et **au moins une citation** quand il vient de Claude.

Le skill impose un gabarit au texte, selon le type :

| Type | Le texte dit |
|---|---|
| `bug` | Le comportement observé et le comportement attendu, en Étant donné / Quand / Alors : le ticket qui en naîtra a déjà la base de son US |
| `security` | La catégorie ([OWASP Top 10](https://owasp.org/Top10/)), le scénario d'attaque, la correction. **Jamais de secret**, même trouvé dans le code : seulement son emplacement |
| `architecture` | L'état actuel (cité), la cible, les étapes pour y aller, ce que cela touche |
| `stack` | La librairie proposée (licence, dernière version, activité de maintenance), le code maison qu'elle remplace (cité), le gain |
| `upgrade` | De quelle version à laquelle, la date de fin de vie, les ruptures connues, l'effort |

### Ce qui vient de GitHub

- Les **alertes Dependabot** (`security` ou `upgrade`), **code scanning** (`security`) et **secret scanning** (`security`) deviennent des constats `source = github`, lus au clic sur « Actualiser », puis par webhook une fois la tranche 5.1 faite. Une alerte réimportée ne crée pas de doublon (numéro d'alerte unique par projet). Une alerte de secret ne garde que son emplacement et le type de secret, **jamais la valeur** (principe 5 du brief).
- La **fin de vie** des runtimes de la carte est lue sur endoflife.date à l'affichage. Un runtime en fin de vie, ou qui le sera dans les six mois, est signalé sur la carte et dans la liste des versions.
- Le **bilan de santé** (2.2) gagne une ligne : « Mises à jour automatiques configurées » (Dependabot ou Renovate). Sa correction propose un `.github/dependabot.yml` : c'est de la configuration, Cockpit peut donc l'écrire, diff montré avant (principe 3, mécanisme de 6.1).

### Trier les constats

Page **Constats** du projet, filtrée par type et par gravité, avec le code cité à gauche comme sur l'écran de reprise. Trois choix, **pour l'humain seulement** :

| Choix | Effet |
|---|---|
| **Créer un ticket** (bouton corail) | Crée un ticket prérempli avec le constat et ses liens vers le code. Claude en écrit les US, l'humain les valide, `/dev-us` les développe : c'est ce qui rend un avis d'architecture ou de stack **réalisable par Claude** sans sortir de la boucle |
| **Rejeter** | Raison facultative ; le constat reste visible dans le filtre « rejetés » |
| **Plus tard** | Reste à trancher |

Le **rappel du choix L** s'affiche sur le constat et sur le ticket qui en naît : « Aucun test ne protège ce code : reprends d'abord la fonctionnalité Connexion ». Il se calcule (les fichiers cités par le constat contre ceux cités par les règles figées), il ne se stocke pas.

## L'écran « Conception » (besoins 1 et 6)

Un seul écran, deux vues. C'est un graphe que l'on déplace et zoome ; chaque nœud mène quelque part.

```
┌─ Conception · GestionProjet ─────────────────────── [ Modèle ] [ Par fonctionnalité ▾ Connexion ] ─┐
│                                                                                                    │
│   ┌ ACTEUR ──────┐   utilise   ┌ FONCTIONNALITÉ ┐  respecte  ┌ RÈGLE · voulue ─────────────┐       │
│   │ Utilisateur  │────────────►│ Connexion      │───────────►│ Un compte bloqué ne se      │       │
│   └──────────────┘             └────────────────┘     │      │ connecte pas                │       │
│                                                       │      └─────────────┬───────────────┘       │
│                                                       │      ┌ RÈGLE · à trancher ─────────┐       │
│                                                       └─────►│ 5 échecs bloquent le compte │       │
│                                                              └─────────────┬───────────────┘       │
│                                                                   manipule ▼                       │
│                                       ┌ OBJET · api ───┐  référence  ┌ OBJET · api ────┐           │
│                                       │ Session        │────────────►│ User            │           │
│                                       │ token, expire  │       n → 1 │ email, lockedAt │           │
│                                       └────────────────┘             └─────────────────┘           │
│                                                                                                    │
│ Analysé au commit a1b2c3d · 12 commits depuis · Relancer l'analyse          Exporter en Markdown   │
└────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

- **Vue « Modèle »** : les objets seuls, **un onglet par sous-projet** (web, api, mobile). C'est le diagramme du besoin 1.
- **Vue « Par fonctionnalité »** : un graphe par fonctionnalité reprise, avec ses acteurs, ses règles et les objets qu'elles manipulent. Toute l'app d'un coup serait illisible.
- Les quatre sortes de nœuds reprennent les catalogues de grepo : **acteur** (le « en tant que » des US de reprise), **fonctionnalité** (le ticket « Reprise : … »), **règle** (le critère), **objet** (la carte). Les liens : un acteur *utilise* une fonctionnalité, une fonctionnalité *respecte* une règle, une règle *manipule* un objet, un objet *référence* un objet.
- **L'état d'une règle** se voit sur son nœud : à trancher, voulue, figée (son test passe), bug. Les états suivent les tokens de couleur de `styles.css` (003).
- **Clic sur une règle** : l'écran de reprise, sur cette règle. **On ne valide que là**, en regard du code. **Clic sur un objet** : son code cité, et les règles qui le manipulent.
- Un objet cité par une règle mais absent de la carte apparaît en gris, « non cartographié » : c'est le signe que la carte est à relancer.
- Chaque vue existe aussi **en listes** (les quatre catalogues), pour le clavier et les lecteurs d'écran, et en **largeur téléphone**, où le graphe n'est pas affiché.
- **Exporter en Markdown** : la conception d'une fonctionnalité, ou de tout le projet.
- Librairie : [React Flow](https://reactflow.dev) (`@xyflow/react`), avec une mise en page automatique (`dagre`). C'est une dépendance de plus, mais un graphe déplaçable et cliquable ne s'écrit pas en quelques lignes.

## L'écran de reprise

Le doute principal est : « cette règle, Claude l'a-t-il vraiment lue dans le code, ou l'a-t-il inventée ? ». L'écran met donc **côte à côte** le code que Claude a lu et la règle qu'il en a tirée, pour que l'humain juge sur pièce.

```
┌─ Reprise · GestionProjet · Connexion ─────────────────────────────── Règle 3 sur 12 ─┐
│ CODE LU PAR CLAUDE                           │ RÈGLE TROUVÉE                          │
│ [login.ts]  [lockout.ts]                     │                                        │
│ src/auth/login.ts · lignes 18 à 24 · a1b2c3d │ Étant donné un compte bloqué           │
│                                              │ Quand son propriétaire se connecte     │
│   16   const user = await findUser(email)    │ Alors il voit « Compte bloqué » et     │
│   17                                         │       n'est pas connecté               │
│ ▌ 18   if (user.lockedAt) {                  │                                        │
│ ▌ 19     return c.json(                      │ POURQUOI CLAUDE LE PENSE               │
│ ▌ 20       { error: "Compte bloqué" },       │ « La ligne 18 arrête la connexion dès  │
│ ▌ 21       403,                              │ que lockedAt est rempli, avant la      │
│ ▌ 22     )                                   │ vérification du mot de passe. »        │
│ ▌ 23   }                                     │                                        │
│ ▌ 24   await checkPassword(user, password)   │ [   C'est voulu   V   ]                │
│   25                                         │  C'est un bug  B · Modifier  M ·       │
│                                              │  Plus tard  P                          │
│ Voir sur GitHub ↗                            │                                        │
└──────────────────────────────────────────────┴────────────────────────────────────────┘
```

### À gauche : le code lu par Claude

- **Un onglet par extrait** quand la règle vient de plusieurs endroits (le contrôle côté serveur et le message côté page, par exemple).
- L'en-tête dit **quel fichier, quelles lignes et quel commit** : c'est le code tel que Claude l'a lu, même si le repo a changé depuis.
- Les lignes citées sont **surlignées en violet** (la couleur de Claude, 003), avec quelques lignes de contexte avant et après, non surlignées.
- **« Voir sur GitHub »** ouvre le lien permanent du commit sur ces lignes (`…/blob/a1b2c3d/src/auth/login.ts#L18-L24`), pour lire le reste du fichier.
- Le code est **relu sur GitHub à l'affichage**, au commit cité ; Cockpit n'en garde pas de copie (principe n° 6 du brief).

### À droite : la règle et les choix

- La règle en **Étant donné / Quand / Alors**, en français.
- **« Pourquoi Claude le pense »** : une ou deux phrases qui relient la règle aux lignes citées. C'est ce qui permet de vérifier le raisonnement, pas seulement le résultat.
- Les choix, avec **une seule action principale** (règle 2 de 003) :

| Choix | Touche | Effet |
|---|---|---|
| **C'est voulu** (bouton corail) | `V` | La règle est retenue ; **passe à la suivante** ; « Annuler » pendant 8 s (003) |
| **C'est un bug** | `B` | Crée un ticket « Bug : … » avec la règle et le lien vers le code, **et un constat `bug` lié à ce ticket**, pour que la liste des bugs soit complète ; la règle est retirée de l'US ; passe à la suivante |
| **Modifier** | `M` | La règle devient éditable sur place : Claude a vu le bon code mais l'a mal décrit |
| **Plus tard** | `P` | Passe à la suivante sans décider ; la règle reste à trancher |

- L'US ne peut être validée que quand **toutes ses règles sont tranchées**. Tant qu'il en reste, le bouton de validation dit lesquelles (règle 5 de 003).
- `J` / `K` passent d'une règle à l'autre, comme ailleurs (003).
- **En largeur téléphone**, la règle passe au-dessus et le code se replie sous elle (« Voir le code lu par Claude ») ; à maquetter avec les autres gestes mobiles (point ouvert 4 de 003).

## Lancer une analyse

Le skill **`/analyser`** (catalogue) se lance depuis la page du projet, comme `/dev-us` (005). Une fenêtre demande ce qu'il faut analyser, chaque case avec un rappel du coût en crédits :

- **Carte** (le modèle, par sous-projet) ;
- **Règles**, avec le choix des fonctionnalités à reprendre (choix F) ;
- **Bugs** ;
- **Sécurité** ;
- **Architecture et stack** ;
- **Versions**.

Le skill fait toujours **la carte d'abord** quand elle manque ou qu'elle est périmée : les règles et les constats nomment les objets de la carte. Il confie chaque analyse à un agent du catalogue :

| Agent | Analyse | Dépose par |
|---|---|---|
| `cartographer` | Carte | `submit_code_map` |
| `rules-analyst` | Règles | `create_takeover_stories` |
| `bug-hunter` | Bugs | `submit_findings` |
| `security-reviewer` (déjà au catalogue, brief §6.9) | Sécurité | `submit_findings` |
| `architect` | Architecture et stack, une seule lecture | `submit_findings` |
| `upgrade-advisor` | Versions, en partant des runtimes de la carte et des alertes GitHub | `submit_findings` |

Avant de déposer, chaque agent lit les constats déjà connus (`list_findings`) pour ne pas redéposer ce qui l'est.

## Modèle de données

- Sur `user_stories` : `kind` (`feature` ou `takeover`, `CHECK`, `feature` par défaut).
- Sur `acceptance_criteria` : `reasoning`, le « pourquoi Claude le pense », vide pour une US ordinaire ; `object_names` (`text[]`), les objets de la carte que la règle manipule, résolus contre la carte à l'affichage.
- Une table **`code_maps`**, la carte d'un sous-projet :

| Colonne | Rôle |
|---|---|
| `id` | Identifiant |
| `project_id` | Le projet |
| `module_path` | Le dossier du sous-projet, depuis la racine ; unique par projet |
| `module_name`, `module_kind` | Son nom et son type (`CHECK`) |
| `commit_sha` | Le commit lu par Claude |
| `data` | `jsonb` validé par un schéma Zod : runtimes, objets, champs, liens, et la citation de chaque objet |
| `created_at` | La date du dépôt |

- Une table **`findings`**, un constat :

| Colonne | Rôle |
|---|---|
| `id` | Identifiant |
| `project_id` | Le projet |
| `kind` | `bug`, `security`, `architecture`, `stack`, `upgrade` (`CHECK`) |
| `source` | `claude` ou `github` (`CHECK`) |
| `title`, `body_md` | Le titre et le texte |
| `severity`, `effort` | Gravité ; effort facultatif (`CHECK`) |
| `status` | `open`, `ticketed`, `dismissed`, `later` (`CHECK`) |
| `ticket_id` | Le ticket créé, rempli si et seulement si `status = ticketed` (`CHECK`) |
| `dismiss_reason` | La raison d'un rejet, facultative |
| `commit_sha` | Le commit lu |
| `github_alert_number` | Le numéro de l'alerte GitHub ; unique par projet et par type, pour réimporter sans doublon |

- Une table **`code_sources`**, un extrait de code cité par une règle **ou** un constat :

| Colonne | Rôle |
|---|---|
| `id` | Identifiant |
| `criterion_id` | La règle, en `ON DELETE CASCADE` : un extrait n'a pas de sens sans elle |
| `finding_id` | Le constat, en `ON DELETE CASCADE` ; **exactement un** des deux est rempli (`CHECK`) |
| `position` | L'ordre des onglets |
| `path` | Le fichier, depuis la racine du repo |
| `start_line`, `end_line` | Les lignes citées, `start_line <= end_line` (`CHECK`) |
| `commit_sha` | Le commit lu par Claude |

Les citations des objets de la carte restent dans son `data` : elles sont remplacées avec elle.

## Outils MCP

| Outil | Demande | Fait | Refus |
|---|---|---|---|
| `create_takeover_stories` | `project_id`, le **titre de la fonctionnalité**, `commit_sha`, et des US comme pour `create_user_stories` (004), dont **chaque critère** porte un `reasoning`, **au moins un extrait** (`path`, `start_line`, `end_line`) et `object_names` facultatif | Crée le ticket « Reprise : <titre> » et toutes ses US (`kind = takeover`, `to_validate`), tout ou rien | Comme `create_user_stories` ; critère sans `reasoning` ou sans extrait ; **commit inconnu sur GitHub, fichier absent à ce commit, ou lignes au-delà de la fin du fichier** |
| `submit_code_map` | `project_id`, `commit_sha`, et un ou plusieurs sous-projets (voir « La carte ») | Remplace la carte de chaque sous-projet envoyé, tout ou rien | Citation invalide (comme ci-dessus) ; manifeste absent à ce commit ; deux objets du même nom dans un sous-projet ; lien vers un objet inconnu ; projet archivé |
| `submit_findings` | `project_id`, `commit_sha`, une liste de constats (`kind`, `title`, `body_md`, `severity`, `effort` facultatif, **au moins un extrait**) | Crée les constats (`source = claude`, `open`), tout ou rien | Citation invalide ; champ vide ; type inconnu ; projet archivé |
| `list_findings` | `project_id`, `kind` et `status` facultatifs | Les constats, sans le texte complet (titre, type, gravité, statut, fichiers cités) | Projet introuvable |

- **La vérification des citations est le garde-fou central** : Claude ne peut pas citer un fichier ou des lignes qui n'existent pas. Elle ne prouve pas que la règle ou le constat découle du code ; c'est le rôle des écrans et de l'humain. C'est **une seule fonction**, qui lit chaque fichier cité une seule fois par appel.
- `/dev-us` lit `kind` dans `get_user_story` et passe en mode « figer l'existant » (choix E). Les transitions et les droits des US ne changent pas (004).

### Ajout à la table des droits (004)

| Action | Claude (outil MCP) | Humain (interface) | GitHub |
|---|---|---|---|
| Déposer une carte, des constats | `submit_code_map`, `submit_findings` | — | alertes importées (constats `source = github`) |
| Trier un constat (ticket, rejet, plus tard) | **jamais** | oui | — |
| Supprimer un constat | **jamais** | **jamais** (on le rejette) | — |

## Conséquences

- **Découpage** : six tranches après le MVP, dans cet ordre. La carte et les règles d'abord : figer l'existant en tests rend sans risque les refontes que proposeront les constats.

| # | Tranche | Démo |
|---|---|---|
| R1 | **Carte** : la fonction de vérification des citations, `submit_code_map`, `code_maps`, écran « Conception », vue « Modèle » (un onglet par sous-projet), `/analyser` avec `cartographer` | Sur un repo qui contient un web et une API, je vois deux diagrammes ; un clic sur un objet montre son code |
| R2 | **Règles** : `create_takeover_stories`, `code_sources`, `object_names`, `rules-analyst`, puis l'écran de reprise | Je reprends une fonctionnalité de la v1, je vois le code à gauche et la règle à droite, je la valide |
| R3 | **Graphe par fonctionnalité** : acteurs, fonctionnalités, règles, objets ; export Markdown | Je clique une règle dans le graphe et j'arrive sur l'écran de reprise |
| R4 | **Figer l'existant** : le mode de `/dev-us` et du test-writer | La règle validée a son test, qui passe ; son nœud passe « figée » |
| R5 | **Constats de Claude** : `findings`, `submit_findings`, `list_findings`, page Constats, tri, « Créer un ticket », rappel du choix L ; agents `bug-hunter`, `security-reviewer`, `architect` | Une faille trouvée par Claude devient un ticket en un clic |
| R6 | **Constats de GitHub et versions** : permissions de l'App, import des alertes, fin de vie par endoflife.date, `upgrade-advisor`, ligne « Mises à jour automatiques » du bilan | Une alerte Dependabot apparaît dans les constats ; Node 20 en fin de vie est signalé sur la carte |

- **Prérequis** : l'app reprise doit pouvoir lancer des tests en CI. Sinon, le bilan de santé (2.2) le signale, et la CI de départ (brief §6.10) devient le premier pas.
- **GitHub App** : R6 demande trois permissions en lecture de plus (*Dependabot alerts*, *Code scanning alerts*, *Secret scanning alerts*) et leurs webhooks. C'est le cas du point ouvert de la [012](012-configuration-automatique.md) : modification de l'App existante, puis approbation par chaque utilisateur.
- **Tests** : la vérification des citations, l'import des alertes et endoflife.date passent par de faux services (principe 9 du brief).
- **Documentation métier** : les règles validées d'un projet, regroupées par fonctionnalité, en forment une, chaque règle avec son test. L'export Markdown de l'écran « Conception » la rend lisible hors de Cockpit. Aucune table de plus n'est nécessaire.

## Limites connues

- **L'extraction se trompe** : elle oublie des règles et en invente ([COBRAIN](https://dl.acm.org/doi/10.1145/3756681.3756982)). L'écran sert justement à trier ; les règles oubliées ne se voient pas, et c'est la limite principale. Il en va de même pour la carte : on vérifie ce qui est cité, pas ce qui manque.
- **Figer l'existant fige aussi les bugs** que l'humain n'aura pas reconnus en validant.
- **Coût** : lire une fonctionnalité entière, ou tout un sous-projet pour la carte, consomme beaucoup de crédits sur un gros repo. Le choix F et les cases de la fenêtre d'analyse le limitent.
- **Le contexte autour des lignes citées** peut ne pas suffire : une règle peut dépendre d'une configuration ou d'un fichier non cité. « Voir sur GitHub » est le recours.
- **La carte vieillit** dès le commit suivant. L'écran dit de combien de commits, et propose de relancer.
- **La vérification lit GitHub** : un appel par fichier distinct cité. Une grosse carte peut en demander des dizaines, sous la limite de 5 000 requêtes par heure de l'App.
- **Un avis d'architecture ou de stack reste un avis.** Il ne fait rien tout seul : l'humain le trie, et le ticket qui en naît passe par la validation des US.

## Points ouverts

1. **Granularité** : combien de règles par US ? À fixer en écrivant `/analyser`, sur la v1 de Cockpit comme premier essai. *Tranché par la [047](047-ecran-de-reprise.md) : 5 règles au plus par US.*
2. **Contrôle du mode « figer »** : le reviewer vérifie que la PR ne touche que des tests. Cockpit pourrait le vérifier lui-même sur le diff de la PR ; à décider en R4. *Tranché par la [050](050-figer-l-existant.md) C : le reviewer et Cockpit, sur les fichiers de la PR.*
3. **Coloration du code** à gauche : à choisir avec l'écran de reprise (R2), sans couleur codée en dur (003). *Tranché par la [047](047-ecran-de-reprise.md) F : Shiki, thème `css-variables`.*
4. **Modèle de chaque agent** d'analyse (005) : `security-reviewer` et `architect` méritent sans doute le plus gros.
5. **Doublons entre deux analyses** : `list_findings` évite de redéposer ce qui est connu, sans le garantir. À revoir en R5 si le cas se présente.
6. **`object_names` absent de la carte** : accepté et montré en gris (choix retenu), ou refusé par `create_takeover_stories` ? À confirmer en R2. *Tranché par la [047](047-ecran-de-reprise.md) J : accepté, montré en gris.*
7. **Offre** : l'analyse et la reprise sont dans l'offre Pro ([offres](../offres.md)), bloquées côté serveur dans l'API **et** le MCP. À trancher avec la tranche « Service payant ».

## Pistes écartées

- **Valider une US de reprise d'un bloc**, comme une US ordinaire : trop grossier, on valide sans regarder le code de chaque règle.
- **Garder une copie du code cité** dans Cockpit : GitHub est la source de vérité, et le commit suffit à retrouver exactement ce que Claude a lu.
- **Accepter les citations sans les vérifier** : un extrait inventé rendrait l'écran trompeur, alors qu'il est fait pour lever le doute.
- **« Je ne sais pas » qui demande une explication à Claude depuis Cockpit** : Cockpit n'appelle jamais Claude, c'est Claude qui vient à lui par le MCP. Le « pourquoi » est donc écrit dès l'extraction, et « Plus tard » laisse le temps de lire le code.
- **Un vrai diff ou un éditeur à gauche** : il n'y a rien à comparer, seulement du code à lire.
- **Un diagramme UML strict** : presque vide sur une app fonctionnelle, et sans lien avec les règles.
- **Calculer la carte dans Cockpit** par analyse syntaxique : un analyseur par langage, des repos à cloner sur le serveur (le Pi), et toujours aucune idée de ce qui est métier. Claude le fait dans la session de l'utilisateur, et Cockpit vérifie.
- **Mermaid** pour les diagrammes : une image figée, sans clic vers le code ni vers l'écran de reprise.
- **Cinq rapports rédigés** (bugs, failles…) : lus d'un bloc, sans rien qui entre dans la boucle ticket → US → développement.
- **Écrire les rapports dans le repo** : Cockpit n'écrit dans un repo que de la configuration (principe 3 du brief). L'export Markdown suffit.
- **Claude seul pour la sécurité et les versions** : chaque passage coûterait des crédits, et pourrait rater une faille connue que GitHub signale gratuitement.
- **Laisser Claude trier les constats** : c'est décider de ce qui sera développé, et cela revient à l'humain (principe 1 du brief).
