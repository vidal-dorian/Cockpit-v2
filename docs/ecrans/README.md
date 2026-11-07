# Les écrans de Cockpit

Chaque écran de Cockpit, dans le style **« Quatre temps »** ([décision 045](../decisions/045-interface-quatre-temps.md)). Ils ont été validés par Dorian le 2026-11-07. Leur logo (quatre carrés) est une ébauche : le logo est celui de la [décision 046](../decisions/046-logo-la-boucle.md), la boucle.

Chaque écran existe en deux fichiers :
- **`.png`** : pour le regarder ;
- **`.html`** : pour lire les textes, les couleurs et les mesures exactes. Il s'ouvre dans un navigateur ; seules les polices viennent de Google Fonts.

La source est le canevas « Cockpit — Maquettes » (https://claude.ai/artifact/XAteTYa7tQBcCGq8HpRF7C), rangées « Écrans 1/10 » à « 10/10 », plus l'accueil, le Kanban et la nuit de Claude.

## Comment s'en servir pour développer

- **Un écran se développe avec sa tranche** : la colonne « Tranche » renvoie à [`decoupage.md`](../decoupage.md). La tranche 9.3 a posé la coque commune (jetons, polices, barre latérale, panneau de droite et barre d'idée) et refait dans ce style les écrans qui existaient (la tranche R1 y a ajouté l'onglet Conception) ; les autres écrans suivent avec leur tranche.
- **L'écran montre le but, la décision dit les règles.** Quand les deux se contredisent, la décision l'emporte, et on le signale. Les données des écrans sont des exemples : les projets, les noms et les montants n'existent pas.
- **« À trancher »** veut dire que l'écran montre une proposition, pas une décision. Il faut une décision avant de développer cette partie.
- Les règles visuelles (une seule chose en rouge, un seul bouton blanc par zone, la phrase d'état en haut) sont dans la décision 045.

## 1 · Entrer dans Cockpit

| Écran | Ce qu'il montre | Tranche | Décisions | À trancher |
|---|---|---|---|---|
| [S01](S01_Connexion.png) | Connexion avec GitHub | 1.3 (existe) | 009 | |
| [S02](S02_Assistant_Adresse.png) | Mise en service, étape 1 : le code de démarrage, l'adresse détectée | 1.5 (existe) | 012, 028 J | |
| [S03](S03_Assistant_GitHubApp.png) | Mise en service, étape 2 : créer la GitHub App, ses permissions | 1.5 (existe) | 012 | |
| [S04](S04_Bienvenue.png) | Bienvenue : ouvrir des repos, les importer, connecter Claude | 1.6 (existe) | 012 | |
| [S05](S05_AutoriserClaude.png) | Claude demande l'accès (`/autoriser`) | 4.7 (existe) | 021 | |
| [S06](S06_MiseEnRoute.png) | Mise en route qui se coche toute seule | 15.4 | | les étapes exactes |

## 2 · Accueil, recherche, idées

| Écran | Ce qu'il montre | Tranche | Décisions | À trancher |
|---|---|---|---|---|
| [S00a](S00a_Accueil.png) | L'accueil : phrase d'état, « 1 · Maintenant », « 2 · Ensuite », Claude en ce moment, la question ouverte à droite | 8.1 (existe), refaite en 9.3 | 040, 045 | |
| [S07](S07_Accueil_Calme.png) | L'accueil quand rien n'attend : plus aucun rouge | 8.1, 9.3 | 040 G | |
| [S08](S08_Recherche.png) | Recherche globale `Ctrl K` | 15.3 | | |
| [S09](S09_NoterIdee.png) | Noter une idée en détail : projet, priorité, étiquettes, pièce jointe | 11.2, 11.4 | 014 | |

## 3 · Projets

| Écran | Ce qu'il montre | Tranche | Décisions | À trancher |
|---|---|---|---|---|
| [S10](S10_TousLesProjets.png) | Tous les projets (50), filtres, favoris | 2.1, 9.3 | 011 | les favoris |
| [S11](S11_Importer.png) | Importer des repos ; un repo ancien propose la reprise | 2.1 (existe), R1 | 011, 007 | |
| [S12](S12_Sante.png) | Onglet Santé : le bilan, « À corriger d'abord » | 2.2, 6.2 (existent) | 013, 027 | |
| [S13](S13_PreparerPourClaude.png) | Préparer pour Claude : chaque fichier relu avant le commit | 6.2 (existe) | 026, 027 | |
| [S14](S14_Tickets.png) | Onglet Tickets, le ticket ouvert à droite | 3.1 (existe), 11.2 | 014 | |
| [S15](S15_CICD.png) | Onglet CI / CD : les workflows, un changement proposé par Claude | 12.4 | | permission `workflows` (012) |
| [S16](S16_Historique.png) | Onglet Historique, filtré | 11.1 | 010 | |
| [S17](S17_Changelog.png) | Changelog du projet, branches à nettoyer | 11.5 | | |
| [S18](S18_ConfigClaude.png) | Modifier `CLAUDE.md` avec son diff | 12.1 | 026 | |
| [S19](S19_ReglagesProjet.png) | Réglages du projet : écriture des US, la nuit, dossier du clone, archiver | 4.8 (existe), 14.6 | 022, 044, 005 | |
| [S20](S20_NouveauDepuisModele.png) | Nouveau projet depuis un repo modèle | 12.5 | | |
| [S00b](S00b_Kanban.png) | Onglet Kanban | 4.5 (existe), 9.3 | 019 | |

## 4 · Tickets et user stories

| Écran | Ce qu'il montre | Tranche | Décisions | À trancher |
|---|---|---|---|---|
| [S21](S21_Ticket.png) | Un ticket, ses US, ses pièces jointes | 3.1 (existe), 11.4 | 014 | |
| [S22](S22_US_AValider.png) | Une US à valider, la décision à droite | 4.4 (existe) | 018 | |
| [S23](S23_US_Renvoyer.png) | Renvoyer une US à Claude, avec un commentaire obligatoire | 4.4 (existe) | 018 | |
| [S24](S24_US_Developper.png) | Développer avec Claude : cloud, ce PC ou cette nuit | 7.2 (existe), 14.1, 14.6 | 034, 044 | le choix du cloud (14.1) |
| [S25](S25_US_EnRevue.png) | Une US en revue : la PR, la CI, le verdict | 7.6, 7.7 (existent) | 038, 039 | |
| [S26](S26_IssueModifiee.png) | Issue modifiée sur GitHub : choisir la version | 5.2 (existe) | 025 | |
| [S27](S27_ImporterIssues.png) | Importer les issues GitHub | 11.3 | 020 | |

## 5 · Claude au travail

| Écran | Ce qu'il montre | Tranche | Décisions | À trancher |
|---|---|---|---|---|
| [S28](S28_Claude_Runs.png) | Tous les runs, la file d'attente | 9.3, 14.3 | 033 | la file (14.3) |
| [S29](S29_Run_EnCours.png) | Un run en direct, avec sa question à droite | 7.1, 7.4 (existent) | 033, 036 | |
| [S30](S30_Run_Fini.png) | Un run fini : le verdict, les critères, le coût | 7.7 (existe), 14.5 | 035, 039 | le coût (14.5) |
| [S31](S31_Run_Fermer.png) | Fermer un run muet | 7.5 (existe) | 037 | |
| [S32](S32_TachesProgrammees.png) | Les tâches programmées de Claude | 14.2 | 022 | les routines libres (14.2) |
| [S33](S33_CoutBudget.png) | Coût et plafonds | 14.5 | | tout (14.5) |
| [S34](S34_Nuit_EnCours.png) | La nuit de Claude, pendant la nuit | 14.6 | 044 | |
| [N1](N1_Nuit_Soir.png) | La nuit de Claude : le soir | 14.6 | 044 | |
| [N2](N2_Nuit_Matin.png) | La nuit de Claude : le matin | 14.6 | 044 | |
| [N3](N3_Nuit_Telephone.png) | La nuit de Claude : le téléphone à 8 h | 14.6, 15.2 | 044 | |

## 6 · Équipes d'agents et journal

| Écran | Ce qu'il montre | Tranche | Décisions | À trancher |
|---|---|---|---|---|
| [S35](S35_Equipes.png) | Les équipes de chaque projet, le catalogue | E4 (existe), 12.2 | 029, 032 | |
| [S36](S36_EquipeGraphe.png) | Onglet Agents : l'équipe en graphe, les agents du repo | E3 (existe) | 031, 042 B | |
| [S37](S37_EditeurAgent.png) | Éditeur d'agent | E2 (existe) | 030 | |
| [S38](S38_NouvelleEquipe.png) | Nouvelle équipe en canevas plein écran : une boucle sélectionnée | E6 | 042 (modifiée par 045) | **les branches en parallèle** |
| [S38b](S38b_Equipe_Intercaler.png) | Intercaler un agent oublié sur un lien | E6 | 045 | |
| [S38c](S38c_Equipe_TracerLien.png) | Tracer un lien, mettre deux agents en parallèle | E6 | 045 | **les branches en parallèle, la condition écrite** |
| [S39](S39_ConfigGlobale.png) | Agents et skills communs à tous les projets | 12.3 | | |
| [S40](S40_Journal.png) | Le journal filtrable, une entrée ouverte | 1.4 (existe), 11.1 | 010, 028 F | |

## 7 · Reprendre une app existante

| Écran | Ce qu'il montre | Tranche | Décisions | À trancher |
|---|---|---|---|---|
| [S41](S41_Reprise_Carte.png) | Onglet Conception : la carte du modèle, un objet et son code | R1 (existe) | 007, 043 | |
| [S42](S42_Reprise_Regle.png) | Valider une règle à côté de son code | R2 (existe) | 007, 047 | |
| [S43](S43_Reprise_Graphe.png) | Le graphe d'une fonctionnalité | R3 | 007 | |
| [S44](S44_Reprise_Constats.png) | Les constats : failles, versions, architecture | R5, R6 | 007 | |

## 8 · Réglages

| Écran | Ce qu'il montre | Tranche | Décisions | À trancher |
|---|---|---|---|---|
| [S45](S45_Reglages_Claude.png) | Connecter Claude, les accès donnés, les jetons MCP | 4.1, 4.7 (existent) | 015, 021 | |
| [S46](S46_Reglages_TachesCloud.png) | Tâches cloud : écrire les US, la nuit | 4.8 (existe), 14.6 | 022, 044 | |
| [S47](S47_Reglages_Preferences.png) | Préférences : notifications, thème, raccourcis | 15.2, 15.3 | | le thème clair |
| [S48](S48_Reglages_Membres.png) | Membres et partage | 13.1 | 008 | **les rôles** |
| [S49](S49_Reglages_Offre.png) | Abonnement : Gratuit ou Pro, les factures | 13.2 | | **les prix** ([offres](../offres.md)) |
| [S50](S50_Reglages_Donnees.png) | Données : exporter, supprimer son compte | 13.5 | | |
| [S51](S51_Reglages_Instance.png) | Instance (administrateur) : adresse en lecture seule, branchements, utilisateurs | 1.6 (existe) | 012, 024, 028 I | |

## 9 · Téléphone et erreurs

| Écran | Ce qu'il montre | Tranche | Décisions | À trancher |
|---|---|---|---|---|
| [S52](S52_Tel_Accueil.png) | Accueil sur le téléphone | 15.1 | 003 | |
| [S53](S53_Tel_Repondre.png) | Répondre à Claude | 15.1 | 036 | |
| [S54](S54_Tel_ValiderUS.png) | Valider une US | 15.1 | 018 | |
| [S55](S55_Tel_NoterIdee.png) | Noter une idée | 15.1 | 014 | dicter, photo |
| [S56](S56_Erreurs.png) | Page introuvable, Cockpit hors ligne | 9.3 (page introuvable faite) | | « Cockpit hors ligne » : seule l'alerte « Serveur injoignable » existe |

Sur le téléphone, la barre du bas (Accueil, Idée, Nuit, Projets) est la même sur chaque écran.
