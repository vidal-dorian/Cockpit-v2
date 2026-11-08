# 028 — Style Crème sombre, onglets, journal par pages, plus d'adresse publique dans Réglages

- **Statut** : validée
- **Date** : 2026-11-03
- **Décidé par** : Dorian, avec Claude
- **Dépend de** : [003 — Interface](003-interface.md), [010 — Historique](010-historique.md), [013 — Bilan de santé](013-bilan-de-sante.md), [023 — Réglages en onglets, adresse https](023-reglages-adresse-https.md), [024 — Webhooks](024-webhooks.md)
- **Modifie** :
  - la [003](003-interface.md), section « Style visuel » : les maquettes retenues sont désormais la rangée **« Version Crème sombre — le style du site vitrine »** du canevas (https://claude.ai/artifact/XAteTYa7tQBcCGq8HpRF7C, planches « Crème sombre 1 » à « Crème sombre 8 ») ; l'UX et les règles d'ergonomie de la 003 ne changent pas ;
  - la [023](023-reglages-adresse-https.md), choix C (la section « Adresse publique » de Réglages disparaît) et E (Réglages a quatre onglets au lieu de deux) ;
  - la [024](024-webhooks.md), choix G (plus de changement d'adresse, donc plus de `PATCH /app/hook/config` déclenché par Réglages) ;
  - la [010](010-historique.md) pour `GET /api/history` (par pages) ;
  - la [012](012-configuration-automatique.md), choix C, et la [023](023-reglages-adresse-https.md), choix B : l'assistant ne demande plus de confirmer l'adresse (choix J).
- **Répond à** : la demande du 2026-11-03 : « les maquettes appelées "crème sombre" sont les maquettes retenues » ; « le journal des logs est bien trop grand […] permettre à l'utilisateur d'afficher plus de logs » ; « dans la page des projets […] il faudrait des onglets, bilan de santé, kanbans, tickets, paramétrage pour l'écriture automatique des US » ; « dans la page des réglages, on a pas d'onglets » ; « la fonctionnalité d'adresse publique […] devrait disparaître ».
- **Modifiée par** : [053](053-journal-filtrable.md) : F (`GET /api/history` accepte des filtres, rend `args`, `detail` et `retry`, et `before` marche avec eux)
- **Modifiée par** : [045](045-interface-quatre-temps.md) : style, valeurs, formes, barre du haut et largeur des pages (A à E), onglets d'un projet (G) et de Réglages (H) ; F, I et J restent
- **Modifiée par** : [046](046-logo-la-boucle.md) : le logo (D), qui devient la boucle

## Contexte

Les écrans ont été construits avec le style clair de la 003. Les maquettes Crème sombre reprennent la même UX avec le style du site vitrine, et ce sont elles qui sont retenues. Trois écrans ont grandi section après section : le journal charge 100 entrées d'un coup, la page d'un projet empile bilan, Kanban, tickets et routine, et l'onglet « Général » de Réglages empile Connecter Claude, Adresse publique, Utilisateurs et Jetons. Enfin, l'adresse publique modifiable n'a pas d'usage : elle est fixée à l'installation (012 C, 023 A, B) et la changer demande de toute façon de reprendre l'App sur GitHub à la main.

## Les choix

| # | Question | Décision |
|---|---|---|
| A | Le style ? | Celui des planches Crème sombre, par les **jetons** de `src/web/styles.css` (mêmes noms qu'aujourd'hui, nouvelles valeurs, quelques jetons ajoutés) ; aucun composant ne code une couleur en dur (003). Polices : **Geist** (texte et titres, 400 à 800) et **Geist Mono** (code, touches, durées), par `@fontsource-variable/geist` et `@fontsource-variable/geist-mono` ; Bricolage Grotesque et Figtree sont retirées. `color-scheme: dark` sur la page |
| B | Les valeurs ? | Fond `#1C1917` ; surface (cartes, barre du haut) `#262220` ; surface en creux (panneaux, pieds de carte) `#211D1B` ; bouton secondaire `#2F2A27`, survolé `#36302C` ; bord `#3A3430`, bord marqué `#4A433E`. Texte `#F6EEE6` ; crème `#E9DFD5` ; secondaire `#A99E94`. **À toi** : orange `#FF8A57` (survol `#FF9A6C`, texte sombre `#1C1917` dessus), fond doux `#3D2A20`, texte `#FFAB85`. **Claude** : crème `#E9DFD5`, fond doux `#36302C`, texte `#F6EEE6`. **Terminé** : s'efface en gris chaud, marque `#7A716A`, fond doux `#2F2A27`, texte `#C9BFB4`. **Erreur** : `#F0905F` sur `#3A2219`, toujours avec un mot. L'orange reste la seule couleur vive : un seul bouton orange par zone (003, règle 2) |
| C | Les formes ? | Cartes : rayon 16 px, bord d'un pixel ; boutons et champs : rayon 12 px, hauteur d'au moins 40 px ; pastilles en pilule ; onglets soulignés (trait de 2 px sous l'onglet ouvert, texte secondaire pour les autres) |
| D | La barre du haut ? | Pleine largeur, surface, bord du bas : le logo (deux mains qui se serrent, un humain et Claude, animées au survol : le composant `Logo` ; c'était d'abord un cercle et deux secteurs) et « Cockpit », lien vers `/` ; la navigation principale (`aria-label="Navigation principale"`) en pilules : Accueil, Projets, Journal ; à droite, pour un utilisateur connecté, un **lien icône « Réglages »** (roue, `aria-label="Réglages"`) et l'initiale ou l'avatar du compte. La recherche, « Nouveau ticket » (`N`) et le compteur de l'Accueil des maquettes viendront avec leurs tranches (8.1 et l'ergonomie) : pas de bouton sans fonction |
| E | La largeur des pages ? | Un conteneur centré avec 28 px de marge sur le côté (16 px sur téléphone) : 1240 px pour la page d'un projet (le Kanban a cinq colonnes), 880 px pour les autres. Le Kanban défile dans sa boîte quand la largeur manque |
| F | Le journal ? | `GET /api/history` rend **25 entrées** (au lieu de 100) et `{ entries, hasMore }`. La page suivante se demande par `?before=<id>`, l'`id` de la dernière entrée affichée : le serveur rend les entrées de l'appelant qui viennent **strictement après** elle dans l'ordre du journal (`at` décroissant, puis `id` décroissant), comparées sur le couple (`at`, `id`). Un `before` qui n'est pas un entier positif, ou qui ne désigne pas une entrée de l'appelant, répond **400** `{ "error": "invalid_cursor" }` (on ne révèle pas les entrées des autres). La page affiche les 25 premières, puis un bouton **« Afficher plus »** tant que `hasMore` est vrai ; il ajoute les 25 suivantes sous les précédentes, montre « Chargement… » et se désactive pendant la lecture ; un échec s'affiche à côté avec « Réessayer », sans effacer ce qui est déjà affiché |
| G | La page d'un projet ? | Un en-tête (fil d'Ariane « Projets / nom », le nom en titre), puis des **onglets**, des liens (`aria-label="Sections du projet"`, l'onglet ouvert porte `aria-current="page"`) : **« Kanban »** (`/projets/:id`, l'onglet par défaut), **« Tickets »** (`/projets/:id/tickets`), **« Santé »** (`/projets/:id/sante` : le bilan, « Revérifier », « Préparer pour Claude ») et **« Écriture des US »** (`/projets/:id/ecriture-us` : la section de la 022). Chaque onglet ne montre que sa section. Le bilan reste lu à l'ouverture de la page, quel que soit l'onglet (pour « Projet introuvable » comme aujourd'hui, et pour le repère qui suit) : quand il a des lignes rouges, l'onglet Santé le dit par un mot, **« Santé · N à corriger »** ; tout vert, il dit seulement « Santé ». Le lien « ← » d'un ticket mène à l'onglet Tickets ; après l'abandon d'un ticket, on revient au Kanban comme aujourd'hui |
| H | Réglages ? | Quatre onglets, des liens (`aria-label="Réglages"`, `aria-current="page"` sur l'onglet ouvert) : **« Connecter Claude »** (`/reglages`), **« Jetons MCP »** (`/reglages/jetons`), **« Utilisateurs »** (`/reglages/utilisateurs`, onglet montré à l'administrateur seulement) et **« Écriture automatique des US »** (`/reglages/ecriture-us`, inchangé). Chaque onglet ne montre que sa section. Un non-administrateur qui ouvre `/reglages/utilisateurs` lit « Cette page est réservée à l'administrateur. » et la liste n'est pas demandée au serveur. Dans « Connecter Claude », « Les jetons manuels » devient un lien vers l'onglet « Jetons MCP » |
| I | L'adresse publique ? | La section « Adresse publique » de Réglages disparaît, ainsi que `GET` et `PUT /api/settings/public-url` (ils répondent 404 comme toute route inconnue) et le changement d'adresse du webhook qu'ils déclenchaient (024 G). L'adresse reste celle de l'installation : détectée par l'assistant sur sa propre requête (choix J), elle sert à créer l'App, à l'OAuth (021) et à la ligne `webhook` du bilan (024). Les entrées `change_public_url` déjà écrites gardent leur libellé dans le journal |
| J | L'adresse à l'installation ? | L'assistant n'a plus de champ « Adresse publique » : l'administrateur n'a rien à recopier, il donne le code de démarrage puis accepte l'App sur GitHub. `POST /api/setup/start` prend `{ code }` seul et **détecte l'adresse sur sa propre requête**, comme `GET /api/setup/status` (`CF-Visitor`, puis `X-Forwarded-Proto` et `X-Forwarded-Host`, sinon l'origine de la requête ; 023 A). Une adresse qui n'est pas en `https://` est refusée (400) par la phrase : « Ouvre Cockpit par son adresse en https:// pour l'installer : claude.ai l'exige pour le connecteur. » ; seule exception, inchangée : `localhost`, `127.0.0.1` et `[::1]`, pour développer sur sa machine (023 B). Un `publicUrl` encore envoyé dans le corps est ignoré. Cette adresse est celle que Réglages › Connecter Claude donne pour le connecteur (`<adresse>/mcp`, 021) |

## Critères d'acceptation

### Style (A à E)

- **Étant donné** la page, **quand** elle est chargée, **alors** `styles.css` définit les jetons de B (fond `#1C1917`, primaire `#FF8A57`, texte `#F6EEE6`…) et `main.tsx` importe Geist et Geist Mono, plus Bricolage Grotesque ni Figtree.
- **Étant donné** un utilisateur connecté, **quand** une page est affichée, **alors** la barre du haut a un lien « Cockpit » vers `/`, une navigation « Navigation principale » avec Accueil, Projets et Journal, et un lien « Réglages » vers `/reglages` ; déconnecté, pas de lien « Réglages ».
- **Étant donné** le code de `src/web`, **quand** on le parcourt, **alors** aucun composant ne contient de couleur en dur (`#xxxxxx`, `rgb(`) hors de `styles.css`.

### Journal (F)

- **Étant donné** 30 entrées de l'appelant, **quand** il demande `GET /api/history`, **alors** il reçoit les 25 plus récentes, dans l'ordre du journal, et `hasMore: true`.
- **Étant donné** ces 30 entrées, **quand** il demande `GET /api/history?before=<id de la 25e>`, **alors** il reçoit les 5 suivantes et `hasMore: false`.
- **Étant donné** des entrées de même `at`, **quand** on parcourt les pages, **alors** chaque entrée apparaît une fois et une seule.
- **Étant donné** un `before` invalide (`abc`, `0`, `-1`) ou l'`id` d'une entrée d'un autre utilisateur, **quand** il est demandé, **alors** la réponse est 400 `invalid_cursor`.
- **Étant donné** 25 entrées affichées et `hasMore: true`, **quand** on clique « Afficher plus », **alors** la page demande `?before=<id de la dernière>` et ajoute les entrées reçues sous les 25 premières ; avec `hasMore: false`, le bouton disparaît.
- **Étant donné** un échec de la page suivante, **quand** il survient, **alors** les entrées déjà affichées restent, une alerte le dit et « Réessayer » relance la même demande.

### Page d'un projet (G)

- **Étant donné** un projet, **quand** on ouvre `/projets/:id`, **alors** les onglets Kanban, Tickets, Santé et Écriture des US sont affichés, Kanban est ouvert (`aria-current="page"`) et seul le Kanban est montré (pas le bilan, ni les tickets, ni la routine).
- **Étant donné** un projet, **quand** on ouvre `/projets/:id/tickets`, `/projets/:id/sante` ou `/projets/:id/ecriture-us`, **alors** seule la section de cet onglet est montrée et son onglet est marqué ouvert.
- **Étant donné** un bilan avec deux lignes rouges, **quand** n'importe quel onglet est ouvert, **alors** l'onglet s'appelle « Santé · 2 à corriger » ; tout vert, « Santé ».
- **Étant donné** un projet inconnu, **quand** on ouvre l'un de ses onglets, **alors** la page dit « Projet introuvable », sans onglets.

### Réglages (H, I)

- **Étant donné** un administrateur, **quand** il ouvre `/reglages`, **alors** il voit les onglets Connecter Claude, Jetons MCP, Utilisateurs et Écriture automatique des US, et seule la section « Connecter Claude ».
- **Étant donné** un administrateur, **quand** il ouvre `/reglages/jetons` ou `/reglages/utilisateurs`, **alors** seule la section de cet onglet est montrée.
- **Étant donné** un non-administrateur, **quand** il ouvre `/reglages`, **alors** l'onglet Utilisateurs n'est pas affiché ; **quand** il ouvre `/reglages/utilisateurs`, **alors** il lit « Cette page est réservée à l'administrateur. » et `/api/settings/users` n'est jamais demandé.
- **Étant donné** n'importe quel utilisateur, **quand** il ouvre un onglet de Réglages, **alors** il n'y a pas de section « Adresse publique » et `/api/settings/public-url` n'est jamais demandé.
- **Étant donné** un administrateur, **quand** il demande `GET` ou `PUT /api/settings/public-url`, **alors** la réponse est 404 et l'adresse enregistrée ne change pas.

### Installation (J)

- **Étant donné** l'assistant, **quand** il est affiché, **alors** il n'a pas de champ « Adresse publique », seulement le code de démarrage, la liste des droits et « Créer l'App GitHub ».
- **Étant donné** une requête qui arrive en https (par exemple `CF-Visitor: {"scheme":"https"}` et `Host: cockpit.example.com`), **quand** `POST /api/setup/start` reçoit le bon code, **alors** le manifeste est construit avec `https://cockpit.example.com`, même si le corps contient un autre `publicUrl`.
- **Étant donné** une requête qui arrive en http sur un autre hôte que la machine (par exemple `X-Forwarded-Proto: http` et `Host: cockpit.example.com`), **quand** `POST /api/setup/start` reçoit le bon code, **alors** la réponse est 400 avec la phrase du choix J et rien n'est préparé ; la page l'affiche dans une alerte.
- **Étant donné** une requête sur `http://localhost:3000`, **quand** `POST /api/setup/start` reçoit le bon code, **alors** le manifeste est construit avec `http://localhost:3000`.

## Ce qui est repoussé

- L'Accueil des maquettes (« 5 choses t'attendent », Répondre, Valider, Claude travaille) : tranche 8.1.
- La recherche (`/`), « Nouveau ticket » (`N`), le panneau de validation et l'écran de run : avec leurs tranches.
- L'onglet « Historique » d'un projet (planches 7 et 8) : quand le journal pourra se filtrer par projet. *Fait par la [053](053-journal-filtrable.md) en 11.1 (`/projets/:id/historique`).*
- Un thème clair : le brief (§6.20) le garde pour l'ergonomie ; les jetons permettent de le redéfinir.

## Limites connues

- **Changer l'adresse de Cockpit** (nouveau domaine) n'a plus d'écran : il faut reprendre l'installation (nouvelle App). C'est un cas rare, et la section supprimée demandait déjà de modifier l'App à la main sur GitHub.
- Le bilan reste lu à chaque ouverture d'un projet, même sur l'onglet Kanban : c'est le coût d'aujourd'hui (plusieurs appels GitHub, gardés en cache par commit, 013), payé pour le repère de l'onglet Santé.
