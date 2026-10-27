# Audit UX / UI et fluidité - application du téléphone (14/10/2026)

Grille : skill `animation-performance` d'Emil Kowalski (budget de 8 ms par image sur un écran 120 Hz, `transform` / `opacity` d'abord, nommer la cause avant de corriger). Périmètre : `relais/mobile`. Chaque constat dit s'il est vérifié dans le code / le navigateur de test, ou s'il demande un essai sur iPhone.

## Constats et corrections, du plus coûteux au moins coûteux

**1. Changement de carte : l'ancienne carte réapparaissait une image** - `Pile.tsx`
Cause : remise à zéro de la position (`x.set(0)`) avant que React n'ait mis la nouvelle carte en place (état intermédiaire peint).
Avant : `onIndex(i); x.set(0)` dans la même fonction.
Après : remise à zéro dans un `useLayoutEffect` sur l'index, exécuté avant la peinture.
Vérifié : traces image par image dans le navigateur, 0 retour en arrière.

**2. Changement de carte : la nouvelle carte était reconstruite au moment où elle prenait la place** - `Pile.tsx`
Cause : la carte de dessous n'avait que son bandeau ; la carte du dessus était démontée puis remontée (plan, lecteur, boutons) en pleine animation, sur le fil principal.
Après : la carte courante et ses deux voisines restent construites (clé = rendez-vous) et changent seulement de rôle (dessus / dessous / cachée, `inert`). Plus aucun montage pendant le geste ; le contenu est identique avant et après l'échange.
Vérifié : dans le navigateur (cartes construites : précédente, courante, suivante).

**3. Raccourcis Motion `x` / `rotate` / `scale` sur la carte, la carte de dessous et le fantôme** - `Pile.tsx`
Cause : ces raccourcis passent par des variables CSS, non accélérées.
Après : une seule chaîne `transform` calculée (`translateX(...) rotate(...)`, `scale(...)`).
Vérifié : dans le code.

**4. Titre du jour transformé lettre par lettre pendant le changement de carte** - `Pile.tsx`
Cause : `TextMorph` lance une animation de mise en page par lettre, sur le fil principal, au moment exact où la carte part.
Après : fondu + glissement de 6 px, 200 ms.
Vérifié : dans le code.

**5. Accueil : tout le contenu se construisait pendant que le logo montait dans l'en-tête** - `Accueil.tsx`
Cause : animation de mise en page partagée (`layoutId`) pendant un gros montage React (le piège du tableau de bord Vercel cité par Emil).
Après : le contenu est construit pendant l'intro, invisible, et ne fait qu'apparaître (`opacity` / `transform`).
Vérifié : dans le code.

**6. Dictée : les barres du micro faisaient un rendu React à chaque image et animaient `height`** - `App.tsx`
Cause : `setState` dans `requestAnimationFrame` + propriété de mise en page.
Après : les barres sont écrites directement dans le DOM en `transform: scaleY()` ; la durée ne change qu'une fois par seconde.
Vérifié : dans le code. À essayer sur iPhone pendant une vraie dictée.

**7. Plan du client : les tuiles apparaissaient d'un coup, décodées sur le fil principal** - `Plan.tsx`
Après : `decoding="async"` et apparition en fondu de 300 ms à leur chargement.

**8. Boutons enfoncés deux fois, et boutons enfoncés pendant un glissé** - `index.css`, `App.tsx`
Cause : la règle globale `:active { scale: 0.97 }` s'ajoutait au `whileTap` des grandes tuiles, et s'appliquait au bouton sous le doigt au début d'un glissé.
Après : les tuiles sont exclues (`.sans-pression`), et rien ne s'enfonce pendant qu'une carte glisse (`[data-glisse]`).

**9. Heure et batterie de l'iPhone illisibles dans l'app installée** - `index.css`, `App.tsx`
Cause : barre d'état « noire translucide » (texte blanc) au-dessus d'un en-tête clair.
Après : une fine bande marine sous la barre d'état, seulement dans l'app installée.
À vérifier sur iPhone.

**10. Déjà en place et conservé** : grain de fond sans mode de fusion, aucun flou d'arrière-plan, aucun `transition: all`, défilement natif dans la carte, bandeaux défilants en CSS (hors fil JavaScript), particules de l'accueil calculées sur la carte graphique et arrêtées après l'intro.

## À vérifier sur un vrai iPhone

Le navigateur de test n'a pas de carte graphique : il ne mesure pas la fluidité réelle. À enregistrer sur l'iPhone (Safari, inspecteur à distance, panneau Performance) : glisser cinq cartes de suite rapidement, ouvrir et refermer la semaine à mi-course, l'intro de l'accueil, une dictée de 30 secondes.
