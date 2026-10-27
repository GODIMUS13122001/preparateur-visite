"""Application de bureau « Préparateur de visite » : le serveur local + une fenêtre native macOS.

Lancée par « Préparateur de visite.app » (sur le Bureau). Rien n'est en ligne : l'interface
tourne sur l'ordinateur (http://127.0.0.1:8765) et s'affiche dans sa propre fenêtre.
Si l'appli tourne déjà (lancée ailleurs), la fenêtre s'y connecte simplement.
"""
from __future__ import annotations

import atexit
import socket
import sys
import threading
import time
from pathlib import Path

import uvicorn
import webview

CODE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(CODE / "app"))
PORT = 8765
DANS_APPLI = ".app/Contents/" in str(CODE)
ESPACE = Path.home() / "Library" / "Application Support" / "Préparateur de visite"


def preparer_espace():
    """Version empaquetée : le code est dans l'appli (lecture seule), les données de l'utilisateur ici.
    À chaque lancement, on remet à jour les fichiers de l'agent (skills, scripts, consignes) sans toucher aux données."""
    import json
    import os
    import secrets
    import shutil
    for d in ("data/sauvegardes", "sorties/briefs", "sorties/dossiers", "config", "logs", ".venv/bin"):
        (ESPACE / d).mkdir(parents=True, exist_ok=True)
    for d in (".claude", "scripts", "integrations"):
        shutil.copytree(CODE / d, ESPACE / d, dirs_exist_ok=True)
    shutil.copy2(CODE / "CLAUDE.md", ESPACE / "CLAUDE.md")
    python = ESPACE / ".venv" / "bin" / "python"   # chemin attendu par le skill : .venv/bin/python
    if python.is_symlink() or python.exists():
        python.unlink()
    python.symlink_to(sys.executable)
    if not list((ESPACE / "data").glob("*.xlsx")):  # premier lancement : le CRM de démonstration
        for f in (CODE / "demo").glob("*.xlsx"):
            shutil.copy2(f, ESPACE / "data" / f.name)
    push = ESPACE / "config" / "push.json"
    if not push.exists():  # canaux privés propres à cet ordinateur
        push.write_text(json.dumps({"service": "ntfy", "serveur": "https://ntfy.sh",
                                    "topic": "preparateur-visite-" + secrets.token_hex(5),
                                    "topic_agenda": "preparateur-agenda-" + secrets.token_hex(6)}, indent=2), encoding="utf-8")
    os.environ["PREPARATEUR_ESPACE"] = str(ESPACE)


URL = f"http://127.0.0.1:{PORT}"


def port_occupe() -> bool:
    with socket.socket() as s:
        return s.connect_ex(("127.0.0.1", PORT)) == 0


def demarrer_serveur():
    import serveur  # noqa: E402  (charge l'appli FastAPI)

    atexit.register(serveur.arret)  # arrête les préparations en cours à la fermeture
    config = uvicorn.Config(serveur.app, host="127.0.0.1", port=PORT, log_level="warning")
    threading.Thread(target=uvicorn.Server(config).run, daemon=True).start()
    for _ in range(60):
        if port_occupe():
            return
        time.sleep(0.25)


def icone_dock():
    """Nom et icône de l'appli dans le Dock (sinon macOS affiche « Python »)."""
    try:
        from AppKit import NSApplication, NSImage
        from Foundation import NSBundle
        info = NSBundle.mainBundle().infoDictionary()
        info["CFBundleName"] = "Préparateur de visite"
        icone = CODE / "app" / "icone" / "icone.png"
        if icone.exists():
            NSApplication.sharedApplication().setApplicationIconImage_(NSImage.alloc().initWithContentsOfFile_(str(icone)))
    except Exception:
        pass


if __name__ == "__main__":
    if DANS_APPLI:
        preparer_espace()
    if not port_occupe():
        demarrer_serveur()
    webview.create_window("Préparateur de visite", URL, width=1440, height=960, min_size=(1000, 700),
                          background_color="#FAF9F6", text_select=True)
    webview.start(icone_dock)
