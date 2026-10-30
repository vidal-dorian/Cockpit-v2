# 024 — Recevoir les webhooks GitHub

- **Statut** : proposée (à valider à la relecture de la PR)
- **Date** : 2026-10-30
- **Décidé par** : Dorian, avec Claude
- **Dépend de** : [008 — Service en ligne](008-service-en-ligne.md) (enregistrer d'abord, traiter ensuite), [012 — Configuration automatique](012-configuration-automatique.md) (l'App et son secret de webhook), [013 — Bilan de santé](013-bilan-de-sante.md), [010 — Historique](010-historique.md), [023 — Adresse publique](023-reglages-adresse-https.md)
- **Modifiée par** : [025 — Une issue modifiée sur GitHub](025-issue-modifiee-sur-github.md) : le traitement des livraisons existe maintenant (`processed_at`, `claimed_at`, `attempts`, entrée `process_webhook`), lancé après la réponse 202 puis chaque minute
- **Tranche** : 5.1 du [découpage](../decoupage.md)

## Contexte

L'App est créée avec son webhook actif vers `/api/webhooks/github` (012) ; jusqu'ici, ces livraisons échouaient sans conséquence. Cette tranche les reçoit, les vérifie, les **enregistre avant tout traitement** (008) et ajoute au bilan de santé la ligne « webhook installé et dernière livraison réussie » (brief §6.1). Les traitements eux-mêmes (issue modifiée, PR, CI) viennent avec leurs tranches (5.2, 7.x).

## Les choix

| # | Question | Décision |
|---|---|---|
| A | La route ? | `POST /api/webhooks/github`, sans session. 503 si l'instance n'est pas configurée. Elle échappe à la limite de 256 Kio des routes `/api/*` (014) : GitHub envoie jusqu'à 25 Mo, c'est donc sa limite. Le corps est lu **brut**, pour vérifier la signature sur les octets reçus |
| B | La signature ? | `X-Hub-Signature-256` doit valoir `sha256=` suivi du HMAC-SHA256 du corps avec le secret de webhook de l'App (012), comparé en temps constant. Absente ou fausse : **401**, rien n'est enregistré ni journalisé (aucun utilisateur connu, 010 E), une ligne dans les logs. Une signature juste avec des en-têtes `X-GitHub-Delivery` (au plus 100 caractères) ou `X-GitHub-Event` (`[a-z_]`, au plus 64) absents ou invalides, ou un corps qui n'est pas un objet JSON : **400** |
| C | L'enregistrement ? | Une table `webhook_deliveries` : `id` (l'en-tête `X-GitHub-Delivery`, clé primaire), `event`, `action` (le champ `action` du corps, s'il y en a un), `installation_id` et `repo_id` (du corps, s'ils y sont), `payload` (le corps, en JSON), `received_at`, `processed_at` (vide : à traiter). Insérée avec l'entrée d'historique dans **une transaction**, puis réponse **202**. Une livraison déjà reçue (même `X-GitHub-Delivery`, GitHub la renvoie) répond 202 sans rien écrire de plus |
| D | Le traitement ? | Aucun dans cette tranche : `processed_at` reste vide, et le premier traitement (5.2, issue modifiée sur GitHub) ajoutera le passage qui lit les livraisons à traiter, les réserve et les relance en cas d'échec (008). Écrire ce passage maintenant, sans rien à traiter, serait du code sans usage |
| E | L'historique ? | `receive_webhook`, acteur `github`, origine `webhook`, `args: { deliveryId, event, action }` (des codes, jamais le corps), `project_id` quand `repo_id` est celui d'un projet suivi, et `user_id` le propriétaire de ce projet, pour qu'il la voie dans son Journal (010 G). Sans projet connu (`ping`, `installation`, repo non suivi), `user_id` est vide : l'entrée n'est visible par personne pour l'instant, comme un jeton MCP inconnu. Le Journal dit « Webhook reçu » et le nom de l'événement |
| F | La ligne du bilan de santé ? | Une cinquième ligne, **`webhook`** : « Le webhook de Cockpit est installé et sa dernière livraison a réussi ». Avec une App, le webhook est celui de l'App (002) : Cockpit lit `GET /app/hook/config` et `GET /app/hook/deliveries?per_page=1`, authentifié comme l'App. Vert si l'adresse du webhook est `<adresse publique>/api/webhooks/github` et si la dernière livraison a un statut 2xx, ou s'il n'y en a encore aucune. Rouge sinon : `wrong_url` (le webhook n'envoie pas à Cockpit, ou il est désactivé) et `last_delivery_failed`. Ces deux lectures sont les mêmes pour tous les projets : elles sont gardées **une minute** en mémoire, à part du cache par commit (013 G), qui ne les contient pas. Si elles échouent, la ligne est rouge `unknown` sans faire échouer le bilan |
| G | Et le changement d'adresse publique ? | Comme la 023 le repoussait ici : `PUT /api/settings/public-url` change aussi l'adresse du webhook de l'App (`PATCH /app/hook/config`, `{ url }`), après avoir enregistré l'adresse. S'il échoue, l'adresse reste changée, la réponse le dit (`webhookUpdated: false`) et la page demande de la changer à la main sur GitHub ; sinon la page ne parle plus du webhook dans ses étapes |
| H | Combien de temps les garde-t-on ? | La purge quotidienne (`schedulePurge`) supprime les livraisons reçues il y a plus de **30 jours**, traitées ou non : GitHub ne garde lui-même ses livraisons que 3 jours, et le traitement d'une livraison aura lieu dans la minute |

## Ce qui est repoussé

- Les traitements (`issues`, `pull_request`, `check_suite`, `status`, `workflow_run`, `installation_repositories`) : avec leurs tranches (5.2, 7.x).
- Relancer une livraison à la main, ou demander à GitHub de renvoyer celles qu'il a manquées : avec le premier traitement.
- Montrer à l'administrateur les entrées sans utilisateur (livraisons sans projet, jetons inconnus) : avec l'administration.

## Limites connues

- **Une livraison de 25 Mo est lue en mémoire avant de vérifier sa signature** : un envoi sans en-tête de signature valide est refusé avant la lecture, mais quelqu'un qui en forge un peut faire lire 25 Mo au Pi à chaque requête ; quelques dizaines à la fois l'épuiseraient. Limiter le nombre de gros corps lus en même temps viendra si cela arrive. GitHub, lui, envoie rarement plus de quelques Kio.
- **Un NUL ou un demi-caractère UTF-16 dans le texte d'une livraison** (une issue, un commentaire) est remplacé par « � » avant l'enregistrement : `jsonb` les refuse, et la livraison serait perdue (GitHub ne relance pas seul une livraison échouée).
- **Juste après un changement d'adresse publique**, la ligne `webhook` peut rester rouge `wrong_url` jusqu'à une minute (cache).
- **La ligne du bilan est en retard d'une minute au plus** (cache), et dit « réussie » tant que GitHub n'a encore rien envoyé.
- **Non vérifiable ici** : de vraies livraisons de GitHub (les tests signent leurs propres corps avec le secret de test).
