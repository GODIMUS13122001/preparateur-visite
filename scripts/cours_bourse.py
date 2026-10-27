"""Cours de bourse d'une société cotée, via Yahoo Finance (yfinance).

Usage : python scripts/cours_bourse.py --ticker BON.PA [--base R001_bonduelle]
Avec --base : écrit aussi sorties/briefs/<base>_bourse.json (une seule commande, sans redirection).
Sortie JSON : dernier cours, variations 1 mois / 3 mois / 12 mois, plus haut et plus bas 52 semaines.
Ticker vide (société non cotée) ou réseau bloqué : statut explicite, le skill passe alors par la recherche web.
"""
import argparse
import json
import sys
from datetime import timedelta


def variation(serie, jours):
    fin = serie.index[-1]
    passe = serie[serie.index <= fin - timedelta(days=jours)]
    if passe.empty:
        return None
    return round((serie.iloc[-1] / passe.iloc[-1] - 1) * 100, 1)


def cours(ticker: str) -> dict:
    if not ticker or not ticker.strip():
        return {"statut": "non_cotee", "message": "Pas de code bourse : société non cotée, utiliser la recherche web."}
    try:
        import yfinance as yf
        hist = yf.Ticker(ticker).history(period="13mo", auto_adjust=False)
    except Exception as e:  # réseau bloqué, API indisponible
        return {"statut": "indisponible", "ticker": ticker, "message": f"Cours indisponible ({type(e).__name__}) : utiliser la recherche web."}
    if hist is None or hist.empty:
        return {"statut": "indisponible", "ticker": ticker, "message": "Aucune donnée renvoyée par Yahoo Finance : utiliser la recherche web."}
    close = hist["Close"].dropna()
    an = close[close.index > close.index[-1] - timedelta(days=365)]
    return {
        "statut": "ok", "ticker": ticker, "source": "Yahoo Finance",
        "date_cours": close.index[-1].date().isoformat(),
        "devise": "EUR" if ticker.endswith(".PA") else None,
        "dernier_cours": round(float(close.iloc[-1]), 2),
        "variation_1_mois_pct": variation(close, 30),
        "variation_3_mois_pct": variation(close, 91),
        "variation_12_mois_pct": variation(close, 365),
        "plus_haut_52_semaines": round(float(hist["High"][an.index].max()), 2),
        "plus_bas_52_semaines": round(float(hist["Low"][an.index].min()), 2),
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ticker", default="")
    ap.add_argument("--base", help="ex. R001_bonduelle : écrit sorties/briefs/<base>_bourse.json")
    args = ap.parse_args()
    texte = json.dumps(cours(args.ticker), ensure_ascii=False, indent=2)
    if args.base:
        from pathlib import Path
        import os
        briefs = Path(os.environ.get("PREPARATEUR_ESPACE") or Path(__file__).resolve().parent.parent) / "sorties" / "briefs"
        briefs.mkdir(parents=True, exist_ok=True)
        (briefs / f"{args.base}_bourse.json").write_text(texte, encoding="utf-8")
    print(texte)


if __name__ == "__main__":
    sys.exit(main())
