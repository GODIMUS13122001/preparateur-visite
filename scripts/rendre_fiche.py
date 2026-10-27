"""Transforme une fiche de visite en page HTML imprimable (charte de l'appli) et en audio.

Usage : python scripts/rendre_fiche.py --base R001_bonduelle [--voix "Thomas"] [--sans-audio]
Entrées : sorties/briefs/<base>_fiche.md et <base>_audio.txt
Sorties : sorties/briefs/<base>_fiche.html et <base>_audio.m4a

Audio : synthèse vocale macOS (`say`), en local et sans réseau. La meilleure voix française
installée est choisie automatiquement (Premium ou Enhanced si présente, sinon Thomas).
"""
from __future__ import annotations

import argparse
import html
import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path

import markdown

from crm_lib import RACINE

BRIEFS = RACINE / "sorties" / "briefs"

CSS = """
:root{--creme:#FAF9F6;--blanc:#FFFFFF;--encre:#120A29;--texte:#1d1830;--ardoise:#625C75;--nuage:#E8E4EE;
--accent:#5723F3;--accent-vif:#8257F5;--accent-voile:#F3EFFE;--accent-trait:#D8CCFB}
body.prospect{--accent:#C23A1E;--accent-vif:#D9482B;--accent-voile:#FDF0EB;--accent-trait:#F4C9BB}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--creme);color:var(--texte);font:400 16px/1.6 "Open Sans","Segoe UI",system-ui,Arial,sans-serif;
-webkit-print-color-adjust:exact;print-color-adjust:exact}
.bandeau{background:var(--accent);color:#fff;border-bottom:3px solid var(--accent-vif)}
.bandeau>div{max-width:820px;margin:0 auto;padding:10px 20px;display:flex;justify-content:space-between;align-items:center;gap:12px;
font-size:13px;letter-spacing:.08em;text-transform:uppercase;font-weight:600}
.bandeau .type{display:flex;align-items:center;gap:9px}
.bandeau .type::before{content:"";width:9px;height:9px;border-radius:50%;background:#fff;flex:none}
.bandeau .marque{font-weight:400;opacity:.92;letter-spacing:.06em;text-align:right}
.page{max-width:820px;margin:0 auto;padding:26px 20px 44px}
h1{font-weight:600;color:var(--encre);font-size:28px;line-height:1.2;letter-spacing:-.01em;margin:0 0 8px}
.infos{color:var(--ardoise);margin:0 0 22px;padding-bottom:18px;border-bottom:1px solid var(--nuage);font-size:15.5px;line-height:1.55}
h2{display:flex;align-items:center;gap:10px;font-weight:600;color:var(--encre);font-size:18px;line-height:1.3;margin:34px 0 12px}
h2 .num{flex:none;display:inline-flex;align-items:center;justify-content:center;min-width:28px;height:28px;border-radius:50%;
background:var(--accent);color:#fff;font-size:14px;font-weight:600}
ul{margin:0;padding-left:20px}li{margin:7px 0;padding-left:2px}li::marker{color:var(--accent)}
strong{font-weight:600;color:var(--encre)}
p{margin:10px 0}
h2:first-of-type+ul{background:var(--accent-voile);border:1px solid var(--accent-trait);border-left:4px solid var(--accent);
border-radius:10px;padding:14px 16px 14px 34px}
.avant{background:#fff;border:1px solid var(--accent-trait);border-left:4px solid var(--accent);border-radius:10px;
padding:14px 16px;margin:0 0 6px;box-shadow:0 1px 2px rgba(18,10,41,.05)}
.avant-titre{font-size:13px;font-weight:600;letter-spacing:.07em;text-transform:uppercase;color:var(--accent);margin-bottom:4px}
.avant ul{padding-left:18px}.avant li{margin:5px 0}
blockquote{margin:0 0 6px;background:#fff;border:1px solid var(--accent-trait);border-left:4px solid var(--accent);border-radius:10px;padding:4px 16px}
.dire{color:var(--accent);font-weight:400;background:linear-gradient(transparent 62%,var(--accent-voile) 62%);
-webkit-box-decoration-break:clone;box-decoration-break:clone;padding:0 1px}
.src{display:inline-block;font-size:12px;line-height:1.35;font-weight:600;border-radius:999px;padding:1px 9px;margin:0 2px 0 4px;
vertical-align:1px;letter-spacing:.01em}
.src.crm{background:var(--encre);color:#fff}
.src.web{background:var(--accent);color:#fff}
.src.bourse{background:var(--accent-voile);color:var(--encre);box-shadow:inset 0 0 0 1px var(--accent-trait)}
.src.linkedin{background:#0A66C2;color:#fff}
hr{border:0;border-top:1px solid var(--nuage);margin:34px 0 14px}
hr~p{font-size:14px;color:var(--ardoise);line-height:1.55;margin:8px 0}
hr~p strong{color:var(--encre)}
em{font-style:normal;color:var(--ardoise);font-size:13.5px;line-height:1.5;word-break:break-word}
a{color:var(--accent);word-break:break-all}
.legende{font-size:13px;color:var(--ardoise);margin-top:26px}

h2.coup{font-size:19px}
.coup+ul{list-style:none;padding:16px 18px;background:var(--accent-voile);border:1px solid var(--accent-trait);border-left:4px solid var(--accent);border-radius:12px}
.coup+ul li{margin:0;padding:10px 0;border-top:1px solid var(--accent-trait)}
.coup+ul li:first-child{border-top:0;padding-top:0}.coup+ul li:last-child{padding-bottom:0}
.coup+ul li>strong:first-child{display:block;font-size:12.5px;letter-spacing:.07em;text-transform:uppercase;color:var(--accent);margin-bottom:2px}
.pastille{display:inline-block;width:12px;height:12px;border-radius:50%;margin-right:5px;vertical-align:-1px;box-shadow:0 0 0 2px #fff,0 0 0 3px var(--nuage)}
.pastille.rouge{background:#D92D20}.pastille.jaune{background:#F2B600}.pastille.vert{background:#2E9E5B}.pastille.bleu{background:#2563EB}
.rub h2+p{font-weight:600;color:var(--encre);margin:0 0 12px}
.rub ol{margin:0 0 14px;padding-left:0;list-style:none;counter-reset:q}
.rub ol>li{counter-increment:q;position:relative;margin:0 0 10px;padding:10px 12px 10px 44px;background:#fff;border:1px solid var(--nuage);border-radius:10px}
.rub ol>li::before{content:counter(q);position:absolute;left:12px;top:10px;width:22px;height:22px;border-radius:50%;background:var(--accent-voile);
color:var(--accent);font-weight:600;font-size:13px;display:flex;align-items:center;justify-content:center}
.rub ul>li{margin:10px 0}
.rub{margin-top:8px}
details.loin{margin-top:36px;border-top:1px solid var(--nuage);padding-top:8px}
details.loin>summary{cursor:pointer;list-style:none;display:flex;align-items:center;gap:10px;min-height:44px;font-weight:600;font-size:17px;color:var(--encre)}
details.loin>summary::-webkit-details-marker{display:none}
details.loin>summary::before{content:"+";flex:none;width:28px;height:28px;border-radius:50%;border:2px solid var(--accent);color:var(--accent);
display:inline-flex;align-items:center;justify-content:center;font-size:18px;line-height:1}
details.loin[open]>summary::before{content:"\2212"}
details.loin>summary:focus-visible{outline:2px solid var(--accent);outline-offset:3px}
@media (max-width:480px){.page{padding:20px 16px 36px}h1{font-size:24px}.bandeau>div{padding:9px 16px;font-size:12px}
.bandeau .marque{display:none}h2{font-size:17px;margin-top:30px}
h2:first-of-type+ul{padding:12px 14px 12px 30px}}
@media print{body{background:#fff;font-size:9.5px;line-height:1.32}.bandeau>div{max-width:none;padding:5px 0;font-size:9px}
.page{max-width:none;padding:10px 0 0}h1{font-size:18px;margin-bottom:3px}.infos{font-size:10px;margin-bottom:8px;padding-bottom:7px}
h2{font-size:11px;margin:8px 0 3px;gap:7px;break-after:avoid}h2 .num{min-width:18px;height:18px;font-size:10px}
li{margin:1px 0}p{margin:3px 0}.src{font-size:8px;padding:0 6px}
h2:first-of-type+ul,.avant{padding-top:6px;padding-bottom:6px;box-shadow:none}.avant-titre{font-size:8.5px}
hr{margin:12px 0 6px}hr~p,em{font-size:8.5px}.legende{font-size:8.5px;margin-top:8px}
@page{size:A4;margin:9mm}h2.coup{font-size:12px}details.loin>summary::before{display:none}details.loin{margin-top:8px;padding-top:2px}details.loin>summary{font-size:11px;min-height:0}.rub ol>li{padding:5px 8px 5px 32px;margin:0 0 4px}.rub ol>li::before{left:7px;top:5px;width:17px;height:17px;font-size:9px}.coup+ul{padding:8px 10px}.coup+ul li{padding:4px 0}.coup+ul strong{font-size:8.5px}a{color:var(--texte);word-break:break-all}li,.avant{break-inside:avoid}}
"""

ORIGINE = re.compile(r"\((CRM|Web|Bourse|LinkedIn)([^()]*)\)")
GUILLEMETS = re.compile(r"«[^»<>]*»")
ENTETE = re.compile(r"<h2>\s*(\d+)\.\s*(.*?)</h2>", re.S)
RANG = {"premier": "premier", "1er": "premier", "1re": "premier", "première": "premier",
        "deuxième": "deuxième", "second": "deuxième", "seconde": "deuxième", "2e": "deuxième", "2ème": "deuxième"}


def badges(html_txt: str) -> str:
    def rempl(m):
        kind, detail = m.group(1), m.group(2).strip(" ,")
        titre = f' title="{html.escape(detail, quote=True)}"' if detail else ""
        montre = f" · {html.escape(detail)}" if detail and kind in ("Web", "LinkedIn") else ""
        return f'<span class="src {kind.lower()}"{titre}>{kind}{montre}</span>'
    return ORIGINE.sub(rempl, html_txt)


def phrases_a_dire(html_txt: str) -> str:
    """Met en valeur les phrases entre « » (hors balises)."""
    morceaux = re.split(r"(<[^>]+>)", html_txt)
    return "".join(m if m.startswith("<") else GUILLEMETS.sub(lambda g: f'<span class="dire">{g.group(0)}</span>', m)
                   for m in morceaux)


def bloc_a_preparer(corps: str) -> str:
    """Le blockquote « À préparer avant le rendez-vous » devient un encadré à puces."""
    def rempl(m):
        t = re.match(r"\s*<strong>(.*?)</strong>\s*(.*)", m.group(1), re.S)
        if not t:
            return m.group(0)
        titre, reste = t.group(1).strip(" :"), t.group(2)
        items = [i.strip() for i in reste.split(" · ") if i.strip()]
        if len(items) < 2:
            return f'<div class="avant"><div class="avant-titre">{titre}</div><p>{reste}</p></div>'
        lis = "".join(f"<li>{i}</li>" for i in items)
        return f'<div class="avant"><div class="avant-titre">{titre}</div><ul>{lis}</ul></div>'
    return re.sub(r"<blockquote>\s*<p>(.*?)</p>\s*</blockquote>", rempl, corps, count=1, flags=re.S)


COULEURS = re.compile(r"plutôt\s+(rouge|jaune|vert|bleu)\b", re.I)


def nouveau_format(corps: str) -> str:
    """Fiche prospect au format « lisible en 30 secondes » : carte « En un coup d'œil », rubriques aérées, détail replié."""
    if not re.search(r"<h2>\s*En un coup d.œil\s*</h2>", corps, re.I):
        return corps
    corps = re.sub(r"<h2>\s*(En un coup d.œil)\s*</h2>", r'<h2 class="coup">\1</h2>', corps, count=1, flags=re.I)
    corps = COULEURS.sub(lambda m: f'plutôt <span class="pastille {m.group(1).lower()}" role="img" aria-label="{m.group(1).lower()}"></span>{m.group(1).lower()}', corps, count=1)
    corps = re.sub(r"\s+(<strong>[BC]\.</strong>)", r"<br>\1", corps)
    m = re.search(r"<h2>\s*Pour aller plus loin\s*</h2>", corps, re.I)
    if m:
        corps = (corps[:m.start()] + '<details class="loin"><summary>Pour aller plus loin</summary>' + corps[m.end():] + "</details>")
    return corps


JS_IMPRESSION = '''<script>(function(){var d=document.querySelectorAll("details.loin"),o=[];function a(){o=[];d.forEach(function(e){o.push(e.open);e.open=true})}function b(){d.forEach(function(e,i){e.open=o[i]})}window.addEventListener("beforeprint",a);window.addEventListener("afterprint",b)})()</script>'''


def type_fiche(base: str, titre: str) -> tuple[str, str]:
    """Renvoie (classe CSS, libellé du bandeau)."""
    if re.match(r"RP\d", base or ""):
        t = titre.lower()
        rang = next((v for k, v in RANG.items() if re.search(rf"(?<!\w){re.escape(k)}(?!\w)", t) and "rendez" in t), None)
        return "prospect", f"Prospect · {rang} rendez-vous" if rang else "Prospect"
    return "client", "Client qualifié"


def liens_courts(html_txt: str) -> str:
    """Adresses web brutes (souvent dans « Sources web ») remplacées par un lien court au nom du site."""
    def rempl(m):
        url = m.group(0).rstrip(".,;)")
        reste = m.group(0)[len(url):]
        site = re.sub(r"^https?://(www\.|fr\.)?", "", url).split("/")[0]
        return f'<a href="{html.escape(url)}" target="_blank" rel="noreferrer">{html.escape(site)}</a>{reste}'
    # seulement dans le texte, jamais dans un attribut déjà présent (href="...")
    return re.sub(r'(?<![="\'>])https?://[^\s<"]+', rempl, html_txt)


def page_html(md_txt: str, titre: str, base: str = "") -> str:
    classe, libelle = type_fiche(base, titre)
    md_txt = re.sub(r"(?m)^([^\s\-*>#|\d].*|\*\*.*)\n(?=(?:- |\d+\. ))", r"\1\n\n", md_txt)  # liste collée à un paragraphe
    corps = markdown.markdown(md_txt, extensions=["extra", "sane_lists"])
    corps = bloc_a_preparer(corps)
    corps = nouveau_format(corps)
    corps = ENTETE.sub(lambda m: f'<h2><span class="num">{m.group(1)}</span><span>{m.group(2)}</span></h2>', corps)
    corps = re.sub(r"(</h1>\s*)<p>", r'\1<p class="infos">', corps, count=1)
    corps = liens_courts(corps)
    corps = badges(corps)
    corps = phrases_a_dire(corps)
    rub = " rub" if 'class="coup"' in corps else ""
    return f"""<!doctype html><html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{html.escape(titre)}</title>
<link href="https://fonts.googleapis.com/css2?family=Open+Sans:wght@300;400;600&display=swap" rel="stylesheet">
<style>{CSS}</style></head><body class="{classe}">
<div class="bandeau"><div><span class="type">{html.escape(libelle)}</span><span class="marque">Préparateur de visite · Fiche de visite</span></div></div>
<div class="page{rub}">
{corps}
<p class="legende">Origine de chaque information : <span class="src crm">CRM</span> fichier client ·
<span class="src bourse">Bourse</span> Yahoo Finance · <span class="src web">Web</span> presse et sites publics, datés ·
<span class="src linkedin">LinkedIn</span> publications publiques.</p>
</div>{JS_IMPRESSION}</body></html>"""


def meilleure_voix() -> str:
    try:
        liste = subprocess.run(["say", "-v", "?"], capture_output=True, text=True, check=True).stdout
    except Exception:
        return "Thomas"
    fr = [l.split("  ")[0].strip() for l in liste.splitlines() if "fr_FR" in l]
    for marque in ("Premium", "Enhanced", "Amélioré", "améliorée"):
        for v in fr:
            if marque in v:
                return v
    return "Thomas" if "Thomas" in fr else (fr[0] if fr else "Thomas")


def audio(texte: str, sortie: Path, voix: str) -> None:
    with tempfile.TemporaryDirectory() as tmp:
        aiff = Path(tmp) / "fiche.aiff"
        src = Path(tmp) / "fiche.txt"
        src.write_text(texte, encoding="utf-8")
        subprocess.run(["say", "-v", voix, "-r", "180", "-f", str(src), "-o", str(aiff)], check=True)
        # Pas de débit forcé : 96 kbps est refusé par afconvert sur l'AIFF mono 22 kHz produit par `say`.
        subprocess.run(["afconvert", "-f", "m4af", "-d", "aac", str(aiff), str(sortie)], check=True)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--base", required=True, help="ex. R001_bonduelle")
    ap.add_argument("--voix")
    ap.add_argument("--sans-audio", action="store_true")
    args = ap.parse_args()
    md_path = BRIEFS / f"{args.base}_fiche.md"
    if not md_path.exists():
        raise SystemExit(f"Fiche introuvable : {md_path}")
    md_txt = md_path.read_text(encoding="utf-8")
    titre = md_txt.splitlines()[0].lstrip("# ").strip() if md_txt else args.base
    html_path = BRIEFS / f"{args.base}_fiche.html"
    html_path.write_text(page_html(md_txt, titre, args.base), encoding="utf-8")
    res = {"statut": "ok", "html": str(html_path.relative_to(RACINE))}

    txt_path = BRIEFS / f"{args.base}_audio.txt"
    if not args.sans_audio:
        if txt_path.exists():
            voix = args.voix or meilleure_voix()
            m4a = BRIEFS / f"{args.base}_audio.m4a"
            audio(txt_path.read_text(encoding="utf-8"), m4a, voix)
            mots = len(txt_path.read_text(encoding="utf-8").split())
            res.update({"audio": str(m4a.relative_to(RACINE)), "voix": voix, "mots": mots})
        else:
            res["audio"] = None
            res["message"] = f"Texte audio absent : {txt_path.name}"
    print(json.dumps(res, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    sys.exit(main())
