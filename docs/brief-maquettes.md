# Cockpit — Brief pour les maquettes

## Ce que je te demande

Des maquettes des écrans de **Cockpit**, une application web. Priorité aux **quatre écrans clés** (§6), puis aux autres écrans et fenêtres (§7). Interface **en français**. Ordinateur d'abord ; trois gestes doivent aussi bien marcher sur téléphone (§8).

L'implémentation se fera en React. Préfère des composants standards (boutons, onglets, badges, fenêtres modales, listes, tableaux) à des éléments très sur mesure.

## 1. Le produit en une phrase

Cockpit est un **centre de contrôle** pour les repos GitHub qu'un développeur fait avancer avec **Claude Code** (l'agent de code d'Anthropic). Il note des idées, Claude les transforme en user stories, le développeur les valide, Claude les développe et ouvre une pull request, le développeur la relit et la merge.

## 2. Pour qui

Un développeur qui gère plusieurs repos et délègue une grande partie du code à Claude. Il veut savoir **d'un coup d'œil ce qui l'attend** et **ce que Claude est en train de faire**. Il doit comprendre l'application sans documentation : la navigation doit être simple et chaque écran doit dire quoi faire ensuite.

## 3. La boucle au cœur du produit

```
Idée (ticket) ──► User stories ──► Validation ──► Développement ──► Pull request ──► Merge
   l'humain        Claude            l'humain       Claude          l'humain relit    l'humain, sur GitHub
```

1. L'humain note une **idée** (un ticket) sur un projet.
2. Claude la découpe en **user stories**, chacune avec des critères d'acceptation « Étant donné / Quand / Alors ».
3. L'humain **valide** chaque user story, ou la **renvoie** avec un commentaire pour qu'elle soit réécrite.
4. L'humain lance **« Développer avec Claude »** sur une user story prête. Claude écrit les tests, puis le code, fait relire, et ouvre une pull request.
5. L'humain **suit le run** en direct, étape par étape, et répond aux questions de Claude.
6. L'humain relit la pull request et la **merge sur GitHub**. Cockpit le voit et marque la user story terminée.

## 4. Le principe directeur : « qui doit agir ? »

À tout moment, chaque élément attend soit **l'humain**, soit **Claude**. C'est le fil conducteur de l'interface :

- chaque élément porte un repère clair **« À toi »** ou **« Claude »** ;
- l'accueil commence par ce qui attend l'humain ;
- les décisions réservées à l'humain (valider, renvoyer, abandonner) ont un style distinct ;
- une action impossible reste visible, désactivée, avec sa raison (« Un run est déjà en cours sur cette US »).

Autres règles :

- **Un statut = une couleur + un libellé + une icône**, identiques partout. La couleur n'est jamais le seul repère.
- **États vides qui guident** : « Aucun projet. Importer votre premier repo ».
- **Erreurs visibles** : un message clair et un bouton « Réessayer », jamais d'écran blanc.
- **Mises à jour en direct** : la page d'un run, le Kanban et l'accueil changent sans recharger. Montre comment un élément nouveau ou modifié se signale.
- Style : un outil de développeur, **sobre, dense mais lisible**. Thème clair ; prévoir que le thème sombre viendra.

## 5. Vocabulaire et statuts

| Terme | Sens |
|---|---|
| Projet | Un repo GitHub suivi par Cockpit |
| Ticket | Une idée brute, en texte libre |
| User story (US) | Un morceau de ticket assez petit pour être développé et relu seul : « En tant que…, je veux…, afin de… », des notes, des critères |
| Critère d'acceptation | Un « Étant donné / Quand / Alors ». Après un run : validé ou non, avec une preuve (un test, un lien de CI) |
| Run | Un développement d'une US par Claude |
| Étape | Une partie d'un run, faite par un agent : écriture des tests, développement, relecture |
| Question | Une décision que Claude pose à l'humain pendant un run ; le run attend la réponse |

**Statuts d'une user story** (ceux qui attendent l'humain sont marqués « À toi ») :

| Statut | Qui doit agir |
|---|---|
| À valider | À toi |
| À réécrire | Claude |
| Prête | À toi (lancer le développement) |
| En cours | Claude |
| En revue | À toi (relire la PR) |
| Terminée | — |
| Abandonnée | — |

**Étapes d'un ticket** (calculées à partir de ses US) : Nouveau, À valider, Validé, En cours, Terminé, Abandonné.

**Statuts d'un run** : En cours, Réussi, Échoué, Arrêté, Fermé à la main. Verdict de fin de run : **Acceptable** ou **À vérifier** (avec les raisons).

## 6. Les quatre écrans clés

### 6.1 Accueil — « Qu'est-ce qui m'attend ? »

- **À toi de jouer** : tout ce qui bloque tant que l'humain n'a pas agi, trié par urgence. Chaque ligne dit quoi faire et mène à l'endroit où agir. Types : question de Claude (la plus urgente, elle bloque un run), run échoué ou à vérifier, PR à relire, PR dont la CI échoue, US à valider.
- **Claude travaille** : les runs en cours, avec leur US, leur étape actuelle et depuis combien de temps.
- **Projets** : une carte par projet (nombre d'US par statut, PR ouvertes, santé, dernière activité).
- Si rien n'attend l'humain : un état vide rassurant (« Rien ne t'attend. Claude travaille sur 2 user stories. »).

### 6.2 Page d'une user story

- **Contenu principal** : le titre, le récit (En tant que / je veux / afin de), les notes, les critères d'acceptation avec, après un run, leur résultat (validé ou non) et leur preuve.
- **Colonne latérale** : le statut, le ticket d'origine, les actions humaines (Valider, Modifier, Demander une réécriture, Abandonner), le **bloc GitHub** (issue, branche, PR, état de la CI, état de la revue, gros bouton « Ouvrir la PR sur GitHub »), la liste des runs, et le bouton principal **« Développer avec Claude »** quand l'US est prête.
- **Onglet Historique** : les actions sur l'US, celles de Claude distinguées de celles de l'humain.
- Montre au moins deux états : « À valider » (actions de validation mises en avant) et « En revue » (bloc GitHub mis en avant).

### 6.3 Page d'un run (en direct)

- **En-tête** : l'US, le modèle demandé et le modèle réel, la branche, le statut, la durée.
- **Question en attente**, si Claude en a posé une : tout en haut, très visible, avec un champ de réponse. Le run reprend dès la réponse.
- **Étapes par agent** (test-writer, developer, reviewer…), chacune avec son statut et un résumé, qui se mettent à jour en direct.
- **Actions** : Arrêter (c'est une demande, que Claude lit à sa prochaine étape : le bouton passe en « Arrêt demandé… »), Relancer avec un commentaire, Fermer à la main (si la session ne répond plus).
- **Aide à la décision**, en fin de run : chaque critère avec son résultat et sa preuve, l'état de la CI, et le verdict « Acceptable » ou « À vérifier » avec les raisons.

### 6.4 Kanban d'un projet

- Cinq colonnes : À valider, Prêtes, En cours, En revue, Terminées.
- **Pas de glisser-déposer**, volontairement : on ouvre la carte pour relire l'US avant de décider.
- Une carte : le titre de l'US, son ticket, le repère « À toi » ou « Claude », et un indicateur s'il y a une question en attente ou une CI en échec.

## 7. Les autres écrans et fenêtres

**Structure générale** : une barre latérale à gauche avec le bouton « + Nouveau ticket » (accessible depuis n'importe quel écran), Accueil, Journal, la liste des projets (une pastille par projet : « t'attend » ou « Claude travaille »), « + Importer un projet », Réglages. En haut de l'écran, un fil d'Ariane (Projets › GestionProjet › US 42).

| Écran | Contenu |
|---|---|
| Connexion | « Se connecter avec GitHub » ; message clair si le compte n'est pas autorisé |
| Liste des projets | Les projets, leur état, « Importer un repo », archiver |
| Projet | Onglets : **Kanban** (par défaut), Tickets, Santé, Historique |
| Onglet Tickets | La liste des tickets du projet avec leur étape |
| Onglet Santé | Le bilan du repo, ligne par ligne, vert ou rouge : `CLAUDE.md` présent, CI présente, application GitHub installée, serveur MCP de Cockpit déclaré sans secret, agents et skill de développement présents. Chaque ligne rouge corrigeable propose sa correction, et un bouton « Préparer pour Claude » corrige tout en un seul commit |
| Ticket | Le titre, la description (markdown), l'étape, ses US ; modifier, supprimer (seulement s'il n'a encore aucune US), abandonner |
| Journal | Tout ce qui s'est passé, filtrable par projet, outil, origine (interface, Claude, GitHub), auteur, résultat (réussi, erreur, refusé), période |
| Réglages | Les jetons MCP : créer (le jeton ne s'affiche **qu'une seule fois**), nommer, révoquer |

**Fenêtres modales** :

- **Nouveau ticket** : un titre et un projet suffisent ; description facultative.
- **Développer avec Claude** : la branche (nouvelle, nommée automatiquement, ou existante), un prompt complémentaire facultatif, un rappel des US dont celle-ci dépend et qui ne sont pas terminées (sans rien interdire), le bouton qui ouvre Claude sur le PC.
- **Demander une réécriture** : commentaire obligatoire.
- **Abandonner** : confirmation.
- **Issue modifiée sur GitHub** : le diff entre l'issue et la version de Cockpit ; l'humain choisit laquelle garder.
- **Préparer pour Claude** : les fichiers à ajouter au repo, montrés un par un, avant un seul commit.

## 8. Sur téléphone

Trois gestes doivent être confortables sur un téléphone : **noter un ticket**, **valider une user story**, **répondre à une question de Claude**. Le reste doit rester utilisable sans être optimisé.

## 9. Données d'exemple

- **Projets** : `GestionProjet` (Claude y travaille), `Cockpit-v2` (t'attend), `site-perso` (rien en cours).
- **Ticket** : « Pouvoir se connecter par lien magique », projet GestionProjet, étape « À valider ».
- **User story 42** : « En tant qu'utilisateur, je veux recevoir un lien de connexion par e-mail, afin de me connecter sans mot de passe. »
  - Critère 1 : Étant donné un e-mail inscrit, quand je demande un lien, alors je reçois un e-mail contenant un lien valable 15 minutes.
  - Critère 2 : Étant donné un lien expiré, quand je l'ouvre, alors je vois « Ce lien a expiré » et un bouton pour en recevoir un autre.
  - Critère 3 : Étant donné un lien déjà utilisé, quand je l'ouvre, alors il est refusé.
- **Run 17** sur l'US 42 : modèle demandé Opus, modèle réel Opus ; branche `us/42-magic-link` ; étapes test-writer (réussie, « 3 tests écrits, ils échouent comme prévu »), developer (en cours), reviewer (à venir).
- **Question de Claude** : « Le lien doit-il rester valable si l'utilisateur change d'appareil ? »

## 10. Hors du périmètre de ces maquettes

Pièces jointes, priorités et tags, routines, sessions cloud, coût et budget, notifications, invitations et partage, édition de la configuration Claude des repos. Ils viendront plus tard : la structure doit pouvoir les accueillir, mais il n'est pas nécessaire de les dessiner.
