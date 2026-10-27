"""Profil LinkedIn public d'une personne : titre, texte « Infos », dernières publications et articles (gratuit, sans compte).

LinkedIn expose, sur la vue publique d'un profil, des données structurées pour les moteurs de recherche.
On ne lit que cette page, à l'adresse exacte donnée (jamais une recherche par nom : risque d'homonyme).

Usage : .venv/bin/python scripts/linkedin_profil.py --url https://www.linkedin.com/in/xxx --base RP003_hermes
Écrit sorties/briefs/<base>_profil_linkedin.json et affiche tout son contenu (l'agent n'a pas d'autre moyen de le lire).
Statuts : ok | non_public (LinkedIn renvoie vers sa page de connexion) | introuvable | indisponible
"""
import argparse
import json
import re
import urllib.request
from pathlib import Path

RACINE = Path(__import__("os").environ.get("PREPARATEUR_ESPACE") or Path(__file__).resolve().parent.parent)
BRIEFS = RACINE / "sorties" / "briefs"
AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36"


def nettoyer(t) -> str:
    t = re.sub(r"<br\s*/?>", "\n", str(t or ""))
    return re.sub(r"<[^>]+>", "", t).strip()


def lire(url: str) -> dict:
    if not re.match(r"^https://([a-z]{2,3}\.)?linkedin\.com/in/[^/?#]+/?$", url.split("?")[0]):
        return {"statut": "introuvable", "message": "Adresse de profil LinkedIn invalide (attendu : https://www.linkedin.com/in/...)"}
    req = urllib.request.Request(url, headers={"User-Agent": AGENT, "Accept-Language": "fr-FR,fr;q=0.9"})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            if "/in/" not in r.geturl():
                return {"statut": "non_public", "message": "Profil non visible sans compte"}
            html = r.read().decode("utf-8", "ignore")
    except Exception as ex:
        code = getattr(ex, "code", None)
        return {"statut": "introuvable" if code == 404 else "indisponible", "message": f"LinkedIn n'a pas répondu ({code or type(ex).__name__})"}
    graphe = []
    for m in re.finditer(r'<script type="application/ld\+json">(.*?)</script>', html, re.S):
        try:
            j = json.loads(m.group(1))
        except json.JSONDecodeError:
            continue
        graphe += j.get("@graph", [j])
    personne = next((x for x in graphe if x.get("@type") == "Person"), None)
    if not personne:
        return {"statut": "non_public", "message": "Profil sans informations publiques"}
    titres = [t for t in (personne.get("jobTitle") or []) if t and "*" not in t] if isinstance(personne.get("jobTitle"), list) else [personne.get("jobTitle")]
    pubs = []
    for x in graphe:
        if x.get("@type") in ("DiscussionForumPosting", "SocialMediaPosting", "Article"):
            pubs.append({"type": "article" if x.get("@type") == "Article" else "publication",
                         "date": str(x.get("datePublished") or "")[:10] or None,
                         "texte": nettoyer(x.get("text") or x.get("articleBody") or x.get("headline"))[:900],
                         "url": x.get("url") or x.get("mainEntityOfPage")})
    pubs.sort(key=lambda p: p["date"] or "", reverse=True)
    return {"statut": "ok", "url": url, "nom": personne.get("name"), "titres": [t for t in titres if t],
            "infos": nettoyer(personne.get("description"))[:1500], "publications": pubs[:15]}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--url", required=True)
    ap.add_argument("--base", required=True)
    a = ap.parse_args()
    d = lire(a.url.strip())
    BRIEFS.mkdir(parents=True, exist_ok=True)
    (BRIEFS / f"{a.base}_profil_linkedin.json").write_text(json.dumps(d, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({**d, "fichier": f"sorties/briefs/{a.base}_profil_linkedin.json"}, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
