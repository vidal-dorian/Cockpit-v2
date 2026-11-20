# 085 — Voir pour décider : la preuve à côté du geste, la suite après l'action

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
| M | Recherche | **073 C** : les actions sont filtrées par les mots tapés | Une recherche propose, après ses résultats, « Noter « texte » », qui ouvre la barre d'idée avec ce texte. Sur téléphone, la recherche passe par la ligne « Chercher » de l'onglet « Menu » de la [084](084-le-telephone-deuxieme-passe.md) B, construite en parallèle : le bouton « Chercher » d'abord prévu ici faisait doublon et a été retiré à la fusion |
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
- **La suite** : voir la section suivante (S02).
La suite après l'action (B, G ; deuxième morceau construit, S02) :

- **Kanban** : la file est la colonne de l'US ouverte (« À valider » seule, les autres colonnes ne comptent pas). Le panneau reçoit son `counter` (« i sur n », `J` / `K`) et `StoryDecisions` appelle `onDone` après Valider, Renvoyer ou Abandonner réussis (pas après Modifier, qui reste sur l'US). `onDone` ouvre l'US suivante (`?us=`), ou ferme le panneau et retire `?us=` de l'adresse à la dernière. L'US suivante est lue (`prefetchQuery`) avant que l'adresse change : le panneau ne passe jamais par un état vide. Si l'utilisateur est passé à une autre US entre-temps, celle-ci n'est pas sautée.
- **Panneau gardé monté** : `StoryDecisions` n'est plus remonté d'une US à l'autre (plus de `key`) ; son état (mode, commentaire, brouillon, erreur) repart de zéro quand `story.id` change.
- **Focus** : à la fermeture, le focus retourne sur la carte une fois le tableau redessiné ; si la carte a changé de colonne, il la suit dans sa nouvelle colonne ; si elle a disparu (abandonnée), il va sur la région défilante du tableau.
- **Constats** : la file est la liste affichée. « En faire un ticket », « Rejeter » et « Plus tard » ouvrent le constat suivant, ou ferment le panneau au dernier (« Plus tard » ne laisse donc plus le panneau sur le même constat). Le compteur et `J` / `K` sont absents dans le filtre « Rejetés » : ces constats sont lus, pas à trancher.
- **Règles** : le panneau dit « En tant que … » (lien vers `/us/:id`) et le titre du ticket. Valider ou noter un bug ouvre la prochaine règle encore à relire après la courante, sinon la première restante : une règle déjà validée est sautée. Quand plus aucune règle de l'US n'est à trancher, la notice ajoute « Toutes les règles de cette US sont validées » et un lien « Valider l'US » vers `/us/:id`. Après « Noter un bug » ce message n'apparaît que si l'US a d'autres règles (sinon le serveur abandonne l'US, il n'y a rien à valider).
- **Pas de changement serveur** : ni route ni migration.

L'accueil (A, B, C, D, E, I ; troisième morceau construit, S03) :

- **Panneau d'une US à valider** : `ValidatePanel` (`HomePage.tsx`) lit l'US (`fetchStory`, clé `["story", id]`) et montre `StoryDecisions` avec `StoryBody`, le lien « Ouvrir l'US » et le `counter` (« 1 sur 2 », `J` / `K`). Tant que l'US n'est pas lue, rien ne s'affiche ; si elle est introuvable, le panneau simple (`ItemPanel`) reste. Les autres sortes de lignes gardent `ItemPanel`.
- **La suite** : après Valider, Renvoyer ou Abandonner réussis, l'accueil est relu (`["home"]`) : la file perd l'US et la même place montre la suivante, le focus va sur sa ligne « US n » ; à la dernière, le panneau se ferme. `V` valide dans ce panneau parce que le bouton Valider de `StoryDecisions` y est monté.
- **Titres et carte « Maintenant »** : le titre de chaque ligne de « 2 · Ensuite » et de « Relances épuisées », et celui de la carte « 1 · Maintenant », sont des boutons qui ouvrent le panneau sur cet élément (focus compris).
- **Valider d'une ligne** : le bouton n'existe que pour un rôle `can_validate` ou plus (rôle lu dans `["projects"]`). Un refus passe par `decisionError` (`tickets.ts`) : « Des règles sont encore à trancher. » (409 `rules_pending`, avec le lien « Trancher dans l'écran de reprise » vers `/projets/:id/conception/regles`), « Ton rôle sur ce projet ne le permet pas. » (403 `role`).
- **Relance épuisée** : « Voir la PR #n » (GitHub) s'ajoute à « Ouvrir l'US », dans le panneau, sur la carte « Maintenant » et sur la ligne.
- **Liens des maquettes** : « Tous les runs » (`/claude`) sur « Claude en ce moment » ; carte « Préparer la nuit » (`/nuit`, « n user stories prêtes à programmer ») seulement quand rien n'attend et qu'aucune nuit n'est en cours (même clé `["home", "night"]` que la barre latérale) ; « Importer un repo » (`/projets`) sans projet, sans guide et sans rien à faire. Le bloc du matin, d'abord lié ici (« Voir la nuit », question qui ouvrait le panneau de l'accueil), est passé sur `/nuit` avec la [084](084-le-telephone-deuxieme-passe.md) E : « Voir la nuit » y est retiré, et « n questions t'attendent » y est un lien vers l'accueil, dont le panneau y répond.
- **États d'erreur** : « Impossible de lire l'accueil. » et « Impossible de lire le journal. » portent « Réessayer », qui relit la requête.
- **« Plus tard »** : un vrai bouton dans le panneau d'une question, qui ouvre la suivante (« 2 sur 2 ») et est désactivé à la dernière.
- **Bloc du matin** (`NightMorning.tsx`) : chaque ligne de la frise mène à `/us/:id` ; « n question(s) t'attend(ent) » est un bouton qui ouvre la première question et amène le focus dans le panneau.
- **Pas de changement serveur** : ni route ni migration.

Les tickets (A, C, D, F, J, K ; quatrième morceau construit, S04) :

- **Onglet Tickets dans l'adresse** (F) : `?ticket=<id>` (le ticket ouvert), `?vue=new` (puce Nouveaux) ou `?vue=tous` (aucune puce ; « Ouverts » est la vue sans paramètre), `?etiquette=<nom>` et `?q=<texte>` (la recherche). Les changements remplacent l'entrée d'historique (`replace`) : Précédent revient de la page d'un ticket à l'onglet tel qu'il était, sans défaire chaque frappe.
- **`TicketStoryPanel`** (`StoryCardPanel.tsx`, J) : le panneau d'une US de ticket réutilise `StoryCardPanel`. La file est celle des US « à valider » du ticket, avec compteur et `J` / `K` ; Valider, Renvoyer ou Abandonner ouvre la suivante, ou revient au ticket à la dernière. Dans le panneau de l'onglet, le bouton de retour est « ← Ticket » ; un clic avec touche modificatrice ou bouton du milieu garde le lien normal vers `/us/:id` (`isPlainClick`, `tickets.ts`).
- **Page `/tickets/:id`** (A) : le titre d'une US ouvre le même panneau à droite (bouton « Fermer »), la page reste, le Valider de la ligne reste.
- **Écrire les US maintenant** (D) : sans US, la page et le panneau montrent `RunNowButton` (`onlyConnected`, donc seulement avec une routine connectée) ; la page ajoute la phrase `writingSentence`, sortie de `ProjectPage.tsx` vers `ProjectRoutine.tsx`. Le bouton n'est proposé qu'au rôle `owner` (la route le demande, 076 G), sur un projet non archivé et un ticket non abandonné. Même règle sur l'écran d'import.
- **Liens** (C) : dans la ligne d'une US de la page, « Run n » mène à `/runs/n` et « US n » (dépendance) à `/us/n` ; sur l'écran d'import, « déjà dans Cockpit (US n) » et « (ticket n) » sont des liens entiers, et « GitHub ↗ » (lecteur d'écran : « Voir l'issue #n sur GitHub ») s'ouvre dans un nouvel onglet.
- **Après l'import** (D) : le message ajoute « n US prêtes au Kanban » (lien vers `/projets/:id`, absent s'il n'y en a aucune) et « Écrire les US maintenant » seulement s'il y a plus de tickets que d'US importées.
- **Rôle et archive** (D) : sur la page d'un ticket, Modifier, Valider, Abandonner le ticket, « + Ajouter » (pièces jointes) et Supprimer ne sont proposés qu'à `can_validate` ou plus, sur un projet non archivé (`?modifier=1` n'ouvre plus l'édition sans cela).
- **Étiquettes suggérées** : le champ d'étiquette de la modification propose les étiquettes déjà portées par les autres tickets du projet (`fetchTickets`, clé `["tickets", projet]`).
- **Suppression** (K) : revient à `/projets/:id/tickets`.
- **Pas de changement serveur** : ni route ni migration.

La nuit et la liste des projets (A, C, D, E ; cinquième morceau construit, S05) :

- **« Lire » sur /nuit** (A) : chaque US sous « Pourrait s'ajouter » a un bouton « Lire » (`aria-expanded`, devient « Replier ») qui déplie sur place `StoryBody` (lu par `fetchStory`, clé `["story", id]`, seulement une fois dépliée) ; « Valider et ajouter » reste sur la ligne, l'adresse reste `/nuit`, et le programme déjà composé est gardé. Une lecture en échec dit « Impossible de lire la user story. ».
- **Liens pendant la nuit** (C) : le titre d'une US mène à `/us/:id`, le nom du projet à `/projets/:id`, et « Run n » à `/runs/n` quand l'US a un run. Le soir, quand le programme se compose et qu'aucune nuit n'existe encore, rien n'est un lien : quitter la page perdrait le programme (044 D'').
- **`runId` de l'item** (C, serveur) : `GET /api/nights/current` ajoute `runId` à chaque US de la nuit : le run de l'item quand son tour est fini, sinon le dernier run lancé pour lui (`cloud_launches`), sinon `null`. Pas de migration.
- **Où agir** (D) : « Connecte le lanceur » est un lien vers `/reglages/taches-cloud` ; la liste vide dit « Aucun projet n'est coché pour la nuit » avec « Cocher des projets » vers la même page seulement quand aucun projet n'est coché ; avec un projet coché, elle garde « Aucune user story à ajouter. » sans lien.
- **Importer un repo** (D) : la barre latérale pointe vers `/projets#importer` ; une fois les repos chargés, `Importable` amène la section dans la vue (`scrollIntoView`). Sans projet, l'état vide porte le lien « Importer un repo » vers `#importer`. Après un import réussi, « Ouvrir le projet » mène à `/projets/:id` et la liste reste affichée (pas de navigation automatique).
- **« Claude t'attend » sur la liste des projets** (E) : l'état d'un projet qui attend l'utilisateur est un lien « Claude t'attend · n <chose> » vers la première chose de son espèce : question (`/runs/:runId`), US à valider ou PR à relire (`/us/:id`), relance épuisée (`/us/:id`), run à vérifier (`/runs/:runId`). Le compte est celui des éléments du même genre que le premier.

Le journal et les objets cités (C ; sixième morceau construit, S06) :

- **Accueil** : chaque ligne de « Dernièrement » est un lien entier (`JournalEntry`, prop `to`) vers `objectPath(entry)` (`Journal.tsx`) : `/runs/:runId`, sinon `/us/:storyId`, sinon `/tickets/:ticketId` ; une entrée sans objet (connexion) reste une ligne sans lien. La page Journal et l'onglet Historique gardent leurs lignes en boutons qui ouvrent le panneau (053 G).
- **Panneau « Entrée du journal »** (`JournalView.tsx`, partagé par la page Journal et l'onglet Historique d'un projet) : le projet est un lien vers `/projets/:id` ; un champ « Lié à » porte « Run n » (`/runs/n`), « US n » (`/us/n`) et « Ticket n » (`/tickets/n`), absent quand l'entrée n'a aucun des trois (et dans la version partielle du panneau).
- **Ligne de l'onglet Historique** : sous la phrase, « Run n · US n · Ticket n » en texte simple (`objectWords`), la ligne étant déjà un bouton.
- **Page /claude** : le titre de chaque US de la file et celui de la question en attente (« Maintenant ») mènent à `/us/:id` ; « l'US n » de « Attend l'US n, sautée en attendant » est un lien.
- **Page d'un run** : « PR #n ouverte » mène à la PR sur GitHub (`https://github.com/<repo>/pull/n`, le repo étant `project.name` du run).
- **Branches à nettoyer** (« Ce qui a été livré », `ProjectDelivered.tsx`) : « PR #n » mène à GitHub et « US n » à `/us/n`, sur la ligne de la branche.
- **Pas de changement serveur** : ni route ni migration.

Les runs (A, C, D, L ; septième morceau construit, S07) :

- **Téléphone, question en tête** (L) : `RunQuestions` prend une prop `part`. `RunPage` le monte deux fois : `pending` juste après la phrase d'état (avant « Les étapes » et « Les critères »), `answered` en fin de page pour la liste « Questions ». Le découpage est le même à toute largeur : la question en tête vaut aussi au-dessus de `lg` (le panneau reste, lui, à sa place).
- **Touches 1 et 2** (D) : `AnswerForm` appelle `useShortcut("1")` et `useShortcut("2")`, qui envoient la réponse proposée de même rang (`POST /api/questions/:id/answer`). Rien n'est envoyé dans un champ, sans réponse proposée, ni pendant un envoi. Chaque bouton porte `aria-keyshortcuts` ; la fenêtre « ? » et la carte Raccourcis de Préférences listent « Répondre à Claude (réponses proposées) ».
- **Verdict** (D) : `RunVerdict` reçoit `summary`, `prUrl`, `projectId` et `criteriaTo`. Le résumé du run est dans la carte « Le verdict de Claude » (une fois) ; la section « Résumé » du bas de `RunPage` est supprimée. Chaque raison est un lien : `ci_failing` et `ci_pending` vers `<PR>/checks` (GitHub), `changes_requested` vers la PR, `ci_missing` vers `/projets/:id/ci`, `criteria_failed` vers `#criteres` (id de la section « Les critères » de `RunPage`) ; `StoryVerdict` (page de l'US) pointe vers `/runs/:id#criteres`. Sans PR, les raisons qui en dépendent restent du texte.
- **Relancer** (D) : « Relancer » mène à `/us/:id?developper`. `StoryDecisions` ouvre alors la fenêtre « Développer avec Claude » si l'US est prête ou en revue, sur un projet non archivé et pour un rôle `can_launch` ou plus, puis retire le paramètre de l'adresse (`replace`). Sinon la fenêtre reste fermée.
- **Finis aujourd'hui** (C, D ; serveur) : `GET /api/claude` ajoute à chaque ligne de `finishedToday` `verdict` (`runVerdict`, comme l'accueil), `prNumber`, `storyStatus` et `summary`. Pas de migration.
- **Finis aujourd'hui** (C, D ; écran) : la ligne dit « verdict : à vérifier » ou « acceptable » et « PR #n » ; « Relire la PR #n » (GitHub) seulement quand l'US est en revue ; pour un échec, la première ligne du résumé ; la section porte « Tout l'historique » vers `/journal`.

Un refus mène à sa réparation (D ; huitième morceau construit, S08) :

- **`FixLink`** (`ProjectPrepare.tsx`) : une table `FIXES` associe le code de refus du serveur à la page qui le répare, et `FixLink` rend « Ouvrir … » ou rien. `project_not_in_launcher`, `launcher_not_connected`, `launcher_needs_reconnect`, `routine_not_connected`, `routine_needs_reconnect` et `launch_failed` mènent à `/reglages/taches-cloud` ; `monthly_budget_reached` à `/claude/cout` ; `no_plugin_repo` à `/equipes/commun` ; `not_prepared` à `/projets/:id/sante` (seulement quand l'écran connaît le projet).
- **Où il est monté** : celle d'`AnswerForm` (« Réponse enregistrée… », code `saved`), « Lancer maintenant » de `/claude/taches`, « Écrire les US maintenant » (`ProjectRoutine.tsx`), `ProblemAlert` de « Préparer pour Claude », et « Demander à Claude » d'un workflow rouge de l'onglet CI / CD.
- **Refus de la fenêtre « Développer avec Claude »** : `DevelopWindow` n'utilise plus `FixLink` ; `linked` (`DevelopWindow.tsx`) lit `FIXES` (exportée) avec le code du refus et rend en lien, dans la phrase même, les mots « Réglages » ou « page Coût » (« les Réglages » sans l'article) ; un code absent de `FIXES`, ou des mots absents du message, garde le message seul.
- **File en pause** (`Claude.tsx`) : `run_failed` ajoute « Voir le run » vers le run échoué de « Finis aujourd'hui » au plus grand id (rien s'il n'y en a pas) ; `launch_failed` ajoute le lien vers les Réglages.
- **Bandeau de verrou** (`ProjectPage.tsx`) : « Voir l'abonnement » (`/reglages/abonnement`) seulement quand `lockedBy` est le login de l'utilisateur ; verrouillé par un autre (garde-fou), aucun lien.
- **Santé** : la ligne `ci` rouge porte « Voir l'onglet CI / CD » vers `/projets/:id/ci` ; la ligne `webhook` en `wrong_url` ou `last_delivery_failed` porte `url` (réglages de l'App, `appSettingsUrl`) et le texte « Ouvrir les réglages de l'App ↗ » ; une ligne verte n'a pas d'`url`.
- **Lancement de « Demander à Claude » jamais verrouillé** (E, précise 067 G) : un lancement sans nouvelles depuis deux heures (comme `GIVE_UP_MS` des routines, 056 B) ne compte plus : il ne bloque pas une nouvelle demande et la ligne ne dit plus « Claude regarde ». Une demande qui vient d'être acceptée remplace à l'écran le résumé du lancement précédent.
- **Serveur** : `webhookLine` reçoit `appSettingsUrl` ; pas de route ni de migration.

La conception et la santé (C, D ; neuvième morceau construit, S09) :

- **Ticket créé** (C) : `POST /api/findings/:id/ticket` répondait déjà le ticket ; `findings.ts` le rend. L'écran Constats dit « Ticket créé : <titre> » avec « Ouvrir le ticket » vers `/tickets/:id`, jusqu'à la décision suivante. « C'est un bug » (`Reprise.tsx`) ajoute le même lien « Ouvrir le ticket » à sa notice.
- **Filtre « En ticket »** (`Findings.tsx`) : liste les constats `ticketed`, lus comme « Rejetés » (ni compteur ni `J` / `K`) ; le constat porte « Ticket #n » vers `/tickets/n`.
- **Règles d'un objet** (C, `ConceptionObject.tsx`) : le panneau d'un objet liste, sans doublon, les règles des fonctionnalités qui le citent (`useFeatures`), section « Les règles qui le touchent · n », chacune en lien `ruleHref` (`?regle=`).
- **`?objet=`** (`ProjectConception.tsx`) : l'adresse est relue quand elle change alors que l'onglet reste monté, donc la puce d'un objet des Fonctionnalités ou de l'écran de reprise ouvre son panneau.
- **Fenêtre d'analyse** (D) : `AnalyseWindow` prend `steps` (`Step[]`) à la place de `initialRules` et `initialVersions` ; seules les étapes listées sont cochées. « Analyser avec Claude » de Constats (en tête de liste, et dans l'état vide du filtre « Tous ») coche Bugs, Sécurité et Architecture et stack ; « Reprendre la fonctionnalité » (constat d'architecture sur du code sans règle figée) et l'état vide de Règles cochent Règles ; le plan de versions coche Versions ; les autres entrées gardent Carte.
- **Pas de changement serveur** : ni route ni migration.

La coque, la recherche et la barre d'idée (C, M ; dixième morceau construit, S10) :

- **Action « Équipes d'agents »** (`SearchDialog.tsx`) : elle mène à `/equipes`, comme la barre latérale.
- **Noter le texte tapé** : dès deux caractères tapés et la recherche terminée, une action « Noter « <texte> » » ferme la fenêtre et ouvre le panneau d'idée avec ce titre ; elle vient après les résultats, et seulement quand la page peut noter une idée (un projet existe). `onIdea` reçoit le titre, et la référence de `IdeaBar` accepte `(opener, title?)`.
- **« Chercher » au téléphone** : retiré à la fusion avec la 084, dont l'onglet « Menu » a une ligne « Chercher » (`onSearch` de `IdeaBar`).
- **Projet de la barre d'idée** : l'ordre est le choix de l'utilisateur, puis le projet de la page (`/projets/:id`, ou le projet de l'US, du ticket ou du run affiché, lu par les requêtes `["story", id]`, `["ticket", id]`, `["run", id]` des pages), puis le dernier projet où une idée a été notée, puis le premier de l'accueil. `fetchTicket` passe de `TicketPage.tsx` à `tickets.ts` pour être partagé ; `fetchStory` et `fetchRun` étaient déjà exportés.
- **« Idée notée dans … »** porte « Ouvrir le ticket » vers `/tickets/<id du ticket créé>`.
- **Pas de changement serveur** : ni route ni migration.

Les équipes, les agents et les plugins (A, C, D, N, O ; onzième morceau construit, S11) :

- **Ajouter ou mettre à jour une équipe** (N) : le clic lit le projet (`planAdd`) et montre, dans la ligne de l'équipe, « Ce qui change » (diff de la copie du repo vers le texte global, ou le texte seul pour un ajout) et, s'il en manque, la liste « Agents ajoutés » (absente sinon). Rien n'est envoyé à `team/apply` avant « Faire le commit », qui envoie le même corps qu'avant. Vaut pour l'onglet Agents (« Tes équipes », `GlobalTeamRow`, « C'est fait » reste dans la ligne) et pour `/equipes` (« Ajouter » après le choix du projet). La fenêtre « Développer avec Claude » garde l'ajout en un clic (`useAddTeam`) : elle avertit déjà d'une équipe « à mettre à jour ».
- **Suite d'un ajout** (C) : sur `/equipes`, le résultat porte « Ouvrir dans <projet> › Agents » vers `/projets/:id/agents`. Après « Créer l'équipe » (création, pas modification), la ligne de la nouvelle équipe s'ouvre sur « Ajouter à un projet ».
- **Agent absent du repo** (O) : l'étape dont l'agent manque au repo mais figure au catalogue montre « Ajouter l'agent du catalogue » ; il ouvre le formulaire d'agent prérempli du texte du catalogue, et le commit envoie `before: null`. Le bouton est absent hors catalogue, si l'agent est déjà dans le repo, et dans la fenêtre « Nouvelle équipe ».
- **Utilisé par** (A) : l'agent ouvert liste les équipes qui le nomment (« Par défaut » pour `team.md`, puis les équipes nommées lisibles par `readTeam`) ; la confirmation « Supprimer l'agent » nomme les mêmes. Rien n'est affiché pour un agent non utilisé.
- **Liens GitHub** (D) : un en-tête d'agent illisible, une équipe nommée ou `team.md` illisible portent « Ouvrir sur GitHub ↗ » vers `https://github.com/<repo>/blob/HEAD/<chemin>` ; la ligne « Fichier trop gros » est un lien, plus un bouton désactivé.
- **Plugins** (C, D) : sans repo relié, la phrase porte « Ouvrir un repo à Cockpit ↗ » vers `installUrl` ; avec l'App installée sur aucun repo : « L'App est installée, mais sur aucun repo. » et « Choisir des repos ». Le repo relié a « Ouvrir le repo ↗ » vers GitHub et chaque projet de « Tes projets » est un lien vers `/projets/:id`. « Installer » ou « Retirer » montre « Ce qui change » et « Faire le commit » dans le `li` du projet, avec « C'est fait » ou l'alerte de refus ; le haut de page ne les montre plus pour un projet.
- **Pas de changement serveur** : ni route ni migration.

La CI / CD (E ; douzième morceau construit, S12) :

- **`claude` sur chaque workflow** (serveur) : `GET /api/projects/:id/workflows` ajoute à chaque workflow `claude` : `{ sessionUrl, startedAt, finishedAt, outcome, summary }` du dernier « Demander à Claude » (`claudeAsks`, `workflows.ts`), ou `null` si le workflow n'a jamais été demandé ou si le dernier lancement, non fini, n'a pas de nouvelles depuis `ASK_GIVE_UP_MS` (2 h). Un lancement en cours a `finishedAt: null` et `summary: null`.
- **Pas de double lancement** : `POST .../workflows/ask` refuse avec 409 `launch_running` quand un lancement non fini (de moins de 2 h) existe pour le même workflow ; un autre workflow passe. Le test se fait dans la transaction de l'action, sous un verrou de la ligne du projet (deux demandes simultanées). Le refus est écrit en français (`REFUSALS`, `ProjectPrepare.tsx`).
- **La ligne après rechargement** (`ProjectCi.tsx`) : un lancement non fini dit « Claude regarde depuis <durée> », garde « Voir la session » et grise « Demander à Claude » ; un lancement fini montre son résumé et le bouton redevient actif. Une demande qui vient d'être acceptée remplace le résumé précédent.
- **Proposition à relire à l'accueil** : `GET /api/home` ajoute à `forYou`, en dernier, un item `workflow_proposal` `{ proposalId, path, reason, project }` par proposition en attente (`decision` nulle) des projets de l'utilisateur. « 1 · Maintenant » le montre en lien « Claude propose un changement de <fichier> » vers `/projets/:id/ci` ; les autres lignes de l'accueil ont « Relire » et le panneau « Relire la proposition » (groupe « Propositions de Claude »). Sur la liste des projets, « Claude t'attend » le compte comme « proposition de workflow ».
- **Onglet** (`ProjectPage.tsx`) : « CI / CD · 1 à relire » dès qu'une proposition est en attente, sans classe destructive ; la requête des workflows n'est plus limitée à l'onglet CI / CD.
- **Pas de migration**, aucune route ajoutée.

Les réglages (P, Q, C ; treizième morceau construit, S13) :

- **Fréquences par projet** (Q, `RoutineSettings.tsx`) : une tâche « Écrire les US » connectée liste « Fréquence de chaque projet » : les projets non archivés (`["projects"]`), chacun en lien vers `/projets/:id/reglages` avec sa phrase (« chaque jour à 7 h », « chaque semaine à … », « à la demande », « désactivée »), lue par `fetchSchedule` de `ProjectRoutine.tsx`. Tâche non connectée, ou aucun projet actif : rien n'est listé.
- **Carte « Dans le cloud »** (P, `CloudCard`, `ProjectRoutine.tsx`) : la case « Lancer ce projet dans le cloud » lit `["launcher"]` (`fetchLauncher`) et envoie `PUT /api/projects/:id/launcher { inLauncher }` : même valeur que l'étape 4 des Réglages. Le projet dans `missingProjectIds` dit « Le repo n'est pas dans la tâche » ; un lanceur non relié montre un lien vers `/reglages/taches-cloud`.
- **Inviter** (`Members.tsx`) : la carte d'archivage du projet porte « Inviter sur ce projet » vers `/reglages/membres?projet=<id>` (absente si le projet est archivé). Le projet est déjà choisi quand l'adresse porte `?projet=<id>` d'un projet de la liste, ou quand il n'y en a qu'un ; un clic sur une puce garde la priorité. Après « Copier », la page dit « Copié. ».
- **Retirer une tâche reliée** (C, `ConnectStep`, `TaskCard.tsx`, donc Écrire les US et Lanceur) : « Retirer » n'envoie plus rien ; il montre « Retirer la tâche ? Il faudra régénérer son jeton sur claude.ai. » avec « Confirmer le retrait » (envoie le DELETE) et « Annuler » (focus dessus, rétablit « Retirer » sans requête).
- **Pas de changement serveur** : ni route ni migration.

## Limites connues

- **Un panneau plus long** : le récit et les critères d'une US défilent dans un panneau de 380 px ; c'est le prix d'un aller-retour en moins par US.
- **Un refus de règles à l'accueil** : le lien `rules_pending` d'une ligne mène à l'écran de reprise du projet (`/regles`), sans `?regle=` : la ligne ne connaît pas la règle.
- **Abandonner au Kanban** (sauf la dernière US) : la relecture du tableau retire l'US avant que la suivante soit lue, donc le panneau se ferme un instant puis rouvre sur la suivante, et le focus passe par `<body>` entre les deux. Après Valider, le panneau montre brièvement l'US validée (colonne « Prêtes ») avant la suivante.
- **`V` sur l'accueil** valide l'US affichée dans le panneau : le risque de valider par réflexe est celui que la 073 acceptait déjà au Kanban.
- **Une US ouverte dans un panneau de ticket** n'est pas dans l'adresse : seul `?ticket=` l'est dans l'onglet Tickets, et la page d'un ticket ne garde pas l'US ouverte.
- **Un programme du soir** n'a aucun lien : pour lire une US déjà au programme, il faut valider ou annuler d'abord (« Lire » ne vaut que sous « Pourrait s'ajouter »).
- **« Claude t'attend · n »** ne compte que les éléments du genre du premier ; un projet qui attend des choses de genres différents n'affiche que le premier genre.
- **Le journal à l'accueil** n'ouvre pas le panneau : la ligne mène à la page de l'objet, les autres objets de l'entrée (US ou ticket d'une entrée qui a aussi un run) ne se lisent que dans le panneau du journal.
- **Touches 1 et 2** ne valent que pour la question affichée par `AnswerForm` : deux formulaires de réponse montés en même temps (jamais aujourd'hui) répondraient tous les deux.
- **Finis aujourd'hui** ne montre que la première ligne du résumé d'un échec ; la suite se lit sur la page du run.
- **Un code sans réparation connue** (`FIXES` ne le liste pas, ou `not_prepared` sans projet) garde le message seul : un nouveau code de refus demande une ligne dans `FIXES`.
- **Le lien du ticket créé** disparaît à la décision suivante ou en quittant l'écran : le ticket se retrouve par « En ticket » ou par l'onglet Tickets.
- **Le dernier projet utilisé** n'est gardé qu'en mémoire de la page : un rechargement revient au premier projet de l'accueil.
- **Le lien « Ouvrir le ticket »** de la barre d'idée disparaît avec le message « Idée notée dans … ».
- **« Utilisé par »** ne lit que les équipes que `readTeam` sait lire ; une équipe illisible n'est pas comptée.
- **« CI / CD · 1 à relire »** lit la requête des workflows, qui appelle GitHub : un échec de cette lecture (rejouée une seule fois au chargement de chaque onglet du projet) laisse l'onglet sans compteur.
- **Un lancement sans nouvelles depuis 2 h** n'est ni affiché ni bloquant, même si sa session tourne encore : l'ancienne session peut alors s'ajouter à la nouvelle.
- **« Copié. »** reste affiché tant que le lien d'invitation l'est ; il ne revient pas à « Copier » après un délai.
- **Fréquences des projets** : une requête de planning par projet actif (`fetchSchedule`) ; sans réponse, la ligne montre le nom du projet seul.
