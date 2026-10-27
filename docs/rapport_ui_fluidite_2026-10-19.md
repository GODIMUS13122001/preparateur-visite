# Rapport UI et fluidité - Préparateur de visite

19/10/2026. Trois agents agency-agents ont fait tourner les deux applications sur un banc de test (Chrome piloté, mode iPhone tactile avec processeur ralenti jusqu'à 6 fois, et mode Mac en 1024 à 1920 px, clair et sombre) : Performance Benchmarker (fluidité), Evidence Collector (toutes les fonctions, une par une) et UI Designer (audit visuel). App téléphone réelle avec les vraies données, app Mac en copie de test. Aucune action réelle n'a été faite (ni dictée, ni validation, ni préparation lancée). Limite : Chrome sans fenêtre ne voit pas les coûts propres à Safari ; ce qui est « déduit du code » reste à confirmer sur un vrai iPhone.

## En une phrase

Les gestes du téléphone restent fluides en mesure (60 images par seconde, même processeur ralenti 6 fois) : la sensation de lenteur vient surtout de **l'accueil 3D, qui impose 3 à 4 secondes à chaque ouverture et à chaque retour par le logo**, du poids de l'app au démarrage et de fonds flous coûteux sur iPhone. Côté interface, **le mode sombre du Mac rend les cartes de rendez-vous illisibles**, et plusieurs défauts gênent la démo (audio en double, briques du Workflow coupées, jargon).

## 1. Bloquants et gênants pour la démo

| # | App | Problème | Correction | Source |
|---|---|---|---|---|
| 1 | Mac | Mode sombre : carte du rendez-vous sélectionné et pied du panneau blancs, texte clair dessus, contraste 1,1:1 | Ajouter la variante sombre de `bg-white/90` (index.css) | Fonctions, Visuel |
| 2 | Mac | Mode sombre : « Aujourd'hui » illisible dans le ruban des jours ; encart « 2 sur 4 connectés » et textes violet foncé illisibles | Couleurs sombres dédiées à ces éléments | Fonctions, Visuel |
| 3 | Téléphone | Le lecteur de la carte et le mode voiture jouent en même temps (deux voix) | Mettre en pause le lecteur de la carte à l'ouverture du mode voiture | Fonctions |
| 4 | Téléphone | Le bouton « Écouter » est sous le bas de l'écran (y=903 sur 844) | Remonter le lecteur au-dessus du plan | Visuel |
| 5 | Mac | Pied de page « Relier mon agenda » affiché à tort sur les jours passés alors que l'agenda est relié | Utiliser l'état global de l'agenda pour ce message | Fonctions |
| 6 | Mac | Workflow : titres des briques coupés (« Déclenche… »), « Exécutée · 53 s » sur deux lignes, textes de 9 à 11 px | Briques plus larges, titres sur deux lignes, 12 px minimum | Fonctions, Visuel |
| 7 | Mac et téléphone | Jargon visible : « tokens », « API », « ntfy », « KER.PA », requêtes de recherche brutes, « Rang 1er rendez-vous », « J-3 » | Libellés de commercial (« volume de texte lu », « notification sur le téléphone ») | Fonctions, Visuel |
| 8 | Mac | Prospection : le corail est presque identique au rouge d'erreur ; les interrupteurs « activés » paraissent rouges | Erreur en rouge plus froid (#A3122A), interrupteurs activés en vert | Visuel |

## 2. Fluidité du téléphone (classée par effet ressenti)

1. **Accueil 3D** : 3 à 4 s perdues à chaque ouverture et à chaque retour par le logo (mesuré). Jouer l'intro longue une fois par jour, jamais au retour par le logo, et la ramener à environ 1,2 s.
2. **Poids de l'app au démarrage** : 1,15 Mo de code lus d'un coup, dont 521 ko pour la 3D (tâches de 107 à 155 ms bloquantes au ralenti x4 à x6). Remplacer Three.js par un petit dessin WebGL, ou le charger après l'affichage de la journée.
3. **Cartes** : 15 tuiles de carte routière et environ 450 éléments de page par carte. Passer à 3 tuiles, ne calculer que la carte visible et ses voisines.
4. **Défilement d'une carte** : fond en `background-attachment: local` et effet de parallaxe sur l'en-tête, coûteux sur Safari (déduit du code). Les retirer.
5. **Polices** : Fraunces complète (271 ko) sur le chemin critique. Passer à la version allégée.
6. **Préchargements** : 15 fichiers dont un audio de 453 ko dès l'ouverture. Afficher d'abord la journée, précharger ensuite.
7. **Carte qui tourne au glissé** : ombre et arrondi recalculés à chaque image (déduit). Ombre statique, accélération réservée au geste.
8. **Flous de 64 px** dans le mode voiture et les Paramètres (déduit) : les remplacer par des fonds unis légèrement transparents.
9. Ne pas redessiner toute l'app quand l'état reçu du Mac n'a pas changé ; mettre en pause les animations hors écran.

## 3. Fluidité du Mac

- Un seul paquet de 1,29 Mo sans découpage : charger Ma journée d'abord, puis Workflow, Mon compte et la 3D à la demande (environ 350 ko au premier écran).
- Fond fixe, bruit en mélange plein écran, flous géants et `backdrop-blur` partout : coûteux au défilement et au changement de mode. Les alléger.
- Scène 3D de l'accueil qui tourne sans pause : la suspendre hors écran.

## 4. Défauts de détail

- Mac : nombres au format anglais dans le détail des briques (« 216.55 € », « 2.4 minutes ») ; schéma replié qui laisse une grande carte vide ; colonne de droite vide sur grand écran ; libellés coupés dans « Mes rendez-vous » ; CRM de prospection affiché « 7 clients » au lieu de prospects ; adresses web brutes en bas des fiches.
- Téléphone : mode voiture sans thème corail pour un prospect, piste de lecture trop pâle (1,8:1), bouton « 1x » mal placé ; adresses coupées sur la ligne du plan ; textes de 10 et 11 px ; coupure de ligne sur « : » dans les Paramètres ; montant coupé en deux lignes dans la fiche ; hors connexion signalé seulement par un point discret ; un jour vide laisse l'ancienne carte affichée.
- Lien profond `/?rdv=` : deux ouvertures sur la mauvaise carte observées juste après un déploiement, puis douze essais corrects. À rejouer après le prochain déploiement.
- Console : avertissement Three.js (`THREE.Clock`) et balise `mobile-web-app-capable` à ajouter.

## 5. Ce qui marche bien

- Téléphone : paquet de cartes, étiquettes Client / Prospect / Agenda, filtre (compteurs, état vide), volet de la semaine (jour avec fiche, sans fiche, sans rendez-vous), lecteur audio, mode voiture, plan avec Plans / Google Maps / Waze, fiche lisible sans défilement horizontal, Paramètres, hors connexion (dernière journée affichée), aucune coupure de 360 à 430 px, cibles tactiles de 44 px ou plus.
- Mac : sélection d'office du prochain rendez-vous dans les deux modes, changement de jour, fiche et audio, Workflow (15 briques détaillées, coûts, fil), mode sombre mémorisé, rien ne déborde de 1024 à 1920 px.

## 6. À confirmer sur un vrai iPhone

Safari, Réglages > Avancé > Inspecteur web, puis l'onglet Chronologie avec « Peinture » et « Calques composés » : ouverture de l'app, glisser entre les cartes, défiler dans une carte, ouvrir le mode voiture. C'est là que se voient les coûts des flous et des fonds, invisibles pour Chrome.

## 7. Plan de la prochaine itération

1. Les 8 points du tableau 1 (démo).
2. Fluidité du téléphone : points 1 à 6 de la section 2, puis 7 à 9.
3. Fluidité du Mac et défauts de détail.

Les rapports détaillés des trois agents (avec captures, fichiers et lignes) sont joints en annexe : `Annexe_fluidite.md`, `Annexe_interface.md`, `Annexe_fonctionnel.md`.
