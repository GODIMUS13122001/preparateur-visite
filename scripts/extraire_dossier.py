"""Extrait le dossier complet d'un rendez-vous depuis le CRM Excel.

Usage :
  python scripts/extraire_dossier.py --rdv R001
  python scripts/extraire_dossier.py --entreprise "Bonduelle"   (prochain rendez-vous du compte)
Sortie : sorties/dossiers/<RDV>_<entreprise>_dossier.json et .md
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import date, datetime, time, timedelta

from crm_lib import CRM, RACINE, en_date, moins_mois, slug

SORTIE = RACINE / "sorties" / "dossiers"


def fmt(v):
    """Valeurs Excel -> JSON lisible (dates ISO, heures HH:MM)."""
    if isinstance(v, datetime):
        return v.date().isoformat() if v.time() == time(0) else v.isoformat(timespec="minutes")
    if isinstance(v, date):
        return v.isoformat()
    if isinstance(v, time):
        return v.strftime("%H:%M")
    return v


def propre(d: dict) -> dict:
    return {k: fmt(v) for k, v in d.items()}


def construire_dossier(crm: CRM, rid: str) -> dict:
    r = crm.rdv.get(rid)
    if not r:
        raise SystemExit(f"Rendez-vous {rid} introuvable dans l'onglet Rendez-vous")
    eid, ref = r["ID entreprise"], crm.date_ref
    e = crm.entreprises[eid]
    ind = crm.indicateurs_entreprise(eid)
    manquants = []

    # Rendez-vous
    t_liee = crm.transactions.get(r.get("ID transaction associée"))
    rendez_vous = {
        "id": rid, "date": fmt(r["Date"]), "heure_debut": fmt(r.get("Heure de début")),
        "heure_fin": fmt(r.get("Heure de fin")), "type": r.get("Type de rendez-vous"),
        "lieu": r.get("Lieu"), "objet": r.get("Objet du rendez-vous"), "statut": r.get("Statut"),
        "contact": {"id": r.get("ID contact"), "nom": crm.nom_contact(r.get("ID contact")),
                    "poste": (crm.contacts.get(r.get("ID contact")) or {}).get("Intitulé du poste")},
        "commercial": {"id": r.get("ID commercial"), "nom": crm.nom_commercial(r.get("ID commercial"))},
        "transaction_liee": {"id": r.get("ID transaction associée"),
                             "nom": t_liee.get("Nom de la transaction") if t_liee else None},
        "brief_prepare": r.get("Brief préparé"),
    }

    # Entreprise
    entreprise = {
        "id": eid, "nom": e["Nom de l'entreprise"], "site_web": e.get("Site web"),
        "description": e.get("Description de l'activité"), "secteur": e.get("Secteur d'activité"),
        "sous_secteur": e.get("Sous-secteur"), "segment": e.get("Segment"),
        "effectif": e.get("Tranche d'effectif"), "ca_annuel_tranche": e.get("Chiffre d'affaires annuel (tranche)"),
        "adresse": f"{e.get('Adresse')}, {e.get('Code postal')} {e.get('Ville')}", "region": e.get("Région"),
        "groupe": e.get("Groupe / société mère"), "cotee": e.get("Cotée en bourse"),
        "code_bourse": e.get("Code bourse (Yahoo Finance)"), "proprietaire": crm.nom_commercial(e.get("ID propriétaire")),
        "phase_cycle_vie": e.get("Phase du cycle de vie"), "statut_compte": e.get("Statut du compte"),
        "client_depuis": fmt(e.get("Client depuis")), "potentiel_annuel": e.get("Potentiel annuel estimé (€)"),
        "ca_12_mois": ind["ca_12_mois"], "ca_12_mois_precedents": crm.ca_12_mois(eid, decalage_jours=365),
        "concurrent_principal": e.get("Concurrent principal"), "conditions_paiement": e.get("Conditions de paiement"),
        "contexte": e.get("Contexte client"), "enjeux": e.get("Enjeux et projets en cours"),
        "transactions_ouvertes": ind["transactions_ouvertes"], "pipeline_ouvert": ind["pipeline_ouvert"],
        "tickets_ouverts": ind["tickets_ouverts"], "date_derniere_activite": fmt(ind["date_derniere_activite"]),
    }
    if entreprise["potentiel_annuel"]:
        entreprise["taux_couverture_potentiel"] = round(entreprise["ca_12_mois"] / entreprise["potentiel_annuel"], 3)

    # Contacts du compte
    contacts = []
    for c in crm.lignes("Contacts"):
        if c.get("ID entreprise") != eid:
            continue
        contacts.append({
            "id": c["ID contact"], "nom": f"{c.get('Civilité')} {c['Prénom']} {c['Nom']}",
            "poste": c.get("Intitulé du poste"), "service": c.get("Service"),
            "niveau_decision": c.get("Niveau de décision"), "contact_cle": c.get("Contact clé"),
            "canal_prefere": c.get("Canal préféré"), "notes": c.get("Notes"),
            "date_dernier_echange": fmt(crm.derniere_activite(cid=c["ID contact"])),
            "interactions_12_mois": crm.interactions_12_mois(c["ID contact"]),
            "interlocuteur_du_rdv": c["ID contact"] == r.get("ID contact"),
        })

    # Activités : les 10 dernières, et le dernier compte rendu de visite en entier
    acts = sorted([a for a in crm.lignes("Activités") if a.get("ID entreprise") == eid
                   and en_date(a["Date"]) and en_date(a["Date"]) <= ref],
                  key=lambda a: (en_date(a["Date"]), a["ID activité"]), reverse=True)
    activites = [{
        "id": a["ID activité"], "date": fmt(a["Date"]), "type": a.get("Type d'activité"),
        "contact": crm.nom_contact(a.get("ID contact")), "objet": a.get("Objet"),
        "contenu": a.get("Compte rendu / contenu"), "resultat": a.get("Résultat"),
        "transaction": a.get("ID transaction associée"), "prochaine_action": a.get("Prochaine action"),
        "echeance": fmt(a.get("Échéance prochaine action")),
    } for a in acts[:10]]
    visites = [a for a in acts if a.get("Type d'activité") == "Visite terrain"]
    dernier_cr = None
    if visites:
        v = visites[0]
        dernier_cr = {"id": v["ID activité"], "date": fmt(v["Date"]), "contact": crm.nom_contact(v.get("ID contact")),
                      "objet": v.get("Objet"), "texte_integral": v.get("Compte rendu / contenu"),
                      "autres_participants": v.get("Autres participants client")}
    else:
        manquants.append("Aucun compte rendu de visite terrain antérieur dans l'onglet Activités")

    # Transactions : ouvertes + gagnées ou perdues dans les 12 derniers mois
    transactions = []
    for t in crm.lignes("Transactions"):
        if t.get("ID entreprise") != eid:
            continue
        info = crm.phase_info(t)
        cloture = en_date(t.get("Date de clôture effective"))
        recente = cloture and ref - timedelta(days=365) < cloture <= ref
        if info["statut"] == "Ouverte" or (info["statut"] in ("Gagnée", "Perdue") and recente):
            montant = t.get("Montant (€)")
            transactions.append({
                "id": t["ID transaction"], "nom": t.get("Nom de la transaction"), "phase": t.get("Phase de la transaction"),
                "statut": info["statut"], "probabilite": info["probabilite"], "montant": montant,
                "montant_pondere": round(montant * info["probabilite"], 2) if montant is not None and info["probabilite"] is not None else None,
                "type": t.get("Type de transaction"), "produit": crm.nom_produit(t.get("ID produit principal")),
                "contact_principal": crm.nom_contact(t.get("ID contact principal")),
                "date_creation": fmt(t.get("Date de création")), "cloture_prevue": fmt(t.get("Date de clôture prévue")),
                "cloture_effective": fmt(t.get("Date de clôture effective")), "prochaine_etape": t.get("Prochaine étape"),
                "concurrent": t.get("Concurrent en lice"), "motif_perte": t.get("Motif de perte"),
                "liee_au_rdv": t["ID transaction"] == r.get("ID transaction associée"),
            })

    # Tickets : ouverts + créés dans les 6 derniers mois
    six_mois = moins_mois(ref, 6)
    tickets = []
    for k in crm.lignes("Tickets"):
        if k.get("ID entreprise") != eid:
            continue
        creation = en_date(k.get("Date de création"))
        ouvert = k.get("Statut") != "Fermé"
        if ouvert or (creation and six_mois < creation <= ref):
            cloture = en_date(k.get("Date de clôture"))
            tickets.append({
                "id": k["ID ticket"], "objet": k.get("Objet"), "categorie": k.get("Catégorie"), "priorite": k.get("Priorité"),
                "statut": k.get("Statut"), "ouvert": ouvert, "date_creation": fmt(creation), "date_cloture": fmt(cloture),
                "delai_resolution_jours": (cloture - creation).days if cloture and creation else None,
                "description": k.get("Description"), "contact": crm.nom_contact(k.get("ID contact")),
                "responsable": k.get("Responsable du ticket"),
            })

    # Commandes des 12 derniers mois
    debut = ref - timedelta(days=365)
    cmds = sorted([c for c in crm.lignes("Commandes") if c.get("ID entreprise") == eid
                   and en_date(c.get("Date de commande")) and debut < en_date(c["Date de commande"]) <= ref],
                  key=lambda c: en_date(c["Date de commande"]), reverse=True)
    commandes = [{
        "id": c["ID commande"], "date": fmt(c["Date de commande"]), "produit": crm.nom_produit(c.get("ID produit")),
        "quantite": c.get("Quantité"), "remise": c.get("Remise"), "montant_ht": crm.montant_commande(c),
        "livraison_prevue": fmt(c.get("Date de livraison prévue")), "livraison_effective": fmt(c.get("Date de livraison effective")),
        "retard_jours": crm.retard_commande(c), "statut": c.get("Statut"),
    } for c in cmds]
    retards = [c for c in commandes if (c["retard_jours"] or 0) > 0]
    par_produit = {}
    for c in commandes:
        par_produit[c["produit"]] = round(par_produit.get(c["produit"], 0) + (c["montant_ht"] or 0), 2)
    synthese_commandes = {
        "nombre": len(commandes), "ca_12_mois": entreprise["ca_12_mois"],
        "ca_par_produit": dict(sorted(par_produit.items(), key=lambda x: -x[1])),
        "livrees_avec_date": sum(1 for c in commandes if c["retard_jours"] is not None),
        "en_retard": len(retards), "retard_max_jours": max((c["retard_jours"] for c in retards), default=0),
        "retard_moyen_jours_sur_retards": round(sum(c["retard_jours"] for c in retards) / len(retards), 1) if retards else 0,
        "non_livrees": [c["id"] for c in commandes if not c["livraison_effective"]],
    }

    # Prochains rendez-vous du compte
    prochains = sorted([x for x in crm.lignes("Rendez-vous") if x.get("ID entreprise") == eid
                        and en_date(x["Date"]) and en_date(x["Date"]) >= ref],
                       key=lambda x: (en_date(x["Date"]), str(x.get("Heure de début"))))
    prochains_rdv = [{"id": x["ID rendez-vous"], "date": fmt(x["Date"]), "heure": fmt(x.get("Heure de début")),
                      "type": x.get("Type de rendez-vous"), "objet": x.get("Objet du rendez-vous"),
                      "contact": crm.nom_contact(x.get("ID contact")), "statut": x.get("Statut"),
                      "est_ce_rdv": x["ID rendez-vous"] == rid} for x in prochains]

    for champ, lib in [("contexte", "Contexte client"), ("enjeux", "Enjeux et projets en cours"),
                       ("concurrent_principal", "Concurrent principal"), ("potentiel_annuel", "Potentiel annuel estimé")]:
        if not entreprise.get(champ):
            manquants.append(f"Entreprises : « {lib} » non renseigné")
    if not t_liee:
        manquants.append("Aucune transaction associée au rendez-vous")

    return {
        "meta": {"source": crm.chemin.name, "date_reference": ref.isoformat(),
                 "genere_le": datetime.now().isoformat(timespec="seconds"),
                 "regle": "Indicateurs recalculés à partir des colonnes de saisie (aucune valeur de formule lue)"},
        "rendez_vous": rendez_vous, "entreprise": entreprise, "contacts": contacts,
        "activites_recentes": activites, "dernier_compte_rendu_visite": dernier_cr,
        "transactions": transactions, "tickets": tickets,
        "commandes": {"synthese": synthese_commandes, "detail": commandes},
        "prochains_rendez_vous": prochains_rdv, "donnees_manquantes": manquants,
    }


def euros(v):
    return "n.d." if v is None else f"{v:,.0f} €".replace(",", " ")


def en_markdown(d: dict) -> str:
    r, e, sc = d["rendez_vous"], d["entreprise"], d["commandes"]["synthese"]
    L = [f"# Dossier {r['id']} - {e['nom']}",
         f"Source : {d['meta']['source']} - date de référence {d['meta']['date_reference']} (données CRM uniquement)", "",
         "## Rendez-vous",
         f"- {r['date']} de {r['heure_debut']} à {r['heure_fin']} - {r['type']} - {r['lieu']}",
         f"- Objet : {r['objet']}",
         f"- Contact : {r['contact']['nom']} ({r['contact']['poste']}) - Commercial : {r['commercial']['nom']}",
         f"- Transaction liée : {r['transaction_liee']['id']} {r['transaction_liee']['nom'] or ''}", "",
         "## Entreprise",
         f"- {e['description']}",
         f"- {e['secteur']} / {e['sous_secteur']} - {e['segment']} - statut **{e['statut_compte']}** - client depuis {e['client_depuis']}",
         f"- CA 12 mois : **{euros(e['ca_12_mois'])}** (12 mois précédents : {euros(e['ca_12_mois_precedents'])}) - potentiel : {euros(e['potentiel_annuel'])}",
         f"- Cotée : {e['cotee']} {('(' + e['code_bourse'] + ')') if e['code_bourse'] else ''} - concurrent principal : {e['concurrent_principal']}",
         f"- Contexte : {e['contexte']}", f"- Enjeux : {e['enjeux']}", "",
         "## Contacts"]
    for c in d["contacts"]:
        L.append(f"- **{c['nom']}** - {c['poste']} - {c['niveau_decision']}{' - contact clé' if c['contact_cle'] == 'Oui' else ''}"
                 f" - dernier échange {c['date_dernier_echange'] or 'aucun'} - {c['notes'] or ''}")
    L += ["", "## Transactions"]
    for t in d["transactions"]:
        L.append(f"- {t['id']} {t['nom']} - {t['phase']} ({t['statut']}, {int((t['probabilite'] or 0) * 100)} %) - {euros(t['montant'])}"
                 f" - prochaine étape : {t['prochaine_etape'] or 'n.d.'}")
    L += ["", "## Tickets"]
    L += [f"- {k['id']} [{k['statut']}, {k['priorite']}] {k['objet']} ({k['date_creation']})" for k in d["tickets"]] or ["- aucun"]
    L += ["", "## Commandes (12 mois)",
          f"- {sc['nombre']} commandes, {euros(sc['ca_12_mois'])}, {sc['en_retard']} en retard (max {sc['retard_max_jours']} j)"]
    L += ["", "## 10 dernières activités"]
    L += [f"- {a['date']} {a['type']} - {a['objet']} ({a['resultat'] or '-'})" for a in d["activites_recentes"]]
    if d["dernier_compte_rendu_visite"]:
        v = d["dernier_compte_rendu_visite"]
        L += ["", f"## Dernier compte rendu de visite ({v['date']}, {v['contact']})", "", v["texte_integral"] or ""]
    L += ["", "## Prochains rendez-vous du compte"]
    L += [f"- {p['id']} {p['date']} {p['heure']} - {p['objet']}{' (ce rendez-vous)' if p['est_ce_rdv'] else ''}" for p in d["prochains_rendez_vous"]]
    L += ["", "## Données manquantes"] + ([f"- {m}" for m in d["donnees_manquantes"]] or ["- aucune"])
    return "\n".join(L) + "\n"


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--rdv")
    g.add_argument("--entreprise")
    ap.add_argument("--fichier", help="CRM Excel (défaut : fichier actif dans data/)")
    args = ap.parse_args()
    crm = CRM(args.fichier)
    rid = args.rdv
    if args.entreprise:
        r = crm.prochain_rdv_entreprise(args.entreprise)
        if not r:
            raise SystemExit(f"Aucun rendez-vous à venir pour « {args.entreprise} »")
        rid = r["ID rendez-vous"]
    dossier = construire_dossier(crm, rid.upper())
    SORTIE.mkdir(parents=True, exist_ok=True)
    base = SORTIE / f"{dossier['rendez_vous']['id']}_{slug(dossier['entreprise']['nom'])}_dossier"
    base.with_suffix(".json").write_text(json.dumps(dossier, ensure_ascii=False, indent=2), encoding="utf-8")
    base.with_suffix(".md").write_text(en_markdown(dossier), encoding="utf-8")
    print(json.dumps({"statut": "ok", "rdv": dossier["rendez_vous"]["id"], "entreprise": dossier["entreprise"]["nom"],
                      "json": str(base.with_suffix(".json").relative_to(RACINE)),
                      "md": str(base.with_suffix(".md").relative_to(RACINE))}, ensure_ascii=False))


if __name__ == "__main__":
    sys.exit(main())
