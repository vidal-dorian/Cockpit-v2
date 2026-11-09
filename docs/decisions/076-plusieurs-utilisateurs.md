# 076 — Plusieurs utilisateurs sur un projet

- **Statut** : proposée (à valider à la relecture de la PR) ; le code est construit (tranche 13.1)
- **Date** : 2026-11-09
- **Décidé par** : Dorian, avec Claude ([064](064-tranches-restantes.md) 13.1 A à D)
- **Dépend de** : [004 — Les outils MCP](004-outils-mcp.md) (un jeton atteint les projets dont son utilisateur est membre), [008 — Le service en ligne](008-service-en-ligne.md) (F, la table des membres), [009 — La connexion GitHub](009-connexion-github.md), [010 — L'historique](010-historique.md), [012 — La configuration automatique](012-configuration-automatique.md) (G, l'inscription ouverte et la liste des utilisateurs), [015 — Les jetons MCP](015-jetons-mcp.md) (un secret haché, montré une fois), [018 — Les décisions humaines](018-decisions-humaines.md) (la table des droits), [068 — Un nouveau projet depuis un modèle](068-repo-modele.md) (D, le retour d'une autorisation GitHub par `/api/auth/callback`)
- **Modifie** : 008 F (l'index « un membre par projet » est retiré, `role` s'élargit) ; 064 13.1 D (l'accès GitHub de l'invité, voir C)
- **Tranche** : 13.1 du [découpage](../decoupage.md)
- **Écran** : [S48](../ecrans/S48_Reglages_Membres.png)

## Contexte

Un projet n'a qu'un membre, son propriétaire, garanti par un index unique (008 F). La 064 13.1 a tranché le partage : trois rôles, une invitation par login GitHub dont l'invitant envoie lui-même le lien, l'inscription qui reste ouverte, et l'administrateur qui voit l'activité des comptes sans voir leurs projets.

## Les choix

| # | Question | Décision |
|---|---|---|
| A | Les rôles | `project_members.role` prend quatre valeurs : `owner` (propriétaire, un seul par projet, celui qui l'a importé), `can_launch` (« peut valider et lancer »), `can_validate` (« peut valider »), `read_only` (« lecture seule »). Ils s'emboîtent : chaque rôle a les droits du précédent. **Lecture seule** : tout lire du projet (Kanban, tickets, US, runs, bilan, son historique) ; ses préférences à lui (l'étoile, 073 H ; la case du lanceur cloud, 054 D) restent les siennes. **Peut valider** : en plus, les décisions humaines sur les US (018 : valider, renvoyer, modifier, abandonner) et les tickets (noter une idée, modifier, abandonner un ticket). **Peut valider et lancer** : en plus, lancer, arrêter, relancer et fermer un run, répondre à une question de Claude, mettre une US dans la file ou dans la nuit. **Propriétaire** : tout le reste, soit archiver le projet, gérer ses membres et ses invitations, et tout ce qui écrit dans le repo ou configure le projet (Préparer pour Claude, équipes et agents, configuration Claude, CI / CD, routines, reprise et figer, branches, changelog). Le serveur refuse le reste en 403 `role`, journalisé `refused` |
| B | Le MCP | Claude agit pour l'utilisateur du jeton : un outil qui écrit demande le rôle du geste humain qui lui correspond. Les outils de lecture : tout membre. `create_ticket` et les outils qui écrivent ou modifient une US : **peut valider**. Les outils d'un run (`start_run`, `report_step`, `report_criterion`, `ask_user`, `link_pull_request`, `finish_run`, `report_launch`, `finish_launch`) : **peut valider et lancer**. Ceux de la reprise et de la configuration (`submit_code_map`, `submit_findings`, `create_takeover_stories`, `propose_workflow_change`) : **propriétaire**. Un refus rend l'erreur `role`, journalisée comme les autres refus du MCP |
| C | L'accès GitHub de l'invité | Une installation de l'App appartient au compte qui possède le repo : celle de l'invité ne peut pas couvrir le repo d'un autre, comme la 064 13.1 D le demandait. **Cockpit vérifie donc que l'invité a lui-même accès au repo sur GitHub** : à l'acceptation, une autorisation GitHub (comme la création depuis un modèle, 068 D, retour par `/api/auth/callback` reconnu à son `state`) donne un jeton de l'invité, utilisé une fois pour lire le repo puis oublié. Sans accès : « Tu n'as pas accès à `owner/repo` sur GitHub. Demande à `@proprio` de t'y ajouter comme collaborateur, puis rouvre ce lien. » Les écritures sur GitHub restent celles de l'App (son installation sur le repo), jamais un jeton personnel du propriétaire |
| D | Inviter (S48) | Réglages › **Membres**. « Inviter quelqu'un » : un champ **@login GitHub**, un projet parmi ceux dont l'utilisateur est propriétaire (une puce par projet actif, une seule choisie), un rôle (lecture seule, peut valider, peut valider et lancer ; peut valider par défaut), « Créer le lien d'invitation ». Cockpit lit le compte sur GitHub (`GET /users/{login}`) et garde son identifiant numérique : seul ce compte pourra accepter, même renommé. Le lien `/invitations/<secret>` est montré **une seule fois**, avec « Copier » ; le secret est gardé haché (015). Une invitation vaut **7 jours** et ne sert qu'une fois. Refus en français : login inconnu sur GitHub, déjà membre, déjà invité sur ce projet, c'est toi |
| E | Accepter | `/invitations/<secret>` demande la connexion si besoin (retour sur le lien), puis montre « `@proprio` t'invite sur `owner/repo`, rôle : peut valider » et « Accepter ». Accepter vérifie le compte (C) et l'accès GitHub (C), ajoute le membre et efface l'invitation. Une invitation expirée, déjà servie, annulée ou destinée à un autre compte dit la même chose, sans détail : « Ce lien d'invitation n'est plus valable. Demande-en un nouveau. » L'invité trouve le projet dans « Tous les projets », marqué « partagé par `@proprio` · <rôle> » |
| F | La liste des membres (S48) | Phrase d'état : « N personnes voient tes projets partagés. » / « Chacune ne voit que ce que tu lui partages. » (aucune : « Personne ne voit tes projets. » / « Invite quelqu'un sur un de tes projets. »). Liste : toi d'abord (« propriétaire · N projets »), puis une ligne par membre et par projet (« `<nom>` · `<projet>` · `<rôle>` · actif il y a 1 h », d'après sa dernière connexion) avec « Modifier » (changer le rôle, ou « Retirer » après confirmation), puis une ligne par invitation en attente (« @login · `<projet>` · invitation créée il y a 2 j ») avec « Nouveau lien » (l'ancien ne vaut plus rien) et « Annuler ». Retirer un membre retire aussi ses US de ce projet de sa file et de sa nuit ; un run déjà lancé continue |
| G | Ce que l'invité voit ailleurs | Les écrans existants se fondent déjà sur l'appartenance (accueil, Kanban, recherche, notifications) : un projet partagé y entre tel quel. Le projet porte son `role` dans ce que rend le serveur ; sur la page de l'US, le Kanban et l'onglet Santé, les boutons d'un geste que le rôle ne permet pas sont masqués. Partout ailleurs, le refus du serveur s'affiche : « Ton rôle sur ce projet ne le permet pas. » |
| H | L'administrateur | Il ne voit pas les projets des autres (inchangé). Réglages › Instance, la liste des utilisateurs (012 G) gagne pour chacun la **dernière connexion** et le **nombre de projets** dont il est membre |
| I | L'historique | Créer, renouveler, annuler, accepter une invitation, changer un rôle et retirer un membre sont des actions journalisées (010), sur le projet, sans le login de l'invité dans `args` (010 D : des identifiants, pas de données personnelles) |
| J | L'import | Inchangé : un repo déjà suivi est refusé avec le message neutre de la 008 (« Ce repo est déjà suivi dans Cockpit ») ; on y entre par une invitation |

## Ce qui ne change pas

- L'inscription reste ouverte (012 G, 064 13.1 C) : l'invitation sert à partager un projet, pas à entrer dans Cockpit.
- Aucun e-mail : Cockpit ne fait que créer le lien.
- Le propriétaire ne change pas : pas de transfert de propriété dans cette tranche.

## Limites connues

- **Un seul projet par invitation** : S48 montre des puces, une seule est choisie ; inviter sur deux projets fait deux liens.
- **L'accès GitHub n'est lu qu'à l'acceptation** : un collaborateur retiré sur GitHub plus tard reste membre dans Cockpit jusqu'à ce que le propriétaire le retire.
- **Pas de « Quitter le projet »** pour un membre : le propriétaire le retire.
