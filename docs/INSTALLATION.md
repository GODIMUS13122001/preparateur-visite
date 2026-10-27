# Préparateur de visite commerciale

Démonstrateur : un agent Claude qui prépare chaque visite d'un commercial terrain. Il lit le CRM, consulte la bourse et l'actualité du client, puis rédige une fiche d'une page, à lire ou à écouter en voiture. La fiche part seule sur le téléphone 30 minutes avant le rendez-vous.

## Installer (nouveau Mac)

Le `.dmg` n'est pas versionné : le fabriquer avec `./scripts/fabriquer_app.sh` (voir plus bas), puis le transmettre.

1. Ouvrir le .dmg et glisser **Préparateur de visite** dans Applications.
2. Première ouverture : clic droit sur l'application, puis **Ouvrir** (elle n'est pas signée par Apple).
3. Cliquer sur **Se connecter** avec son compte Claude (Pro, Max, Team ou Enterprise). Si Claude n'est pas installé, l'application l'installe d'abord.

Tout le reste est automatique. Les données personnelles (CRM déposé, fiches, réglages, canaux privés) sont créées au premier lancement dans `~/Library/Application Support/Préparateur de visite/`, avec un CRM de démonstration. Optionnel : le déclencheur Google Agenda et le téléphone, depuis la pastille au prénom en haut à droite.

Prérequis : un Mac Apple Silicon (M1 ou plus récent), macOS 12 ou plus récent, une connexion internet.

## Utiliser

- **Accueil** : la page d'entrée animée, avec les chiffres du jour et un bandeau qui reprend l'actualité réellement trouvée.
- **Ma journée** : les rendez-vous jour par jour. « Préparer ma visite » lance la préparation, puis on lit, écoute, imprime ou envoie la fiche.
- **Coulisses** : chaque préparation en schéma de briques, gris (en attente), violet (en cours), vert (terminé). Un clic sur une brique montre ce qu'elle a fait : recherches, sites consultés, faits retenus avec source et date, chiffres lus dans le CRM. On peut lancer avec ou sans certaines sources, arrêter, relancer, rejouer, régler l'automatisme et choisir le modèle de rédaction.
- **Pastille au prénom** (en haut à droite) : le compte Claude, le CRM (dépôt d'un nouvel export, avec preuve), Google Agenda et le téléphone.

L'automatisme (préparation 45 min avant, envoi 30 min avant) ne tourne que lorsque l'application est ouverte.

## Fabriquer l'application (atelier)

Ce dossier est l'atelier. `./scripts/fabriquer_app.sh` produit `../Préparateur de visite - Application/Préparateur de visite.dmg` : il embarque un Python autonome, les dépendances (`requirements-appli.txt`), l'interface compilée, l'agent (skills, scripts, consignes) et le CRM de démonstration.

## Pour développer

```
.venv/bin/python app/serveur.py                 # serveur seul, http://127.0.0.1:8765
.venv/bin/python app/bureau.py                  # serveur + fenêtre de l'application
PORT=8766 PREPARATEUR_SANS_SURVEILLANCE=1 PREPARATEUR_WEB=dist-test .venv/bin/python app/serveur.py   # copie de test, sans envoi automatique
cd app/web && npm install && npm run build      # recompiler l'interface (Node.js requis)
.venv/bin/python scripts/verifier_calculs.py    # vérifie les recalculs face aux formules Excel
```

Architecture, données et contournements : `docs/architecture.md`. Règles pour Claude : `CLAUDE.md`.
