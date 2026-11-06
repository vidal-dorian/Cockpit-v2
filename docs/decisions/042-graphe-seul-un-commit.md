# 042 — Tout depuis le graphe, un seul commit

- **Statut** : proposée (à valider à la relecture des PR)
- **Date** : 2026-11-06
- **Décidé par** : Dorian, avec Claude
- **Dépend de** : [030 — L'éditeur d'agents](030-editeur-d-agent.md), [031 — L'équipe en graphe](031-equipe-en-graphe.md), [032 — Plusieurs équipes par projet](032-plusieurs-equipes.md), [041 — « Nouvelle équipe » dans une fenêtre](041-nouvelle-equipe-fenetre.md)
- **Modifie** : la 031 C (condition demandée tout de suite), D (« Modifier » dans la liste), E (« Ajouter une étape »), F (la liste des étapes) et H (un commit par équipe) ; la 030 (un commit par agent) ; la 041 A (« Créer l'équipe » fait le commit)
- **Répond à** : le ticket « Graphe de modification des agents » : « je ne le trouve pas assez simple d'utilisation ; il faut supprimer la partie où on monte et descend les agents, tout doit se faire depuis le graphe ; pourquoi doit-on donner une action pour la création d'une boucle ? ; il faut commit une seule fois quand on veut quitter la page des agents plutôt que commit chaque truc un par un »

## Contexte

La condition d'une boucle (`until`) n'est pas utilisée par Cockpit ni par le commit : elle est écrite dans `team.md` et **lue par Claude pendant `/dev-us`** pour savoir quand sortir de la boucle (« reviewer renvoie au developer jusqu'à ce que le verdict soit *ready* »). Elle reste donc utile, mais n'a pas à bloquer le geste.

La liste « Monter / Descendre » existait pour le clavier et le téléphone (031 F), où le graphe était masqué. Et chaque agent, chaque équipe partait dans son propre commit, avec son propre bouton.

## Les choix

| # | Question | Décision |
|---|---|---|
| A | La liste des étapes ? | **Supprimée.** Tout se fait sur le graphe, affiché aussi en largeur téléphone (zoom, glisser le fond). Au clavier, chaque carte est focusable : **Alt+← / Alt+→** la déplace d'un cran, **Entrée** ouvre son panneau, **Suppr** la retire. Un texte d'aide sous le graphe le dit. Une région `aria-live` annonce le nouvel ordre après un déplacement |
| B | La condition d'une boucle ? | Tirer une boucle la crée **tout de suite**, avec la condition par défaut « l'étape <C> valide le travail » (C étant l'étape vers laquelle on boucle). Elle se modifie dans le panneau de la carte. Une condition vidée bloque l'enregistrement, comme avant |
| C | Ajouter un agent à l'équipe ? | Depuis la colonne de droite : chaque agent du repo qui n'est pas dans l'équipe a un bouton **« Ajouter à l'équipe »**, et peut être **glissé sur le graphe**. Il se met en dernier. « Ajouter une étape » sous le graphe disparaît |
| D | Enregistrer ? | **Un seul commit** pour tout l'onglet : les agents créés, modifiés ou supprimés, l'équipe affichée et les équipes créées ou supprimées s'accumulent en brouillon. Une barre en bas de l'onglet dit « N changements », avec « Voir les changements » (le diff de chaque fichier) et **« Enregistrer »** (un commit, ou une pull request si la branche est protégée). Les boutons « Faire le commit » de l'équipe et des agents disparaissent ; « Créer l'équipe » (041) et le formulaire d'agent ajoutent au brouillon |
| E | Quitter avec des changements ? | Changer de page dans Cockpit demande **« Enregistrer, abandonner ou rester ? »** ; fermer ou recharger l'onglet du navigateur affiche son avertissement standard (un navigateur ne laisse pas faire un commit à la fermeture). Pour pouvoir bloquer une navigation, l'app passe de `BrowserRouter` à un routeur « data » (`createBrowserRouter`), le seul où react-router fournit `useBlocker` |
| F | Le serveur ? | Une route `POST /api/projects/:id/repo-files/apply` reçoit la liste des changements `{ path, before, after }`, chacun validé comme aujourd'hui (un agent : `.claude/agents/<nom>.md` ; une équipe : `.claude/team.md` ou `.claude/teams/<nom>.md`, au format lisible) et les écrit en **un commit** avec `applyRepoChanges` (030 E : `repo_changed` si un fichier a bougé, rien n'est écrit). L'historique garde **une entrée** `save_agent_files` avec la liste des chemins |

## Découpage

1. **Le graphe** (A, B, C) : une première PR, qui garde l'enregistrement d'aujourd'hui.
2. **Un seul commit** (D, E, F) : une seconde PR.

## Ce qui est repoussé

- **Annuler / rétablir** dans le brouillon.
- **Garder le brouillon après un rechargement** de la page.

## Limites connues

- Un brouillon non enregistré est perdu si l'onglet du navigateur est fermé malgré l'avertissement.
- Le glisser-déposer d'un agent sur le graphe n'existe qu'à la souris ; au clavier et au doigt, « Ajouter à l'équipe » fait la même chose.
