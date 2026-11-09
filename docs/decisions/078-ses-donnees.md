# 078 — Ses données : les voir, les exporter, supprimer son compte

- **Statut** : proposée (à valider à la relecture de la PR) ; le code est construit (tranche 13.5)
- **Date** : 2026-11-09
- **Décidé par** : Dorian, avec Claude ([064](064-tranches-restantes.md) 13.5 A à C)
- **Dépend de** : [010 — L'historique](010-historique.md) (A, les triggers ; D, rien de personnel dans `args`), [012 — La configuration automatique](012-configuration-automatique.md) (la clé de l'instance, Réglages › Instance), [015 — Les jetons MCP](015-jetons-mcp.md), [076 — Plusieurs utilisateurs](076-plusieurs-utilisateurs.md), [077 — Les offres et les quotas](077-offres-et-quotas.md) (B, le quota Gratuit, `ownedRepos` dans `plans.ts`)
- **Modifie** : 010 A (une seule exception : la fonction de suppression de compte efface les entrées de la personne), le principe 4 du brief (064 13.5 B)
- **Tranche** : 13.5 du [découpage](../decoupage.md)
- **Écran** : [S50](../ecrans/S50_Reglages_Donnees.png)

## Contexte

Rien ne permet de savoir ce que Cockpit garde sur soi, ni de l'emporter, ni de l'effacer. La 064 13.5 a tranché : une page Données (S50), un export JSON de tout ce qu'elle liste, une suppression qui efface tout, journal compris, par une seule exception à l'historique inaltérable, et une empreinte qui garde le compteur de repos gratuits.

## Les choix

| # | Question | Décision |
|---|---|---|
| A | La page Données (S50) | Réglages › **Données**. Phrase d'état : « Ce que Cockpit garde sur toi. » / « Et comment tout effacer. » Une carte de lignes, lues en base : **Compte** (nom · GitHub @login) ; **Projets** (le nombre de projets dont tu es membre · tickets, US, runs, questions) ; **Journal** (le nombre de tes entrées · gardées tant que le compte existe) ; **Secrets** (jetons chiffrés · jamais affichés) ; **Code de tes repos** (jamais copié : lu sur GitHub à la demande). Puis « Exporter mes données » et « Supprimer mon compte » (B, C). Une dernière phrase dit ce qui reste après une suppression (E) |
| B | Exporter | « Préparer l'export » télécharge `cockpit-<login>-<date>.json` (`GET /api/me/export`) : le compte (sans rien de secret), les projets dont tu es membre avec leurs tickets, US, critères, runs, étapes et questions, tes entrées du journal, tes jetons MCP (nom, dates, jamais le secret ni son empreinte), tes réglages. Jamais un secret, chiffré ou non. L'export est journalisé (`export_data`) |
| C | Supprimer (064 13.5 A) | « Supprimer mon compte… » ouvre une fenêtre de confirmation : ce qui sera effacé, et pour chaque projet partagé dont tu es propriétaire, « `owner/repo` sera supprimé pour `@marie`, `@karim`. » ; tu tapes ton login GitHub pour confirmer. `DELETE /api/me` (avec `{ login }`) efface, dans une transaction : les projets dont tu es propriétaire et tout ce qu'ils contiennent (tickets, US, runs, pièces jointes, constats, carte du code…, pour tous leurs membres), tes appartenances aux projets des autres (et tes US de leur file et de leur nuit ; tes runs sur leurs projets restent, **anonymisés** : leur historique appartient au projet, comme les tickets et les US qu'il garde), tes jetons, tes sessions, tes abonnements aux notifications, tes routines (et les projets supprimés sortent des routines des autres membres), tes réglages, tes invitations, et le lien de ton code Pro (le code reste « utilisé », sans compte). Les livraisons de webhooks gardées pour les repos supprimés (024) sont effacées aussi. Puis la session est fermée et la page revient à la connexion. **Rien ne change sur GitHub** : repos, issues, PR et installation de l'App restent |
| D | Le journal (064 13.5 B) | Une **fonction de la base**, réservée à la suppression de compte, efface les entrées de la personne (`user_id`) et celles des projets supprimés (`project_id`) ; c'est la seule exception aux triggers de la 010 A. Une entrée **sans utilisateur** reste : `account_deleted`, `args` vide. Un test prouve que rien d'autre (un `UPDATE`, un `DELETE`, un `TRUNCATE` direct) ne peut modifier ni supprimer une entrée |
| E | L'empreinte (064 13.5 C) | À la suppression, Cockpit garde **une empreinte** du compte GitHub (HMAC-SHA256 de son identifiant numérique, avec une clé tirée de la clé de l'instance, jamais en base) et **le nombre de repos gratuits déjà utilisés** (les projets dont le compte était propriétaire, archivés compris, plus ceux d'une empreinte précédente). Rien d'autre. Au retour du même compte GitHub, le quota Gratuit (077 B) ajoute ce nombre. La page Données le dit : « Après une suppression, Cockpit garde seulement une empreinte de ton compte GitHub et le nombre de repos gratuits utilisés, pour qu'une suppression ne redonne pas 3 repos. Demande à l'administrateur de l'effacer. » |
| F | Effacer une empreinte | Réglages › Instance, pour l'administrateur : « Effacer l'empreinte d'un compte supprimé », un champ @login GitHub. Cockpit lit l'identifiant du compte sur GitHub, calcule l'empreinte et l'efface ; « Aucune empreinte pour ce compte. » sinon. L'effacement est journalisé (`fingerprint_erased`, sans login dans `args`) |
| G | L'administrateur | Le compte d'un administrateur de l'instance ne se supprime pas depuis Données : « Tu administres cette instance : ton compte ne peut pas être supprimé ici. » (sinon l'instance resterait sans administrateur) |

## Limites connues

- **L'export se prépare pendant la requête** : sur un très gros compte, il peut prendre quelques secondes.
- **Un membre d'un projet supprimé** en est prévenu seulement dans la fenêtre de confirmation de celui qui supprime, pas par Cockpit.
- **Une empreinte ne s'efface que par l'administrateur** : la personne le lui demande hors de Cockpit.
