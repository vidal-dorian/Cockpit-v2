# 059 — La relance automatique

- **Statut** : proposée (à valider à la relecture de la PR)
- **Date** : 2026-11-08
- **Décidé par** : Dorian, avec Claude
- **Dépend de** : [054 — Lancer dans le cloud](054-lancer-dans-le-cloud.md) (le lanceur, `launchCloud`), [038 — Le suivi de la PR](038-suivi-de-la-pr.md) (l'état de la CI tenu par les webhooks), [037 — Arrêter, relancer, fermer](037-arreter-relancer-fermer.md) (relancer sur la même branche), [040 — L'accueil](040-accueil.md)
- **Tranche** : 14.4 du [découpage](../decoupage.md)

## Contexte

Brief §6.15 : quand la CI d'une PR échoue, Cockpit relance Claude sur la même branche, avec l'échec comme consigne ; il s'arrête après un nombre de relances d'affilée et prévient l'humain ; désactivée par défaut. Démo : « Une CI rouge relance le développement sans que je clique ».

Le découpage demandait de comparer d'abord avec l'**Auto-fix** natif de Claude Code ([doc](https://code.claude.com/docs/en/claude-code-on-the-web#auto-fix-pull-requests)) : une session cloud suit sa PR et pousse un correctif à chaque check en échec ou commentaire de revue. Il n'a pas de plafond de tentatives documenté, ne marche que pour les PR suivies par une session cloud, et Cockpit ne le voit pas. Le 2026-11-08, **Dorian a choisi la relance par Cockpit** : chaque relance est un run visible, comptée et plafonnée, et la nuit (14.6, 044 F) s'en sert.

## Les choix

| # | Question | Décision |
|---|---|---|
| A | Activer ? | Un réglage par utilisateur, **désactivé par défaut** : `users.auto_relaunch`, sur la carte « Lanceur Cockpit » de « Tâches cloud » (« Relancer Claude quand la CI d'une PR échoue », 054). `GET /api/me/launcher` le rend, `PUT /api/me/launcher/auto-relaunch` `{ enabled }` le change (entrée `set_auto_relaunch`, `args: { enabled }`) |
| B | Quand ? | Quand la lecture de la PR (038, après un webhook ou « Actualiser ») fait passer la CI d'une US `in_review` **à `failure`** (elle ne l'était pas avant). Cockpit relance si : le réglage est actif pour le propriétaire du dernier run de l'US (qui n'est pas bloqué), la PR est ouverte, l'US n'a pas de run actif, son projet est coché dans le lanceur de ce propriétaire (054 D), et l'US a moins de **3 relances d'affilée**. La relance part **après** la transaction de la lecture, jamais dedans |
| C | Comment ? | Par `launchCloud` (054 E) sur la branche de l'US, avec en `comment` : « The CI of pull request #N failed: <checks>. Fix it on this branch, then push. », où `<checks>` sont les noms des check runs en échec (10 au plus, 100 caractères chacun, réduits aux lettres, chiffres, espaces et `._:/()-`). Le lancement est marqué `cloud_launches.relaunch`. `/dev-us` reprend une US `in_review` sur sa branche (037) |
| D | Le compte ? | `user_stories.relaunch_count` : +1 à chaque relance, remis à 0 quand la CI repasse à `success`. À 3, Cockpit ne relance plus : l'accueil met l'US en tête de « À toi de jouer » avec **« Relances épuisées : la CI échoue encore après 3 essais »**, lien vers l'US |
| E | Un échec du lancement ? | Comme la 054 E (« à reconnecter » sur `401`, `403`, `404`) : rien n'est retenté, la relance compte quand même (une CI rouge ne relance pas en boucle un lanceur cassé). Un lancement refusé par `launchCloud` (un run est actif, projet non coché) n'est pas compté : il écrit une entrée `launch_story` refusée et rien d'autre |
| F | L'historique ? | `launch_story` avec l'acteur `system` (054 J) pour une relance ; `set_auto_relaunch`. Journal : « Relance automatique réglée » |

## Ce qui est repoussé

- **La relance sur une revue « changements demandés »** (brief §6.15) : la démo ne parle que de la CI ; même mécanique à ajouter si l'usage le demande.
- **Un plafond réglable** : 3 suffit pour commencer.

## Limites connues

- Celles de la 054 : `/fire` en préversion, un seul modèle, tous les repos clonés.
- **Le nom d'un check ne dit pas toujours pourquoi il échoue** : Claude relit les logs lui-même dans la session.
- **Une CI qui échoue pendant le run de relance** (l'US est alors `in_progress`) n'est pas vue comme un passage à `failure` : l'US revient en revue avec sa CI rouge, sans nouvelle relance. « Actualiser » ne change rien ; c'est à l'humain de relancer.
- **« Relances épuisées » s'affiche dès la 3e relance lancée**, avant que son run ne démarre.
- **Une CI qui passe par des statuts** (`status`) et non des check runs n'est pas vue (comme la 038).
