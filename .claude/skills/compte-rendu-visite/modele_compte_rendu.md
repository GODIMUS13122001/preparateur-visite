# Modèle de compte rendu de visite

Écrit pour être relu et validé sur un téléphone : court, factuel, sans jargon. Jamais de tiret cadratin. Aucun identifiant interne (R001, T001...).

```markdown
# Compte rendu - {Entreprise}, {jour} {date}

**Participants :** {interlocuteurs côté client, avec leur poste} · {commercial}
**Type :** {visite sur site / visio} · **Durée :** {si connue, sinon ne pas l'écrire}

## Synthèse
{3 lignes maximum : ce qui s'est passé, le ton du rendez-vous, l'enjeu pour la suite}

## Points abordés
- {un point par ligne, dans un ordre logique et non dans l'ordre de la note}

## Décisions
- {ce qui a été décidé ou accepté ; « Aucune décision formelle » s'il n'y en a pas}

## Objections et risques
- {objections du client, concurrence, signaux faibles}

## Actions
- **{quoi}** - {qui} - {quand}

## Ce que la note ne dit pas
- {informations utiles absentes de la note : le signaler, ne pas l'inventer}
```

## Mises à jour du CRM proposées (renvoyées à part, pas dans le texte)

- `resultat` : une valeur parmi « Positif », « Neutre », « À relancer », « Négatif ».
- `prochaine_action` : une phrase courte, à l'infinitif.
- `echeance` : date AAAA-MM-JJ, déduite de la note (« vendredi » = le vendredi qui suit le rendez-vous). Vide si la note ne permet pas de la dater.
- `phase` : seulement si la note justifie clairement un changement d'étape de l'affaire liée, et parmi les valeurs du CRM (Rendez-vous programmé, Qualifié pour achat, Présentation planifiée, Décideur impliqué, Contrat envoyé, Conclu gagné, Conclu perdu). Sinon `null`.
- `prochaine_etape_affaire` : nouvelle « prochaine étape » de l'affaire liée, si la note la change ; sinon `null`.
