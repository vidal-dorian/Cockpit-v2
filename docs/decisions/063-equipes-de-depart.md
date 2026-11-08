# 063 — Les équipes de départ

- **Statut** : proposée (à valider à la relecture de la PR)
- **Date** : 2026-11-08
- **Décidé par** : Dorian, avec Claude
- **Dépend de** : [011 — Importer un projet](011-import-projets.md), [027 — Préparer pour Claude](027-preparer-pour-claude.md), [029 — L'équipe d'agents](029-equipe-d-agents.md), [030 — L'éditeur d'agent](030-editeur-d-agent.md), [032 — Plusieurs équipes](032-plusieurs-equipes.md), [042 — « Nouvelle équipe » dans une fenêtre](042-nouvelle-equipe-fenetre.md), [049 — La mise à jour du catalogue](049-mise-a-jour-du-catalogue.md), [051 — Les constats de Claude](051-constats-de-claude.md) (L : le modèle d'un agent reste le choix de l'utilisateur)
- **Tranche** : 11.6 du [découpage](../decoupage.md) (« E5, profils d'équipe »)

## Contexte

Le découpage prévoyait des équipes de départ selon l'abonnement Claude (E5), « à redéfinir avec Dorian ». Le 2026-11-08, Dorian l'a redéfini : d'autres IA que Claude pourront un jour être branchées (ChatGPT, par exemple), donc **les équipes de départ ne sont pas classées par abonnement**. Ce sont **quatre niveaux**, que l'utilisateur choisit lui-même selon ce que son forfait lui permet : **Éco**, **Standard**, **Premium** et **Max**. Il choisit **à l'import** du projet, et l'équipe reste modifiable ensuite comme n'importe quelle équipe (029, 030, 032).

## Les choix

| # | Question | Décision |
|---|---|---|
| A | Les quatre équipes ? | Elles changent **d'agents et de modèles** (modèles Claude d'aujourd'hui). **Éco** : `test-writer` (`haiku`), `developer` (`sonnet`), sans relecture. **Standard** : `test-writer`, `developer`, `reviewer`, tous en `sonnet` ; c'est l'équipe d'aujourd'hui (029 C). **Premium** : la Standard avec le `reviewer` en `opus`, puis `doc-writer` et `doc-reviewer` (`sonnet`). **Max** : `test-writer`, `developer`, `reviewer`, `security-reviewer`, `doc-writer`, `doc-reviewer`, tous en `opus`. Les boucles sont celles de `CLAUDE.md` : les remarques bloquantes du reviewer (et du security-reviewer) reviennent au developer jusqu'au verdict « prêt » ; celles du doc-reviewer reviennent au doc-writer |
| B | Où vivent-elles ? | Dans le catalogue (027), un fichier par niveau : `catalog/teams/eco.md`, `standard.md`, `premium.md`, `max.md`, au format de `team.md` (029 B), plus le modèle de chaque agent. Les noms affichés : « Éco », « Standard », « Premium », « Max », chacun avec une phrase : « Le moins cher : pas de relecture. », « L'équipe de base, relue. », « Une relecture plus forte, et la doc tenue à jour. », « Tout au plus puissant, avec une relecture de sécurité. » |
| C | Les agents qui manquent ? | Le catalogue gagne `doc-writer` et `doc-reviewer` (repris de ceux de ce dépôt, `.claude/agents/`, rendus génériques : rien de propre à Cockpit). Le `security-reviewer` du catalogue (051 K) gagne un **mode « étape »** : lancé par `/dev-us` comme étape d'une équipe, il relit le diff de l'US pour la sécurité et rend un verdict comme le reviewer, au lieu de déposer des constats. Le skill `/dev-us` le dit. `catalog/history.json` est régénéré (049) |
| D | Le choix à l'import ? | L'écran d'import (011, S11) demande **« Quelle équipe pour ce projet ? »**, avec les quatre niveaux et leur phrase ; **Standard** est choisi par défaut. Le choix est gardé sur le projet (`projects.starter_team` : `eco`, `standard`, `premium`, `max`, `CHECK`, `standard` par défaut, aussi pour les projets déjà importés). L'import n'écrit toujours rien dans le repo |
| E | Quand l'équipe est-elle écrite ? | Par **« Préparer pour Claude »** (027) : en plus de ce qu'il écrit déjà, il écrit les agents de l'équipe choisie (avec le modèle du niveau) et `.claude/team.md`. Le plan les montre comme les autres fichiers, avant le commit. Un fichier qui existe déjà et qu'on a modifié à la main n'est pas écrasé (027, 049) : le modèle d'un agent déjà présent reste celui du repo (051 L). Un `team.md` déjà là est gardé tel quel |
| F | Un projet déjà préparé ? | L'onglet Agents (030, 031) propose **« Repartir d'une équipe de départ »** : on choisit un niveau, Cockpit charge son équipe et ses agents dans le brouillon de l'éditeur (031) ; rien n'est écrit avant « Enregistrer », qui montre le diff puis fait **un commit** (029 F, 026). Les agents absents du repo sont ajoutés depuis le catalogue avec le modèle du niveau ; ceux qui existent prennent le modèle du niveau. Le niveau choisi devient le `starter_team` du projet |
| G | Et les autres IA ? | Rien n'est construit pour elles maintenant. Une équipe de départ dit les rôles et un niveau ; seuls les modèles sont propres à Claude. Brancher une autre IA demandera de lui donner ses propres modèles par niveau |
| H | L'historique ? | Le choix à l'import est dans l'entrée de l'import existante (`args` gagne `starterTeam`, une valeur fermée, 010 D). « Repartir d'une équipe de départ » écrit `save_team` comme tout enregistrement d'équipe (032 G), avec `args` qui gagne `starterTeam` |

## Ce qui est repoussé

- **Les modèles d'une autre IA** que Claude, et le choix de l'IA d'un projet.
- **Changer le niveau de tous les projets d'un coup.**
- **Une équipe de départ pour la reprise** (les agents d'analyse de 051 gardent leur propre modèle, modifiable dans l'onglet Agents).

## Limites connues

- **Le coût réel d'un niveau dépend de l'abonnement** de l'utilisateur : Cockpit ne le connaît pas et ne le vérifie pas. C'est à l'utilisateur de choisir ce que son forfait permet.
- **Un niveau n'est qu'un point de départ** : après une modification de l'équipe, le `starter_team` du projet dit seulement d'où elle est partie.
