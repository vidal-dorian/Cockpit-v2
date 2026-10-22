# 005 — Lancement local

- **Statut** : validée
- **Date** : 2026-10-21
- **Décidé par** : Dorian, avec Claude
- **Dépend de** : [002 — Modèle de données](002-modele-donnees.md), [003 — Interface](003-interface.md), [004 — Outils MCP](004-outils-mcp.md)

## Contexte

Le bouton « Développer avec Claude » doit ouvrir, **sur le PC du développeur**, une session Claude Code dans le clone du repo, avec `/dev-us` prêt à partir (brief §6.5). Cockpit tourne sur un serveur (le Pi, puis un hébergeur : 008) et ne voit pas ce PC : il ne peut que donner au navigateur un lien qui ouvre Claude Desktop.

## Ce que permet le lien (octobre 2026)

D'après l'[article officiel](https://support.claude.com/en/articles/14729294-open-claude-desktop-with-a-link) :

```
claude://code/new?folder=<chemin absolu encodé>&q=<message encodé>
```

| Paramètre | Effet |
|---|---|
| `folder` | Dossier de travail de la session. Desktop demande de le **confirmer à chaque fois**, même s'il a déjà été approuvé. Seule la première valeur compte |
| `q` | Message prérempli, tronqué vers **14 000 caractères**. Il n'est **pas envoyé** : l'humain appuie sur Entrée |

Le lien fonctionne sur Windows, macOS et Linux. Il ne permet de choisir **ni le modèle, ni le mode de permission**, et il ne peut pas envoyer le message. Les valeurs sont encodées pour une URL (`encodeURIComponent`).

Le brief (§8) décrivait le lien `claude-cli://` de la v1 (terminal, 5 000 caractères, repo déjà ouvert une fois) : il est remplacé par celui-ci.

## Les choix

| # | Question | Décision |
|---|---|---|
| A | Qui choisit le modèle ? | **La fiche de chaque agent** (`model:` dans test-writer, developer, reviewer), installée par Cockpit dans le repo. La session principale, qui ne fait que coordonner, garde le modèle choisi dans Desktop |
| B | Qui choisit le mode de permission ? | **L'humain, dans Desktop.** La fenêtre de Cockpit rappelle seulement le mode conseillé : « Accepter les modifications » |
| C | Où Cockpit retient le chemin du clone ? | **Dans le navigateur** (`localStorage`), par projet : chaque PC garde son propre chemin |
| D | Qui crée la branche ? | **`/dev-us`**, sur le PC, puis il la pousse. Cockpit ne fait que **proposer le nom** |

### A. Le modèle dans la fiche des agents

- Un agent peut fixer son modèle dans son en-tête (`model: opus`, `sonnet`, `haiku`, un identifiant complet, ou `inherit` pour reprendre celui de la session) ([documentation des sous-agents](https://code.claude.com/docs/en/sub-agents)).
- Le modèle est fixé une fois, là où il compte, et il est visible et relu dans le repo. Le brief prévoit déjà de le modifier depuis Cockpit avec l'éditeur d'agent (§6.9, après le MVP).
- Les fiches du catalogue (6.2) partent de : test-writer et developer en `sonnet`, reviewer en `opus`. Ce réglage de départ se change en modifiant la fiche.
- **Écartés** : le choisir à chaque lancement dans Desktop (à refaire à chaque fois) ; le fixer dans `.claude/settings.json` (vaut pour toutes les sessions du repo, et hors périmètre selon le brief §9).

### B. Le mode de permission dans Desktop

- C'est une décision de sécurité sur le PC du développeur : elle lui revient.
- **Écartés** : `.claude/settings.json` (hors périmètre, et les modes `auto` et `bypassPermissions` y sont ignorés, voir [réglages](https://code.claude.com/docs/en/settings)) ; `permissionMode` dans la fiche des agents (ignoré dès que la session principale est en `acceptEdits` ou en `auto`, donc trompeur).
- **Limite** : Cockpit ne sait pas dans quel mode a tourné un run.

### C. Le chemin du clone dans le navigateur

- Clé `localStorage` par projet. Le champ est vide la première fois, avec un exemple ; une fois saisi, il est prérempli et reste modifiable.
- Avec deux PC, chacun garde son chemin. Une base par utilisateur n'en retiendrait qu'un, faux sur l'autre PC.
- Si le repo n'est pas encore cloné, la fenêtre montre la commande `git clone` à copier.
- `/dev-us` vérifie de toute façon qu'il est dans le bon repo avant de commencer (brief §6.6, étape 1).
- **Limite** : un autre navigateur, ou des données de navigation effacées, et le chemin est redemandé une fois. L'accès au `localStorage` est protégé : s'il échoue, le champ est simplement vide.

### D. La branche créée par `/dev-us`

- Le principe n° 3 du brief veut que Cockpit n'écrive dans un repo **que de la configuration**. Une branche n'en est pas.
- Pas de branche orpheline sur GitHub si l'humain n'appuie jamais sur Entrée.
- **Convention** : `us/<id>-<titre-court>`, par exemple `us/42-connexion-github`. Le titre court vient du « je veux » de l'US : minuscules, sans accents, mots séparés par des tirets, 40 caractères au plus.
- **Écarté** : Cockpit crée la branche sur GitHub au lancement (prévu dans le découpage avant cette décision).

## Le déroulé

1. **Fenêtre « Développer avec Claude »** (sur une US `ready`) :
   - **Branche** : si l'US en a déjà une (relance), elle est reprise, sans choix. Sinon : nouvelle branche au nom proposé (modifiable), ou branche existante choisie dans la liste lue sur GitHub.
   - **Dossier du clone** : prérempli depuis le navigateur.
   - **Prompt complémentaire** facultatif.
   - **Rappels** : dépendances non terminées (sans bloquer), mode conseillé.
   - **Ce qui va se passer** : « Claude Desktop va s'ouvrir. Confirme le dossier, puis appuie sur Entrée. »
2. **« Lancer Claude »** ouvre le lien. Le bouton **« Copier le prompt »** reste visible à côté : le navigateur ne peut pas savoir si Desktop s'est ouvert.
3. **Le message prérempli** :
   ```
   /dev-us 42 --branch us/42-connexion-github

   <prompt complémentaire, s'il y en a un>
   ```
4. **`/dev-us`**, dans la session :
   1. Vérifie le dossier : c'est bien le repo du projet, l'arbre de travail est propre.
   2. Met à jour la branche par défaut.
   3. Crée la branche à partir d'elle et la pousse, ou passe sur la branche existante et la met à jour.
   4. Appelle `start_run` (004) avec la branche, le modèle de la session et le prompt complémentaire. Si une vérification échoue, il s'arrête et dit pourquoi, **avant** de démarrer le run.

## Conséquences

- **Modèle de données (002)** : la colonne `runs.model_requested` est retirée. `model_actual` reste, déclaré par `start_run`. Le chemin du clone n'est pas en base.
- **Outils MCP (004)** : le point ouvert sur le modèle demandé est réglé.
- **Découpage, tranche 7.2** : la fenêtre ne crée plus la branche sur GitHub, et le chemin du clone est retenu par le navigateur.
- **Catalogue (6.2)** : les fiches d'agents portent leur `model:`. `/dev-us` accepte `--branch` et crée ou reprend la branche.
- **Brief** : la fenêtre de lancement décrite au §6.5 (cible, modèle, mode, plafond de budget) est réduite pour le MVP à la branche, au dossier et au prompt complémentaire. La cible cloud et le budget viendront après le MVP.

## À vérifier en tranche 7.2

- Sur le PC de Dorian, que `folder` est bien appliqué : un signalement d'avril 2026 disait qu'il était parfois ignoré ([anthropics/claude-code#54614](https://github.com/anthropics/claude-code/issues/54614)). La vérification du dossier par `/dev-us` limite le risque.
- Qu'un chemin Windows (`C:\…`) encodé passe tel quel.
