---
name: brief-visite
description: Prépare la fiche de visite d'un commercial avant un rendez-vous client - lecture du CRM Excel, puis cinq recherches en parallèle, chacune par son agent Sonnet (bourse, LinkedIn, trois angles de presse), fiche d'une page (écrite et HTML imprimable) et version audio à écouter en voiture, puis « Brief préparé » = Oui dans le CRM. USE WHEN « prépare le brief de ma visite chez X », « brief R001 », « prépare ma visite », « fiche de visite », « prépare mes rendez-vous de lundi ». NOT FOR le compte rendu après visite (mis de côté).
---

# Préparer une fiche de visite

Tout se lance depuis la racine du projet. Python : `.venv/bin/python`. Date de référence : celle du CRM (`meta.date_reference` du dossier), pas la date système. Règles d'écriture : `CLAUDE.md` (zéro jargon, zéro identifiant à l'écran, ne rien inventer, CRM / Web / Bourse toujours distingués, jamais de tiret cadratin).

Tes courts messages de progression s'affichent en direct au commercial dans l'onglet « Workflow » : écris-les comme à un collègue commercial, à la première personne, sans aucun mot technique (pas d'« agent », « script », « outil », « commande », « fichier JSON »). Exemple : « Je lance cinq recherches sur Bonduelle », « Quatre recherches sur cinq sont revenues, j'attends la dernière ».

Si la demande vise plusieurs rendez-vous (« mes rendez-vous de lundi »), traiter chaque rendez-vous avec les étapes ci-dessous ; les agents de recherche de tous les rendez-vous peuvent partir dans le même message (toujours un agent par recherche).

## Étapes

**1. Lire le CRM**
```
.venv/bin/python scripts/extraire_dossier.py --rdv R001        # ou --entreprise "Bonduelle"
```
La sortie donne les chemins `sorties/dossiers/<RDV>_<slug>_dossier.json` et `.md`. Lire le JSON en entier. Dans la suite, `<base>` = `<RDV>_<slug>` (ex. `R001_bonduelle`).

**2. Les cinq recherches : un agent Sonnet par recherche, tous dans le même message**

Chaque recherche a son propre agent. Tu ne lances jamais toi-même `cours_bourse.py`, `linkedin_entreprise.py`, WebSearch ou WebFetch, et tu ne regroupes jamais deux recherches dans un même agent ou une même commande : l'application le refuse. Lancer, **dans un seul message**, jusqu'à cinq appels à l'outil Agent, **au premier plan** (`run_in_background: false`) : ils tournent quand même en parallèle et tu reçois leurs cinq réponses ensemble. Jamais en arrière-plan : la préparation s'arrêterait avant leur retour.

- **Bourse** - agent `cours-bourse`, seulement si `entreprise.code_bourse` est renseigné. Il reçoit : le nom de l'entreprise, le code bourse, `<base>`. Il écrit `sorties/briefs/<base>_bourse.json` et renvoie son contenu. Statut `non_cotee` ou `indisponible` : le dire dans la fiche, l'actualité financière passera par la presse.
- **LinkedIn** - agent `linkedin-entreprise`. Il reçoit : le nom de l'entreprise, `<base>`. Il écrit `sorties/briefs/<base>_linkedin.json` (les ~10 dernières publications : date, texte, « j'aime », lien) et cherche lui-même la page si le nom ne suffit pas. S'il revient `introuvable` ou `indisponible`, ne bloque pas : la fiche dira « page LinkedIn non consultée ».
- **Presse A, B, C** - trois agents `veille-entreprise`, un par angle. Chacun reçoit uniquement : le nom de l'entreprise, son site web, la période (les 3 mois avant la date de référence, ex. du 2026-07-09 au 2026-10-09) et **un** angle :
  - angle A : « résultats financiers, chiffre d'affaires, bourse, prévisions, rachats et cessions » ;
  - angle B : « dirigeants et gouvernance : nominations, départs, réorganisations, notamment achats, industriel, qualité » ;
  - angle C : « sites industriels, investissements, fermetures, nouveaux produits, emballage et RSE (recyclabilité, réduction plastique) ».

Ne jamais transmettre de donnée du CRM aux agents (contacts, montants, affaires) : seulement le nom, le site public, le code bourse et `<base>`. Attendre le retour des cinq agents avant l'étape suivante.

**3. Tout compiler dans un seul fichier**

Écrire les réponses des trois agents de presse, sans les faits sans date ou sans URL, dans `sorties/briefs/<base>_veille.json` (une liste de trois objets), puis :
```
.venv/bin/python scripts/compiler_sources.py --base <base>
```
qui produit `sorties/briefs/<base>_sources.json` = `{"crm", "bourse", "veille", "linkedin"}` sans recopier le dossier CRM à la main.

**4. Rédiger la fiche écrite** selon `modele_brief.md` (partie « Modèle de fiche ») dans `sorties/briefs/<base>_fiche.md`.
- Une page. Chiffres exacts du CRM (pas d'arrondi dans la version écrite).
- Chaque puce finit par son origine : (CRM), (Bourse, Yahoo Finance), (Web, média, date) ou (LinkedIn, date).
- LinkedIn : retenir une à trois publications des 90 derniers jours (`recente` = vrai) qui disent quelque chose d'utile au commercial (produits mis en avant, recrutements, usines, salons, messages RSE). Résumer en une phrase, ne pas recopier. Ignorer les publications purement promotionnelles.
- Toujours remplir « Données manquantes » et « Sources web ».

**5. Rédiger la version à écouter** selon `modele_brief.md` (partie « Modèle de la version à écouter ») dans `sorties/briefs/<base>_audio.txt`. 280 à 330 mots, texte brut, rien d'autre dans le fichier.

**6. Produire la page imprimable et l'audio**
```
.venv/bin/python scripts/rendre_fiche.py --base <base>
```
Crée `<base>_fiche.html` (charte de l'appli, imprimable, lisible sur téléphone) et `<base>_audio.m4a`.

**7. Cocher « Brief préparé » dans le CRM**
```
.venv/bin/python scripts/ecrire_crm.py --brief-prepare R001
```
C'est la seule écriture CRM de ce skill : elle ne demande pas de validation (le commercial a demandé la fiche). Vérifier que le statut renvoyé est `ok` ou `deja_fait`.

**8. Répondre** en trois lignes, en langage commercial : la fiche est prête, le point clé du rendez-vous, et où l'écouter ou la lire. Pas d'identifiant, pas de chemin technique.
