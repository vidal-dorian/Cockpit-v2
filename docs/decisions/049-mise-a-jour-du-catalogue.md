# 049 — La mise à jour du catalogue

- **Statut** : proposée (à valider à la relecture de la PR) ; le code est construit (tranche C1)
- **Date** : 2026-11-07
- **Décidé par** : Dorian, avec Claude
- **Dépend de** : [026 — Écrire dans un repo](026-ecrire-dans-un-repo.md), [027 — Préparer pour Claude](027-preparer-pour-claude.md) (le catalogue), [013 — Le bilan de santé](013-bilan-de-sante.md), [030 — L'éditeur d'agent](030-editeur-d-agent.md) (l'écriture de plusieurs fichiers en un commit), [043](043-carte-du-code.md) M et [047](047-ecran-de-reprise.md) M (« Ajouter /analyser au repo »)
- **Tranche** : C1 du [découpage](../decoupage.md), phase 10, à faire avant R4

## Contexte

« Préparer pour Claude » (027) copie le catalogue de Cockpit (`catalog/` : les agents, les skills `/dev-us`, `/write-us` et `/analyser`, un `CLAUDE.md` de départ) dans le repo d'un utilisateur. Quand Cockpit améliore ensuite `/dev-us` ou un agent, un repo déjà préparé garde l'ancienne copie : R4 va changer `/dev-us`, et les repos préparés avant ne le sauraient pas. Démo : je change le catalogue, un repo préparé affiche « Mettre à jour », je vois le diff et je valide ; une copie modifiée à la main n'est pas touchée.

Le 2026-11-07, Dorian a tranché les deux questions : Cockpit **garde l'empreinte** de ce qu'il écrit (1 : A), et le bouton vit **dans l'onglet Santé** (2 : A).

## Les choix

| # | Question | Décision |
|---|---|---|
| A | Comment savoir qu'une copie n'a pas été modifiée à la main ? | **Cockpit garde l'empreinte** (SHA-256 du texte) de chaque fichier du catalogue qu'il écrit dans un repo : une table `catalog_writes` (`project_id`, `path`, `sha256`, `written_at`), unique par `(project_id, path)`, remplie à chaque écriture réussie de « Préparer pour Claude », de « Ajouter /analyser au repo » et de « Mettre à jour ». Une copie est **d'origine** si son texte a exactement l'empreinte gardée. Rien n'est ajouté aux fichiers du repo |
| B | Et un repo préparé avant C1, sans empreinte ? | Cockpit compare la copie aux **anciennes versions du catalogue** : un fichier `catalog/history.json` liste, pour chaque fichier du catalogue, les empreintes de toutes ses versions passées dans `main`. Un script (`npm run catalog:history`) le régénère depuis l'historique git de `catalog/` ; un test échoue tant que la version actuelle d'un fichier du catalogue n'y est pas, pour qu'on ne l'oublie pas. Une copie dont le texte a une de ces empreintes est d'origine |
| C | Quels fichiers ? | Les fichiers du catalogue **sauf `CLAUDE.md`**, qui est fait pour être réécrit par chaque projet (027) : il n'est jamais proposé à la mise à jour |
| D | L'état de chaque fichier ? | **À jour** : le texte du repo est la version actuelle du catalogue. **Ancienne version** : le texte est d'origine (A ou B) mais pas la version actuelle. **Modifié à la main** : le texte n'est ni la version actuelle ni une version d'origine (y compris une modification faite avec l'éditeur d'agent de la 030). **Absent** : le fichier n'est pas dans le repo, alors que le repo est préparé (il contient `.claude/skills/dev-us/SKILL.md`) |
| E | Où ? | Une **ligne de plus au bilan de santé** (013) : « Fichiers de Claude à jour ». Verte quand aucun fichier n'est en ancienne version ni absent ; **rouge** sinon, avec « N fichiers ont une nouvelle version » et le bouton **« Mettre à jour »**. Elle n'apparaît que pour un repo préparé (D) : un repo non préparé a déjà ses lignes rouges et « Préparer pour Claude ». Les fichiers modifiés à la main y sont listés en gris, « modifié à la main, gardé tel quel », et ne rendent pas la ligne rouge |
| F | « Mettre à jour » ? | Comme « Préparer pour Claude » : un **diff par fichier** (l'ancienne version du repo contre la nouvelle du catalogue, `DiffList`), puis **un seul commit** « chore: update the Claude files (Cockpit) » avec l'écriture de la 030 E : chaque fichier est relu au moment d'écrire, et s'il a changé entre-temps, rien n'est écrit (`repo_changed`). Les fichiers absents sont créés, les anciennes versions remplacées ; **un fichier modifié à la main n'est jamais écrit**. Branche protégée : une pull request, comme la 026 G. L'historique garde l'action `update_catalog` |
| G | « Ajouter /analyser au repo » ? | Il reste dans la fenêtre d'analyse (043 M, 047 M) et passe par la même logique : il écrit aussi les empreintes. Un `/analyser` d'une ancienne version, d'origine, est désormais **mis à jour** au lieu d'être laissé tel quel (ce que la 047 notait comme limite jusqu'à C1) |
| H | Le coût ? | La ligne lit les fichiers du catalogue présents dans le repo, au commit de tête, avec la lecture de la 026 (`inspect`), une fois par calcul du bilan. Le bilan est déjà gardé en cache et recalculé à chaque push (013, 024) |

## Ce que le code a précisé (tranche C1)

- **Routes** : `POST /api/projects/:id/catalog/plan` et `/catalog/apply`, corps `{ files: [{ path, before }] }` (`before` : le texte lu dans le repo, `null` pour un fichier absent). Le serveur n'écrit que les textes du catalogue, jamais ceux du navigateur. 400 pour un chemin hors du catalogue, pour `CLAUDE.md`, ou pour un `before` modifié à la main ou déjà à jour ; 409 `not_prepared` (aussi au moment d'appliquer), `repo_changed`, `pull_request_forbidden` ; sur une branche protégée, 200 avec `pullRequest`. L'historique garde l'action `update_catalog`.
- **Plan de « Préparer »** : un nouveau statut `update` (ancienne copie d'origine), accepté par `/prepare/apply` seulement avec le texte du catalogue ; c'est ce qui met à jour `/analyser` depuis « Ajouter /analyser au repo » (G).
- **Bilan de santé** : la ligne `{ key: "catalog", ok, detail, files: [{ path, state }] }`, entre `agents` et `webhook`.
- **Code** : la table `catalog_writes` (migration `0024`) ; `src/server/catalog-update.ts` (`catalogStates` rend l'état de chaque fichier) ; `catalog/history.json` et `npm run catalog:history` (refuse un clone superficiel, où l'historique est tronqué) ; `.gitattributes` garde `catalog/` en LF pour que les empreintes ne changent pas d'un poste à l'autre.

## Ce qui est repoussé

- **Mettre à jour une copie modifiée à la main** (fusionner ses changements avec la nouvelle version) : elle reste telle quelle ; l'utilisateur peut la supprimer du repo, et elle sera proposée comme absente.
- **Prévenir ailleurs que dans Santé** (accueil, bandeau) : le bilan suffit (2 : A).

## Limites connues

- **Une version du catalogue qui n'a jamais été dans `main`** (une branche de travail) n'est pas dans `history.json` : une copie écrite depuis cette branche est vue comme modifiée à la main.
- **Une copie modifiée puis remise exactement à l'identique** redevient d'origine : c'est voulu, le texte est le même.
- **Une écriture par pull request garde l'empreinte tout de suite**, alors que la branche par défaut garde l'ancien texte jusqu'à la fusion. C'est sans effet tant que Cockpit est déployé depuis `main` (tous les textes qu'il écrit sont dans `history.json`) ; mais une copie connue seulement par son empreinte gardée (un Cockpit construit depuis une branche) serait alors vue comme modifiée à la main.

*Note : la [051](051-constats-de-claude.md) L modifie D et F : la ligne `model:` d'un agent ne compte pas dans la comparaison, et « Mettre à jour » garde le modèle du repo.*
