# 091 — Chercher un projet dans « Tous les projets » (ticket #52)

- **Statut** : proposée (à valider à la relecture de la PR) ; le code est construit
- **Date** : 2026-11-20
- **Décidé par** : Dorian (ticket #52 : « chercher dans Tous les projets, sans faire défiler »), avec Claude
- **Dépend de** : [084 — Le téléphone, deuxième passe](084-le-telephone-deuxieme-passe.md) (A1), [073 — Ergonomie](073-ergonomie.md) (H)
- **Modifie** : 069, choix I (le champ de recherche de S10 n'est plus retiré)

## Le choix

| Question | Décision |
|---|---|
| Quoi | Un champ `type="search"` nommé **« Chercher un projet »** (placeholder « Chercher un projet… ») au-dessus de la liste de « Tous les projets », fait comme celui de l'import (084 A1) |
| Comment il filtre | Sur une partie du nom complet (`owner/nom`), sans tenir compte de la casse ni des espaces autour ; il se combine avec le filtre « Favoris » |
| Aucun résultat | « Aucun projet ne correspond à « texte ». » (sauf si « Favoris » est actif sans aucun favori : c'est alors l'astuce de l'étoile qui parle) |
| Ce qui reste retiré | C'est une recherche, pas un des filtres retirés par la 069 I : « Tous », « À toi », « Claude travaille », « Non préparés », « Archivés » et « Trier » restent hors de l'écran |

Rien côté serveur : la liste est déjà entière dans `GET /api/projects`, le filtre est dans `src/web/Projects.tsx`. La 069 I garde son texte pour l'historique ; le code fait foi.
