# 077 — Les offres et les quotas

- **Statut** : proposée (à valider à la relecture de la PR) ; le code est construit (tranche 13.2)
- **Date** : 2026-11-09
- **Décidé par** : Dorian, avec Claude ([064](064-tranches-restantes.md) 13.2 A à F)
- **Dépend de** : [007 — Reprendre une app existante](007-reprise-app-existante.md) (point ouvert 7), [008 — Le service en ligne](008-service-en-ligne.md) (les fonctions payantes bloquées côté serveur), [010 — L'historique](010-historique.md), [011 — Importer un projet](011-import-projets.md), [012 — La configuration automatique](012-configuration-automatique.md) (G, Réglages › Instance), [015 — Les jetons MCP](015-jetons-mcp.md) (un secret haché, montré une fois), [068 — Un nouveau projet depuis un modèle](068-repo-modele.md), [076 — Plusieurs utilisateurs](076-plusieurs-utilisateurs.md) (les rôles)
- **Modifie** : [`offres.md`](../offres.md) (la limite de 3 repos arrive sans le paiement, comme la 064 13.2 E le tranche)
- **Tranche** : 13.2 du [découpage](../decoupage.md)
- **Écran** : [S49](../ecrans/S49_Reglages_Offre.png)

## Contexte

L'import n'est pas limité et la reprise (007) est ouverte à tous. La 064 13.2 a tranché : Gratuit (3 repos au total, archivés compris), Pro (10 € par mois ou 96 € par an, repos illimités, la reprise), Entreprise en « Nous contacter » ; les quotas s'appliquent partout, Pi compris ; Pro s'obtient par un code que l'administrateur génère, le paiement viendra plus tard.

## Les choix

| # | Question | Décision |
|---|---|---|
| A | Qui est Pro | Un compte est **Pro** s'il est administrateur de l'instance (064 13.2 E), ou s'il a saisi un code Pro ni révoqué ni arrivé à sa fin. Sinon il est **Gratuit**. Rien n'est stocké sur le compte : l'état se calcule à chaque lecture, donc un code arrivé à sa date rend le compte Gratuit sans tâche planifiée |
| B | Le quota Gratuit | **3 repos au total** : les projets dont le compte est **propriétaire**, archivés compris (offres.md, remarque 1). Un projet partagé ne compte que chez son propriétaire (064 13.2 D) |
| C | Le 4e repo | `POST /api/projects` (importer) et `POST /api/projects/from-template` (068) refusent en 403 `plan`, journalisé `refused`, quand un compte Gratuit en a déjà 3. Le message : « Ton abonnement Gratuit couvre 3 repos, archivés compris. Passe à Pro pour en ajouter. » Le refus de `from-template` arrive avant l'autorisation GitHub, donc aucun repo n'est créé. Aucun outil MCP n'importe de repo : il n'y a rien à bloquer de ce côté |
| D | La reprise | Elle suit l'abonnement du **propriétaire** du projet (064 13.2 D). L'analyse se lance par un lien `claude://` (`AnalyseWindow`), sans route du serveur : ce que le serveur bloque, ce sont les outils MCP qui écrivent la reprise, `submit_code_map`, `submit_findings` et `create_takeover_stories`, qui rendent l'erreur `plan` sans Pro (journalisée comme les autres refus du MCP). Sans US de reprise, rien ne se fige (050). Ce qui est déjà en base se lit toujours. La fenêtre « Analyser » montre « La reprise fait partie de l'offre Pro. » avec un lien vers Abonnement à la place du lien qui la lance |
| E | Pro → Gratuit (064 13.2 C) | Rien n'est perdu ni archivé. Les **3 projets les plus anciens** du propriétaire (par date d'import, archivés compris) restent actifs ; les autres sont en **lecture seule** pour tous leurs membres, propriétaire compris : le rôle de chacun y est ramené à « lecture seule » (076 A), et le refus d'un geste est `plan` au lieu de `role`. Le projet le montre par un bandeau : « Ce projet est en lecture seule : l'abonnement Gratuit de `@proprio` couvre 3 projets. » Repasser Pro débloque tout |
| F | Abonnement (S49) | Réglages › **Abonnement**. Phrase d'état : « Ton abonnement : Gratuit. » / « 2 repos sur 3 utilisés. » (à 3 : « 3 repos sur 3 utilisés. Passe à Pro pour en ajouter. ») ; Pro : « Ton abonnement : Pro. » / « Par un code, sans fin. », « Par un code, jusqu'au 12 mars 2027. » ou « En tant qu'administrateur de l'instance. ». Trois cartes : **Gratuit** (0 €, 3 repos, tickets, US, Kanban, runs, la nuit de Claude, la jauge « N repos sur 3 ») ; **Pro** (10 € par mois ou 96 € par an, repos illimités, reprendre une app existante, « Passer à Pro ») ; **Entreprise** (prix selon le besoin, « Nous contacter »). Dessous, **« J'ai un code Pro »** : un champ et « Activer ». Puis **Factures** : « Aucune facture pour l'instant. » S49 met « Membres et partage » dans Pro et un prix de 12 € : la 064 l'emporte, le partage (076) est ouvert à tous et Pro coûte 10 € |
| G | « Passer à Pro » (064 13.2 F) | Pas de prestataire de paiement : le bouton montre « Le paiement n'est pas encore ouvert. Si on t'a donné un code Pro, saisis-le ci-dessous. » « Nous contacter » montre la même phrase, faute d'adresse de contact (elle viendra avec Dirigo, 13.4) |
| H | Saisir un code | `POST /api/me/pro-code` avec `{ code }`. Un code libre, non expiré et non révoqué se lie au compte et ne sert plus (« un code = une personne »). Sinon, une seule réponse : « Ce code n'est pas valable. » Un compte déjà Pro par un code peut en saisir un autre : le nouveau remplace l'ancien |
| I | Les codes (Réglages › Instance) | Une carte **« Codes Pro »**, pour l'administrateur seulement. « Générer un code » : une **note** (« pour Karim », 80 caractères au plus) et une **durée**, « sans fin » ou « jusqu'au » une date future. Le code est montré **une seule fois** avec « Copier », puis gardé haché (015). La liste montre chaque code (sa note, sa durée, sa date de création), son **état** (libre, utilisé, expiré, révoqué) et, s'il est utilisé, **le login du compte lié**. Un code jamais saisi **expire 30 jours** après sa création. Sur un code utilisé : **« Modifier la durée »** (seul ce compte change) ; sur un code libre ou utilisé : **« Révoquer »**, après confirmation |
| J | L'historique | Générer, saisir (réussi ou refusé), modifier la durée et révoquer un code sont des actions journalisées (010), avec l'identifiant du code dans `args`, jamais le code ni la note |

## Ce qui ne change pas

- Les tickets, les US, le Kanban, les runs, la nuit, le MCP et le partage (076) restent dans Gratuit.
- Aucun paiement, aucune facture : le prestataire se branche dans une tranche à lui (064 13.2 F).

## Limites connues

- **Un nouveau compte GitHub redonne 3 repos** (offres.md, remarque 3) : la 13.5 garde une empreinte qui l'évite après une suppression de compte, rien de plus.
- **L'administrateur est Pro d'office** : sur une instance où plusieurs comptes sont administrateurs, chacun l'est.
