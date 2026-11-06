# 034 — La fenêtre « Développer avec Claude »

- **Statut** : validée
- **Date** : 2026-11-05
- **Décidé par** : Dorian, avec Claude
- **Dépend de** : [005 — Lancement local](005-lancement-local.md) (le lien, le déroulé, A à D), [003 — Interface](003-interface.md), [032 — Plusieurs équipes](032-plusieurs-equipes.md) (« repoussé » : choisir l'équipe dans la fenêtre), [033 — Le run minimal](033-run-minimal.md) (B : le nom de branche, la consigne)
- **Tranche** : 7.2 du [découpage](../decoupage.md)

## Contexte

La 005 a fixé le lien `claude://code/new?folder=…&q=…`, le chemin du clone retenu par le navigateur, la branche créée par `/dev-us`, et le contenu de la fenêtre. Démo : un clic dans Cockpit, et Desktop s'ouvre dans le bon dossier avec le prompt prêt. Il reste à dire où est la fenêtre, d'où vient la liste des branches, comment on choisit l'équipe et ce que le serveur ajoute.

## Les choix

| # | Question | Décision |
|---|---|---|
| A | Où ? | Un bouton **« Développer avec Claude »** sur la page de l'US (`/us/:id`), seulement pour une US `ready` d'un projet actif. Il ouvre un **panneau en haut de la page** (003 : « au-dessus de la page de l'US »), pas une fenêtre modale ; le focus va à son titre ; « Annuler » le ferme |
| B | La branche ? | Si l'US a déjà une `branch` (une relance, 033 F) : elle est reprise, affichée sans choix. Sinon, **« Nouvelle branche »**, au nom proposé par la convention de la 005 D et modifiable, vérifié dans le navigateur par la règle de la 033 B ; ou **« Branche existante »**, choisie dans la liste lue sur GitHub (C). Si la liste ne se lit pas, ce choix est désactivé avec la raison |
| C | La liste des branches ? | **`GET /api/projects/:id/branches`** → `{ branches: [nom, …] }`, lue comme l'App, par ordre alphabétique de GitHub ; 404 pour un non-membre, 502 si GitHub échoue. Une lecture : rien dans l'historique |
| D | L'équipe ? | Si le projet a des équipes nommées (la route des agents, 032 D), une liste **« Équipe »** : « Par défaut » puis chaque nom ; une équipe nommée ajoute `--team <nom>`. Sans équipe nommée, la liste n'apparaît pas |
| E | Le dossier du clone ? | Comme la 005 C : clé `localStorage` `cockpit.clone.<id du projet>`, lue et écrite sous `try`. Champ obligatoire, avec un exemple (`C:\Users\dorian\code\mon-repo` ou `/home/dorian/code/mon-repo`). Le chemin est retenu au lancement. Une ligne repliée « Pas encore cloné ? » montre `git clone https://github.com/<full_name>.git` |
| F | Le prompt complémentaire ? | Facultatif, au plus **10 000 caractères** : la limite de `comment` de `start_run` (033 B), qui garde le message sous les 14 000 du lien (005) |
| G | Les rappels ? | Les dépendances qui ne sont pas `done`, chacune avec son statut, sans bloquer ; le mode conseillé, « Accepter les modifications » (005 B) ; puis « Claude Desktop va s'ouvrir. Confirme le dossier, puis appuie sur Entrée. » |
| H | Le lancement ? | Le message de la 005 : `/dev-us <id> --branch <branche>`, puis ` --team <nom>` s'il y a lieu, puis une ligne vide et le prompt complémentaire s'il y en a un. **« Lancer Claude »** est un lien vers `claude://code/new?folder=…&q=…` (valeurs encodées par `encodeURIComponent`) ; **« Copier le prompt »**, à côté, copie le message et affiche « Copié » |
| I | Le skill ? | `/dev-us` du catalogue passe le prompt complémentaire à `start_run` en `comment`, comme le dit le déroulé de la 005 |

## Ce qui est repoussé

- **Le modèle, le mode, la cible cloud, le budget** (005).
- **Plus de 100 branches** : seule la première page de GitHub est lue.

## Limites connues

- **Le paramètre `folder`** est parfois ignoré par Desktop ([anthropics/claude-code#54614](https://github.com/anthropics/claude-code/issues/54614)) : `/dev-us` vérifie le dossier de toute façon. À essayer sur le PC de Dorian, avec un chemin Windows (005, « à vérifier »).
- **Le navigateur ne sait pas si Desktop s'est ouvert** : « Copier le prompt » reste toujours visible (005).
- **Un repo préparé avant cette tranche** garde son ancien `/dev-us`, qui n'envoie pas la consigne en `comment` (027, « repoussé »).
