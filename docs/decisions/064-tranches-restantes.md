# 064 — Ce qui est tranché pour les tranches restantes

- **Statut** : validée (questions posées à Dorian le 2026-11-08, une réponse par point)
- **Date** : 2026-11-08
- **Décidé par** : Dorian, avec Claude
- **Tranches** : E6, 9.5, 12.1, 12.3, 12.4, 12.5, 13.1, 13.2, 13.3, 13.4, 13.5, 14.7, 15.1 à 15.4 du [découpage](../decoupage.md)
- **Revient sur** : le brief §9 (`settings.json` hors périmètre : deux clés permises, 12.3 B), le principe 4 du brief (une seule exception, la suppression de compte, 13.5 B), la 029 et la 045 (les branches en parallèle, que les écrans S38 à S38c montraient sans décision : tranchées en E6 A), [`offres.md`](../offres.md) (prix, repos Pro, rétrogradation : 13.2)
- **Confirme** : la 028 I contre l'écran S51 (pas d'adresse publique dans Réglages, la carte de S51 est retirée) ; la 012 (inscription ouverte, contre le brief §6.19 « sur invitation »)

## Contexte

Dorian veut pouvoir dire « développe toute cette tranche » sans que Claude ait de question à lui poser. Chaque tranche qui restait a été relue avec ses écrans (`docs/ecrans/`) et ses décisions, et chaque point ouvert lui a été posé. Cette décision garde ses réponses. **Elle ne remplace pas la décision propre à chaque tranche** : la tranche écrit la sienne (comme la 062 pour la 11.5), en partant de ce qui suit, et ne repose pas ces questions. Ce qui n'est pas dit ici et qu'un écran montre se construit comme l'écran ; ce qu'aucun écran ni aucune ligne ne règle est un choix de la tranche, qu'elle note dans sa décision.

## L'ordre

**12 → 15 → 13**, avec les petites tranches 9.5 et 14.7 où le découpage les place. La phase 13 dépend de choix hors du code (statut de Dorian, hébergeur, marque) ; ce qui ne demande que du code passe d'abord. La 11.6 est faite ([063](063-equipes-de-depart.md)).

## Les choix

### Équipes d'agents

| # | Tranche | Décision |
|---|---|---|
| E6 A | Les branches en parallèle (S38, S38c) | **Construites, comme S38** : le bloc « ⑂ Attendre les branches » rejoint des étapes en parallèle, avec « Attendre tous » ou « Le premier suffit ». `/dev-us` lance les étapes d'une même vague en même temps (sous-agents en parallèle) |
| E6 B | Deux agents qui écrivent en même temps | **Un worktree git par branche parallèle** (l'isolation des sous-agents de Claude Code). Le bloc « Attendre » fusionne les branches dans la branche de l'US ; un conflit de fusion arrête le run sur une question à l'humain (`ask_user`, 036) |
| E6 C | La condition d'un lien | Les trois conditions fixes (« Toujours », « Si le reviewer bloque », « Si les tests échouent ») **et « Une condition à toi »**, une phrase libre écrite dans `.claude/teams/<nom>.md`, que `/dev-us` lit et juge. Une boucle a toujours une limite, obligatoire (S38) |

### Phase 12 — Configurer Claude

| # | Tranche | Décision |
|---|---|---|
| 12.1 A | Où est l'écran S18 ? | **Dans l'onglet Agents** du projet, qui devient « Ce que Claude lit » avec les puces de S18 : `CLAUDE.md`, Règles, Skills, Agents (le graphe et l'éditeur d'E2/E3, inchangés), `.mcp.json`. Pas de nouvel onglet |
| 12.1 B | Les secrets dans `.mcp.json` | Texte JSON libre, mais **le commit est refusé** si une valeur d'en-tête ou de variable d'environnement n'est pas une référence `${VAR}`, avec la règle de la ligne MCP du bilan de santé (013). Le refus dit quelle valeur et pourquoi |
| 12.1 C | L'éditeur de skill | **Comme l'éditeur d'agent (E2, 030)** : nom, description, outils autorisés, puis le corps de `SKILL.md`, avec l'aperçu du fichier et le diff avant le commit (026). Les skills du catalogue (`/dev-us`, `/write-us`, `/analyser`) restent tenus par la mise à jour du catalogue (049) et ne s'éditent pas ici |
| 12.2 | Le catalogue enrichi | **Couvert par la 11.6** : `doc-writer` et `doc-reviewer` sont au catalogue (063 C), `security-reviewer` y était (051). **Pas d'agent `analyst`** : les agents de la reprise (`cartographer`, `rules-analyst`, `bug-hunter`, `architect`, `upgrade-advisor`) couvrent « analyser l'existant ». Il est retiré des écrans S38 et S38c |
| 12.3 A | Les agents et skills communs (S39) | **Un repo de plugins Claude Code** (une marketplace : `.claude-plugin/marketplace.json` et un plugin). Dans chaque projet, Cockpit écrit **seulement** les clés `extraKnownMarketplaces` et `enabledPlugins` de `.claude/settings.json`, avec diff et commit (026), sans toucher aux autres clés du fichier. Les sessions cloud chargent ces plugins ([doc Claude Code, plugins](https://code.claude.com/docs/en/plugins/overview)) |
| 12.3 B | Le brief §9 | Rouvert pour ces deux clés seulement : permissions, hooks et le reste de `settings.json` restent hors périmètre |
| 12.3 C | Qui crée le repo de plugins ? | **Dorian** crée un repo vide sur GitHub et l'ouvre à l'App ; Cockpit le relie dans « Équipes d'agents › Commun » et y écrit `marketplace.json` et le plugin au premier commit. Aucune permission GitHub de plus |
| 12.4 A | « Demander à Claude » sur un workflow rouge (S15) | Lance une **session cloud** (le mécanisme de la 14.1, 054) qui lit les logs et appelle un **nouvel outil MCP `propose_workflow_change`** (fichier, diff, raison). La proposition apparaît dans « Ce que Claude propose » de S15, avec « Faire le commit » et « Ignorer ». **Claude ne committe jamais un workflow** (brief §6.10) : seul l'humain, par « Faire le commit » |
| 12.4 B | La CI de départ | **Un modèle par langage dans `catalog/`** (Node, Python, Go, Rust), choisi d'après les fichiers du repo (`package.json`, `pyproject.toml`, `go.mod`, `Cargo.toml`), montré puis commité comme « Préparer pour Claude ». Sans Claude |
| 12.4 C | Les chiffres d'un workflow | Lus dans l'API Actions (lecture déjà accordée, 012 D) : dernier état, déclencheur, il y a combien de temps, « échoue depuis N exécutions », durée moyenne des 10 dernières. **Pas le nombre de tests** (« 2 tests sur 31 » de S15 est retiré) |
| 12.4 D | La permission `workflows` | Écrire dans `.github/workflows/` demande la permission `workflows` en écriture, ajoutée au manifeste (012 D). Comme la 052 : chaque utilisateur l'approuve à la main sur GitHub ; d'ici là, « Faire le commit » est grisé avec la raison et le lien pour approuver |
| 12.5 A | D'où viennent les modèles (S20) ? | **Les repos de l'utilisateur marqués « Template repository » sur GitHub.** Cockpit les liste et vérifie que leur bilan est vert ; « Gérer mes modèles » (Réglages) les prépare pour Claude comme un projet. Autant de modèles qu'on veut |
| 12.5 B | Créer le repo | **Cockpit crée le repo** (nom, description, visibilité, comme S20), l'importe, et le bilan est vert d'emblée. Il faut une permission de création de repo : la permission étroite `repository_creation` existe depuis le 13 octobre 2026 ([changelog GitHub](https://github.blog/changelog/2026-10-13-github-app-improvements-for-least-privilege-and-management)), sinon `administration` ; **la tranche vérifie d'abord laquelle marche pour un compte personnel**, avec un jeton d'utilisateur. Approbation à la main par chaque utilisateur, bouton grisé avec le lien d'ici là (comme 12.4 D) |

### Phase 15 — Téléphone et ergonomie

| # | Tranche | Décision |
|---|---|---|
| 15.1 | « Dicter » et « Photo » (S55) | **Photo oui** : l'appareil photo s'ouvre, l'image devient une pièce jointe (061). **Dicter non** : le micro du clavier du téléphone le fait déjà ; le bouton est retiré de S55 ; construit en 15.1, voir la [071](071-trois-gestes-au-telephone.md) |
| 15.2 A | iPhone ou Android ? | **Les deux à égalité.** Les boutons de réponse dans la notification (N3) quand le navigateur sait les afficher ; sinon un tap ouvre l'écran de réponse (S53). Sur iPhone, les notifications ne marchent qu'avec Cockpit ajouté à l'écran d'accueil (iOS 16.4 et plus) : la page le dit ; construit en 15.2, voir la [072](072-pwa-et-notifications.md) |
| 15.2 B | Quelles notifications ? | **Les quatre de S47** : question de Claude, run en échec (le plafond atteint et les relances épuisées finissent en échec et passent par là), PR prête à relire (groupées en une par heure), récap de la nuit (à l'heure de fin de la nuit). Chacune se coupe ; **silence réglable, de 22 h à 7 h par défaut**, sauf le récap ; un bouton envoie une notification de test. Les clés Web Push sont générées et chiffrées en base comme les autres secrets (012), jamais dans le `.env` ; construit en 15.2, voir la [072](072-pwa-et-notifications.md) |
| 15.2 C | « Cockpit ne répond plus » (S56) | **Dans la 15.2** : le service worker garde la dernière page lue ; le bandeau de S56 dit son heure et réessaie toutes les 10 secondes ; construit en 15.2, voir la [072](072-pwa-et-notifications.md) |
| 15.3 A | Le thème clair | **Claude propose la palette, Dorian valide** : dérivée des jetons de la 045 (même budget de couleur, contrastes AA vérifiés), avec des captures de l'accueil, d'un projet et d'une US dans la PR. Sombre, Clair ou Comme le système (S47) ; construit en 15.3, voir la [073](073-ergonomie.md) (la palette attend l'accord de Dorian) |
| 15.3 B | La recherche `Ctrl K` (S08) | **Comme S08** : user stories, tickets, runs, projets **et actions** (« Noter une idée », aller à un écran) ; `↑` `↓` `Entrée`, `Ctrl Entrée` ouvre à droite. Raccourcis de S47 : `Ctrl K`, `N`, `J` / `K`, `V`, et `?` pour l'aide ; construit en 15.3, voir la [073](073-ergonomie.md) : `Ctrl Entrée` ouvre dans un nouvel onglet (073 D modifie ce choix) |
| 15.3 C | Les favoris (S10) | **Dans la 15.3** : une étoile par projet, gardée en base par utilisateur ; la barre latérale montre les favoris, puis les projets actifs qui ne le sont pas, avec le filtre « Favoris » de S10 ; construit en 15.3, voir la [073](073-ergonomie.md) |
| 15.4 | La mise en route (S06) | **Les sept étapes de S06**, dans cet ordre : ouvrir des repos à Cockpit, importer un premier projet, connecter Claude, préparer un repo pour Claude, noter une première idée, valider une user story, développer avec Claude jusqu'à la première PR. Chacune se coche d'après ce qui est déjà en base. Le guide est **en haut de l'accueil** tant qu'il n'est ni fini ni masqué (« Masquer ce guide ») ; il remplace la page Bienvenue (S04) une fois l'App installée ; construit en 15.4, voir la [074](074-mise-en-route.md) |

### Les restes sans tranche

| # | Tranche | Décision |
|---|---|---|
| 14.7 | Le matin de la nuit (044 N') | **Une tranche à part**, après la phase 12 : le bilan du matin (temps de travail, tests ajoutés, échecs), « Relire en série » et la frise à l'échelle des heures (N1, N2) ; construite en 14.7 avec deux écarts, voir la [070](070-le-matin-de-la-nuit.md) |
| 9.5 A | Finitions retenues | **Les barres d'étapes d'un run** et la carte « Pourquoi Claude demande » (S29) ; **la carte du Kanban ouverte dans le panneau de droite** au lieu de changer de page |
| 9.5 B | Finitions écartées | Les filtres de Tous les projets (S10, sauf « Favoris », 15.3 C) et de l'onglet Tickets, et « Accès donnés à Claude » (S45) : **retirés des écrans** |
| S51 | L'adresse publique en lecture seule | **La 028 I l'emporte** : pas d'adresse dans Réglages ; la carte est retirée de S51 |
| S19, S24 | La nuit dans les réglages du projet et dans « Développer avec Claude » | Déjà tranché par la 044 N' : la nuit se compose seulement sur `/nuit`. Ces parties sont retirées des écrans |

### Phase 13 — Le service payant

| # | Tranche | Décision |
|---|---|---|
| 13.1 A | Les rôles (S48) | **Les trois de S48** : « lecture seule », « peut valider » (décisions humaines sur les US, 018), « peut valider et lancer » (en plus : lancer et arrêter des runs, la nuit, la file). Archiver le projet et gérer ses membres restent au **propriétaire**. La table des droits de la 4.4 gagne une colonne par rôle, testée ligne par ligne |
| 13.1 B | Inviter | **Par le login GitHub** de la personne : Cockpit crée un lien d'invitation, que l'invitant envoie lui-même ; seul ce compte GitHub peut l'accepter. Aucun e-mail envoyé par Cockpit (le champ e-mail de S48 devient « @login GitHub ») |
| 13.1 C | L'inscription | **Reste ouverte** (012) : n'importe qui entre avec GitHub et a un compte Gratuit ; l'invitation sert à partager un projet. Le brief §6.19 « sur invitation » est écarté |
| 13.1 D | L'accès GitHub d'un invité | **Exigé** : à l'acceptation, Cockpit vérifie que l'installation de l'App de l'invité couvre le repo ; sinon l'invitation explique quoi faire. Ses actions sur GitHub passent par son propre accès, jamais par celui du propriétaire (brief §6.19). L'administrateur ne voit pas les projets des autres ; il voit l'activité des comptes (dernière connexion, nombre de projets) |
| 13.2 A | Les abonnements | **Gratuit** : 3 repos au total, archivés compris (offres.md). **Pro** : **10 € par mois ou 96 € par an**, **repos illimités**, la reprise (007). **Entreprise** : seulement une carte « Nous contacter » dans Abonnement ; côté code, c'est un Pro offert par code (13.2 E) |
| 13.2 B | Ce qui est bloqué | Côté serveur, dans l'API **et** le MCP (008) : le 4e repo d'un compte Gratuit à l'import, et la reprise (007 point ouvert 7) sans Pro |
| 13.2 C | Pro → Gratuit | **Lecture seule au-delà de 3** : rien n'est perdu ni archivé ; les 3 projets les plus anciens restent actifs, les autres se lisent mais on n'y lance ni ne modifie rien (bloqué côté serveur). Repasser Pro débloque tout |
| 13.2 D | Un projet partagé | Compte **dans le quota du propriétaire seulement** ; la reprise suit l'abonnement du propriétaire |
| 13.2 E | Pro sans payer | **Les quotas s'appliquent partout, Pi compris.** Pro s'obtient par paiement ou par **un code** : l'administrateur génère des codes dans Réglages › Instance. **Un code = une personne** : il se lie au compte qui le saisit dans Abonnement, puis ne sert plus. Chaque code a une **note** (« pour Karim ») et une durée : **sans fin** ou **jusqu'à une date** ; à la fin, le compte repasse Gratuit (13.2 C). La liste montre chaque code, son état (libre, utilisé, expiré, révoqué) et **le compte lié**. L'administrateur **modifie la durée** d'un code utilisé (seul ce compte change) ou **le révoque**. Un code jamais saisi **expire au bout de 30 jours**. Les codes sont stockés hachés, montrés une seule fois (comme les jetons MCP, 015). Chaque génération, saisie, modification et révocation est journalisée. **L'administrateur de l'instance a Pro d'office**, sans code |
| 13.2 F | Le paiement | **Décidé plus tard**, quand Dorian aura sa micro-entreprise. La 13.2 construit les abonnements, les quotas et les codes **sans prestataire** : « Passer à Pro » dit que le paiement n'est pas encore ouvert. Le prestataire (Paddle, Lemon Squeezy ou Stripe) se branche dans une tranche à lui |
| 13.3 | L'hébergeur | **Décidé plus tard**, au premier client payant. La tranche attend ; tout le reste de la phase 13 se fait sur le Pi |
| 13.4 | Dirigo | **Bloquée** tant que Dorian n'a pas vérifié la marque (INPI et EUIPO, classes 9 et 42) et acheté le domaine. La 041 reste à valider. Claude ne lance pas cette tranche |
| 13.5 A | Exporter, supprimer son compte (S50) | Comme S50 : l'export JSON de tout ce que la page liste ; la suppression efface les projets, tickets, US, runs, jetons, réglages **et les entrées du journal** de la personne. Rien ne change sur GitHub. Un projet partagé dont elle est propriétaire est supprimé pour ses membres, qui en sont prévenus dans la fenêtre de confirmation |
| 13.5 B | Le journal inaltérable | **Une seule exception** au principe 4 : une fonction de la base, réservée à la suppression de compte, efface ses entrées ; une entrée sans nom (« un compte a été supprimé ») reste. Un test prouve que rien d'autre ne peut modifier ni supprimer une entrée |
| 13.5 C | Ce qui reste après la suppression | **Une empreinte** du compte GitHub (HMAC de son identifiant numérique, clé chiffrée de l'instance) et **le nombre de repos gratuits déjà utilisés**, rien d'autre. **But** : qu'une suppression ne redonne pas 3 repos gratuits ; au retour, le compteur reprend. La page Données le dit, et **l'empreinte s'efface sur demande** (la personne la demande, l'administrateur l'efface, entrée journalisée) |

## Ce qui reste ouvert

- **Le prestataire de paiement** (13.2 F) et **l'hébergeur** (13.3) : à la création de la micro-entreprise et au premier client payant.
- **La marque et le domaine Dirigo** (13.4, 041).
- **La permission de création de repo** qui marche pour un compte personnel (12.5 B) : vérifiée au début de la 12.5.
- **Les boutons dans les notifications sur iPhone** (15.2 A) : les sources ne sont pas d'accord ; la 15.2 construit le repli sur le tap, mais n'a pas été essayée sur un vrai iPhone ([072](072-pwa-et-notifications.md)) : cela reste à vérifier.
