# 045 — L'interface « Quatre temps » et les écrans de référence

- **Statut** : proposée (les écrans sont validés ; la coque et les écrans existants sont construits, tranche 9.3 ; à valider à la relecture de la PR ; le reste suit avec la tranche de chaque écran)
- **Date** : 2026-11-07
- **Décidé par** : Dorian, avec Claude
- **Dépend de** : [003 — Interface](003-interface.md), [028 — Style Crème sombre, onglets…](028-creme-sombre-onglets-journal.md), [040 — L'accueil](040-accueil.md), [044 — La nuit de Claude](044-la-nuit-de-claude.md)
- **Modifie** :
  - la [003](003-interface.md), section « Style visuel », et **rouvre l'une de ses pistes écartées**, la barre latérale (voir F) ; les règles d'ergonomie de la 003 restent ;
  - la [028](028-creme-sombre-onglets-journal.md), choix A à E (style, valeurs, formes, barre du haut, largeur des pages), G (onglets d'un projet) et H (onglets de Réglages) ; ses choix F, I et J restent (journal par pages, pas d'adresse publique dans Réglages ni dans l'assistant) ;
  - la [040](040-accueil.md), choix D : Cockpit a de nouveau une barre latérale, et la pastille d'un projet y est ;
  - la [019](019-kanban.md), choix B : le Kanban a six colonnes, la première est « Idées » (les tickets à l'étape `new`, écran S00b) ;
  - la [034](034-developper-avec-claude.md), choix A : « Développer avec Claude » s'ouvre dans le panneau de droite, plus en haut de la page ;
  - la [042](042-nouvelle-equipe-fenetre.md), choix A : « Nouvelle équipe » s'ouvre en plein écran, sur un canevas, plus dans une fenêtre modale ;
  - la [025](025-issue-modifiee-sur-github.md), choix F et G : les boutons sont « Garder la version Cockpit » et « Garder la version GitHub » ;
  - la [035](035-criteres-et-pr.md), choix F : « ✓ passe » / « ✕ échoue » et « PR #12 » ;
  - la [038](038-suivi-de-la-pr.md), choix G : « PR #12 » dans le bloc GitHub ;
  - la [027](027-preparer-pour-claude.md), choix F : le plan est une liste de fichiers avec un aperçu ;
  - la [031](031-equipe-en-graphe.md), choix F : un commutateur Graphe / Liste remplace la liste sous le graphe.
- **Modifiée par** : [053](053-journal-filtrable.md) : l'onglet Historique d'un projet (G) existe depuis la tranche 11.1
- **Modifiée par** : [046](046-logo-la-boucle.md) : le logo, repoussé ici, est tranché
- **Écrans** : [`docs/ecrans/`](../ecrans/README.md) (63 écrans, PNG et HTML), validés par Dorian le 2026-11-07
- **Tranche** : 9.3 du [découpage](../decoupage.md) pour la coque commune, puis la tranche de chaque écran

## Contexte

Le 2026-11-06, Dorian a écarté « Crème sombre » : trop proche du style de Claude, sans sa patte. Plusieurs pistes ont suivi sur le canevas : trois styles, un bureau à panneaux, une ville isométrique. Toutes ont été abandonnées. Une recherche sur les applications denses mais claires (Linear, Superhuman, GitHub, Vercel) a donné la page principale v6, puis un travail d'UX la v7, que Dorian a approuvée.

Il a ensuite demandé les quatre couleurs des profils DISC (v8), puis de les rationner, parce que tout avait l'air prioritaire (v9). La v9 a été retenue. Le 2026-11-07, chaque écran de chaque fonctionnalité a été maquetté dans ce style, puis validé : ce sont les écrans de `docs/ecrans/`.

## Les choix

| # | Question | Décision |
|---|---|---|
| A | La référence ? | Les écrans de [`docs/ecrans/`](../ecrans/README.md). Chaque ligne de l'index donne la tranche, les décisions et ce qui reste à trancher. Un écran montre le but ; quand il contredit une décision, la décision l'emporte et on le signale. Les données des écrans sont des exemples |
| B | Les couleurs ? | Les jetons de `src/web/styles.css` prennent ces valeurs. Neutres : `bg` `#0e1015`, `surface` `#161920`, `surface-sunken` `#12141a`, `surface-raised` `#1d2129`, `surface-hover` `#252a34`, `border` `#262b35`, `border-strong` `#343b48`, `ink` `#f2f4f8`, `ink-muted` `#a9b0bf`, `ink-dim` `#6f7787`, `on-ink` `#0e1015`, `past` `#4a5262`. Les **quatre temps** de la boucle, une couleur DISC chacun, en base, fond doux et texte : **idée** jaune (`#f5c542`, `#2e2716`, `#ffd873`) ; **à toi de décider** rouge (`#ff5d6e`, `#34181d`, `#ff8c98`, plus `you-line` `rgba(255,93,110,.55)` et `you-ground` `#1a1418`) ; **Claude développe** bleu-violet (`#7c8cff`, `#1c2044`, `#a9b4ff`) ; **terminé** vert (`#34d399`, `#11302a`, `#6ee7b7`). `error` vaut `you`. Aucun composant ne code une couleur en dur (003) |
| C | Le budget de couleur ? | Le **rouge** n'apparaît que pour **la chose à faire en premier, une seule à la fois** (« 1 · Maintenant », « À corriger d'abord ») et ce qui pointe vers elle (son run, son projet dans la barre latérale, son badge à droite). Le **bleu-violet** n'apparaît que sur le point qui pulse quand Claude travaille. Le **jaune** et le **vert** ne sont que des points de 7 px qui nomment un temps (colonnes du Kanban, logo) ; ce qui est terminé s'efface au lieu de devenir vert. Tout le reste est gris. Le bouton principal est blanc (`ink`), un seul par zone. Quand rien n'est urgent, l'écran n'a plus de rouge. La priorité se lit d'abord par la structure : la phrase d'état, puis « 1 · Maintenant », puis « 2 · Ensuite », puis « Claude en ce moment » |
| D | Les polices ? | **Urbanist** (400 à 700) pour le texte et les titres, **JetBrains Mono** pour les branches, fichiers, touches et le code, à la place de Geist et Geist Mono (028 A). Chiffres tabulaires. Corps à 14 px ; le haut de chaque page est une **phrase d'état** de 26 px, pas un titre ni un bonjour |
| E | Les formes ? | Cartes et listes : rayon 14 px ; boutons et champs : rayon 10 px, 34 px de haut (42 px en bas d'un panneau) ; badges en pilule. Bord d'un pixel. Pas d'ombre sur ce qui est posé ; les ombres sont pour ce qui flotte (fenêtre, bandeau « Annuler ») |
| F | La coque ? | En pleine largeur, à la place de la barre du haut et des conteneurs centrés (028 D et E). **À gauche, une barre latérale** de 224 px : « Chercher » (`Ctrl K`), Accueil (avec son compteur), Claude (point qui pulse), ☾ Cette nuit, les projets favoris avec leur pastille, Tous les projets, Importer un repo, Équipes d'agents, Journal, puis Réglages et le compte en bas. **Au centre**, ce que tu fais. **À droite**, un panneau de 380 px pour l'élément ouvert (une question, une US, un ticket…), avec le bouton principal en bas et « Plus tard ». **En bas du centre**, la barre « Noter une idée » (`N`), partout. La 003 avait écarté la barre latérale parce qu'elle faisait trop « application générique » ; on la rouvre parce qu'avec 50 projets et la nuit, la navigation doit rester visible, et ce sont la phrase d'état et le budget de couleur qui distinguent maintenant Cockpit |
| G | Les outils plein écran ? | Un outil qui a besoin de place s'ouvre en plein écran, sans barre latérale, avec un en-tête (retour, nom, « Annuler », action principale). Le premier est l'**éditeur d'équipe en canevas** (S38) : on glisse des agents, on trace des liens, on fait des boucles avec une limite, on intercale un agent sur un lien. Il remplace la fenêtre de la 042 A. **Les branches en parallèle et la condition écrite à la main (S38c) demandent leur propre décision** avant la tranche E6 : la 031 ne connaît que la suite et la boucle, et deux étapes en parallèle sur une même branche peuvent se gêner |
| H | Les onglets d'un projet ? | Kanban, Tickets, Conception, Santé, Agents, CI / CD, Historique, Réglages, dans cet ordre (à la place de la 028 G). L'écriture automatique des US passe dans les Réglages du projet. **Un onglet n'apparaît qu'avec sa tranche** : pas d'onglet sans fonction (même principe que la 028 D) |
| I | Réglages ? | Un menu à gauche de la page, à la place des onglets de la 028 H : Connecter Claude (les jetons MCP y sont), Tâches cloud (écriture des US, la nuit), Préférences, Membres, **Abonnement**, Données, Instance (l'administrateur seulement : branchements et utilisateurs). Même règle : une entrée n'apparaît qu'avec sa tranche. L'adresse publique reste en lecture seule (028 I) |
| J | Le téléphone ? | Une barre en bas, **la même sur chaque écran** : Accueil, Idée, Nuit, Projets. Les trois gestes de la 003 (point ouvert 4) sont maquettés : répondre à Claude, valider une US, noter une idée (S52 à S55) |
| K | Les mots ? | Français, tutoiement, phrases courtes. « Abonnement », jamais « offre », pour l'utilisateur. Une section dit pourquoi elle est là, un choix dit sa conséquence, un bouton désactivé dit pourquoi, juste à côté |

## Ce qui est repoussé

- **Le logo** : les écrans montrent quatre carrés aux couleurs des temps, une proposition. Le composant `Logo` (les deux mains, 028 D) reste jusqu'à ce qu'une décision tranche. → tranché par la [046](046-logo-la-boucle.md) : la boucle, que les écrans montrent depuis.
- **Le thème clair** : la 15.3. Les jetons sont nommés pour recevoir un second thème.
- **Les branches en parallèle dans une équipe** : une décision avant la tranche E6 (G).
- **Ce que chaque écran marque « à trancher »** dans l'index (prix de l'abonnement, rôles des membres, coût…) : décidé avec sa tranche.

## Limites connues

- **Les PNG sont des instantanés** : ils ne se mettent pas à jour tout seuls. Quand un écran change sur le canevas, il faut réexporter son PNG et son HTML dans `docs/ecrans/`.
- **Le code est en « Quatre temps »** depuis la tranche 9.3 : jetons, polices (Urbanist et JetBrains Mono), coque et écrans qui existaient. Le logo est la boucle de la [046](046-logo-la-boucle.md).

## Ce que la tranche 9.3 a laissé de côté

La 9.3 refait ce qui existe, avec les mêmes fonctions qu'avant. Ce dont la tranche n'est pas construite n'apparaît pas (H et I : pas d'entrée sans sa tranche) ou tient lieu d'un autre élément :

- **Chercher** (`Ctrl K`), la page **Claude** (tous les runs, la file), **Cette nuit** : pas dans la barre latérale.
- **Les favoris** : la barre latérale liste à leur place les projets qui ne sont pas au repos (ceux de `GET /api/home`).
- **La page Équipes d'agents** de la barre latérale.
- **Les onglets d'un projet Conception, CI / CD et Historique** : le projet a Kanban, Tickets, Santé, Agents et Réglages. La tranche R1 a ajouté Conception (entre Tickets et Santé, [043](043-carte-du-code.md)) ; CI / CD et Historique attendent leur tranche. *Historique est fait par la [053](053-journal-filtrable.md) en 11.1 (entre Agents et Réglages, `/projets/:id/historique`) ; CI / CD attend toujours.*
- **Les entrées de Réglages Préférences, Membres, Abonnement et Données** : il reste Connecter Claude (les jetons MCP y sont, `/reglages/jetons` renvoie à `/reglages`), Tâches cloud et Instance (administrateur).
- **L'écran « Cockpit hors ligne » (S56)** : seule la page « Cette page n'existe pas. » est faite ; la perte du serveur reste l'alerte « Serveur injoignable » avec « Réessayer ».
- **Les barres d'étapes d'un run** et la carte **« Pourquoi Claude demande »**.
- **L'ouverture d'une carte du Kanban dans le panneau de droite** : une carte mène toujours à sa page.
- **Ce que les écrans montrent encore et que le code n'a pas** (relevé à l'alignement des écrans construits, le logo mis à part) : le cloud et la nuit dans « Développer avec Claude » (S24, tranches 14.1 et 14.6), « Accès donnés à Claude » (S45), « Branchements » (S51), les filtres de Tous les projets, de Tickets et du Journal, le canevas de « Nouvelle équipe » (S38).
- **L'adresse publique en lecture seule de S51** : l'index de `docs/ecrans/` décrit l'écran avec « adresse en lecture seule », et le choix I ci-dessus la garde en lecture seule. Mais la 028 I, qui reste, veut qu'il n'y ait pas d'« Adresse publique » dans Réglages, et `SettingsTabs.test.tsx` la fixe. La carte n'est pas construite ; la tension entre la 028 I et S51 reste à trancher.

## Écran contre décision

Là où un écran contredit une décision, la 9.3 a suivi l'écran et la décision est marquée « modifiée par 045 » : 019 B (le Kanban passe de cinq à six colonnes, « Idées » en premier, tirée des tickets à l'étape `new`), 034 A (« Développer avec Claude » dans le panneau de droite) et 040 D (les projets passent de l'accueil à la barre latérale).

L'alignement des écrans construits sur leurs maquettes en a marqué quatre autres : 025 F et G (« Garder la version Cockpit » et « Garder la version GitHub » à la place de « Garder la version de Cockpit » et « Reprendre la version de GitHub »), 035 F (« passe » et « échoue » à la place de « Réussi » et « Échoué », « PR #12 » à la place de « PR n° 12 »), 027 F (le plan de « Préparer pour Claude » est une liste de fichiers avec un aperçu, plus un contenu replié) et 031 F (la liste des étapes sous le graphe devient un commutateur Graphe / Liste ; la liste reste visible sur un téléphone et atteignable au clavier en vue Graphe).
