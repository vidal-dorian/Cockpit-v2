# 082 — La mesure d'audience : PostHog, par instance

- **Statut** : proposée (à valider à la relecture de la PR)
- **Date** : 2026-11-10
- **Décidé par** : Dorian (« ajouter PostHog à l'app »), avec Claude
- **Dépend de** : [078 — Ses données](078-ses-donnees.md) (A, la page Données dit ce qui sort de Cockpit)
- **Écrans** : Réglages › Données (S50), une ligne de plus

## Contexte

Cockpit ne sait pas quels écrans servent. PostHog mesure les pages vues et les clics d'une page web. Cockpit est auto-hébergé et partagé entre plusieurs personnes : ce qui part chez un tiers doit être choisi par l'administrateur de l'instance et dit à chacun.

## Les choix

| # | Question | Décision |
|---|---|---|
| A | À qui vont les événements | Au projet PostHog **de l'instance** : l'administrateur pose `POSTHOG_KEY` (la clé publique du projet, `phc_…`) et, s'il le veut, `POSTHOG_HOST` (par défaut `https://eu.i.posthog.com`, les données restent en Europe ; un PostHog auto-hébergé convient aussi). **Sans `POSTHOG_KEY`, rien n'est chargé ni envoyé.** Aucune clé n'est intégrée à l'image : une instance n'envoie jamais rien au développeur de Cockpit |
| B | Ce qui est mesuré | Les **pages vues** (à chaque changement de chemin) et les **clics** (autocapture), **sans texte ni attribut** des éléments (`mask_all_text`, `mask_all_element_attributes`) et **sans paramètres d'adresse** (`?q=`, `?path=`… retirés des URL envoyées). Ni enregistrement de session, ni sondage, ni événement serveur |
| C | Qui est mesuré | Seulement une personne **connectée**, identifiée par son **identifiant interne** Cockpit (jamais son login, son nom ni son adresse). À la déconnexion, PostHog est remis à zéro |
| D | Le consentement | **Sans cookie ni stockage** sur l'appareil (`persistence: "memory"`) : pas de bandeau à demander. Contrepartie : chaque chargement de la page recommence une visite |
| E | Ce que dit Données | Quand la mesure est active, la carte de Réglages › Données (078 A) a une ligne **« Mesure d'audience »** : « pages vues et clics, sans texte ni cookie · envoyés au PostHog de l'instance (`<hôte>`) ». Sans clé, la ligne n'apparaît pas |

## Critères d'acceptation

1. **Étant donné** une instance sans `POSTHOG_KEY`, **quand** une personne connectée lit `GET /api/me`, **alors** `analytics` vaut `null`, et la page ne charge pas `posthog-js`.
2. **Étant donné** une instance avec `POSTHOG_KEY=phc_test` et sans `POSTHOG_HOST`, **quand** une personne connectée lit `GET /api/me`, **alors** `analytics` vaut `{ key: "phc_test", host: "https://eu.i.posthog.com", distinctId: "<son id interne>" }`.
3. **Étant donné** `POSTHOG_HOST=https://posthog.example.org`, **alors** `analytics.host` vaut cette adresse.
4. **Étant donné** une réponse `GET /api/me` avec `analytics`, **quand** la page s'ouvre, **alors** PostHog est initialisé avec cette clé et cet hôte, `persistence: "memory"`, `capture_pageview: "history_change"`, `mask_all_text: true`, `mask_all_element_attributes: true`, `disable_session_recording: true`, `disable_surveys: true`, `person_profiles: "identified_only"`, puis `identify(distinctId)` est appelé.
5. **Étant donné** un événement dont `$current_url` vaut `https://cockpit.example/projets/3/code?path=src/a.ts`, **quand** PostHog l'envoie, **alors** `$current_url` vaut `https://cockpit.example/projets/3/code` (même chose pour `$referrer` et `$initial_current_url`).
6. **Étant donné** une personne mesurée, **quand** elle se déconnecte, **alors** `posthog.reset()` est appelé.
7. **Étant donné** une instance avec `analytics`, **quand** on ouvre Réglages › Données, **alors** la ligne « Mesure d'audience » dit « pages vues et clics, sans texte ni cookie · envoyés au PostHog de l'instance (eu.i.posthog.com) » ; sans `analytics`, elle n'apparaît pas.

## Ce que le code a précisé

- **Le serveur** (`src/server/analytics.ts`, `analyticsFromEnv`) : une `POSTHOG_KEY` vide ou absente éteint la mesure ; un `POSTHOG_HOST` vide vaut `https://eu.i.posthog.com` ; un hôte qui n'est pas une URL `http(s)` arrête le serveur au démarrage (la page en lit `new URL(host).host`). `index.ts` le passe à `createApp` (option `analytics`), `GET /api/me` rend `analytics` : `{ key, host, distinctId }` avec l'identifiant interne en texte, ou `null`.
- **`compose.yaml`** passe `POSTHOG_KEY` et `POSTHOG_HOST` au service `app`, vides par défaut.
- **La page** (`src/web/analytics.ts`) : `posthog-js` est importé dynamiquement, dans son propre morceau, seulement quand `analytics` est présent. `bootstrap` donne l'identifiant dès le premier événement (pas d'identifiant anonyme fusionné à chaque chargement), puis `identify`. Ce que le projet PostHog pourrait activer à distance est coupé : `disable_external_dependency_loading`, `advanced_disable_flags`, `capture_exceptions`, `capture_heatmaps`, `capture_dead_clicks`, `capture_performance`, `disable_web_experiments`, `disable_product_tours`, `disable_conversations` ; `capture_pageleave: false` retire l'événement de sortie de page.
- **Les adresses** : `stripQuery` retire la requête et le fragment de toute clé qui finit par `url` ou `referrer` dans `properties`, `$set` et `$set_once`. `before_send` jette tout événement une fois la mesure arrêtée (PostHog continuerait sinon sous un identifiant anonyme après `reset()`).
- **L'arrêt** : le nettoyage de l'effet de `Routed` (`App.tsx`) appelle `stopAnalytics` (`reset()`) : déconnexion, suppression du compte, ou session expirée. Un démarrage dont l'import finit après un arrêt ne fait rien.
- **Données** (`Data.tsx`) lit `["me"]` pour la ligne « Mesure d'audience ».

## Limites connues

- **La suppression d'un compte** (078 C) n'efface pas ses événements chez PostHog : l'administrateur les efface depuis PostHog (la personne y est un simple identifiant).
- **Un bloqueur de publicités** coupe souvent PostHog : la mesure sous-estime l'usage.
- **Sans stockage**, une même personne sur deux onglets compte comme deux visites ; elle reste reconnue par son identifiant.
- **Les segments du chemin partent tels quels** : par exemple `/invitations/:secret` pour une personne connectée ; risque faible, le secret n'ouvre que pour le compte invité.
- **Une session expirée n'est vue qu'à la prochaine lecture de `["me"]`** : la mesure continue jusque-là.
- **Une future version de `posthog-js` pourrait ajouter des propriétés d'adresse qui ne se nomment pas `…url` ou `…referrer`** et que `stripQuery` ne verrait pas : d'où la version exacte dans `package.json` (1.447.7), à relire à chaque mise à jour.
