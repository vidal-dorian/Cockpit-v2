# 016 — Le serveur MCP

- **Statut** : validée
- **Date** : 2026-10-25
- **Décidé par** : Dorian, avec Claude
- **Dépend de** : [001 — Stack technique](001-stack.md), [002 — Modèle de données](002-modele-donnees.md), [004 — Outils MCP](004-outils-mcp.md), [010 — Historique](010-historique.md), [014 — Tickets](014-tickets.md), [015 — Les jetons MCP](015-jetons-mcp.md)
- **Tranche** : 4.2 du [découpage](../decoupage.md)
- **Modifie** : la [004](004-outils-mcp.md), colonnes `args` et `detail` de son tableau « Journal » (choix F)

## Contexte

Claude Code agit sur Cockpit par un serveur MCP (004). Cette tranche le met en place : le transport, l'authentification par jeton (015), l'enrobage qui journalise chaque appel, et cinq outils : `list_projects`, `get_project`, `search`, `get_ticket`, `create_ticket`. Les autres outils de la 004 viennent avec les tranches qui créent ce qu'ils touchent.

## Les choix

| # | Question | Décision |
|---|---|---|
| A | Quel transport ? | `POST /mcp`, avec le SDK officiel `@modelcontextprotocol/sdk` 1.32.2 (nouvelle dépendance, la 001 le prévoyait). On utilise son transport **« web standard »** (`WebStandardStreamableHTTPServerTransport`, qui prend et rend les `Request` / `Response` du standard Fetch) : il se branche sur `c.req.raw` de Hono sans passer par les objets bruts de Node. Il tourne **sans session** (pas d'identifiant de session) et en **réponses JSON** (`enableJsonResponse`, pas de SSE) : un POST = une requête JSON-RPC = une réponse `application/json` |
| B | Pourquoi sans session ? | Les cinq outils répondent tout de suite et ne gardent rien entre deux appels : une session ne servirait qu'à garder en mémoire un état qui doit de toute façon survivre à un redémarrage (architecture, « Montée en charge »). Sans session, deux instances et un redémarrage ne changent rien, et le serveur n'a ni flux à garder ouvert ni `initialize` à retenir. Le serveur (`Server` du SDK) et le transport sont **créés à chaque requête** et fermés après. `tools/list` et `tools/call` marchent sans `initialize` préalable ; `initialize` reçoit une réponse qui annonce la capacité `tools`. `GET /mcp` et `DELETE /mcp` répondent 405 (`Allow: POST`) : pas de flux à ouvrir, pas de session à fermer |
| C | Où est vérifié le jeton ? | **Avant le SDK**, dans la route. `Authorization: Bearer <secret>` : le secret est haché (SHA-256, comme à la création, 015 B) et cherché dans `mcp_tokens`. Il n'est jamais écrit, ni dans l'historique, ni dans les logs |
| D | Quels refus d'accès ? | 401 avec `WWW-Authenticate: Bearer` et `{ error: <code> }`. Sauf pour `missing_token`, **une entrée** `mcp_auth` (`refused`, acteur `claude`, origine `mcp`, `user_id` vide, `args` `{}`) dont le `detail` porte le code : `invalid_token` (en-tête qui n'est pas `Bearer …`, ou jeton que personne n'a), `revoked_token` (jeton révoqué), `blocked_user` (jeton d'un utilisateur bloqué, 012 G). Pour les deux derniers, `token_id` est rempli : on sait quel jeton a été présenté ; pour `invalid_token`, il est vide. **Une requête sans en-tête `Authorization` ne laisse aucune entrée** (`missing_token`, 401 seulement) : rien n'a été présenté, et sans cela n'importe quel passant ferait grossir une table qu'on ne peut pas vider (même règle que la requête sans `state` valide, 010 E) Un jeton accepté met `last_used_at` à jour ; un jeton refusé ne le touche pas |
| E | Que garde `history.token_id` ? | Une colonne ajoutée par la migration `0009` (entier, vide, sans clé étrangère, comme `ticket_id`, 002 et 010). L'entrée de chaque appel d'outil porte le jeton utilisé ; `Entry` de `act` a un champ `tokenId` facultatif |
| F | **Que garde le journal des arguments et de la réponse ?** | **La 004 est modifiée.** Elle demandait `args` = les arguments en JSON et `detail` = la réponse ou le message. La **règle D de la 010** (jamais de texte libre ni de donnée personnelle dans l'historique, qui est inaltérable) l'emporte : `args` ne garde que les **identifiants** demandés (`{ projectId }`, `{ ticketId }`, `{}` quand l'outil n'en prend pas), et `detail` un **code fixe** (`not_found`, `project_archived`, `invalid_arguments`, `unknown_tool`, ou `error`). Ni la requête de `search`, ni le titre ni la description d'un ticket, ni le texte d'une réponse n'y entrent. Des arguments qui ne respectent pas le schéma donnent `args: {}` (on ne fait pas confiance à ce qui est mal formé). `create_ticket` réussi : `args: { ticketId }` du nouveau ticket |
| G | Comment s'appelle un outil inconnu dans le journal ? | Sous **son propre nom** si c'est un identifiant court (`/^[a-z][a-z0-9_]{0,39}$/`), pour voir ce que Claude essaie de faire (`delete_project`) ; sinon sous `unknown_tool`. Le nom vient de l'extérieur : sans cette limite, il écrirait n'importe quel texte dans une table qu'on ne peut pas effacer. Dans les deux cas, `detail` vaut `unknown_tool` |
| H | Comment répondent les outils ? | Comme la 004 : une réussite est un objet JSON dans le premier élément `text` ; un refus (`Refused: …`) ou une erreur (`Error: …`) est un résultat marqué `isError: true`, jamais une erreur du protocole. Les arguments qui ne passent pas la validation Zod donnent un **refus** qui nomme le champ fautif (`title`, `project_id`…) : le SDK, lui, répondrait par une erreur du protocole, donc la validation se fait dans Cockpit, avec les mêmes schémas que l'interface pour le titre et la description d'un ticket (014). L'erreur dit de réessayer ; elle ne contient rien de l'échec (le log du serveur garde le détail) |
| I | Accès | Mêmes règles que la 004 : chaque projet ou ticket passe par `memberProject` (002) ; celui d'un autre, ou qui n'existe pas, donne **le même** `Refused: not found`. `get_project` et `get_ticket` lisent aussi les projets archivés ; `create_ticket` y est refusé (`project_archived`, 014 D) ; `list_projects` et `search` les ignorent |

## Les outils et leurs réponses

Tous les noms de champs sont en `snake_case`. Les descriptions (en anglais, pour Claude seul) sont dans le code, `src/server/mcp.ts`, et se relisent comme lui.

| Outil | Demande | Réussite |
|---|---|---|
| `list_projects` | — | `{ projects: [{ id, full_name, default_branch }] }`, projets actifs de l'utilisateur, aucun appel à GitHub |
| `get_project` | `project_id` | `{ project: { id, full_name, default_branch, archived }, claude_md, claude_md_unreachable, tickets: [{ id, title, step }] }`. `claude_md` est lu sur GitHub avec l'identité de l'App : la racine de la branche par défaut, puis `CLAUDE.md` **au commit que la racine a rendu** (comme le bilan de santé, 013) ; `""` s'il n'existe pas ou si le repo est vide. Si la racine répond 404 (l'App n'a plus accès au repo), la réponse reste une **réussite** : le projet et ses tickets, `claude_md: ""` et `claude_md_unreachable: true` (réessayer n'y changerait rien). Toute autre panne de GitHub est une erreur, à réessayer. La lecture de GitHub se fait **avant** la transaction de l'action, jamais dedans : elle peut durer jusqu'à trois appels de 10 secondes, et une connexion à la base ne doit pas y rester tenue. Seul le `CLAUDE.md` de la racine est lu, pas `.claude/CLAUDE.md` |
| `search` | `query` (2 à 200 caractères), `project_id` facultatif | `{ results: [{ type, id, title, project_id, step? }] }`, 20 au plus. Tous les mots de la requête doivent apparaître, sans tenir compte de la casse, dans le nom d'un projet (`type: "project"`) ou le titre d'un ticket (`type: "ticket"`, avec `step`). `%`, `_` et `\` sont des caractères ordinaires. Avec `project_id`, seuls les tickets de ce projet sont cherchés. Aucun résultat n'est pas un refus |
| `get_ticket` | `ticket_id` | `{ id, project_id, title, description_md, step, stories: [] }` (les US viennent en 4.3) |
| `create_ticket` | `project_id`, `title`, `description_md` facultative | `{ id, project_id, title, step }`. Mêmes limites que l'interface (014) : titre rogné de 1 à 200 caractères, description de 50 000 au plus, sans NUL |

## Se connecter depuis Claude Code

Syntaxe de la [documentation de Claude Code sur MCP](https://code.claude.com/docs/en/mcp), relue pendant la relecture de la tranche. Mettre le jeton dans une variable d'environnement **sans le laisser dans l'historique du shell** :

```sh
read -rs COCKPIT_MCP_TOKEN; export COCKPIT_MCP_TOKEN   # coller le jeton, puis Entrée
```

(ou l'écrire dans le profil du shell, lisible par soi seul). **Forme recommandée : `.mcp.json` du repo**, qui ne contient que le nom de la variable. Le type `http` est obligatoire, et Claude Code remplace `${VAR}` et `${VAR:-défaut}` dans `url` et `headers` :

```json
{
  "mcpServers": {
    "cockpit": {
      "type": "http",
      "url": "https://<adresse publique>/mcp",
      "headers": { "Authorization": "Bearer ${COCKPIT_MCP_TOKEN}" }
    }
  }
}
```

Pour une seule machine, sans fichier : `claude mcp add --transport http cockpit https://<adresse publique>/mcp --header 'Authorization: Bearer ${COCKPIT_MCP_TOKEN}'` (entre apostrophes, le shell ne remplace rien ; les réglages locaux et utilisateur gardent `${VAR}` par son nom, d'après cette documentation). Quand un en-tête `Authorization` est configuré, un 401 est rapporté comme une connexion échouée, sans repli sur OAuth : un jeton refusé se voit donc comme tel dans Claude Code. Le refus est écrit dans l'historique (`mcp_auth`), sans utilisateur (D) : il n'apparaît dans le Journal de personne tant que la vue d'administration n'existe pas (010 G) ; le libellé « Connexion MCP refusée » est prêt pour elle.

Le chemin `/.well-known/*` (découverte OAuth, 006, après le MVP) répond **404 en JSON** : sans cela, un client qui cherche la découverte recevrait la page de l'application.

Pour le SDK : les types et le code de `@modelcontextprotocol/sdk` 1.32.2 installé (`server/webStandardStreamableHttp.d.ts`, `server/index.d.ts`) ; la documentation en ligne du SDK n'a pas été relue.

## Limites connues

- **Les tentatives avec un faux jeton font grossir la table `history`**, qu'on ne peut pas vider : une entrée d'environ 150 octets par essai, et personne ne les voit (elles n'ont pas d'utilisateur, 010 G). Il n'y a **pas encore de limite de débit** ; elle s'ajoutera si cela arrive (même réserve que pour la connexion, 010).
- **Pas d'égalisation des temps** entre un jeton inconnu et un jeton révoqué : le premier ne trouve pas de ligne, le second oui, et la réponse peut différer de quelques microsecondes. C'est acceptable parce que la recherche se fait par l'empreinte du jeton : on ne peut pas deviner un secret de 256 bits (015 B) à partir d'un temps de réponse.
- **Une réponse qui annonce « not found »** ne dit pas si c'est le projet ou le ticket qui manque, ni si c'est l'accès qui est refusé : c'est voulu (004), mais Claude doit chercher l'identifiant par `list_projects` ou `search`.
- La limite de 256 Kio du corps (014) ne couvre que `/api/*` ; la route `/mcp` a sa propre limite, la même, fixée sur le transport.

## Pistes écartées

- **`McpServer` et `registerTool` du SDK** : ils valident les arguments eux-mêmes et répondent par une erreur du protocole, ce qui ne laisse ni refus lisible par Claude ni entrée d'historique. On utilise `Server` (plus bas niveau) et on valide avec Zod dans Cockpit.
- **Le transport pour Node** (`StreamableHTTPServerTransport`, objets `IncomingMessage` / `ServerResponse`) : il fallait atteindre ces objets par `@hono/node-server`, et le test avec `app.request()` ne les a pas. Le transport « web standard » fait la même chose avec des `Request` et des `Response`.
- **Garder des sessions** : voir B.
- **Journaliser les arguments et la réponse** (004) : voir F.
