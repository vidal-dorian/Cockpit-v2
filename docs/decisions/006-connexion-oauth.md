# 006 — Connexion de Claude à Cockpit par OAuth

- **Statut** : validée
- **Date** : 2026-10-22
- **Décidé par** : Dorian, avec Claude
- **Dépend de** : [001 — Stack technique](001-stack.md), [002 — Modèle de données](002-modele-donnees.md), [004 — Outils MCP](004-outils-mcp.md)
- **Modifie** : la décision D de la [004](004-outils-mcp.md) (« un jeton par machine »), après le MVP seulement
- **Modifiée par** : [021 — Connecter Claude](021-connecter-claude.md) : le choix A (« après le MVP ») est rouvert, la tranche est avancée avant les webhooks ; la 021 précise les adresses, les clients acceptés et l'expiration du rafraîchissement

## Contexte

Au MVP, Claude s'identifie auprès de Cockpit avec un jeton créé à la main (004, tranche 4.1), placé dans la variable `COCKPIT_MCP_TOKEN` du PC. C'est simple en local, mais pénible ailleurs :

- **Cloud** : il faut coller un jeton dans chaque environnement claude.ai (brief §6.18).
- **Nouveau PC** : il faut créer un jeton, le copier, le placer dans une variable. Le brief demande au contraire que la configuration soit « la plus simple possible » (§6.11) et qu'aucun secret ne passe par le terminal (§6.18).
- **Téléphone ou chat claude.ai** : impossible aujourd'hui.

Si Cockpit sait faire OAuth, on l'ajoute **une seule fois** comme connecteur sur claude.ai, on se connecte dans le navigateur, et il est disponible partout.

## Ce que permet Claude (octobre 2026)

Le brief (§8) demande de revérifier les faits de la v1. D'après la documentation officielle :

- **Un connecteur claude.ai est disponible sur le web, Desktop, mobile, et dans Claude Code**, en local comme dans les sessions cloud, quand on est connecté avec son compte Claude ([Get started with connectors](https://claude.com/docs/connectors)). Le fait du brief « une session cloud ne charge que le `.mcp.json` du repo » est donc dépassé.
- **Dans une session cloud, aucune connexion à faire** : le proxy de la session s'authentifie avec l'autorisation donnée sur claude.ai ([Claude Code, MCP](https://code.claude.com/docs/en/mcp#use-mcp-servers-from-claude-ai)).
- **Un serveur déclaré dans `.mcp.json` passe avant un connecteur de même adresse**, qui est alors masqué ([même page, précédence](https://code.claude.com/docs/en/mcp)).
- **Ce que Claude attend du serveur** ([Authentication for connectors](https://claude.com/docs/connectors/building/authentication)) :
  - un `401` avec `WWW-Authenticate: Bearer resource_metadata="…"` quand le jeton manque ;
  - les métadonnées de la ressource protégée (RFC 9728) et du serveur d'autorisation (RFC 8414) ;
  - l'identification du client par **CIMD** (*Client ID Metadata Document*) ou par enregistrement dynamique (DCR) ;
  - PKCE en `S256` ;
  - un `/token` qui lit du `application/x-www-form-urlencoded`, avec rotation du jeton de rafraîchissement et `invalid_grant` quand il n'est plus valable ;
  - deux adresses de retour : `https://claude.ai/api/mcp/auth_callback` (web, Desktop, mobile) et `http://localhost:<port>/callback` ou `http://127.0.0.1:<port>/callback` sur n'importe quel port (Claude Code) ;
  - des réponses en moins de 10 secondes ;
  - un serveur joignable depuis `160.79.104.0/21`, les adresses sortantes d'Anthropic.

## Les choix

| # | Question | Décision |
|---|---|---|
| A | Quand ? | **Après le MVP**, avant ou avec le cloud. Le MVP est local, et le jeton manuel y suffit |
| B | OAuth remplace-t-il le jeton manuel ? | **Non, il s'ajoute.** Le jeton manuel reste pour ceux qui utilisent Claude Code avec une clé API (sans compte claude.ai, donc sans connecteur) |
| C | Comment Claude se présente-t-il à Cockpit ? | **CIMD seulement**, sans DCR. Cockpit n'accepte que les `client_id` d'une courte liste d'adresses `https://claude.ai/…` (celles du connecteur et de [Claude Code](https://claude.ai/oauth/claude-code-client-metadata)) |
| D | Qui autorise ? | L'humain, sur un **écran de consentement de Cockpit**, derrière la connexion GitHub (1.3). L'écran affiche le client et l'hôte de retour, comme l'exige la spécification MCP |
| E | Où vivent les jetons OAuth ? | **Dans `mcp_tokens`**, comme les autres : une connexion OAuth = une ligne, visible et révocable dans la même liste. La vérification de la tranche 4.2 ne change pas |
| F | Durées | Jeton d'accès : **1 heure**. Jeton de rafraîchissement : **90 jours**, remplacé à chaque usage. Code d'autorisation : **60 secondes**, à usage unique |
| G | Et le `.mcp.json` des repos ? | Une fois OAuth en place, **Cockpit n'y figure plus** : il masquerait le connecteur, et une session cloud ne peut pas faire de connexion dans un navigateur. Le connecteur suffit partout |

## Comment ça marche

1. Dorian ajoute l'adresse `https://<cockpit>/mcp` comme connecteur sur claude.ai.
2. Claude appelle `/mcp` sans jeton. Cockpit répond `401` et indique où lire ses métadonnées.
3. Claude ouvre la page d'autorisation de Cockpit. Si Dorian n'est pas connecté, Cockpit passe d'abord par GitHub.
4. Dorian lit « claude.ai veut accéder à vos projets Cockpit » et accepte.
5. Cockpit renvoie un code vers `claude.ai/api/mcp/auth_callback`. Claude l'échange contre un jeton d'accès et un jeton de rafraîchissement.
6. Chaque appel MCP porte le jeton d'accès. Toutes les sessions (cloud, local, mobile) l'utilisent sans rien configurer.

## Modèle de données

Sur `mcp_tokens` (002), trois colonnes facultatives, vides pour un jeton manuel :

| Colonne | Rôle |
|---|---|
| `client_id` | L'adresse CIMD du client, pour afficher « claude.ai » ou « Claude Code » dans la liste et le journal |
| `refresh_hash` | L'empreinte du jeton de rafraîchissement, unique |
| `expires_at` | L'expiration du jeton d'accès |

Au rafraîchissement, les deux empreintes sont remplacées **sur la même ligne** : le `token_id` du journal reste celui de la connexion. Les codes d'autorisation vivent en mémoire (60 secondes) et non en base.

## Conséquences

- **Découpage** : une tranche après le MVP, « Connexion OAuth ». Elle remplace « brancher un PC en une commande » et les jetons à coller dans les environnements cloud (brief §6.18).
- **004, décision D** : avec le connecteur, il y a une connexion **par compte claude.ai**, non plus une par machine. Les jetons manuels gardent leur règle d'un jeton par machine.
- **Tranche 4.2 (seul effet sur le MVP)** : un jeton absent ou invalide reçoit un **`401`** HTTP, et non une réponse MCP en erreur. La tranche OAuth n'aura plus qu'à y ajouter l'en-tête `WWW-Authenticate`.
- **Bilan de santé (2.2) et « Préparer pour Claude » (6.2)** : à la tranche OAuth, la ligne « serveur MCP déclaré sans secret » devient « Cockpit absent du `.mcp.json`, ou déclaré sans secret ». Le catalogue retire Cockpit du `.mcp.json`.
- **Plusieurs utilisateurs (§6.19)** : chacun ajoute le connecteur sur son propre compte claude.ai, et OAuth dit qui appelle. Rien de partagé dans le repo.

## Limites connues

- **Moins de détail sur la machine** : toutes les sessions d'un compte (cloud, local, mobile) partagent la même connexion. Le journal ne dit plus de quelle machine vient un appel. Si l'origine « session locale ou cloud » (§6.12) devient nécessaire, la session la déclarera dans `start_run`.
- **Cockpit est joignable depuis n'importe quel chat claude.ai** : un courriel ou une page lus par Claude pourraient l'inciter à appeler un outil. Les outils dangereux n'existent pas (004), et claude.ai permet de demander une approbation par outil.
- **Seuls les clients Claude** sont acceptés (choix C). Un autre client MCP (Cursor, etc.) demandera d'ajouter DCR.
- **Un redémarrage du serveur** perd les codes d'autorisation en cours : la connexion est à refaire, rien d'autre n'est perdu.

## Points ouverts

1. **Routines** : une routine déclenchée par API reçoit-elle les connecteurs claude.ai ? À vérifier avant la tranche des routines.
2. **Exposition (1.2)** : Cloudflare Tunnel est retenu (008). Vérifier qu'aucune protection de Cloudflare (anti-bots, pare-feu) ne bloque `160.79.104.0/21`, ni les webhooks GitHub, et que `/.well-known/*` est servi.
3. **SDK MCP** : regarder ce que `@modelcontextprotocol/sdk` fournit côté serveur d'autorisation, en sachant que ses aides visent Express et non Hono.

## Pistes écartées

- **DCR** : Claude enregistre un nouveau client à chaque connexion, et la table des clients grossit sans fin. Inutile, puisque les deux clients Claude ont un CIMD.
- **Jeton fixe saisi sur claude.ai (`static_headers`)** : en bêta, réservé à certaines organisations, et il identifie l'organisation, pas la personne.
- **GitHub comme serveur d'autorisation** : il ne gère ni CIMD ni DCR, et Cockpit doit de toute façon émettre ses propres jetons, révocables et journalisés.
- **Garder Cockpit dans le `.mcp.json` à côté du connecteur** : il masquerait le connecteur (précédence), et une session cloud ne peut pas faire la connexion dans un navigateur.
- **OAuth dès le MVP** : le gain en local est modéré, alors qu'un serveur d'autorisation représente au moins une tranche entière.
