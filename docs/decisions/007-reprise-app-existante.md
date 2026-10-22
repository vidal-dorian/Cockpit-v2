# 007 — Reprendre une app existante

- **Statut** : proposée (à valider à la relecture de la PR)
- **Date** : 2026-10-22
- **Décidé par** : Dorian, avec Claude
- **Dépend de** : [002 — Modèle de données](002-modele-donnees.md), [003 — Interface](003-interface.md), [004 — Outils MCP](004-outils-mcp.md), [005 — Lancement local](005-lancement-local.md)
- **Ajoute** : une fonctionnalité au brief, après le MVP. Ne revient sur aucune décision prise

## Contexte

La boucle du brief (§2) ne sert qu'aux projets démarrés avec Cockpit. Or beaucoup d'apps sont aujourd'hui construites avec une IA par quelqu'un qui n'a pas relu le code : c'est le cas de la v1 de Cockpit (brief §1). Le jour où il faut les faire évoluer, personne ne connaît leurs règles, chaque changement casse quelque chose, et la seule issue est de tout réécrire.

**Reprendre une app** : Cockpit importe un repo construit sans lui, Claude en tire les **règles métier**, l'humain les valide **une par une en regard du code**, puis Claude écrit un test par règle validée. L'app entre ensuite dans la boucle normale, comprise et protégée.

C'est la fonctionnalité qui distingue Cockpit. En octobre 2026, l'extraction de règles avec validation humaine existe pour moderniser du COBOL ([AgentModernize](https://arxiv.org/html/2605.17535v1), [codetospec](https://github.com/StevenACoffman/codetospec), [EvolveWare](https://evolveware.com/agile-business-rules-extraction/)) ; les outils de documentation (DeepWiki, Code Wiki) décrivent le code sans le faire valider ni le tester ; Kiro et Spec Kit partent d'une nouvelle spécification. Aucun ne reprend une app récente pour continuer à la développer.

## Les choix

| # | Question | Décision |
|---|---|---|
| A | Où vit une règle ? | **Un critère d'acceptation** d'une US. Une fonctionnalité de l'app = un ticket « Reprise : … », ses règles = les critères de ses US. Les tables, la validation, les runs et le Kanban existants servent tels quels |
| B | Comment distinguer une US de reprise ? | Une colonne `kind` sur `user_stories` : `feature` (par défaut) ou `takeover` (`CHECK`). Elle change ce que fait le run (choix E) |
| C | Comment l'humain sait-il d'où vient une règle ? | **Chaque règle cite le code** que Claude a lu : fichier, lignes, commit. **Cockpit vérifie la citation sur GitHub** avant d'accepter la règle |
| D | Que peut répondre l'humain ? | Pour chaque règle : **C'est voulu**, **C'est un bug**, **Modifier**, **Plus tard** (voir l'écran) |
| E | Que fait le run d'une US de reprise ? | `/dev-us` en mode **« figer l'existant »** : le test-writer écrit un test par règle, qui doit **passer tout de suite**, et aucun fichier de l'app n'est modifié. Un test qui échoue veut dire que la règle est fausse : le critère est `failed` et le verdict « à vérifier » |
| F | Combien de règles à la fois ? | **Fonctionnalité par fonctionnalité**, en commençant par celles qu'on veut faire évoluer. Une reprise n'a pas à couvrir toute l'app |

## L'écran de reprise

Le doute principal est : « cette règle, Claude l'a-t-il vraiment lue dans le code, ou l'a-t-il inventée ? ». L'écran met donc **côte à côte** le code que Claude a lu et la règle qu'il en a tirée, pour que l'humain juge sur pièce.

```
┌─ Reprise · GestionProjet · Connexion ─────────────────────────────── Règle 3 sur 12 ─┐
│ CODE LU PAR CLAUDE                           │ RÈGLE TROUVÉE                          │
│ [login.ts]  [lockout.ts]                     │                                        │
│ src/auth/login.ts · lignes 18 à 24 · a1b2c3d │ Étant donné un compte bloqué           │
│                                              │ Quand son propriétaire se connecte     │
│   16   const user = await findUser(email)    │ Alors il voit « Compte bloqué » et     │
│   17                                         │       n'est pas connecté               │
│ ▌ 18   if (user.lockedAt) {                  │                                        │
│ ▌ 19     return c.json(                      │ POURQUOI CLAUDE LE PENSE               │
│ ▌ 20       { error: "Compte bloqué" },       │ « La ligne 18 arrête la connexion dès  │
│ ▌ 21       403,                              │ que lockedAt est rempli, avant la      │
│ ▌ 22     )                                   │ vérification du mot de passe. »        │
│ ▌ 23   }                                     │                                        │
│ ▌ 24   await checkPassword(user, password)   │ [   C'est voulu   V   ]                │
│   25                                         │  C'est un bug  B · Modifier  M ·       │
│                                              │  Plus tard  P                          │
│ Voir sur GitHub ↗                            │                                        │
└──────────────────────────────────────────────┴────────────────────────────────────────┘
```

### À gauche : le code lu par Claude

- **Un onglet par extrait** quand la règle vient de plusieurs endroits (le contrôle côté serveur et le message côté page, par exemple).
- L'en-tête dit **quel fichier, quelles lignes et quel commit** : c'est le code tel que Claude l'a lu, même si le repo a changé depuis.
- Les lignes citées sont **surlignées en violet** (la couleur de Claude, 003), avec quelques lignes de contexte avant et après, non surlignées.
- **« Voir sur GitHub »** ouvre le lien permanent du commit sur ces lignes (`…/blob/a1b2c3d/src/auth/login.ts#L18-L24`), pour lire le reste du fichier.
- Le code est **relu sur GitHub à l'affichage**, au commit cité ; Cockpit n'en garde pas de copie (principe n° 6 du brief).

### À droite : la règle et les choix

- La règle en **Étant donné / Quand / Alors**, en français.
- **« Pourquoi Claude le pense »** : une ou deux phrases qui relient la règle aux lignes citées. C'est ce qui permet de vérifier le raisonnement, pas seulement le résultat.
- Les choix, avec **une seule action principale** (règle 2 de 003) :

| Choix | Touche | Effet |
|---|---|---|
| **C'est voulu** (bouton corail) | `V` | La règle est retenue ; **passe à la suivante** ; « Annuler » pendant 8 s (003) |
| **C'est un bug** | `B` | Crée un ticket « Bug : … » avec la règle et le lien vers le code ; la règle est retirée de l'US ; passe à la suivante |
| **Modifier** | `M` | La règle devient éditable sur place : Claude a vu le bon code mais l'a mal décrit |
| **Plus tard** | `P` | Passe à la suivante sans décider ; la règle reste à trancher |

- L'US ne peut être validée que quand **toutes ses règles sont tranchées**. Tant qu'il en reste, le bouton de validation dit lesquelles (règle 5 de 003).
- `J` / `K` passent d'une règle à l'autre, comme ailleurs (003).
- **En largeur téléphone**, la règle passe au-dessus et le code se replie sous elle (« Voir le code lu par Claude ») ; à maquetter avec les autres gestes mobiles (point ouvert 4 de 003).

## Modèle de données

- Sur `user_stories` : `kind` (`feature` ou `takeover`, `CHECK`, `feature` par défaut).
- Sur `acceptance_criteria` : `reasoning`, le « pourquoi Claude le pense », vide pour une US ordinaire.
- Une table **`criterion_sources`**, un extrait de code cité par une règle :

| Colonne | Rôle |
|---|---|
| `id` | Identifiant |
| `criterion_id` | Le critère, en `ON DELETE CASCADE` : un extrait n'a pas de sens sans sa règle |
| `position` | L'ordre des onglets |
| `path` | Le fichier, depuis la racine du repo |
| `start_line`, `end_line` | Les lignes citées, `start_line <= end_line` (`CHECK`) |
| `commit_sha` | Le commit lu par Claude |

## Outils MCP

| Outil | Demande | Fait | Refus |
|---|---|---|---|
| `create_takeover_stories` | `project_id`, le **titre de la fonctionnalité**, `commit_sha`, et des US comme pour `create_user_stories` (004), dont **chaque critère** porte un `reasoning` et **au moins un extrait** (`path`, `start_line`, `end_line`) | Crée le ticket « Reprise : <titre> » et toutes ses US (`kind = takeover`, `to_validate`), tout ou rien | Comme `create_user_stories` ; critère sans `reasoning` ou sans extrait ; **commit inconnu sur GitHub, fichier absent à ce commit, ou lignes au-delà de la fin du fichier** |

- **La vérification des citations est le garde-fou central** : Claude ne peut pas citer un fichier ou des lignes qui n'existent pas. Elle ne prouve pas que la règle découle du code ; c'est le rôle de l'écran et de l'humain.
- Le skill **`/reprendre`** (catalogue) liste les fonctionnalités de l'app, demande lesquelles reprendre, puis appelle `create_takeover_stories` une fois par fonctionnalité. Il se lance depuis la page du projet, comme `/dev-us` (005).
- `/dev-us` lit `kind` dans `get_user_story` et passe en mode « figer l'existant » (choix E). Les transitions et les droits ne changent pas (004).

## Conséquences

- **Découpage** : trois tranches après le MVP, dans cet ordre :
  1. `create_takeover_stories` avec vérification des citations, et le skill `/reprendre` ;
  2. l'écran de reprise ;
  3. le mode « figer l'existant » de `/dev-us` et du test-writer.
- **Prérequis** : l'app reprise doit pouvoir lancer des tests en CI. Sinon, le bilan de santé (2.2) le signale, et la CI de départ (brief §6.10) devient le premier pas.
- **Documentation métier** : les règles validées d'un projet, regroupées par fonctionnalité, en forment une, chaque règle avec son test. Aucune table de plus n'est nécessaire.

## Limites connues

- **L'extraction se trompe** : elle oublie des règles et en invente ([COBRAIN](https://dl.acm.org/doi/10.1145/3756681.3756982)). L'écran sert justement à trier ; les règles oubliées ne se voient pas, et c'est la limite principale.
- **Figer l'existant fige aussi les bugs** que l'humain n'aura pas reconnus en validant.
- **Coût** : lire une fonctionnalité entière consomme beaucoup de crédits sur un gros repo. Le choix F le limite.
- **Le contexte autour des lignes citées** peut ne pas suffire : une règle peut dépendre d'une configuration ou d'un fichier non cité. « Voir sur GitHub » est le recours.

## Points ouverts

1. **Granularité** : combien de règles par US ? À fixer en écrivant `/reprendre`, sur la v1 de Cockpit comme premier essai.
2. **Contrôle du mode « figer »** : le reviewer vérifie que la PR ne touche que des tests. Cockpit pourrait le vérifier lui-même sur le diff de la PR ; à décider en tranche 3.
3. **Coloration du code** à gauche : à choisir avec l'écran (tranche 2), sans couleur codée en dur (003).

## Pistes écartées

- **Valider une US de reprise d'un bloc**, comme une US ordinaire : trop grossier, on valide sans regarder le code de chaque règle.
- **Garder une copie du code cité** dans Cockpit : GitHub est la source de vérité, et le commit suffit à retrouver exactement ce que Claude a lu.
- **Accepter les citations sans les vérifier** : un extrait inventé rendrait l'écran trompeur, alors qu'il est fait pour lever le doute.
- **« Je ne sais pas » qui demande une explication à Claude depuis Cockpit** : Cockpit n'appelle jamais Claude, c'est Claude qui vient à lui par le MCP. Le « pourquoi » est donc écrit dès l'extraction, et « Plus tard » laisse le temps de lire le code.
- **Un vrai diff ou un éditeur à gauche** : il n'y a rien à comparer, seulement du code à lire.
