# Offres — notes de Dorian

- **Statut** : idées notées le 2026-10-22. **Construit** par la [décision 077](decisions/077-offres-et-quotas.md) (tranche 13.2) : la limite de 3 repos et la reprise réservée à Pro sont en place sans paiement, avec des codes Pro. **Tranché le 2026-11-08** par la [décision 064](decisions/064-tranches-restantes.md) (13.2) : Pro à 10 € par mois ou 96 € par an, repos illimités, lecture seule au-delà de 3 après Pro, quota chez le propriétaire d'un projet partagé, Entreprise en « Nous contacter », codes Pro donnés par l'administrateur, prestataire de paiement plus tard. Le reste de ce fichier garde les idées d'origine. À reprendre avec la tranche « Service payant » (voir [`decoupage.md`](decoupage.md)) et le point ouvert 2 de la [décision 008](decisions/008-service-en-ligne.md).

- **Limite de 3 repos** : appliquée depuis la 13.2, **sans le paiement** ([077](decisions/077-offres-et-quotas.md)). Dorian avait décidé le 2026-10-24 de la mettre en place avec le paiement ; l'import n'était alors pas limité (inscription ouverte, [012](decisions/012-configuration-automatique.md)).

## Les trois offres

### Gratuite

- **3 repos au total.** Ce n'est pas 3 repos en même temps : lier 3 repos, en supprimer un puis en lier un nouveau n'est pas possible.
- Toutes les fonctionnalités de base : développement, Kanban, tickets, MCP de Claude…

### Pro

- Tout ce que contient l'offre gratuite.
- **10 € par mois** en abonnement mensuel, ou **8 € par mois** en abonnement annuel (96 € par an).
- **15 repos en même temps** (ou 20, à réfléchir).
- Service client à disposition.
- **Reprendre un projet fait par une IA**, pour revoir ses règles métier ([décision 007](decisions/007-reprise-app-existante.md)).

### Entreprise

- Tout ce que contient l'offre Pro.
- Service client à disposition.
- Prix selon le besoin.
- Nombre de repos variable.
- Reprendre un projet fait par une IA.

## Remarques de Claude, à trancher le moment venu

1. **« 3 repos au total » est déjà compatible avec le modèle** : un projet ne se supprime jamais, il s'archive (brief §6.1). Compter tous les projets d'un compte, archivés compris, suffit. Il ne faudra jamais ajouter de vraie suppression de projet, sinon la règle devient contournable.
2. **« 15 en même temps »** se compte, à l'inverse, sur les projets **non archivés**. Les deux offres ne comptent donc pas de la même façon : à garder en tête pour que l'écran l'explique clairement.
3. **Contournement facile** : un nouveau compte GitHub donne 3 nouveaux repos gratuits. Le risque est faible au début ; s'il devient réel, on pourra compter les repos par repo GitHub (`github_repo_id`) plutôt que par compte.
4. **Qui paie, la personne ou l'équipe ?** L'offre Pro semble être par personne. Avec plusieurs membres par projet (008), il faudra dire si un projet partagé compte dans le quota de chaque membre ou seulement dans celui de son propriétaire.
5. **Passer de Pro à gratuit** avec 12 projets actifs : on les garde lisibles en lecture seule, ou on demande d'en archiver 9 ? À décider.
6. **Ce qui sera bloqué côté serveur** (008) : le nombre de repos à l'import (2.1) et la reprise (007), dans l'API **et** dans le MCP, pas seulement masqués dans l'interface.
7. **Prix** : 10 € par mois est cohérent avec un coût presque nul par client (Cockpit n'appelle jamais Claude). Mais le client paie déjà son abonnement Claude à côté : à présenter comme un complément, pas comme un outil d'IA de plus.
