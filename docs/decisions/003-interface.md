# 003 — Interface

- **Statut** : validée (écrans de la boucle) ; points ouverts en fin de document
- **Date** : 2026-10-20
- **Décidé par** : Dorian, avec Claude
- **Dépend de** : [001 — Stack technique](001-stack.md), [002 — Modèle de données](002-modele-donnees.md)
- **Modifiée par 028** : le style visuel est celui des maquettes « Crème sombre » ; l'UX et les règles d'ergonomie ne changent pas — voir la [028](028-creme-sombre-onglets-journal.md)
- **Modifiée par 045** : le style « Quatre temps », la barre latérale rouverte (piste écartée plus bas) et les écrans de référence de `docs/ecrans/` — voir la [045](045-interface-quatre-temps.md)
- **Modifiée par 055** : la capture rapide n'enregistre plus au premier Entrée, elle agrandit la barre « Noter une idée » en un panneau (titre, description, projet, priorité, étiquettes), qui est la seule façon de créer un ticket — voir la [055](055-tickets-complets.md)
- **Maquettes** : canevas « Cockpit — Maquettes », rangée **« Version retenue — UX + UI »** (https://claude.ai/artifact/XAteTYa7tQBcCGq8HpRF7C)

## Contexte

Le brief (§6.13) demande une interface qui se comprend sans la connaître et qui dit à chaque instant « qu'est-ce qui m'attend ? ». Plusieurs directions ont été essayées (fil de fer, pistes « originales », styles éditorial, liste, sombre, bande dessinée). La version retenue est née d'une méthode : **concevoir d'abord l'UX à partir des tâches clés, puis ajouter l'UI par-dessus, sans jamais retirer d'UX pour de l'UI**.

## Le principe directeur : qui doit agir ?

Chaque élément attend soit **toi**, soit **Claude**, et l'interface le montre partout :

- **corail** = à toi ; **violet** = Claude ; **vert** = terminé ou validé ;
- l'accueil commence par ce qui t'attend, classé par verbe ;
- la couleur n'est jamais seule : elle accompagne toujours un mot ou une icône.

## Les tâches clés et comment elles sont optimisées

| Tâche | Fréquence | Ce que fait l'interface |
|---|---|---|
| **Répondre à une question de Claude** | Rare mais bloquante | En tête de l'accueil, **réponse sur place** sans changer de page ; réponses rapides proposées (touches 1, 2) ; contexte (US, projet, étape) sur une ligne |
| **Valider des user stories** | Fréquente, par lots | **Panneau latéral** au-dessus de l'accueil ; « Valider » **passe à la suivante** ; bouton bloqué tant qu'un critère n'est pas coché, **avec la raison écrite** ; « Tout cocher » ; « Modifier » sur le récit et chaque critère ; **« Annuler » pendant 8 s** au lieu d'une confirmation |
| **Relire une pull request** | Fréquente | Listée dans l'accueil avec l'état de la CI en clair (« La CI échoue ») ; lien direct vers GitHub |
| **Lancer le développement** | Fréquente | Fenêtre **entièrement préremplie** (où, branche, dossier) ; options avancées repliées mais **résumées sur une ligne** ; dépendance non terminée signalée sans bloquer ; on dit ce qui va se passer ensuite ; un clic : « Lancer Claude » |
| **Décider en fin de run** | À chaque run | Le **verdict d'abord**, chaque critère avec sa preuve, puis **une seule action principale** : relire et merger sur GitHub ; journal détaillé replié |
| **Noter une idée** | À tout moment | Touche **N** depuis n'importe quel écran ; projet ouvert prérempli ; **un titre et Entrée suffisent** |
| **Savoir ce que fait Claude** | Coup d'œil | Colonne « Claude travaille » : chaque run avec ses étapes nommées (Tests, Code, Relecture) et son état en clair |

## Règles d'ergonomie

Elles s'appliquent à tous les écrans, y compris ceux qui restent à dessiner.

1. **Agir sur place.** Une action courante ne doit pas obliger à changer de page : réponse dans l'accueil, validation dans un panneau, lancement dans une fenêtre.
2. **Une action principale par zone.** Un seul bouton corail par écran ou par panneau ; le reste est secondaire.
3. **Des valeurs par défaut partout où c'est possible.** L'utilisateur confirme plus qu'il ne remplit.
4. **Annuler plutôt que confirmer.** Une action réversible s'exécute tout de suite et propose « Annuler » quelques secondes. Seules les actions irréversibles (abandonner une US, supprimer une branche) demandent une confirmation qui nomme ce qui sera perdu.
5. **Un bouton bloqué dit pourquoi.** La raison est écrite juste à côté, jamais un bouton grisé muet.
6. **Dire ce qui va se passer** avant une action qui sort de Cockpit (ouverture de Claude Desktop, publication sur GitHub).
7. **Le clavier double la souris, il ne la remplace pas.** Raccourcis homogènes, affichés discrètement à côté de l'action :

   | Touche | Action |
   |---|---|
   | `N` | Nouveau ticket, depuis partout |
   | `/` | Rechercher |
   | `J` / `K`, `Entrée` | Passer d'un élément à l'autre, ouvrir |
   | `1`, `2` | Réponses rapides à une question |
   | `V`, `R` | Valider, demander une réécriture (panneau de validation) |
   | `Échap` | Fermer un panneau ou une fenêtre |
   | `Ctrl` + `Entrée` | Lancer ou envoyer depuis une fenêtre |

8. **Les erreurs se voient** (principe n° 7 du brief) : message à côté de ce qui a échoué, qui dit comment corriger, et « Réessayer ».
9. **Le détail se replie.** Journal, options avancées, historique : présents mais repliés, résumés en une ligne.
10. **Accessibilité de base** : vrais boutons, liens et libellés ; focus clavier visible ; cibles d'au moins 40 px ; contraste du texte d'au moins 4,5:1 ; chaque icône seule porte un libellé.

## Navigation

```
┌───────────────────────────────────────────────────────────────────────────┐
│ ●● Cockpit   [Accueil 5]  Projets  Journal     [Rechercher  /] [+ Nouveau ticket N] ⚙ (D) │
└───────────────────────────────────────────────────────────────────────────┘
```

| Écran | Adresse | Statut |
|---|---|---|
| Accueil | `/` | Maquetté |
| Panneau de validation | au-dessus de l'écran courant (`?valider=43`) | Maquetté |
| Fenêtre « Développer avec Claude » | au-dessus de la page de l'US | Maquetté |
| Run (fin de run) | `/runs/:id` | Maquetté (état « terminé ») |
| Capture d'une idée | fenêtre, depuis partout | Maquetté |
| Projets, projet (Kanban, tickets, santé, historique) | `/projets`, `/projets/:id` | À maquetter |
| Ticket, user story (page complète) | `/tickets/:id`, `/us/:id` | À maquetter |
| Run en cours | `/runs/:id` | À maquetter (la question est déjà traitée dans l'accueil) |
| Journal, réglages (jetons MCP), connexion | `/journal`, `/reglages`, `/connexion` | À maquetter |

Le compteur de l'onglet Accueil est le nombre d'éléments qui t'attendent.

## Style visuel

| Élément | Choix |
|---|---|
| Titres | **Bricolage Grotesque** (600 à 800) |
| Texte | **Figtree** (400 à 700), 15 px de base |
| Fond | `#F4F3F8` ; surfaces blanches, bord `#E9E6F2` |
| Encre | `#1E1B2E` ; texte secondaire `#5F5A73` |
| À toi | corail `#FF6A3D` (bouton principal, texte sombre dessus) ; fond doux `#FFE9E0` ; texte `#C2410C` / `#9A2F0E` |
| Claude | violet `#7C6CF0` ; fond doux `#ECE8FF` ; texte `#4A3AB0` |
| Terminé, validé | vert `#2FB57B` ; fond doux `#DDF5EA` ; texte `#16603F` |
| Erreur | rouge `#B4232A` sur `#FDE4E4`, toujours avec un mot |
| Formes | rayons 10 à 22 px ; ombres douces sur deux niveaux ; voile flouté derrière panneaux et fenêtres |
| Icônes | trait de 2 px, bouts arrondis, toujours accompagnées d'un mot |
| Repères | avatar de Claude (étincelle violette) ; touches de clavier dessinées ; carré de couleur par projet |
| Retours | bandeau sombre avec icône ; pour « Annuler », une barre qui montre le temps restant |

Le thème sombre (brief §6.20) se fera plus tard en redéfinissant ces mêmes valeurs.

## Conséquences

- **Publication des issues GitHub** (tranche 4.6) : avec « Annuler » pendant 8 s, l'issue est créée **après** ce délai, pas au clic.
- **Validation** : cocher chaque critère devient une étape de la validation. C'est un état d'interface, pas une donnée : il n'est pas enregistré dans le modèle (002).
- **Réponses rapides** : elles supposent que Claude propose des réponses avec sa question. L'outil MCP `ask_user` (décision 004) prendra donc une liste facultative de réponses suggérées.
- **Raccourcis clavier** : ils entrent dans le MVP pour les écrans maquettés, alors que le brief les plaçait en finitions (§6.20).

## Points ouverts

1. ~~**Composants et CSS**~~ : **décidé le 2026-10-21 : Tailwind (v4) + shadcn/ui.** Les composants accessibles (panneau latéral, fenêtre, menus, bandeau) sont copiés dans le repo et bâtis sur Radix ; les valeurs de ce document sont des variables Tailwind dans `src/web/styles.css`, nommées selon les conventions de shadcn/ui. shadcn/ui est initialisé avec le premier composant qui en a besoin. Écartés : CSS écrit à la main (toute l'accessibilité à refaire), CSS Modules + Radix (plus lent à construire, pour le même résultat).
2. ~~**État des projets sur l'accueil.** Le brief (§6.13) prévoit une liste des projets avec leur état et une pastille par projet ; la version retenue ne les montre plus sur l'accueil. À décider en maquettant l'écran Projets : les remettre (sous la colonne Claude, par exemple) ou les laisser à l'écran Projets.~~ Tranché par la [040](040-accueil.md) D : l'accueil a une section « Projets », chaque projet actif avec sa pastille (« À toi », « Claude travaille » ou « Rien en cours »).
3. ~~**Écrans restants** : projet et Kanban, page complète d'une US, ticket, run en cours, journal, réglages, connexion. Ils suivront les règles et le style ci-dessus.~~ Faits, chacun avec sa tranche (2.1 à 8.1), dans le style de la [028](028-creme-sombre-onglets-journal.md).
4. **Téléphone** : les trois gestes (noter une idée, valider une US, répondre à une question) restent à maquetter en largeur mobile.

## Pistes écartées

- **Barre latérale et cartes génériques** (premières maquettes) : lisibles mais trop proches de toutes les applications.
- **Métaphores visuelles** (filet, ligne de métro, flux) : originales, mais il fallait apprendre à les lire.
- **Style éditorial très épuré, liste dense, tableau sombre** : soit trop chargés, soit pas assez structurés pour un outil de travail.
- **Style bande dessinée (design system Encrage)** : cohérent et ergonomique, mais pas retenu pour Cockpit. Il reste disponible sur le canevas.
