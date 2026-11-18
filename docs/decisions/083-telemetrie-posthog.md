# 083 — La télémétrie PostHog

- **Statut** : proposée (à valider à la relecture de la PR)
- **Date** : 2026-11-16
- **Décidé par** : Dorian (le ticket « Ajouter PostHog à l'app » et ses trois US, développées dans Cockpit-v2 le 2026-11-16), avec Claude (A à H, écrits dans les US)
- **Dépend de** : [010 — L'historique](010-historique.md) (D, rien de libre ni de personnel dans `args` et `detail`), [008 — Le service en ligne](008-service-en-ligne.md) (pas de donnée personnelle en clair), [081 — Les retours d'action](081-retours-d-action.md)
- **Tranche** : aucune du [découpage](../decoupage.md) (demande de Dorian)
- **Écran** : aucun nouveau ; une ligne en bas de Réglages (H)

## Contexte

Les US du ticket ont été rangées dans le projet Cockpit `vidal-dorian/cockpit` et renvoient à une « décision 047 » qui n'existe pas ici (la 047 de Cockpit-v2 est l'écran de reprise). Le 2026-11-16, Dorian a choisi de les développer dans Cockpit-v2 : cette décision reprend leurs choix, avec les mêmes lettres.

## Les choix

| # | Question | Décision |
|---|---|---|
| A | Quel outil, où | **PostHog Cloud, région UE** (`https://eu.i.posthog.com`). La page avec `posthog-js` ; le serveur sans SDK, par un `fetch` sur l'API de capture (E) |
| B | Quand c'est actif | Seulement si la variable d'environnement **`POSTHOG_KEY`** (la clé de projet `phc_…`, publique par nature) est définie. Sans elle, rien ne part, ni de la page ni du serveur. `GET /api/telemetry` rend **`{ key: string \| null }`**, sans session : la page en a besoin avant de savoir qui est connecté |
| C | La page | Un seul module, **`src/web/telemetry.ts`**, importe `posthog-js` et exporte `init`, `track`, `identify`, `reset` (à la déconnexion) et `captureException`, qui ne font rien sans clé. Les composants ne l'importent jamais. Options : `api_host` UE, `persistence: "memory"` (ni cookie ni stockage, donc pas de bandeau), `person_profiles: "identified_only"`, `autocapture: false`, `disable_session_recording: true`, `capture_pageview: false` (Cockpit envoie ses `$pageview` lui-même, D), `reuseAnonymousId: true` (un nouvel identifiant anonyme à chaque chargement, sinon fusionné dans la personne à chaque fois), et **tout ce qui partirait sans passer par `before_send` est coupé** : `advanced_disable_flags: true` (la requête `/flags` porte les `$initial_*` de la personne), `capture_heatmaps`, `capture_dead_clicks` et `capture_performance` à `false`, `disable_surveys`, `disable_product_tours` et `disable_conversations` à `true` (activables sinon depuis le projet PostHog). Une fois le compte connu, `identify` avec **l'id de l'utilisateur en chaîne** (`"7"`), sans aucune propriété de personne (ni nom, ni login, ni e-mail) ; à la déconnexion, `reset()` oublie cette identité |
| D | Les écrans | Un **`$pageview`** à chaque écran ouvert, avec **`screen`** = le motif de route que React Router a trouvé (`/projets/:id/conception`, `*` pour une adresse inconnue), jamais l'adresse réelle. Un `before_send` retire de chaque événement toute propriété dont le nom contient `url`, `pathname`, `referr` ou `host` (`$current_url`, `$pathname`, `$referrer`, `$referring_domain`, `$host`, `$session_entry_*`, `$prev_pageview_pathname`…) et toute propriété `$initial_*`, dans `properties`, `$set` et `$set_once` : posthog-js en ajoute de lui-même, et une adresse peut porter un secret (`/invitations/<secret>`) |
| E | Les actions du serveur | Un seul point d'appel : **`act()`** (`src/server/action.ts`), après l'écriture de l'entrée d'historique, qu'elle soit `ok`, `refused` ou `error`. `src/server/telemetry.ts` exporte **`sendEvent`** : un `POST` vers `https://eu.i.posthog.com/i/v0/e/` avec `api_key`, `event` = le nom de l'action, `distinct_id` = l'id de l'utilisateur (`"server"` sans utilisateur, avec `$process_person_profile: false`), et les propriétés `result`, `actor`, `origin`, plus `reason` pour un refus (son code fixe) ou une erreur (toujours `error`). Hors de la transaction, **sans l'attendre**, et abandonné après 10 s (`AbortSignal.timeout`) : un PostHog lent, en panne ou injoignable ne retarde ni ne fait échouer l'action ; l'échec ne va que dans les logs du serveur |
| F | Les erreurs de la page | **`api_error`** `{ route, status }` : par un `fetch` donné au client `hc` de `src/web/api.ts`, qui rend la réponse ou l'erreur telle quelle à l'appelant. Capturé pour toute réponse en échec **sauf 401, 403 et 404** (attendues : déconnecté, rôle, disparu), et pour une erreur réseau (`status` 0). Dans `route`, le chemin sans la requête, les segments numériques et les UUID deviennent `:id`, et les deux paramètres textuels des routes aussi : le segment après `invitations` devient `:secret`, celui après `agent-teams` devient `:name` (un secret d'invitation et un nom choisi par l'utilisateur ne partent pas). Les plantages : `capture_exceptions: true`, et une limite d'erreur autour de l'app ainsi que `LoadErrorBoundary` appellent `captureException` ; la limite de l'app affiche « Quelque chose a planté. Recharge la page. » au lieu d'une page blanche |
| G | Ce qui ne part jamais | Ni les `args` ni le `detail` de l'historique (010 D), ni le message d'une erreur du serveur, ni l'adresse d'un écran, ni une propriété de personne, ni le contenu des projets. Les tests stubbent `posthog-js` et `fetch` : aucun n'appelle PostHog |
| H | Le dire | Avec une clé, une ligne en bas de **Réglages** : « Cockpit envoie à PostHog (serveurs dans l'Union européenne) les écrans ouverts, les actions faites et les erreurs rencontrées, sans le contenu de vos projets. » Sans clé, pas de ligne |

## Ce que la revue a précisé

- **Modifie le texte des US** (C, D, F) : la revue a montré, avec le vrai posthog-js, que `$session_entry_url`, `$prev_pageview_pathname`, `$host` et la requête `/flags` portaient l'adresse réelle, et que `route` gardait le secret d'une invitation. Les règles ci-dessus les ferment.
- **`compose.yaml`** transmet `POSTHOG_KEY` au service `app` (`${POSTHOG_KEY:-}`) : sans elle, la clé du fichier d'environnement ne servait qu'à la substitution.

## Ce que le code a précisé

- **Précise G** : « une adresse réelle » était trop large. Un plantage envoie sa pile (`$exception_list`), dont les `filename` sont les adresses des scripts de la page, donc l'hôte de l'instance ; `before_send` ne la touche pas. Jamais l'adresse d'un écran ni sa requête.
- **`src/web/telemetry.ts`** : `init(key)`, `track`, `identify`, `reset` et `captureException`. `posthog-js` est chargé par un `import()` dynamique, et seulement avec une clé ; les appels faits pendant le chargement sont mis en file puis rejoués dans l'ordre. `init` ne bloque pas la page ; si le démarrage échoue, la file est vidée et la télémétrie se tait pour de bon.
- **`fetchTelemetry`** (`Shell.tsx`) lit `GET /api/telemetry` (une réponse en échec donne `null`, jamais un écran d'erreur) et lance `init` sans l'attendre, avant qu'un écran ne s'affiche. **`fetchMe`** appelle `identify(String(me.id))` : dans la requête et non dans un effet, pour que le premier `$pageview` porte déjà le compte. `GET /api/me` rend donc aussi **`id`**.
- **Le tri du `before_send`** : tout nom de propriété qui contient `url`, `pathname`, `referr` ou `host`, ou qui commence par `$initial_`, est retiré de `properties`, `$set` et `$set_once`.
- **`api.ts`** : le `fetch` donné à `hc` rend la réponse ou relance l'erreur telle quelle, et appelle `track("api_error", { route, status })` sauf pour 401, 403 et 404. Une erreur réseau donne `status: 0`. Dans `route`, un segment numérique ou un UUID devient `:id`, celui qui suit `invitations` `:secret`, celui qui suit `agent-teams` `:name`.
- **`App.tsx`** : un `$pageview` avec `screen` = le motif de route. **`LoadErrorBoundary`** gagne une prop `fallback` : avec elle, la limite entoure toute l'app, appelle `captureException` et montre « Quelque chose a planté. Recharge la page. » ; sans elle, elle garde « Impossible de charger la page. ». Une déconnexion appelle `reset()`.
- **`Settings.tsx`** : la ligne de H s'affiche quand `GET /api/telemetry` rend une clé.
- **`src/server/telemetry.ts`** : `sendEvent(event, userId, properties)` ne fait rien sans `POSTHOG_KEY`. **`act()`** l'appelle une fois la transaction terminée (entrée `ok`) ou l'entrée `refused` / `error` écrite, hors du `try` qui journalise, avec `result`, `actor`, `origin` et `reason`.
- **`src/server/test-setup.ts`** supprime `POSTHOG_KEY` : quoi que le shell exporte, la suite n'appelle jamais PostHog.

## Ce qui ne change pas

- L'historique, le journal et les logs du serveur : la télémétrie s'ajoute, elle ne remplace rien.
- La télémétrie OpenTelemetry des sessions cloud ([060](060-cout-et-budget.md), `POST /v1/metrics`), qui reste à Cockpit.

## Limites connues

- **L'adresse IP** : PostHog la garde par défaut. À couper dans le projet PostHog (« Discard client IP data »), Cockpit ne peut pas le faire pour lui.
- **Un plantage de la page envoie son message et sa pile** (`captureException`) : ce sont des textes du code, mais un message peut citer une valeur affichée ou une adresse, et la pile nomme les scripts de la page (leur adresse, donc l'hôte de l'instance).
- **Le motif de route ne vient que des écrans connectés** (ceux du shell) : la connexion, l'installation, `/autoriser` et les invitations n'envoient pas de `$pageview`.
- **Un événement du serveur qui échoue est perdu** : pas de file ni de nouvel essai, l'historique reste la source sûre.
- **Seul `act()` envoie** : l'historique écrit sans lui n'arrive jamais à PostHog (les webhooks, `queue.ts`, `routines.ts`, la nuit, le coût, les jetons, les issues, `pr-follow.ts`), alors que la phrase de Réglages dit « les actions faites ».
- **Un `$pageview` part deux fois en développement** (StrictMode rejoue les effets), et une route de redirection en envoie un, puis sa cible un autre.
- **`/autoriser` a son propre `fetchMe`**, qui n'appelle pas `identify` : sans conséquence, rien n'y part (pas de `$pageview` sur cet écran).
