# 073 — L'ergonomie : recherche, raccourcis, thème clair, favoris

- **Statut** : proposée (à valider à la relecture de la PR ; la palette claire attend l'accord de Dorian) ; le code est construit (tranche 15.3)
- **Date** : 2026-11-09
- **Décidé par** : Dorian, avec Claude ([064](064-tranches-restantes.md) 15.3 A, B et C)
- **Dépend de** : [003 — Interface](003-interface.md), [045 — L'interface « Quatre temps » et les écrans de référence](045-interface-quatre-temps.md) (C, les jetons et le budget de couleur), [016 — Serveur MCP](016-serveur-mcp.md) (l'outil MCP `search`), [072 — PWA et notifications](072-pwa-et-notifications.md) (l'onglet Préférences)
- **Modifie** : 064 15.3 B (`Ctrl Entrée` ouvre dans un nouvel onglet, pas « à droite »)
- **Tranche** : 15.3 du [découpage](../decoupage.md)
- **Écrans** : [S08](../ecrans/S08_Recherche.png), [S10](../ecrans/S10_TousLesProjets.png) (l'étoile et le filtre « Favoris »), [S47](../ecrans/S47_Reglages_Preferences.png) (les cartes « Thème » et « Raccourcis clavier »)

## Contexte

La 064 a tranché le contenu de la 15.3 : un thème clair proposé par Claude et validé par Dorian, la recherche `Ctrl K` de S08 avec ses actions, les raccourcis de S47 (`Ctrl K`, `N`, `J` / `K`, `V`, `?`) et les favoris de S10. Aujourd'hui, seul `N` existe (la barre d'idée), plus `R` sur l'accueil (070). L'outil MCP `search` cherche déjà par mots dans les noms de projets, les titres de tickets et le récit des US ; aucune route ne l'offre à la page. Les couleurs sont toutes des jetons de `styles.css` (045 C), sans thème clair.

## Les choix

| # | Question | Décision |
|---|---|---|
| A | La recherche côté serveur | `GET /api/search?q=` (2 à 200 caractères) reprend la recherche de l'outil MCP `search` : **la même fonction**, sortie de `mcp.ts`, appelée par les deux. Chaque mot doit apparaître, sans tenir compte de la casse : projets (nom), tickets (titre), US (récit). En plus pour la page : **les runs**, par leur numéro (« 17 » ou « run 17 ») ou par le récit de leur US. Au plus 20 résultats par groupe, projets archivés exclus, seulement les projets dont on est membre |
| B | La fenêtre (S08) | `Ctrl K` (ou `Cmd K`) partout, et le champ « Chercher » en haut de la barre latérale, ouvrent une fenêtre modale : le champ, les filtres Tout, User stories, Tickets, Runs, Projets, Actions, puis les résultats par groupe, avec le mot trouvé souligné. `↑` `↓` choisissent, `Entrée` ouvre, `Échap` ferme et rend le focus. La recherche part 200 ms après la dernière frappe. Sous `md`, la fenêtre prend tout l'écran (071) |
| C | Les actions | Une liste côté page, filtrée par les mêmes mots : « Noter une idée » (`N`), et aller à Accueil, Claude, Cette nuit, Tous les projets, Équipes d'agents, Journal, Réglages, Préférences. Sans mot tapé, la fenêtre montre les actions |
| D | `Ctrl Entrée` | **Modifie la 064 15.3 B** : il ouvre le résultat dans un nouvel onglet. « Ouvrir à droite » demanderait un panneau de droite pour chaque type de résultat sur chaque page ; le panneau de droite n'existe que sur certaines pages, chacune avec son contenu |
| E | Les raccourcis (S47) | `J` / `K` : élément suivant, précédent, partout où le panneau de droite a un compteur (`Panel` avec `counter` : l'accueil, la fenêtre « Développer avec Claude », les constats…). `V` : « Valider » de l'US affichée (page d'une US, carte du Kanban dans le panneau), seulement quand ce bouton est là. `?` : une fenêtre qui liste les raccourcis. Comme `N` et `R` : jamais avec Ctrl, Cmd ou Alt, jamais dans un champ de saisie ; `aria-keyshortcuts` sur le bouton concerné |
| F | Le thème (064 15.3 A) | Trois choix dans Préférences (S47) : **Sombre** (par défaut), **Clair**, **Comme le système**. Gardé en base (`users.theme`), donc le même sur tous les appareils, et recopié dans `localStorage` pour l'appliquer avant le premier rendu (pas d'éclair sombre). Appliqué par `data-theme` sur `<html>` |
| G | La palette claire | **Claude la propose, Dorian la valide à la relecture** : les mêmes noms de jetons que le sombre, redéfinis pour `[data-theme="light"]` (et pour « système » sous `prefers-color-scheme: light`), le même budget de couleur (045 C). Chaque paire texte / fond des jetons atteint le contraste **AA** (4,5:1 pour le texte, 3:1 pour les bordures fortes et les grands titres), vérifié par un test. La PR montre l'accueil, un projet et une US en clair |
| H | Les favoris (S10) | Une étoile par projet, **par utilisateur** (`project_members.favorite`), sur chaque ligne de Tous les projets (bouton `aria-pressed`, « Ajouter aux favoris » / « Retirer des favoris »). Le filtre « Favoris · 3 » de S10. La barre latérale : la section devient « Projets favoris » quand il y en a, avec les favoris d'abord, puis les projets actifs qui ne le sont pas (comme aujourd'hui) |
| I | Les cartes de S47 | L'onglet Préférences (072) reçoit la carte « Thème » (trois boutons, `aria-pressed`) et la carte « Raccourcis clavier » (la liste de E, en lecture seule). Le sous-titre de S47 reste de côté (072) |

## Ce que le code a précisé (tranche 15.3)

- **Les routes** (toutes avec session) : `GET /api/search?q=` (400 hors de 2 à 200 caractères) rend `{ projects, tickets, stories, runs }` ; `PUT /api/projects/:id/favorite` (`{ favorite }`, 404 si on n'est pas membre) ; `PUT /api/me/theme` (`dark`, `light` ou `system`). `GET /api/me` rend en plus `theme` ; `GET /api/projects` et `GET /api/home` rendent `favorite` par projet. Aucune des deux écritures n'entre dans l'historique (préférences, comme les interrupteurs de notification).
- **Migration `0044`** : `project_members.favorite` et `users.theme` (`'dark'` par défaut).
- **`searchWork`** (`search.ts`) est la fonction de l'outil MCP `search` (016, comportement inchangé) et de la route : le MCP ne l'appelle que pour ses trois groupes.
- **Les runs** sont trouvés par leur numéro (`^(run )?N$`, 9 chiffres au plus) ou par le récit de leur US. Comme la requête fait 2 caractères au moins, un run à un chiffre se cherche « run 7 ».
- **`Modal`** (`Modal.tsx`) est un `<dialog>` natif ouvert par `showModal()` : le navigateur garde le focus dans la fenêtre et rend la page inerte ; `Échap` ferme et le focus revient à l'élément qui l'avait. La recherche et la fenêtre de `?` l'utilisent.
- **Les raccourcis à une touche** (`useShortcut`) restent muets dans un champ et tant qu'un `<dialog>` est ouvert. `V` n'agit que si « Valider » est affiché et actif. `Ctrl K` marche aussi dans un champ, mais pas avec `Maj` ni `Alt`.
- **« Noter une idée »** n'est dans la recherche que sur une page qui a un projet (le panneau d'idée n'existe pas sans).
- **Le thème avant le premier rendu** : un script en ligne de `index.html` applique `cockpit-theme` (`localStorage`) à `<html>` ; `theme.ts` l'écrit au changement et à la lecture de `/api/me`. La balise `theme-color` prend alors la valeur du jeton `--color-background`.
- **La palette claire** est dans `styles.css`, sous `:root[data-theme="light"]`. La copie « système » (`@media (prefers-color-scheme: light)`) est la même, et `ThemeSystem.test.ts` les garde égales. Les couleurs de code (jetons `--shiki-token-*`) sont redéfinies. `Contrast.test.ts` vérifie l'AA : textes sur fonds, `border-strong` à 3:1 sur le fond et la carte, `dim` et `destructive` à 4,5:1.
- **Pour la validation de Dorian** : `docs/ecrans/captures/073-clair-accueil.png`, `-projet.png`, `-us.png`, `-projets.png`, `-recherche.png` et `-preferences.png`.
- **Sans favori**, le filtre « Favoris » affiche « Aucun favori : l'étoile d'une ligne en ajoute un. ».

## Limites connues

- **La recherche est un `ILIKE` par mot** (comme l'outil MCP) : pas de fautes de frappe, pas de synonymes, pas de classement par pertinence.
- **`J` / `K` et `V` n'agissent que là où la page a déjà le geste** (un compteur, un bouton « Valider ») ; ailleurs, rien.
- **La palette claire n'est validée qu'à la relecture** : si Dorian la refuse, le choix Clair reste construit et seules les valeurs changent.
- **Pas construits** : le tri de Tous les projets et ses autres filtres (retirés, 069 I) ; « Ouvrir à droite » (D).
- **Deux `Panel` avec un compteur** montrés ensemble répondraient tous deux à `J` / `K` (`shortcut:` de `Shell.tsx`).
- **« Comme le système » laisse `theme-color` en retard** si le système change de thème pendant que la page est ouverte : la couleur n'est relue qu'à `applyTheme` (le reste de la page suit tout de suite, par la requête CSS).
- **La recherche fait un `ILIKE` par mot** : rien d'indexé, elle ralentira sur de gros volumes.
- **Les fenêtres natives** (`<dialog>` : focus, page inerte, raccourcis muets derrière, point B1 de la relecture) n'ont été vérifiées que dans Chromium ; les tests, eux, simulent le navigateur.
