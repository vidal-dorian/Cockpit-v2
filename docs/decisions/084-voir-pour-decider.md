# 084 — Voir pour décider : la preuve à côté du geste, la suite après l'action

- **Statut** : proposée (à valider à la relecture de la PR) ; le code est construit
- **Date** : 2026-11-19
- **Décidé par** : Dorian (« je dois cliquer sur Ouvrir l'US pour voir l'US, alors qu'on pourrait la voir directement pour la valider ; cherche ces améliorations dans tout le projet », puis « lance-les toutes, dans le sens que tu veux »), avec Claude
- **Dépend de** : [069 — Les finitions](069-finitions.md) (G, H), [073 — L'ergonomie](073-ergonomie.md), [081 — Les retours d'action](081-retours-d-action.md)
- **Modifie** : 069 H, 040 B et « Ce qui est repoussé », 073 C et E, 055 G, 014 G, 045 F, 071 E, 074 B8 et B9, 031 E (léger), 054 D, 022 D (voir chaque ligne)
- **Écrans** : tous ; les maquettes ne sont pas retouchées (069 I : la décision l'emporte)

## Contexte

Un audit de tous les écrans (77 constats vérifiés dans le code) trouve cinq défauts qui reviennent :

1. **Décider sans voir** : un écran demande « Valider », « Merger », « Supprimer » ou « Mettre à jour », et ce qu'il faut lire pour décider est sur une autre page (le panneau d'une US au Kanban, à l'accueil, dans un ticket, sur /nuit).
2. **Pas de suite après une action** : après une décision, le panneau reste sur le même objet ou se ferme, sans proposer le suivant.
3. **Des objets cités en texte simple** : « US 42 », « Run 17 », « PR #8 » sans lien.
4. **Le message dit où corriger, sans y mener** : refus, lignes rouges de la Santé, états vides.
5. **Des phrases d'appel inertes** : « Claude t'attend sur l'US 42 » n'ouvre rien.

## Les choix

Règles générales, valables pour tout écran à venir :

| # | Règle | Décision |
|---|---|---|
| A | La preuve à côté du geste | Un panneau qui demande une décision montre ce qu'il faut lire pour la prendre. Pour une US : son récit, le commentaire de renvoi s'il y en a un et ses critères Étant donné / Quand / Alors (`StoryBody`, sorti de la page de l'US, un seul composant partout). Pour une US en revue : sa PR, sa CI et le verdict (`StoryGitHub`, `StoryVerdict`). Pour une question de Claude : la question et le formulaire de réponse. La page de l'US reste, pour l'historique et l'édition |
| B | La suite après l'action | Après une décision réussie dans une file (US à valider, constats, règles), le panneau ouvre l'élément suivant de la même file ; à la fin, il se ferme et le dit. Le compteur « 1 sur 2 » et `J` / `K` (le `counter` de `Panel`, 073) sont repris |
| C | Un objet nommé est un lien | Une US, un run, une PR, un ticket ou un projet cité par son numéro ou son nom mène à sa page (ou à son panneau quand l'écran en a un) |
| D | Un refus mène à sa correction | Un refus, une ligne rouge ou un état vide qui nomme la page où corriger porte le lien vers elle |
| E | Une phrase d'appel est un lien | Une phrase qui annonce ce qui attend (« Claude t'attend sur l'US 42 », « 2 user stories t'attendent ») mène à la première chose à faire |
| F | Ce qui est ouvert vit dans l'adresse | Comme `?us=` au Kanban (069 G) : le ticket ouvert, la puce, l'étiquette et la recherche de l'onglet Tickets sont gardés dans l'adresse |

Ce que ces règles changent dans les décisions existantes :

| # | Écran | Avant | Maintenant |
|---|---|---|---|
| G | Kanban, panneau d'une carte | **069 H** : « rien de neuf, les panneaux existants » (les seules décisions, et le lien « Ouvrir l'US ») | Le panneau montre l'US (A) : à valider ou à réécrire, son récit et ses critères ; en revue, la PR, la CI et le verdict ; une question en attente, la question et sa réponse ; le badge « Issue modifiée » expliqué ; le lien vers le ticket ; les règles à trancher en liens. Valider, Renvoyer ou Abandonner ouvre l'US suivante de la colonne (B). « Ouvrir l'US » reste |
| H | Kanban au téléphone | **045 F** : sous `lg`, le panneau suit le contenu | Il suit toujours le contenu, mais l'ouverture d'une carte y amène le focus et la vue (comme 071 E l'a fait pour l'accueil) |
| I | Accueil, une US à valider | **040 B** et « Ce qui est repoussé » : la ligne mène à la page de l'US | La ligne ouvre le panneau de droite avec l'US et ses décisions (A), puis la suivante (B). **073 E** est étendu : `V` valide aussi dans ce panneau |
| J | Panneau d'un ticket | **055 G** : il liste ses US, avec leur statut seulement | Une US de la liste s'ouvre dans le panneau, avec « ← Ticket » pour revenir |
| K | Supprimer un ticket | **014 G** : « puis revient au projet » | Revient à l'onglet Tickets du projet (055 F en a fait un onglet) |
| L | Page d'un run, téléphone | **071 E** : la question reste dans son panneau, sous le contenu | Sous `lg`, la question en attente vient juste après la phrase d'état ; rien ne change au-dessus de `lg` |
| M | Recherche | **073 C** : les actions sont filtrées par les mots tapés | Une recherche sans résultat propose « Noter « texte » », qui ouvre la barre d'idée avec ce texte. Sur téléphone, un bouton « Chercher » en haut de page ouvre la recherche (lève la limite connue de 071, sans 5ᵉ onglet : 071 B reste) |
| N | Équipes d'agents | **074 B8 et B9** : ajouter ou mettre à jour en un clic | Le clic montre d'abord ce qui change (agents ajoutés, diff de la copie du repo), puis confirme |
| O | Étape « Agent absent du repo » | **031 E** : on ajoute l'agent par l'onglet Agents | Un bouton « Ajouter l'agent du catalogue » ouvre le formulaire de 030 D, prérempli |
| P | Lancer dans le cloud | **054 D** : la case n'est que dans les réglages globaux | Elle est aussi dans les réglages du projet (la même valeur) |
| Q | Écriture des US | **022 D** : réglée projet par projet | Réglages › Tâches cloud liste la fréquence de chaque projet, avec un lien vers ses réglages |

## Ce que le code a précisé

Panneau d'une carte du Kanban (G, H, A, C, E ; premier morceau construit) :

- **`StoryBody`** : le récit, le commentaire de renvoi (US à réécrire) et les critères sont sortis de `StoryPage.tsx` dans `src/web/StoryBody.tsx`, partagé par la page de l'US et le panneau. Le panneau le montre pour une US à valider, à réécrire ou prête ; en revue il montre `StoryGitHub` (lien « PR #n ») et `StoryVerdict` du dernier run.
- **Question en attente** : le panneau lit le run en cours de l'US et montre sa première question sans réponse, son contexte et `AnswerForm` (réponses suggérées comprises) ; la réponse invalide `["stories"]` et `["story"]`.
- **`blockedBy`** : `GET /api/projects/:id/stories` rend l'id de la première dépendance (par id croissant) dont le statut n'est pas `done`, sinon `null`. La carte ne dit « dépend de l'US n » que si l'US est prête.
- **Liens** : le titre du ticket mène à `/tickets/:id` ; « Issue modifiée sur GitHub » porte « Choisir la version » vers `/us/:id` ; chaque règle à trancher mène à `/projets/:id/conception/regles?regle=<id>` ; dans la phrase d'état, « l'US n » et « n user stories t'attendent » mènent à `?us=` de la première US concernée.
- **Compte de la phrase d'état** : une US à réécrire n'est plus comptée comme attendant l'utilisateur (comme à l'accueil) ; seules « à valider » et « en revue » le sont.
- **Focus** : à l'ouverture d'une carte, le focus va sur la ligne « US n » du panneau, qui est amenée dans la vue (`scrollIntoView`), à toute largeur.
- **Pas encore fait** : « Valider, Renvoyer ou Abandonner ouvre l'US suivante » (B, ligne G) n'est pas dans ce morceau.

## Limites connues

- **Un panneau plus long** : le récit et les critères d'une US défilent dans un panneau de 380 px ; c'est le prix d'un aller-retour en moins par US.
- **`V` sur l'accueil** valide l'US affichée dans le panneau : le risque de valider par réflexe est celui que la 073 acceptait déjà au Kanban.
