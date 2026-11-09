# 070 — Le matin de la nuit

- **Statut** : proposée (à valider à la relecture de la PR) ; le code est construit (tranche 14.7)
- **Date** : 2026-11-09
- **Décidé par** : Dorian, avec Claude ([064](064-tranches-restantes.md) 14.7)
- **Dépend de** : [035 — Critères et PR](035-criteres-et-pr.md) (`result`, `resultRunId`), [044 — La nuit de Claude](044-la-nuit-de-claude.md) (J, M', N'), [045 — L'interface « Quatre temps » et les écrans de référence](045-interface-quatre-temps.md) (l'accueil), [054 — Lancer dans le cloud](054-lancer-dans-le-cloud.md) (`cloud_launches.night_item_id`)
- **Modifie** : 044 J et N' (« tests ajoutés » devient « critères prouvés ») ; 064 14.7 (la frise à l'échelle des heures est sur N2 seulement, pas sur N1)
- **Tranche** : 14.7 du [découpage](../decoupage.md)
- **Écrans** : [N2](../ecrans/N2_Nuit_Matin.png), [N1](../ecrans/N1_Nuit_Soir.png)

## Contexte

La tranche 14.6 a construit la nuit et un bloc « Cette nuit » minimal sur l'accueil : la phrase « Claude a livré N PR sur M », le nombre de questions, puis une liste des US dans l'ordre avec leur issue et « fini à ». La 044 N' a repoussé à cette tranche le bilan (temps de travail, tests ajoutés, échecs), « Relire en série » et la frise à l'échelle des heures. Tout ce qu'il faut est déjà en base : les heures de la nuit (`nights.starts_at`, `ends_at`), les runs lancés pour elle (`cloud_launches.night_item_id`, y compris la relance de CI de la 044 F'), l'issue de chaque US (`night_items.outcome`) et les critères prouvés par Claude (`acceptance_criteria.result`, `result_run_id`). Rien ne demande d'appeler GitHub.

## Les choix

| # | Question | Décision |
|---|---|---|
| A | Où se calcule le bilan ? | Côté serveur, dans `morningOf` (la charge `night` de `GET /api/home`), trois nombres à côté de `delivered` et `total` : `workSeconds`, `criteriaProven`, `failures`. Pas de nouvelle route, pas de nouvelle colonne |
| B | Le temps de travail | La somme de `finished_at − started_at` des runs **lancés pour la nuit** (`cloud_launches.night_item_id` des items de la nuit, puis `cloud_launches.run_id`), relance de CI comprise. Un run pas encore fini (une relance de CI qui tourne après la fin de la nuit) ne compte pas |
| C | Les « tests ajoutés » | **Modifie la 044 J** : Cockpit ne connaît pas le nombre de tests ajoutés sans lire le diff de chaque PR sur GitHub. Le bilan montre à la place les **critères prouvés** : les critères `passed` dont `result_run_id` est un run lancé pour la nuit. Chaque critère est un test d'acceptation écrit par le test-writer de `/dev-us`, avec sa preuve (035) : c'est le chiffre honnête le plus proche |
| D | Les échecs | Les items de la nuit dont l'issue est `failed`, `ci_failed` ou `not_started`. Une US `skipped` (plus prête) ou `paused` (une question) n'est pas un échec |
| E | L'affichage du bilan | Une ligne en tête du bloc, au-dessus de la frise : « La nuit · 2 h 10 de travail · 21 critères prouvés · aucun échec » (« 1 critère prouvé », « 1 échec », « 2 échecs »). La durée s'écrit avec le `duration` de `/nuit` (exporté de `Night.tsx`) |
| F | La frise (N2) | Un axe de l'heure de début à l'heure de fin de la nuit, prolongé jusqu'à la fin du dernier run s'il a fini après (un run parti va jusqu'au bout, 044 D). Une graduation par heure pleine (« 22 h », « 23 h », « 0 h »…). **Une ligne par US**, dans l'ordre de la nuit, la liste `<ol>` d'aujourd'hui gardée : sur sa ligne, une case placée en CSS (`left` et `width` en %, sans bibliothèque) du début à la fin de son run (`night_items.run_id`, le dernier run fini), avec « ✓ US 45 » pour une PR, « ✦ US 46 » aux couleurs « toi » pour une US en pause, « ✕ US 8 » pour un échec. Une US sans run (sautée, non lancée) n'a pas de case : sa ligne dit son issue. Chaque ligne garde en texte lisible par un lecteur d'écran l'US, son issue et ses heures (« 22 h 02 → 23 h 14 »). « fini à 4 h 10 » une seule fois, après la case du run fini le plus tard. Une seule US : une seule case sur le même axe |
| G | La frise du soir (N1) et de la nuit en cours (S34) | **Modifie la 064 14.7** : pas de frise à l'échelle des heures sur `/nuit`. N1 et S34 dessinent une liste, et le soir n'a que des estimations (et « durée inconnue » sans run réussi) : placer des cases sur des heures devinées prétendrait une précision que Cockpit n'a pas ; le total et l'heure de fin probable sont déjà en haut. Une nuit en cours n'a pas de bloc du matin (044 J) |
| H | « Relire en série » | Dans l'en-tête du groupe « À relire » de « 2 · Ensuite », dès qu'au moins **2 PR** sont à relire sur l'accueil (toutes, pas seulement celles de la nuit : la série sert aussi un autre matin). Un bouton : il ouvre dans un nouvel onglet (`window.open(url, "_blank", "noopener")`) la première PR à relire pas encore ouverte dans la série, dans l'ordre de l'accueil, puis se lit « PR suivante · #53 ». Après la dernière, la série recommence et le bouton se relit « Relire en série » (le bouton reste en place, le focus clavier aussi). La série est retenue par la page, par US : une PR fusionnée qui disparaît de la liste ne la décale pas. Rien n'est écrit au serveur ni dans l'historique |
| I | Le raccourci « R » | Comme « N » (Shell) : la touche R, sans Ctrl, Cmd ni Alt, hors d'un champ de saisie, fait le même geste que le bouton quand il est affiché. `<kbd>R</kbd>` dans le bouton et `aria-keyshortcuts="R"` |

## Ce que le code a précisé (tranche 14.7)

- **Les couleurs des cases** (045 C) : une PR et un échec sont en gris (`raised`, `border-strong`), une US en pause aux couleurs « toi » comme `.seg.q` de N2. Le signe (✓, ✕, ✦) double la couleur.
- **Une nuit sans run** affiche « 0 min de travail ».
- **« Relire en série »** repart de la PR qui vient d'être ouverte quand la dernière de la série a quitté la liste ; une touche R maintenue n'ouvre qu'une PR.
- **« fini à »** est dans le texte de la ligne (celle du dernier run), pas sur l'axe.
- **« US n »** est lu par les lecteurs d'écran devant le titre ; la case dessinée est cachée (`aria-hidden`).
- **Écarts à la 064, gardés** : C (« critères prouvés » au lieu de « tests ajoutés ») et G (pas de frise à l'échelle des heures sur le soir, N1), *à confirmer à la relecture*.

## Limites connues

- **Pas de nombre de tests** (C) : un critère peut couvrir plusieurs tests, et un test hors critères n'est pas compté.
- **Les critères prouvés sont le dernier signalement** (035 A) : si l'US est relancée de jour et que Claude signale à nouveau, le critère passe au run du jour et sort du bilan de la nuit.
- **Le temps de travail est le temps de la session** : clonage et attentes compris, du `start_run` au `finish_run` ; le temps entre la fin d'un run et le lancement du suivant n'y est pas.
- **La série ouvre des onglets** : un navigateur qui bloque les fenêtres ne bloque pas un `window.open` déclenché par un clic ou une touche, mais un réglage strict peut le faire. Elle s'oublie au rechargement de la page.
- **Une case très courte** (un run de quelques minutes) déborde de sa place : sa largeur minimale est celle de son libellé.
- **Pas construits, de N2** : « Ce matin · 8 h 12 », « Compte 20 minutes pour tout traiter », le coût de la nuit (S34 le montre pendant la nuit, 060). Restent hors de la nuit (044 N') : le choix « Cette nuit » dans « Développer avec Claude » (S24) et la section « la nuit » des réglages du projet (S19) ; la nuit se compose seulement sur `/nuit`.
