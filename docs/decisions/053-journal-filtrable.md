# 053 — Le journal filtrable et l'historique d'un projet

- **Statut** : proposée (à valider à la relecture de la PR)
- **Date** : 2026-11-08
- **Décidé par** : Dorian, avec Claude
- **Dépend de** : [010 — Historique](010-historique.md) (D : ce que gardent `args` et `detail` ; G : chacun ne voit que ses entrées ; H : la page Journal), [028 — Journal par pages](028-creme-sombre-onglets-journal.md) (F), [045 — Quatre temps](045-interface-quatre-temps.md)
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

## Ce qui est repoussé

- **Le texte actuel** d'un ticket, d'une US ou d'une question sous chaque ligne (S40 écrit « « Le lien doit-il rester valable… » ») : la 010 D le permet, en relisant par l'identifiant ; la ligne montre pour l'instant le projet et les numéros.
- **Une période choisie entre deux dates.**
- **Un export de plus de 10 000 entrées** : à revoir si un journal en a vraiment besoin.

## Limites connues

- **La recherche ne trouve pas un texte** (le titre d'un ticket, par exemple) : le journal n'en garde pas, par principe (010 D).
- **« Cette semaine » commence lundi** à l'heure du navigateur : deux personnes dans deux fuseaux ne voient pas la même semaine.
- **Le réessai est deviné** (même action, même auteur, même projet, dans l'heure) : une autre tentative, sans lien avec la première, peut être prise pour un réessai.
