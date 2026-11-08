# 051 — Les constats de Claude

- **Statut** : proposée (à valider à la relecture de la PR) ; le code est construit (tranche R5)
- **Date** : 2026-11-07
- **Décidé par** : Dorian, avec Claude
- **Dépend de** : [007 — Reprendre une app existante](007-reprise-app-existante.md) (« Les constats », « Trier les constats », `findings`, `code_sources`, `submit_findings`, `list_findings`, le choix L), [043](043-carte-du-code.md) (`verifyCitations`, la route du code), [047](047-ecran-de-reprise.md) (« C'est un bug », `CodeView`, la fenêtre d'analyse), [050](050-figer-l-existant.md) (les règles figées), [030 — L'éditeur d'agent](030-editeur-d-agent.md), [049 — La mise à jour du catalogue](049-mise-a-jour-du-catalogue.md)
- **Modifie** : la [049](049-mise-a-jour-du-catalogue.md) D et F (la ligne `model:` d'un agent ne compte pas comme une modification à la main, voir L) ; la [030](030-editeur-d-agent.md) (l'onglet Agents montre aussi les agents d'analyse, voir L)
- **Tranche** : R5 du [découpage](../decoupage.md), phase 10
- **Écran** : [S44](../ecrans/S44_Reprise_Constats.png)

## Contexte

La 007 décrit les constats : Claude dépose des bugs, des failles, des avis d'architecture et de stack, chacun **citant le code** ; Cockpit vérifie les citations ; l'humain les trie, et un constat retenu devient un ticket, donc des US que Claude développe. Démo : une faille trouvée devient un ticket en un clic.

La 007 laissait ouvert le **modèle de chaque agent d'analyse** (point 4). Le 2026-11-07, Dorian a choisi **B** : `security-reviewer` et `architect` en `opus`, `bug-hunter` en `sonnet`, et a demandé que **ce soit modifiable** : quelqu'un sur l'abonnement Pro ne voudra peut-être pas tout en `opus`, quelqu'un sur Max voudra tout en `opus`. Le point 5 (doublons entre deux analyses) reste à revoir si le cas se présente, comme le dit la 007.

## Les choix

| # | Question | Décision |
|---|---|---|
| A | Ce que dépose `submit_findings` ? | Comme la 007 : `project_id`, `commit_sha`, et 1 à 50 constats. Un constat : `kind` (`bug`, `security`, `architecture`, `stack` ; `upgrade` attend R6, accepté depuis la [052](052-constats-de-github-et-versions.md) K), `title` (1 à 200 caractères), `body_md` (1 à 20 000, avec le gabarit de la 007 selon le type), `severity` (`critical`, `high`, `medium`, `low`), `effort` facultatif (`small`, `medium`, `large`) et **1 à 5 sources** (`path`, `start_line`, `end_line`). Refus avec l'endroit fautif comme `submit_code_map` (`findings[2].sources[0]`), par la même `verifyCitations`, tout ou rien ; plus de 100 fichiers distincts cités, projet archivé. L'historique garde l'appel sans les textes |
| B | `list_findings` ? | Comme la 007 : `project_id`, `kind` et `status` facultatifs ; rend les constats sans leur texte complet (id, titre, type, gravité, statut, fichiers cités), pour que l'agent ne redépose pas ce qui est connu (point 5) |
| C | Le stockage ? | La table `findings` de la 007 (`source` vaut `claude` en R5 ; `github` arrive avec R6, comme `github_alert_number`) et les sources dans `code_sources`, qui gagne `finding_id` (exactement un de `criterion_id` et `finding_id` rempli, `CHECK`) |
| D | L'écran ? | S44 : une quatrième puce **« Constats · N »** dans l'onglet Conception, sur `/projets/:id/conception/constats`. Phrase d'état : « 9 constats sur v1-gestion, dont 2 failles. » et « Triés par gravité. Une faille devient un ticket en un clic. ». Filtres en puces : **Tous, Bugs, Failles, Architecture, Stack** (Versions arrive avec R6), et « Rejetés » pour retrouver un constat rejeté (007). Les constats à trancher sont **triés par gravité**, puis du plus récent au plus ancien |
| E | La couleur ? | Comme S44 et la 045 C : **le premier constat à trancher** (le plus grave) est seul en tête, sous « 1 · À corriger d'abord », en rouge, avec le bouton blanc « En faire un ticket » ; les autres sont dessous, « Les autres constats », en gris, la gravité en mot. Quand rien n'est à trancher, plus de rouge |
| F | Ouvrir un constat ? | Un clic l'ouvre dans le panneau de droite : son type, sa gravité, son effort, le texte (Markdown), et le **code cité** avec `CodeView` (la route du code de la 043 H sert aussi les sources des constats du projet), un onglet par source. En bas : **« En faire un ticket »** (le bouton blanc), **« Rejeter »** (raison facultative) et « Plus tard » |
| G | Les choix et leurs effets ? | Ceux de la 007. **En faire un ticket** : un ticket prérempli (le titre du constat, son texte et les liens GitHub permanents de ses sources), `status = ticketed` et `ticket_id` ; le ticket suit la boucle normale (Claude en écrit les US). **Rejeter** : `dismissed`, avec la raison ; visible dans le filtre « Rejetés ». **Plus tard** : `later`, reste à trancher. Claude ne trie jamais : ces actions n'existent que dans l'interface (table des droits de la 007) |
| H | « C'est un bug » (047 E) ? | Il crée maintenant aussi un **constat `bug`** (la règle, son raisonnement, ses sources, gravité `medium`), au statut `ticketed` et lié au ticket qu'il crée, pour que la liste des bugs soit complète (007) |
| I | Le rappel du choix L ? | Sur un constat d'architecture ou de stack, et sur le ticket qui en naît : quand aucun des fichiers qu'il cite n'est cité par une **règle figée** (050 F), une ligne grise « Aucune règle figée ne protège ce code : reprends d'abord la fonctionnalité qui le touche. ». Calculé à l'affichage, jamais stocké (007) |
| J | La fenêtre d'analyse ? | Elle gagne les cases **Bugs**, **Sécurité** et **Architecture et stack** (047 L). « Ouvrir Claude » prérempli `/analyser` avec les mots choisis (`bugs`, `securite`, `architecture`). Le skill fait la carte d'abord si elle manque, et chaque agent lit `list_findings` avant de déposer |
| K | Les agents ? | Trois agents de plus dans le catalogue : **`bug-hunter`** (`sonnet`), **`security-reviewer`** (`opus`) et **`architect`** (`opus`), tous déposent par `submit_findings` (point 4 : B). « Préparer pour Claude » et « Mettre à jour » (049) les écrivent |
| L | Changer le modèle d'un agent ? | **Dans l'onglet Agents du projet** (l'éditeur de la 030), qui montre désormais aussi les **agents d'analyse** (`cartographer`, `rules-analyst`, `bug-hunter`, `security-reviewer`, `architect`) dans une section « Agents d'analyse », avec leur modèle modifiable comme celui des agents de l'équipe. Pour que ce choix ne coupe pas les mises à jour : **la ligne `model:` d'un agent ne compte pas** quand Cockpit compare une copie au catalogue (049 D), et « Mettre à jour » **garde le modèle du repo** (049 F). Quelqu'un sur Max peut donc tout passer en `opus`, quelqu'un sur Pro en `sonnet`, et recevoir quand même les améliorations des agents |

## Ce que le code a précisé (tranche R5)

- **MCP** : `submit_findings` rend `{ findings: [{ id }] }` ; un refus dit l'endroit fautif, `findings[i].sources[j]`. Le type `upgrade` est refusé jusqu'à R6 (accepté depuis la 052 K). `list_findings` rend les constats sans leur texte. Les deux outils portent le total à 20.
- **Routes** : `GET /api/projects/:id/findings` (filtre `?status=`) rend les constats triés par gravité puis du plus récent au plus ancien, avec leurs sources et `unprotected` (I, calculé à l'affichage). `POST /api/findings/:id/ticket`, `/dismiss` (raison facultative) et `/later`, chacune dans un `act` après `assertActive`, le constat relu `FOR UPDATE`.
- **409 `not_open`** : un constat déjà `ticketed` ou `dismissed` ne se tranche plus. C'est un choix fait en R5 (la 007 ne le disait pas) : un constat rejeté reste seulement visible dans « Rejetés », il ne revient pas à trancher ; « Plus tard » se retranche, lui.
- **Journal** : actions `ticket_finding`, `dismiss_finding` et `later_finding`, écrites « Constat transformé en ticket », « Constat rejeté » et « Constat remis à plus tard ».
- **Base** : table `findings` et colonne `code_sources.finding_id` (migration `0026`). La route du code de la 043 (H) sert aussi les lignes citées par un constat du projet.
- **« C'est un bug » (H)** : `takeover.ts` crée le constat `bug` (`ticketed`, `ticket_id`) avec des copies des sources que la règle perd en étant retirée de son US.
- **Catalogue** : les trois agents et le skill `/analyser` (mots `bugs`, `securite`, `architecture`) ; « Préparer pour Claude » écrit 12 fichiers, `catalogStates` rend 11 états (sans le `CLAUDE.md` de départ).
- **La ligne `model:` (L)** : ignorée à la comparaison (`catalog-update.ts`), avec chaque ligne de modèle qu'une version passée a pu avoir (`history.json` ne connaît que les textes du catalogue) ; gardée par « Mettre à jour », par l'aperçu du plan et par « Préparer pour Claude » sur les fichiers `update`. `npm run catalog:history` liste désormais les versions **de la plus ancienne à la plus récente** : la dernière est la version courante, et la relancer ne change rien.
- **Onglet Agents** : la section « Agents d'analyse » (L) liste `cartographer`, `rules-analyst`, `bug-hunter`, `security-reviewer` et `architect`, avec l'éditeur de la 030.
- **Différences avec S44** : les filtres ont leur propre rangée ; « En faire un ticket » est dans la première carte et dans le panneau, pas sur chaque ligne des autres constats. La puce « Versions » et les lignes GitHub sont venues avec R6 ([052](052-constats-de-github-et-versions.md)).

## Ce qui est repoussé

- **Les constats venus de GitHub** (Dependabot, code scanning, secret scanning), la fin de vie des runtimes et la puce « Versions » : R6 (fait, [052](052-constats-de-github-et-versions.md)).
- **Un réglage global des modèles** (un profil « Pro » ou « Max » qui choisit pour tous les projets d'un coup) : on change le modèle projet par projet (L) ; un profil viendra si le besoin se montre.
- **Les doublons** entre deux analyses (point 5 de la 007) : `list_findings` les évite sans le garantir.

## Limites connues

- **Un constat reste un avis** (007) : il ne fait rien tout seul, l'humain le trie.
- **On vérifie ce qui est cité, pas ce qui manque** : une faille oubliée ne se voit pas.
- **Le rappel L est grossier** : il compare des fichiers, pas des lignes ; un fichier en partie couvert compte comme protégé.
