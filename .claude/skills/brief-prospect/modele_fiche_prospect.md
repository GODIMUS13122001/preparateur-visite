# Modèle de fiche prospect

Le but n'est pas de vendre : c'est de **trouver le vrai problème** et de **repartir avec un rendez-vous suivant daté**, pour lequel le prospect a une raison de revenir. Le prospect parle 70 % du temps : la fiche prépare des questions, pas un discours. On parle de son problème, jamais de nos avantages.

Règles :
- Ne rien inventer, jamais un chiffre. Ce qui n'est ni dans le CRM, ni dans une source datée, est une **hypothèse** et se dit comme telle (« probablement », « à vérifier »).
- La couleur de l'interlocuteur vient du CRM si elle y est (ressenti noté après un rendez-vous), sinon de l'agent `profil-interlocuteur`. Elle est toujours présentée avec sa source et, si elle vient du profil, comme **probable, à confirmer pendant le rendez-vous**. Sans couleur, ton neutre, et on le dit.
- Rien sur la vie personnelle de l'interlocuteur : seulement son style et ses sujets professionnels.
- Le ton suit la couleur. **Rouge** : droit au but, résultats et décisions, phrases courtes, respecter le temps annoncé. **Jaune** : chaleur, échanges, histoires de clients, laisser parler. **Vert** : calme, rassurer, accompagnement et durée, ne pas presser. **Bleu** : précision, chiffres, méthode, preuves écrites, pas de superlatifs.
- Les phrases à dire sont courtes, au présent, en français parlé.
- Deuxième rendez-vous ou plus : partir du compte rendu précédent, ne jamais reposer une question dont la réponse est déjà dans le CRM.
- **La fiche se lit en 30 secondes** : la partie visible tient en 350 mots, le détail est replié dans « Pour aller plus loin ». Une hypothèse principale, deux en réserve réduites à une question. Une ligne par objection.

## Stratégie (fichier `<base>_strategie.json`)

Les clés `signal`, `douleurs`, `objections`, `conclusion` sont lues par l'application : ne pas les renommer.

```json
{
  "interlocuteur": {"couleur": "rouge | jaune | vert | bleu | null", "source": "CRM | profil LinkedIn | publications publiques", "confiance": "forte | moyenne | faible", "indices": ["..."],
                    "ton": {"a_faire": ["..."], "a_eviter": ["..."]}, "a_verifier_pendant": "un signe à observer pour confirmer ou corriger la couleur",
                    "format_livrable": "forme du livrable promis, selon la couleur"},
  "objectif": {"etape_actuelle": "...", "etape_visee": "...", "criteres_a_obtenir": ["..."], "a_verrouiller": "le rendez-vous suivant, avec qui et pour quoi"},
  "a_preparer_avant": ["seulement si besoin, ex. : cas chiffré du secteur à trouver, il a demandé des chiffres (CRM)"],
  "signal": {"fait": "...", "source": "...", "date": "AAAA-MM-JJ", "url": "...", "niveau": "entreprise | groupe | aucun", "accroche": "phrase à dire"},
  "raison_de_se_revoir": {"livrable": "ce qu'on promet d'apporter la prochaine fois", "construit_a_partir_de": "enjeu du secteur + ce que le prospect dira (à compléter en rendez-vous)", "phrase": "phrase pour le promettre", "titre_invitation": "reprend le livrable"},
  "ouverture": "phrase de cadre : objectif, durée, déroulé, accord sur la suite en fin de rendez-vous",
  "deroule": {"duree_minutes": 45, "source_duree": "heure de début et de fin du dossier | par défaut",
              "etapes": [{"minutes": "0-5", "titre": "Cadre", "contenu": "..."}], "point_etape": "phrase aux deux tiers de la durée"},
  "douleurs": [
    {"role": "principale | reserve", "hypothese": "ce qui bloque, puis ce que ça coûte", "pourquoi_on_le_pense": "CRM ou mots du prospect, sinon secteur",
     "entonnoir": {"situation": "...", "probleme": "...", "implication": "Qui d'autre chez vous le ressent ?", "chiffrer": "...", "gain": "Si c'était réglé, que pourriez-vous faire d'autre ?", "reformuler": "« Si je vous suis, le vrai sujet c'est... Je me trompe ? »"}}
  ],
  "urgence": ["Pourquoi maintenant plutôt que dans six mois ?", "Où ça se place parmi vos priorités ?", "Qu'est-ce qui arrive si rien ne change d'ici la fin de l'année ?"],
  "enjeu_personnel": "question adaptée à la couleur, sur ce que ça change pour lui ou son équipe",
  "questions_criteres": [{"critere": "Décideur économique", "question": "..."}],
  "decision": {"roles_connus": ["..."], "questions": ["Expliquez-moi comment ce genre de décision se prend chez vous, étape par étape.", "Qui devrait voir ça, et que lui faudrait-il pour décider ?"]},
  "fournisseur_en_place": {"connu": "...", "questions": ["..."]},
  "objections": [{"objection": "...", "famille": "temps | prix | intérêt | concurrence | pouvoir | sortie", "accepter": "...", "isoler": "...", "explorer": "..."}],
  "miroirs": [{"question_probable": "...", "miroir": "...", "puis_repondre": "..."}],
  "preuve": {"reference": "client du même secteur (references_clients)", "a_confirmer": true, "chiffre_disponible": false, "phrase": "..."},
  "conclusion": {"resume_a_valider": "« Voilà ce que j'ai compris : ... C'est bien ça ? »", "phrase": "...", "echelle": {"A": "rendez-vous avec le décideur", "B": "rendez-vous avec l'interlocuteur pour présenter le livrable", "C": "petit engagement"},
                 "question_decideur": "Qui devrait voir ça, et que lui faudrait-il pour décider ?", "creneaux": ["...", "..."], "titre_invitation": "titre orienté problème et livrable, pas « point commercial »"}
}
```

Règles de contenu :
- **Raison de se revoir** : un livrable précis et utile même sans achat (une grille des exigences du secteur appliquée à ses produits, un chiffrage à partir de SES chiffres, une comparaison). Il naît d'un enjeu du secteur (agent `enjeux-secteur`) et se complète avec ce que le prospect dira. Son format suit la couleur : **bleu** chiffres écrits et méthode, **rouge** une page de résultats, **jaune** un exemple vivant et une courte rencontre, **vert** un plan d'accompagnement simple et rassurant. Le titre de l'invitation le reprend.
- **Hypothèses** : la principale vient du CRM (notes, compte rendu, besoin noté) ou des mots du prospect ; sinon, de l'enjeu du secteur le plus net. Deux en réserve, une question chacune pour basculer si la première tombe.
- **Entonnoir en six temps** pour l'hypothèse principale : situation (une seule question, jamais ce qui est dans le CRM), problème, implication, chiffrage, gain, reformulation validée.
- **Urgence** : trois questions (pourquoi maintenant, priorité, coût de l'inaction). **Enjeu personnel** : une question, posée seulement si la confiance est installée, jamais intrusive.
- **Déroulé minuté** : la durée est `heure_fin` moins `heure_debut` du dossier. Si l'un manque, 45 minutes et le dire. Découpage proportionnel : cadre environ 10 %, découverte 55 %, reformulation 22 %, suite 13 %. Pour 45 minutes : 0-5 cadre, 5-30 découverte, 30-40 reformulation, 40-45 suite. **Point d'étape aux deux tiers** : « On a fait le tour de [sujet]. Avant de continuer, qu'est-ce qui manque pour que ce soit utile pour vous ? »
- **Preuve** : si le CRM (notes, compte rendu, besoins) montre que l'interlocuteur a demandé des chiffres, `a_preparer_avant` le dit en tête, tant qu'aucun cas chiffré du secteur n'est disponible dans `references_clients`. Ne jamais produire le chiffre soi-même.
- **Signal de niveau groupe** : si le seul signal concerne le groupe et non l'entité rencontrée, `niveau` = `groupe`, `fait` le dit, et l'accroche est franche : « Je n'ai rien vu de précis sur votre entité ; ce que j'ai vu côté groupe, c'est ... Qu'est-ce qui change concrètement chez vous ? » Sans aucun signal : `niveau` = `aucun`, accroche sur l'enjeu du secteur.
- **Objections** : cinq à six, dont les trois de sortie (famille `sortie`) : « envoyez-moi une présentation » (isoler : « Pour qu'elle soit utile, qu'est-ce que vous voudriez y trouver ? », proposer plutôt le livrable), « rappelez-moi dans trois mois » (explorer : « Qu'est-ce qui sera différent dans trois mois ? », fixer une date), « je dois en parler » (explorer : « À qui, et que lui dirons-nous ? », proposer d'être présent).
- Trois miroirs, une question par critère à obtenir. Les deux créneaux viennent de `creneaux_proposes`.

## Fiche (fichier `<base>_fiche.md`)

Format imposé par le responsable : lisible en 30 secondes. On trouve d'un coup d'œil QUI, POURQUOI, QUOI DEMANDER, QUOI RÉPONDRE, COMMENT CONCLURE. Les titres de rubriques et la structure sont un contrat avec le rendu HTML (`rendre_fiche.py`) : ne pas les renommer, ne pas en ajouter, ne pas changer leur ordre.

Règles d'écriture de la fiche :
- Partie visible (tout ce qui précède « Pour aller plus loin », titre compris) : **350 mots au maximum**. Si ça déborde, déplacer dans « Pour aller plus loin », jamais supprimer la couleur, la raison de se revoir ni la conclusion.
- Une idée par ligne. Pas de chaîne de flèches. Phrases de 20 mots au maximum. Les phrases à dire sont entre « ».
- Les mentions de source (CRM), (Web, média, date), (LinkedIn, date), (Bourse, Yahoo Finance) sont gardées, en fin de ligne, seulement là où un fait est affirmé.
- Une douleur probable est une hypothèse, écrite comme telle. Ne rien inventer.

```
# {Prospect} - {premier | deuxième} rendez-vous

{jour date} à {heure} · {durée} min · {lieu ou visio} · avec {Prénom Nom}, {poste}

> **À préparer avant :** {seulement si besoin, 2 points au maximum, une ligne chacun : il a demandé des chiffres (CRM), trouver un cas chiffré du secteur}

## En un coup d'œil
- **Le ton :** {Prénom} est plutôt {rouge | jaune | vert | bleu} ({probable | noté après le dernier rendez-vous | inconnue}) : {consigne de ton en 8 mots maximum}.
- **L'objectif :** {ce qu'il faut obtenir aujourd'hui, une phrase}.
- **Pour ouvrir :** « {accroche, 25 mots maximum} »
- **Pour conclure :** « {phrase de conclusion} » {créneau 1} ou {créneau 2}.

## 1. Les questions clés
**{Hypothèse principale en une ligne}.**
1. « {situation} »
2. « {problème} »
3. « Qui d'autre chez vous le ressent ? »
4. « {chiffrage} »
5. « Si c'était réglé, que pourriez-vous faire d'autre ? »
6. « {reformulation : le vrai sujet, c'est ... Je me trompe ? } »

Si ce n'est pas ça : « {question de l'hypothèse 2} » ou « {question de l'hypothèse 3} »

## 2. Si on vous dit...
- **« {objection} »** : {réponse en une phrase}.
(4 à 6 lignes, les objections de sortie « envoyez-moi une présentation », « rappelez-moi dans trois mois », « je dois en parler » comprises)

## 3. Conclure
- **Résumé à faire valider :** « {une phrase} »
- **A.** {suite idéale : rendez-vous avec le décideur}
- **B.** {suite de repli : rendez-vous avec l'interlocuteur pour présenter le livrable}
- **C.** {petit engagement}
- **Livrable promis :** {titre du livrable, qui sert aussi de titre d'invitation}

## Pour aller plus loin
- {tout le reste, en puces courtes}
```

Détails du format :
- **Le ton** : si la couleur est inconnue, écrire « **Le ton :** {Prénom} : couleur encore inconnue, {consigne neutre} » (sans le mot « plutôt », donc sans pastille). Le mot de couleur (rouge, jaune, vert, bleu) sert à la pastille du rendu : un seul mot, en minuscules.
- **Questions clés** : les six temps de l'entonnoir de l'hypothèse principale, dans l'ordre (situation, problème, implication, chiffrage, gain, reformulation), une par ligne, 20 mots maximum. Les deux hypothèses de réserve tiennent sur la seule ligne « Si ce n'est pas ça ».
- **Si on vous dit...** : une réponse courte par objection, en général la question d'isolement ou d'exploration. Le détail (accepter, isoler, explorer) va dans « Pour aller plus loin » s'il faut le garder.
- **Conclure** : une ligne par suite A, B, C. Le livrable promis reprend le titre de l'invitation.
- **Pour aller plus loin**, en puces courtes, dans cet ordre : le détail du ton (indice, source, à éviter, à vérifier pendant le rendez-vous), étape actuelle et visée, raison de se revoir (livrable et format selon la couleur), déroulé minuté (cadre, découverte, point d'étape aux deux tiers, reformulation, suite), pourquoi maintenant (signal sourcé et daté, niveau groupe dit franchement), urgence (trois questions) et enjeu personnel, qui décide, fournisseur en place, questions miroir et preuve (à confirmer avant de la citer, aucun cas chiffré disponible), ce que dit le CRM, données manquantes, puis la ligne finale *Sources web : 1. {titre} - {média} - {date} - {url} ; ...*

## Version à écouter (fichier `<base>_audio.txt`)

250 à 320 mots, texte brut, phrases courtes, chiffres arrondis. Pas de liste, pas de titre. Elle suit l'ordre de la fiche : salut au prénom du lecteur, qui, quand et combien de temps, ce qu'il y a à préparer avant s'il y en a, puis « En un coup d'œil » (la couleur probable et le ton en une phrase, l'objectif du jour, l'accroche pour ouvrir), les questions clés de l'hypothèse principale (problème, qui d'autre le ressent, si c'était réglé), l'objection la plus probable avec sa réponse, puis la conclusion : le résumé à faire valider, les suites A, B, C, le livrable promis et les deux créneaux. Le dernier mot rappelle le rendez-vous suivant à obtenir.
