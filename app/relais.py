"""Lien entre le Mac (le moteur) et le relais Vercel (l'appli mobile).

- publie l'état de la journée et les fiches prêtes vers le relais, seulement quand quelque chose change
  (la version gratuite de Vercel limite le nombre d'écritures) ;
- écoute en direct le canal privé où le relais sonne le Mac (note vocale déposée, compte rendu validé) ;
- fournit le lien d'appairage du téléphone (affiché en QR code dans l'appli).
"""
from __future__ import annotations

import hashlib
import json
import sys
import threading
import time
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Callable

ETAT = {"connecte": False, "derniere_publication": None, "erreur": None, "evenements": []}
_reveil = threading.Event()
_gestionnaires: dict[str, Callable[[dict], None]] = {}


def config(dossier_config: Path) -> dict:
    try:
        return json.loads((dossier_config / "relais.json").read_text(encoding="utf-8"))
    except Exception:
        return {}


def appel(cfg: dict, methode: str, chemin: str, corps: bytes | None = None, type_contenu: str = "application/json", delai: int = 60):
    req = urllib.request.Request(cfg["url"].rstrip("/") + chemin, data=corps, method=methode,
                                 headers={"x-cle": cfg["cle_moteur"], "content-type": type_contenu})
    with urllib.request.urlopen(req, timeout=delai) as rep:
        donnees = rep.read()
    try:
        return json.loads(donnees)
    except Exception:
        return donnees


def lien_appairage(cfg: dict) -> str | None:
    if not cfg.get("url") or not cfg.get("cle_acces"):
        return None
    return f"{cfg['url'].rstrip('/')}/#cle={cfg['cle_acces']}"


def signaler_changement():
    """À appeler quand la journée change (fiche prête, CRM déposé, agenda mis à jour, compte rendu...)."""
    _reveil.set()


def sur_evenement(nom: str, fonction: Callable[[dict], None]):
    _gestionnaires[nom] = fonction


def notifier_telephone(cfg: dict, titre: str, corps: str, lien: str = "/") -> dict:
    """Notification de l'appli mobile elle-même (Web Push), pour tous les téléphones appairés."""
    try:
        return appel(cfg, "POST", "/api/push?action=envoyer", json.dumps({"titre": titre, "corps": corps, "lien": lien}).encode("utf-8"))
    except Exception as e:
        return {"ok": False, "message": f"{type(e).__name__}"}


def boucle_publication(dossier_config: Path, construire_etat: Callable[[], dict], fichiers_a_publier: Callable[[], list[tuple[str, Path, str]]]):
    """Publie l'état (et les fiches nouvelles ou modifiées) seulement quand il a changé ; vérifie au moins toutes les 5 min."""
    dernier_hash = None
    publies: dict[str, float] = {}
    while True:
        cfg = config(dossier_config)
        if cfg.get("url"):
            try:
                for chemin_distant, local, type_contenu in fichiers_a_publier():
                    if local.exists() and publies.get(chemin_distant) != local.stat().st_mtime:
                        appel(cfg, "PUT", "/api/fichier?chemin=" + urllib.parse.quote(chemin_distant), local.read_bytes(), type_contenu, delai=120)
                        publies[chemin_distant] = local.stat().st_mtime
                etat = construire_etat()
                h = hashlib.sha256(json.dumps(etat, sort_keys=True, default=str).encode()).hexdigest()
                if h != dernier_hash:
                    appel(cfg, "PUT", "/api/etat", json.dumps(etat, default=str).encode("utf-8"))
                    dernier_hash = h
                    ETAT["derniere_publication"] = time.time()
                ETAT["erreur"] = None
            except Exception as e:
                ETAT["erreur"] = f"{type(e).__name__}: {e}"
                print("relais (publication) :", e, file=sys.stderr)
        _reveil.wait(300)
        _reveil.clear()
        time.sleep(2)  # regroupe les changements rapprochés


def boucle_ecoute(dossier_config: Path):
    """Écoute le canal privé où le relais sonne le Mac.
    Reprend après le dernier message traité (une note dictée pendant que le Mac était éteint est rattrapée),
    mais ignore l'historique au tout premier lancement : on ne rejoue jamais des événements d'avant l'installation."""
    curseur = dossier_config / "relais_curseur.txt"
    try:
        depuis = curseur.read_text(encoding="utf-8").strip() or str(int(time.time()))
    except Exception:
        depuis = str(int(time.time()))
    attente = 2
    while True:
        cfg = config(dossier_config)
        if not cfg.get("canal"):
            time.sleep(30)
            continue
        try:
            with urllib.request.urlopen(f"https://ntfy.sh/{cfg['canal']}/json?since={depuis}", timeout=90) as flux:
                ETAT["connecte"] = True
                attente = 2
                for ligne in flux:
                    msg = json.loads(ligne)
                    if msg.get("event") != "message":
                        continue
                    depuis = msg.get("id", depuis)
                    try:
                        curseur.write_text(depuis, encoding="utf-8")
                    except Exception:
                        pass
                    try:
                        ev = json.loads(msg.get("message", "{}"))
                    except json.JSONDecodeError:
                        continue
                    if ev.get("type") != "relais":
                        continue
                    ev.pop("local", None)  # « local » ne vaut que pour une validation faite sur le Mac, jamais pour un message du réseau
                    ETAT["evenements"] = (ETAT["evenements"] + [{**ev, "recu": time.time()}])[-20:]
                    f = _gestionnaires.get(ev.get("evenement", ""))
                    if f:
                        threading.Thread(target=f, args=(ev,), daemon=True).start()
        except Exception as e:
            ETAT["connecte"] = False
            if "timed out" not in str(e):
                print("relais (écoute) :", e, file=sys.stderr)
        time.sleep(attente)
        attente = min(attente * 2, 60)
