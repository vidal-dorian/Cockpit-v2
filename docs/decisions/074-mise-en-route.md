# 074 — La mise en route

- **Statut** : proposée (à valider à la relecture de la PR) ; le code est construit (tranche 15.4)
- **Date** : 2026-11-09
- **Décidé par** : Dorian, avec Claude ([064](064-tranches-restantes.md) 15.4)
- **Dépend de** : [012 — Configuration automatique](012-configuration-automatique.md) (H, la page Bienvenue), [021 — Connecter Claude](021-connecter-claude.md), [027 — Préparer pour Claude](027-preparer-pour-claude.md), [040 — Accueil](040-accueil.md), [045 — L'interface « Quatre temps » et les écrans de référence](045-interface-quatre-temps.md)
- **Tranche** : 15.4 du [découpage](../decoupage.md)
- **Écran** : [S06](../ecrans/S06_MiseEnRoute.png)

## Contexte

La 064 15.4 a tranché le guide : les sept étapes de S06, dans l'ordre, chacune cochée d'après ce qui est déjà en base, en haut de l'accueil tant qu'il n'est ni fini ni masqué, et à la place de la page Bienvenue (S04) une fois l'App installée. Aujourd'hui, un nouvel utilisateur passe par Bienvenue (012 H, tant que l'App n'est pas installée sur son compte), puis arrive sur un accueil vide qui dit « Rien ne t'attend. ».

## Les choix

| # | Question | Décision |
|---|---|---|
| A | Les sept étapes et ce qui les coche | 1. **Ouvrir des repos à Cockpit** : l'App est installée sur le compte (ce que lit déjà `GET /api/installation`). 2. **Importer un premier projet** : l'utilisateur est membre d'au moins un projet. 3. **Connecter Claude** : il a au moins un jeton MCP non révoqué, ou une connexion OAuth (015, 021). 4. **Préparer un repo pour Claude** : au moins un commit de « Préparer pour Claude » (027) sur un de ses projets. 5. **Noter une première idée** : au moins un ticket dans ses projets. 6. **Valider une user story** : au moins une US de ses projets validée (sortie de « à valider » par une décision humaine, 018). 7. **Développer avec Claude** : au moins une US avec une PR liée. Le calcul lit les lignes d'aujourd'hui, projets archivés compris |
| B | Où le serveur le calcule | Dans la charge de l'accueil, `GET /api/home`, un champ `onboarding` : les étapes 2 à 7 (oui / non, et un détail court quand il existe, par exemple le nom du premier projet), ou `null` quand le guide est fini ou masqué. L'étape 1 vient de `GET /api/installation`, déjà lue par la coque (`InstallBanner`) : pas de second appel à GitHub |
| C | L'affichage (S06) | Une section en haut de l'accueil, sous la phrase d'état : « Mise en route · 3 sur 7 », « Masquer ce guide » à droite, puis la liste des sept étapes dans l'ordre. Une étape faite : « ✓ », grisée, avec son détail. La première étape pas faite porte le bouton « Faire », qui mène à l'endroit où la faire (Bienvenue ou le lien d'installation, Tous les projets, Réglages › Connecter Claude, le premier projet non préparé, la barre d'idée, la première US à valider, la première US prête). Les suivantes sont en clair, numérotées. Dessous, « Pourquoi cet ordre » et la phrase de S06. Le reste de l'accueil suit, inchangé |
| D | La phrase d'état | Quand le guide est affiché **et que rien n'attend l'utilisateur**, la phrase de l'accueil devient celle de S06 : « Plus que 4 étapes avant ta première PR. » (« Plus qu'une étape… ») / « Chacune se coche toute seule quand elle est faite. » Sinon, la phrase de l'accueil reste (040) : une question de Claude passe avant le guide |
| E | « Masquer ce guide » | Gardé en base (`users.onboarding_hidden_at`), donc sur tous les appareils. Pas de « réafficher » : le guide ne sert qu'au début, et chaque étape reste faisable depuis son écran |
| F | Bienvenue (S04, 012 H) | Inchangée tant que l'App n'est pas installée sur le compte : c'est l'étape 1, qui demande un geste sur GitHub. Une fois l'App installée, l'accueil et son guide prennent le relais, comme la 064 le demande |

## Ce que le code a précisé (tranche 15.4)

- **La route et la migration** : `POST /api/me/onboarding/hide` (session, sans corps) pose `users.onboarding_hidden_at` et répond `{ ok: true }`, sans entrée d'historique (préférence de l'utilisateur, comme l'étoile et le thème, 073) ; migration `0045`. « Masquer ce guide » montre une ligne d'erreur s'il échoue.
- **Le champ `onboarding`** de `GET /api/home` (`onboardingOf`, `home.ts`) est `null` si le guide est masqué ou fini, sinon `{ steps }` : six lignes `{ key, done, detail, projectId, storyId }`, clés `project`, `claude`, `prepare`, `idea`, `validate`, `develop`. Seule l'étape 2 a un détail (le nom du premier projet).
- **L'étape 3** utilise `liveToken` (`tokens.ts`) : un jeton MCP non révoqué et non expiré. Une connexion OAuth dont le jeton de rafraîchissement a expiré ne compte pas.
- **L'étape 6** lit l'historique (`validate_story`, résultat `ok`) de l'utilisateur lui-même, sur ses projets, et non le statut : l'import d'une issue crée des US `ready` sans que personne ne les ait validées. La A dit « au moins une US de ses projets validée » ; le code ne compte que les validations de l'utilisateur, pas celles d'un autre membre.
- **Les cibles de « Faire »** : 1 → `/bienvenue` ; 2 → `/projets` ; 3 → `/reglages` ; 4 → `/projets/:id/sante` (l'onglet où vit « Préparer pour Claude ») du premier projet actif non préparé ; 5 → ouvre le panneau d'idée s'il y a un projet actif (la barre d'idée est cachée sous `md`), sinon `/projets` ; 6 et 7 → `/us/:id` de la première US à valider, puis de la première US prête. Les cibles ne sont prises que parmi les projets actifs ; le calcul des étapes compte aussi les archivés (A). Sans cible, « Faire » mène à `/projets`.
- **L'attente de `/api/installation`** : le guide et la phrase de S06 ne s'affichent pas avant que la requête ait répondu (ou échoué une première fois), pour qu'ils ne basculent pas ; un échec montre l'étape 1 non faite.
- **Pas construit** : les détails de S06 pour les étapes 1 et 3 (« 3 repos ouverts sur GitHub », « claude.ai · il y a 2 min »).

## Limites connues

- **Une étape peut se décocher** (A) si ce qui l'a cochée est supprimé (un jeton révoqué, une PR déliée) ; le guide revient alors tant qu'il n'est pas masqué.
- **L'étape 1 dépend de GitHub** : si `/api/installation` échoue, elle est montrée non faite, sans bloquer les autres.
- **Le guide ne se coche qu'au rechargement de l'accueil** : il suit la charge de l'accueil, rafraîchie par le flux des changements comme le reste.
- **Pendant que `/api/installation` est en attente**, le `h1` montre brièvement la phrase de l'accueil (« Rien ne t'attend. »), puis celle du guide.
- **L'étape 6 ignore les validations d'un autre membre** : un projet partagé dont un collègue a validé l'US ne la coche pas pour toi.
- **Le détail de l'étape 2 est le premier projet** (par identifiant), archivé ou non.
