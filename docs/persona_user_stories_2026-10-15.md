# Persona acheteur et user stories - Préparateur de visite

Rédigé le 15/10/2026 pour repérer ce que l'étude de cas a pu oublier. Les personas sont des **hypothèses** construites à partir du cahier des charges, de `PRODUCT.md` et du CRM de démonstration : aucun entretien réel ne les appuie, à valider avec un vrai client.

Statuts : ✅ couvert · 🟡 partiel · ❌ non couvert · ❔ à vérifier. Les statuts décrivent le démonstrateur tel qu'il est le 15/10.

---

## 1. Le persona acheteur (celui qui signe)

**Catherine Valette, directrice commerciale France** d'un industriel B2B de taille intermédiaire (profil Orvane Solutions : emballages et équipements de conditionnement, 250 M€ de CA, 30 commerciaux terrain, clients grands comptes agroalimentaire, cosmétique, santé).

| | |
|---|---|
| **Ce qu'elle veut** | Plus de temps en clientèle et moins en saisie. Un CRM fiable pour ses prévisions. Des visites préparées de façon homogène, y compris par les juniors. Garder la connaissance client quand un commercial s'en va. |
| **Ce qui la gêne aujourd'hui** | Des comptes rendus saisis le soir, incomplets ou jamais faits. Une revue de pipeline du lundi qui repose sur la mémoire de chacun. Des commerciaux qui découvrent une réclamation ouverte devant le client. |
| **Comment elle mesure** | Taux de comptes rendus saisis sous 24 h, fraîcheur des prochaines étapes dans le CRM, nombre de visites par semaine, taux de transformation des affaires, temps de montée en compétence d'un nouveau. |
| **Qui décide avec elle** | DSI (intégration CRM, Outlook, parc de téléphones), RSSI (données clients envoyées à une IA), DPO (contacts personnels, notes vocales), Sales Ops (administrateur du CRM), achats (coût par utilisateur), managers régionaux (adoption), et le CSE (outil qui enregistre la voix et la position des salariés). |
| **Ses objections probables** | « Mes données clients partent où ? » · « Combien par commercial et par mois ? » · « Et s'il invente un chiffre devant le client ? » · « Mes commerciaux ne l'utiliseront pas. » · « On est sur Salesforce, Outlook, Teams et des téléphones Android. » · « Comment je prouve le gain au comité de direction ? » |
| **Ce qui la fait signer** | Une démo sur ses propres comptes, un pilote de 6 semaines sur une équipe avec un avant/après chiffré, et un feu vert écrit de la DSI et du DPO. |

### Les utilisateurs autour d'elle

- **Julien Morel, commercial terrain** (utilisateur principal) : 4 à 6 visites par jour, beaucoup de voiture, réfractaire à la saisie, juge l'outil sur son téléphone dès la première semaine.
- **Le manager régional** : anime 8 commerciaux, veut savoir ce qui s'est dit chez ses grands comptes sans relancer chacun.
- **L'ADV / service client** : reçoit les demandes de devis, de délai et les réclamations remontées des visites.
- **La DSI, le RSSI et le DPO** : déploient, sécurisent et répondent de l'outil.

---

## 2. Ce qu'on a pu oublier : les 12 manques qui comptent le plus

Classés par risque pour une vente réelle (pas pour la démo interne).

1. **Les e-mails du client.** Le cas d'usage dit que le commercial « fouille le CRM *et ses e-mails* ». La fiche ne lit que le CRM et internet. Les derniers échanges (devis envoyé, relance, plainte par mail) manquent.
2. **Un commercial ne doit voir que ses comptes.** L'app lit l'export complet et le commercial est fixé dans le code. Aucun droit d'accès par personne, aucune connexion d'entreprise (SSO).
3. **Le parc réel : Windows, Android, Outlook, Teams.** App Mac uniquement, téléphone testé en simulation Chrome (jamais sur un vrai iPhone), agenda Google. La cible est documentée mais rien n'est construit.
4. **Les suites de la visite.** Après validation, seul le CRM est mis à jour. Rien n'est prévu pour le mail récapitulatif au client, le rendez-vous suivant dans l'agenda, la demande de devis à l'ADV ou la réclamation à ouvrir.
5. **Les prospects et nouveaux comptes.** Un rendez-vous de l'agenda absent du CRM s'affiche, mais on ne peut pas préparer sa fiche. C'est pourtant là qu'une recherche web aide le plus.
6. **La vue du manager.** Il n'a aucun écran, aucune synthèse hebdomadaire des visites et aucune alerte (affaire qui recule, client mécontent).
7. **La preuve du ROI.** On compte le coût de chaque fiche, mais ni le temps gagné, ni le taux de comptes rendus saisis, ni la fraîcheur du CRM. Catherine n'a rien à montrer à son comité.
8. **RGPD et salariés.** Rien n'est prévu sur la durée de conservation des notes vocales et des transcriptions, l'information des contacts, l'information du CSE, ni le registre de traitement. Les rendez-vous transitent aussi par ntfy.sh, un service public, ce qui est déjà noté comme limite.
9. **L'interlocuteur, pas seulement l'entreprise.** La fiche ne dit rien de la personne rencontrée (nouveau directeur des achats : parcours, ancienneté), alors que c'est souvent ce que le commercial veut savoir.
10. **Ce qu'il faut apporter.** Offres en cours, conditions tarifaires, contrat, échantillons, catalogue : la fiche ne prépare pas la sacoche.
11. **Le jour où ça ne marche pas.** Mac éteint, quota Claude épuisé à 8h, LinkedIn ou la presse indisponibles : aucune fiche de secours (le seul CRM, sans recherche) n'est envoyée automatiquement.
12. **Poser une question.** Le commercial ne peut pas demander « quel prix on leur a fait l'an dernier sur les étuis ? ». La fiche est figée, il n'y a pas de conversation.

---

## 3. User stories

### A. Avant la visite - le commercial

| # | En tant que commercial, je veux... | afin de... | Statut |
|---|---|---|---|
| A1 | recevoir ma fiche sans rien demander, avant chaque rendez-vous de mon agenda | ne jamais arriver non préparé | 🟡 Automatique, mais seulement si le Mac reste allumé et que l'agenda est un Google Agenda |
| A2 | écouter ma fiche en conduisant, en 2 minutes | me préparer sans lire | ✅ Mode voiture, écoute hors connexion. CarPlay limité à l'audio (PWA) |
| A3 | lire une fiche d'une page, chaque info avec sa source | savoir ce qui est sûr et ce qui vient d'internet | ✅ |
| A4 | voir les réclamations ouvertes et les retards de livraison | ne pas être pris au dépourvu | ✅ |
| A5 | voir les derniers e-mails échangés avec le client | savoir où on en est vraiment | ❌ Manque n°1 |
| A6 | préparer toute ma tournée de demain la veille au soir | organiser ma journée | 🟡 Le skill le sait faire, l'app prépare rendez-vous par rendez-vous |
| A7 | une fiche pour un prospect absent du CRM | préparer un premier rendez-vous | ❌ Manque n°5 |
| A8 | savoir qui est la personne que je rencontre | adapter mon discours | 🟡 Notes du CRM seulement, rien sur son parcours (manque n°9) |
| A9 | savoir quels produits proposer en plus | développer le compte | 🟡 CA par produit et affaires en cours, mais aucune suggestion tirée du catalogue |
| A10 | l'actualité de son concurrent principal chez ce client | préparer mes arguments | 🟡 Concurrent cité depuis le CRM, pas de veille sur lui |
| A11 | savoir quoi apporter (offre, tarifs, échantillons) | ne rien oublier | ❌ Manque n°10 |
| A12 | l'heure de départ et le temps de trajet | ne pas être en retard | 🟡 Plan, Waze, Google Maps, sans temps de trajet ni alerte de départ |
| A13 | que la fiche suive un rendez-vous déplacé ou annulé | ne pas recevoir une fiche inutile | ❔ À vérifier |
| A14 | rejoindre une visio d'un geste depuis la carte | ne pas chercher le lien | ❔ Cadre « visio » affiché, lien de connexion à vérifier |
| A15 | poser une question sur le compte | aller chercher un détail | ❌ Manque n°12 |
| A16 | ajuster ce que la fiche contient (sans bourse, sans LinkedIn) | aller à l'essentiel | ✅ Interrupteurs du Workflow (sur le Mac seulement) |

### B. Après la visite - le commercial

| # | En tant que commercial, je veux... | afin de... | Statut |
|---|---|---|---|
| B1 | dicter mon compte rendu en sortant du rendez-vous | ne plus rien saisir le soir | ✅ Dictée sur le téléphone, transcription sur le Mac |
| B2 | relire et valider avant que le CRM change | garder la main | ✅ Validation sur le téléphone, rien n'est écrit sans elle |
| B3 | corriger un champ (résultat, échéance, phase) avant de valider | que le CRM dise vrai | ❔ Question jamais tranchée |
| B4 | corriger le texte du compte rendu à la main | rectifier une erreur de transcription | ❔ Question jamais tranchée |
| B5 | dicter même sans réseau | travailler en zone blanche | 🟡 Note gardée sur le téléphone, envoyée plus tard (non testé sur iPhone) |
| B6 | envoyer au client un mail récapitulatif préparé | faire bonne impression et garder une trace | ❌ Manque n°4 |
| B7 | que le prochain rendez-vous ou la relance aille dans mon agenda | ne pas oublier | ❌ Seulement dans le CRM |
| B8 | transmettre une demande de devis ou une réclamation au bon service | que ça avance sans moi | ❌ |
| B9 | ajouter une photo (rayon, emballage concurrent, carte de visite) | garder ce que j'ai vu | ❌ |
| B10 | dicter en plusieurs fois | compléter quand ça me revient | ❔ À vérifier |

### C. Le manager régional

| # | En tant que manager, je veux... | afin de... | Statut |
|---|---|---|---|
| C1 | une synthèse hebdomadaire des visites de mon équipe | savoir ce qui se passe chez mes grands comptes | ❌ |
| C2 | être alerté quand une affaire importante recule ou qu'un client est mécontent | intervenir à temps | ❌ |
| C3 | un pipeline à jour sans relancer mes commerciaux | préparer la revue du lundi | 🟡 Le CRM se remplit, mais rien ne lui est présenté |
| C4 | voir qui prépare ses visites | accompagner ceux qui en ont besoin | ❌ |

### D. La directrice commerciale (acheteuse)

| # | En tant que directrice commerciale, je veux... | afin de... | Statut |
|---|---|---|---|
| D1 | mesurer le temps gagné et le taux de comptes rendus saisis | justifier l'investissement | ❌ Manque n°7 |
| D2 | connaître le coût par commercial et par mois | budgéter | 🟡 Coût par fiche visible, pas de cumul mensuel ni par personne |
| D3 | une fiche de même qualité pour tous mes commerciaux | homogénéiser les visites | ✅ Même modèle de fiche pour tous |
| D4 | adapter le modèle de fiche à mon métier | coller à nos pratiques | 🟡 Possible en modifiant un fichier, rien dans l'app |
| D5 | qu'un nouveau commercial reprenne un portefeuille vite | ne pas perdre la connaissance client | 🟡 La fiche résume l'historique, mais il n'y a pas de synthèse de portefeuille |

### E. DSI, RSSI, DPO, Sales Ops

| # | En tant que..., je veux... | afin de... | Statut |
|---|---|---|---|
| E1 | DSI : brancher Salesforce ou HubSpot plutôt qu'un export Excel | avoir des données à jour | 🟡 Cible documentée (`crm_lib.py` devient un adaptateur), non construite |
| E2 | DSI : Outlook et Teams plutôt que Google et ntfy | rester dans notre environnement | 🟡 Cible documentée, connecteur Microsoft 365 bloqué par l'autorisation administrateur |
| E3 | DSI : déployer sur Windows et Android | couvrir tout le parc | ❌ Manque n°3 |
| E4 | DSI : que ça tourne sans le Mac du commercial | fiabiliser | 🟡 Cible documentée (tâches planifiées dans le cloud) |
| E5 | RSSI : connexion d'entreprise et droits par commercial | qu'aucun commercial ne voie tout le CRM | ❌ Manque n°2 |
| E6 | RSSI : savoir quelles données partent vers Claude et vers internet | évaluer le risque | 🟡 Documenté (`architecture.md`). Les agents de presse ne reçoivent aucune donnée du CRM ✅ |
| E7 | DPO : une durée de conservation des notes vocales et des fiches | être en règle | ❌ Manque n°8 |
| E8 | Sales Ops : un historique de chaque écriture dans le CRM | auditer et revenir en arrière | 🟡 Copie de sauvegarde avant chaque écriture, pas de journal lisible |
| E9 | Sales Ops : gérer un CRM modifié entre la préparation et la validation | éviter d'écraser une saisie | ❔ À vérifier |
| E10 | Achats : un coût prévisible | signer | 🟡 Abonnement Claude de chaque utilisateur, consommation variable selon le quota |

### F. Quand ça se passe mal

| # | En tant que commercial, je veux... | afin de... | Statut |
|---|---|---|---|
| F1 | recevoir au moins une fiche CRM quand internet ou Claude est indisponible | ne jamais partir sans rien | ❌ Manque n°11 |
| F2 | savoir clairement si ma fiche est en retard ou a échoué | ne pas attendre pour rien | 🟡 Visible dans le Workflow sur le Mac, pas sur le téléphone |
| F3 | que la fiche dise quand une information n'a pas pu être vérifiée | ne pas citer un chiffre faux | ✅ Rubrique « Données manquantes », sources datées |

---

## 4. Ce que je propose d'en faire

**Pour la démo**, deux manques se voient en trois minutes de questions et sont faciles à raconter :
- le mail récapitulatif au client après validation (B6), qui rend visible le gain de la phase « après » ;
- la fiche de secours CRM seul (F1), qui répond à « et si ça plante ? ».

**Pour le discours commercial**, les manques n°1, 2, 3 et 8 relèvent de la cible (connecteurs Microsoft 365 et CRM, déploiement Enterprise, RGPD). Il faut les citer avant que le client le fasse, avec la réponse prévue dans `architecture.md` → « Passage à la cible ».

**À trancher par Antoine** : B3 et B4 (questions ouvertes depuis le 14/10), et la vérification de A13, A14, B10 et E9.
