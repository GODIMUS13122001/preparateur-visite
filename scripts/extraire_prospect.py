"""Rassemble tout ce que le CRM de prospection sait d'un rendez-vous avec un prospect.

Usage : .venv/bin/python scripts/extraire_prospect.py --rdv RP003
Sortie : sorties/dossiers/<RDV>_<prospect>_dossier.json et .md

Le dossier contient le prospect, ses interlocuteurs, l'étape du sales funnel, les 13 critères de
qualification (et ceux à viser pendant ce rendez-vous), l'historique, les comptes rendus précédents,
et deux créneaux libres pour proposer le rendez-vous suivant.
"""
from __future__ import annotations

import argparse
import json
from datetime import date, datetime, time, timedelta

from crm_lib import RACINE, en_date
from crm_prospection import CRITERES_PREMIER_RDV, CRMProspection

DOSSIERS = RACINE / "sorties" / "dossiers"
JOURS = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"]


def fmt(v):
    if isinstance(v, datetime):
        return v.date().isoformat()
    if isinstance(v, (date, time)):
        return v.isoformat()[:10] if isinstance(v, date) else v.strftime("%H:%M")
    return v


def occupes(crm: CRMProspection, uid: str) -> set[date]:
    """Jours déjà pris par un rendez-vous, dans le CRM de prospection et dans le CRM clients."""
    jours = {en_date(r["Date"]) for r in crm.lignes("Rendez-vous") if r.get("ID commercial") == uid}
    try:
        from crm_lib import CRM
        clients = CRM()
        jours |= {en_date(r["Date"]) for r in clients.lignes("Rendez-vous") if r.get("ID commercial") == uid}
    except Exception:
        pass
    return {j for j in jours if j}


def references(secteur: str | None, sous_secteur: str | None) -> list[dict]:
    """Clients du CRM clients dans le même secteur : des preuves possibles, à confirmer avant de les citer."""
    try:
        from crm_lib import CRM
        clients = CRM()
    except Exception:
        return []
    mots = {m for m in (sous_secteur or "").lower().replace(",", " ").replace(":", " ").split() if len(m) > 4}
    res = []
    for eid, e in clients.entreprises.items():
        if e.get("Secteur d'activité") != secteur or e.get("Statut du compte") in ("À risque",):
            continue
        proche = any(m[:6] in (e.get("Sous-secteur") or "").lower() for m in mots)
        res.append({"client": e["Nom de l'entreprise"], "sous_secteur": e.get("Sous-secteur"), "client_depuis": fmt(e.get("Client depuis")),
                    "proche": proche, "_ca": clients.ca_12_mois(eid)})
    res.sort(key=lambda x: (not x["proche"], -x["_ca"]))
    for x in res:
        x.pop("_ca")
    return res[:3]


def creneaux(apres: date, pris: set[date]) -> list[dict]:
    """Deux créneaux la semaine suivante : un mardi matin et un jeudi après-midi, décalés s'ils sont déjà pris."""
    lundi = apres + timedelta(days=7 - apres.weekday())
    res = []
    for jour_semaine, h in ((1, time(10, 0)), (3, time(15, 0))):
        j = lundi + timedelta(days=jour_semaine)
        while j in pris or j.weekday() >= 5:
            j += timedelta(days=1)
        res.append({"date": j.isoformat(), "heure": h.strftime("%H:%M"),
                    "libelle": f"{JOURS[j.weekday()]} {j.day:02d}/{j.month:02d} à {h.hour}h{h.minute or ''}".replace("h0", "h")})
    return res


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--rdv", required=True)
    rid = ap.parse_args().rdv.upper()
    crm = CRMProspection()
    if rid not in crm.rdv:
        raise SystemExit(json.dumps({"statut": "introuvable", "message": f"Rendez-vous {rid} absent du CRM de prospection"}, ensure_ascii=False))
    r = crm.rdv[rid]
    pid = r["ID prospect"]
    p = crm.prospects[pid]
    base = crm.base(rid)
    av = crm.avancement(pid)
    premier = "1er" in (r.get("Rang du rendez-vous") or "1er")
    a_viser = [c for c in av["criteres"] if c["statut"] not in ("Obtenu", "Sans objet")
               and (not premier or (c["n"] or 99) <= CRITERES_PREMIER_RDV + 2)]
    d_rdv = en_date(r["Date"])

    dossier = {
        "meta": {"source": crm.chemin.name, "type": "prospect", "date_reference": crm.date_ref.isoformat(),
                 "genere_le": datetime.now().isoformat(timespec="seconds"),
                 "regle": "Prospect : aucun historique de vente. Interlocuteurs, notes et rendez-vous sont des données du CRM de prospection."},
        "rendez_vous": {"id": rid, "date": fmt(r["Date"]), "heure_debut": fmt(r.get("Heure de début")), "heure_fin": fmt(r.get("Heure de fin")),
                        "type": r.get("Type de rendez-vous"), "lieu": r.get("Lieu"), "objet": r.get("Objet du rendez-vous"),
                        "rang": r.get("Rang du rendez-vous"), "statut": r.get("Statut"),
                        "interlocuteur": crm.nom_interlocuteur(r.get("ID interlocuteur")),
                        "commercial": crm.nom_commercial(r.get("ID commercial"))},
        "prospect": {k: fmt(v) for k, v in p.items()},
        "interlocuteur_rdv": {k: fmt(v) for k, v in crm.interlocuteurs.get(r.get("ID interlocuteur"), {}).items() if k not in ("E-mail", "Téléphone")},
        "interlocuteurs": [{k: fmt(v) for k, v in i.items() if k not in ("E-mail", "Téléphone")}
                           for i in crm.interlocuteurs.values() if i.get("ID prospect") == pid],
        "funnel": {"etape": av["etape"], "etapes": av["etapes"], "decouverte": av["decouverte"], "qualification": av["qualification"]},
        "criteres": av["criteres"],
        "criteres_a_viser": a_viser,
        "activites": sorted([{k: fmt(v) for k, v in a.items()} for a in crm.lignes("Activités") if a.get("ID prospect") == pid],
                            key=lambda a: a.get("Date") or "", reverse=True),
        "comptes_rendus_precedents": [{"date": fmt(x["Date"]), "rang": x.get("Rang du rendez-vous"), "texte": x.get("Compte rendu de visite")}
                                      for x in crm.lignes("Rendez-vous") if x.get("ID prospect") == pid and x.get("Compte rendu de visite")],
        "references_clients": references(p.get("Secteur d'activité"), p.get("Sous-secteur")),
        "creneaux_proposes": creneaux(d_rdv, occupes(crm, r.get("ID commercial"))) if d_rdv else [],
    }

    DOSSIERS.mkdir(parents=True, exist_ok=True)
    (DOSSIERS / f"{base}_dossier.json").write_text(json.dumps(dossier, ensure_ascii=False, indent=2), encoding="utf-8")
    nom = p["Nom de l'entreprise"]
    lignes = [f"# Dossier prospect - {nom} - {dossier['rendez_vous']['date']} {dossier['rendez_vous']['heure_debut']}",
              f"Étape : {av['etape']} · Rendez-vous : {r.get('Rang du rendez-vous')} · Critères du premier rendez-vous : "
              f"{av['decouverte']['obtenus']}/{av['decouverte']['total']}", "", "## Critères"]
    lignes += [f"- {c['n']}. {c['critere']} : {c['statut']}{' - ' + c['preuve'] if c['preuve'] else ''}" for c in av["criteres"]]
    lignes += ["", "## Notes du commercial", p.get("Notes du commercial") or "-"]
    (DOSSIERS / f"{base}_dossier.md").write_text("\n".join(lignes), encoding="utf-8")
    print(json.dumps({"statut": "ok", "rdv": rid, "prospect": nom, "base": base,
                      "json": f"sorties/dossiers/{base}_dossier.json", "md": f"sorties/dossiers/{base}_dossier.md"}, ensure_ascii=False))


if __name__ == "__main__":
    main()
