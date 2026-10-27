---
name: brief-prospect
description: Prépare la fiche d'un rendez-vous avec un prospect (premier ou deuxième rendez-vous, client pas encore gagné) - lecture du CRM de prospection, six recherches en parallèle chacune par son agent Sonnet (profil et couleur de l'interlocuteur, y compris ses interventions publiques, signal déclencheur, enjeux du secteur, fournisseur en place, LinkedIn de l'entreprise, bourse), stratégie du rendez-vous au ton de l'interlocuteur (raison de se revoir, entonnoir en six temps, déroulé minuté, objections, conclusion avec échelle de suites), fiche lisible en 30 secondes (« En un coup d'œil », trois rubriques, détail replié) et version audio, puis « Brief préparé » = Oui dans le CRM de prospection. USE WHEN « prépare mon premier rendez-vous chez X », « brief RP003 », « fiche prospect », rendez-vous dont l'identifiant commence par RP. NOT FOR un client déjà dans le CRM clients (skill brief-visite).
---

# Préparer un rendez-vous avec un prospect

But : qu'en appliquant simplement la fiche, le commercial reparte avec un **rendez-vous suivant daté**. Méthode : `docs/prospection_conception.md` (Enzo Colucci, SPIN, entonnoir, 13 critères de qualification).

Tout se lance depuis la racine du projet. Python : `.venv/bin/python`. Date de référence : `meta.date_reference` du dossier, pas la date système. Règles d'écriture : `CLAUDE.md` (zéro jargon, zéro identifiant à l'écran, ne rien inventer, jamais de tiret cadratin).

Tes courts messages de progression s'affichent en direct au commercial dans l'onglet « Workflow » : écris-les comme à un collègue commercial, à la première personne, sans mot technique. Exemple : « Je regarde comment s'exprime Claire Vasseur pour trouver le bon ton », « Je cherche ce qui se passe en ce moment chez Hermès », « Je prépare vos questions pour trouver le vrai problème ».

## Étapes

**1. Lire le CRM de prospection**
```
.venv/bin/python scripts/extraire_prospect.py --rdv RP003
```
Lire `sorties/dossiers/<base>_dossier.json` en entier (`<base>` est donné dans la sortie, ex. `RP003_hermes`). Points clés : `funnel` (étape), `criteres_a_viser` (ce qu'il faut obtenir pendant ce rendez-vous), `comptes_rendus_precedents`, `references_clients`, `creneaux_proposes`, et `rendez_vous.heure_debut` / `heure_fin` (la **durée réelle** du rendez-vous). Repérer aussi si les notes ou comptes rendus disent que l'interlocuteur a **demandé des chiffres** ou un cas client chiffré.

**2. Les recherches : un agent Sonnet par recherche, tous dans le même message, au premier plan** (`run_in_background: false`)

Tu ne fais jamais une recherche toi-même (ni `cours_bourse.py`, ni `linkedin_entreprise.py`, ni `linkedin_profil.py`, ni WebSearch, ni WebFetch) et tu ne regroupes jamais deux recherches dans un même agent : l'application le refuse. Ne lance que les agents demandés par les options.

| Brique | Agent | Ce qu'il reçoit |
|---|---|---|
| Profil de l'interlocuteur (couleur) | `profil-interlocuteur` | prénom, nom, poste et entreprise de `interlocuteur_rdv`, son « Profil LinkedIn » s'il est renseigné, `<base>` |
| Signal déclencheur | `veille-signal` | nom, site web, période : 3 mois avant la date de référence |
| Enjeux du secteur | `enjeux-secteur` | nom, secteur et sous-secteur, site web, période : 12 mois avant la date de référence |
| Fournisseur en place et concurrence | `fournisseurs-concurrence` | nom, site web, période : 24 mois avant la date de référence |
| Page LinkedIn de l'entreprise | `linkedin-entreprise` | nom, `<base>` |
| Bourse | `cours-bourse` | nom, code bourse, `<base>` (seulement si le code bourse est renseigné) |

**Profil de l'interlocuteur** : si `interlocuteur_rdv` a déjà une « Couleur » dans le CRM (notée après un rendez-vous), ne lance pas l'agent : cette couleur fait foi. Sinon, l'agent rend une couleur **probable**, avec sa confiance et ses indices.

Ne transmets aux agents aucune autre donnée du CRM (notes, critères, autres interlocuteurs).

**3. Compiler**

- Écris la réponse de l'agent `profil-interlocuteur` (ou la couleur déjà connue, avec `"source": "CRM"`) dans `sorties/briefs/<base>_profil.json`.
- Écris les réponses de `veille-signal`, `enjeux-secteur` et `fournisseurs-concurrence`, sans les faits sans date ou sans URL, dans `sorties/briefs/<base>_veille.json` (liste de trois objets).
- Puis :
```
.venv/bin/python scripts/compiler_sources.py --base <base>
```

**4. La stratégie du rendez-vous** : écrire `sorties/briefs/<base>_strategie.json` (outil Write), selon `modele_fiche_prospect.md` partie « Stratégie ». C'est le cœur de la fiche. **La couleur de l'interlocuteur fixe le ton de tout le reste** : l'accroche, la phrase d'ouverture, la formulation des questions, les réponses aux objections, la phrase de conclusion et le **format du livrable promis** sont écrits pour cette couleur. L'ordre de travail :
1. **La raison de se revoir** : un livrable promis pour le prochain rendez-vous, construit à partir d'un enjeu du secteur et de ce que le prospect dira, repris dans le titre de l'invitation. Sans elle, le prospect n'a aucune raison de revenir.
2. **Une hypothèse principale** (celle qui vient du CRM ou des mots du prospect, sinon l'enjeu du secteur le plus net) avec son entonnoir en six temps : situation, problème, implication (« Qui d'autre chez vous le ressent ? »), chiffrage, gain (« Si c'était réglé, que pourriez-vous faire d'autre ? »), reformulation validée. Deux hypothèses en réserve, une question chacune. Trois questions d'urgence et de priorité, une question d'enjeu personnel.
3. **Un déroulé minuté** calé sur la durée réelle (heure de fin moins heure de début ; 45 minutes par défaut, et le dire), avec un point d'étape aux deux tiers.
4. **Le signal** : s'il est de niveau groupe et non de l'entité rencontrée, le dire honnêtement et proposer une accroche franche, jamais une accroche passe-partout.
5. **La preuve** : si le CRM indique que l'interlocuteur a demandé des chiffres et qu'aucun cas chiffré n'existe dans `references_clients`, l'écrire dans `a_preparer_avant` (« à préparer avant le rendez-vous »). On n'invente jamais un chiffre.
6. Le fournisseur en place, les questions pour les critères à viser, les objections (dont les trois de sortie) et réponses, les questions miroir.
7. **La conclusion** : résumé que le prospect valide, échelle de suites A (décideur), B (interlocuteur, pour présenter le livrable), C (petit engagement), la question « Qui devrait voir ça, et que lui faudrait-il pour décider ? », puis les deux créneaux.

**5. Rédiger la fiche écrite** dans `sorties/briefs/<base>_fiche.md`, au **format imposé** décrit dans `modele_fiche_prospect.md` (partie « Fiche ») : « En un coup d'œil », « 1. Les questions clés », « 2. Si on vous dit... », « 3. Conclure », puis « Pour aller plus loin ». Respecter exactement ces titres et cette structure : le rendu en dépend. Partie visible de **350 mots au maximum**, une idée par ligne, pas de chaîne de flèches, phrases de 20 mots au maximum. Tout le détail (déroulé minuté, pourquoi maintenant, qui décide, fournisseur en place, miroirs et preuve, CRM, données manquantes, sources web) va dans « Pour aller plus loin ». Si ça déborde, déplacer le détail en bas, jamais couper la couleur, la raison de se revoir ni la conclusion. Chaque information du CRM finit par (CRM), chaque information d'internet par (Web, média, date) ou (LinkedIn, date) ou (Bourse, Yahoo Finance), en fin de ligne. Une douleur probable est une **hypothèse**, écrite comme telle. Le bandeau « À préparer avant », s'il y en a un, se place juste sous la ligne du rendez-vous, avant « En un coup d'œil ».

**6. Rédiger la version à écouter** selon `modele_fiche_prospect.md` (partie « Version à écouter », même ordre que la fiche) dans `sorties/briefs/<base>_audio.txt`. 250 à 320 mots, texte brut.

**7. Produire la page imprimable et l'audio**
```
.venv/bin/python scripts/rendre_fiche.py --base <base>
```

**8. Noter dans le CRM de prospection que la fiche est prête**
```
.venv/bin/python scripts/ecrire_crm_prospection.py --brief-prepare RP003
```
Seule écriture de ce skill. Vérifier que le statut est `ok` ou `deja_fait`.

**9. Répondre** en trois lignes, en langage commercial : la fiche est prête, ce qu'il faut obtenir pendant ce rendez-vous, le livrable promis pour se revoir et la phrase pour décrocher le suivant (et, s'il y en a un, ce qu'il faut préparer avant).
