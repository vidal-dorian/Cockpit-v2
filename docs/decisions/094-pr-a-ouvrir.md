# 094 — Un run dont seule la pull request manque n'est pas un échec

- **Statut** : proposée (à valider à la relecture de la PR)
- **Date** : 2026-11-24
- **Décidé par** : Dorian, avec Claude
- **Dépend de** : [033 — Run minimal](033-run-minimal.md) ; [044 — La nuit de Claude](044-la-nuit-de-claude.md) ; [072 — PWA et notifications](072-pwa-et-notifications.md)

## Le problème

`/dev-us` ouvrait la pull request avec `gh pr create`. Dans une session Claude Code sur le web, `gh` n'existe pas, et la session peut refuser d'ouvrir une pull request. Le run était alors fini en `failed` : la notification « Échec d'un run » partait alors que le code, les tests et les revues étaient faits et la branche poussée, et la story revenait à `ready` sans rien pour rattacher la pull request ouverte ensuite à la main.

## Le choix

| Question | Décision |
|---|---|
| A — Outil pour ouvrir la pull request | `gh pr create`, ou l'outil GitHub `create_pull_request` quand `gh` n'est pas là ; de même `gh issue list` ou `list_issues` pour trouver l'issue. Le skill ne dit rien pour lever le contrôle de la session : si elle refuse, c'est B |
| B — Quand la pull request n'a pas pu être ouverte | La branche est poussée, puis `finish_run` avec `outcome` `pr_to_open`. Le run prend le statut `pr_to_open`, libellé « PR à ouvrir » ; la story reste `in_progress` ; les étapes encore ouvertes sont fermées comme pour un échec |
| C — Notification | « PR à ouvrir », de type `question` (Claude attend un geste de l'utilisateur, le même interrupteur), avec le `i_want` de la story et le lien du run. Jamais « Échec d'un run » |
| D — Rattacher la pull request | Quand GitHub annonce une pull request ouverte (`pull_request`, action `opened`) dont la branche est celle d'une story dont le dernier run est `pr_to_open`, Cockpit fait ce que fait `link_pull_request` : la story prend le numéro et passe `in_review`, le run passe `succeeded`, la notification « PR prête à relire » part |
| F — La nuit et la file de lancement | Pas un échec non plus : le récap du matin compte le run à part, libellé « PR à ouvrir » (une valeur de plus du résultat d'une story de la nuit), et la file de lancement ne se met pas en pause pour lui |
| E — La pull request n'est jamais ouverte | « Fermer à la main » (033) ferme aussi un run `pr_to_open` ; la story revient à `ready` |

## Limites

- Un run `pr_to_open` garde la story `in_progress` : on ne la relance pas tant que la pull request n'est pas ouverte ou le run fermé à la main.
- Seule une pull request ouverte **après** le run est rattachée ; une pull request déjà ouverte sur la branche passe par `pr_number` de la story, comme avant.
