# 029 — Une équipe d'agents configurable par projet

- **Statut** : validée
- **Date** : 2026-11-03
- **Décidé par** : Dorian, avec Claude
- **Dépend de** : [005 — Lancement local](005-lancement-local.md), [013 — Bilan de santé](013-bilan-de-sante.md), [026 — Écrire dans un repo](026-ecrire-dans-un-repo.md), [027 — Préparer pour Claude](027-preparer-pour-claude.md)
- **Modifie** : la règle F de la [013](013-bilan-de-sante.md) (les trois agents ne sont plus exigés quand le projet a sa propre équipe) ; le brief §6.9 (l'éditeur d'agent passe avant le reste de la configuration Claude)
- **Tranche** : après le MVP, voir « Configuration Claude » du [découpage](../decoupage.md)
- **Modifiée par** : [030 — Éditeur d'agent](030-editeur-d-agent.md) : l'historique (I) gagne `delete_agent` ; renommer un agent passe à E3
- **Modifiée par** : [031 — L'équipe en graphe](031-equipe-en-graphe.md) : l'écran « Équipe » (F) est un graphe de cartes, en plus de la liste ; un agent du catalogue s'ajoute par l'éditeur avant l'équipe
- **Modifiée par** : [032 — Plusieurs équipes](032-plusieurs-equipes.md) : les équipes nommées (G) sont vérifiées par le bilan et modifiables dans l'écran « Équipe »
- **Modifiée par** : [074 — Les équipes à la demande](074-equipes-a-la-demande.md) : « une équipe globale à tous les projets », repoussée ici, est construite (équipes de l'utilisateur ajoutées à un projet au format de B)
- **Modifiée par** : [079 — L'équipe en canevas](079-equipe-en-canevas.md) : le format (B) gagne `id`, `parallel`, `wait` et `max`

## Contexte

Demande du 2026-11-03. Le skill `/dev-us` reste le chemin par défaut, mais l'utilisateur doit pouvoir **ajouter, modifier ou retirer des agents** dans ce schéma, et même définir **d'autres structures selon le projet**.

Aujourd'hui, la structure est écrite en dur dans le texte du skill (`catalog/skills/dev-us/SKILL.md`, § « Develop ») : test-writer, developer, reviewer, dans cet ordre. Un éditeur d'agents seul (brief §6.9) ne suffit pas : on changerait le modèle d'un agent, mais on ne pourrait ni en ajouter un ni retirer le reviewer. La règle F de la 013 exige en plus les trois fichiers : retirer un agent ferait passer le projet au rouge.

Cockpit ne fait tourner aucun modèle d'IA (architecture, « La charge est faible »). Il n'écrit que des fichiers dans le repo ; Claude Code les exécute.

## Les choix

| # | Question | Décision |
|---|---|---|
| A | Les agents ? | Restent des fichiers `.claude/agents/*.md` (005 A), avec leur `model:`. L'éditeur du brief §6.9 les ajoute (depuis le catalogue ou de zéro), les modifie (nom, description, outils, modèle, prompt, aperçu du fichier généré) et les supprime. Chaque enregistrement est un commit avec le diff montré avant, par le mécanisme de la 026 |
| B | Où est la structure ? | Dans un fichier du repo, **`.claude/team.md`** : un en-tête YAML qui liste les étapes dans l'ordre. Chaque étape a un `agent` (le nom d'un fichier de `.claude/agents/`), un `does` (une phrase), et peut avoir `loop_to` (l'étape à reprendre) et `until` (la condition d'arrêt de la boucle). Le fichier est écrit pour Claude **et** lu par Cockpit : le format est donc fixe, sans texte libre à interpréter. **Format accepté par Cockpit** : un en-tête entre deux lignes `---` au tout début du fichier, avec `steps:` en clé de premier niveau ; chaque étape commence par une ligne indentée `  - agent: <nom>` (l'`agent` est la **première clé** de l'étape), le nom étant nu (sans guillemets, sans commentaire en fin de ligne) et fait de `a-z`, `0-9` et `-`, sans commencer par un tiret ; les autres clés (`does`, `loop_to`, `until`) sont ignorées par Cockpit. Tout le reste est `invalid_team` |
| C | Et sans ce fichier ? | `/dev-us` garde le comportement actuel : test-writer, developer, reviewer jusqu'au verdict prêt. Un projet qui ne touche à rien ne change pas. Le catalogue (027) ne livre pas `team.md` : il est créé la première fois que l'utilisateur modifie l'équipe, pré-rempli avec ces trois étapes |
| D | Ce que `/dev-us` lit ? | Le skill dit : « suis `.claude/team.md` s'il existe, sinon les trois étapes par défaut ». Les vérifications d'avant, la branche, la fin (tests, lint, pull request) et les « Never » restent **dans le skill, hors de l'écran** : jamais de merge, jamais de force-push, jamais de test modifié pour passer, pas de secret |
| E | La règle F de la 013 ? | Vert si `.claude/skills/dev-us/SKILL.md` existe **et** : sans `team.md`, les trois agents par défaut existent (comme aujourd'hui) ; avec `team.md` lisible, chaque agent qu'il nomme existe. Sinon `missing`. Un `team.md` illisible : `invalid_team` (nouveau code fixe, traduit en français par la page, 013 B) |
| F | L'écran « Équipe » ? | Sur `/projets/:id` : la liste des étapes avec, pour chacune, l'agent, son modèle et ce qu'il fait. Ajouter une étape (agent du projet ou du catalogue), retirer, réordonner, régler la boucle. Un agent s'ouvre dans l'éditeur (A). Un seul bouton « Enregistrer » : **un commit** avec les fichiers touchés (agents et `team.md`), diff montré avant (026). Un avertissement, sans blocage, quand on retire `test-writer` ou `reviewer` (le TDD du `CLAUDE.md` du projet en dépend) |
| G | Plusieurs structures par projet ? | **Dans un second temps** : `.claude/teams/<nom>.md` et `/dev-us 42 --team <nom>` ; `.claude/team.md` reste l'équipe par défaut. Le format (B) ne change pas |
| H | Le Leader ? | Pas de rôle particulier : c'est la **session principale**, dont le modèle se choisit dans Claude Desktop (005 A). Un sous-agent ne peut pas en lancer d'autres, donc un « agent leader » ne pourrait pas déléguer. L'utilisateur règle sa façon de déléguer dans le `does` de chaque étape |
| I | L'historique ? | Entrées `save_agent` et `save_team` (humain, `ui`, `project_id`), `args: { path }` seulement, et dans `github_effects` `{ commitSha, pullRequest }` (010 D, 027 E). Aucun texte de prompt dans les `args` |

## Découpage

| # | Tranche | Démo |
|---|---|---|
| E1 | `/dev-us` lit `team.md` (avec défaut), règle F et code `invalid_team` du bilan | Je dépose un `team.md` sans `reviewer` à la main : le bilan reste vert et `/dev-us` saute l'étape |
| E2 | Éditeur d'agent (A) | Je change le modèle du `developer` et j'ajoute un `doc-writer` : un commit, diff montré avant |
| E3 | Écran « Équipe » (F) | J'ajoute `doc-writer` après `developer`, j'enregistre, `team.md` est commité |
| E4 | Plusieurs équipes (G) | `/dev-us 42 --team leger` suit l'équipe « leger » |

E1 et E2 ne dépendent pas de l'interface : ils se testent sans écran.

## Ce qui est repoussé

- Plusieurs équipes par projet (E4).
- Une équipe **globale** à tous les projets : elle vivra dans le repo de plugins de la configuration globale (brief §6.9).
- Imposer une structure minimale : l'avertissement de F suffit.

## Limites connues

- **`team.md` est une consigne lue par Claude, pas du code exécuté.** Cockpit ne peut pas garantir que l'ordre et les boucles sont respectés à la lettre. C'est déjà le cas du texte actuel du skill.
- **Retirer test-writer ou reviewer affaiblit la méthode** ; c'est un choix du projet, signalé et non interdit.
- **Un agent supprimé que `team.md` nomme encore** rend la ligne `agents` rouge (`missing`) : l'écran (F) retire l'étape dans le même commit, mais une suppression faite à la main sur GitHub ne le fait pas.
- **`team.md` coûte une vague d'appels de plus au bilan** (013 A) : il se lit une fois la liste de `.claude` connue, soit cinq appels en trois vagues (huit en quatre si `.claude` est tronqué), pour les seuls repos qui en ont un.
- **Une équipe plus grosse coûte plus de tokens** qu'une session seule : à mesurer avant de la recommander (le suivi du coût vient après le MVP).
- **Écarté : régénérer par Cockpit la section « Develop » du `SKILL.md`.** Plus direct, mais une modification à la main du skill entrerait en conflit avec l'écran ; un fichier séparé coûte une indirection de plus.
