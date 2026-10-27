---
name: compte-rendu-visite
description: Rédige le compte rendu d'un rendez-vous commercial à partir de la note vocale (déjà transcrite) du commercial, en s'appuyant sur le CRM, et propose les mises à jour du CRM. N'écrit jamais dans le CRM : l'écriture se fait après validation par le commercial. USE WHEN « rédige le compte rendu à partir de ma note vocale », « CR R001 », « compte rendu de visite ».
---

# Rédiger un compte rendu de visite

Tout se lance depuis la racine du projet. Python : `.venv/bin/python`. Règles d'écriture : `CLAUDE.md` (zéro jargon, zéro identifiant, ne rien inventer, jamais de tiret cadratin).

## Entrées (fournies dans la demande)
- le rendez-vous (ex. R001) ;
- le chemin de la transcription de la note (fichier .txt) ;
- le chemin de sortie du compte rendu (fichier .json).

## Étapes

1. **Lire la transcription** en entier. Elle vient d'une reconnaissance vocale : les noms propres peuvent être déformés (« Bonduel », « l'abli »). Corrige-les avec le CRM, sans rien inventer.
2. **Recharger le contexte du rendez-vous** :
   ```
   .venv/bin/python scripts/extraire_dossier.py --rdv R001
   ```
   puis lire `sorties/dossiers/<RDV>_<slug>_dossier.json` : interlocuteurs, affaire liée et sa phase, réclamations, concurrent.
3. **Rédiger le compte rendu** selon `modele_compte_rendu.md`. Il doit se lire en une minute sur un téléphone. Ce que la note ne dit pas va dans « Ce que la note ne dit pas », jamais dans le corps comme un fait.
4. **Proposer les mises à jour du CRM**, selon la dernière partie du modèle.
5. **Écrire le fichier de sortie** (et rien d'autre) au chemin demandé, en JSON UTF-8 :
   ```json
   {
     "rdv": "R001",
     "texte": "<le compte rendu complet en markdown>",
     "synthese": "<une phrase pour la notification>",
     "maj_crm": { "resultat": "Positif", "prochaine_action": "...", "echeance": "2026-10-16", "phase": null, "prochaine_etape_affaire": "..." }
   }
   ```
6. **Ne rien écrire dans le CRM.** L'application le fera via `scripts/ecrire_crm.py --compte-rendu`, seulement après la validation explicite du commercial.
7. Répondre en une phrase : le compte rendu est prêt à valider.
