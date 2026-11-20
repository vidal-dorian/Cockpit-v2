# 093 — Un seul nom par notion dans l'interface (ticket #46)

- **Statut** : proposée (à valider à la relecture de la PR) ; le code est construit
- **Date** : 2026-11-20
- **Décidé par** : Dorian (ticket #46), avec Claude
- **Dépend de** : le brief, §4 Vocabulaire ; [053 — Journal filtrable](053-journal-filtrable.md)

## Le choix

| Question | Décision |
|---|---|
| Où sont les noms ? | Dans [docs/glossaire.md](../glossaire.md), une page. Pour en changer un, on change la page et cette décision |
| Les fichiers `.claude/rules` | **Règles du code**, distinct des **Règles** de Conception |
| « Écran de reprise » | Disparaît du texte : les liens disent l'onglet, « Règles » |
| Journal et Historique | Deux choses : le Journal est global, l'Historique est celui d'un projet (053). Les deux noms restent. La puce « Journal » de l'onglet Historique est le Journal filtré sur le projet (062) ; la section « Historique » d'une US est la trace de cette US |
| Ticket, Idée | Le ticket est l'objet. « Idée » est le nom de la première étape (colonne Idées, onglet et barre Idée du téléphone) et reste : 045 B, 055 D et 071 C ne sont pas rouvertes |
| Lanceur | Déjà seul dans l'interface ; le glossaire le fige |
| Tâche cloud, Lanceur, Routine, « Tâches programmées » | Quatre noms pour quatre choses, que le glossaire distingue : la tâche cloud est la tâche claude.ai (054 A), le Lanceur l'une d'elles, la routine un travail défini dans Cockpit, « Tâches programmées » la page qui les liste (056 F). Aucun écran n'est renommé : 054 A et 056 F ne sont pas rouverts |

## Limites

Texte seulement : ni routes, ni base, ni API, ni outils MCP ne changent.
