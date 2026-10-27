# Agent « Préparateur de visite commerciale »

Démonstrateur Claude : un agent qui prépare les rendez-vous d'un commercial terrain à partir d'un CRM Excel fictif.

## Périmètre

- **Avant la visite** : fiche écrite et audio (skill `brief-visite`). Écriture CRM : « Brief préparé » = Oui.
- **Après la visite** (réactivé par Antoine le 12/10/2026) : note vocale dictée dans l'appli mobile, transcrite sur le Mac (`scripts/transcrire.py`), compte rendu rédigé par le skill `compte-rendu-visite`, puis **validation sur le téléphone**, et seulement ensuite écriture dans le CRM (`scripts/ecrire_crm.py --compte-rendu`).

## Règle n°1 : on parle à des commerciaux

Tout ce qui s'affiche à l'écran, et tout ce que l'agent écrit dans une fiche ou un compte rendu, doit se comprendre sans aucune culture technique.

- Jamais d'identifiant interne à l'écran (R001, E001, C001, T001, U002...). On dit « votre rendez-vous de 9h30 chez Bonduelle », « Nathalie Dubreuil, responsable achats », « le renouvellement de l'accord-cadre étiquettes ».
- Jamais de vocabulaire technique : pas de « script », « JSON », « sous-agent », « ticker », « pipeline pondéré », « API ». On dit « je consulte votre CRM », « je cherche l'actualité de Bonduelle », « le cours de bourse ».
- Des verbes d'action et des étapes que le commercial reconnaît : préparer ma visite, lire la fiche, dicter mon compte rendu, valider, c'est enregistré dans le CRM.
- Les identifiants restent dans les fichiers techniques et la documentation, jamais dans l'interface.

## Le commercial est en voiture : la fiche se donne aussi en audio

Demande d'Antoine (09/10/2026). Avant la visite, le commercial conduit et ne peut pas lire. Chaque fiche de visite existe donc en deux versions :
- une **version écrite** d'une page (téléphone ou impression) ;
- une **version à écouter** d'environ 2 minutes : un texte réécrit pour l'oral (phrases courtes, chiffres arrondis et dits en toutes lettres quand c'est plus clair, pas de tableau ni de liste à puces, l'essentiel d'abord), puis converti en fichier audio. Dans l'appli, un bouton « Écouter ma fiche » le lit.

## Règles d'écriture

- Français. Jamais de tiret cadratin, uniquement le tiret simple (-).
- Ne rien inventer. Distinguer ce qui vient du CRM de ce qui vient d'internet. Signaler les données manquantes. Reprendre les chiffres exacts du fichier.
- Toute information venant d'internet est sourcée et datée.
- Ne jamais écrire dans le CRM sans validation explicite du commercial.

## Données

- CRM simulé : fichier Excel dans `data/` (fichier actif indiqué par `data/.crm_actif`, sinon `Export_CRM_Orvane_demo_20261009.xlsx`). L'original n'est jamais modifié.
- Onglets reliés par identifiants : Commerciaux (U), Entreprises (E), Contacts (C), Transactions (T), Activités (A), Rendez-vous (R), Tickets (K), Commandes (CMD-), Produits (P), Paramètres.
- En-têtes bleu foncé : saisie. Gris : formule, à ne jamais lire (recalculé par `scripts/crm_lib.py`, vérifié par `scripts/verifier_calculs.py`). Orange : à remplir par l'agent (« Brief préparé », « Compte rendu de visite »).
- Date de référence : `Paramètres!B3` (date de l'export), jamais la date système.
- Persona : Julien Morel, commercial terrain. Scénario : ses trois rendez-vous du lundi 12/10/2026 (Bonduelle 9h30, Lesaffre 14h00, Guerbet 17h00 en visio).

## Outils

- Python du projet : `.venv/bin/python` (installé par `uv`, dépendances dans `requirements.txt`). Interface : React + Tailwind + motion-primitives + GSAP + Three.js dans `app/web` (compilée dans `app/web/dist`).
- `scripts/extraire_dossier.py --rdv R001` ou `--entreprise "Bonduelle"` : rassemble tout le CRM sur un rendez-vous dans `sorties/dossiers/`.
- Application : `app/serveur.py` (API + surveillance de l'agenda), `app/execution.py` (suivi brique par brique des Coulisses), `app/bureau.py` (fenêtre de bureau). Application livrée : `./scripts/fabriquer_app.sh` produit `../Préparateur de visite - Application/Préparateur de visite.dmg` (tout-en-un). Données de l'utilisateur : `~/Library/Application Support/Préparateur de visite/` (variable `PREPARATEUR_ESPACE`).
- Les préparations lancées par l'application tournent avec `claude -p --setting-sources project,local --model sonnet` : les réglages et hooks personnels de l'utilisateur ne sont pas chargés, le skill `brief-visite` fait foi.
- Contournements : si un obstacle technique risque de prendre du temps, le contourner et le documenter dans `docs/architecture.md`.
- Documentation : `README.md`, `docs/INSTALLATION.md`, `docs/architecture.md`.
