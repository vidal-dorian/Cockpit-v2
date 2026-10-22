# Cockpit v2 — Brief du projet

> **À lire en premier par Claude.** Ce document décrit **ce que** Cockpit doit faire et **pourquoi**. Il ne dit pas **comment** le faire : l'architecture, la stack, le modèle de données, le découpage et l'ordre de construction sont à décider **avec Dorian**, en discutant, avant d'écrire du code. Ne pas reprendre les choix de la v1 sans en parler d'abord.

---

## 1. Pourquoi une v2

La v1 de Cockpit existe. Elle a été construite en quatre jours (du 12 au 15 octobre 2026) presque entièrement par Claude : environ 390 fichiers, 84 commits, 16 migrations de base, une trentaine d'outils MCP. Dorian n'a pas relu ce code et ne sait pas comment l'application fonctionne de l'intérieur.

La v2 refait **le même produit**, mais :

- **compris** : Dorian doit pouvoir expliquer chaque partie, chaque règle et chaque choix ;
- **organisé** : une structure claire, des décisions écrites avec leur raison ;
- **réfléchi** : chaque fonctionnalité est remise en question avant d'être reconstruite. La v1 en a accumulé beaucoup en peu de temps, et toutes ne valent peut-être pas leur complexité (voir §10).

---

## 2. Le produit en bref

Cockpit est un **centre de contrôle auto-hébergé** pour tous les repos GitHub que Dorian fait avancer avec Claude Code.

Le cœur, c'est une boucle :

```
Idée (ticket) ──► User stories ──► Validation ──► Développement ──► Pull request ──► Merge
   l'humain        Claude            l'humain       Claude Code        l'humain relit   l'humain, sur GitHub
```

1. Dorian note une **idée** sur un projet, à n'importe quel moment, y compris depuis son téléphone.
2. Claude la découpe en une ou plusieurs **user stories**, chacune avec des critères d'acceptation Given/When/Then.
3. Dorian **valide** chaque user story, ou la renvoie avec un commentaire pour qu'elle soit réécrite.
4. Dorian lance **Claude Code** sur une user story validée, sur son PC (en local) ou dans le cloud. Claude écrit d'abord les tests, puis le code, fait relire le résultat et ouvre une pull request.
5. Dorian **suit le travail** étape par étape, répond aux questions de Claude, peut l'arrêter ou le relancer.
6. Dorian relit la pull request et la **merge à la main sur GitHub**. Cockpit voit le merge et marque la user story comme terminée.

Tout ce que Claude fait passe par le **serveur MCP de Cockpit** et laisse une trace dans un **historique** complet et inaltérable.

En plus de cette boucle, Cockpit sert à **configurer Claude Code** sur chaque repo (`CLAUDE.md`, règles, agents, skills, serveurs MCP) et à vérifier que chaque repo est prêt pour que Claude y travaille.

---

## 3. Pour qui, où

- **Utilisateur principal** : Pour tout développeur souhaitant une interface complète afin de manager ses repos ainsi que le développement de chacun d'eux avec claude.
- **Hébergement** : un **service en ligne**, joignable depuis Internet (nécessaire pour recevoir les webhooks GitHub et pour que les sessions cloud de Claude appellent Cockpit). Sur un Raspberry Pi (Docker) tant que seuls Dorian et des proches l'utilisent, chez un hébergeur dès les premiers clients payants ([décision 008](docs/decisions/008-service-en-ligne.md)).
- **Usage** : Autant sur l'ordinateur que sur téléphone. La version sur ordinateur sera biensur la plus importante car l'essentiel se passera dessus.
- **Langue** : interface en français. Code, commentaires, messages de commit et prompts des agents et skills en anglais.

---

## 4. Vocabulaire

| Terme | Sens |
|---|---|
| **Projet** | Un repo GitHub suivi par Cockpit. |
| **Ticket** | Une idée brute, en texte libre, notée par l'humain. Elle n'existe que dans Cockpit. |
| **User story (US)** | Un morceau de ticket assez petit pour être développé et relu seul : « En tant que…, je veux…, afin de… », des notes, et des critères d'acceptation. Un ticket donne une ou plusieurs US. Chaque US est publiée en issue GitHub une fois qu'elle est validée par l'humain. |
| **Critère d'acceptation** | Un Given/When/Then. Pendant le développement, Claude dit s'il est validé ou non, avec une preuve (test, lien de CI…). |
| **Run** | Un développement d'une US par Claude Code, en local ou dans le cloud. |
| **Étape** | Une partie d'un run, faite par un agent (écriture des tests, développement, relecture…). |
| **Question** | Une décision que Claude pose à l'humain pendant un run. Le run attend la réponse. |
| **Routine** | Un travail que Claude refait régulièrement, par exemple écrire chaque matin les US des nouveaux tickets. |
| **Historique / Journal** | La trace de tout ce qui s'est passé : actions de l'humain, appels de Claude, événements GitHub. |
| **Configuration repos** | La configuration minimale qu'il doit y avoir sur le repo pour que Claude y travaille avec Cockpit. |
| **Jeton MCP** | La clé avec laquelle Claude Code s'identifie auprès de Cockpit. |

---

## 5. Les cycles de vie (les règles du métier)

### Ticket

L'étape d'un ticket **se déduit de ses user stories**. Elle n'est pas choisie à la main.

| Étape | Signification |
|---|---|
| Nouveau | Pas encore de user story : il attend que Claude l'écrive. |
| À valider | Au moins une US attend la validation (ou une réécriture). |
| Validé | Toutes ses US sont validées, aucune n'est commencée. |
| En cours | Au moins une US est en développement. |
| Terminé | Toutes ses US sont terminées ou abandonnées, et au moins une est terminée. |
| Abandonné | Décidé par l'humain, ou automatiquement quand toutes ses US sont abandonnées. |

### User story

```
                 ┌──── à réécrire ◄──┐
                 ▼                   │ (l'humain, avec un commentaire)
(Claude) ──► à valider ──────────────┘
                 │ (l'humain valide)
                 ▼
               prête ──► en cours ──► en revue ──► terminée
                 └──────────── abandonnée (depuis n'importe quel état) ────────────┘
```

**Qui a le droit de faire quoi** : c'est la règle centrale du produit.

| Transition | Qui |
|---|---|
| Créer une US (« à valider ») | Claude |
| Valider (« prête ») | **l'humain seulement** |
| Renvoyer en réécriture | **l'humain seulement**, commentaire obligatoire |
| Réécrire une US renvoyée | Claude |
| Démarrer le développement (« en cours ») | Claude, au début d'un run |
| Ouvrir la pull request (« en revue ») | Claude |
| Run échoué ou arrêté avant la PR → retour à « prête » | Claude ou l'humain |
| PR mergée → « terminée » | **GitHub uniquement** (le merge) |
| PR fermée sans merge → retour à « prête » | GitHub |
| Abandonner | **l'humain seulement** |

Claude ne peut **jamais** valider, terminer ou abandonner une user story.

---

## 6. Fonctionnalités

Les fonctionnalités sont regroupées par domaine. La v1 les avait toutes. Ce qui relève du **cœur** de la boucle est distingué de ce qui a été **ajouté ensuite** (finitions, automatisations, multi-utilisateur), pour aider à prioriser.

### 6.1 Projets — cœur

- Ajouter un projet de deux façons : **importer** un repo GitHub existant, ou **créer** un nouveau repo à partir d'un repo modèle.
- Voir tous les projets au même endroit, avec leur état : santé, nombre d'US par statut, pull requests ouvertes, dernière activité.
- Archiver un projet. (seulement sur l'application cockpit, aucune modification ne sera réalisée sur le GitHub)
- **Bilan de santé** d'un projet, ligne par ligne, vert ou rouge :
  - un `CLAUDE.md` existe ;
  - une CI existe ;
  - le webhook de Cockpit est installé et sa dernière livraison a réussi ;
  - le serveur MCP de Cockpit est déclaré dans le repo, sans secret en clair ;
  - les agents et le skill de développement sont disponibles. Si ils ne le sont pas, il sont ajoutables de manière simple au projet.

  Chaque ligne rouge qu'un commit peut corriger propose sa correction.
- **Préparer pour Claude en un clic** : un seul commit qui ajoute tout ce qui manque, montré fichier par fichier avant d'être fait, sans rien écraser.
- Gérer un **repo modèle** prêt pour Claude Code. Cockpit peut le créer s'il n'existe pas, et vérifier qu'un nouveau projet qui en part naît avec un bilan vert.

### 6.2 Tickets — cœur

- **Capture rapide** depuis n'importe quel écran : un titre et un projet suffisent.
- Description en markdown, priorité, tags.
- **Pièces jointes** (images, PDF, texte) que Claude peut lire quand il écrit les US.
- Modifier et supprimer un ticket.
- **Recherche** plein texte sur les tickets et les US.
- **Importer les issues GitHub existantes** d'un repo : une issue déjà écrite comme une user story devient un ticket avec son US validée ; une autre issue ouverte devient un ticket qui attend ses US. L'import n'écrit rien sur GitHub et peut se relancer sans créer de doublons.

### 6.3 User stories — cœur

- Page d'une US : le récit (en tant que / je veux / afin de), les notes, les critères avec leur résultat et leur preuve.
- **Valider**, **modifier**, **demander une réécriture** (avec un commentaire), **abandonner**.
- **Tableau Kanban** par projet : à valider, prêtes, en cours, en revue, terminées. On ne peut pas déplacer de cartes. Cela forcera l'utilisateur à ouvrir l'US afin de la relire avant de la valider.
- **Publication en issue GitHub** : chaque US devient une issue, générée par Cockpit à partir d'un gabarit unique et tenue à jour (contenu, label de statut, ouverture et fermeture). L'US se modifie dans Cockpit, pas sur GitHub. Si quelqu'un modifie l'issue directement sur GitHub, Cockpit le signale avec le diff, sans rien fusionner en silence. L'utilisateur choisira alors si il veut remplacer l'issue qu'il a sur l'application Cockpit par l'issue présente sur le GitHub ou s'il préfère conserver celle présente sur Cockpit et remplacer celle présente sur le GitHub.
- Historique de l'US, où les actions de Claude se distinguent de celles de l'humain.

### 6.4 Écriture des user stories par Claude — cœur

- Claude récupère les tickets qui n'ont pas encore d'US, et les US renvoyées en réécriture avec le commentaire de l'humain.
- Pour chaque ticket, il lit le contexte du projet (`CLAUDE.md`), le découpe en US assez petites pour être développées et relues seules, avec des critères qui peuvent devenir des tests automatisés.
- Il crée **toutes les US d'un ticket d'un coup** (tout ou rien). Une US sans critère ou avec un champ vide est refusée.
- Un ticket n'est écrit qu'une fois.
- Cela tourne soit automatiquement (une routine, par exemple chaque matin), soit à la demande dans une session Claude Code (skill `/write-us`, agent `analyst`).

### 6.5 Lancer un développement — cœur

- Sur une US prête, **« Développer avec Claude »** ouvre une fenêtre de lancement :
  - la **cible** : local (sur le PC) ou cloud ;
  - le **modèle** ;
  - le **mode de permission** de la session (normal, accepter les modifications, plan, automatique…) ;
  - la **branche** : une nouvelle, nommée selon une convention et créée sur GitHub, ou une existante ;
  - un **prompt complémentaire** facultatif ;
  - un **plafond de budget** facultatif.
- La fenêtre rappelle les dépendances non terminées, sans rien interdire.
- En local, une session Claude Code s'ouvre dans le clone du repo, avec la commande de développement prête. Un bouton « Copier le prompt » sert de secours.
- Dans le cloud, la session démarre seule si c'est configuré. Sinon, Cockpit donne la commande à lancer.
- **Sans bouton** : on peut aussi dire à Claude, dans n'importe quelle session, « développe le ticket que j'ai ajouté tout à l'heure sur X ». Il le retrouve par le MCP, et le suivi est le même.
- **Un seul run actif à la fois** par US.

### 6.6 Le développement lui-même (skill `/dev-us` et ses agents) — cœur

Ce sont des fichiers de configuration Claude Code (skill et agents), pas du code de Cockpit. Ils font partie du produit. Cockpit les fournit dans un catalogue et les installe dans les repos.

1. **Vérifications préalables** (en local) : bon repo, arbre de travail propre, branche par défaut à jour. Cockpit ne voit pas le PC : c'est la session qui vérifie et qui rend compte.
2. Lire l'US. Refuser de continuer si elle n'est pas prête.
3. Démarrer le run dans Cockpit et passer sur sa branche.
4. Agent **test-writer** : écrit les tests d'acceptation à partir des critères, **avant** le code. À ce stade, ils doivent échouer.
5. Agent **developer** : implémente jusqu'à ce que les tests passent.
6. Agent **reviewer** : relit le diff avec un contexte neuf (il n'a pas écrit le code), au regard des critères et du `CLAUDE.md`. Les problèmes trouvés sont corrigés.
7. Lancer tous les tests et le lint, puis rendre compte de chaque critère avec sa preuve.
8. Pousser, ouvrir la pull request (qui ferme l'issue et renvoie vers l'US dans Cockpit), la déclarer à Cockpit, clore le run.
9. **Ne jamais merger.**

Pendant tout le run, Claude signale le début et la fin de chaque étape, obéit à une demande d'arrêt, et pose une question à l'humain quand une décision lui revient.

### 6.7 Suivre un run — cœur

- Page du run, mise à jour en direct : US, cible, modèle (demandé et réel), branche, statut, durée, coût.
- **Étapes par agent**, avec leur statut et leur résumé.
- **Questions de Claude**, avec un champ de réponse. Le run reprend dès qu'il y a une réponse.
- **Arrêter** : c'est une demande. Claude la lit à sa prochaine étape et s'arrête. Cockpit ne peut pas tuer une session.
- **Relancer avec un commentaire** : un nouveau run sur la même branche.
- Fermer à la main un run dont la session ne répond plus.
- **Aide à la décision** en fin de run : chaque critère avec son résultat et sa preuve, l'état de la CI, et un verdict « acceptable » ou « à vérifier » avec les raisons.

### 6.8 Pull request, CI, revue, déploiement — cœur

- Cockpit suit la PR d'une US grâce aux **webhooks GitHub** : ouverte, mergée, fermée, rouverte ; état de chaque contrôle de CI (avec un lien) ; état de la revue ; résultat du déploiement après le merge.
- **Merge → US terminée**, fermeture sans merge → US de nouveau prête.
- Bloc GitHub sur la page de l'US : issue, branche, PR, CI, revue, déploiement, et un gros bouton « Ouvrir la PR sur GitHub ».
- **Actualiser** : relire la PR sur GitHub quand un webhook a été manqué.
- **Supprimer la branche** d'une US mergée, sur clic seulement, après avoir revérifié sur GitHub que rien ne serait perdu.
- **Changelog** par projet : les US terminées, par date de merge.

### 6.9 Configuration Claude Code des repos — cœur

- Modifier, depuis Cockpit, la configuration Claude de chaque repo : `CLAUDE.md`, règles (`.claude/rules/`), agents, skills, serveurs MCP (`.mcp.json`).
- Chaque enregistrement est **un commit sur GitHub**, avec le **diff montré avant**. Si le fichier a changé sur GitHub entre-temps, rien n'est écrasé.
- Éditeur d'agent : nom, description, outils, **modèle**, prompt, avec un aperçu du fichier généré.
- Éditeur de skill, sur le même modèle.
- Configuration **globale** : les agents et skills communs à tous les projets vivent dans un repo de plugins Claude Code personnel, éditable de la même façon.
- **Catalogues** livrés avec Cockpit : agents prêts à l'emploi (analyst, test-writer, developer, reviewer, doc-writer, security-reviewer…), skills (`/write-us`, `/dev-us`), serveurs MCP courants. Ajouter un élément du catalogue copie son fichier dans le repo. Une nouvelle version est proposée aux copies non modifiées, et n'écrase jamais une copie modifiée.
- Les secrets ne sont jamais écrits dans un repo : seulement des références à des variables d'environnement.

### 6.10 CI/CD — ajouté ensuite

- Lister les workflows GitHub Actions d'un projet.
- Proposer une **CI de départ** adaptée au repo (Node, Python, Go, Rust…), montrée avant d'être commitée.
- **Claude propose, l'humain committe** : Claude peut suggérer un changement de workflow avec sa raison, mais ne le commite jamais (un workflow s'exécute avec les secrets du repo, et une CD déploie). L'humain le voit avec son diff et choisit de le committer ou de le refuser.

### 6.11 Serveur MCP — cœur

C'est la porte par laquelle Claude Code travaille avec Cockpit. Ses outils doivent être décrits de façon à ce que Claude trouve les choses à partir de demandes vagues (« le truc de connexion sur GestionProjet »). Grandes familles :

- **Lire et chercher** : projets (avec leur `CLAUDE.md`), tickets, US, pièces jointes, branches.
- **Créer** : un ticket, une note dans l'historique d'un ticket ou d'une US.
- **Écrire les US** : les tickets qui attendent, créer toutes les US d'un ticket, réécrire une US renvoyée.
- **Développer** : démarrer un run, rendre compte d'une étape (la réponse dit si l'arrêt est demandé), rendre compte d'un critère, poser une question et lire sa réponse, déclarer la PR, clore le run.
- **Routines** : lire ce qu'un passage doit faire, le clore. Gérer les routines depuis une session ouverte par l'humain.
- **Workflows** : les lire, proposer un changement.

Ce qu'**aucun** outil ne peut faire : valider, terminer ou abandonner une US ; merger ; supprimer une branche ; modifier ou effacer l'historique ; committer un workflow.

Chaque utilisateur a ses jetons, par usage (routines / sessions de développement) et par machine, révocables un par un. Un jeton ne s'affiche qu'une fois et ne donne accès qu'aux projets dont son utilisateur est membre. La configuration de ses jetons doit être **la plus simple possible** afin de faciliter la prise en main de l'application.

### 6.12 Historique et journal — non négociable

- **Chaque appel MCP laisse une entrée**, sans exception : lectures et écritures, réussites, erreurs et refus (jeton invalide, transition interdite, outil inconnu…).
- Une entrée garde : la date, l'auteur (humain, Claude, GitHub, système), l'origine (interface, routine, session locale, session cloud, webhook), l'outil, les arguments (secrets masqués), le résultat, les effets sur GitHub.
- Les actions de l'humain et les événements GitHub vont dans le même historique.
- **Inaltérable** : rien ne peut modifier ou supprimer une entrée, ni depuis l'interface ni depuis le MCP.
- **Pas d'action sans trace** : une modification et son entrée sont enregistrées ensemble.
- La journalisation ne coûte rien en crédits Claude.
- Historique visible sur chaque projet via un onglet afin de ne pas polluer l'interface de développement, ticket, US et run, plus un **journal global** filtrable (projet, outil, origine, auteur, résultat, période).

### 6.13 Accueil — cœur

L'accueil répond à une question : **qu'est-ce qui m'attend ?**

- **À toi de jouer** : tout ce qui est bloqué tant que l'humain n'a pas agi. US à valider, questions de Claude, runs en échec ou à vérifier, PR à relire (et celles dont la CI échoue), changements de workflow proposés. Chaque élément mène à l'endroit où agir.
- **Claude travaille** : les runs en cours et leur étape.
- **Routines** : le dernier passage de chacune.
- **Projets** : leur état.
- Dans la barre latérale, une pastille par projet indique s'il attend l'humain ou si Claude y travaille.
- L'interface doit être travaillée notamment coté UX afin d'avoir une bonne compréhension de l'application même lors qu'on ne connait pas l'application. Elle doit etre simple de navigation. Cet accueil doit proposer de manière claire, chaque information dont l'utilisateur a besoin.

### 6.14 Routines — ajouté ensuite

- Une routine a un nom, une consigne (texte libre ou skill), un ou plusieurs agents, un modèle, des projets et une planification.
- On peut la créer (à la main ou depuis un modèle prêt à l'emploi, comme « Écrire les US de mes tickets »), la modifier, la mettre en pause, la supprimer et la lancer tout de suite.
- **Cockpit tient le planning**, et un « lanceur » cloud exécute chaque passage (voir les contraintes en §8).
- Un seul passage à la fois par utilisateur. Un passage sans nouvelles après un délai est compté en échec.
- Chaque passage est suivi : durée, résultat, message d'erreur, lien vers le journal filtré sur ce qu'il a fait.
- Claude peut gérer les routines, mais une routine qu'il crée **naît en pause**, et seul l'humain l'active. Un passage de routine ne peut modifier aucune routine (protection contre l'injection de consignes par un ticket ou une pièce jointe).

### 6.15 Automatisations — ajouté ensuite, désactivées par défaut

- **Relance automatique** : quand la CI d'une PR échoue ou qu'une revue demande des changements, Cockpit relance Claude sur la même branche, avec l'échec comme consigne. Il s'arrête après un nombre de relances d'affilée et prévient l'humain.
- **File d'attente** : l'humain met des US prêtes en file, dans un ordre qu'il peut changer. Cockpit les lance une par une, en sautant celles qui attendent une dépendance (et en disant pourquoi). La file se met en pause. **Enchaîner les US d'un même projet dans la même conversation Claude** ; un échec met la file en pause.
- Les runs que Cockpit prépare seul reçoivent le plafond de budget par défaut.

### 6.16 Coût et budget — ajouté ensuite

- Coût et tokens de chaque run, remontés par la télémétrie de Claude Code.
- Plafond par run (prérempli depuis les réglages). Quand il est atteint, Cockpit demande l'arrêt du run et prévient l'humain.

### 6.17 Notifications sur le téléphone — ajouté ensuite

- Question de Claude, run en échec ou à vérifier, plafond atteint, relances épuisées, PR à relire, changement de workflow proposé.
- Chaque type peut être coupé. Un tap ouvre l'endroit où agir. Un bouton envoie une notification de test.

### 6.18 Brancher les machines — ajouté ensuite

- **Brancher un PC en une commande** : la commande installe Claude Code s'il manque, l'humain approuve le PC dans Cockpit avec un code court (comme `gh auth login`), et le PC reçoit son propre jeton, sans qu'aucun secret passe par la commande ni par l'historique du terminal.
- Configurer les environnements cloud (jetons et variables à coller sur claude.ai).
- Page **« Mise en route »** : un guide pas à pas, écrit pour quelqu'un qui n'a jamais ouvert un terminal, dont chaque étape se coche toute seule dès que Cockpit en voit l'effet.
- Tous les jetons MCP peuvent être créés indépendamments, et peuvent être regénérés indépendamments aussi.

### 6.19 Plusieurs utilisateurs — ajouté ensuite

- Connexion avec GitHub, sur invitation (l'administrateur est le seul à entrer sans invitation).
- Chacun choisit sur GitHub les repos qu'il ouvre à Cockpit. Cockpit agit toujours avec l'accès GitHub de l'utilisateur concerné, jamais avec un accès à lui.
- **Isolation stricte** : chacun ne voit que ses projets, ses jetons, ses routines et ses réglages. L'administrateur non plus ne voit pas les projets des autres.
- Un projet peut être partagé avec un autre utilisateur.
- L'administrateur invite, voit l'activité des comptes et peut en désactiver un.

### 6.20 Ergonomie — finitions

- Raccourcis clavier sur tous les écrans (nouveau ticket, recherche, changer de projet, aller à un écran, aide).
- Recherche globale.
- Thème clair et sombre, qui suit le système et se force à la main.

---

## 7. Principes non négociables

Ces règles valaient pour la v1 et restent valables. Elles sont le fondement de la confiance qu'on peut accorder à l'outil.

1. **L'humain garde la main sur ce qui compte.** Valider ou abandonner une US, merger, committer un workflow, activer une routine créée par Claude : ce sont des décisions humaines.
2. **Cockpit ne merge jamais.** Il ne supprime aucun repo. La seule suppression qu'il sait faire est celle de la branche d'une US mergée, sur clic, après vérification.
3. **Cockpit n'écrit dans un repo que de la configuration**, toujours après avoir montré le diff, et sans jamais écraser en silence un fichier modifié entre-temps.
4. **Historique exhaustif et inaltérable** (§6.12).
5. **Aucun secret** dans un repo, un log ou l'historique. Les jetons ne s'affichent qu'une fois.
6. **Chaque donnée a une seule source de vérité.** Cockpit garde ce qui lui est propre (projets, tickets, US, runs, historique). GitHub garde le code, la configuration Claude, les PR, la CI. L'issue GitHub d'une US n'est qu'un rendu de ce qui est dans Cockpit.
7. **Les erreurs se voient.** Un échec de GitHub ou du MCP s'affiche clairement, jamais d'écran vide ou d'erreur avalée. Ce qui a échoué peut être retenté.
8. **Un seul run actif par US.**
9. **Les tests n'appellent jamais Claude ni le vrai GitHub.**

---

## 8. Contraintes de l'écosystème (constatées en v1, à revérifier)

> **Mise à jour du 2026-10-22** : plusieurs de ces faits ont changé. Le lancement local passe par `claude://code/new` ([005](docs/decisions/005-lancement-local.md)) ; une session cloud reçoit les connecteurs claude.ai ([006](docs/decisions/006-connexion-oauth.md)) ; les routines (lancées par planning, par API ou par un événement GitHub) existent nativement dans Claude Code depuis avril 2026 ([annonce relayée par The Decoder](https://the-decoder.com/claude-code-routines-let-ai-fix-bugs-and-review-code-on-autopilot/)), ce qui rend à revoir le contournement de la v1 décrit ci-dessous. Les décisions font foi ; l'état d'ensemble est dans [`docs/architecture.md`](docs/architecture.md).

Ces faits viennent de la documentation de Claude Code lue en octobre 2026. Ils ont façonné la v1, souvent en forçant des contournements complexes. **Ils peuvent avoir changé : à revérifier avant de concevoir quoi que ce soit dessus.**

- **Routines** : Claude Code ne permet pas de créer, modifier ou mettre en pause une routine par programme. On peut seulement **déclencher** une routine existante qui a un déclencheur API. D'où, en v1, un « lanceur » générique créé une fois à la main, et un planning tenu par Cockpit.
- **Sessions cloud** : pas d'API pour démarrer une session cloud sur un repo quelconque. En v1 : un lanceur (routine) par projet, ou la commande `claude --cloud` à lancer soi-même.
- **Lancement local** : le lien `claude-cli://` ouvre un terminal Claude Code avec le prompt prérempli mais **pas envoyé**. Le repo doit avoir déjà été ouvert dans Claude Code, et le prompt est limité à 5 000 caractères. Le lien ne fixe ni le modèle ni le mode, d'où un protocole `cockpit://` maison sous Windows en v1.
- **Une session cloud** ne charge que le `.claude/` et le `.mcp.json` du repo cloné, aucun plugin. Son environnement doit autoriser le domaine de Cockpit.
- **Le modèle ne peut pas être imposé** à une session. Elle dit sur quel modèle elle tourne, et Cockpit signale une différence.
- **Cockpit ne peut pas tuer une session** : l'arrêt est forcément coopératif.
- **Le coût** n'est connu que par la télémétrie OpenTelemetry de Claude Code. C'est une estimation au prix catalogue.
- **Webhooks, routines et sessions cloud** exigent que Cockpit soit joignable depuis Internet.
- **GitHub** : une GitHub App (plutôt qu'une OAuth App) est ce qui permet à chacun de choisir ses repos. Avec cet accès, les tableaux GitHub Projects personnels ne sont pas lisibles.

---

## 9. Hors périmètre

- Reproduire la configuration propre de Claude Code : permissions, hooks, `settings.json`. Le choix du modèle d'un run ou d'un agent et le `.mcp.json` d'un projet **sont** dans le périmètre.
- Écrire dans la mémoire automatique de Claude Code.
- Déployer quoi que ce soit : chaque projet a sa propre CI/CD.
- Merger des pull requests.
- Organisations et rôles avancés. Plusieurs membres sur un même projet sont en revanche prévus par le modèle de données ([décision 008](docs/decisions/008-service-en-ligne.md)), avec un seul membre par projet au MVP.
- Piloter l'application Claude Desktop.

---

## 10. À re-décider pour la v2

> **Mise à jour du 2026-10-22** : ces points sont tranchés dans [`docs/decoupage.md`](docs/decoupage.md) (périmètre du MVP, plusieurs utilisateurs, cloud) et dans [`docs/decisions/`](docs/decisions/) (stack, base, hébergement). Le résumé est dans [`docs/architecture.md`](docs/architecture.md).

La v1 a tout construit d'un coup. Pour la v2, ces points sont à trancher avec Dorian **avant** de construire, en commençant par la question du périmètre minimal.

- **Quel est le plus petit Cockpit vraiment utile ?** Probablement la boucle cœur (§6.1 à §6.9, §6.11 à §6.13), d'abord en local seulement.
- **Plusieurs utilisateurs** : nécessaire, ou un seul utilisateur suffit-il ? C'est l'une des sources de complexité les plus lourdes de la v1 (isolation partout, GitHub App par utilisateur, invitations).
- **Routines et lanceurs** : le contournement de la v1 (planning dans Cockpit, lanceur cloud) vaut-il sa complexité ? Faut-il revérifier ce que Claude Code permet aujourd'hui ?
- **Cloud** : faut-il lancer des sessions cloud depuis Cockpit, ou le local suffit-il au début ?
- **Automatisations** (relance auto, file d'attente, enchaînement dans la même conversation), **coût et budget**, **notifications**, **CI/CD proposée par Claude**, **branchement des machines en une commande** : lesquelles sont indispensables, lesquelles peuvent attendre ?
- **Configuration globale** (repo de plugins) et **catalogues** : à garder tels quels ou à simplifier ?
- **Stack technique** : pour information, la v1 utilisait Next.js (App Router, TypeScript), SQLite avec Drizzle, Tailwind et shadcn/ui, Octokit, le SDK MCP officiel, et Docker sur le Raspberry Pi. Rien de cela n'est imposé.
