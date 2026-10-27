"""Serveur de l'appli « Préparateur de visite ».

Lancement : .venv/bin/python app/serveur.py   puis ouvrir http://127.0.0.1:8765

- lit le CRM Excel actif (scripts/crm_lib.py) et l'agenda Google (via Claude en arrière-plan) ;
- lance la préparation d'une fiche en pilotant Claude Code (`claude -p`, skill brief-visite)
  et traduit chaque étape en langage commercial pour l'écran ;
- surveille l'agenda et envoie la fiche sur le téléphone 30 minutes avant chaque rendez-vous.
"""
from __future__ import annotations

import asyncio
import json
import os
import re
import shutil
import subprocess
import sys
import threading
import time
import urllib.parse
import uuid
from datetime import date, datetime, timedelta
from pathlib import Path
from urllib.parse import urlparse

CODE = Path(__file__).resolve().parent.parent  # le code (dans l'appli, ou le dossier du projet)
RACINE = Path(__import__("os").environ.get("PREPARATEUR_ESPACE") or CODE)  # les données de l'utilisateur
sys.path.insert(0, str(CODE / "scripts"))

import openpyxl  # noqa: E402
import uvicorn  # noqa: E402
from fastapi import Body, FastAPI, HTTPException, Request, UploadFile  # noqa: E402
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse  # noqa: E402
from fastapi.staticfiles import StaticFiles  # noqa: E402

import crm_lib  # noqa: E402
import crm_prospection  # noqa: E402
from crm_prospection import CRMProspection, est_rdv_prospection  # noqa: E402
sys.path.insert(0, str(CODE / "app"))
import execution  # noqa: E402
import relais  # noqa: E402
from crm_lib import CRM, DOSSIER_DATA, FICHIER_ACTIF, en_date, slug  # noqa: E402

BRIEFS = RACINE / "sorties" / "briefs"
CONFIG = RACINE / "config"
LOGS = RACINE / "logs"
WEB = CODE / "app" / "web" / __import__("os").environ.get("PREPARATEUR_WEB", "dist")
COMMERCIAL = "U002"  # Julien Morel, persona de la démo
JOURS = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"]
MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre",
        "octobre", "novembre", "décembre"]
MOIS_COURT = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."]

app = FastAPI(title="Préparateur de visite")

HOTES_LOCAUX = {"127.0.0.1", "localhost"}


@app.middleware("http")
async def seulement_local(request: Request, suite):
    """Refuse les requêtes venues d'un autre site (CSRF) ou d'un autre nom d'hôte (DNS rebinding)."""
    if urlparse("//" + request.headers.get("host", "")).hostname not in HOTES_LOCAUX:
        return JSONResponse({"erreur": "Hôte refusé"}, status_code=403)
    origine = request.headers.get("origin")
    if request.method not in ("GET", "HEAD", "OPTIONS") and origine and urlparse(origine).hostname not in HOTES_LOCAUX:
        return JSONResponse({"erreur": "Origine refusée"}, status_code=403)
    return await suite(request)

BRIEFS.mkdir(parents=True, exist_ok=True)
app.mount("/fichiers", StaticFiles(directory=BRIEFS), name="fichiers")


# --------------------------------------------------------------------------- outils

def date_longue(d: date) -> str:
    return f"{JOURS[d.weekday()]} {d.day} {MOIS[d.month - 1]}"


def heure(t) -> str:
    if t is None:
        return ""
    s = t.strftime("%H:%M") if hasattr(t, "strftime") else str(t)[:5]
    h, m = s.split(":")
    return f"{int(h)}h{m if m != '00' else ''}"


def euros(v) -> str:
    return "" if v is None else f"{v:,.0f}\u00a0€".replace(",", "\u202f")


_COMPTE_CACHE = {"t": 0.0, "v": None}


def compte_claude() -> dict:
    """Compte Claude connecté (mis en cache 60 s : la commande prend environ une seconde)."""
    if _COMPTE_CACHE["v"] is None or time.time() - _COMPTE_CACHE["t"] > 60:
        try:
            out = subprocess.run(["claude", "auth", "status", "--json"], capture_output=True, text=True, timeout=20)
            _COMPTE_CACHE["v"] = json.loads(out.stdout or "{}")
        except Exception:
            _COMPTE_CACHE["v"] = {}
        _COMPTE_CACHE["t"] = time.time()
    return _COMPTE_CACHE["v"] or {}


def prenom_depuis_email(email: str) -> str:
    local = (email or "").split("@")[0]
    morceau = re.split(r"[._\-+0-9]", local)[0]
    return morceau.capitalize() if len(morceau) >= 2 else ""


def prenom_utilisateur() -> str:
    """Prénom de la personne connectée : déduit de son compte Claude, sauf si elle l'a corrigé elle-même.
    Une correction n'est gardée que pour le compte qui l'a faite : un autre compte retrouve son propre prénom."""
    st = compte_claude()
    email = st.get("email") if st.get("loggedIn") else None
    profil = lire_json(CONFIG / "profil.json", {}) or {}
    if email and profil.get("email") == email and profil.get("prenom"):
        return profil["prenom"]
    return prenom_depuis_email(email) if email else (profil.get("prenom") if not profil.get("email") else "") or ""


def lire_json(p: Path, defaut=None):
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return defaut


_CACHE_CRM: dict = {}


def crm_en_cache(classe):
    """Lecture d'un CRM réutilisée tant que le fichier n'a pas changé (date de modification) :
    l'agenda d'un mois lit la journée de chaque jour, sans relire l'Excel trente fois."""
    from crm_prospection import chemin_crm as chemin_p
    chemin = chemin_p() if classe is CRMProspection else crm_lib.chemin_crm()
    if chemin is None:
        return classe()  # lève l'erreur habituelle (CRM de prospection absent)
    cle = (classe.__name__, str(chemin), chemin.stat().st_mtime)
    if cle not in _CACHE_CRM:
        _CACHE_CRM.clear() if len(_CACHE_CRM) > 4 else None
        _CACHE_CRM[cle] = classe(chemin)
    return _CACHE_CRM[cle]


def base_rdv(crm, rid: str) -> str:
    if isinstance(crm, CRMProspection):
        return crm.base(rid)
    return f"{rid}_{slug(crm.nom_entreprise(crm.rdv[rid]['ID entreprise']))}"


def fiche_etat(base: str) -> dict:
    md, html, m4a = (BRIEFS / f"{base}_fiche.md", BRIEFS / f"{base}_fiche.html", BRIEFS / f"{base}_audio.m4a")
    return {
        "prete": md.exists() and html.exists(),
        "audio": m4a.exists(),
        "preparee_le": datetime.fromtimestamp(md.stat().st_mtime).strftime("%d/%m à %Hh%M") if md.exists() else None,
        "page": f"/fichiers/{html.name}" if html.exists() else None,
        "son": f"/fichiers/{m4a.name}" if m4a.exists() else None,
    }


# --------------------------------------------------------------------------- CRM

def crm_prospection_info() -> dict:
    try:
        crm = CRMProspection()
    except FileNotFoundError:
        return {"ok": False, "absent": True, "message": "Aucun CRM de prospection déposé."}
    except Exception as e:
        return {"ok": False, "message": f"Le CRM de prospection n'a pas pu être lu : {e}"}
    return {"ok": True, "fichier": crm.chemin.name, "date_export": crm.date_ref.strftime("%d/%m/%Y"),
            "entreprises": len(crm.prospects), "rendez_vous": len(crm.rdv), "contacts": len(crm.interlocuteurs),
            "taille_ko": round(crm.chemin.stat().st_size / 1024), "depose_le": datetime.fromtimestamp(crm.chemin.stat().st_mtime).strftime("%d/%m à %Hh%M"),
            "onglets": [{"nom": o.nom, "lignes": len(o.lignes)} for o in crm.onglets.values()]}


@app.get("/api/crm")
def crm_info(mode: str = "qualifie"):
    if mode == "prospection":
        return crm_prospection_info()
    try:
        crm = CRM()
    except Exception as e:
        return {"ok": False, "message": f"Le fichier CRM n'a pas pu être lu : {e}"}
    return {"ok": True, "fichier": crm.chemin.name, "date_export": crm.date_ref.strftime("%d/%m/%Y"),
            "entreprises": len(crm.entreprises), "rendez_vous": len(crm.rdv), "contacts": len(crm.contacts),
            "taille_ko": round(crm.chemin.stat().st_size / 1024), "depose_le": datetime.fromtimestamp(crm.chemin.stat().st_mtime).strftime("%d/%m à %Hh%M"),
            "onglets": [{"nom": o.nom, "lignes": len(o.lignes)} for o in crm.onglets.values()]}


@app.post("/api/crm")
async def crm_depot(fichier: UploadFile, mode: str = "qualifie"):
    if not fichier.filename.lower().endswith(".xlsx"):
        raise HTTPException(400, "Déposez un fichier Excel (.xlsx).")
    nom = Path(fichier.filename).name
    cible = DOSSIER_DATA / nom
    tmp = DOSSIER_DATA / f".depot_{uuid.uuid4().hex}.xlsx"
    tmp.write_bytes(await fichier.read())
    if mode == "prospection":
        try:
            crm_prospection.deposer(tmp, nom)
        except Exception as e:
            tmp.unlink(missing_ok=True)
            raise HTTPException(400, f"Ce fichier ne ressemble pas au CRM de prospection attendu ({e}).")
        return crm_prospection_info()
    try:
        wb = openpyxl.load_workbook(tmp, read_only=True)
        manquants = [o for o in crm_lib.ONGLETS + ["Paramètres"] if o not in wb.sheetnames]
        wb.close()
        if manquants:
            raise ValueError("onglets manquants : " + ", ".join(manquants))
        if cible.exists():
            (DOSSIER_DATA / "sauvegardes").mkdir(exist_ok=True)
            shutil.copy2(cible, DOSSIER_DATA / "sauvegardes" / f"{cible.stem}_{datetime.now():%Y%m%d-%H%M%S}.xlsx")
        tmp.replace(cible)
        os.utime(cible)  # date de dépôt = maintenant
        FICHIER_ACTIF.write_text(nom, encoding="utf-8")
        relais.signaler_changement()
        AGENDA.update(t=0.0)
    except Exception as e:
        tmp.unlink(missing_ok=True)
        raise HTTPException(400, f"Ce fichier ne ressemble pas à l'export CRM attendu ({e}).")
    return crm_info()


@app.get("/api/crm/fichier")
def crm_fichier(mode: str = "qualifie"):
    p = CRMProspection().chemin if mode == "prospection" else CRM().chemin
    return FileResponse(p, filename=p.name)


# --------------------------------------------------------------------------- agenda Google (veille constante)

AGENDA = {"t": 0.0, "debut": None, "ok": False, "evenements": [], "message": None, "ids": None, "nouveaux": {}}
VERROU_AGENDA = threading.RLock()
PORTEE_AGENDA = 21   # jours lus à partir d'aujourd'hui
MOTS_VIDES = {"meeting", "réunion", "reunion", "rdv", "rendez-vous", "rendez", "vous", "point", "call", "visio", "avec", "chez", "le", "la", "les", "de", "du", "et", "-", "·"}


def rafraichir_agenda(force: bool = False) -> dict:
    """Lit en une fois les événements des 21 prochains jours (Claude Haiku + connecteur Google Calendar)."""
    with VERROU_AGENDA:
        debut = maintenant().date()
        if not force and AGENDA.get("t"):
            return AGENDA  # liste déjà connue : elle est tenue à jour par le script Google
        fin = debut + timedelta(days=PORTEE_AGENDA)
        prompt = (f"Liste tous les événements de mon agenda Google principal du {debut.isoformat()}T00:00:00 au {fin.isoformat()}T00:00:00 "
                  "(fuseau Europe/Paris). Réponds UNIQUEMENT par un tableau JSON "
                  "[{\"id\",\"titre\",\"debut\",\"fin\",\"lieu\"}] avec debut et fin au format ISO 8601, sans aucun texte autour.")
        try:
            out = subprocess.run(["claude", "-p", prompt, "--model", "haiku", "--output-format", "json", "--setting-sources", "project,local",
                                  "--allowedTools", "mcp__claude_ai_Google_Calendar__list_events"],
                                 capture_output=True, text=True, timeout=150, cwd=str(RACINE))
            texte = json.loads(out.stdout).get("result", "")
            m = re.search(r"\[.*\]", texte, re.S)
            evts = json.loads(m.group(0)) if m else []
            appliquer_liste_agenda(evts, "claude", debut)
        except Exception as e:
            AGENDA.update(t=time.time(), ok=False, message=f"Agenda indisponible ({type(e).__name__})")
        return AGENDA


def _debut_evt(e: dict) -> datetime | None:
    try:
        return datetime.fromisoformat(str(e["debut"])).replace(tzinfo=None)
    except Exception:
        return None


def _cle_evt(e: dict) -> str:
    return e.get("id") or f"{e.get('titre')}|{e.get('debut')}"


def lire_agenda(jour: date) -> dict:
    a = AGENDA if AGENDA.get("t") else rafraichir_agenda()
    if not a.get("debut") or not (a["debut"] <= jour < a["debut"] + timedelta(days=PORTEE_AGENDA)):
        return {"ok": False, "evenements": [], "message": "Jour hors de la période lue dans l'agenda"}
    return {"ok": a["ok"], "evenements": [e for e in a["evenements"] if (_debut_evt(e) or datetime.min).date() == jour],
            "message": a.get("message")}


def evenement_pour(rdv_entreprise: str, debut: datetime, evts: list) -> dict | None:
    for e in evts:
        d = _debut_evt(e)
        if d and crm_lib.sans_accents(rdv_entreprise) in crm_lib.sans_accents(e.get("titre", "")) and abs((d - debut).total_seconds()) < 60:
            return e
    return None


def entreprise_dans_titre(crm: CRM, titre: str) -> str | None:
    t = crm_lib.sans_accents(titre)
    for e in crm.entreprises.values():
        if crm_lib.sans_accents(e["Nom de l'entreprise"]) in t:
            return e["Nom de l'entreprise"]
    return None


def nom_depuis_titre(titre: str) -> str:
    mots = [m for m in re.split(r"\s+", titre.strip()) if crm_lib.sans_accents(m) not in MOTS_VIDES]
    return " ".join(mots).strip(" -·:").title() or titre


def evenements_hors_crm(crm: CRM, jour: date, evts: list) -> list[dict]:
    """Événements de l'agenda sans rendez-vous correspondant dans le CRM du commercial."""
    rdvs = crm.rdv_du_jour(jour, COMMERCIAL)
    res = []
    for e in evts:
        d = _debut_evt(e)
        if not d:
            continue
        lie = any(r.get("Heure de début") and evenement_pour(crm.nom_entreprise(r["ID entreprise"]), datetime.combine(jour, r["Heure de début"]), [e])
                  for r in rdvs)
        if not lie:
            res.append(e)
    return res


def est_nouveau(e: dict) -> bool:
    t = AGENDA["nouveaux"].get(_cle_evt(e))
    return bool(t and time.time() - t < 15 * 60)


def appliquer_liste_agenda(evts: list, source: str, debut: date | None = None):
    """Remplace l'agenda connu par une liste reçue (script Google ou lecture Claude), en repérant les nouveautés."""
    with VERROU_AGENDA:
        evts = [e for e in evts if e.get("debut") and "T" in str(e.get("debut"))]
        ids = {_cle_evt(e) for e in evts}
        nouveaux = []
        if AGENDA.get("ids") is not None:  # jamais au premier chargement : seulement les vrais ajouts
            for i in ids - AGENDA["ids"]:
                AGENDA["nouveaux"][i] = time.time()
                nouveaux += [e for e in evts if _cle_evt(e) == i]
        AGENDA.update(t=time.time(), debut=debut or maintenant().date(), ok=True, evenements=evts, message=None, ids=ids, source=source)
    relais.signaler_changement()
    if nouveaux:
        threading.Thread(target=prevenir_nouveaux_rdv, args=(nouveaux,), daemon=True).start()


def prevenir_nouveaux_rdv(evts: list):
    """Un rendez-vous apparaît dans l'agenda (ajouté par un client, par exemple) : le téléphone est prévenu tout de suite."""
    cfg = relais.config(CONFIG)
    if not cfg.get("url"):
        return
    try:
        crm = CRM()
    except Exception:
        crm = None
    for ev in evts:
        d = _debut_evt(ev)
        if not d or d < maintenant():
            continue
        nom, rid = None, None
        if crm:
            nom = entreprise_dans_titre(crm, ev.get("titre", ""))
            rid = next((r["ID rendez-vous"] for r in crm.rdv_du_jour(d.date(), COMMERCIAL)
                        if r.get("Heure de début") and evenement_pour(crm.nom_entreprise(r["ID entreprise"]), datetime.combine(d.date(), r["Heure de début"]), [ev])), None)
        carte = rid or "AG-" + re.sub(r"[^A-Za-z0-9]", "", _cle_evt(ev))[:24]  # même identifiant que la carte de la journée
        quand = {0: "Aujourd'hui", 1: "Demain"}.get((d.date() - maintenant().date()).days, date_longue(d.date()).capitalize())
        relais.notifier_telephone(cfg, f"Nouveau rendez-vous : {nom or nom_depuis_titre(ev.get('titre', ''))}",
                                  f"{quand} à {heure(d.time())}. Ajouté à votre agenda.", f"/?rdv={carte}")


def boucle_agenda():
    """Écoute en direct le canal où le script Google publie l'agenda à chaque changement (aucun jeton Claude)."""
    import urllib.request
    attente = 2
    depuis = "12h"  # au démarrage : reprend la dernière liste envoyée dans les 12 dernières heures
    while True:
        canal = config_push().get("topic_agenda")
        if not canal:
            time.sleep(30)
            continue
        url = f"{config_push().get('serveur', 'https://ntfy.sh').rstrip('/')}/{canal}/json?since={depuis}"
        try:
            with urllib.request.urlopen(url, timeout=90) as flux:
                attente = 2
                SCRIPT_AGENDA["connecte"] = True
                for ligne in flux:
                    msg = json.loads(ligne)
                    if msg.get("event") != "message":
                        continue
                    depuis = msg.get("id", depuis)
                    corps = msg.get("message", "")
                    if msg.get("attachment", {}).get("url"):  # message trop long : ntfy le passe en pièce jointe
                        with urllib.request.urlopen(msg["attachment"]["url"], timeout=30) as pj:
                            corps = pj.read().decode("utf-8")
                    try:
                        donnees = json.loads(corps)
                    except json.JSONDecodeError:
                        continue
                    if donnees.get("type") == "agenda":
                        deb = date.fromisoformat(str(donnees.get("debut", ""))[:10]) if donnees.get("debut") else None
                        appliquer_liste_agenda(donnees.get("evenements", []), "script", deb)
                        SCRIPT_AGENDA.update(dernier=time.time(), raison=donnees.get("raison"), evenements=len(donnees.get("evenements", [])))
        except Exception as e:
            SCRIPT_AGENDA["connecte"] = False
            if not isinstance(e, TimeoutError) and "timed out" not in str(e):
                print("écoute agenda :", e, file=sys.stderr)
        time.sleep(attente)
        attente = min(attente * 2, 60)


SCRIPT_AGENDA = {"connecte": False, "dernier": None, "raison": None, "evenements": 0}


@app.get("/api/agenda")
def agenda(jour: str):
    return lire_agenda(date.fromisoformat(jour))


@app.post("/api/agenda/rafraichir")
def agenda_rafraichir():
    """Relecture manuelle par Claude (secours, consomme un peu de quota)."""
    a = rafraichir_agenda(force=True)
    return {"ok": a["ok"], "evenements": len(a["evenements"]), "message": a.get("message")}


@app.get("/api/agenda/declencheur")
def agenda_declencheur():
    """État du déclencheur Google et code du script à installer, avec le canal privé de cet ordinateur."""
    canal = config_push().get("topic_agenda")
    cfg_relais = relais.config(CONFIG)
    if cfg_relais.get("url") and cfg_relais.get("cle_agenda"):  # via le relais Vercel (les serveurs Google sont refusés par ntfy.sh)
        adresse = f"{cfg_relais['url'].rstrip('/')}/api/agenda?cle={cfg_relais['cle_agenda']}"
    else:
        adresse = f"{config_push().get('serveur', 'https://ntfy.sh').rstrip('/')}/{canal or ''}"
    code = (CODE / "integrations" / "declencheur_agenda.gs").read_text(encoding="utf-8").replace("{{ADRESSE_AGENDA}}", adresse)
    d = SCRIPT_AGENDA.get("dernier")
    return {"canal": canal, "ecoute": SCRIPT_AGENDA["connecte"], "dernier_signal": datetime.fromtimestamp(d).strftime("%d/%m à %Hh%M") if d else None,
            "evenements": SCRIPT_AGENDA["evenements"], "source": AGENDA.get("source"), "code": code}


# --------------------------------------------------------------------------- journée

def prochaine_journee(crm: CRM) -> date:
    """À l'ouverture, on montre la journée d'aujourd'hui (horloge du Mac, ou heure simulée en mode démo)."""
    return maintenant().date()


def jours_prospection():
    crm = CRMProspection()
    compte: dict[date, int] = {}
    for r in crm.lignes("Rendez-vous"):
        d = en_date(r["Date"])
        if r.get("ID commercial") == COMMERCIAL and d and d >= crm.date_ref:
            compte[d] = compte.get(d, 0) + 1
    compte.setdefault(maintenant().date(), 0)
    return {"jours": [{"jour": d.isoformat(), "libelle": date_longue(d), "court": f"{JOURS[d.weekday()][:3]}. {d.day} {MOIS_COURT[d.month - 1]}",
                       "rendez_vous": n} for d, n in sorted(compte.items())],
            "par_defaut": maintenant().date().isoformat()}


@app.get("/api/jours")
def jours(mode: str = "qualifie"):
    """Les jours où le commercial a des rendez-vous : ceux du CRM et ceux ajoutés seulement dans l'agenda."""
    if mode == "prospection":
        try:
            return jours_prospection()
        except FileNotFoundError:
            return {"jours": [], "par_defaut": maintenant().date().isoformat()}
    crm = CRM()
    compte: dict[date, int] = {}
    for r in crm.lignes("Rendez-vous"):
        d = en_date(r["Date"])
        if r.get("ID commercial") == COMMERCIAL and d and d >= crm.date_ref:
            compte[d] = compte.get(d, 0) + 1
    if AGENDA.get("ok"):
        par_jour: dict[date, list] = {}
        for e in AGENDA["evenements"]:
            d = _debut_evt(e)
            if d:
                par_jour.setdefault(d.date(), []).append(e)
        for d, evts in par_jour.items():
            n = len(evenements_hors_crm(crm, d, evts))
            if n:
                compte[d] = compte.get(d, 0) + n
    compte.setdefault(maintenant().date(), 0)
    return {"jours": [{"jour": d.isoformat(), "libelle": date_longue(d), "court": f"{JOURS[d.weekday()][:3]}. {d.day} {MOIS_COURT[d.month - 1]}",
                       "rendez_vous": n} for d, n in sorted(compte.items())],
            "par_defaut": prochaine_journee(crm).isoformat()}


FICHE_VIDE = {"prete": False, "audio": False, "preparee_le": None, "page": None, "son": None}


def journee_prospection(jour: str | None, avec_agenda: bool) -> dict:
    j = date.fromisoformat(jour) if jour else maintenant().date()
    base = {"jour": j.isoformat(), "jour_long": date_longue(j), "prenom": prenom_utilisateur(), "agenda_ok": bool(AGENDA.get("ok")),
            "horloge": maintenant().isoformat(timespec="minutes"), "horloge_simulee": HORLOGE["decalage"] is not None}
    try:
        crm = crm_en_cache(CRMProspection)
    except FileNotFoundError:
        return {**base, "commercial": "", "rendez_vous": [], "crm_absent": True}
    evts = lire_agenda(j) if avec_agenda or AGENDA.get("t") else {"ok": False, "evenements": []}
    rdvs = []
    for r in crm.rdv_du_jour(j, COMMERCIAL):
        rid, pid = r["ID rendez-vous"], r["ID prospect"]
        p, i = crm.prospects[pid], crm.interlocuteurs.get(r.get("ID interlocuteur"), {})
        debut = datetime.combine(j, r["Heure de début"]) if r.get("Heure de début") else datetime.combine(j, datetime.min.time())
        av = crm.avancement(pid)
        rdvs.append({
            "id": rid, "source": "crm", "heure": heure(r.get("Heure de début")), "heure_fin": heure(r.get("Heure de fin")),
            "debut": debut.isoformat(), "entreprise": p["Nom de l'entreprise"], "ville": p.get("Ville"),
            "type": r.get("Type de rendez-vous"), "visio": r.get("Type de rendez-vous") == "Visio",
            "lieu": r.get("Lieu"), "objet": r.get("Objet du rendez-vous"),
            "contact": f"{i.get('Prénom', '')} {i.get('Nom', '')}".strip(), "poste": i.get("Intitulé du poste"),
            "affaire": None, "montant": None, "secteur": p.get("Sous-secteur") or p.get("Secteur d'activité"),
            "cotee": bool(p.get("Code bourse (Yahoo Finance)")), "alertes": [],
            "fiche": fiche_etat(crm.base(rid)),
            "dans_agenda": bool(evenement_pour(p["Nom de l'entreprise"], debut, evts["evenements"])),
            "envoi": ENVOIS.get(rid), "preparation": etat_job(rid), "nouveau": False, "compte_rendu": None,
            "prospect": {"etape": av["etape"], "etapes": av["etapes"], "rang": r.get("Rang du rendez-vous"),
                         "decouverte": av["decouverte"], "qualification": av["qualification"],
                         "criteres": av["criteres"], "origine": p.get("Origine du contact")},
        })
    return {**base, "commercial": crm.nom_commercial(COMMERCIAL) or "", "rendez_vous": rdvs}  # agenda_ok : état global (base)


@app.get("/api/journee")
def journee(jour: str | None = None, avec_agenda: bool = True, mode: str = "qualifie"):
    if mode == "prospection":
        return journee_prospection(jour, avec_agenda)
    crm = crm_en_cache(CRM)
    j = date.fromisoformat(jour) if jour else prochaine_journee(crm)
    evts = lire_agenda(j) if avec_agenda or AGENDA.get("t") else {"ok": False, "evenements": []}
    rdvs = []
    for r in crm.rdv_du_jour(j, COMMERCIAL):
        rid, eid = r["ID rendez-vous"], r["ID entreprise"]
        e, c = crm.entreprises[eid], crm.contacts.get(r.get("ID contact"), {})
        t = crm.transactions.get(r.get("ID transaction associée"))
        ind = crm.indicateurs_entreprise(eid)
        alertes = []
        if ind["tickets_ouverts"]:
            alertes.append(f"{ind['tickets_ouverts']} réclamation{'s' if ind['tickets_ouverts'] > 1 else ''} en cours")
        if e.get("Statut du compte") in ("À surveiller", "À risque"):
            alertes.append(f"Compte {e['Statut du compte'].lower()}")
        debut = datetime.combine(j, r["Heure de début"]) if r.get("Heure de début") else datetime.combine(j, datetime.min.time())
        base = base_rdv(crm, rid)
        rdvs.append({
            "id": rid, "source": "crm", "heure": heure(r.get("Heure de début")), "heure_fin": heure(r.get("Heure de fin")),
            "debut": debut.isoformat(), "entreprise": e["Nom de l'entreprise"], "ville": e.get("Ville"),
            "type": r.get("Type de rendez-vous"), "visio": r.get("Type de rendez-vous") == "Visio",
            "lieu": r.get("Lieu"), "objet": r.get("Objet du rendez-vous"),
            "contact": f"{c.get('Prénom', '')} {c.get('Nom', '')}".strip(), "poste": c.get("Intitulé du poste"),
            "affaire": t.get("Nom de la transaction", "").split(" - ", 1)[-1] if t else None,
            "montant": euros(t.get("Montant (€)")) if t else None,
            "secteur": e.get("Sous-secteur") or e.get("Secteur d'activité"),
            "cotee": bool(e.get("Code bourse (Yahoo Finance)")),
            "alertes": alertes, "fiche": fiche_etat(base),
            "dans_agenda": bool(evenement_pour(e["Nom de l'entreprise"], debut, evts["evenements"])),
            "envoi": ENVOIS.get(rid), "preparation": etat_job(rid), "nouveau": False,
            "compte_rendu": comptes_rendus_etat().get(rid),
        })
    # rendez-vous présents seulement dans l'agenda : on les montre, en signalant que le CRM ne sait rien
    for ev in evenements_hors_crm(crm, j, evts["evenements"]):
        d = _debut_evt(ev)
        try:
            f = datetime.fromisoformat(str(ev.get("fin"))).replace(tzinfo=None)
        except Exception:
            f = None
        connue = entreprise_dans_titre(crm, ev.get("titre", ""))
        rdvs.append({
            "id": "AG-" + re.sub(r"[^A-Za-z0-9]", "", _cle_evt(ev))[:24], "source": "agenda", "heure": heure(d.time()),
            "heure_fin": heure(f.time()) if f else "", "debut": d.isoformat(),
            "entreprise": connue or nom_depuis_titre(ev.get("titre", "")), "titre_agenda": ev.get("titre"),
            "entreprise_connue": bool(connue), "ville": "", "type": "Agenda", "visio": False, "lieu": ev.get("lieu") or "",
            "objet": "", "contact": "", "poste": "", "affaire": None, "montant": None, "secteur": "", "cotee": False,
            "alertes": [], "fiche": FICHE_VIDE, "dans_agenda": True, "envoi": None, "preparation": None, "nouveau": est_nouveau(ev),
            "compte_rendu": None,
        })
    rdvs.sort(key=lambda x: x["debut"])
    return {"jour": j.isoformat(), "jour_long": date_longue(j), "commercial": crm.nom_commercial(COMMERCIAL),
            # agenda relié ou non : état global, pas celui du jour affiché (un jour passé n'est pas relu)
            "prenom": prenom_utilisateur(), "agenda_ok": bool(AGENDA.get("ok")) or evts["ok"], "rendez_vous": rdvs,
            "horloge": maintenant().isoformat(timespec="minutes"), "horloge_simulee": HORLOGE["decalage"] is not None}


@app.get("/api/agenda/complet")
def agenda_complet(debut: str | None = None, fin: str | None = None):
    """Tous les rendez-vous d'une période, clients qualifiés, prospects et rendez-vous seulement présents dans l'agenda,
    pour la vue Agenda (indépendante du mode Qualifiés / Prospection)."""
    d0 = date.fromisoformat(debut) if debut else maintenant().date() - timedelta(days=maintenant().weekday())
    d1 = date.fromisoformat(fin) if fin else d0 + timedelta(days=6)
    if (d1 - d0).days > 62:
        raise HTTPException(400, "Période trop longue (deux mois au plus).")
    now = maintenant()
    res = []
    j = d0
    while j <= d1:
        try:
            q = journee(j.isoformat(), avec_agenda=False)["rendez_vous"]
        except Exception:
            q = []
        try:
            p = journee_prospection(j.isoformat(), False)["rendez_vous"]
        except Exception:
            p = []
        # un rendez-vous de prospection aussi présent dans l'agenda ne doit pas apparaître deux fois
        cles_p = {(x["debut"][:16], crm_lib.sans_accents(x["entreprise"])) for x in p}
        q = [r for r in q if not (r.get("source") == "agenda" and any(
            d == r["debut"][:16] and e in crm_lib.sans_accents(r.get("titre_agenda") or r["entreprise"]) for d, e in cles_p))]
        for r in q + p:
            prospect = bool(r.get("prospect"))
            fin_r = r.get("heure_fin") or ""
            debut_dt = datetime.fromisoformat(r["debut"])
            pr = r.get("preparation") or {}
            res.append({
                "id": r["id"], "jour": j.isoformat(), "debut": r["debut"], "heure": r["heure"], "heure_fin": fin_r,
                "type": "prospect" if prospect else ("agenda" if r.get("source") == "agenda" else "qualifie"),
                "entreprise": r["entreprise"], "contact": r.get("contact") or "", "poste": r.get("poste") or "",
                "lieu": r.get("lieu") or r.get("ville") or "", "visio": bool(r.get("visio")), "objet": r.get("objet") or "",
                "fiche": {"prete": r["fiche"]["prete"], "page": r["fiche"].get("page"), "audio": r["fiche"].get("audio"),
                          "son": r["fiche"].get("son"), "preparee_le": r["fiche"].get("preparee_le")},
                "en_preparation": pr.get("statut") == "en_cours",
                "etape": ({"Lead": "Contact repéré"}.get(r["prospect"]["etape"], r["prospect"]["etape"]) if prospect else None),
                "rang": (r["prospect"].get("rang") if prospect else None),
                "alertes": r.get("alertes") or [], "affaire": r.get("affaire"), "montant": r.get("montant"),
                "passe": debut_dt < now, "nouveau": bool(r.get("nouveau")),
            })
        j += timedelta(days=1)
    res.sort(key=lambda x: x["debut"])
    compte = {"qualifie": sum(1 for x in res if x["type"] == "qualifie"), "prospect": sum(1 for x in res if x["type"] == "prospect"),
              "agenda": sum(1 for x in res if x["type"] == "agenda")}
    return {"debut": d0.isoformat(), "fin": d1.isoformat(), "aujourdhui": now.date().isoformat(),
            "horloge": now.isoformat(timespec="minutes"), "rendez_vous": res, "compte": compte}


@app.get("/api/rendez-vous")
def liste_rendez_vous(jours_passes: int = 14, mode: str = "qualifie"):
    """Tous les rendez-vous du CRM du commercial, des deux dernières semaines à la fin, pour le menu « Lancer une préparation »."""
    prospection = mode == "prospection"
    try:
        crm = CRMProspection() if prospection else CRM()
    except FileNotFoundError:
        return {"rendez_vous": []}
    debut = maintenant().date() - timedelta(days=jours_passes)
    res = []
    for r in crm.lignes("Rendez-vous"):
        j = en_date(r.get("Date"))
        if r.get("ID commercial") != COMMERCIAL or not j or j < debut:
            continue
        h = r.get("Heure de début")
        quand = datetime.combine(j, h if hasattr(h, "hour") else datetime.min.time())
        nom = crm.nom_prospect(r["ID prospect"]) if prospection else crm.nom_entreprise(r["ID entreprise"])
        res.append({"id": r["ID rendez-vous"], "jour": j.isoformat(), "jour_long": date_longue(j), "heure": heure(h),
                    "entreprise": nom, "passe": quand < maintenant(), "_tri": quand})
    res.sort(key=lambda x: x.pop("_tri"))
    return {"rendez_vous": res}


def prochains_prospection(n: int) -> dict:
    try:
        crm = CRMProspection()
    except FileNotFoundError:
        return {"ok": True, "prochains": [], "lu_a": None}
    now = maintenant()
    cands = []
    for r in crm.lignes("Rendez-vous"):
        j = en_date(r.get("Date"))
        if r.get("ID commercial") != COMMERCIAL or not j:
            continue
        d = datetime.combine(j, r["Heure de début"]) if r.get("Heure de début") else datetime.combine(j, datetime.min.time())
        f = datetime.combine(j, r["Heure de fin"]) if r.get("Heure de fin") else d + timedelta(hours=1)
        cands.append((d, f, r["ID rendez-vous"]))
    cands.sort()
    a_venir = [c for c in cands if c[1] > now][:1]
    passes = [c for c in cands if c[1] <= now][-(n - len(a_venir)):] if n > len(a_venir) else []
    res = []
    for d, f, rid in passes + a_venir:
        ecart = (d.date() - now.date()).days
        res.append({"cle": rid, "rid": rid, "titre": None, "entreprise": crm.nom_prospect(crm.rdv[rid]["ID prospect"]),
                    "jour": {0: "aujourd'hui", 1: "demain", -1: "hier"}.get(ecart, date_longue(d.date())), "heure": heure(d.time()),
                    "maintenant": d <= now < f, "passe": f <= now, "nouveau": False, "crm": True, "execution": execution.derniere_pour(rid)})
    return {"ok": True, "prochains": res, "lu_a": None}


@app.get("/api/coulisses/prochains")
def coulisses_prochains(n: int = 3, mode: str = "qualifie"):
    """Le prochain rendez-vous (en cours compris) et les deux derniers déjà passés, reliés à leur dernière préparation.
    Sources : le CRM (tous les jours) et l'agenda Google (rendez-vous absents du CRM)."""
    if mode == "prospection":
        return prochains_prospection(n)
    crm = CRM()
    now = maintenant()
    a = AGENDA if AGENDA.get("t") else rafraichir_agenda()
    candidats = []  # (début, fin, rid, événement agenda)
    for r in crm.lignes("Rendez-vous"):
        j = en_date(r.get("Date"))
        if r.get("ID commercial") != COMMERCIAL or not j:
            continue
        d = datetime.combine(j, r["Heure de début"]) if r.get("Heure de début") else datetime.combine(j, datetime.min.time())
        f = datetime.combine(j, r["Heure de fin"]) if r.get("Heure de fin") else d + timedelta(hours=1)
        candidats.append((d, f, r["ID rendez-vous"], None))
    par_jour: dict[date, list] = {}
    for ev in a.get("evenements", []):
        d = _debut_evt(ev)
        if d:
            par_jour.setdefault(d.date(), []).append(ev)
    for j, evts in par_jour.items():
        for ev in evenements_hors_crm(crm, j, evts):
            d = _debut_evt(ev)
            try:
                f = datetime.fromisoformat(str(ev.get("fin"))).replace(tzinfo=None)
            except Exception:
                f = d + timedelta(hours=1)
            candidats.append((d, f, None, ev))
    candidats.sort(key=lambda c: c[0])
    a_venir = [c for c in candidats if c[1] > now][:1]
    passes = [c for c in candidats if c[1] <= now][-(n - len(a_venir)):] if n > len(a_venir) else []

    def libelle_jour(j: date) -> str:
        ecart = (j - now.date()).days
        return {0: "aujourd'hui", 1: "demain", -1: "hier"}.get(ecart, date_longue(j))

    res = []
    for d, f, rid, ev in passes + a_venir:
        ex = execution.derniere_pour(rid) if rid else None
        nom = crm.nom_entreprise(crm.rdv[rid]["ID entreprise"]) if rid else (entreprise_dans_titre(crm, ev.get("titre", "")) or nom_depuis_titre(ev.get("titre", "")))
        res.append({"cle": rid or _cle_evt(ev), "rid": rid, "titre": ev.get("titre") if ev else None, "entreprise": nom,
                    "jour": libelle_jour(d.date()), "heure": heure(d.time()), "maintenant": d <= now < f, "passe": f <= now,
                    "nouveau": est_nouveau(ev) if ev else False, "crm": bool(rid), "execution": ex})
    return {"ok": a["ok"], "prochains": res, "lu_a": datetime.fromtimestamp(a["t"]).strftime("%Hh%M") if a.get("t") else None}


@app.get("/api/executions/rdv/{rid}")
def execution_par_rdv(rid: str):
    return {"execution": execution.derniere_pour(rid.upper())}


# --------------------------------------------------------------------------- préparation d'une fiche (suivie brique par brique)

OUTILS_INTERDITS = ["Edit(scripts/**)", "Edit(.claude/**)", "Edit(app/**)", "Edit(.venv/**)", "Edit(config/**)", "Edit(CLAUDE.md)"]  # les règles Edit couvrent aussi Write
PROCESSUS: dict[str, subprocess.Popen] = {}  # id d'exécution -> processus Claude ; arrêtés avec le serveur
REGLAGES_DEFAUT = {"surveillance": True, "avance_envoi": 30, "avance_preparation": 45, "modele": "sonnet",
                   "options": {"bourse": True, "linkedin": True, "angles": "ABC", "audio": True}}


def reglages() -> dict:
    r = lire_json(CONFIG / "reglages.json", {}) or {}
    return {**REGLAGES_DEFAUT, **r, "options": {**REGLAGES_DEFAUT["options"], **r.get("options", {})}}


def etat_job(rid: str) -> dict | None:
    eid = execution.DERNIERE.get(rid)
    e = execution.EXECUTIONS.get(eid) if eid else None
    return execution.vue(e, complete=False) if e else None


def job_en_cours(rid: str) -> bool:
    eid = execution.DERNIERE.get(rid)
    return bool(eid and execution.EXECUTIONS.get(eid, {}).get("statut") == "en_cours")


def lancer_preparation(rid: str, declencheur: dict | None = None, options: dict | None = None) -> dict:
    if job_en_cours(rid):
        return execution.EXECUTIONS[execution.DERNIERE[rid]]
    prospect = est_rdv_prospection(rid)
    try:
        crm = CRMProspection() if prospect else CRM()
    except FileNotFoundError:
        raise HTTPException(404, "Aucun CRM de prospection déposé.")
    if rid not in crm.rdv:
        raise HTTPException(404, "Rendez-vous introuvable dans le CRM.")
    r = crm.rdv[rid]
    fiche_entreprise = crm.prospects[r["ID prospect"]] if prospect else crm.entreprises[r["ID entreprise"]]
    ent = fiche_entreprise["Nom de l'entreprise"]
    opts = {**reglages()["options"], **(options or {})}
    if prospect and not set(opts.get("angles", "")) & set(execution.LETTRES_PROSPECT):
        opts["angles"] = "PSEF"  # réglages des clients qualifiés : toutes les recherches de prospection par défaut
    cotee = bool(fiche_entreprise.get("Code bourse (Yahoo Finance)"))
    decl = declencheur or {"type": "clic", "libelle": f"Lancée depuis l'appli à {maintenant():%Hh%M}"}
    e = execution.nouvelle_execution(rid, ent, base_rdv(crm, rid), cotee, opts, decl, "prospect" if prospect else "client")
    LOGS.mkdir(exist_ok=True)
    quoi = (f"Prépare la fiche de mon {(r.get('Rang du rendez-vous') or '1er rendez-vous').lower()} avec le prospect {ent}"
            if prospect else f"Prépare la fiche de ma visite chez {ent}")
    prompt = (f"{quoi} le {en_date(r['Date']).strftime('%d/%m/%Y')} "
              f"à {heure(r.get('Heure de début'))} (rendez-vous {rid}). Utilise le skill {'brief-prospect' if prospect else 'brief-visite'}. "
              f"La personne qui lira et écoutera la fiche s'appelle {prenom_utilisateur()} : salue-la par ce prénom dans la version audio."
              + execution.consigne_options(opts, "prospect" if prospect else "client"))
    proc = subprocess.Popen(
        ["claude", "-p", prompt, "--output-format", "stream-json", "--verbose",
         "--model", reglages().get("modele", "sonnet"),  # Sonnet par défaut : plus rapide, consomme moins de quota
         # réglages du projet uniquement : l'appli ne dépend pas de la configuration personnelle de qui l'utilise
         "--setting-sources", "project,local",
         "--allowedTools", "Bash(.venv/bin/python scripts/*)", "Bash(mkdir:*)", "Read", "Write", "Edit",
         "Glob", "Grep", "Agent", "WebSearch", "WebFetch", "Skill",
         # une page web lue par l'agent ne doit pas pouvoir réécrire les scripts qu'il exécute
         "--disallowedTools", *OUTILS_INTERDITS],
        cwd=str(RACINE), stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, bufsize=1,
        env={**os.environ, "PREPARATEUR_PREPARATION": "1"},  # active le garde-fou : une recherche = un agent (scripts/garde_agents.py)
        start_new_session=True)  # son propre groupe : « Arrêter » coupe aussi les recherches qu'il a lancées
    PROCESSUS[e["id"]] = proc

    def fil():
        execution.suivre_flux(e, proc, LOGS / f"preparation_{rid}_{datetime.now():%Y%m%d-%H%M%S}.jsonl")
        if e["statut"] == "en_cours":
            execution.cloturer(e, ok=proc.returncode == 0 and fiche_etat(e["base"])["prete"])
        relais.signaler_changement()

    threading.Thread(target=fil, daemon=True).start()
    return e


@app.post("/api/preparer/{rid}")
def preparer(rid: str, options: dict | None = Body(default=None)):
    lancer_preparation(rid.upper(), options=options)
    return etat_job(rid.upper())


def flux_sse(trouver, complete: bool):
    async def gen():
        vu = -1
        while True:
            e = trouver()
            if e and e["version"] != vu:
                vu = e["version"]
                yield f"data: {json.dumps(execution.vue(e, complete), ensure_ascii=False)}\n\n"
                if e["statut"] != "en_cours":
                    return
            await asyncio.sleep(0.4)
    return StreamingResponse(gen(), media_type="text/event-stream")


@app.get("/api/preparer/{rid}/flux")
async def preparer_flux(rid: str):
    rid = rid.upper()
    return flux_sse(lambda: execution.EXECUTIONS.get(execution.DERNIERE.get(rid, "")), complete=False)


# --------------------------------------------------------------------------- coulisses : exécutions, contrôle, réglages

@app.get("/api/executions")
def executions_liste(mode: str | None = None):
    garder = (lambda rid: True) if mode is None else (lambda rid: est_rdv_prospection(rid) == (mode == "prospection"))
    return {"executions": [h for h in execution.historique() if garder(h["rid"])],
            "en_cours": [e["id"] for e in execution.EXECUTIONS.values() if e["statut"] == "en_cours" and garder(e["rid"])]}


@app.get("/api/executions/{eid}")
def execution_detail(eid: str):
    e = execution.charger(eid)
    if not e:
        raise HTTPException(404, "Exécution introuvable.")
    return execution.vue(e)


@app.get("/api/executions/{eid}/flux")
async def execution_flux(eid: str):
    return flux_sse(lambda: execution.EXECUTIONS.get(eid), complete=True)


@app.post("/api/executions/{eid}/arreter")
def execution_arreter(eid: str):
    e, p = execution.EXECUTIONS.get(eid), PROCESSUS.get(eid)
    if not e:
        execution.charger(eid)  # archivée et bloquée « en cours » : la relire suffit à la clore
        return {"ok": True}
    if e["statut"] != "en_cours":
        return {"ok": False, "message": "Cette préparation n'est plus en cours."}
    if p and p.poll() is None:
        import os
        import signal
        try:
            os.killpg(p.pid, signal.SIGTERM)
        except (ProcessLookupError, PermissionError):
            p.terminate()
    execution.cloturer(e, ok=False, arrete=True)
    return {"ok": True}


@app.post("/api/executions/{eid}/relancer")
def execution_relancer(eid: str, options: dict | None = Body(default=None)):
    e = execution.charger(eid)
    if not e:
        raise HTTPException(404, "Exécution introuvable.")
    nouvelle = lancer_preparation(e["rid"], options=options or e.get("options"),
                                  declencheur={"type": "relance", "libelle": f"Refaite depuis le Workflow à {maintenant():%Hh%M}"})
    return {"id": nouvelle["id"]}


@app.get("/api/reglages")
def reglages_lire():
    return reglages()


@app.post("/api/reglages")
def reglages_ecrire(nouveaux: dict = Body(...)):
    r = reglages()
    for k in ("surveillance", "avance_envoi", "avance_preparation", "modele"):
        if k in nouveaux:
            r[k] = nouveaux[k]
    if "options" in nouveaux:
        r["options"] = {**r["options"], **nouveaux["options"]}
    r["modele"] = r["modele"] if r.get("modele") in ("sonnet", "opus") else "sonnet"
    r["avance_envoi"] = max(5, min(120, int(r["avance_envoi"])))
    r["avance_preparation"] = max(r["avance_envoi"] + 5, min(180, int(r["avance_preparation"])))
    CONFIG.mkdir(exist_ok=True)
    (CONFIG / "reglages.json").write_text(json.dumps(r, ensure_ascii=False, indent=2), encoding="utf-8")
    return r


@app.get("/api/workflow")
def workflow_modele(mode: str = "qualifie"):
    """Structure du workflow (briques et liens), pour dessiner les Coulisses avant toute exécution."""
    blocs, liens = execution.modele_workflow("prospect" if mode == "prospection" else "client")
    return {"blocs": [{"id": b, "titre": t, "colonne": c, "source": s, "modele": m} for b, t, c, s, m in blocs], "liens": liens}


@app.get("/api/fiche/{rid}")
def fiche(rid: str):
    rid = rid.upper()
    crm = CRMProspection() if est_rdv_prospection(rid) else CRM()
    if rid not in crm.rdv:
        raise HTTPException(404, "Rendez-vous introuvable.")
    base = base_rdv(crm, rid)
    etat = fiche_etat(base)
    md = BRIEFS / f"{base}_fiche.md"
    etat["markdown"] = md.read_text(encoding="utf-8") if md.exists() else None
    return etat


# --------------------------------------------------------------------------- envoi sur le téléphone

ENVOIS: dict[str, dict] = lire_json(CONFIG / "envois.json", {}) or {}
HORLOGE = {"decalage": None}


def maintenant() -> datetime:
    return datetime.now() + (HORLOGE["decalage"] or timedelta(0))


def config_push() -> dict:
    return lire_json(CONFIG / "push.json", {}) or {}


def infos_rdv(rid: str) -> dict:
    """Entreprise, heure, interlocuteur et base des fichiers d'un rendez-vous, client ou prospect."""
    if est_rdv_prospection(rid):
        crm = CRMProspection()
        r = crm.rdv[rid]
        return {"entreprise": crm.nom_prospect(r["ID prospect"]), "heure": heure(r.get("Heure de début")),
                "contact": crm.nom_interlocuteur(r.get("ID interlocuteur")) or "", "base": crm.base(rid)}
    crm = CRM()
    r = crm.rdv[rid]
    return {"entreprise": crm.nom_entreprise(r["ID entreprise"]), "heure": heure(r.get("Heure de début")),
            "contact": crm.nom_contact(r.get("ID contact")) or "", "base": base_rdv(crm, rid)}


def envoyer(rid: str) -> dict:
    """Envoie la fiche sur le téléphone : notification de l'appli mobile si elle est reliée, sinon ntfy."""
    cfg_relais = relais.config(CONFIG)
    if cfg_relais.get("url"):
        info = infos_rdv(rid)
        ent = info["entreprise"]
        relais.signaler_changement()
        res = relais.notifier_telephone(cfg_relais, f"{ent} à {info['heure']} : votre fiche est prête",
                                        f"Avec {info['contact']}. Touchez pour l’écouter en route.", f"/?rdv={rid}")
        if res.get("ok"):
            ENVOIS[rid] = {"le": maintenant().strftime("%Hh%M"), "audio": True}
            (CONFIG / "envois.json").write_text(json.dumps(ENVOIS, ensure_ascii=False, indent=2), encoding="utf-8")
            execution.marquer_envoi(rid, True, f"Notification de l’appli mobile à {ENVOIS[rid]['le']}")
            return {"ok": True, **ENVOIS[rid], "telephones": res.get("envoyes")}
        return {"ok": False, "message": "La notification n’est pas partie. Vérifiez que l’appli mobile est installée et les notifications autorisées."}
    import urllib.parse
    import urllib.request
    cfg = config_push()
    if not cfg.get("topic"):
        return {"ok": False, "message": "Le téléphone n'est pas encore relié (config/push.json)."}
    info = infos_rdv(rid)
    base, ent = info["base"], info["entreprise"]
    titre = f"{ent} à {info['heure']} : votre fiche est prête"
    essentiel = ""
    md = BRIEFS / f"{base}_fiche.md"
    if md.exists():
        bloc = re.search(r"## 1\..*?\n(.*?)\n## ", md.read_text(encoding="utf-8"), re.S)
        if bloc:
            essentiel = re.sub(r"\s*\((CRM|Web|Bourse)[^)]*\)", "", bloc.group(1)).strip()
    texte = f"Avec {info['contact']}. Écoutez la fiche jointe en route.\n{essentiel}"[:900]
    serveur = cfg.get("serveur", "https://ntfy.sh").rstrip("/")
    m4a = BRIEFS / f"{base}_audio.m4a"
    # Paramètres passés dans l'URL : les en-têtes HTTP n'acceptent pas les accents.
    params = {"title": titre, "message": texte, "tags": "briefcase", "priority": "high"}
    if m4a.exists():
        params["filename"] = f"Fiche {ent}.m4a"
        corps, methode = m4a.read_bytes(), "PUT"
    else:
        corps, methode = texte.encode("utf-8"), "POST"
    req = urllib.request.Request(f"{serveur}/{cfg['topic']}?{urllib.parse.urlencode(params)}", data=corps, method=methode)
    try:
        with urllib.request.urlopen(req, timeout=60) as rep:
            rep.read()
        ENVOIS[rid] = {"le": maintenant().strftime("%Hh%M"), "audio": m4a.exists()}
        CONFIG.mkdir(exist_ok=True)
        (CONFIG / "envois.json").write_text(json.dumps(ENVOIS, ensure_ascii=False, indent=2), encoding="utf-8")
        execution.marquer_envoi(rid, True, f"Notification envoyée à {ENVOIS[rid]['le']}{' avec l’audio' if m4a.exists() else ''}")
        return {"ok": True, **ENVOIS[rid]}
    except Exception as e:
        execution.marquer_envoi(rid, False, f"Envoi impossible ({type(e).__name__})")
        return {"ok": False, "message": f"L'envoi n'est pas passé ({type(e).__name__}). Vérifiez la connexion."}


@app.post("/api/envoyer/{rid}")
def envoyer_route(rid: str):
    return envoyer(rid.upper())


@app.get("/api/telephone")
def telephone():
    cfg = config_push()
    return {"relie": bool(cfg.get("topic")), "canal": cfg.get("topic"), "serveur": cfg.get("serveur", "https://ntfy.sh"),
            "veille_active": reglages()["surveillance"], "avance_minutes": reglages()["avance_envoi"]}


@app.post("/api/telephone/test")
def telephone_test():
    """Notification de test, déclenchée par l'utilisateur depuis l'écran « Relier mon téléphone »."""
    import urllib.parse
    import urllib.request
    cfg = config_push()
    if not cfg.get("topic"):
        return {"ok": False, "message": "Aucun canal configuré."}
    params = {"title": "Préparateur de visite", "tags": "white_check_mark"}
    req = urllib.request.Request(f"{cfg.get('serveur', 'https://ntfy.sh').rstrip('/')}/{cfg['topic']}?{urllib.parse.urlencode(params)}",
                                 data="Votre téléphone est bien relié. Vos fiches arriveront ici 30 minutes avant chaque rendez-vous.".encode("utf-8"),
                                 method="POST")
    try:
        with urllib.request.urlopen(req, timeout=20) as rep:
            rep.read()
        return {"ok": True}
    except Exception as e:
        return {"ok": False, "message": f"L'envoi n'est pas passé ({type(e).__name__})."}


@app.post("/api/horloge")
def horloge(heure_simulee: str | None = None):
    """Mode démo : fait comme s'il était une autre heure (ex. 2026-10-12T09:00)."""
    if not heure_simulee:
        HORLOGE["decalage"] = None
    else:
        HORLOGE["decalage"] = datetime.fromisoformat(heure_simulee) - datetime.now()
    return {"horloge": maintenant().isoformat(timespec="minutes"), "simulee": HORLOGE["decalage"] is not None}


@app.post("/api/envois/reinitialiser")
def envois_reset():
    ENVOIS.clear()
    (CONFIG / "envois.json").unlink(missing_ok=True)
    return {"ok": True}


# --------------------------------------------------------------------------- compte Claude (passation : chacun branche son propre compte)

CONNEXION = {"proc": None}


def claude_etat() -> dict:
    _COMPTE_CACHE["v"] = None  # l'état du compte est relu à chaque vérification explicite
    chemin = shutil.which("claude")
    if not chemin:
        return {"installe": False, "connecte": False}
    try:
        version = subprocess.run(["claude", "--version"], capture_output=True, text=True, timeout=20).stdout.strip()
        st = json.loads(subprocess.run(["claude", "auth", "status", "--json"], capture_output=True, text=True, timeout=20).stdout or "{}")
    except Exception:
        return {"installe": True, "connecte": False, "message": "Claude ne répond pas."}
    plans = {"pro": "Claude Pro", "max": "Claude Max", "team": "Claude Team", "enterprise": "Claude Enterprise"}
    return {"installe": True, "version": version.split(" ")[0], "connecte": bool(st.get("loggedIn")),
            "email": st.get("email"), "plan": plans.get(str(st.get("subscriptionType", "")).lower(), st.get("subscriptionType")),
            "organisation": st.get("orgName"), "methode": st.get("authMethod"),
            "connexion_en_cours": bool(CONNEXION["proc"] and CONNEXION["proc"].poll() is None)}


@app.get("/api/profil")
def profil_lire():
    return {"prenom": prenom_utilisateur()}


@app.post("/api/profil")
def profil_ecrire(donnees: dict = Body(...)):
    prenom = str(donnees.get("prenom", "")).strip()[:40]
    if not prenom:
        raise HTTPException(400, "Indiquez un prénom.")
    CONFIG.mkdir(exist_ok=True)
    email = compte_claude().get("email")
    (CONFIG / "profil.json").write_text(json.dumps({"prenom": prenom, "email": email}, ensure_ascii=False, indent=2), encoding="utf-8")
    return {"prenom": prenom}


@app.get("/api/claude")
def claude_info():
    return claude_etat()


@app.post("/api/claude/connexion")
def claude_connexion():
    """Ouvre la page de connexion Claude dans le navigateur (compte claude.ai : Pro, Max, Team ou Enterprise)."""
    if not shutil.which("claude"):
        raise HTTPException(400, "Claude n'est pas installé sur cet ordinateur.")
    if CONNEXION["proc"] and CONNEXION["proc"].poll() is None:
        return {"ok": True, "message": "Connexion déjà en cours dans le navigateur."}
    LOGS.mkdir(exist_ok=True)
    CONNEXION["proc"] = subprocess.Popen(["claude", "auth", "login", "--claudeai"], stdin=subprocess.DEVNULL,
                                         stdout=open(LOGS / "connexion_claude.log", "w"), stderr=subprocess.STDOUT)
    return {"ok": True, "message": "Une page de connexion Claude s'ouvre dans votre navigateur."}


@app.post("/api/claude/deconnexion")
def claude_deconnexion():
    subprocess.run(["claude", "auth", "logout"], capture_output=True, text=True, timeout=30)
    _COMPTE_CACHE["v"] = None
    AGENDA.update(t=0.0)
    return claude_etat()


@app.post("/api/claude/installer")
def claude_installer():
    """Installe Claude Code avec l'installeur officiel d'Anthropic (claude.ai/install.sh)."""
    if shutil.which("claude"):
        return {"ok": True, "message": "Claude est déjà installé."}
    LOGS.mkdir(exist_ok=True)
    subprocess.Popen(["/bin/bash", "-c", "curl -fsSL https://claude.ai/install.sh | bash"],
                     stdout=open(LOGS / "installation_claude.log", "w"), stderr=subprocess.STDOUT)
    return {"ok": True, "message": "Installation lancée, cela prend une minute."}


@app.get("/api/claude/agenda")
def claude_agenda_test():
    AGENDA.update(t=0.0)
    v = lire_agenda(maintenant().date())
    return {"ok": v["ok"], "evenements": len(v["evenements"]), "message": v.get("message")}


# --------------------------------------------------------------------------- page d'accueil : contenu dynamique

@app.get("/api/accueil")
def accueil():
    crm = CRM()
    jour = maintenant().date()
    if not crm.rdv_du_jour(jour, COMMERCIAL):
        jour = prochaine_journee(crm)
    rdvs = crm.rdv_du_jour(jour, COMMERCIAL)
    pretes = sum(1 for r in rdvs if fiche_etat(base_rdv(crm, r["ID rendez-vous"]))["prete"])
    titres, bourses = [], []
    for p in sorted(BRIEFS.glob("*_veille.json"), key=lambda x: x.stat().st_mtime, reverse=True):
        rid = p.name.split("_")[0]
        ent = crm.nom_entreprise(crm.rdv[rid]["ID entreprise"]) if rid in crm.rdv else p.name.split("_")[1].capitalize()
        donnees = lire_json(p, [])
        for bloc in donnees if isinstance(donnees, list) else [donnees]:
            for f in (bloc or {}).get("faits", [])[:3]:
                if f.get("titre") and f.get("date"):
                    titres.append({"entreprise": ent, "titre": f["titre"], "source": f.get("source"), "date": f["date"]})
    for p in sorted(BRIEFS.glob("*_bourse.json")):
        j = lire_json(p, {})
        rid = p.name.split("_")[0]
        if j.get("statut") == "ok" and rid in crm.rdv:
            bourses.append({"entreprise": crm.nom_entreprise(crm.rdv[rid]["ID entreprise"]), "cours": j["dernier_cours"],
                            "variation": j["variation_12_mois_pct"], "date": j["date_cours"]})
    vus = set()
    bourses = [b for b in bourses if not (b["entreprise"] in vus or vus.add(b["entreprise"]))]
    prochain = None
    for r in rdvs:
        debut = datetime.combine(jour, r["Heure de début"]) if r.get("Heure de début") else None
        if debut and debut > maintenant():
            prochain = {"heure": heure(r["Heure de début"]), "entreprise": crm.nom_entreprise(r["ID entreprise"]),
                        "contact": crm.nom_contact(r.get("ID contact"))}
            break
    return {"prenom": prenom_utilisateur(), "jour_long": date_longue(jour), "rendez_vous": len(rdvs),
            "fiches_pretes": pretes, "prochain": prochain, "titres": titres[:12], "bourses": bourses,
            "clients": len(crm.entreprises), "executions": len(list((LOGS / "executions").glob("*.json"))) if (LOGS / "executions").exists() else 0}


# --------------------------------------------------------------------------- relais Vercel : l'appli mobile

_GEO_EN_COURS: set = set()


def position(adresse: str) -> dict | None:
    """Coordonnées d'une adresse client (OpenStreetMap, gratuit), gardées en cache. La première demande part en arrière-plan."""
    cache = lire_json(CONFIG / "geocodage.json", {}) or {}
    if adresse in cache:
        return cache[adresse]
    if adresse not in _GEO_EN_COURS:
        _GEO_EN_COURS.add(adresse)

        def chercher():
            import urllib.parse
            import urllib.request
            try:
                url = "https://nominatim.openstreetmap.org/search?" + urllib.parse.urlencode({"format": "json", "limit": 1, "countrycodes": "fr", "q": adresse})
                req = urllib.request.Request(url, headers={"User-Agent": "Preparateur-de-visite/1.0 (demonstrateur)"})
                with urllib.request.urlopen(req, timeout=15) as r:
                    res = json.loads(r.read().decode("utf-8"))
                c = lire_json(CONFIG / "geocodage.json", {}) or {}
                c[adresse] = {"lat": float(res[0]["lat"]), "lon": float(res[0]["lon"])} if res else None
                (CONFIG / "geocodage.json").write_text(json.dumps(c, ensure_ascii=False, indent=1), encoding="utf-8")
                relais.signaler_changement()
            except Exception:
                pass
            finally:
                _GEO_EN_COURS.discard(adresse)
                time.sleep(1.1)  # politesse envers le service gratuit : une requête par seconde au plus

        threading.Thread(target=chercher, daemon=True).start()
    return None


def adresse_client(crm, rid: str) -> str | None:
    r = crm.rdv.get(rid)
    if not r:
        return None
    e = (crm.prospects.get(r["ID prospect"]) if isinstance(crm, CRMProspection) else crm.entreprises.get(r["ID entreprise"])) or {}
    morceaux = [str(e.get("Adresse") or "").strip(), " ".join(str(x) for x in (e.get("Code postal"), e.get("Ville")) if x).strip()]
    return ", ".join(m for m in morceaux if m) or None


def etat_mobile() -> dict:
    """Ce que l'appli mobile affiche : les rendez-vous des prochains jours, leurs fiches et leurs comptes rendus."""
    crm = CRM()
    try:
        crm_p = CRMProspection()
        jours_p = [x["jour"] for x in jours_prospection()["jours"]]
    except Exception:
        crm_p, jours_p = None, []
    aujourd = maintenant().date().isoformat()
    jours_ok = sorted({x["jour"] for x in jours()["jours"]} | set(jours_p))
    jours_ok = [j for j in jours_ok if j >= aujourd][:30]  # tous les rendez-vous à venir : le paquet ne s’arrête pas à cinq jours
    journees = []
    for j in jours_ok:
        d = journee(j, avec_agenda=False)
        if crm_p:  # les prospects rejoignent le paquet du téléphone, repérés par source « prospect »
            d["rendez_vous"] = sorted(d["rendez_vous"] + journee_prospection(j, False)["rendez_vous"], key=lambda r: r["debut"])
            for r in d["rendez_vous"]:
                if r.get("prospect"):
                    r["source"] = "prospect"
        journees.append({"jour": d["jour"], "jour_long": d["jour_long"], "rendez_vous": [{
            k: r.get(k) for k in ("id", "source", "heure", "heure_fin", "debut", "entreprise", "ville", "visio", "lieu", "objet",
                                  "contact", "poste", "affaire", "montant", "alertes", "titre_agenda")
        } | {"fiche_prete": r["fiche"]["prete"], "fiche_audio": r["fiche"]["audio"], "preparee_le": r["fiche"]["preparee_le"],
             "en_preparation": (ex := (execution.EXECUTIONS.get(execution.DERNIERE.get(r["id"], "")) or {})).get("statut") == "en_cours",
             "preparation": [{"libelle": x["libelle"], "etat": x["etat"]} for x in ex.get("etapes", [])] if ex.get("statut") == "en_cours" else None,
             "adresse": (adr := adresse_client(crm_p if r.get("source") == "prospect" else crm, r["id"]) if not r.get("visio") else None),
             "prospect": {"etape": {"Lead": "Contact repéré"}.get(r["prospect"]["etape"], r["prospect"]["etape"]), "rang": r["prospect"].get("rang"),
                          "decouverte": r["prospect"]["decouverte"]} if r.get("prospect") else None,
             "geo": position(adr) if adr else None,
             "compte_rendu": comptes_rendus_etat().get(r["id"])} for r in d["rendez_vous"]]})
    try:  # pour l'accueil du téléphone : l'actualité trouvée sur les clients et leurs cours de bourse
        a = accueil()
        vitrine = {"titres": a.get("titres", [])[:10], "bourses": a.get("bourses", [])[:8]}
    except Exception:
        vitrine = {"titres": [], "bourses": []}
    return {"prenom": prenom_utilisateur(), "journees": journees, "genere": maintenant().isoformat(timespec="seconds"), **vitrine}


def comptes_rendus_etat() -> dict:
    return lire_json(CONFIG / "comptes_rendus.json", {}) or {}


def fichiers_mobiles() -> list:
    crm = CRM()
    res = []
    try:
        crm_p = CRMProspection()
        bases = [(rid, base_rdv(crm, rid)) for rid in crm.rdv] + [(rid, crm_p.base(rid)) for rid in crm_p.rdv]
    except Exception:
        bases = [(rid, base_rdv(crm, rid)) for rid in crm.rdv]
    for rid, base in bases:
        res.append((f"fiches/{rid}.html", BRIEFS / f"{base}_fiche.html", "text/html; charset=utf-8"))
        res.append((f"fiches/{rid}.m4a", BRIEFS / f"{base}_audio.m4a", "audio/mp4"))
    return [x for x in res if x[1].exists()]


@app.get("/api/relais")
def relais_info():
    cfg = relais.config(CONFIG)
    d = relais.ETAT["derniere_publication"]
    return {"configure": bool(cfg.get("url")), "url": cfg.get("url"), "lien": relais.lien_appairage(cfg),
            "ecoute": relais.ETAT["connecte"], "derniere_publication": datetime.fromtimestamp(d).strftime("%Hh%M") if d else None,
            "erreur": relais.ETAT["erreur"]}


@app.post("/api/relais/code")
def relais_code():
    """Code à 6 chiffres (15 minutes, usage unique) pour relier l'appli installée sur l'écran d'accueil."""
    import secrets
    cfg = relais.config(CONFIG)
    if not cfg.get("url"):
        raise HTTPException(400, "L'appli mobile n'est pas déployée pour ce Mac.")
    code = f"{secrets.randbelow(10**6):06d}"
    relais.appel(cfg, "POST", "/api/appairage", json.dumps({"code": code}).encode("utf-8"))
    return {"code": code, "minutes": 15, "lien": f"{cfg['url'].rstrip('/')}/#code={code}"}


@app.post("/api/relais/publier")
def relais_publier():
    relais.signaler_changement()
    return {"ok": True}


# --------------------------------------------------------------------------- compte rendu après visite (note vocale du téléphone)

VERROU_CR = threading.Lock()


def python_projet() -> str:
    p = RACINE / ".venv" / "bin" / "python"
    return str(p) if p.exists() else sys.executable


def cr_etat(rid: str, **champs) -> dict:
    """Met à jour l'état du compte rendu d'un rendez-vous et le publie aussitôt vers l'appli mobile."""
    with VERROU_CR:
        tous = comptes_rendus_etat()
        cr = {**tous.get(rid, {}), **champs, "maj": maintenant().isoformat(timespec="seconds")}
        tous[rid] = cr
        CONFIG.mkdir(exist_ok=True)
        (CONFIG / "comptes_rendus.json").write_text(json.dumps(tous, ensure_ascii=False, indent=2), encoding="utf-8")
    relais.signaler_changement()
    return cr


def deja_traite(cle_evt: str) -> bool:
    """Le canal rejoue les 12 dernières heures au redémarrage : on ne traite jamais deux fois le même événement."""
    with VERROU_CR:
        f = CONFIG / "relais_traites.json"
        vus = lire_json(f, []) or []
        if cle_evt in vus:
            return True
        f.write_text(json.dumps((vus + [cle_evt])[-200:]), encoding="utf-8")
        return False


def traiter_note(ev: dict):
    rid, nid = str(ev.get("rdv", "")).upper(), str(ev.get("id", ""))
    if not rid or not nid or deja_traite("note:" + nid):
        return
    cfg = relais.config(CONFIG)
    crm = CRM()
    if rid not in crm.rdv:
        return
    ent = crm.nom_entreprise(crm.rdv[rid]["ID entreprise"])
    journal_surveillance(f"{rid} : note vocale reçue du téléphone")
    cr_etat(rid, id=nid, statut="note_recue", message=None, texte=None)
    try:
        dossier = RACINE / "audio"
        dossier.mkdir(exist_ok=True)
        audio = dossier / Path(ev["chemin"]).name
        audio.write_bytes(relais.appel(cfg, "GET", "/api/fichier?chemin=" + urllib.parse.quote(ev["chemin"]), delai=120))
        cr_etat(rid, statut="transcription")
        out = subprocess.run([python_projet(), str(RACINE / "scripts" / "transcrire.py"), str(audio)], capture_output=True, text=True,
                             cwd=str(RACINE), timeout=1800, env={**os.environ, "PREPARATEUR_ESPACE": str(RACINE)})
        res = json.loads(out.stdout.strip().splitlines()[-1])
        if res.get("statut") != "ok":
            raise RuntimeError(res.get("message", "transcription impossible"))
        transcription = audio.with_suffix(".txt")
        cr_etat(rid, statut="redaction", transcription=transcription.read_text(encoding="utf-8")[:4000])
        sortie = RACINE / "sorties" / "comptes-rendus" / f"{nid}.json"
        sortie.parent.mkdir(parents=True, exist_ok=True)
        prompt = (f"Rédige le compte rendu du rendez-vous {rid} chez {ent} avec le skill compte-rendu-visite. "
                  f"Transcription de la note vocale : {transcription.relative_to(RACINE)}. Fichier de sortie : {sortie.relative_to(RACINE)}. "
                  f"Le commercial s'appelle {prenom_utilisateur() or 'le commercial'}. N'écris rien dans le CRM.")
        subprocess.run(["claude", "-p", prompt, "--output-format", "json", "--model", reglages().get("modele", "sonnet"),
                        "--setting-sources", "project,local", "--allowedTools",
                        "Bash(.venv/bin/python scripts/extraire_dossier.py*)", "Read", "Write", "Glob", "Grep", "Skill",
                        "--disallowedTools", *OUTILS_INTERDITS],
                       cwd=str(RACINE), capture_output=True, text=True, timeout=1800)
        donnees = json.loads(sortie.read_text(encoding="utf-8"))
        cr_etat(rid, statut="a_valider", texte=donnees.get("texte"), synthese=donnees.get("synthese"), maj_crm=donnees.get("maj_crm"))
        relais.notifier_telephone(cfg, f"{ent} : votre compte rendu est prêt", (donnees.get("synthese") or "Relisez-le et validez-le.")[:180], f"/?rdv={rid}")
        journal_surveillance(f"{rid} : compte rendu prêt à valider")
    except Exception as e:
        cr_etat(rid, statut="erreur", message="Le compte rendu n’a pas pu être préparé.")
        journal_surveillance(f"{rid} : compte rendu en échec : {type(e).__name__} {e}")


def traiter_validation(ev: dict):
    rid, nid = str(ev.get("rdv", "")).upper(), str(ev.get("id", ""))
    if not rid or not re.fullmatch(r"[\w-]{1,64}", nid) or deja_traite("validation:" + nid + (":local" if ev.get("local") else "")):
        return
    cfg = relais.config(CONFIG)
    ent = CRM().nom_entreprise(CRM().rdv[rid]["ID entreprise"])
    cr_etat(rid, statut="enregistrement")
    try:
        if ev.get("local"):  # validé depuis le Mac
            decision = json.loads(Path(ev["local"]).read_text(encoding="utf-8"))
        else:
            decision = relais.appel(cfg, "GET", "/api/fichier?chemin=" + urllib.parse.quote(ev["chemin"]))
            decision = json.loads(decision) if isinstance(decision, (bytes, str)) else decision
        fichier = RACINE / "sorties" / "comptes-rendus" / f"{nid}.json"
        donnees = json.loads(fichier.read_text(encoding="utf-8"))
        if decision.get("texte"):
            donnees["texte"] = decision["texte"]  # le commercial a corrigé le texte sur son téléphone
        valide = fichier.with_name(f"{nid}-valide.json")
        valide.write_text(json.dumps(donnees, ensure_ascii=False, indent=2), encoding="utf-8")
        out = subprocess.run([python_projet(), str(RACINE / "scripts" / "ecrire_crm.py"), "--compte-rendu", rid, "--fichier", str(valide)],
                             capture_output=True, text=True, cwd=str(RACINE), timeout=300, env={**os.environ, "PREPARATEUR_ESPACE": str(RACINE)})
        res = json.loads(out.stdout)
        if res.get("statut") not in ("ok", "deja_fait"):
            raise RuntimeError(res.get("message"))
        cr_etat(rid, statut="valide", texte=donnees["texte"])
        relais.notifier_telephone(cfg, f"{ent} : compte rendu enregistré", "Il est dans le CRM, avec la prochaine action.", f"/?rdv={rid}")
        journal_surveillance(f"{rid} : compte rendu validé et enregistré dans le CRM ({res.get('activite', 'déjà présent')})")
    except Exception as e:
        cr_etat(rid, statut="a_valider", message="L’enregistrement n’est pas passé, vous pouvez réessayer.")
        journal_surveillance(f"{rid} : enregistrement du compte rendu en échec : {type(e).__name__} {e}")


@app.post("/api/compte-rendu/{rid}/valider")
def compte_rendu_valider(rid: str, donnees: dict | None = Body(default=None)):
    rid = rid.upper()
    cr = comptes_rendus_etat().get(rid)
    if not cr or cr.get("statut") != "a_valider":
        raise HTTPException(400, "Aucun compte rendu à valider pour ce rendez-vous.")
    texte = (donnees or {}).get("texte")
    chemin_local = RACINE / "sorties" / "comptes-rendus" / f"{cr['id']}-decision-locale.json"
    chemin_local.write_text(json.dumps({"texte": texte} if texte else {}, ensure_ascii=False), encoding="utf-8")
    threading.Thread(target=traiter_validation, args=({"rdv": rid, "id": cr["id"], "local": str(chemin_local)},), daemon=True).start()
    return {"ok": True}


def preparer_depuis_telephone(ev: dict):
    """Le commercial a poussé une carte sans fiche sur son téléphone : on prépare ce rendez-vous."""
    rid = str(ev.get("rdv") or "").upper()
    if rid not in CRM().rdv:
        return
    e = execution.EXECUTIONS.get(execution.DERNIERE.get(rid, ""))
    if e and e["statut"] == "en_cours":
        return
    lancer_preparation(rid, declencheur={"type": "telephone", "libelle": f"Demandée depuis le téléphone à {maintenant():%Hh%M}"})
    relais.signaler_changement()


relais.sur_evenement("note", traiter_note)
relais.sur_evenement("validation", traiter_validation)
relais.sur_evenement("preparer", preparer_depuis_telephone)
execution.ECOUTEURS.append(relais.signaler_changement)  # le téléphone suit la fabrication d'une carte étape par étape


def recuperer_agenda_relais(_evenement: dict | None = None):
    """Le relais a reçu une liste du script Google : on la récupère et on l'applique comme si elle venait du canal direct."""
    cfg = relais.config(CONFIG)
    if not cfg.get("url"):
        return
    try:
        donnees = relais.appel(cfg, "GET", "/api/agenda")
    except Exception as e:
        print("agenda via relais :", e, file=sys.stderr)
        return
    if isinstance(donnees, dict) and donnees.get("type") == "agenda":
        recu = (donnees.get("recu") or 0) / 1000
        if SCRIPT_AGENDA.get("dernier") and recu and recu <= SCRIPT_AGENDA["dernier"] - 1:
            return  # déjà appliquée
        deb = date.fromisoformat(str(donnees.get("debut", ""))[:10]) if donnees.get("debut") else None
        appliquer_liste_agenda(donnees.get("evenements", []), "script", deb)
        SCRIPT_AGENDA.update(dernier=recu or time.time(), raison=donnees.get("raison"), evenements=len(donnees.get("evenements", [])))


relais.sur_evenement("agenda", recuperer_agenda_relais)


# --------------------------------------------------------------------------- surveillance de l'agenda

def journal_surveillance(message: str):
    """Trace de l'automatisme (logs/surveillance.log) : permet de vérifier après coup ce qui a été fait, et quand."""
    LOGS.mkdir(exist_ok=True)
    with open(LOGS / "surveillance.log", "a", encoding="utf-8") as f:
        f.write(f"{datetime.now():%Y-%m-%d %H:%M:%S}  {message}\n")


def boucle_surveillance():
    """Toutes les 30 s : prépare la fiche avant chaque rendez-vous de l'agenda, puis l'envoie (délais réglables)."""
    journal_surveillance("démarrage de l'automatisme")
    dernier_pouls = 0.0
    while True:
        try:
            reg = reglages()
            if reg["surveillance"]:
                now = maintenant()
                crm = CRM()
                evts = lire_agenda(now.date())["evenements"]
                for r in crm.rdv_du_jour(now.date(), COMMERCIAL):
                    rid = r["ID rendez-vous"]
                    if not r.get("Heure de début") or rid in ENVOIS:
                        continue
                    debut = datetime.combine(now.date(), r["Heure de début"])
                    if not evenement_pour(crm.nom_entreprise(r["ID entreprise"]), debut, evts):
                        continue  # seuls les rendez-vous présents dans l'agenda déclenchent un envoi
                    reste = (debut - now).total_seconds() / 60
                    prete = fiche_etat(base_rdv(crm, rid))["prete"]
                    if 0 < reste <= reg["avance_preparation"] and not prete and not job_en_cours(rid):
                        journal_surveillance(f"{rid} : préparation lancée, {round(reste)} min avant le rendez-vous")
                        lancer_preparation(rid, declencheur={"type": "agenda", "libelle":
                            f"Agenda Google : rendez-vous de {heure(r['Heure de début'])}, lancée {round(reste)} min avant"})
                    if 0 < reste <= reg["avance_envoi"] and prete and not job_en_cours(rid):
                        res = envoyer(rid)
                        journal_surveillance(f"{rid} : envoi sur le téléphone {'réussi' if res.get('ok') else 'en échec : ' + str(res.get('message'))}")
                if time.time() - dernier_pouls > 600:
                    dernier_pouls = time.time()
                    journal_surveillance(f"active · {len(crm.rdv_du_jour(now.date(), COMMERCIAL))} rendez-vous aujourd'hui · agenda {'à jour' if evts else 'vide'}")
        except Exception as e:  # la surveillance ne doit jamais tomber
            journal_surveillance(f"erreur : {type(e).__name__} {e}")
        time.sleep(30)


@app.on_event("startup")
def demarrage():
    import os
    try:
        execution.elaguer_conso()
    except Exception:
        pass
    threading.Thread(target=boucle_agenda, daemon=True).start()
    if not os.environ.get("PREPARATEUR_SANS_SURVEILLANCE"):  # instance de test : ni envoi automatique, ni relais vers le téléphone
        threading.Thread(target=relais.boucle_publication, args=(CONFIG, etat_mobile, fichiers_mobiles), daemon=True).start()
        threading.Thread(target=relais.boucle_ecoute, args=(CONFIG,), daemon=True).start()
        threading.Thread(target=recuperer_agenda_relais, daemon=True).start()
        threading.Thread(target=boucle_surveillance, daemon=True).start()


@app.on_event("shutdown")
def arret():
    for p in PROCESSUS.values():
        if p.poll() is None:
            p.terminate()


# --------------------------------------------------------------------------- interface

if WEB.exists():
    app.mount("/", StaticFiles(directory=WEB, html=True), name="web")

if __name__ == "__main__":
    import os
    uvicorn.run(app, host="127.0.0.1", port=int(os.environ.get("PORT", 8765)), log_level="warning")
