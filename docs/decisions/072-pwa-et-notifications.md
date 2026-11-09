# 072 — PWA et notifications

- **Statut** : proposée (à valider à la relecture de la PR)
- **Date** : 2026-11-09
- **Décidé par** : Dorian, avec Claude ([064](064-tranches-restantes.md) 15.2 A, B et C)
- **Dépend de** : [012 — Configuration automatique](012-configuration-automatique.md) (les secrets chiffrés), [036 — Questions de Claude](036-questions-de-claude.md), [044 — La nuit de Claude](044-la-nuit-de-claude.md) (M', le récap), [059 — Relance automatique](059-relance-automatique.md), [060 — Coût et budget](060-cout-et-budget.md), [071 — Les trois gestes au téléphone](071-trois-gestes-au-telephone.md)
- **Tranche** : 15.2 du [découpage](../decoupage.md)
- **Écrans** : [S47](../ecrans/S47_Reglages_Preferences.png) (la carte « Notifications sur le téléphone »), [N3](../ecrans/N3_Nuit_Telephone.png), [S56](../ecrans/S56_Erreurs.png) (« Cockpit ne répond plus »)

## Contexte

La 064 a tranché ce que la 15.2 contient : les deux téléphones à égalité, quatre notifications qui se coupent une par une, un silence réglable (22 h à 7 h par défaut) sauf pour le récap, une notification de test, des clés Web Push chiffrées en base, et le bandeau « Cockpit ne répond plus » de S56. Aujourd'hui, Cockpit n'a ni manifeste, ni service worker, ni aucune notification. Le serveur a déjà un passage chaque minute (`runDueRoutines`, qui fait avancer les nuits) et un chiffrement des secrets (`secrets.ts`, AES-256-GCM, la clé hors de la base).

## Les choix

| # | Question | Décision |
|---|---|---|
| A | L'application installable | Un manifeste `manifest.webmanifest` (nom « Cockpit », `display: standalone`, couleurs des jetons du thème sombre, icônes PNG 192 et 512 px tirées du logo de la 046, plus `apple-touch-icon` pour l'iPhone) et un service worker `sw.js` à la racine, les deux dans `src/web/public/`. La page enregistre le service worker au démarrage |
| B | Comment une notification part | **Une boîte d'envoi en base**, table `notifications` (utilisateur, type, titre, texte, adresse à ouvrir, boutons éventuels, date). Chaque événement y écrit une ligne pour chaque membre du projet, dans la transaction qui l'enregistre déjà. Le passage de chaque minute (`runDueRoutines`) envoie la boîte puis la vide. Une question part donc au plus une minute après avoir été posée. Pas d'envoi direct depuis l'endroit de l'événement : il faudrait faire passer la clé et l'envoyeur dans le MCP, les runs et le suivi des PR |
| C | Les quatre événements (S47, 064 B) | **Question de Claude** : écrite par `askUser` ; texte = la question, adresse = la page du run, et un bouton par réponse proposée (au plus deux, la limite des navigateurs). **Run en échec** : écrite quand un run finit `failed`, quand il finit `stopped` après un arrêt demandé par Cockpit (plafond, 060), et quand le suivi de la PR renonce après la 3ᵉ relance (059) ; adresse = la page du run ou de l'US. **PR prête à relire** : écrite quand une US passe `in_review` avec une PR ; adresse = l'accueil. **Récap de la nuit** : écrit par `finishNight`, le texte de N3 (« Cette nuit : 3 PR prêtes. Une question attend ta réponse. ») ; adresse = l'accueil |
| D | Les réglages (S47) | Un onglet **Préférences** dans Réglages (`/reglages/preferences`), avec seulement la carte « Notifications sur le téléphone » de S47 (le thème et les raccourcis sont la 15.3). Quatre interrupteurs, **tous allumés par défaut**. Le silence : deux heures (début, fin), dans le fuseau de la nuit (`users.night_time_zone`) ; mêmes heures = pas de silence. Un bouton « Activer sur cet appareil » (demande la permission, abonne l'appareil) et un bouton « Envoyer une notification de test ». Colonnes sur `users`, comme les autres préférences |
| E | Ce que fait le passage de chaque minute | Pour chaque utilisateur qui a des lignes : une ligne d'un type coupé est supprimée ; pendant le silence, toute ligne sauf le récap est supprimée (pas mise de côté : l'accueil la montre de toute façon) ; les « PR prête à relire » attendent qu'une heure soit passée depuis la dernière envoyée, puis partent **en une seule** (« 3 PR prêtes à relire ») ; le reste part vers chaque appareil abonné, puis la ligne est supprimée. Un utilisateur sans appareil abonné voit ses lignes supprimées |
| F | Web Push | Le chiffrement du message et la signature VAPID par la bibliothèque `web-push` (l'implémentation de référence ; les écrire à la main, c'est de la cryptographie maison). Les clés VAPID sont générées au premier besoin et rangées dans `instance_settings`, la clé privée chiffrée avec `encrypt` (012), jamais dans le `.env`. Un appareil est une ligne de `push_subscriptions` (utilisateur, `endpoint` unique, clés). Un service de push qui répond 404 ou 410 : l'abonnement est supprimé. Une autre erreur : la notification est perdue pour cet appareil, sans nouvel essai |
| G | Le tap et les boutons (064 A) | Un tap ouvre l'adresse de la notification (la page du run d'une question : S53 en largeur téléphone). Un bouton de réponse envoie la réponse depuis le service worker (`POST /api/questions/:id/answer`, avec le cookie de la session), sans ouvrir Cockpit. Un navigateur qui n'affiche pas les boutons montre la notification sans eux : le tap suffit |
| H | L'iPhone (064 A) | Si la page n'a pas `PushManager` et tourne sur un iPhone, la carte le dit à la place du bouton « Activer » : « Sur iPhone, ajoute d'abord Cockpit à l'écran d'accueil (Partager, puis Sur l'écran d'accueil), puis ouvre-le depuis là. » |
| I | « Cockpit ne répond plus » (S56, 064 C) | Le service worker répond **réseau d'abord** aux pages, aux fichiers de l'application et aux lectures `GET /api/…`, et garde la dernière réponse réussie ; sans réseau, il rend la copie. Jamais `/api/health` ni `/api/events`, pour que la page voie la coupure. Le bandeau de S56 remplace `ServerAlert` et passe dans la coque, sur toutes les pages : « Cockpit ne répond plus. Ce que tu vois date de 9 h 42 ; on réessaie toutes les 10 secondes. » avec « Réessayer ». L'heure est celle de la dernière réponse de `/api/health` ; la page la redemande toutes les 10 secondes tant qu'elle échoue |

## Limites connues

- **Une minute de délai** au plus (B), le pas du passage.
- **Une notification ratée n'est pas renvoyée** (F) ; une notification pendant le silence est perdue (E), l'accueil la montre.
- **Pas vérifié sur un vrai iPhone ni un vrai Android** : les tests n'appellent aucun service de push (l'envoyeur est remplacé), et Chromium sans interface ne reçoit pas de push. Les boutons sur iPhone (064, point ouvert) restent à essayer.
- **La copie hors ligne** est celle du dernier passage sur chaque adresse ; une page jamais ouverte n'en a pas.
- **Pas construits** : le thème et les raccourcis de S47 (15.3) ; le « changement de workflow proposé » du brief §6.17, que S47 n'a pas retenu.
