"""Rassemble le dossier CRM, le cours de bourse et la veille web d'un rendez-vous dans un seul fichier.

Entrées : sorties/dossiers/<base>_dossier.json, sorties/briefs/<base>_bourse.json, sorties/briefs/<base>_veille.json, sorties/briefs/<base>_linkedin.json,
          et pour un prospect sorties/briefs/<base>_profil.json
Sortie  : sorties/briefs/<base>_sources.json
"""
import argparse
import json
from pathlib import Path

RACINE = Path(__import__("os").environ.get("PREPARATEUR_ESPACE") or Path(__file__).resolve().parent.parent)  # dossier des données
DOSSIERS = RACINE / "sorties" / "dossiers"
BRIEFS = RACINE / "sorties" / "briefs"


def lire(chemin: Path, defaut):
    return json.loads(chemin.read_text(encoding="utf-8")) if chemin.exists() else defaut


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--base", required=True, help="ex. R001_bonduelle")
    args = ap.parse_args()
    sources = {
        "crm": lire(DOSSIERS / f"{args.base}_dossier.json", None),
        "bourse": lire(BRIEFS / f"{args.base}_bourse.json", {"statut": "non_cotee"}),
        "veille": lire(BRIEFS / f"{args.base}_veille.json", []),
        "linkedin": lire(BRIEFS / f"{args.base}_linkedin.json", {"statut": "non_consulte", "publications": []}),
    }
    profil = BRIEFS / f"{args.base}_profil.json"  # prospects : couleur probable de l'interlocuteur (agent profil-interlocuteur)
    if profil.exists():
        sources["profil_interlocuteur"] = lire(profil, None)
    if sources["crm"] is None:
        raise SystemExit(f"Dossier CRM introuvable pour {args.base}")
    sortie = BRIEFS / f"{args.base}_sources.json"
    sortie.write_text(json.dumps(sources, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"statut": "ok", "sources": str(sortie.relative_to(RACINE))}, ensure_ascii=False))


if __name__ == "__main__":
    main()
