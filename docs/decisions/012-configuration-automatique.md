# 012 — Configuration automatique et consentements

- **Statut** : validée
- **Date** : 2026-10-22
- **Décidé par** : Dorian, avec Claude
- **Dépend de** : [008 — Service en ligne](008-service-en-ligne.md), [009 — Connexion avec GitHub](009-connexion-github.md), [011 — Importer un projet](011-import-projets.md)
- **Revient sur** : la configuration par variables d'environnement de la 009 (G) et de la 011 (H), la liste de comptes autorisés en configuration (009 A), et la permission unique de la 011 (I). Dorian l'a demandé : « je ne veux pas avoir à renseigner des valeurs dans le .env, c'est super dur à maintenir »
- **Rouverte (choix G, 1.6)** : la liste de comptes autorisés devient une inscription ouverte et une liste de comptes bloqués. Dorian l'a demandé : « je ne veux pas avoir à accepter ou non des gens … je veux que chaque personne puisse créer son compte cockpit depuis son compte github »
- **Modifiée par** : [023 — Réglages en onglets, adresse publique en https](023-reglages-adresse-https.md) : le choix C (détection de l'adresse) lit `CF-Visitor` d'abord et exige `https://`, et l'administrateur peut changer l'adresse dans Réglages (retiré par la 028, plus bas) ; [026 — Écrire dans un repo](026-ecrire-dans-un-repo.md) : le choix D donne Pull requests en écriture
- **Modifiée par 052** : le manifeste du choix D demande trois permissions de lecture de plus (`dependabot_alerts`, `security_events`, `secret_scanning_alerts`) et les événements `dependabot_alert`, `code_scanning_alert` et `secret_scanning_alert` — voir la [052](052-constats-de-github-et-versions.md), choix A
- **Modifiée par 067** : le manifeste du choix D demande aussi `workflows` en écriture — voir la [067](067-ci-cd.md), choix D
- **Modifiée par 068** : le manifeste du choix D demande aussi `repository_creation` en écriture — voir la [068](068-repo-modele.md), choix F
- **Modifiée par 038** : l'App s'abonne aussi à `pull_request_review` (choix D) — voir la [038](038-suivi-de-la-pr.md), choix C
- **Modifiée par 028** : l'assistant ne demande plus de confirmer l'adresse, il la détecte lui-même (choix C) — voir la [028](028-creme-sombre-onglets-journal.md), choix J

## Contexte

Après la 011, déployer Cockpit demande neuf valeurs dans `/etc/cockpit/cockpit.env`, dont une clé privée en base64 et des réglages faits à la main sur GitHub. C'est fragile pour Dorian, et impossible à demander à un client. La règle devient : **tout ce que Cockpit peut configurer lui-même, il le configure, en demandant l'autorisation à la personne concernée**, et il dit clairement ce qui ne marche pas si elle refuse.

## Ce que GitHub permet

- **Créer une GitHub App à partir d'un manifeste** ([docs GitHub](https://docs.github.com/en/apps/sharing-github-apps/registering-a-github-app-from-a-manifest)) : Cockpit envoie la description complète de l'App, la personne clique « Create GitHub App » sur GitHub, et Cockpit reçoit en retour l'identifiant, le slug, la clé privée, l'identifiant et le secret OAuth, et le secret des webhooks. L'échange doit avoir lieu dans l'heure.
- **Aucune API ne modifie les permissions d'une App existante.** Quand l'App en demande davantage, chaque compte qui l'a installée doit approuver sur GitHub ; d'ici là, l'App garde ses anciennes permissions ([docs GitHub](https://docs.github.com/en/apps/using-github-apps/approving-updated-permissions-for-a-github-app)).
  *Tranché par la [052](052-constats-de-github-et-versions.md) A et B pour les alertes de GitHub : le manifeste demande `dependabot_alerts`, `security_events` et `secret_scanning_alerts` en lecture et trois événements ; pour une App existante, Cockpit guide (ligne « Alertes GitHub » du bilan, ligne grise sur l'écran des constats), il ne modifie rien.*

## Les choix

| # | Question | Décision |
|---|---|---|
| A | Qui crée la GitHub App ? | **L'assistant de démarrage de Cockpit**, par le flux du manifeste, au premier lancement. Plus aucune variable GitHub dans le fichier d'environnement |
| B | Qui peut lancer l'assistant ? | Celui qui donne le **code de démarrage** affiché dans les logs du serveur au premier lancement (et rappelé par `deploy.sh`). Sans lui, quelqu'un qui atteindrait l'adresse avant Dorian pourrait créer sa propre App et prendre l'instance. La personne qui termine l'assistant devient **administratrice** |
| C | L'adresse publique | **Détectée** par l'assistant à partir de la requête (en-têtes transmis par Cloudflare), puis **confirmée** par l'administrateur avant de créer l'App. Plus de `PUBLIC_URL` |
| D | Permissions demandées à la création | **Tout le MVP d'un coup**, pour ne rien avoir à modifier à la main ensuite : Metadata (lecture), Contents (lecture et écriture, pour la préparation des repos, 6.x), Issues (lecture et écriture, 4.6), Pull requests (lecture ; **écriture** depuis la [026](026-ecrire-dans-un-repo.md) G, pour ouvrir une pull request quand la branche par défaut est protégée), Checks et Commit statuses (lecture), Actions (lecture). Événements des webhooks : `issues`, `pull_request`, `check_suite`, `status`, `workflow_run` (GitHub envoie de toute façon `installation` et `installation_repositories` à chaque App, et ne les accepte pas dans le manifeste). Ce qui viendra après le MVP (par exemple `workflows` en écriture, brief §6.10) demandera la manipulation manuelle décrite plus haut |
| E | Visibilité de l'App | **Publique** (« Any account »), pour que chacun puisse l'installer. Cockpit laisse entrer tout compte GitHub qui n'est pas bloqué (G) |
| F | Où vivent les secrets de l'App ? | **En base, chiffrés** (AES-256-GCM). La clé de chiffrement est **générée au premier lancement** dans un volume Docker séparé (`cockpit-secrets`), jamais dans la base ni dans ses sauvegardes : une sauvegarde volée ne suffit pas à agir sur les repos des utilisateurs |
| G | Qui peut se connecter ? | **Inscription ouverte, avec une liste de comptes bloqués.** Tout compte GitHub qui se connecte à Cockpit obtient un compte non administrateur ; l'administrateur peut le bloquer (et le débloquer) dans « Réglages ». Plus de `ALLOWED_GITHUB_LOGINS`, plus de liste de comptes autorisés (la première version de la 1.6, abandonnée avant d'être déployée : « accepter ou non des gens » n'est pas le rôle que Dorian veut). Un compte bloqué est repéré par son `github_id`, donc changer de login ne le débloque pas. Bloquer ferme ses sessions ouvertes ; l'administrateur ne peut pas être bloqué |
| H | Premier passage d'un utilisateur | Après sa connexion, s'il n'a pas installé l'App, Cockpit l'envoie **automatiquement** sur une page d'accueil qui explique ce que fait l'installation, ce qui ne marchera pas sans elle, et propose « Installer Cockpit sur mon compte GitHub » ou « Plus tard ». Tant que l'App n'est pas installée, un bandeau le rappelle. Depuis la [075](075-mise-en-route.md) : cette page reste la première étape du guide de l'accueil, qui prend le relais une fois l'App installée |
| I | Mot de passe de la base | **Généré par `deploy.sh`** au premier déploiement, s'il manque dans le fichier d'environnement |

## Ce qui reste à saisir à la main

| Quoi | Pourquoi Cockpit ne peut pas le faire |
|---|---|
| Installer Docker et le runner GitHub sur le Pi | Cockpit tourne *dans* Docker : il ne peut pas s'installer lui-même |
| Le jeton du tunnel Cloudflare (`TUNNEL_TOKEN`), **seule valeur du fichier d'environnement** | Il vient du compte Cloudflare de Dorian ; le créer demanderait un accès à ce compte |
| Une copie de la clé de chiffrement hors du Pi, une fois | Sans elle, une restauration sur une autre machine ne peut pas relire les secrets de l'App : il faudrait refaire l'assistant et réinstaller l'App |

## Ce qui ne marche pas si quelqu'un refuse

| Autorisation | Qui, où | Si elle est refusée |
|---|---|---|
| Créer l'App (assistant) | L'administrateur, sur GitHub | **Cockpit ne fonctionne pour personne** : il reste sur la page de l'assistant |
| Se connecter avec GitHub | Chaque utilisateur, sur GitHub | **Pas d'accès à Cockpit** : le compte GitHub est l'identité |
| Installer l'App sur son compte | Chaque utilisateur, sur GitHub | **Connecté, mais sans projet** : ni import, ni bilan de santé, ni issues, ni suivi des PR et de la CI, ni préparation des repos. Restent le Journal et les réglages. Le bandeau reste affiché, l'installation reste possible à tout moment |
| Ne choisir que certains repos | Chaque utilisateur, sur GitHub | Seuls ces repos sont importables ; la liste se change sur GitHub |
| Approuver une permission ajoutée après le MVP | Chaque utilisateur, sur GitHub | L'App garde ses anciennes permissions ; Cockpit affiche les fonctions indisponibles et le lien pour approuver |
| Le connecteur Claude (006, plus tard) | Chaque utilisateur, sur claude.ai | Claude ne peut pas parler à Cockpit sans jeton : jeton manuel (004), ou US écrites à la main |

## Conséquences

- **Découpage** : deux tranches avant la 2.2, chacune relisible en une séance :
  - **1.5 — Assistant de démarrage** : code de démarrage, flux du manifeste avec les permissions de D, secrets chiffrés et clé dans son volume, adresse détectée et confirmée, premier compte administrateur ; suppression des variables GitHub et de `PUBLIC_URL` ; `deploy.sh` génère le mot de passe de la base ; README réécrit. Si l'App existe mais que personne n'est administrateur (assistant interrompu avant la première connexion), le serveur réaffiche le code de démarrage et la page « Récupérer l'administration » (`POST /api/setup/claim`) rend l'administration au compte qui se connecte ensuite.
  - **1.6 — Accueil des utilisateurs** : inscription ouverte, liste des utilisateurs et blocage dans la page « Réglages » de l'administrateur ; renvoi automatique vers la page d'accueil et bandeau tant que l'App n'est pas installée. Mise en œuvre : colonne `users.blocked_at` (nulle tant que le compte est actif), `/api/settings/users` (liste) et `/api/settings/users/:id/block` et `/unblock`, réservées à l'administrateur, `/api/installation` pour savoir si l'App est installée. À la connexion, un compte bloqué est refusé (`/?erreur=compte-bloque`, entrée `refused` dans l'historique) ; bloquer ferme ses sessions, et une connexion qui court en même temps est écartée (verrou de la ligne `users`). L'historique garde l'identifiant du compte, jamais son login (010 D). Si la vérification de l'installation échoue à la connexion, la session s'ouvre quand même.
- **Webhooks** : l'App est créée avec ses webhooks actifs vers `/api/webhooks/github` ; jusqu'à la 5.1, ces livraisons échouent sans conséquence (rien n'en dépend encore).
- **Code** : `GITHUB_APP_*`, `GITHUB_CLIENT_*`, `PUBLIC_URL` et `ALLOWED_GITHUB_LOGINS` disparaissent de `index.ts`, `compose.yaml`, `deploy.sh` et du README.

## Limites connues

- **Des droits accordés avant d'être utilisés** (choix D) : chacun donne à l'installation l'écriture sur le contenu et les issues alors que Cockpit ne s'en sert qu'à partir des tranches 4.6 et 6.x. Cockpit n'écrit jamais que de la configuration, toujours après avoir montré le diff (brief, principe 3).
- **Perdre le volume de la clé** sans en avoir de copie oblige à refaire l'assistant (nouvelle App) et chaque utilisateur à réinstaller l'App.
- **Inscription ouverte (G)** : n'importe quel compte GitHub peut créer un compte Cockpit. Pas encore faits : la limite de 3 repos du plan gratuit n'est pas appliquée (Dorian a décidé le 2026-10-24 qu'elle sera mise en place avec le paiement, pas avant) ; aucune notification à l'administrateur lors d'une nouvelle inscription (il découvre les nouveaux comptes dans « Réglages ») ; la page RGPD (ce que Cockpit conserve, comment supprimer son compte) reste à écrire.
- **L'adresse détectée dépend des en-têtes du proxy** : c'est pourquoi elle est confirmée par l'administrateur, et l'assistant est protégé par le code de démarrage. *(Depuis la 028 J, plus de confirmation : l'assistant refuse une adresse qui n'est pas en `https://`, sauf boucle locale.)*

## Pistes écartées

- **Garder les variables d'environnement** : c'est ce que Dorian refuse, et impossible à demander à un client.
- **Permissions ajoutées au fur et à mesure** : moins de droits accordés, mais une modification manuelle de l'App et une nouvelle approbation de chaque utilisateur à chaque tranche.
- **Secrets en clair dans la base** : une sauvegarde volée donnerait accès aux repos de tous les utilisateurs.
- **Assistant sans code de démarrage** : la première personne à atteindre l'adresse prendrait l'instance.
- **Envoyer l'utilisateur directement sur la page d'installation de GitHub** : elle ne dit pas ce que Cockpit ne pourra pas faire en cas de refus.
