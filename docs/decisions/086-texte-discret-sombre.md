# 086 — Le texte discret du thème sombre se lit (ticket #44)

- **Statut** : proposée (à valider à la relecture de la PR) ; le code est construit
- **Date** : 2026-11-20
- **Décidé par** : Dorian (ticket #44 : « les libellés de la barre latérale se lisent mal en thème sombre »), avec Claude
- **Dépend de** : [045 — Interface quatre temps](045-interface-quatre-temps.md) (B), [073 — Ergonomie](073-ergonomie.md) (G)
- **Modifie** : 045, choix B (la valeur sombre de `ink-dim`, `--color-dim`)

## Le choix

| Question | Décision |
|---|---|
| Le texte discret du thème sombre | `--color-dim` passe de `#6f7787` à `#838b9b` (thème sombre seulement ; le clair est inchangé). Le rapport de contraste atteint 4,5:1 (WCAG 1.4.3, AA) sur le fond de page, la carte et le fond surélevé. Le texte reste plus discret que `--color-muted-foreground` |
| La garde | `Contrast.test.ts` vérifie aussi le thème sombre : `dim` sur `background`, `card` et `raised`, et `dim` plus discret que `muted-foreground` |

La 045 B garde sa valeur d'origine pour l'historique ; le code fait foi. Les maquettes de `docs/ecrans/` gardent l'ancienne valeur.
