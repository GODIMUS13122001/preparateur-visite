# Le funnel commercial du Préparateur de visite

22/10/2026. État de ce qui est **construit** dans l'application, relevé dans le code. La conception d'origine est dans `prospection_conception.md` (15/10/2026).

Périmètre : la **prospection** (client pas encore gagné). Les rendez-vous dont l'identifiant commence par `RP` passent par ce funnel ; les clients existants restent dans le CRM clients.

## 1. Les étapes

```
Lead ──► Rendez-vous obtenu ──► Découverte faite ──► Qualifié ──► CRM clients
  │              │                     │
  └──────────────┴─────────────────────┴──► Abandonné (avec le motif)
```

| Étape | Ce qu'elle veut dire | Condition de passage |
|---|---|---|
| **Lead** (affiché « Contact repéré » dans l'appli) | Un prospect repéré, souvent grâce à un signal (recrutement, nouveau dirigeant, investissement) | Un premier rendez-vous est fixé |
| **Rendez-vous obtenu** | Le premier rendez-vous est dans l'agenda | Les critères 1 à 7 sont obtenus |
| **Découverte faite** | On connaît la situation, le vrai problème et son coût : c'est la cible d'un premier rendez-vous | Les 13 critères sont obtenus, ou marqués « sans objet » |
| **Qualifié** | Le prospect est mûr | Il passe au CRM clients |
| **Abandonné** | Arrêt, toujours avec le motif | - |

Source : `scripts/generer_crm_prospection.py` (`ETAPES`), onglet « Paramètres » du CRM de prospection.

## 2. Les 13 critères de qualification

Fusion sans doublon de BANT, CHAMP, ANUM, FAINT, MEDDIC, MEDDPICC, SPICED et GPCTBA/C&I, pour rester valable quel que soit le secteur.

| N° | Critère | Quand on l'obtient |
|---|---|---|
| 1 | Situation | 1er rendez-vous |
| 2 | Problème réel | 1er rendez-vous |
| 3 | Impact chiffré | 1er rendez-vous |
| 4 | Objectif et gain attendu | 1er rendez-vous |
| 5 | Urgence et échéance | 1er rendez-vous |
| 6 | Priorité | 1er rendez-vous |
| 7 | Fournisseur en place et concurrence | 1er rendez-vous |
| 8 | Décideur économique | Ébauché au 1er, confirmé ensuite |
| 9 | Processus de décision | Ébauché au 1er, confirmé ensuite |
| 10 | Champion | Rendez-vous suivants |
| 11 | Budget | Rendez-vous suivants |
| 12 | Critères de choix | Rendez-vous suivants |
| 13 | Processus d'achat | Rendez-vous suivants |

Chaque critère porte un **statut** (À obtenir, Partiel, Obtenu, Sans objet), la **phrase qui le prouve** et une date. « Sans objet » neutralise un critère qui ne compte pas dans un secteur (le processus d'achat formel d'une PME, par exemple) sans le supprimer de la grille.

## 3. Où le funnel vit dans le CRM de prospection

Fichier Excel séparé du CRM clients.

| Onglet | Ce qui sert au funnel |
|---|---|
| Prospects | Colonne « Étape du funnel », signal déclencheur, fournisseur en place, origine du contact |
| Critères | Une ligne par prospect et par critère : N°, statut, preuve, date |
| Interlocuteurs | Rôle dans la décision (acheteur économique, évaluateur technique, utilisateur, champion possible) et couleur de personnalité |
| Paramètres | Les étapes et leurs règles de passage |

Lecture : `scripts/crm_prospection.py`, méthode `avancement()`. Elle renvoie l'étape, le score de découverte (critères 1 à 7 obtenus ou sans objet) et le score de qualification (sur 13).

## 4. Où le funnel apparaît dans l'application

- **Carte du prospect** (écran Journée) : une jauge de 7 barres, une par critère du premier rendez-vous, et la mention « N questions sur 7 déjà éclaircies ». Couleurs : vert = obtenu, demi-lilas = partiel, lilas = à obtenir, gris = sans objet.
- **Avant de préparer** : la frise des étapes (faites en vert, étape en cours en violet), puis « À obtenir pendant ce rendez-vous », avec une icône par statut (coche, demi-disque, cercle vide, tiret) pour ne pas dépendre de la seule couleur.
- **Préparation en cours** (bloc CRM) : « Rendez-vous obtenu · 2 critères sur 7 déjà obtenus », puis la liste des critères à obtenir.

Code : `app/web/src/pages/Journee.tsx` (`JaugeProspect`, `CriteresProspect`), `app/execution.py`.

## 5. Comment la fiche s'en sert (skill `brief-prospect`)

Le funnel fixe **l'objectif du rendez-vous** : la fiche ne prépare des questions que pour les critères encore à obtenir.

1. **L'objectif du jour** : l'étape actuelle, les critères à obtenir et la prochaine étape à verrouiller.
2. **L'entonnoir de questions** sur l'hypothèse principale, en six temps : situation, problème, implication (« Qui d'autre chez vous le ressent ? »), chiffrage, gain (« Si c'était réglé, que pourriez-vous faire d'autre ? »), reformulation que le prospect valide. L'entonnoir donne la forme, SPIN donne le fond.
3. **Les objections** traitées selon la méthode AÏE (accepter, isoler, explorer), dont les trois objections de sortie.
4. **La conclusion** : le résumé validé par le prospect, puis une échelle de suites (A : rencontrer le décideur, B : revoir l'interlocuteur pour présenter le livrable promis, C : un petit engagement), et deux créneaux réels pris dans l'agenda du commercial.

Objectif posé par Antoine : qu'en appliquant la fiche, le commercial reparte avec un **rendez-vous suivant daté**.

## 6. Ce qui n'est pas encore construit

- **La mise à jour du funnel après la visite.** La conception prévoit que le compte rendu propose, à valider : les critères obtenus avec leur preuve, la nouvelle étape, le test du champion, et un signal si deux rendez-vous passent sans nouveau critère. Aujourd'hui, la seule écriture dans le CRM de prospection est « Brief préparé = Oui » (`scripts/ecrire_crm_prospection.py`). Les statuts des critères et l'étape se mettent donc à jour à la main dans l'Excel.
- **Écart de documentation** : `prospection_conception.md` décrit un entonnoir en cinq temps. Le skill applique six temps depuis l'audit du 16/10 (ajout de l'implication et du gain).
