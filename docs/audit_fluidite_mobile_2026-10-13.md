# Audit de fluidité - application mobile (13/10/2026)

Grille : principes d'Emil Kowalski (skills `emil-design-eng` et `animate`) et composants `motion-primitives`. Périmètre : `relais/mobile` (paquet de cartes, accès à la journée par le haut, accueil).

## Ce qui saccadait, et pourquoi

| Avant | Après | Pourquoi |
| --- | --- | --- |
| Fond : 4 dégradés en `background-attachment: fixed` + calque de grain plein écran en `mix-blend-mode: multiply` | Dégradés fixés une fois sur un calque immobile, grain sans mode de fusion | Un calque en fusion par-dessus toute la page oblige le téléphone à recomposer l'écran entier à chaque image du glissé et du défilement |
| Halos `blur-3xl` (flou de 64 px) dans chaque carte, l'en-tête, le panneau journée | Halos peints en `radial-gradient`, sans filtre | Un filtre de flou se recalcule quand l'élément tourne ou bouge : la carte en rotation devenait lourde |
| `backdrop-blur` sur la pastille du jour, les boutons, les voiles | Couleurs pleines | Le flou d'arrière-plan est le plus coûteux sur Safari iOS |
| Carte lancée en 220 ms fixes, quelle que soit la vitesse du doigt | Ressort qui reprend la vitesse du geste | Un geste vif doit partir vif ; une durée fixe casse la continuité main/écran |
| La carte suivante reste immobile pendant le glissé, puis « saute » à la fin | Elle grandit et s'éclaircit à mesure qu'on écarte la carte du dessus (valeur liée au doigt) | C'est ce qui donne la sensation Tinder : le paquet réagit pendant le geste, pas après |
| Glissé dans les deux axes (`drag` + verrouillage), rebond vertical élastique sur la carte | La carte ne se déplace qu'à l'horizontale ; le vertical est le défilement natif du téléphone | Le défilement natif tourne hors du fil JavaScript, à 120 images/s sur iPhone |
| Carte inscrite dans un cadre de 20 px, texte coupé, fonctions cachées derrière un geste vers le haut | Carte sur toute la largeur ; on descend dans la carte : note vocale, fiche, compte rendu | Une seule surface, un seul geste vertical, rien de caché |
| « dans 42 min » remplacé d'un coup | Chiffres qui défilent (`SlidingNumber`) | Le changement se lit au lieu de clignoter |
| Titre du jour remplacé d'un coup | Lettres qui se transforment (`TextMorph`) | Montre que c'est le même endroit qui change de contenu |
| Journée : panneau sombre qui tombe en 420 ms, ne suit pas le doigt, liste à plat | Volet clair qui suit le doigt dès qu'on tire, s'ouvre ou se referme selon la vitesse ; semaine en bandeau avec pastille animée (`AnimatedBackground`), agenda du jour avec le trait « maintenant » | Geste interruptible et réversible ; on voit la semaine d'un coup d'œil |
| Points de position animés en `width` | Animés en `transform: scaleX` | `width` relance la mise en page à chaque image |
| Toutes les cartes rendues complètes | Seule la carte du dessus a son contenu complet ; les cartes du paquet n'affichent que leur en-tête | Moins d'éléments à peindre pendant le geste |

## Règles retenues

- Seuls `transform` et `opacity` bougent pendant un geste ; aucun flou animé.
- Ressorts sans rebond pour l'interface (`bounce: 0` à `0.15`), courbe de sortie `cubic-bezier(0.23, 1, 0.32, 1)` pour le reste, aucune animation d'interface au-delà de 300 ms hors gestes.
- Un geste vif suffit (vitesse > 0,3 px/ms), sans obliger à franchir un seuil de distance.
- Chaque geste a son bouton : précédent / suivant dans l'en-tête, « Ma journée » au toucher.
- « Réduire les animations » : les ressorts deviennent des fondus courts, les cartes ne pivotent plus.

## À vérifier sur un vrai iPhone

La fluidité ne se juge pas dans un simulateur : glisser rapidement plusieurs cartes, défiler dans une carte longue (compte rendu à valider), ouvrir et refermer la journée à mi-course.

## Contrôle du 13/10/2026 (fin d'après-midi) - consignes d'Antoine et grille Emil Kowalski

| Avant | Après | Pourquoi |
| --- | --- | --- |
| Le paquet s'arrêtait aux 5 prochains jours ; au bout, la carte revenait sans rien dire | Tous les rendez-vous à venir (jusqu'à 30 jours) ; au bout, la carte suit le doigt avec retenue (élastique exponentiel, au plus 30 % de l'écran) et une carte « Plus de rendez-vous à venir » apparaît dessous | Une limite doit se sentir, pas bloquer net (Emil : friction plutôt que mur) |
| Devant une fiche manquante, cran à 78 % de l'écran | Cran à 30 %, préparation lancée à 70 %, barre de charge visible | Le geste annonce ce qu'il va faire avant qu'on relâche |
| Plan absent pour les rendez-vous sans adresse (Clarins en visio) | Le cadre reste toujours : « Rendez-vous en visio » ou « Adresse non disponible », ou « Carte indisponible » si la position n'est pas encore trouvée | Même structure de carte partout, l'information manquante est dite |
| Une fois descendu dans la carte, un glissé de côté faisait déborder le contenu (`overflow-y: auto` ouvre aussi le débordement horizontal sur iPhone) | `overflow-x: hidden` + `touch-action: pan-y` sur le cadre ; changement de carte seulement en haut de la carte et si le geste est franchement horizontal | Le contenu reste centré, mesuré : bord gauche à 0 px pendant un glissé latéral |
| Trois rubriques avec titre, sous-titre et légende | Trois boutons seuls : « Écouter la fiche », « Lire la fiche », « Faire mon compte rendu » (ou « Valider mon compte rendu », « Compte rendu enregistré ») | Les boutons parlent d'eux-mêmes |
| « Écouter ma fiche » en double (haut de carte et rubrique) | Une seule écoute, dans le bouton qui se déplie | Une action, un endroit |
| Pas de retour au toucher sur la plupart des boutons | Tous les boutons s'enfoncent (`scale: 0.97`, 160 ms, `cubic-bezier(0.23, 1, 0.32, 1)`) ; les trois boutons de la carte font en plus rebondir leur icône (ressort court) et déplient leur contenu (hauteur + opacité, 300 ms) | Emil : « les boutons doivent sentir qu'on appuie » ; une seule animation par geste |
| Lecteur et compte rendu avec étiquettes répétées (« ÉCOUTER MA FICHE », « À valider ») | Retirées | Pas de légende quand le bouton le dit déjà |

Toujours vérifié : seuls `transform` et `opacity` bougent pendant les gestes ; « Réduire les animations » respecté (ressorts remplacés par des fondus courts). À vérifier sur un vrai iPhone : sensation du cran et de l'élastique de fin.

## Fabrication d'une carte depuis le téléphone (13/10/2026, soir)

- Le paquet ne contient que les cartes générées. Au bout, la dernière carte se pousse avec retenue (libre jusqu'à 30 % de l'écran, freinée ensuite, barre de charge) ; relâchée au-delà de 70 %, elle revient en place et le téléphone demande au Mac, via le relais Vercel, la fiche du prochain rendez-vous qui n'en a pas.
- Pendant ce temps, la fabrication s'affiche : une carte miniature dont les lignes se remplissent au rythme des vraies étapes publiées par le Mac (CRM, bourse, LinkedIn, presse, rédaction, audio), une barre d'avancement, l'étape en cours qui scintille. Fin : « Votre carte est prête », coche dessinée, puis la carte rejoint le paquet et s'affiche. On peut réduire la fabrication en pastille et continuer à parcourir ses cartes.
- La fiche reste enregistrée sur le Mac et publiée sur le relais : elle n'est plus jamais à refaire.
- Mouvement : `transform` et `opacity` seulement ; balayage lumineux de la miniature en linéaire (mouvement continu), le reste en `cubic-bezier(0.23, 1, 0.32, 1)` ; ressort court pour la coche.
