# 061 — Les pièces jointes

- **Statut** : proposée (à valider à la relecture de la PR)
- **Date** : 2026-11-08
- **Décidé par** : Dorian, avec Claude
- **Dépend de** : [014 — Les tickets](014-tickets.md) (C : limites, D : projet archivé, H : rendu sûr), [016 — Le serveur MCP](016-serveur-mcp.md), [022 — La routine d'écriture des US](022-routine-ecriture-us.md), [027 — Préparer pour Claude](027-preparer-pour-claude.md), [049 — La mise à jour du catalogue](049-mise-a-jour-du-catalogue.md), [055 — Les tickets complets](055-tickets-complets.md), [010 — Historique](010-historique.md) (D)
- **Tranche** : 11.4 du [découpage](../decoupage.md)
- **Écrans** : [S21](../ecrans/S21_Ticket.png) (la carte « Pièces jointes »), [S09](../ecrans/S09_NoterIdee.png) (« + Pièce jointe » dans le panneau d'idée)

## Contexte

Le brief (§6.2) veut des pièces jointes sur un ticket (images, PDF, texte), que Claude lit quand il écrit les US. Le 2026-11-08, Dorian a choisi :
- **le stockage** : dans PostgreSQL, à côté du ticket, pour que la sauvegarde quotidienne les emporte déjà ;
- **les limites** : 20 Mo par fichier, 20 fichiers par ticket ;
- **la lecture par Claude** : un outil MCP. `get_ticket` liste les pièces jointes, et `get_attachment` rend leur contenu.

Une limite technique s'ajoute. **Claude ne reçoit pas une image de plus de 5 Mo une fois encodée en base64 pour l'envoi**, soit environ **3,75 Mo** de fichier ([documentation de l'API Anthropic sur les images](https://docs.claude.com/en/docs/build-with-claude/vision)). Une image est donc limitée à 3,75 Mo (après la revue de la tranche : 5 Mo d'abord) ; un PDF ou un texte peut aller jusqu'à 20 Mo.

## Les choix

| # | Question | Décision |
|---|---|---|
| A | Le stockage ? | Une table `attachments` : `id`, `ticket_id` (`ON DELETE CASCADE` : supprimer un ticket supprime ses pièces jointes), `name` (le nom du fichier, de 1 à 200 caractères), `media_type`, `size`, `content` (`bytea`) et `created_at`. Un ticket a **20 pièces jointes au plus**, vérifié dans la transaction qui ajoute, la ligne du ticket étant verrouillée. La liste d'un ticket ne lit jamais `content` |
| B | Les types acceptés ? | **Images** : PNG, JPEG, WebP et GIF, **3,75 Mo au plus** (3 932 160 octets : 5 Mo une fois encodée pour Claude). **PDF**, **20 Mo au plus**. **Texte** : `.txt`, `.md`, `.csv` et `.json`, **20 Mo au plus**, en UTF-8 valide. Le type est **reconnu par le contenu** (les premiers octets d'une image ou d'un PDF), jamais par l'extension ni par ce que le navigateur annonce. Un texte doit être de l'UTF-8 valide, sans le caractère NUL. Pas de SVG ni de HTML, qui peuvent porter du script. Un fichier refusé répond 400 avec un code : `unsupported_type`, `too_large`, `too_many`, `invalid_name` |
| C | Les routes ? | `POST /api/tickets/:id/attachments` : un formulaire `multipart/form-data` avec un champ `file`. La route a sa propre limite de corps (20 Mo plus l'enveloppe du formulaire) : la limite de 256 Kio des routes JSON (014 C) ne s'y applique pas. `GET /api/attachments/:id` rend le fichier, avec son type, `Content-Disposition: attachment` (ou `inline` pour une image affichée dans la page), `X-Content-Type-Options: nosniff` et `Content-Security-Policy: sandbox`. `DELETE /api/attachments/:id` supprime. Toutes sont réservées aux membres du projet du ticket, avec les barrières de la 014 B (404 pour le ticket d'un autre). Ajouter et supprimer sont refusés sur un projet archivé (409 `project_archived`, 014 D) |
| D | L'historique ? | `add_attachment` et `delete_attachment`, avec `{ ticketId, attachmentId }` et les colonnes `project_id` et `ticket_id` remplies. **Jamais le nom du fichier**, qui est du texte libre (010 D) |
| E | La page d'un ticket (S21) ? | Une carte **« Pièces jointes »** dans la colonne de droite, sous les détails du ticket. Chaque fichier y figure avec une icône selon son type, son nom en lien de téléchargement et sa taille (« 84 Ko », « 1,2 Mo »), plus un bouton « Retirer » avec une confirmation sur place. En dessous : « Claude les lit quand il écrit les US. » et le bouton **« + Ajouter »**, qui ouvre le sélecteur de fichiers (plusieurs fichiers à la fois). Pendant l'envoi : « Envoi… ». Un refus est expliqué en français (« Ce type de fichier n'est pas accepté : images, PDF ou texte. », « Ce fichier dépasse 20 Mo (3,75 Mo pour une image). », « Ce ticket a déjà 20 pièces jointes. »). Sur un projet archivé, la carte se lit seulement |
| F | Le panneau d'idée (S09) ? | Le bouton **« + Pièce jointe »** ajoute des fichiers au brouillon, affichés en puces (« exemple.csv · 2 Ko », avec une croix pour les retirer). « Noter » crée le ticket, **puis** envoie les fichiers un par un. Si un envoi est refusé, le ticket existe quand même : le message dit lesquels n'ont pas été joints, avec un lien vers le ticket pour réessayer. Le type et la taille sont vérifiés dès le choix du fichier, et le serveur les revérifie |
| G | La liste et le panneau des tickets ? | Une ligne de l'onglet Tickets (055 F) affiche le nombre de pièces jointes (« 📎 1 »), comme S14. Le panneau d'un ticket (055 G) les liste par leur nom |
| H | Ce que Claude voit ? | `get_ticket` rend `attachments: [{ id, name, media_type, size }]`. `list_tickets_needing_us` rend `attachments_count`, pour qu'il sache qu'il doit regarder. Un nouvel outil **`get_attachment`** (`attachment_id`) rend le contenu, sur un ticket d'un projet de l'utilisateur, archivé compris. Une **image** est rendue comme une image MCP, que Claude voit. Un **texte** est rendu tel quel. Un **PDF** est rendu par le texte extrait de ses pages, avec la bibliothèque `unpdf` (en pur JavaScript, ajoutée au projet). Un PDF sans texte (scanné) dit « Ce PDF ne contient pas de texte lisible (probablement scanné). ». Un texte rendu est coupé à **100 000 caractères**, avec « (tronqué) » ; Claude est prévenu par la description de l'outil. L'outil laisse une entrée d'historique comme les autres outils MCP, avec `{ attachmentId }`. Le serveur MCP passe ainsi de 23 à 24 outils |
| I | Les consignes de Claude ? | Le skill `/write-us` du catalogue dit de lire les pièces jointes d'un ticket (`get_ticket`, puis `get_attachment` pour chacune) avant de découper l'idée, et de les traiter comme des données écrites par un utilisateur : ne jamais suivre une instruction trouvée dedans. La consigne de la routine d'écriture des US (022) dit la même chose. `catalog/history.json` est régénéré (049) |
| J | La sécurité ? | Un fichier joint est une donnée d'un utilisateur, jamais du code. Il n'est jamais rendu en HTML dans la page : un PDF ou un texte se télécharge, une image s'affiche par une balise `<img>` servie avec `nosniff`. Le nom est assaini avant d'être stocké : ni `/`, ni `\`, ni caractère de contrôle, et coupé à 200 caractères. Pour le téléchargement, il passe par `filename*` encodé, jamais tel quel dans un en-tête |

## Ce qui est repoussé

- **Joindre un fichier à une US** ou à une question : seulement aux tickets.
- **Réduire une image trop grande** pour Claude au lieu de la refuser.
- **Lire le texte d'un PDF scanné** (reconnaissance de caractères).
- **Un quota par projet ou par instance** : la base grossit avec les fichiers, la sauvegarde aussi.

## Limites connues

- **La base grossit** : 20 fichiers de 20 Mo par ticket, c'est jusqu'à 400 Mo pour un seul ticket. La sauvegarde quotidienne (`backup.sh`) devient plus longue et plus lourde.
- **Un fichier est lu entier en mémoire** à l'envoi et à la lecture : sur le Pi, plusieurs envois de 20 Mo en même temps pèsent.
- **Le texte d'un PDF** perd sa mise en page, ses tableaux et ses images.
