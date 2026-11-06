# 021 — Connecter Claude à Cockpit en un minimum de clics

- **Statut** : validée
- **Date** : 2026-10-29
- **Décidé par** : Dorian, avec Claude
- **Dépend de** : [006 — Connexion OAuth](006-connexion-oauth.md), [015 — Les jetons MCP](015-jetons-mcp.md), [016 — Le serveur MCP](016-serveur-mcp.md), [010 — Historique](010-historique.md)
- **Met en œuvre** : la [006](006-connexion-oauth.md), avancée avant les webhooks à la demande de Dorian (2026-10-29 : « je n'arrive déjà pas à lier Claude à Cockpit, j'aimerais qu'en un minimum de clics on puisse le connecter »). Son choix A (« après le MVP ») est donc rouvert : Cockpit tourne sur le Pi avec une adresse publique, ce qui rend le connecteur possible dès maintenant
- **Amendée le 2026-11-05** : le choix B passe de la règle d'hôte aux deux adresses publiées par Claude (US 4.7 ter), et le déploiement derrière Cloudflare Access est décrit (point ouvert 2 de la 006). Voir [l'amendement](#amendement-du-2026-11-05)

## Contexte

Aujourd'hui, connecter Claude demande de créer un jeton, de le copier, puis de taper une commande ou d'écrire un `.mcp.json` avec une variable d'environnement. C'est trop. La 006 a décidé la bonne réponse : Cockpit devient un **connecteur claude.ai**, qu'on ajoute une fois avec son adresse, en se connectant dans le navigateur. Il marche alors dans Claude Code (local et cloud), sur claude.ai, sur le téléphone, et dans les tâches planifiées (qui reçoivent les connecteurs du compte, [doc](https://code.claude.com/docs/en/routines)). Cette tranche le construit, avec une page qui guide l'utilisateur.

## Les choix

Tout ce que la 006 a décidé (C à G : CIMD seulement, consentement derrière la connexion GitHub, jetons dans `mcp_tokens`, durées, `.mcp.json`) s'applique. Cette décision précise le reste.

| # | Question | Décision |
|---|---|---|
| A | Quelles adresses ? | `GET /.well-known/oauth-protected-resource` (RFC 9728 : `resource` = `<adresse publique>/mcp`, `authorization_servers` = l'adresse publique), et la même sous `/.well-known/oauth-protected-resource/mcp`. `GET /.well-known/oauth-authorization-server` (RFC 8414 : `issuer`, `authorization_endpoint` `/oauth/authorize`, `token_endpoint` `/oauth/token`, `response_types_supported` `["code"]`, `grant_types_supported` `["authorization_code", "refresh_token"]`, `code_challenge_methods_supported` `["S256"]`, `token_endpoint_auth_methods_supported` `["none"]`, `client_id_metadata_document_supported` `true`). Les autres `/.well-known/*` restent en 404. Le `401` de `/mcp` porte `WWW-Authenticate: Bearer resource_metadata="<adresse publique>/.well-known/oauth-protected-resource"`. L'adresse publique est celle de l'assistant de démarrage (012) |
| B | Quels clients ? | Un `client_id` doit être l'une des deux adresses publiées par Claude (006 C, amendement du 2026-11-05) : `https://claude.ai/oauth/mcp-oauth-client-metadata` (claude.ai sur le web, Desktop, mobile, Cowork) ou `https://claude.ai/oauth/claude-code-client-metadata` (Claude Code). Toute autre adresse est refusée sans être lue. Cockpit lit ce document (CIMD), en moins de 5 secondes et 64 Kio au plus, et vérifie que son `client_id` est bien cette adresse et que la `redirect_uri` demandée est dans ses `redirect_uris`, en `https:` ou en `http:` sur `localhost` / `127.0.0.1` seulement (un document peut lister `javascript:` ou `data:` : ils sont refusés) ; pour une adresse de retour en boucle locale (`http://localhost` ou `http://127.0.0.1`, celle de Claude Code), le port peut différer, l'hôte, le chemin et la requête non (RFC 8252, 7.3), car Claude Code choisit un port libre à chaque connexion. Un document lu est gardé en mémoire 10 minutes, une lecture échouée 1 minute (sinon une adresse qui ne répond jamais ferait lancer une lecture à chaque requête) ; une seule lecture à la fois par adresse. Tout autre client, ou un document illisible, est refusé : page d'erreur en français, sans redirection |
| C | L'autorisation ? | `GET /oauth/authorize` (`response_type=code`, `client_id`, `redirect_uri`, `code_challenge`, `code_challenge_method=S256`, `state`, `resource` facultatif) vérifie la demande, puis renvoie vers la page `/autoriser` de Cockpit. Sans session, la connexion GitHub passe d'abord (`/api/auth/login?next=…`, avec un `next` limité aux chemins internes commençant par `/autoriser`, et à 4 000 caractères une fois encodé, car il voyage dans un cookie que les navigateurs refusent au-delà d'environ 4 Ko ; pour la même raison, un `state` de plus de 2 048 caractères est refusé dès `/oauth/authorize`, avec la page d'erreur, plutôt que perdu après la connexion). La page dit « **claude.ai** veut accéder à tes projets Cockpit » (le nom du client, son hôte de retour), avec « Autoriser » et « Refuser ». Autoriser (`POST /api/oauth/approve`, session requise) crée un code à usage unique de 60 secondes, gardé en mémoire, et rend l'adresse de retour (`redirect_uri?code=…&state=…`) ; Refuser rend `redirect_uri?error=access_denied&state=…`. Un compte bloqué ne peut pas autoriser. **Toutes** les réponses de Cockpit portent `Content-Security-Policy: frame-ancestors 'none'` et `X-Frame-Options: DENY` (personne n'a besoin d'afficher Cockpit dans un cadre) : le bouton « Autoriser » ne peut pas être piégé, quelle que soit l'écriture de l'adresse (`/autoriser/`, `/AUTORISER`…) |
| D | Le jeton ? | `POST /oauth/token` (`application/x-www-form-urlencoded`). `authorization_code` : code, `redirect_uri` et `client_id` identiques à la demande, `code_verifier` dont le SHA-256 en base64url vaut le `code_challenge`. `refresh_token` : rotation sur la **même ligne** de `mcp_tokens` (006 E). Réponse `{ access_token, token_type: "Bearer", expires_in: 3600, refresh_token }`. Erreurs RFC 6749 : `invalid_request`, `invalid_grant` (code inconnu, expiré, déjà utilisé ; rafraîchissement inconnu, expiré, révoqué, utilisateur bloqué), `unsupported_grant_type`, toujours en `400` JSON. Le jeton d'accès a la forme des jetons manuels (`ckp_…`) : la vérification de `/mcp` ne change pas, elle ajoute seulement l'expiration |
| E | En base ? | Sur `mcp_tokens` (006) : `client_id`, `refresh_hash` (unique), `expires_at` (accès), et `refresh_expires_at` (90 jours, absent de la 006 qui ne disait pas où le garder). Une connexion OAuth compte dans les **20 jetons actifs** (015 D), sauf une ligne dont `refresh_expires_at` est passé : elle est **morte** (elle ne peut plus jamais servir), traitée comme une ligne révoquée dans le décompte des 20 (aussi pour la création manuelle), dans `/api/me/connect` et dans la liste des jetons, et la purge quotidienne la supprime 3 mois après, comme une ligne révoquée ; au-delà, `/oauth/token` répond `invalid_request` et la page des réglages le dit. Son nom est « claude.ai » ou « Claude Code » selon le client. Elle apparaît dans « Jetons MCP », révocable comme les autres ; la révoquer coupe aussi son rafraîchissement |
| F | L'historique ? | `oauth_authorize` (humain, `ui`) à l'autorisation, `oauth_token` (acteur `claude`, origine `mcp`) à chaque émission ou rotation, avec `args: { tokenId, grant }` (`grant` : `authorization_code` ou `refresh_token`) et `token_id`. Une demande refusée sans utilisateur connu n'écrit rien (010 E). Un jeton d'accès expiré sur `/mcp` répond `401` avec l'en-tête `WWW-Authenticate` mais n'écrit **aucune** entrée : le client le rafraîchit chaque heure, c'est le fonctionnement normal ; les jetons révoqués ou inconnus gardent leur entrée `mcp_auth` |
| G | La page « Connecter Claude » ? | Une section en tête de « Réglages », **trois étapes** : 1. « Copier l'adresse » (l'adresse `…/mcp`, un bouton) ; 2. « Ouvrir claude.ai » (lien vers [claude.ai/customize/connectors](https://claude.ai/customize/connectors) : « Ajouter un connecteur personnalisé », coller l'adresse) ; 3. « Se connecter » : claude.ai ouvre Cockpit, on clique « Autoriser ». Puis : « C'est fait : Claude voit tes projets partout, y compris dans les tâches planifiées. » Pour Claude Code sans compte claude.ai, une ligne repliée donne la commande `claude mcp add --transport http cockpit <adresse>/mcp` (Claude Code fait la même connexion OAuth au premier usage) et rappelle que les jetons manuels restent possibles. La section dit si une connexion OAuth existe déjà (« Connecté depuis claude.ai, le … ») |
| H | Le `.mcp.json` des repos ? | Comme la 006 G : la ligne du bilan de santé devient « Cockpit absent du `.mcp.json`, ou déclaré sans secret » ; un `.mcp.json` qui déclare Cockpit reste accepté s'il n'a pas de secret, mais il masque le connecteur (la page le dit) |

## Ce qui est repoussé

- La création d'une routine depuis Cockpit : tranche suivante (demande du 2026-10-29, brief §6.14).
- L'enregistrement dynamique de clients (DCR) : la 006 l'écarte.
- Un écran pour choisir quels projets un connecteur voit : il voit tous ceux de l'utilisateur, comme un jeton (004 D).

## Limites connues

- **Le connecteur claude.ai utilise le CIMD** (vérifié le 2026-11-05 dans [Authentication for connectors](https://claude.com/docs/connectors/building/authentication)) : Claude choisit le CIMD quand les métadonnées du serveur d'autorisation annoncent `client_id_metadata_document_supported: true` et `none` dans `token_endpoint_auth_methods_supported`, ce que Cockpit annonce ; sinon il se rabat sur le DCR. Le DCR reste donc inutile et la 006 C tient.
- **Les codes d'autorisation vivent en mémoire** (006) : un redémarrage de Cockpit pendant les 60 secondes d'une connexion la fait échouer ; on recommence.
- **Si Claude change l'adresse d'un de ses deux documents**, ce client voit la page d'erreur jusqu'à ce que la liste de `src/server/oauth.ts` soit mise à jour.
- **Non vérifiable ici** : la connexion réelle depuis claude.ai (le faux client des tests suit la documentation, pas le vrai service).

## Amendement du 2026-11-05

Dorian a ajouté `https://cockpit-v2.dorianvidal.com/mcp` comme connecteur sur claude.ai et a lu « Impossible de déterminer comment ce serveur gère la connexion », puis « Impossible de s'inscrire auprès du service de connexion ». Cause : Cloudflare Access, pas Cockpit (voir plus bas). En revérifiant la documentation de Claude, l'adresse du document CIMD de claude.ai est maintenant connue (`https://claude.ai/oauth/mcp-oauth-client-metadata`, qui liste `https://claude.ai/api/mcp/auth_callback`) : la limite « règle d'hôte » de cette décision peut être levée, comme elle le prévoyait. Rien d'autre n'est rouvert : la 006 A avait déjà été avancée ici.

### US 4.7 ter — Seuls les deux clients de Claude

> En tant que Dorian, je veux que Cockpit n'accepte que les deux documents CIMD publiés par Claude, pour que la liste des clients soit la courte liste de la 006 C et non tout `https://claude.ai/…`.

1. **Étant donné** la demande de claude.ai (`client_id` `https://claude.ai/oauth/mcp-oauth-client-metadata`, `redirect_uri` `https://claude.ai/api/mcp/auth_callback`, document conforme), **quand** Dorian, connecté, ouvre `/oauth/authorize`, **alors** il arrive sur `/autoriser`, la page dit « claude.ai », et après l'échange du code le jeton s'appelle « claude.ai ».
2. **Étant donné** la demande de Claude Code (`client_id` `https://claude.ai/oauth/claude-code-client-metadata`, `redirect_uri` `http://localhost:<port>/callback` ou `http://127.0.0.1:<port>/callback`), **quand** il ouvre `/oauth/authorize`, **alors** même chose, avec « Claude Code ».
3. **Étant donné** tout autre `client_id` sous `https://claude.ai/` (par exemple `https://claude.ai/oauth/another-client`, ou l'adresse de claude.ai suivie de `/`, de `?x=1` ou d'une autre casse), même avec un document par ailleurs conforme, **quand** `/oauth/authorize` est demandé, **alors** Cockpit répond la page d'erreur `400`, sans redirection et **sans lire le document** ; `GET /api/oauth/request` et `POST /api/oauth/approve` répondent `400` `invalid_request`.

### Déploiement derrière Cloudflare Access (point ouvert 2 de la 006)

Constat du 2026-11-05 : Cloudflare Access protège tout l'hôte `cockpit-v2.dorianvidal.com`. `/mcp`, `/.well-known/*` et `/api/health` répondent `302` vers `dorianvidal.cloudflareaccess.com`, et `/mcp` porte même l'en-tête d'Access (`WWW-Authenticate: Cloudflare-Access resource_metadata="…/.well-known/cloudflare-access-protected-resource/mcp"`), pas celui de Cockpit. Les serveurs de Claude (`160.79.104.0/21`) ne voient donc jamais Cockpit.

Il faut une application Access « Bypass » (action *Bypass*, *Everyone*) sur ces chemins du même hôte, appelés par Claude lui-même (ses serveurs, ou Claude Code depuis la machine de l'utilisateur) et non par un navigateur où l'on peut passer Access :

| Chemin | Appelé par |
|---|---|
| `/mcp` | Claude, avec le jeton de Cockpit |
| `/.well-known/*` | Claude (métadonnées RFC 9728 et 8414) |
| `/oauth/token` | Claude (échange du code, rafraîchissement) |
| `/api/webhooks/github` | GitHub (tranche 5.1) : même blocage |

Peuvent rester derrière Access : `/oauth/authorize`, `/autoriser`, `/api/oauth/*` et `/api/auth/*`, qui s'ouvrent dans le navigateur de l'utilisateur (Access, puis la connexion GitHub de Cockpit). Le mode anti-bots et le pare-feu de Cloudflare ne doivent pas défier `160.79.104.0/21`.

Vérification, sans session ni cookie :

```bash
curl -i -X POST https://cockpit-v2.dorianvidal.com/mcp
curl https://cockpit-v2.dorianvidal.com/.well-known/oauth-authorization-server
```

Le premier doit répondre `401` avec `WWW-Authenticate: Bearer resource_metadata="https://cockpit-v2.dorianvidal.com/.well-known/oauth-protected-resource"`, le second le JSON de Cockpit (`client_id_metadata_document_supported: true`). Claude garde les métadonnées lues environ 5 minutes : après la correction, attendre un peu avant de réessayer le connecteur.
