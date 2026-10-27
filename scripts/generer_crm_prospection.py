"""Génère le CRM de prospection de démonstration (fichier Excel séparé du CRM clients).

Usage : .venv/bin/python scripts/generer_crm_prospection.py [--sortie "CRM prospection/CRM_Prospection_Orvane_demo_20261015.xlsx"]

Même conventions que le CRM clients : en-têtes bleu foncé = saisie, orange = rempli par l'agent,
identifiants stables qui relient les onglets, date de référence dans Paramètres!B3.
Les entreprises sont réelles (CAC 40, absentes du CRM clients) ; interlocuteurs, notes et rendez-vous sont fictifs.
"""
from __future__ import annotations

import argparse
from datetime import date, datetime, time
from pathlib import Path

import openpyxl
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.datavalidation import DataValidation
from openpyxl.worksheet.table import Table, TableStyleInfo

RACINE = Path(__file__).resolve().parent.parent
BLEU, ORANGE = "FF1F3864", "FFC55A11"
DATE_EXPORT = date(2026, 10, 15)

ETAPES = ["Lead", "Rendez-vous obtenu", "Découverte faite", "Qualifié", "Abandonné"]
CRITERES = [  # (n°, critère, quand on l'obtient)
    (1, "Situation", "1er rendez-vous"),
    (2, "Problème réel", "1er rendez-vous"),
    (3, "Impact chiffré", "1er rendez-vous"),
    (4, "Objectif et gain attendu", "1er rendez-vous"),
    (5, "Urgence et échéance", "1er rendez-vous"),
    (6, "Priorité", "1er rendez-vous"),
    (7, "Fournisseur en place et concurrence", "1er rendez-vous"),
    (8, "Décideur économique", "Ébauché au 1er, confirmé ensuite"),
    (9, "Processus de décision", "Ébauché au 1er, confirmé ensuite"),
    (10, "Champion", "Rendez-vous suivants"),
    (11, "Budget", "Rendez-vous suivants"),
    (12, "Critères de choix", "Rendez-vous suivants"),
    (13, "Processus d'achat", "Rendez-vous suivants"),
]
STATUTS_CRITERE = ["À obtenir", "Partiel", "Obtenu", "Sans objet"]
ROLES = ["Acheteur économique", "Évaluateur technique", "Utilisateur", "Champion possible", "À déterminer"]
TYPES_RDV = ["Visite sur site", "Visio"]
TYPES_ACTIVITE = ["Appel", "E-mail", "Visite terrain", "Réunion visio", "Salon"]
COULEURS = ["Rouge", "Jaune", "Vert", "Bleu"]

COMMERCIAUX = [
    ["U002", "Julien", "Morel", "julien.morel@orvane-solutions.example", "Commercial terrain", "Hauts-de-France et Île-de-France"],
]

# Données publiques des entreprises (sites et sièges). Le reste (notes, origine du contact) est fictif.
PROSPECTS = [
    ["PR001", "Hermès", "https://www.hermes.com", "hermes.com",
     "Maison de luxe française : maroquinerie, soie, prêt-à-porter, parfums et beauté.", "Grande consommation", "Luxe : maroquinerie, parfums et beauté",
     "10 000 et plus", "Plus de 10 Md€", "24 rue du Faubourg Saint-Honoré", "75008", "Paris", "Île-de-France", "France", "Oui", "RMS.PA",
     "U002", "Rendez-vous obtenu", "Salon Paris Packaging Week (janvier 2026), échange sur le stand", date(2026, 2, 3),
     "Non connu",
     "Appel du 02/10 : Claire Vasseur accepte un premier rendez-vous. Elle dit travailler avec plusieurs fabricants européens de coffrets et trouver les délais tendus en période de lancement. Rien sur le budget.",
     None],
    ["PR002", "EssilorLuxottica", "https://www.essilorluxottica.com", "essilorluxottica.com",
     "Groupe mondial de l'optique : verres correcteurs, montures, lunettes de soleil et distribution.", "Pharmaceutique et santé", "Optique",
     "10 000 et plus", "Plus de 10 Md€", "147 rue de Paris", "94220", "Charenton-le-Pont", "Île-de-France", "France", "Oui", "EL.PA",
     "U002", "Rendez-vous obtenu", "Demande entrante via le formulaire du site d'Orvane (étuis de lunettes)", date(2026, 9, 22),
     "Non connu",
     "Formulaire du 22/09 : demande d'information sur des étuis et coffrets en matériaux recyclés. Rappel le 25/09, visio acceptée.",
     None],
    ["PR003", "Kering", "https://www.kering.com", "kering.com",
     "Groupe de luxe : maisons de mode et maroquinerie, et Kering Beauté (parfums et cosmétiques).", "Grande consommation", "Luxe : mode, maroquinerie et beauté",
     "10 000 et plus", "Plus de 10 Md€", "40 rue de Sèvres", "75007", "Paris", "Île-de-France", "France", "Oui", "KER.PA",
     "U002", "Découverte faite", "Recommandation d'un ancien acheteur rencontré au salon Luxe Pack Monaco (septembre 2025)", date(2026, 6, 10),
     "Deux fournisseurs de coffrets, dont un en Italie (noms non communiqués)",
     "Premier rendez-vous le 01/10 avec Sophie Garnier (Kering Beauté). Bon échange. Deuxième rendez-vous fixé le 19/10 avec le responsable qualité.",
     None],
    ["PR004", "Carrefour", "https://www.carrefour.com", "carrefour.com",
     "Groupe de distribution alimentaire : hypermarchés, supermarchés, proximité, e-commerce, marques propres.", "Grande consommation", "Distribution alimentaire et marques propres",
     "10 000 et plus", "Plus de 10 Md€", "93 avenue de Paris", "91300", "Massy", "Île-de-France", "France", "Oui", "CA.PA",
     "U002", "Rendez-vous obtenu", "Prospection téléphonique (campagne marques propres, septembre 2026)", date(2026, 9, 15),
     "Non connu",
     "Appel du 29/09 : Julie Martin accepte un rendez-vous pour parler des étiquettes et étuis des produits à marque Carrefour. Elle évoque des appels d'offres annuels.",
     None],
    ["PR005", "Air Liquide", "https://www.airliquide.com", "airliquide.com",
     "Groupe industriel des gaz, technologies et services pour l'industrie et la santé.", "Équipements et matériaux", "Gaz industriels et médicaux",
     "10 000 et plus", "Plus de 10 Md€", "75 quai d'Orsay", "75007", "Paris", "Île-de-France", "France", "Oui", "AI.PA",
     "U002", "Rendez-vous obtenu", "Recommandation interne (un collègue d'Orvane, secteur santé)", date(2026, 10, 1),
     "Non connu",
     "Mail du 06/10 : Nicolas Perrin (activité santé) accepte une visio de 45 minutes sur l'étiquetage et le conditionnement.",
     None],
    ["PR006", "Michelin", "https://www.michelin.com", "michelin.com",
     "Groupe industriel : pneumatiques, matériaux de haute technologie, services de mobilité.", "Équipements et matériaux", "Pneumatiques et matériaux",
     "10 000 et plus", "Plus de 10 Md€", "23 place des Carmes-Déchaux", "63000", "Clermont-Ferrand", "Auvergne-Rhône-Alpes", "France", "Oui", "ML.PA",
     "U002", "Lead", "Liste de prospection (grands comptes industriels Auvergne-Rhône-Alpes)", date(2026, 10, 8),
     "Non connu",
     "Pas encore de contact. Deux appels sans réponse (08/10 et 13/10).",
     None],
    ["PR007", "Cabinet Ardent", "https://www.cabinet-ardent.example", "cabinet-ardent.example",
     "Cabinet de conseil indépendant en transformation par la data et l'intelligence artificielle.", "Conseil et services", "Conseil en data et intelligence artificielle",
     None, None, None, None, "Paris", "Île-de-France", "France", "Non", None,
     "U002", "Rendez-vous obtenu", "Démonstration (prospect fictif)", date(2026, 10, 19),
     "Non connu",
     "Prospect de démonstration : entreprise et interlocutrice fictives : les recherches web ne trouvent rien, et la fiche doit le dire sans rien inventer.",
     None],
]

INTERLOCUTEURS = [
    ["IP001", "PR001", "Claire", "Vasseur", "Directrice achats emballages", "Achats", "À déterminer", "claire.vasseur@exemple-prospect.example", "+33 1 00 00 00 01", None, "Salon", "Directe, a demandé des exemples chiffrés au téléphone.", None, None, None],
    ["IP002", "PR002", "Marc", "Delorme", "Responsable supply chain packaging", "Supply chain", "Évaluateur technique", "marc.delorme@exemple-prospect.example", "+33 1 00 00 00 02", None, "Formulaire du site", "", None, None, None],
    ["IP003", "PR003", "Sophie", "Garnier", "Directrice des achats", "Achats (Kering Beauté)", "Acheteur économique", "sophie.garnier@exemple-prospect.example", "+33 1 00 00 00 03", None, "Recommandation", "Très structurée, a pris beaucoup de notes, veut des délais écrits.", "Bleu", "Oui", "« Elle a voulu les délais par écrit et a posé beaucoup de questions précises sur la qualité » (compte rendu du 01/10)"],
    ["IP004", "PR003", "Thomas", "Leroux", "Responsable qualité packaging", "Qualité (Kering Beauté)", "Évaluateur technique", "thomas.leroux@exemple-prospect.example", "+33 1 00 00 00 04", None, "Présenté par Sophie Garnier", "Pas encore rencontré.", None, None, None],
    ["IP005", "PR004", "Julie", "Martin", "Cheffe de groupe emballages marques propres", "Marques propres", "Évaluateur technique", "julie.martin@exemple-prospect.example", "+33 1 00 00 00 05", None, "Appel", "", None, None, None],
    ["IP006", "PR005", "Nicolas", "Perrin", "Acheteur étiquetage et conditionnement", "Achats (activité santé)", "À déterminer", "nicolas.perrin@exemple-prospect.example", "+33 1 00 00 00 06", None, "Recommandation", "", None, None, None],
    ["IP007", "PR006", "Aurélie", "Fabre", "Responsable achats emballages industriels", "Achats", "À déterminer", "aurelie.fabre@exemple-prospect.example", "+33 4 00 00 00 07", None, "Liste de prospection", "Jamais jointe.", None, None, None],
    ["IP008", "PR007", "Hélène", "Marchal", "Présidente", "Direction générale", "Acheteur économique", "helene.marchal@cabinet-ardent.example", "+33 1 00 00 00 08", None, "Démonstration", "Interlocutrice fictive.", None, None, None],
]

RDV = [  # ID, date, début, fin, type, prospect, interlocuteur, commercial, lieu, objet, rang, statut, brief, compte rendu
    ["RP001", date(2026, 10, 1), time(10, 0), time(11, 0), "Visite sur site", "PR003", "IP003", "U002", "Kering Beauté - Paris",
     "Premier rendez-vous : découverte des besoins coffrets et étuis de Kering Beauté", "1er rendez-vous", "Réalisé", "Oui",
     "Sophie Garnier a présenté l'organisation des achats de Kering Beauté. Le sujet principal : des coffrets livrés en retard sur deux lancements de parfums en 2026, avec des ruptures en magasin. Elle estime la perte à plusieurs semaines de vente sur ces références. Objectif : sécuriser les lancements de printemps 2027, la décision fournisseurs se prend en décembre. Deux fournisseurs actuels, dont un en Italie. Elle décide avec la direction des opérations ; le budget n'a pas été abordé. Elle veut nous revoir avec Thomas Leroux, responsable qualité."],
    ["RP002", date(2026, 10, 15), time(17, 30), time(18, 15), "Visio", "PR005", "IP006", "U002", "Visio",
     "Premier rendez-vous : étiquetage et conditionnement de l'activité santé", "1er rendez-vous", "Confirmé", None, None],
    ["RP003", date(2026, 10, 16), time(10, 0), time(11, 0), "Visite sur site", "PR001", "IP001", "U002", "Hermès - Pantin",
     "Premier rendez-vous : coffrets et étuis, délais en période de lancement", "1er rendez-vous", "Confirmé", None, None],
    ["RP004", date(2026, 10, 16), time(15, 0), time(15, 45), "Visio", "PR002", "IP002", "U002", "Visio",
     "Premier rendez-vous : étuis et coffrets en matériaux recyclés", "1er rendez-vous", "Confirmé", None, None],
    ["RP005", date(2026, 10, 19), time(10, 0), time(11, 30), "Visite sur site", "PR003", "IP004", "U002", "Kering Beauté - Paris",
     "Deuxième rendez-vous avec la qualité : exigences, audit fournisseur, échantillons", "2e rendez-vous", "Confirmé", None, None],
    ["RP006", date(2026, 10, 20), time(14, 30), time(15, 30), "Visite sur site", "PR004", "IP005", "U002", "Carrefour - Massy",
     "Premier rendez-vous : étiquettes et étuis des produits à marque Carrefour", "1er rendez-vous", "Confirmé", None, None],
    ["RP007", date(2026, 10, 21), time(10, 0), time(11, 0), "Visite sur site", "PR007", "IP008", "U002", "Cabinet Ardent - Paris",
     "Premier rendez-vous de démonstration avec la présidente du cabinet Ardent", "1er rendez-vous", "Confirmé", None, None],
]

# Critères déjà connus (prospect, n°) -> (statut, preuve, date, source)
CONNUS = {
    ("PR001", 7): ("Partiel", "« On travaille avec plusieurs fabricants européens de coffrets » (appel du 02/10)", date(2026, 10, 2), "Appel"),
    ("PR001", 2): ("Partiel", "« Les délais sont tendus en période de lancement » (appel du 02/10), à creuser", date(2026, 10, 2), "Appel"),
    ("PR002", 4): ("Partiel", "Demande d'étuis en matériaux recyclés (formulaire du 22/09)", date(2026, 9, 22), "Formulaire"),
    ("PR004", 13): ("Partiel", "« On passe par des appels d'offres annuels » (appel du 29/09)", date(2026, 9, 29), "Appel"),
    ("PR003", 1): ("Obtenu", "Organisation des achats de Kering Beauté présentée en détail (compte rendu du 01/10)", date(2026, 10, 1), "Compte rendu"),
    ("PR003", 2): ("Obtenu", "« Coffrets livrés en retard sur deux lancements, ruptures en magasin » (compte rendu du 01/10)", date(2026, 10, 1), "Compte rendu"),
    ("PR003", 3): ("Partiel", "« Plusieurs semaines de vente perdues sur ces références », pas de montant (compte rendu du 01/10)", date(2026, 10, 1), "Compte rendu"),
    ("PR003", 4): ("Obtenu", "« Sécuriser les lancements de printemps 2027 » (compte rendu du 01/10)", date(2026, 10, 1), "Compte rendu"),
    ("PR003", 5): ("Obtenu", "« La décision fournisseurs se prend en décembre » (compte rendu du 01/10)", date(2026, 10, 1), "Compte rendu"),
    ("PR003", 6): ("Obtenu", "Sujet présenté comme la priorité de l'année par Sophie Garnier (compte rendu du 01/10)", date(2026, 10, 1), "Compte rendu"),
    ("PR003", 7): ("Obtenu", "« Deux fournisseurs actuels, dont un en Italie » (compte rendu du 01/10)", date(2026, 10, 1), "Compte rendu"),
    ("PR003", 8): ("Partiel", "« Elle décide avec la direction des opérations » : nom non connu (compte rendu du 01/10)", date(2026, 10, 1), "Compte rendu"),
    ("PR003", 9): ("Partiel", "Décision fournisseurs en décembre, étapes non détaillées (compte rendu du 01/10)", date(2026, 10, 1), "Compte rendu"),
}

ACTIVITES = [
    ["AP001", date(2026, 1, 28), "Salon", "PR001", "IP001", "U002", "Paris Packaging Week", "Échange sur le stand, carte de visite récupérée.", "Positif", "Rappeler pour un rendez-vous", date(2026, 2, 15)],
    ["AP002", date(2026, 10, 2), "Appel", "PR001", "IP001", "U002", "Prise de rendez-vous", "Délais tendus en lancement, plusieurs fabricants européens. Rendez-vous accepté le 16/10 à Pantin.", "Positif", "Préparer le premier rendez-vous", date(2026, 10, 16)],
    ["AP003", date(2026, 9, 25), "Appel", "PR002", "IP002", "U002", "Suite au formulaire", "Intérêt pour des étuis recyclés. Visio acceptée le 16/10.", "Positif", "Préparer la visio", date(2026, 10, 16)],
    ["AP004", date(2026, 10, 1), "Visite terrain", "PR003", "IP003", "U002", "Premier rendez-vous Kering Beauté", "Voir le compte rendu du rendez-vous du 01/10.", "Positif", "Deuxième rendez-vous avec la qualité", date(2026, 10, 19)],
    ["AP005", date(2026, 9, 29), "Appel", "PR004", "IP005", "U002", "Prise de rendez-vous", "Appels d'offres annuels sur les marques propres. Rendez-vous le 20/10 à Massy.", "Positif", "Préparer le rendez-vous", date(2026, 10, 20)],
    ["AP006", date(2026, 10, 6), "E-mail", "PR005", "IP006", "U002", "Demande de rendez-vous", "Visio de 45 minutes acceptée le 15/10 à 17h30.", "Positif", "Préparer la visio", date(2026, 10, 15)],
    ["AP007", date(2026, 10, 8), "Appel", "PR006", "IP007", "U002", "Premier appel", "Pas de réponse.", "Sans réponse", "Rappeler", date(2026, 10, 13)],
    ["AP008", date(2026, 10, 13), "Appel", "PR006", "IP007", "U002", "Relance", "Pas de réponse, message laissé.", "Sans réponse", "Passer par LinkedIn ou un e-mail", date(2026, 10, 20)],
]

ONGLETS = {  # nom -> (colonnes, colonnes remplies par l'agent, largeurs)
    "Commerciaux": (["ID commercial", "Prénom", "Nom", "E-mail", "Profil métier", "Territoire"], [], None),
    "Prospects": (["ID prospect", "Nom de l'entreprise", "Site web", "Domaine du site web", "Description de l'activité", "Secteur d'activité",
                   "Sous-secteur", "Tranche d'effectif", "Chiffre d'affaires annuel (tranche)", "Adresse", "Code postal", "Ville", "Région", "Pays",
                   "Cotée en bourse", "Code bourse (Yahoo Finance)", "ID propriétaire", "Étape du funnel", "Origine du contact", "Date de création",
                   "Fournisseur en place connu", "Notes du commercial", "Motif d'abandon"], [], None),
    "Interlocuteurs": (["ID interlocuteur", "ID prospect", "Prénom", "Nom", "Intitulé du poste", "Service", "Rôle dans la décision", "E-mail",
                        "Téléphone", "Profil LinkedIn", "Origine du contact", "Notes", "Couleur", "Couleur à confirmer", "Justification de la couleur"],
                       ["Couleur", "Couleur à confirmer", "Justification de la couleur"], None),
    "Rendez-vous": (["ID rendez-vous", "Date", "Heure de début", "Heure de fin", "Type de rendez-vous", "ID prospect", "ID interlocuteur",
                     "ID commercial", "Lieu", "Objet du rendez-vous", "Rang du rendez-vous", "Statut", "Brief préparé", "Compte rendu de visite"],
                    ["Brief préparé", "Compte rendu de visite"], None),
    "Critères": (["ID critère", "ID prospect", "N°", "Critère", "Quand", "Statut", "Preuve", "Date", "Source"],
                 ["Statut", "Preuve", "Date", "Source"], None),
    "Activités": (["ID activité", "Date", "Type d'activité", "ID prospect", "ID interlocuteur", "ID commercial", "Objet", "Description",
                   "Résultat", "Prochaine action", "Échéance"], [], None),
}


def entete(ws, colonnes, agent):
    for i, nom in enumerate(colonnes, 1):
        c = ws.cell(1, i, nom)
        c.fill = PatternFill("solid", fgColor=ORANGE if nom in agent else BLEU)
        c.font = Font(bold=True, color="FFFFFFFF")
        c.alignment = Alignment(vertical="center", wrap_text=True)
        ws.column_dimensions[get_column_letter(i)].width = max(12, min(48, len(nom) + 4))
    ws.row_dimensions[1].height = 32
    ws.freeze_panes = "B2"


def remplir(ws, lignes):
    for r, ligne in enumerate(lignes, 2):
        for c, v in enumerate(ligne, 1):
            cell = ws.cell(r, c, v)
            if isinstance(v, date) and not isinstance(v, datetime):
                cell.number_format = "DD/MM/YYYY"
            elif isinstance(v, time):
                cell.number_format = "HH:MM"


def tableau(ws, nom, n_col, n_lignes):
    ref = f"A1:{get_column_letter(n_col)}{max(2, n_lignes + 1)}"
    t = Table(displayName=nom, ref=ref)
    t.tableStyleInfo = TableStyleInfo(name="TableStyleLight1", showRowStripes=True)
    ws.add_table(t)


def liste(ws, col_lettre, plage, n=500):
    dv = DataValidation(type="list", formula1=plage, allow_blank=True)
    dv.add(f"{col_lettre}2:{col_lettre}{n}")
    ws.add_data_validation(dv)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--sortie", default=str(RACINE / "CRM prospection" / "CRM_Prospection_Orvane_demo_20261015.xlsx"))
    sortie = Path(ap.parse_args().sortie)
    sortie.parent.mkdir(parents=True, exist_ok=True)

    wb = openpyxl.Workbook()
    lm = wb.active
    lm.title = "Lisez-moi"
    texte = [
        ["CRM de prospection - Orvane Solutions (données de démonstration)"],
        ["Compagnon du CRM clients : ici, uniquement les prospects (entreprises qui ne sont pas encore clientes)."],
        [],
        ["Société", "Orvane Solutions, société fictive : fabricant français d'emballages (étuis, étiquettes, coffrets, caisses) et d'équipements de conditionnement."],
        ["Date de l'export", DATE_EXPORT],
        ["Entreprises", "Six entreprises réelles du CAC 40, absentes du CRM clients. Site et siège : données publiques, à revérifier avant un usage réel."],
        ["Fictif", "Interlocuteurs, coordonnées, notes, rendez-vous, critères et historique sont inventés pour la démonstration."],
        [],
        ["Conventions"],
        ["En-tête bleu foncé", "Saisie par le commercial."],
        ["En-tête orange", "Rempli par l'agent après validation du commercial (fiche préparée, compte rendu, critères, couleur)."],
        ["Identifiants", "PR = prospect, IP = interlocuteur, RP = rendez-vous, CQ = critère, AP = activité, U = commercial."],
        [],
        ["Sales funnel", "Lead → Rendez-vous obtenu → Découverte faite (critères 1 à 7 obtenus) → Qualifié (13 critères obtenus ou sans objet) → passe au CRM clients. Abandonné : avec le motif."],
        ["13 critères", "Fusion de BANT, CHAMP, ANUM, FAINT, MEDDIC, MEDDPICC, SPICED et GPCTBA/C&I. « Sans objet » neutralise un critère qui ne compte pas dans un secteur."],
        ["Couleur", "Avant un premier rendez-vous : couleur probable lue dans le profil LinkedIn public de l'interlocuteur (colonne « Profil LinkedIn »), donnée comme hypothèse dans la fiche. Après le rendez-vous : couleur confirmée à partir du ressenti dicté par le commercial, validée par lui."],
        ["Profil LinkedIn", "Adresse exacte du profil (https://www.linkedin.com/in/...). Sans adresse, l'agent cherche le profil par nom et entreprise et s'abstient au moindre doute (homonymes). Les interlocuteurs de démonstration sont fictifs : collez l'adresse d'une vraie personne d'accord pour tester."],
    ]
    for r, ligne in enumerate(texte, 1):
        for c, v in enumerate(ligne, 1):
            cell = lm.cell(r, c, v)
            if isinstance(v, date):
                cell.number_format = "DD/MM/YYYY"
    lm["A1"].font = Font(bold=True, size=14, color=BLEU)
    lm["A9"].font = Font(bold=True)
    lm.column_dimensions["A"].width = 22
    lm.column_dimensions["B"].width = 120

    p = wb.create_sheet("Paramètres")
    p["A1"] = "Paramètres et listes de référence"
    p["A1"].font = Font(bold=True, size=13)
    p["A3"], p["B3"] = "Date de l'export", DATE_EXPORT
    p["B3"].number_format = "DD/MM/YYYY"
    p["C3"] = "Date de référence de l'agent (jamais la date système)."
    listes = [("Étape du funnel", ETAPES), ("Critère", [c[1] for c in CRITERES]), ("Quand", [c[2] for c in CRITERES]),
              ("Statut de critère", STATUTS_CRITERE), ("Rôle dans la décision", ROLES), ("Type de rendez-vous", TYPES_RDV),
              ("Type d'activité", TYPES_ACTIVITE), ("Couleur", COULEURS)]
    for col, (titre, valeurs) in enumerate(listes, 1):
        cell = p.cell(6, col, titre)
        cell.font = Font(bold=True, color="FFFFFFFF")
        cell.fill = PatternFill("solid", fgColor=BLEU)
        p.column_dimensions[get_column_letter(col)].width = 30
        for i, v in enumerate(valeurs, 7):
            p.cell(i, col, v)

    donnees = {
        "Commerciaux": COMMERCIAUX,
        "Prospects": PROSPECTS,
        "Interlocuteurs": INTERLOCUTEURS,
        "Rendez-vous": RDV,
        "Activités": ACTIVITES,
    }
    criteres, n = [], 1
    for pr in PROSPECTS:
        for num, nom, quand in CRITERES:
            statut, preuve, d, source = CONNUS.get((pr[0], num), ("À obtenir", None, None, None))
            criteres.append([f"CQ{n:03d}", pr[0], num, nom, quand, statut, preuve, d, source])
            n += 1
    donnees["Critères"] = criteres

    noms_tables = {"Commerciaux": "tbl_Commerciaux", "Prospects": "tbl_Prospects", "Interlocuteurs": "tbl_Interlocuteurs",
                   "Rendez-vous": "tbl_RendezVousProspection", "Critères": "tbl_Criteres", "Activités": "tbl_ActivitesProspection"}
    for nom, (colonnes, agent, _) in ONGLETS.items():
        ws = wb.create_sheet(nom)
        entete(ws, colonnes, agent)
        remplir(ws, donnees[nom])
        tableau(ws, noms_tables[nom], len(colonnes), len(donnees[nom]))

    ws = wb["Prospects"]
    liste(ws, "R", "=Paramètres!$A$7:$A$11")
    ws = wb["Interlocuteurs"]
    liste(ws, "G", "=Paramètres!$E$7:$E$11")
    liste(ws, "M", "=Paramètres!$H$7:$H$10")
    ws = wb["Critères"]
    liste(ws, "F", "=Paramètres!$D$7:$D$10", 2000)
    ws = wb["Rendez-vous"]
    liste(ws, "E", "=Paramètres!$F$7:$F$8")

    wb.save(sortie)
    print(sortie)


if __name__ == "__main__":
    main()
