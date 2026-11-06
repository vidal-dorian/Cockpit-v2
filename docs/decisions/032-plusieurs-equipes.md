# 032 — Plusieurs équipes par projet

- **Statut** : proposée (à valider à la relecture de la PR)
- **Date** : 2026-11-05
- **Décidé par** : Dorian, avec Claude
- **Dépend de** : [029 — Équipe d'agents](029-equipe-d-agents.md) (G, B, E), [031 — L'équipe en graphe](031-equipe-en-graphe.md), [030 — Éditeur d'agent](030-editeur-d-agent.md), [013 — Bilan de santé](013-bilan-de-sante.md)
- **Modifie** : la règle F de la [013](013-bilan-de-sante.md), déjà modifiée par la 029 E : elle vérifie aussi les équipes nommées
- **Tranche** : E4 du [découpage](../decoupage.md)
- **Modifiée par** : [041](041-nouvelle-equipe-fenetre.md) : « Nouvelle équipe » (E) s'ouvre dans une fenêtre, et l'onglet passe sur deux colonnes

## Contexte

La 029 G a déjà décidé l'essentiel : d'autres équipes dans `.claude/teams/<nom>.md`, au format de la 029 B, choisies par `/dev-us 42 --team <nom>` ; `.claude/team.md` reste l'équipe par défaut. Démo : `/dev-us 42 --team leger` suit l'équipe « leger ». Il reste à dire ce que font le skill, le bilan et l'écran de la 031.

## Les choix

| # | Question | Décision |
|---|---|---|
| A | Le nom d'une équipe ? | Le format d'un nom d'agent (029 B) : `a-z`, `0-9`, `-`, sans tiret au début, et au plus 238 caractères pour que `.claude/teams/<nom>.md` tienne en 255 (026 D). Les fichiers de `.claude/teams` dont le nom n'a pas ce format sont ignorés |
| B | `/dev-us` ? | **Avec `--team <nom>`** : il suit `.claude/teams/<nom>.md` ; si le fichier n'existe pas, il **s'arrête** et le dit, sans retomber sur l'équipe par défaut (on croirait avoir lancé « leger »). **Sans `--team`** : rien ne change (`team.md`, sinon les trois étapes par défaut). Le texte du skill du catalogue (027) le dit ; un repo déjà préparé garde son ancien skill tant qu'il n'est pas mis à jour (027, « repoussé ») |
| C | Le bilan ? | La ligne `agents` (013 F, 029 E) regarde aussi chaque équipe nommée : **verte** si chaque équipe est lisible (029 B) et que chaque agent qu'elle nomme existe ; un fichier illisible : `invalid_team` ; un agent manquant : `missing`. Pas de dossier `.claude/teams` : comme aujourd'hui. Coût : la liste de `.claude/teams` est connue avec celle de `.claude` (une lecture de plus), puis chaque équipe est lue une fois, dans la même vague que `team.md` (013 A, 029 limites) ; les repos sans équipe nommée ne paient rien de plus |
| D | La lecture ? | La route de la 030 B rend en plus **`teams: [{ name, text }]`**, par nom ; `text` vaut `""` pour un fichier qui n'est pas un simple fichier lisible (comme `team`, 031). Sans dossier : `[]` |
| E | L'écran ? | En haut de la section « Équipe » (031 A), une liste **« Équipe »** : « Par défaut (team.md) » puis chaque équipe nommée. Choisir une équipe charge son brouillon dans le même graphe et la même liste (031) ; un brouillon modifié demande confirmation avant d'en changer (« Les changements non enregistrés seront perdus »). **« Nouvelle équipe »** : un nom (A, pas déjà pris) ; elle part d'une copie de l'équipe affichée. **« Supprimer l'équipe »** (pas pour l'équipe par défaut, 031 « repoussé ») demande confirmation. Sous la liste, la commande à copier : `/dev-us <US> --team <nom>` |
| F | L'écriture ? | `POST /api/projects/:id/team/apply` (031 H) prend en plus **`name`** : absent ou `null` pour `.claude/team.md`, sinon `.claude/teams/<nom>.md` (nom validé par A, 400 sinon). `after: null` est accepté **seulement avec un `name`** (supprimer une équipe nommée) ; sinon les règles de la 031 H. Messages : `feat: update the team <nom> (Cockpit)`, `feat: remove the team <nom> (Cockpit)` ; pour l'équipe par défaut, celui de la 031 |
| G | L'historique ? | `save_team` (029 I, 031 I) avec `args: { path }`, le chemin disant l'équipe ; `delete_team` pour une suppression. Le journal : « Équipe enregistrée », « Équipe supprimée » |

## Ce qui est repoussé

- **Choisir l'équipe dans la fenêtre « Développer avec Claude »** (7.2) : elle n'existe pas encore ; la commande à copier (E) suffit d'ici là.
- **Renommer une équipe** : en créer une copie, puis supprimer l'ancienne.
- **Une équipe globale à tous les projets** (029, « repoussé »).

## Limites connues

- **Un repo préparé avant cette tranche** a un `/dev-us` qui ignore `--team` : il faut mettre à jour le skill à la main tant que le catalogue ne sait pas le faire (027).
- **Supprimer un agent qu'une équipe nommée utilise** fait passer la ligne `agents` au rouge, comme pour `team.md` (029, limites).
- **Un dossier `.claude` trop gros** (GitHub tronque sa liste) : les équipes nommées ne sont pas vérifiées par le bilan.
- **`--team` reste une consigne** que Claude suit (029, limites).
