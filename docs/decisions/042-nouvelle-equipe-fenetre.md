# 042 — « Nouvelle équipe » dans une fenêtre

- **Statut** : validée
- **Date** : 2026-11-06
- **Décidé par** : Dorian, avec Claude
- **Dépend de** : [031 — L'équipe en graphe](031-equipe-en-graphe.md), [032 — Plusieurs équipes par projet](032-plusieurs-equipes.md)
- **Modifiée par** : [045](045-interface-quatre-temps.md) : « Nouvelle équipe » s'ouvre en plein écran sur un canevas (A)
- **Modifie** : la 032 E (la création en ligne de « Nouvelle équipe »)
- **Répond à** : « Nouvelle équipe » doit ouvrir une fenêtre où l'on configure la nouvelle équipe, pour que personne ne modifie l'équipe affichée en croyant configurer la nouvelle ; et l'onglet Agents met l'équipe (le graphe) à gauche et la liste des agents du repo à droite.

## Contexte

Avec la 032 E, « Nouvelle équipe » sélectionnait la nouvelle équipe dans la même page, avec une copie des étapes : on croyait configurer la nouvelle équipe alors que l'écran avait l'air de l'ancienne. Et l'onglet empilait l'équipe puis les agents, ce qui laisse beaucoup de vide à côté du graphe.

## Les choix

| # | Question | Décision |
|---|---|---|
| A | La fenêtre de création ? | « Nouvelle équipe » ouvre une fenêtre modale (`<dialog>`) titrée « Nouvelle équipe » : le champ « Nom de l'équipe » (mêmes règles et messages que la 032 A), puis le même éditeur d'étapes que la page (graphe, liste, panneau, « Ajouter une étape »), « Créer l'équipe » et « Annuler ». Les étapes partent de l'équipe affichée **telle que lue dans le repo**, pas du brouillon non enregistré, qui reste intact derrière la fenêtre. « Créer l'équipe » envoie `{ name, before: null, after }` (un commit, 032 F) ; elle est désactivée sans nom valide et libre, sans étape, ou avec une boucle sans condition. Réussi : la fenêtre se ferme, la nouvelle équipe est affichée avec « C'est fait » et le lien ; échoué : l'erreur est dans la fenêtre. « Annuler » et Échap ferment sans rien envoyer ni garder |
| B | La mise en page de l'onglet ? | Deux colonnes à partir de `lg` : l'équipe et son graphe à gauche (deux tiers), les agents du repo à droite ; empilés en dessous, équipe d'abord. Pendant l'édition d'un agent (l'équipe s'efface, 031 A), les agents prennent toute la largeur |
| C | « Modifier l'agent » dans la fenêtre ? | Absent : le formulaire d'agent s'ouvrirait derrière la fenêtre modale |

## Ce qui est repoussé

- **Choisir un point de départ** autre que l'équipe affichée (l'équipe par défaut, une autre équipe).
- **Modifier un agent depuis la fenêtre** : le créer ou le modifier avant, dans la liste des agents.

## Limites connues

- Fermer la fenêtre pendant l'envoi n'annule pas le commit : la nouvelle équipe apparaît à la relecture.
