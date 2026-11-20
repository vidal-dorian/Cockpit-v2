# Règles en vigueur

> Chaque règle tient en une ligne, avec la décision qui la fonde. Les changer, c'est revenir sur la décision. Le détail et le pourquoi sont dans [`decisions/`](decisions/) ; l'architecture est dans [`architecture.md`](architecture.md).

## Données et accès

- **L'humain garde la main** : valider, abandonner, merger ne sont pas des outils MCP ; la table des droits est testée ligne par ligne ([004](decisions/004-outils-mcp.md)).
- **Une seule fonction d'accès** : `memberProject` vérifie que l'utilisateur est membre du projet et que son rôle suffit, sinon « introuvable » ([002](decisions/002-modele-donnees.md), [076](decisions/076-plusieurs-utilisateurs.md)).
- **Chaque route ou outil MCP qui écrit nomme son rôle minimal** (`read_only` par défaut, jusqu'à `owner`) ([076](decisions/076-plusieurs-utilisateurs.md)).
- **Une action métier = une transaction** : droit vérifié, changement appliqué et entrée d'historique écrite ensemble, ou rien ([010](decisions/010-historique.md)).
- **L'historique est inaltérable** : des triggers refusent `UPDATE`, `DELETE` et `TRUNCATE` ([010](decisions/010-historique.md), [008](decisions/008-service-en-ligne.md)).
- **Seule exception à l'historique** : la suppression de compte appelle `erase_account_history` pour effacer les entrées de la personne ([078](decisions/078-ses-donnees.md)).
- **La base fait respecter ce qu'elle peut** : `CHECK` sur les statuts, index uniques conditionnels (un run actif par US, un propriétaire par projet) ([002](decisions/002-modele-donnees.md), [076](decisions/076-plusieurs-utilisateurs.md)).
- **On ne stocke pas ce qui se calcule** : étape d'un ticket, Kanban, verdict d'un run, bilan de santé ([002](decisions/002-modele-donnees.md)).
- **Les migrations ne se modifient jamais une fois appliquées** : on en ajoute une, générée par drizzle-kit et appliquée au démarrage ([008](decisions/008-service-en-ligne.md)).
- **GitHub reste la source de vérité** du code, des PR et de la CI ; Cockpit n'en garde qu'un cache tenu par les webhooks ([002](decisions/002-modele-donnees.md), [024](decisions/024-webhooks.md)).
- **Cockpit n'appelle jamais Claude** : les sessions Claude Code viennent à lui par le MCP ([004](decisions/004-outils-mcp.md), [008](decisions/008-service-en-ligne.md)).

## Secrets et erreurs

- **Aucun secret en clair** : jetons gardés par empreinte et montrés une seule fois ([004](decisions/004-outils-mcp.md), [015](decisions/015-jetons-mcp.md)).
- **Les secrets de la GitHub App sont chiffrés en base**, avec une clé hors de la base et de ses sauvegardes ([012](decisions/012-configuration-automatique.md)).
- **Aucune donnée personnelle en clair dans l'historique** ([004](decisions/004-outils-mcp.md), [008](decisions/008-service-en-ligne.md)).
- **Aucun jeton GitHub d'utilisateur n'est gardé** : la session est un cookie dont seule l'empreinte est en base ([009](decisions/009-connexion-github.md)).
- **Les erreurs se voient** : à l'écran avec « Réessayer » ; le serveur refuse de partir sans `DATABASE_URL` ([008](decisions/008-service-en-ligne.md), [012](decisions/012-configuration-automatique.md)).
- **La télémétrie est facultative** : rien ne part sans `POSTHOG_KEY` ([083](decisions/083-telemetrie-posthog.md)).

## Interface

- **Le texte de l'interface est en français**, un seul nom par notion ([093](decisions/093-un-seul-nom-par-notion.md)).
- **Couleurs et polices viennent des jetons** de `styles.css`, jamais en dur ; chaque jeton a une valeur sombre et une claire ([003](decisions/003-interface.md), [028](decisions/028-creme-sombre-onglets-journal.md), [073](decisions/073-ergonomie.md)).
- **Les composants sont Tailwind + shadcn/ui** ([003](decisions/003-interface.md)).
- **Le texte de chargement porte la classe `loading`, et le mouvement les jetons de durée et de courbe** ([080](decisions/080-polish-mouvement-et-retours.md)).
- **Aucun `transform` sur `main` ni sur un ancêtre du panneau droit fixe** : il en déplacerait l'ancrage ([080](decisions/080-polish-mouvement-et-retours.md)).
- **Un bouton désactivé pendant sa requête porte aussi `aria-busy`, et une action dont l'écran ne dit pas le succès l'annonce** une fois réussie ([081](decisions/081-retours-d-action.md)).

## Tests et déploiement

- **Les tests n'appellent jamais Claude, le vrai GitHub ni PostHog** : routes avec `app.request()` sur PGlite, écrans avec un `fetch` simulé ([001](decisions/001-stack.md), [008](decisions/008-service-en-ligne.md), [083](decisions/083-telemetrie-posthog.md)).
- **Node exécute le TypeScript directement** : syntaxe effaçable seulement (ni `enum`, ni `namespace`, ni propriété de paramètre de constructeur), imports relatifs terminés par `.ts` / `.tsx` ([001](decisions/001-stack.md)).
- **Le code ne contient rien de propre au Pi** : tout passe par `DATABASE_URL`, `PORT` et `COCKPIT_KEY_FILE` ([008](decisions/008-service-en-ligne.md)).
- **Une seule instance d'abord** : ce qui doit survivre à un redémarrage va en base ; les caches en mémoire sont listés dans la montée en charge ([008](decisions/008-service-en-ligne.md), [052](decisions/052-constats-de-github-et-versions.md)).
- **Le catalogue versionné s'accompagne de `catalog/history.json`**, régénéré à chaque changement de `catalog/` ([049](decisions/049-mise-a-jour-du-catalogue.md)).
