# 041 — Le nom du produit et le site vitrine

- **Statut** : proposée (à valider à la relecture de la PR)
- **Date** : 2026-11-06
- **Décidé par** : Dorian, avec Claude
- **Dépend de** : [008 — Service en ligne](008-service-en-ligne.md) (le Pi puis un hébergeur), [009 — Connexion avec GitHub](009-connexion-github.md) (cookie de session), [006](006-connexion-oauth.md) et [021](021-connecter-claude.md) (connecteur claude.ai), [024](024-webhooks.md) (adresse du webhook)
- **Précise** : 008 C (« le domaine de Dorian ») : le service vendu aura son propre domaine ; la version de test reste sur celui de Dorian

## Contexte

Cockpit tourne sur le Pi, à `cockpit.dorianvidal.com`, pour Dorian et quelques proches qui remontent bugs et idées. Il passera chez un hébergeur avec les premiers clients (008 B). Il faut un site vitrine pour le présenter, et donc un nom et une adresse.

Trois constats :

- **« Cockpit » est déjà pris** dans le logiciel : c'est le nom d'une console web Linux très connue ([cockpit-project.org](https://cockpit-project.org/)).
- **Les mots qui évoquent « l'humain garde la main sur des agents IA » sont saturés** : Tandem et Veto sont déjà les noms de plusieurs outils qui pilotent ou encadrent des agents de code.
- **L'adresse de l'app est difficile à changer, celle de la vitrine non.** L'adresse de l'app est inscrite dans la GitHub App (adresse de retour, webhook), dans le connecteur claude.ai de chaque utilisateur, dans les domaines autorisés de ses environnements cloud, et le cookie de session lui est lié. La vitrine se déplace avec une simple redirection.

## Les choix

| # | Question | Décision |
|---|---|---|
| A | Quel nom ? | **Dirigo** (latin, « je dirige ») : l'humain dirige, Claude exécute (brief §7, principe 1). Se prononce bien en français comme en anglais (francophones d'abord, international ensuite). Aucun outil pour développeurs de ce nom trouvé ; le plus proche est Eclipse Dirigible, un autre mot |
| B | Quel domaine ? | **`dirigo.dev`**, un seul, chez Cloudflare Registrar (le DNS y est déjà). Pas d'autres extensions « au cas où » |
| C | Quelles adresses ? | La vitrine sur **`dirigo.dev`**, l'app sur **`app.dirigo.dev`**. Pas de deuxième niveau de sous-domaine (`app.cockpit.…`) : le certificat gratuit de Cloudflare ne le couvre pas |
| D | Quand l'app change-t-elle d'adresse ? | **Au passage chez l'hébergeur**, puisque l'image et la base déménagent déjà ce jour-là. D'ici là, la version de test reste à `cockpit.dorianvidal.com`. Les testeurs rebranchent leur connecteur et mettent à jour leurs environnements cloud une fois |
| E | Vitrine dans le même projet ? | **Non, un repo à part**, en site statique sur Cloudflare Pages. La vitrine reste en ligne si l'app tombe ; ses changements de texte ne font ni monter la version de l'app (release-please lit les `feat:`) ni tourner sa CI ; le processus test-writer, developer puis reviewer ne s'applique pas à du texte de présentation |
| F | Comment passe-t-on de la vitrine à l'app ? | **On change d'adresse.** « Se connecter » est un lien vers `https://app.dirigo.dev/api/auth/login` ; la connexion GitHub se fait sur le domaine de l'app, comme aujourd'hui (009). Aucune session partagée : le cookie `cockpit_session` reste lié au seul domaine de l'app, la vitrine ne peut pas le lire. Rien à changer dans l'app |
| G | Quand renommer Cockpit en Dirigo dans le code ? | **Dans une tranche dédiée, au passage chez l'hébergeur.** Trois niveaux : le texte visible (interface, nom de la GitHub App, nom du connecteur) change ; les labels `cockpit: …` déjà posés sur les issues GitHub (020) demandent une migration, à décider dans cette tranche ; les noms internes (cookie, variables `COCKPIT_*`, tables) peuvent rester |

## Ce qui est repoussé

- **Le dépôt de la marque** à l'INPI (classes 9 et 42) : quand les premiers clients approchent, pas pour une version de test.
- **Le contenu et le style de la vitrine** : avec la tranche « Service payant » ([offres](../offres.md)). Les couleurs y seront copiées des jetons de `src/web/styles.css`.
- **La tranche de renommage** (G) et la migration des labels.

## À vérifier avant d'acheter le domaine

- **`dirigo.dev` est libre** chez un registraire : non vérifié (une recherche web ne montre aucun site à cette adresse, ce qui ne prouve rien).
- **Aucune marque « Dirigo »** dans les classes 9 et 42, sur [data.inpi.fr](https://data.inpi.fr) et [TMview](https://www.tmdn.org/tmview) : non vérifié. Si l'un des deux bloque, cette décision est à reprendre.

## Limites connues

- **La vitrine copie les jetons de style** de l'app : les deux peuvent se décaler avec le temps.
- **Les testeurs refont leur configuration** au passage chez l'hébergeur (D) : acceptable pour quelques personnes, pas pour des clients. L'adresse de l'app ne doit donc plus bouger une fois chez l'hébergeur.

## Options écartées

- **Vitrine à `cockpit.dorianvidal.com` et app à `app.cockpit.dorianvidal.com`** : deuxième niveau de sous-domaine, certificat payant chez Cloudflare.
- **Rester sur `dorianvidal.com` pour le service vendu** : fait projet personnel, et repousse un changement d'adresse au moment où il coûte le plus.
- **La vitrine servie par l'app** (`/` quand on n'est pas connecté) : la vitrine tomberait avec l'app, et chaque texte passerait par la CI et la version de l'app.
- **Les noms Cockpit, Tandem, Veto** : déjà pris dans les outils pour développeurs, Tandem et Veto précisément pour piloter des agents de code. **Astrolabe, Alidade** : proposés, pas retenus par Dorian.
