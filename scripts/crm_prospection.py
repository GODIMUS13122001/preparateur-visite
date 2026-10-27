"""Lecture et écriture du CRM de prospection (fichier Excel séparé du CRM clients).

Même conventions que crm_lib : en-têtes bleu foncé = saisie, orange = rempli par l'agent,
date de référence = Paramètres!B3. Le fichier actif est indiqué par data/.crm_prospection_actif :
tant que le commercial n'a rien déposé, il n'y a pas de CRM de prospection (aucun fichier par défaut).
"""
from __future__ import annotations

import shutil
from datetime import date, datetime
from pathlib import Path

import openpyxl

from crm_lib import DOSSIER_DATA, _lire_onglet, en_date, slug

FICHIER_ACTIF = DOSSIER_DATA / ".crm_prospection_actif"
ONGLETS = ["Commerciaux", "Prospects", "Interlocuteurs", "Rendez-vous", "Critères", "Activités"]
ETAPES = ["Lead", "Rendez-vous obtenu", "Découverte faite", "Qualifié", "Abandonné"]
CRITERES_PREMIER_RDV = 7  # les critères 1 à 7 sont visés dès le premier rendez-vous


def chemin_crm() -> Path | None:
    if FICHIER_ACTIF.exists():
        nom = FICHIER_ACTIF.read_text(encoding="utf-8").strip()
        if nom and (DOSSIER_DATA / nom).exists():
            return DOSSIER_DATA / nom
    return None


def est_rdv_prospection(rid: str) -> bool:
    return (rid or "").upper().startswith("RP")


class CRMProspection:
    def __init__(self, chemin: Path | None = None):
        self.chemin = Path(chemin) if chemin else chemin_crm()
        if self.chemin is None:
            raise FileNotFoundError("Aucun CRM de prospection n'a encore été déposé.")
        wb = openpyxl.load_workbook(self.chemin)
        manquants = [o for o in ONGLETS + ["Paramètres"] if o not in wb.sheetnames]
        if manquants:
            raise ValueError("onglets manquants : " + ", ".join(manquants))
        self.onglets = {nom: _lire_onglet(wb[nom]) for nom in ONGLETS}
        self.date_ref: date = en_date(wb["Paramètres"]["B3"].value)
        if self.date_ref is None:
            raise ValueError("Paramètres!B3 (date de l'export) est vide ou n'est pas une date")
        self.commerciaux = {l["ID commercial"]: l for l in self.lignes("Commerciaux")}
        self.prospects = {l["ID prospect"]: l for l in self.lignes("Prospects")}
        self.interlocuteurs = {l["ID interlocuteur"]: l for l in self.lignes("Interlocuteurs")}
        self.rdv = {l["ID rendez-vous"]: l for l in self.lignes("Rendez-vous")}

    def lignes(self, onglet: str) -> list[dict]:
        return self.onglets[onglet].lignes

    def nom_prospect(self, pid) -> str | None:
        p = self.prospects.get(pid)
        return p["Nom de l'entreprise"] if p else None

    def nom_interlocuteur(self, iid) -> str | None:
        i = self.interlocuteurs.get(iid)
        return f"{i['Prénom']} {i['Nom']}" if i else None

    def nom_commercial(self, uid) -> str | None:
        c = self.commerciaux.get(uid)
        return f"{c['Prénom']} {c['Nom']}" if c else None

    def base(self, rid: str) -> str:
        return f"{rid}_{slug(self.nom_prospect(self.rdv[rid]['ID prospect']))}"

    def rdv_du_jour(self, jour: date, uid: str | None = None) -> list[dict]:
        res = [r for r in self.lignes("Rendez-vous") if en_date(r["Date"]) == jour and (uid is None or r.get("ID commercial") == uid)]
        return sorted(res, key=lambda r: str(r.get("Heure de début")))

    def criteres(self, pid) -> list[dict]:
        return sorted([c for c in self.lignes("Critères") if c.get("ID prospect") == pid], key=lambda c: c.get("N°") or 0)

    def avancement(self, pid) -> dict:
        """Étape du funnel et critères : ceux du premier rendez-vous (1 à 7) et l'ensemble (13)."""
        cr = self.criteres(pid)
        acquis = lambda c: c.get("Statut") in ("Obtenu", "Sans objet")
        premiers = [c for c in cr if (c.get("N°") or 99) <= CRITERES_PREMIER_RDV]
        return {
            "etape": self.prospects[pid].get("Étape du funnel"),
            "etapes": ETAPES[:4],
            "decouverte": {"obtenus": sum(1 for c in premiers if acquis(c)), "partiels": sum(1 for c in premiers if c.get("Statut") == "Partiel"),
                           "total": len(premiers)},
            "qualification": {"obtenus": sum(1 for c in cr if acquis(c)), "total": len(cr)},
            "criteres": [{"n": c.get("N°"), "critere": c.get("Critère"), "statut": c.get("Statut") or "À obtenir", "quand": c.get("Quand"),
                          "preuve": c.get("Preuve")} for c in cr],
        }

    def rang(self, rid) -> str:
        return self.rdv[rid].get("Rang du rendez-vous") or ""


def deposer(source: Path, nom: str) -> Path:
    """Vérifie et installe un fichier comme CRM de prospection actif (l'ancien est gardé en sauvegarde)."""
    CRMProspection(source)  # lève une erreur claire si le fichier n'est pas un CRM de prospection
    cible = DOSSIER_DATA / nom
    if cible.exists() and cible.resolve() != source.resolve():
        (DOSSIER_DATA / "sauvegardes").mkdir(exist_ok=True)
        shutil.copy2(cible, DOSSIER_DATA / "sauvegardes" / f"{cible.stem}_{datetime.now():%Y%m%d-%H%M%S}.xlsx")
    if cible.resolve() != source.resolve():
        source.replace(cible)
    FICHIER_ACTIF.write_text(nom, encoding="utf-8")
    return cible
