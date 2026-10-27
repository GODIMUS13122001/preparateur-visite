"""Dernières publications de la page LinkedIn publique d'une entreprise (gratuit, sans compte).

LinkedIn expose, sur la page publique d'une entreprise, ses ~10 dernières publications en données structurées
(texte, date, nombre de « j'aime », lien). On les lit telles quelles.

Usage : .venv/bin/python scripts/linkedin_entreprise.py --entreprise "Bonduelle" --base R001_bonduelle [--page bonduelle] [--jours 90]
Avec --base : écrit sorties/briefs/<base>_linkedin.json et n'affiche qu'un court résumé.
Sans --base : affiche tout le JSON {"statut": "ok"|"introuvable"|"indisponible", "page": url, "publications": [...]}
"""
import argparse
import json
import re
import unicodedata
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

RACINE = Path(__import__("os").environ.get("PREPARATEUR_ESPACE") or Path(__file__).resolve().parent.parent)  # dossier des données
BRIEFS = RACINE / "sorties" / "briefs"

AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36"


def slug(nom: str) -> str:
    s = unicodedata.normalize("NFKD", nom).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-")


def lire_page(page: str) -> tuple[str, list[dict], str | None]:
    url = f"https://www.linkedin.com/company/{page}"
    req = urllib.request.Request(url, headers={"User-Agent": AGENT, "Accept-Language": "fr-FR,fr;q=0.9"})
    with urllib.request.urlopen(req, timeout=20) as r:
        if "/company/" not in r.geturl():  # renvoyé vers la connexion : page non publique
            return url, [], None
        html = r.read().decode("utf-8", "ignore")
    graphe = []
    for m in re.finditer(r'<script type="application/ld\+json">(.*?)</script>', html, re.S):
        try:
            j = json.loads(m.group(1))
        except json.JSONDecodeError:
            continue
        graphe += j.get("@graph", [j])
    nom = next((x.get("name") for x in graphe if x.get("@type") == "Organization"), None)
    posts = [x for x in graphe if x.get("@type") == "SocialMediaPosting"]
    return url, posts, nom


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--entreprise", required=True)
    ap.add_argument("--page", help="identifiant de la page LinkedIn (ex. bonduelle), deviné depuis le nom sinon")
    ap.add_argument("--jours", type=int, default=90)
    ap.add_argument("--base", help="ex. R001_bonduelle : écrit sorties/briefs/<base>_linkedin.json")
    a = ap.parse_args()

    def rendre(d: dict):
        if not a.base:
            print(json.dumps(d, ensure_ascii=False, indent=2))
            return
        BRIEFS.mkdir(parents=True, exist_ok=True)
        (BRIEFS / f"{a.base}_linkedin.json").write_text(json.dumps(d, ensure_ascii=False, indent=2), encoding="utf-8")
        pubs = d.get("publications", [])
        print(json.dumps({"statut": d["statut"], "page": d.get("page"), "nom_page": d.get("nom_page"), "publications": len(pubs),
                          "recentes": sum(1 for x in pubs if x["recente"]), "plus_recente": pubs[0]["date"] if pubs else None,
                          "fichier": f"sorties/briefs/{a.base}_linkedin.json", "message": d.get("message")}, ensure_ascii=False))

    candidats = [a.page] if a.page else list(dict.fromkeys([slug(a.entreprise), slug(a.entreprise).replace("-", "")]))
    limite = datetime.now(timezone.utc) - timedelta(days=a.jours)
    for page in candidats:
        try:
            url, posts, nom = lire_page(page)
        except Exception as ex:  # réseau, page absente
            if getattr(ex, "code", None) == 404:
                continue
            rendre({"statut": "indisponible", "page": f"https://www.linkedin.com/company/{page}", "message": "LinkedIn n'a pas répondu", "publications": []})
            return
        if not nom:
            continue
        res = []
        for p in posts:
            try:
                d = datetime.fromisoformat(p["datePublished"].replace("Z", "+00:00"))
            except (KeyError, ValueError):
                continue
            res.append({"date": d.date().isoformat(), "texte": (p.get("text") or "").strip()[:1200],
                        "jaime": (p.get("interactionStatistic") or {}).get("userInteractionCount"),
                        "url": p.get("mainEntityOfPage") or p.get("url"), "recente": d >= limite})
        res.sort(key=lambda x: x["date"], reverse=True)
        rendre({"statut": "ok", "page": url, "nom_page": nom, "publications": res})
        return
    rendre({"statut": "introuvable", "message": "Page LinkedIn publique introuvable : préciser --page", "publications": []})


if __name__ == "__main__":
    main()
