"""Suivi d'une préparation de fiche, brique par brique (onglet « Coulisses »).

Claude Code tourne en arrière-plan (`claude -p ... --output-format stream-json`). Chaque ligne du flux
est traduite en événement sur une brique du workflow : en attente -> en cours -> faite (ou sautée,
en erreur, arrêtée). Les recherches et lectures des agents de veille sont rattachées à leur brique
grâce à `parent_tool_use_id`. Chaque exécution est archivée dans logs/executions/<id>.json.
"""
from __future__ import annotations

import json
import re
import subprocess
import threading
import time
import uuid
from datetime import datetime
from pathlib import Path
from urllib.parse import urlparse

RACINE = Path(__import__("os").environ.get("PREPARATEUR_ESPACE") or Path(__file__).resolve().parent.parent)  # dossier des données
ARCHIVES = RACINE / "logs" / "executions"
BRIEFS = RACINE / "sorties" / "briefs"
DOSSIERS = RACINE / "sorties" / "dossiers"

ANGLES = {
    "A": ("veille_a", "Résultats et bourse", "résultats financiers, chiffre d'affaires, bourse, prévisions, rachats et cessions"),
    "B": ("veille_b", "Dirigeants et organisation", "dirigeants et gouvernance : nominations, départs, réorganisations, notamment achats, industriel, qualité"),
    "C": ("veille_c", "Usines, investissements, RSE", "sites industriels, investissements, fermetures, nouveaux produits, emballage et RSE"),
}

# (id, titre, colonne, source affichée, modèle)
BLOCS = [
    ("declencheur", "Déclenchement", 0, None, None),
    ("crm", "Lecture du CRM", 1, "Fichier Excel du CRM", None),
    ("bourse", "Cours de bourse", 2, "Yahoo Finance", "Sonnet"),
    ("linkedin", "LinkedIn de l'entreprise", 2, "Page LinkedIn publique", "Sonnet"),
    ("veille_a", "Presse : résultats", 2, "Presse et sites publics", "Sonnet"),
    ("veille_b", "Presse : dirigeants", 2, "Presse et sites publics", "Sonnet"),
    ("veille_c", "Presse : usines, RSE", 2, "Presse et sites publics", "Sonnet"),
    ("compilation", "Sources rassemblées", 3, None, None),
    ("redaction", "Rédaction de la fiche", 4, None, "Claude"),
    ("audio_texte", "Texte à écouter", 5, None, "Claude"),
    ("rendu", "Page et voix", 6, "Synthèse vocale du Mac", None),
    ("crm_coche", "CRM mis à jour", 7, "Fichier Excel du CRM", None),
    ("envoi", "Envoi sur le téléphone", 8, "Notification sur le téléphone", None),
]
# chaque recherche a son agent Sonnet dédié (.claude/agents) : type d'agent -> brique
AGENTS_DEDIES = {"cours-bourse": "bourse", "linkedin-entreprise": "linkedin", "profil-interlocuteur": "profil",
                 "veille-signal": "signal", "enjeux-secteur": "secteur", "fournisseurs-concurrence": "fournisseurs"}
# Arêtes du graphe (de -> vers), pour l'affichage
SOURCES = ("bourse", "linkedin", "veille_a", "veille_b", "veille_c")
LIENS = [("declencheur", "crm")] + [("crm", b) for b in SOURCES] + \
        [(b, "compilation") for b in SOURCES] + \
        [("compilation", "redaction"), ("redaction", "audio_texte"), ("audio_texte", "rendu"),
         ("rendu", "crm_coche"), ("crm_coche", "envoi")]

# Rendez-vous avec un prospect (CRM de prospection, skill brief-prospect) : une brique de plus,
# la stratégie du rendez-vous (signal, entonnoir de questions, objections, conclusion), entre les sources et la fiche.
# Prospection : six recherches calibrées sur un premier rendez-vous, un agent Sonnet par brique d'exploration.
# Lettres des options : P profil, S signal, E enjeux du secteur, F fournisseurs (bourse et LinkedIn ont leur interrupteur).
SOURCES_PROSPECT = ("profil", "signal", "secteur", "fournisseurs", "linkedin", "bourse")
LETTRES_PROSPECT = {"P": "profil", "S": "signal", "E": "secteur", "F": "fournisseurs"}
BLOCS_PROSPECT = [
    ("declencheur", "Déclenchement", 0, None, None),
    ("crm", "CRM de prospection", 1, "Fichier Excel de prospection", None),
    ("profil", "Profil et couleur de l'interlocuteur", 2, "Profil LinkedIn public", "Sonnet"),
    ("signal", "Signal déclencheur", 2, "Presse et sites publics", "Sonnet"),
    ("secteur", "Enjeux du secteur", 2, "Presse professionnelle", "Sonnet"),
    ("fournisseurs", "Fournisseur en place", 2, "Presse et sites publics", "Sonnet"),
    ("linkedin", "LinkedIn de l'entreprise", 2, "Page LinkedIn publique", "Sonnet"),
    ("bourse", "Cours de bourse", 2, "Yahoo Finance", "Sonnet"),
    ("compilation", "Sources rassemblées", 3, None, None),
    ("strategie", "Stratégie du rendez-vous", 4, "Méthode de découverte", "Claude"),
    ("redaction", "Rédaction de la fiche", 5, None, "Claude"),
    ("audio_texte", "Texte à écouter", 6, None, "Claude"),
    ("rendu", "Page et voix", 7, "Synthèse vocale du Mac", None),
    ("crm_coche", "CRM de prospection mis à jour", 8, "Fichier Excel de prospection", None),
    ("envoi", "Envoi sur le téléphone", 9, "Notification sur le téléphone", None),
]
LIENS_PROSPECT = [("declencheur", "crm")] + [("crm", b) for b in SOURCES_PROSPECT] + \
                 [(b, "compilation") for b in SOURCES_PROSPECT] + \
                 [("compilation", "strategie"), ("strategie", "redaction"), ("redaction", "audio_texte"), ("audio_texte", "rendu"),
                  ("rendu", "crm_coche"), ("crm_coche", "envoi")]


def modele_workflow(type_: str = "client") -> tuple[list, list]:
    return (BLOCS_PROSPECT, LIENS_PROSPECT) if type_ == "prospect" else (BLOCS, LIENS)

EXECUTIONS: dict[str, dict] = {}   # id -> exécution
DERNIERE: dict[str, str] = {}      # rendez-vous -> id de la dernière exécution
VERROU = threading.Lock()


def _bloc(e: dict, bid: str) -> dict:
    return next(b for b in e["blocs"] if b["id"] == bid)


ECOUTEURS: list = []  # appelés à chaque avancée (le serveur y branche la publication vers le téléphone)


def _maj(e: dict):
    e["version"] += 1
    e["etapes"] = etapes_simplifiees(e)
    for f in ECOUTEURS:
        try:
            f()
        except Exception:
            pass
    if time.time() - e.get("_sauve", 0) > 1.0 or e["statut"] != "en_cours":
        sauver(e)


def demarrer_bloc(e: dict, bid: str, detail: dict | None = None):
    b = _bloc(e, bid)
    if b["etat"] in ("attente", "erreur"):
        if b["etat"] == "erreur":
            b["resume"] = None  # Claude reprend l'étape après une erreur
        b["etat"], b["debut"] = "en_cours", b["debut"] or time.time()
    if detail:
        b["details"].append({**detail, "t": time.time()})
    _maj(e)


SEQUENCE = ["compilation", "strategie", "redaction", "audio_texte", "rendu", "crm_coche"]


def _amorcer(e: dict):
    """Passe « en cours » la prochaine étape dont toutes les précédentes sont finies : on voit Claude y travailler."""
    liens = e.get("liens") or LIENS
    presents = {b["id"] for b in e["blocs"]}
    for bid in [x for x in SEQUENCE if x in presents]:
        b = _bloc(e, bid)
        if b["etat"] != "attente":
            continue
        avant = [a for a, v in liens if v == bid]
        if avant and all(_bloc(e, a)["etat"] in ("fait", "saute") for a in avant):
            b["etat"], b["debut"] = "en_cours", max([_bloc(e, a)["fin"] or 0 for a in avant] + [0]) or time.time()


def finir_bloc(e: dict, bid: str, etat: str = "fait", resume: str | None = None, details: list | None = None):
    b = _bloc(e, bid)
    if b["etat"] in ("fait", "saute", "arrete"):
        return
    if b["etat"] == "erreur" and etat == "fait":
        b["resume"] = None  # l'erreur intermédiaire a été surmontée
    b["etat"] = etat
    b["debut"] = b["debut"] or time.time()
    b["fin"] = time.time()
    if resume:
        b["resume"] = resume
    for d in details or []:
        b["details"].append({**d, "t": time.time()})
    if e["statut"] == "en_cours":
        _amorcer(e)
    _maj(e)


def nouvelle_execution(rid: str, entreprise: str, base: str, cotee: bool, options: dict, declencheur: dict,
                       type_: str = "client") -> dict:
    eid = datetime.now().strftime("%Y%m%d-%H%M%S-") + uuid.uuid4().hex[:4]
    blocs = []
    modele_blocs, liens = modele_workflow(type_)
    for bid, titre, col, source, modele in modele_blocs:
        blocs.append({"id": bid, "titre": titre, "colonne": col, "source": source, "modele": modele,
                      "etat": "attente", "debut": None, "fin": None, "resume": None, "details": []})
    e = {"id": eid, "rid": rid, "entreprise": entreprise, "base": base, "options": options,
         "declencheur": declencheur, "statut": "en_cours", "debut": time.time(), "fin": None,
         "modele": None, "duree_api_ms": None, "message": None, "journal": [], "blocs": blocs,
         "liens": liens, "version": 0, "etapes": [], "details": [], "type": type_}
    d = _bloc(e, "declencheur")
    d.update(etat="fait", debut=time.time(), fin=time.time(), resume=declencheur.get("libelle"))
    if not cotee:
        finir_bloc(e, "bourse", "saute", f"{entreprise} n'est pas cotée en bourse")
    elif not options.get("bourse", True):
        finir_bloc(e, "bourse", "saute", "Désactivé pour cette préparation")
    if not options.get("linkedin", True):
        finir_bloc(e, "linkedin", "saute", "Désactivé pour cette préparation")
    if type_ == "prospect":
        for lettre, bid in LETTRES_PROSPECT.items():
            if lettre not in options.get("angles", "PSEF"):
                finir_bloc(e, bid, "saute", "Désactivé pour cette préparation")
    else:
        for lettre, (bid, _, _) in ANGLES.items():
            if lettre not in options.get("angles", "ABC"):
                finir_bloc(e, bid, "saute", "Désactivé pour cette préparation")
    if not options.get("audio", True):
        finir_bloc(e, "audio_texte", "saute", "Version audio désactivée")
    _bloc(e, "envoi")["resume"] = "Prévu 30 minutes avant le rendez-vous"
    with VERROU:
        EXECUTIONS[eid] = e
        DERNIERE[rid] = eid
    _maj(e)
    return e


def consigne_options_prospect(options: dict) -> str:
    noms = {"P": "profil-interlocuteur", "S": "veille-signal", "E": "enjeux-secteur", "F": "fournisseurs-concurrence"}
    angles = options.get("angles", "PSEF")
    lances = [noms[l] for l in "PSEF" if l in angles]
    if options.get("linkedin", True):
        lances.append("linkedin-entreprise")
    if options.get("bourse", True):
        lances.append("cours-bourse (si coté)")
    lignes = [f"Agents à lancer, un par recherche, tous dans le même message et au premier plan (run_in_background: false) : {', '.join(lances) or 'aucun'}. "
              "Ne fais jamais une recherche toi-même et ne regroupe jamais deux recherches."]
    for l, nom in noms.items():
        if l not in angles:
            lignes.append(f"Option : ne lance PAS l'agent {nom}, indique dans la fiche que cette recherche n'a pas été faite.")
    if not options.get("audio", True):
        lignes.append("Option : pas de version audio. Saute la version à écouter et lance rendre_fiche.py avec --sans-audio.")
    return " " + " ".join(lignes)


def consigne_options(options: dict, type_: str = "client") -> str:
    """Instructions ajoutées au prompt selon les réglages choisis dans les Coulisses."""
    if type_ == "prospect":
        return consigne_options_prospect(options)
    lignes = []
    if not options.get("bourse", True):
        lignes.append("Option : ne lance PAS l'agent du cours de bourse, indique « non consulté » dans la fiche.")
    if not options.get("linkedin", True):
        lignes.append("Option : ne lance PAS l'agent LinkedIn, indique « page LinkedIn non consultée » dans la fiche.")
    else:
        lignes.append("L'agent linkedin-entreprise est obligatoire : ne le saute jamais, même si d'autres recherches sont désactivées.")
    lignes.append("Chaque recherche a son propre agent Sonnet (cours-bourse, linkedin-entreprise, un veille-entreprise par angle), tous lancés dans le même message et au premier plan (run_in_background: false) : ne fais jamais une recherche toi-même et ne regroupe jamais deux recherches.")
    angles = options.get("angles", "ABC")
    if angles != "ABC":
        if angles:
            lignes.append("Option : ne lance QUE les agents de presse (veille-entreprise) des angles " + ", ".join(angles) + ".")
        else:
            lignes.append("Option : aucun agent de presse (veille-entreprise), indique « recherche web non effectuée » dans la fiche.")
    if not options.get("audio", True):
        lignes.append("Option : pas de version audio. Saute l'étape 5 et lance rendre_fiche.py avec --sans-audio.")
    return (" " + " ".join(lignes)) if lignes else ""


# --------------------------------------------------------------------------- lecture du flux Claude

def _angle_de(texte: str, deja: set) -> str | None:
    m = re.search(r"angle\s*:?\s*([ABC])\b", texte, re.I)
    if m:
        return m.group(1).upper()
    t = texte.lower()
    for lettre, mots in (("A", ("financ", "résultat", "bourse")), ("B", ("dirigeant", "gouvernance", "nomination")),
                         ("C", ("industriel", "rse", "usine", "investissement"))):
        if lettre not in deja and any(m in t for m in mots):
            return lettre
    return next((l for l in "ABC" if l not in deja), None)


def _texte_journal(texte: str) -> str:
    """Ce que Claude dit en travaillant, sans les blocs techniques ni les en-têtes décoratifs."""
    if texte.strip().startswith(("```", "{", "[")):
        return ""
    lignes = [l.strip() for l in texte.splitlines()]
    lignes = [l for l in lignes if l and not l.startswith(("═", "🗣", "🔧", "✅", "---", "|")) and "════" not in l]
    return " ".join(lignes).replace("**", "")


def _texte_resultat(c: dict) -> str:
    contenu = c.get("content")
    if isinstance(contenu, list):
        return "\n".join(x.get("text", "") for x in contenu if isinstance(x, dict))
    return str(contenu or "")


def _json_dans(texte: str):
    m = re.search(r"\{.*\}", texte, re.S)
    if not m:
        return None
    try:
        return json.loads(m.group(0))
    except json.JSONDecodeError:
        return None


def _fr(v, signe: bool = False, dec: int = 1) -> str:
    """Nombre au format français : virgule décimale, espace fine pour les milliers, signe explicite si demandé."""
    if v is None:
        return "n.d."
    t = f"{v:+,.{dec}f}" if signe else f"{v:,.{dec}f}"
    return t.replace(",", "\u202f").replace(".", ",")


def _recherche_lisible(q: str) -> str:
    """Requête de recherche montrée au commercial sans les opérateurs techniques (site:, guillemets, OR)."""
    q = re.sub(r"\bsite:\S+", "", q or "")
    q = re.sub(r"\b(OR|AND)\b", "", q).replace('"', "").replace("«", "").replace("»", "")
    return re.sub(r"\s+", " ", q).strip()


def _euros(v):
    return "n.d." if v is None else f"{v:,.0f} €".replace(",", " ")


def _resultat_outil(e: dict, bid: str, texte: str, erreur: bool):
    # une commande enchaînée peut échouer sur sa fin (un « cat » raté) alors que l'étape a bien produit son fichier
    produit = {"crm": DOSSIERS / f"{e['base']}_dossier.json", "linkedin": BRIEFS / f"{e['base']}_linkedin.json",
               "bourse": BRIEFS / f"{e['base']}_bourse.json"}.get(bid)
    if erreur and produit and produit.exists() and produit.stat().st_mtime >= (e.get("debut") or 0):
        erreur = False
    if erreur:
        finir_bloc(e, bid, "erreur", "Cette étape a rencontré une erreur, Claude a réessayé ou contourné.")
        return
    if bid == "crm" and e.get("type") == "prospect":
        d = None
        try:
            d = json.loads((DOSSIERS / f"{e['base']}_dossier.json").read_text(encoding="utf-8"))
        except Exception:
            pass
        if d:
            f = d["funnel"]
            finir_bloc(e, bid, resume=f"{f['etape']} · {f['decouverte']['obtenus']} critère{'s' if f['decouverte']['obtenus'] > 1 else ''} sur {f['decouverte']['total']} déjà obtenus", details=[
                {"type": "source", "texte": f"CRM de prospection du {'/'.join(reversed(d['meta']['date_reference'].split('-')))}"},
                {"type": "texte", "texte": f"Rendez-vous : {d['rendez_vous']['rang'] or 'premier rendez-vous'}, avec {d['rendez_vous']['interlocuteur']}"},
                {"type": "chiffre", "texte": f"À obtenir pendant ce rendez-vous : {', '.join(c['critere'].lower() for c in d['criteres_a_viser'][:6])}"},
                {"type": "texte", "texte": f"Origine du contact : {d['prospect'].get('Origine du contact') or 'non renseignée'}"},
            ])
            return
    if bid == "strategie":
        j = None
        try:
            j = json.loads((BRIEFS / f"{e['base']}_strategie.json").read_text(encoding="utf-8"))
        except Exception:
            pass
        if j:
            sig = j.get("signal") or {}
            finir_bloc(e, bid, resume=f"{len(j.get('douleurs', []))} pistes de vrai problème · {len(j.get('objections', []))} objections préparées", details=[
                {"type": "fait", "texte": sig.get("fait", ""), "source": sig.get("source"), "date": sig.get("date"), "url": sig.get("url")} if sig.get("fait") else
                {"type": "texte", "texte": "Pas de signal récent trouvé"}] + [
                {"type": "texte", "texte": f"Piste : {d.get('hypothese', '')}"} for d in j.get("douleurs", [])] + [
                {"type": "texte", "texte": f"Pour conclure : {(j.get('conclusion') or {}).get('phrase', '')}"}])
            return
    if bid == "crm":
        d = None
        try:
            d = json.loads((DOSSIERS / f"{e['base']}_dossier.json").read_text(encoding="utf-8"))
        except Exception:
            pass
        if d:
            ent = d["entreprise"]
            finir_bloc(e, bid, resume=f"CA 12 mois {_euros(ent['ca_12_mois'])} · {len(d['contacts'])} contacts · {len(d['transactions'])} affaires · {len(d['tickets'])} réclamations", details=[
                {"type": "source", "texte": f"Export CRM du {'/'.join(reversed(d['meta']['date_reference'].split('-')))}"},
                {"type": "texte", "texte": "Onglets lus : Rendez-vous, Entreprises, Contacts, Activités, Transactions, Tickets, Commandes, Produits"},
                {"type": "chiffre", "texte": f"Chiffre d'affaires 12 mois : {_euros(ent['ca_12_mois'])} sur un potentiel de {_euros(ent['potentiel_annuel'])}"},
                {"type": "chiffre", "texte": f"{len(d['activites_recentes'])} dernières activités, {d['commandes']['synthese']['nombre']} commandes, {d['commandes']['synthese']['en_retard']} en retard"},
                {"type": "texte", "texte": "Indicateurs recalculés à partir des colonnes saisies, sans lire les formules"},
            ])
            return
    if bid == "bourse":
        j = _json_dans(texte)
        if j and j.get("statut") == "ok":
            date_c = "/".join(reversed(str(j['date_cours']).split("-")))
            finir_bloc(e, bid, resume=f"{_fr(j['dernier_cours'], dec=2)}\u00a0€ · {_fr(j['variation_12_mois_pct'], True)}\u00a0% sur 12 mois", details=[
                {"type": "source", "texte": f"Yahoo Finance · cours du {date_c}", "url": f"https://finance.yahoo.com/quote/{j['ticker']}"},
                {"type": "chiffre", "texte": f"1 mois {_fr(j['variation_1_mois_pct'], True)}\u00a0% · 3 mois {_fr(j['variation_3_mois_pct'], True)}\u00a0% · 12 mois {_fr(j['variation_12_mois_pct'], True)}\u00a0%"},
                {"type": "chiffre", "texte": f"Plus haut sur un an {_fr(j['plus_haut_52_semaines'], dec=2)}\u00a0€ · plus bas {_fr(j['plus_bas_52_semaines'], dec=2)}\u00a0€"},
            ])
            return
        if j:
            finir_bloc(e, bid, "saute", j.get("message"))
            return
    if bid == "linkedin":
        j = _json_dans(texte)
        d = None
        try:
            d = json.loads((BRIEFS / f"{e['base']}_linkedin.json").read_text(encoding="utf-8"))
        except Exception:
            pass
        if j and j.get("statut") == "ok" and d:
            pubs = d.get("publications", [])
            recentes = [p for p in pubs if p.get("recente")]
            date_fr = lambda iso: "/".join(reversed(iso.split("-")))
            finir_bloc(e, bid, resume=f"{len(recentes)} publication{'s' if len(recentes) > 1 else ''} ces 3 derniers mois" if recentes else "Aucune publication ces 3 derniers mois", details=[
                {"type": "source", "texte": f"Page LinkedIn de {d.get('nom_page') or e['entreprise']}", "url": d.get("page")}] + [
                {"type": "fait", "texte": (p["texte"].split("\n")[0] or p["texte"])[:160], "source": "LinkedIn", "date": date_fr(p["date"]), "url": p.get("url"),
                 "interet": f"{p['jaime']} j'aime" if p.get("jaime") else None} for p in (recentes or pubs)[:6]])
            return
        if j:
            finir_bloc(e, bid, "saute", "Page LinkedIn introuvable" if j.get("statut") == "introuvable" else "LinkedIn n'a pas répondu")
            return
    if bid == "profil":
        j = _json_dans(texte)
        if j and j.get("couleur"):
            finir_bloc(e, bid, resume=f"Plutôt {j['couleur']}{' et ' + j['couleur_secondaire'] if j.get('couleur_secondaire') else ''} · confiance {j.get('confiance', 'faible')}",
                       details=([{"type": "source", "texte": "Profil LinkedIn public", "url": j.get("profil")}] if j.get("profil") else []) + [
                           {"type": "fait", "texte": i.get("constat", ""), "source": "LinkedIn", "date": i.get("source")} for i in j.get("indices", [])] + [
                           {"type": "texte", "texte": f"Ton : {t}"} for t in (j.get("ton") or {}).get("a_faire", [])[:3]])
            return
        if j:
            finir_bloc(e, bid, "saute", {"non_public": "Profil LinkedIn non visible sans compte", "introuvable": "Profil LinkedIn introuvable"}.get(j.get("statut"), "Profil LinkedIn indisponible"))
            return
    if bid.startswith("veille_") or bid in ("signal", "secteur", "fournisseurs"):
        j = _json_dans(texte)
        faits = (j or {}).get("faits", [])
        finir_bloc(e, bid, resume=f"{len(faits)} fait{'s' if len(faits) > 1 else ''} retenu{'s' if len(faits) > 1 else ''}" if j else "Recherche terminée", details=[
            {"type": "fait", "texte": f.get("titre", ""), "source": f.get("source"), "date": f.get("date"), "url": f.get("url"),
             "interet": f.get("interet_commercial")} for f in faits] + [
            {"type": "texte", "texte": f"Rien de fiable trouvé sur : {s}"} for s in (j or {}).get("rien_trouve_sur", [])])
        return
    if bid == "rendu":
        j = _json_dans(texte)
        if j:
            finir_bloc(e, bid, resume=f"Page imprimable{' + audio, voix ' + j['voix'] if j.get('voix') else ''}",
                       details=[{"type": "texte", "texte": f"Version à écouter : {j['mots']} mots, environ {_fr(j['mots'] / 150)}\u00a0minutes"}] if j.get("mots") else [])
            return
    if bid == "crm_coche":
        j = _json_dans(texte)
        if j:
            finir_bloc(e, bid, resume="« Brief préparé » = Oui" if j.get("statut") == "ok" else "Déjà coché, rien à écrire",
                       details=[{"type": "source", "texte": f"Cellule {j['cellule']}, sauvegarde {j['sauvegarde']}"}] if j.get("cellule") else
                               [{"type": "texte", "texte": j.get("message", "")}])
            return
    finir_bloc(e, bid)


ROLES_MODELES = {"haiku": "Recherches dans la presse", "sonnet": "Lecture, rédaction et audio", "opus": "Lecture, rédaction et audio"}


def conso_depuis_resultat(m: dict) -> dict | None:
    """Tokens et coût d'une préparation, à partir du message « result » de Claude (cumulé sur la session, recherches comprises).
    Le coût est le prix public de l'API (costBasis « list ») : ce que coûterait la même fiche facturée à l'usage."""
    usage = m.get("modelUsage") or {}
    if not usage:
        return None
    modeles = []
    for nom, u in usage.items():
        famille = next((f for f in ROLES_MODELES if f in nom), "")
        modeles.append({
            "modele": nom, "role": ROLES_MODELES.get(famille, "Autre"),
            "entree": u.get("inputTokens", 0), "sortie": u.get("outputTokens", 0),
            "cache_lu": u.get("cacheReadInputTokens", 0), "cache_ecrit": u.get("cacheCreationInputTokens", 0),
            "recherches_web": u.get("webSearchRequests", 0), "cout_usd": round(u.get("costUSD", 0.0), 6),
        })
    total = lambda k: sum(x[k] for x in modeles)
    return {"cout_usd": round(m.get("total_cost_usd") or sum(x["cout_usd"] for x in modeles), 6),
            "entree": total("entree"), "sortie": total("sortie"), "cache_lu": total("cache_lu"), "cache_ecrit": total("cache_ecrit"),
            "recherches_web": total("recherches_web"), "modeles": modeles, "provisoire": False}


def _conso_direct(e: dict, m: dict, vus: set):
    """Compteur en direct pendant la préparation : on additionne l'usage de chaque réponse (une seule fois par message)."""
    msg = m.get("message") or {}
    u, mid = msg.get("usage"), msg.get("id")
    if not u or not mid or mid in vus:
        return
    vus.add(mid)
    c = e.get("conso") or {"cout_usd": None, "entree": 0, "sortie": 0, "cache_lu": 0, "cache_ecrit": 0, "recherches_web": 0, "modeles": [], "provisoire": True}
    c["entree"] += u.get("input_tokens", 0) or 0
    c["sortie"] += u.get("output_tokens", 0) or 0
    c["cache_lu"] += u.get("cache_read_input_tokens", 0) or 0
    c["cache_ecrit"] += u.get("cache_creation_input_tokens", 0) or 0
    e["conso"] = c


def conso_depuis_log(chemin: Path) -> dict | None:
    dernier = None
    try:
        for ligne in chemin.open(encoding="utf-8"):
            if '"type":"result"' in ligne or '"type": "result"' in ligne:
                try:
                    dernier = json.loads(ligne)
                except json.JSONDecodeError:
                    pass
    except OSError:
        return None
    return conso_depuis_resultat(dernier) if dernier else None


def completer_conso(e: dict) -> dict:
    """Anciennes préparations : on retrouve la consommation dans le journal brut de Claude (logs/preparation_<rdv>_<date>.jsonl)."""
    if e.get("conso") and not e["conso"].get("provisoire") or e.get("conso_efface"):
        return e
    from datetime import datetime as _dt
    debut = e.get("debut") or 0
    meilleur = None
    for p in (RACINE / "logs").glob(f"preparation_{e.get('rid')}_*.jsonl"):
        try:
            t = _dt.strptime(p.stem.rsplit("_", 1)[1], "%Y%m%d-%H%M%S").timestamp()
        except ValueError:
            continue
        ecart = abs(t - debut)
        if ecart < 120 and (meilleur is None or ecart < meilleur[0]):
            meilleur = (ecart, p)
    if meilleur:
        c = conso_depuis_log(meilleur[1])
        if c:
            e["conso"] = c
            if e.get("statut") != "en_cours":
                sauver(e)
    return e


def suivre_flux(e: dict, proc: subprocess.Popen, log_path: Path):
    outils: dict[str, str] = {}       # id d'appel d'outil -> brique (retiré quand le résultat arrive)
    agents: dict[str, str] = {}       # id d'appel d'un agent de recherche -> brique (gardé jusqu'à sa fin)
    angles_vus: set[str] = set()
    messages_comptes: set[str] = set()
    with open(log_path, "w", encoding="utf-8") as log:
        for ligne in proc.stdout:
            log.write(ligne)
            try:
                m = json.loads(ligne)
            except json.JSONDecodeError:
                continue
            typ, parent = m.get("type"), m.get("parent_tool_use_id")
            if typ == "assistant" and (e.get("conso") or {}).get("provisoire", True):
                _conso_direct(e, m, messages_comptes)
            if typ == "system" and m.get("subtype") == "init":
                e["modele"] = e["modele"] or m.get("model")
                _maj(e)
            elif typ == "system" and m.get("subtype") == "task_notification" and m.get("tool_use_id") in agents:
                # fin d'un agent de veille lancé en arrière-plan : sa réponse complète est dans « summary »
                bid = agents.pop(m["tool_use_id"])
                _resultat_outil(e, bid, m.get("summary") or "", m.get("status") not in ("completed", None))
            elif typ == "assistant":
                for c in m["message"].get("content", []):
                    if c.get("type") == "text" and not parent and c.get("text", "").strip():
                        texte = _texte_journal(c["text"])
                        if texte:
                            e["journal"].append({"t": time.time(), "texte": texte[:400]})
                            _maj(e)
                    if c.get("type") != "tool_use":
                        continue
                    nom, inp, tid = c["name"], c.get("input", {}), c.get("id")
                    cmd = inp.get("command", "") if nom == "Bash" else ""
                    chemin = inp.get("file_path", "")
                    if parent and parent in agents:
                        bid = agents[parent]
                        if nom == "WebSearch":
                            demarrer_bloc(e, bid, {"type": "recherche", "texte": _recherche_lisible(inp.get("query", ""))})
                        elif nom == "WebFetch":
                            u = inp.get("url", "")
                            demarrer_bloc(e, bid, {"type": "lecture", "texte": urlparse(u).netloc.replace("www.", ""), "url": u})
                        elif nom == "Bash" and bid in ("bourse", "linkedin"):
                            demarrer_bloc(e, bid, {"type": "lecture", "texte": "Yahoo Finance" if bid == "bourse" else "linkedin.com"})
                        continue
                    bid = None
                    if "--help" in cmd or " -h" in cmd:
                        pass  # Claude consulte le mode d'emploi d'un outil : ce n'est pas encore l'étape
                    elif nom in ("Agent", "Task") and inp.get("subagent_type") in AGENTS_DEDIES:
                        bid = AGENTS_DEDIES[inp["subagent_type"]]
                        agents[tid] = bid
                    elif "extraire_dossier" in cmd or "extraire_prospect" in cmd:
                        bid = "crm"
                    elif nom == "Write" and chemin.endswith("_strategie.json"):
                        bid = "strategie"
                    elif "cours_bourse" in cmd:
                        bid = "bourse"
                    elif "linkedin_entreprise" in cmd:
                        bid = "linkedin"
                    elif nom in ("Agent", "Task"):
                        lettre = _angle_de(json.dumps(inp, ensure_ascii=False), angles_vus)
                        if lettre:
                            angles_vus.add(lettre)
                            bid = ANGLES[lettre][0]
                            agents[tid] = bid
                    elif "compiler_sources" in cmd or (nom == "Write" and chemin.endswith(("_veille.json", "_sources.json"))):
                        bid = "compilation"
                    elif (nom == "Write" and chemin.endswith("_fiche.md")) or re.search(r">\s*\S*_fiche\.md", cmd):
                        bid = "redaction"
                    elif (nom == "Write" and chemin.endswith("_audio.txt")) or re.search(r">\s*\S*_audio\.txt", cmd):
                        bid = "audio_texte"
                    elif "rendre_fiche" in cmd:
                        bid = "rendu"
                    elif "ecrire_crm" in cmd:
                        bid = "crm_coche"
                    if bid and not any(b["id"] == bid for b in e["blocs"]):
                        agents.pop(tid, None)
                        bid = None  # étape qui n'existe pas dans ce workflow (client ou prospect)
                    if bid:
                        outils[tid] = bid
                        demarrer_bloc(e, bid)
            elif typ == "user" and not parent:
                contenu = m.get("message", {}).get("content")
                for c in contenu if isinstance(contenu, list) else []:
                    if c.get("type") == "tool_result" and c.get("tool_use_id") in outils:
                        if c["tool_use_id"] in agents and not c.get("is_error") and "Async agent launched" in _texte_resultat(c):
                            outils.pop(c["tool_use_id"])  # agent lancé en arrière-plan : la fin viendra par task_notification
                            continue
                        agents.pop(c["tool_use_id"], None)  # agent au premier plan : sa réponse est dans ce résultat
                        bid = outils.pop(c["tool_use_id"])
                        if bid in ("compilation",) and any(v == "compilation" for v in outils.values()):
                            continue
                        _resultat_outil(e, bid, _texte_resultat(c), bool(c.get("is_error")))
            elif typ == "rate_limit_event":
                info = m.get("rate_limit_info", {})
                fen = (info.get("unifiedWindows") or {}).get("five_hour") or {}
                e["quota"] = {"utilise": fen.get("utilization"), "reinitialise": fen.get("resetsAt") or info.get("resetsAt"),
                              "statut": info.get("status")}
                _maj(e)
            elif typ == "result":
                if e["statut"] == "en_cours":  # après un arrêt, on garde « arrêtée à votre demande »
                    e["message"] = (m.get("result") or "").strip()
                e["duree_api_ms"] = m.get("duration_ms")
                e["conso"] = conso_depuis_resultat(m) or e.get("conso")
                _maj(e)
    proc.wait()


def cloturer(e: dict, ok: bool, arrete: bool = False):
    for b in e["blocs"]:
        if b["id"] == "envoi":
            continue
        if b["etat"] == "en_cours":
            b["etat"] = "arrete" if arrete else ("fait" if ok else "erreur")
            b["fin"] = time.time()
        elif b["etat"] == "attente":
            b["etat"] = "arrete" if arrete else ("fait" if ok and b["id"] in ("compilation", "strategie", "redaction", "audio_texte", "rendu") else "saute")
    e["statut"] = "arrete" if arrete else ("termine" if ok else "echec")
    if arrete:
        e["message"] = "Préparation arrêtée à votre demande."
    elif not ok:
        e["message"] = "La préparation n'a pas pu aller au bout. Vous pouvez relancer."
    e["fin"] = time.time()
    _maj(e)
    elaguer_conso()


def marquer_envoi(rid: str, ok: bool, texte: str):
    eid = DERNIERE.get(rid)
    e = EXECUTIONS.get(eid) if eid else None
    if not e:
        return
    b = _bloc(e, "envoi")
    b.update(etat="fait" if ok else "erreur", debut=b["debut"] or time.time(), fin=time.time(), resume=texte)
    _maj(e)


# --------------------------------------------------------------------------- vue simplifiée (onglet principal)

def etapes_simplifiees(e: dict) -> list[dict]:
    def etat(*ids):
        etats = [_bloc(e, i)["etat"] for i in ids]
        if any(x == "en_cours" for x in etats):
            return "en_cours"
        if all(x in ("saute",) for x in etats):
            return "saute"
        if all(x in ("fait", "saute", "erreur") for x in etats):
            return "fait"
        if any(x in ("fait",) for x in etats):
            return "en_cours"
        return "a_faire"
    ent = e["entreprise"]
    bourse = _bloc(e, "bourse")
    if e.get("type") == "prospect":
        return [
            {"cle": "crm", "libelle": "Je consulte votre CRM de prospection", "etat": etat("crm")},
            {"cle": "profil", "libelle": "Je regarde comment s'exprime votre interlocuteur, pour trouver le bon ton", "etat": etat("profil")},
            {"cle": "veille", "libelle": f"Je cherche ce qui se passe chez {ent} et dans son secteur", "etat": etat("signal", "secteur", "fournisseurs")},
            {"cle": "linkedin", "libelle": f"Je lis la page LinkedIn de {ent} et son cours de bourse", "etat": etat("linkedin", "bourse")},
            {"cle": "strategie", "libelle": "Je prépare vos questions pour trouver le vrai problème", "etat": etat("compilation", "strategie")},
            {"cle": "redaction", "libelle": "Je rédige votre fiche", "etat": etat("redaction")},
            {"cle": "audio", "libelle": "J'enregistre la version à écouter", "etat": etat("audio_texte", "rendu")},
            {"cle": "coche", "libelle": "Je note dans le CRM de prospection que la fiche est prête", "etat": etat("crm_coche")},
        ]
    return [
        {"cle": "crm", "libelle": "Je consulte votre CRM", "etat": etat("crm")},
        {"cle": "bourse", "libelle": bourse["resume"] if bourse["etat"] == "saute" and bourse["resume"] else f"Je regarde le cours de bourse de {ent}", "etat": etat("bourse")},
        {"cle": "linkedin", "libelle": f"Je lis la page LinkedIn de {ent}", "etat": etat("linkedin")},
        {"cle": "veille", "libelle": f"Je cherche l'actualité récente de {ent}", "etat": etat("veille_a", "veille_b", "veille_c")},
        {"cle": "redaction", "libelle": "Je rédige votre fiche", "etat": etat("compilation", "redaction")},
        {"cle": "audio", "libelle": "J'enregistre la version à écouter", "etat": etat("audio_texte", "rendu")},
        {"cle": "coche", "libelle": "Je note dans le CRM que la fiche est prête", "etat": etat("crm_coche")},
    ]


def details_recents(e: dict, n: int = 6) -> list[dict]:
    tous = []
    noms = {b["id"]: b["titre"] for b in e["blocs"]}
    for b in e["blocs"]:
        for d in b["details"]:
            if d["type"] in ("recherche", "lecture"):
                prefixe = "Recherche" if d["type"] == "recherche" else "Lecture"
                tous.append({"etape": b["id"], "texte": f"{prefixe} : {'« ' + d['texte'] + ' »' if d['type'] == 'recherche' else d['texte']}", "t": d["t"]})
    for j in e["journal"]:
        tous.append({"etape": "journal", "texte": j["texte"].split("\n")[0][:140], "t": j["t"]})
    return sorted(tous, key=lambda x: x["t"])[-n:]


def reparer(e: dict) -> dict:
    """Préparation archivée « en cours » mais qui ne tourne plus (application fermée pendant qu'elle travaillait) : on la clôt."""
    if e.get("statut") == "en_cours" and e.get("id") not in EXECUTIONS:
        for b in e["blocs"]:
            if b["etat"] in ("en_cours", "attente") and b["id"] != "envoi":
                b["etat"] = "arrete"
        e["statut"], e["message"] = "arrete", "Préparation interrompue : l'application a été fermée pendant qu'elle travaillait."
        e["fin"] = e.get("fin") or e.get("_sauve") or e.get("debut")
        sauver(e)
    return e


def _blocs_complets(e: dict) -> list[dict]:
    """Les préparations faites avant l'ajout d'une étape (LinkedIn...) l'affichent quand même, comme « sautée »."""
    presents = {b["id"]: b for b in e["blocs"]}
    return [presents.get(bid) or {"id": bid, "titre": titre, "colonne": col, "source": source, "modele": modele, "etat": "saute",
                                  "debut": None, "fin": None, "resume": "Étape ajoutée après cette préparation", "details": []}
            for bid, titre, col, source, modele in modele_workflow(e.get("type", "client"))[0]]


def vue(e: dict, complete: bool = True) -> dict:
    v = {k: e[k] for k in ("id", "rid", "entreprise", "statut", "debut", "fin", "message", "options", "declencheur",
                           "modele", "duree_api_ms", "etapes")}
    v["quota"] = e.get("quota")
    v["conso"] = e.get("conso")
    v["details"] = details_recents(e)
    if complete:
        v.update(blocs=_blocs_complets(e), liens=e.get("liens") or LIENS, journal=e["journal"], type=e.get("type", "client"))
    return v


# --------------------------------------------------------------------------- archives

def sauver(e: dict):
    e["_sauve"] = time.time()
    ARCHIVES.mkdir(parents=True, exist_ok=True)
    donnees = {k: v for k, v in e.items() if not k.startswith("_")}
    (ARCHIVES / f"{e['id']}.json").write_text(json.dumps(donnees, ensure_ascii=False), encoding="utf-8")


GARDER_DETAIL = 3  # on ne garde le détail des coûts que pour les trois dernières fiches produites


def _effacer_detail(e: dict):
    c = e.get("conso") or {}
    total = sum(c.get(k, 0) or 0 for k in ("entree", "sortie", "cache_lu", "cache_ecrit")) or c.get("total")
    e["conso"] = {"cout_usd": c.get("cout_usd"), "total": total or None, "efface": True}
    e["conso_efface"] = True


def elaguer_conso():
    """Garde le détail des coûts des trois dernières fiches (la plus récente par rendez-vous : une nouvelle fiche
    remplace l'ancienne). Pour les autres, seul le total reste, pour les moyennes."""
    gardes, rids = 0, set()
    for p in sorted(ARCHIVES.glob("*.json"), reverse=True):
        try:
            e = EXECUTIONS.get(p.stem) or json.loads(p.read_text(encoding="utf-8"))
        except Exception:
            continue
        if e.get("statut") == "en_cours":
            continue
        if e.get("statut") == "termine" and e.get("rid") not in rids and gardes < GARDER_DETAIL:
            rids.add(e.get("rid")); gardes += 1
            continue
        if e.get("conso_efface"):
            continue
        completer_conso(e)  # récupère d'abord le total depuis le journal, s'il existe
        _effacer_detail(e)
        sauver(e)


def historique(n: int = 40) -> list[dict]:
    res = []
    for p in sorted(ARCHIVES.glob("*.json"), reverse=True)[:n]:
        try:
            e = EXECUTIONS.get(p.stem) or reparer(json.loads(p.read_text(encoding="utf-8")))
            completer_conso(e)
        except Exception:
            continue
        faits = sum(1 for b in e["blocs"] for d in b["details"] if d.get("type") == "fait")
        lectures = sum(1 for b in e["blocs"] for d in b["details"] if d.get("type") == "lecture")
        res.append({"id": e["id"], "rid": e["rid"], "entreprise": e["entreprise"], "statut": e["statut"],
                    "debut": e["debut"], "fin": e["fin"], "declencheur": e["declencheur"],
                    "faits": faits, "lectures": lectures,
                    "cout_usd": (e.get("conso") or {}).get("cout_usd"),
                    "tokens": sum((e.get("conso") or {}).get(k, 0) for k in ("entree", "sortie", "cache_lu", "cache_ecrit")) or (e.get("conso") or {}).get("total"),
                    "detail": bool(e.get("conso")) and not e.get("conso_efface")})
    return res


def charger(eid: str) -> dict | None:
    if eid in EXECUTIONS:
        return EXECUTIONS[eid]
    p = ARCHIVES / f"{eid}.json"
    if p.exists():
        return completer_conso(reparer(json.loads(p.read_text(encoding="utf-8"))))
    return None


def derniere_pour(rid: str) -> dict | None:
    """Résumé de la dernière préparation d'un rendez-vous (en mémoire, sinon dans les archives)."""
    eid = DERNIERE.get(rid)
    if eid and eid in EXECUTIONS:
        e = EXECUTIONS[eid]
        return {"id": e["id"], "statut": e["statut"], "debut": e["debut"],
                "faits": sum(1 for b in e["blocs"] for d in b["details"] if d.get("type") == "fait")}
    for h in historique(200):
        if h["rid"] == rid:
            return {"id": h["id"], "statut": h["statut"], "debut": h["debut"], "faits": h["faits"]}
    return None
