# 053 — Le journal filtrable et l'historique d'un projet

- **Statut** : proposée (à valider à la relecture de la PR) ; le code est construit (tranche 11.1)
- **Date** : 2026-11-08
- **Décidé par** : Dorian, avec Claude
- **Dépend de** : [010 — Historique](010-historique.md) (D : ce que gardent `args` et `detail` ; G : chacun ne voit que ses entrées ; H : la page Journal), [028 — Journal par pages](028-creme-sombre-onglets-journal.md) (F), [045 — Quatre temps](045-interface-quatre-temps.md)
- **Modifiée par** : [062](062-apres-le-merge.md) : l'onglet Historique gagne deux puces-liens, « Journal » et « Ce qui a été livré » (`/projets/:id/historique/livre`), au-dessus des puces de S16 (I)
- **Modifie** : la [028](028-creme-sombre-onglets-journal.md) F (`GET /api/history` accepte des filtres et rend aussi `args`, `detail` et le réessai d'une entrée)
- **Tranche** : 11.1 du [découpage](../decoupage.md)
- **Écrans** : [S40](../ecrans/S40_Journal.png) (le journal), [S16](../ecrans/S16_Historique.png) (l'onglet Historique d'un projet)

## Contexte

Le brief (§6.12) veut un **journal global filtrable** (projet, outil, origine, auteur, résultat, période) et un **onglet Historique** dans chaque projet. La 010 H et la 028 l'avaient repoussé. Le 2026-11-08, Dorian a choisi : l'export en **CSV filtré** ; une recherche sur les **actions et les codes** (le journal ne garde pas de texte libre, 010 D) ; **quatre périodes fixes** ; et le **réessai** d'un refus montré dans le panneau, comme S40.

## Les choix

| # | Question | Décision |
|---|---|---|
| A | Les filtres de la route ? | `GET /api/history` accepte, tous facultatifs et cumulables : `project` (un id), `action` (un nom exact), `actor` (`human`, `claude`, `github`, `system`), `origin` (`ui`, `mcp`, `webhook`, `system`), `result` (une ou plusieurs valeurs parmi `ok`, `refused`, `error`, séparées par une virgule), `since` (une date ISO 8601 avec fuseau) et `q` (C). Une valeur hors de ces listes, ou un `since` illisible, répond **400** `{ "error": "invalid_filter" }`. Le curseur `before` (028 F) marche avec les filtres. Seules les entrées de l'appelant (010 G) : un `project` qui n'est pas à lui ne rend rien |
| B | Ce que rend une entrée ? | En plus de ce qu'elle rend déjà : `projectId`, `ticketId`, `storyId`, `runId`, `args` et `detail` (le code d'un refus). La 010 D garantit qu'ils ne contiennent que des identifiants, des valeurs fermées et des nombres : les montrer ne dévoile rien. Pour un refus ou une erreur, **`retry`** (D) |
| C | La recherche ? | `q`, de 1 à 100 caractères. **Un nombre** (avec ou sans `#`) trouve les entrées dont le ticket, l'US ou le run porte ce numéro, ou dont les `args` contiennent ce nombre comme valeur (un numéro de PR, par exemple). **Un texte** trouve les entrées dont l'action ou le code du refus le contient, sans tenir compte de la casse. Les caractères `%` et `_` sont cherchés tels quels |
| D | Le réessai ? | Pour une entrée `refused` ou `error` : la **première entrée suivante** du même utilisateur, du même auteur, de la même action et du même projet, **dans l'heure**. `retry` vaut `{ id, at, result }`, ou `null` s'il n'y en a pas |
| E | Les périodes ? | **Aujourd'hui**, **Cette semaine** (depuis lundi), **Ce mois-ci** et **Tout**. Par défaut : Tout. Le navigateur calcule le début de la période à son heure locale et l'envoie dans `since` : le serveur n'a pas à connaître le fuseau de l'utilisateur |
| F | La page Journal (S40) ? | Phrase d'état « Tout ce qui s'est passé, par qui. », puis « Rien ne s'efface ; chaque appel de Claude y est. ». Ensuite, une case **« Chercher… »** et les filtres en puces : **Auteur** (Toi, Claude, GitHub, Cockpit), **Résultat** (Réussi, Refusé, Erreur), **Projet** (les projets de l'utilisateur), **Outil** (les actions que le journal sait nommer, en français), **Origine** (Interface, MCP, Webhook, Cockpit) et la **période**. Un filtre choisi devient une puce avec une croix ; « Effacer les filtres » les retire tous. Les filtres sont dans l'adresse (`?auteur=claude&resultat=refuse&periode=semaine…`) : une vue filtrée survit au rechargement et se partage. Les entrées sont groupées par jour (« Aujourd'hui · 7 entrées », le nombre des entrées affichées). « Afficher plus » (028 F) continue avec les mêmes filtres. Le bouton **« Exporter »** est en haut à droite |
| G | Le panneau d'une entrée ? | Un clic ouvre l'entrée dans le panneau de droite (045). Le titre est « `<action>` `<résultat>` ». Le panneau donne **Quand** (avec les secondes), **Acteur**, **Origine**, **Projet**, **Résultat** (avec le code d'un refus) et **Arguments** (le JSON, en police à chasse fixe). Pour un refus ou une erreur avec `retry` : « Claude a réessayé à 8:41 : réussi. », et un clic ouvre ce réessai. En haut : « 2 sur 7 » et les flèches ↑ ↓ (et les touches) pour passer d'une entrée affichée à l'autre |
| H | L'export ? | `GET /api/history/export`, avec les **mêmes filtres** que A (sans `before`). Il rend un **CSV** en UTF-8 : `Content-Disposition: attachment; filename="journal-<AAAA-MM-JJ>.csv"`, séparateur virgule, une ligne d'en-tête. Les colonnes sont `date` (ISO 8601), `acteur`, `origine`, `action`, `resultat`, `code`, `projet`, `ticket`, `us`, `run` et `arguments` (le JSON). Il prend les **10 000 entrées les plus récentes** qui correspondent. Une cellule qui commence par `=`, `+`, `-`, `@`, une tabulation ou un retour chariot est préfixée d'une apostrophe, pour qu'un tableur ne l'exécute pas comme une formule. Une lecture ne laisse pas d'entrée, comme le journal lui-même |
| I | L'onglet Historique (S16) ? | Un onglet **« Historique »** dans chaque projet, entre « Agents » et « Réglages », sur `/projets/:id/historique`. Phrase d'état « Ce qui s'est passé sur `<projet>`. ». C'est le journal filtré sur le projet, avec les puces de S16 : **Tout**, **Toi**, **Claude**, **GitHub**, **Refus et erreurs** (`result=refused,error`), et la période. Il n'y a pas de case de recherche. Chaque ligne est une phrase en français (« Claude a fini l'étape reviewer »), avec l'auteur en mot à droite. Un lien « Exporter » donne le CSV du projet. Le panneau de G s'ouvre au clic |
| J | La couleur ? | Le budget de la 045 : les résultats restent des mots, sans rouge de plus ; une entrée refusée n'est pas « la première chose à faire » |

## Ce que le code a précisé (tranche 11.1)

- **Les paramètres de la route** : `GET /api/history` et `GET /api/history/export` lisent les mêmes, validés par un schéma zod. Un paramètre inconnu est ignoré. Un paramètre présent **et vide** est invalide (400 `invalid_filter`), jamais « absent ».

| Paramètre | Valeur acceptée |
|---|---|
| `project` | Un entier de 1 à 2 147 483 647 (`^[1-9]\d*$`) : pas de zéro en tête, pas de signe, pas de `0`. Un projet qui n'est pas à l'appelant ne rend rien (200, liste vide) |
| `action` | Une chaîne non vide, comparée telle quelle : un nom inconnu rend une liste vide |
| `actor` | `human`, `claude`, `github` ou `system` |
| `origin` | `ui`, `mcp`, `webhook` ou `system` |
| `result` | `ok`, `refused` ou `error`, séparés par des virgules ; une valeur vide (`ok,`) est invalide |
| `since` | Une date-heure ISO 8601 **avec** `Z` ou un décalage (`2026-11-08T00:00:00.000Z`, `…+01:00`) ; une date seule ou sans fuseau est invalide. Les entrées dont `at` est supérieur ou égal |
| `q` | De 1 à 100 caractères |
| `before` | Seulement pour la liste (028 F) ; 400 `invalid_cursor` si ce n'est pas une entrée de l'appelant |

- **Les champs d'une entrée** : `id`, `at`, `actor`, `origin`, `action`, `result`, `project` (le nom complet `owner/name`, ou `null`), `projectId`, `ticketId`, `storyId`, `runId`, `args`, `detail`, `event` (pour `receive_webhook` seulement) et `retry` (pour une entrée `refused` ou `error` seulement ; une entrée `ok` n'a pas la clé). `args` et `detail` sont rendus tels que la 010 D les garde.
- **Le réessai tel que construit** : c'est la première entrée **strictement après** celle du refus dans l'ordre `(at, id)`, du même utilisateur, du même auteur, de la même action et du même projet (deux entrées sans projet vont ensemble), dont `at` est au plus **une heure** après (borne comprise). Elle est cherchée parmi **toutes** les entrées de l'utilisateur, pas parmi celles de la page ni celles que les filtres laissent passer. Seule la liste rend `retry` ; l'export n'en a pas.
- **Un réessai caché par un filtre** : le panneau le montre quand même (« Claude a réessayé à 8:41 : réussi. »), ouvert d'après `retry` : la ligne a l'auteur, l'action et le projet du refus, avec son heure et son résultat. Ses **Arguments** valent `{}` et son code de refus manque, car la liste ne l'a pas lue. Il n'a pas de « 2 sur 7 » ni de flèches. Si le réessai est dans la liste, un clic ouvre l'entrée elle-même. La phrase est « Tu as réessayé… » pour un acte de l'utilisateur.
- **La recherche** : un `q` fait de chiffres, avec un `#` facultatif devant (`42`, `#42`, `007`), est un nombre : les zéros de tête comptent pour rien, et il correspond à `ticketId`, `storyId` ou `runId`, ou à une valeur **de premier niveau** de `args` qui est ce nombre (un nombre JSON, pas la chaîne « 42 » ni une valeur dans un objet). Tout autre `q` est un texte, cherché sans casse dans l'action et dans le code du refus (`detail.reason`), pas dans les `args`. `%` et `_` sont des caractères comme les autres.
- **L'export** : les colonnes sont, dans l'ordre, `date`, `acteur`, `origine`, `action`, `resultat`, `code`, `projet`, `ticket`, `us`, `run`, `arguments`. Les valeurs sont les codes bruts (`claude`, `ui`, `refused`, le nom complet `owner/name` du projet, le JSON des `args`), pas les mots de l'écran. Format de la RFC 4180 : fins de ligne `\r\n` (dont la dernière), une cellule avec `"`, virgule ou saut de ligne entre guillemets, `"` doublé ; l'apostrophe d'une cellule qui ressemble à une formule vient avant ces guillemets. Les 10 000 entrées les plus récentes, la plus récente en premier. Le nom du fichier porte la date du jour en **UTC**. La réponse a `Content-Type: text/csv; charset=utf-8` et `Cache-Control: no-store`. Une requête invalide rend 400 en JSON.
- **L'index** : `history_user_at_idx` sur `(user_id, at desc, id desc)`, migration `0028`. Il sert la liste et la recherche du réessai.
- **Les adresses de la page Journal** : `?auteur=` (`toi`, `claude`, `github`, `cockpit`), `resultat=` (`reussi`, `refuse`, `erreur`), `projet=` (l'id du projet), `outil=` (le nom de l'action, par exemple `report_step`), `origine=` (`interface`, `mcp`, `webhook`, `cockpit`), `periode=` (`aujourdhui`, `semaine`, `mois` ; `Tout` n'a pas de paramètre) et `q=`. Une valeur inconnue d'`auteur`, `resultat`, `origine` ou `periode` est ignorée ; celle d'un `projet` ou d'un `outil` est envoyée telle quelle (elle rend une liste vide ou un 400) et la puce la montre. Un seul `resultat` à la fois sur la page (l'onglet du projet envoie `refused,error`). Les changements remplacent l'entrée de l'historique du navigateur. L'onglet d'un projet ne met rien dans l'adresse.
- **Les menus et le clavier** : une puce de filtre ouvre un menu ; la première entrée prend le focus, ↑ et ↓ passent de l'une à l'autre, Échap ou un clic ailleurs le ferme, et le focus revient sur la puce. Un choix remplace le menu par une puce avec une croix (« Retirer le filtre … »), qui prend le focus. Avec un panneau ouvert, ↑ et ↓ passent à l'entrée affichée précédente ou suivante, sauf dans un champ de saisie ou un menu. La période est toujours une puce-menu nommée d'après la période choisie.
- **La recherche à l'écran** : la case garde ce qui est tapé ; l'adresse et la requête suivent **300 ms** après la dernière frappe. Les lignes déjà affichées et le panneau ouvert restent pendant le chargement.
- **Les noms de projet** : le menu et la puce disent `name` ; ils disent `owner/name` quand deux projets de l'utilisateur ont le même `name`.
- **Les textes** : « Aucune entrée pour ces filtres. » quand un filtre est posé et que rien ne correspond (« Aucune entrée pour l'instant. » sinon). Le nombre d'un groupe de jour est celui des entrées affichées. « Afficher plus » demande la page suivante avec les mêmes filtres, dans la page et dans l'onglet. Une ligne de la page garde le dessin de la 028 et devient un bouton qui ouvre le panneau.
- **L'onglet Historique** : les phrases sont « Claude a fini l'étape reviewer » et « Claude a lancé l'étape reviewer » pour `report_step` (« Tu as fini l'étape … » pour l'utilisateur) ; toute autre action est dite par son libellé du Journal. Le mot à droite est « toi », « Claude », « GitHub » ou « Cockpit ». Les puces Tout, Toi, Claude, GitHub et Refus et erreurs sont exclusives ; la période se combine avec elles. Le lien « Exporter » reprend les filtres affichés, projet compris.
- **Les différences avec S40 et S16** :
  - le texte du ticket ou de la question sous une ligne (S40 « Le lien doit-il rester valable… », S16 « Run 17 · US 42 · verdict… ») : repoussé, voir ci-dessous ;
  - la puce de période de S16 dit « Aujourd'hui » : elle dit « Tout » par défaut, comme E ;
  - l'onglet « CI / CD » de S16 n'existe pas : les sept onglets sont ceux de la 045 et de la 028, plus « Historique ».

## Ce qui est repoussé

- **Le texte actuel** d'un ticket, d'une US ou d'une question sous chaque ligne (S40 écrit « « Le lien doit-il rester valable… » ») : la 010 D le permet, en relisant par l'identifiant ; la ligne montre pour l'instant le projet et les numéros.
- **Une période choisie entre deux dates.**
- **Un export de plus de 10 000 entrées** : à revoir si un journal en a vraiment besoin.

## Limites connues

- **La recherche ne trouve pas un texte** (le titre d'un ticket, par exemple) : le journal n'en garde pas, par principe (010 D).
- **« Cette semaine » commence lundi** à l'heure du navigateur : deux personnes dans deux fuseaux ne voient pas la même semaine.
- **Le réessai est deviné** (même action, même auteur, même projet, dans l'heure) : une autre tentative, sans lien avec la première, peut être prise pour un réessai.
