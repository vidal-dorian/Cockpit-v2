# 082 — Deux équipes d'agents en Gratuit

- **Statut** : proposée (à valider à la relecture de la PR) ; le code est construit
- **Date** : 2026-11-10
- **Décidé par** : Dorian (« dans la version gratuite, on ne peut faire que 2 équipes d'agents, après c'est payant dans la version Pro » ; A et D), avec Claude (B, C, E, F)
- **Dépend de** : [074 — Les équipes à la demande](074-equipes-a-la-demande.md) (B, la table `agent_teams` et ses routes), [077 — Les offres et les quotas](077-offres-et-quotas.md) (A, qui est Pro ; C, le refus `plan` ; F, la page Abonnement), [079 — L'équipe en canevas](079-equipe-en-canevas.md) (E, l'enregistrement depuis `/equipes`), [081 — Les retours d'action](081-retours-d-action.md)
- **Modifie** : [077](077-offres-et-quotas.md) F (les cartes Gratuit et Pro de l'Abonnement) et « Ce qui ne change pas » (les équipes d'agents ne sont plus toutes dans Gratuit) ; [074](074-equipes-a-la-demande.md) B2 (le `PUT` peut répondre 403 `plan`)
- **Tranche** : aucune du [découpage](../decoupage.md) (demande de Dorian du 2026-11-10)
- **Écran** : [S49](../ecrans/S49_Reglages_Offre.png), [S35](../ecrans/S35_Equipes.png)

## Contexte

La 077 met les équipes d'agents dans Gratuit sans limite. Le 2026-11-10, Dorian a décidé qu'un compte Gratuit n'a que 2 équipes d'agents, et que Pro les a sans limite.

## Les choix

| # | Question | Décision |
|---|---|---|
| A | Quelles équipes comptent | Celles de **« Tes équipes d'agents »** (`/equipes`, table `agent_teams`, 074 B) du compte. Les équipes nommées d'un repo (onglet Agents, canevas d'un projet, 032 et 079) et l'équipe de départ écrite à l'import (063) ne comptent pas : elles vivent dans le repo, que n'importe qui peut écrire sur GitHub |
| B | Le quota | **2 équipes à la fois** pour un compte Gratuit ; Pro (077 A, administrateur compris) n'a pas de limite. Supprimer une équipe libère sa place : contrairement aux repos (077 B, « archivés compris »), une équipe ne coûte rien à Cockpit une fois supprimée |
| C | La 3e équipe | `PUT /api/agent-teams/:name` d'un nom que le compte n'a pas, par un compte Gratuit qui en a déjà 2 ou plus : **403 `{ error: "plan" }`**, journalisé `refused` (action `save_agent_team`, comme les autres refus de `act`). Le nombre est relu dans la transaction, après un verrou sur la ligne de l'utilisateur, comme à l'import (077) : deux créations à la fois ne passent pas toutes deux. **Remplacer** une équipe qu'il a déjà (même nom) n'est jamais refusé |
| D | Pro → Gratuit | **Rien ne bouge** : les équipes au-delà de 2 restent modifiables, supprimables et ajoutables aux projets. Seule la création d'une nouvelle équipe est refusée tant que le compte en a 2 ou plus |
| E | La page `/equipes` | `GET /api/me/plan` rend aussi **`teamLimit`** (2 en Gratuit, `null` en Pro). Quand le compte a autant d'équipes que `teamLimit` ou plus, « Nouvelle équipe » est désactivé et, sous la phrase d'état, la page dit « Ton abonnement Gratuit couvre 2 équipes d'agents. Passe à Pro pour en ajouter. » avec un lien **« Abonnement »** vers `/reglages/abonnement`. Si le serveur refuse quand même (un autre onglet a créé une équipe entre-temps), le canevas montre la même phrase à la place de l'erreur générale |
| F | Abonnement (S49) | **Modifie la 077 F** : la carte Gratuit liste aussi « 2 équipes d'agents », la carte Pro « Équipes d'agents illimitées » |

## Ce qui ne change pas

- Les équipes des repos, « Développer avec Claude » (qui liste les équipes du repo), l'ajout d'une équipe à un projet (074 B7 à B9) et le MCP (aucun outil n'écrit dans `agent_teams`).
- Aucun paiement : « Passer à Pro » montre toujours la phrase de la 077 G.

## Ce que le code a précisé

- **`plans.ts`** : `FREE_TEAM_LIMIT = 2`, à côté de `FREE_LIMIT`.
- **`agent-teams.ts`** : le `PUT` verrouille la ligne de `users` (`for("update")`) dans la transaction de `act`, cherche l'équipe du même nom, et seulement si elle n'existe pas et que `planOf(tx, userId)` rend `free`, compte les lignes de `agent_teams` du compte ; à `FREE_TEAM_LIMIT` ou plus, il lève `Refused("plan")`, que la route rend en 403 `{ error: "plan" }`.
- **`pro-codes.ts`** : `teamLimit` (`FREE_TEAM_LIMIT`, `null` en Pro) est dans le corps commun de `GET /api/me/plan` et de `POST /api/me/pro-code`.
- **`roles.ts`** : `TEAM_QUOTA_REFUSAL` porte la phrase, pour la page et pour le canevas.
- **`AgentTeams.tsx`** : « Nouvelle équipe » est désactivé (`aria-describedby` vers la phrase, d'id `team-quota`) quand `teamLimit` n'est pas nul et que la liste l'atteint ; la phrase est suivie du lien « Abonnement ». Le 403 `plan` du `PUT` est remplacé par le code `team_quota`, une entrée de `REFUSALS` (`ProjectPrepare.tsx`) qui n'est pas un code du serveur.
- **`Subscription.tsx`** : « 2 équipes d'agents » dans la carte Gratuit, « Équipes d'agents illimitées » dans la carte Pro.

## Limites connues

- **La limite se contourne** en créant les équipes dans l'onglet Agents de chaque projet : c'est voulu (A), seule la commodité « créer une fois, ajouter partout » est limitée.
- **Pro → Gratuit garde toutes les équipes** (D) : un compte passé par Pro peut en garder plus de 2.
