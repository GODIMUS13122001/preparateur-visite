# Audit UX/UI - Préparateur de visite (13/10/2026)

Méthode : skill Impeccable (`critique` + `audit`), deux analyses indépendantes, captures réelles (Mac 1440x900, téléphone 390x844), détecteur automatique. Lecture seule : aucune préparation lancée, CRM non touché.

## Notes

| Analyse | App Mac | App téléphone |
|---|---|---|
| Expérience (10 critères de Nielsen) | 22/40 | 26/40 |
| Technique (accessibilité, perf, couleurs, responsive, cohérence) | 13/20 (les deux apps) | |

Verdict : le fond est très spécifique au métier (fiche sourcée, frise de la journée, avant/après le rendez-vous), mais l'habillage est un kit « startup IA » générique (globe 3D, texte en dégradé, cartes qui basculent, bouton qui suit la souris, slogans qui tournent). Le téléphone est plus sobre et mieux réussi.

## Bugs à corriger en priorité

1. **[Bloquant] Fenêtres et notifications hors de l'écran (Mac).** Un effet d'animation sur la page fait que les fenêtres (dépôt du CRM, téléphone), les messages de confirmation et la barre du bas se placent par rapport à la page et non à l'écran : mesuré, la barre du bas est à 1497 px dans une page de 1548 px. Cause : `App.tsx:45` et `App.tsx:80`.
2. **[Majeur] Enregistrement CRM qui peut échouer en silence (Mac).** `Journee.tsx:645` : aucun message d'erreur, la roue tourne indéfiniment, et on ne voit pas ce qui va changer dans le CRM avant de valider (le téléphone, lui, le montre).
3. **[Majeur] Sur le téléphone, une note vocale est perdue** si un appel ou le verrouillage interrompt l'enregistrement (`relais/mobile/src/App.tsx:313`). Une validation qui échoue n'affiche rien (`App.tsx:418`).

## Problèmes d'expérience

- **La page d'accueil animée bloque chaque ouverture** alors que c'est un outil du quotidien (`App.tsx:19`).
- **Coulisses enfreint la règle « zéro jargon »** : `cd`, agents, quota, Sonnet/Opus, « Script local », Rejouer vs Relancer.
- **Trop de mouvement sur l'écran de travail** : 13 composants animés dans « Ma journée », slogans qui changent toutes les 3 s.
- **Statuts contradictoires** : « Connecté » à côté de « Relier mon téléphone » ; barre du bas bloquée sur « Lecture de l'agenda... » ; promesse d'envoi automatique alors que le déclencheur n'est pas installé.
- **La voiture n'est pas pensée** : lecteur sans avance/retour de 15 s, sans contrôle depuis l'écran verrouillé ou CarPlay, pas d'écoute hors connexion (tunnel).
- **« Corriger » le compte rendu ouvre du texte brut** avec des symboles `**` et `#`.
- **« Recommencer » et « Envoyer » côte à côte, même taille** : un pouce qui glisse efface la note.
- **Installer le déclencheur Google Agenda** demande de passer par script.new et un avertissement de sécurité Google : trop technique pour un commercial.

## Technique

- **Contrastes trop faibles (norme WCAG non respectée)** : le gris « brume » et le lavande sur fond clair sont à 2,6:1 pour 4,5:1 requis, avec 51 usages.
- **Interrupteurs, onglets, champs sans étiquette** : rien n'est annoncé aux lecteurs d'écran, et aucun contour de focus au clavier.
- **Textes trop petits** : 9 à 11 px à plusieurs endroits.
- **Un seul fichier JavaScript de 1,24 Mo**, sans chargement progressif : la 3D se charge même quand on ne la voit pas.
- **Une partie des animations ignore le réglage « réduire les animations »** du Mac.

## Ce qui marche (à garder)

- **La fiche** : « L'essentiel en 3 lignes », questions à poser, une source (CRM/Bourse/Web) sur chaque information.
- **Le rendez-vous « absent du CRM »** : il est expliqué honnêtement, avec 3 étapes pour régler le problème.
- **Le parcours téléphone** : code à 6 chiffres, gros micro avec niveau sonore, aperçu de ce qui sera écrit dans le CRM.
- **L'écran « CRM bien reçu »** : le nombre de lignes par onglet rassure.

## Questions ouvertes de la revue

1. Et si l'app Mac s'ouvrait directement sur « Prochain : Lesaffre à 14h, fiche prête » ?
2. Coulisses est-il pour le commercial, ou pour montrer la mécanique en démo ?
3. À quoi ressemblerait un mode voiture : un énorme bouton lecture, des chapitres, un saut direct aux « Questions à poser » ?

Captures : `/tmp/319b8c94-9d8f-4d4f-802d-380af03421b0/scratchpad/critique-a/` et `critique-b/` (temporaires).
