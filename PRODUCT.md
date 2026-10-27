# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Commerciaux terrain (B2B, industrie), sans aucune culture technique. Avant un rendez-vous, ils sont souvent en voiture : ils ne peuvent pas lire, ils écoutent. Après le rendez-vous, ils dictent leur compte rendu sur le téléphone, entre deux visites. Sur le Mac, ils consultent leur journée, déposent le CRM et règlent leur compte.

## Product Purpose

Préparer chaque visite commerciale sans effort : 30 minutes avant un rendez-vous de l'agenda Google, l'agent (Claude, en arrière-plan) lit le CRM, la bourse et la presse, puis produit une fiche d'une page et sa version audio d'environ 2 minutes, envoyées sur le téléphone. Après la visite, une note vocale devient un compte rendu que le commercial valide, puis il est écrit dans le CRM Excel. Réussite : le commercial arrive préparé sans avoir rien lu, et son CRM se remplit sans saisie.

## Positioning

Un agent qui travaille seul autour de l'agenda et du CRM réels du commercial. Chaque information de la fiche porte sa source (CRM, Bourse, Web avec date). Rien n'est écrit dans le CRM sans validation explicite.

## Operating Context

- Deux surfaces : une app Mac (fenêtre de bureau autour d'une interface web locale : Accueil, Ma journée, Workflow, Mon compte) et une app téléphone (PWA via un relais Vercel, appairée par un code à 6 chiffres).
- L'app Mac s'ouvre sur une page d'accueil animée à chaque lancement (choix confirmé par Antoine le 13/10/2026).
- L'onglet « Workflow » (anciennement Coulisses) montre l'agent au travail, brique par brique, en langage clair. Les réglages techniques (modèle, options) vont dans Mon compte.
- Téléphone : mode voiture (gros bouton lecture, ±15 s, contrôle depuis l'écran verrouillé et CarPlay, écoute hors connexion, saut aux « Questions à poser »), dictée de la note, validation du compte rendu.
- Données : CRM Excel (onglets Entreprises, Contacts, Transactions, Activités, Rendez-vous...), agenda Google via un déclencheur Apps Script.

## Capabilities and Constraints

- Stack existante : React 19, Vite, Tailwind v4, motion, motion-primitives, GSAP, Three.js (desktop `app/web`), React + Vite PWA (mobile `relais/mobile`), serveur FastAPI local, relais Vercel.
- Le prénom affiché vient du compte Claude connecté ; aucune mention de « Julien » ni d'« Orvane » dans l'interface.
- L'app doit pouvoir être donnée à quelqu'un d'autre qui se connecte avec son propre compte Claude.

## Brand Commitments

- Identité visuelle : violet #5723F3, marine profond #120A29, crème #FAF9F6, logo de l'appli (cliquer dessus ramène à l’accueil). Typographie : Fraunces pour les titres et grands chiffres, Geist pour le texte, embarquées dans les deux applis.
- Antoine préfère le look actuel (fond crème voilé, bandeau marine, cartes, animations) : on l’affine, on ne le remplace pas.
- Langue : français. Jamais de tiret cadratin.
- Règle n°1 : zéro jargon et aucun identifiant interne à l'écran (pas de R001, script, JSON, agent, quota, Sonnet...).

## Evidence on Hand

- CRM de démonstration `data/Export_CRM_Orvane_demo_20261009.xlsx` (rendez-vous Bonduelle 9h30, Lesaffre 14h, Guerbet 17h en visio).
- Fiches et audios réels générés dans `sorties/`.
- Audit UX/UI du 13/10/2026 : `docs/audit_ux_ui_2026-10-13.md`.
- Aucun témoignage, client ou chiffre de performance réel : ne pas en inventer.

## Product Principles

1. L'oreille d'abord : tout ce qui sert avant la visite doit marcher sans regarder l'écran.
2. Montrer d'où vient chaque information, et dire honnêtement ce qui manque.
3. Rien n'entre dans le CRM sans que le commercial ait vu et validé ce qui change.
4. Un écran de travail est calme : une seule chose importante à la fois, le prochain rendez-vous en premier.
5. On parle comme un collègue commercial, jamais comme un développeur.

## Accessibility & Inclusion

Contraste WCAG AA minimum. Utilisable en conduisant (commandes larges, contrôle depuis l'écran verrouillé). Respect du réglage « réduire les animations ».
