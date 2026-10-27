"""Garde-fou des préparations lancées par l'application (hook PreToolUse de .claude/settings.json).

Chacune des 5 recherches a son agent Sonnet dédié : bourse (cours-bourse), LinkedIn (linkedin-entreprise),
presse A/B/C (veille-entreprise). Claude ne peut ni les faire lui-même, ni confier une recherche au mauvais agent.
Actif seulement quand l'application a lancé la préparation (PREPARATEUR_PREPARATION=1) : les sessions de
développement ne sont pas bridées. Code de sortie 2 = appel refusé, le message est renvoyé à Claude.
"""
import json
import os
import sys

if os.environ.get("PREPARATEUR_PREPARATION") != "1":
    sys.exit(0)

d = json.load(sys.stdin)
agent, outil = d.get("agent_type"), d.get("tool_name")
commande = (d.get("tool_input") or {}).get("command", "") if outil == "Bash" else ""
RESERVES = {"cours_bourse": "cours-bourse", "linkedin_entreprise": "linkedin-entreprise", "linkedin_profil": "profil-interlocuteur"}

for script, proprietaire in RESERVES.items():
    if script in commande and agent != proprietaire:
        print(f"Refusé : {script}.py est réservé à l'agent « {proprietaire} ». Lance cet agent (outil Agent, "
              f"subagent_type « {proprietaire} »), une recherche par agent, sans regrouper les commandes.", file=sys.stderr)
        sys.exit(2)
if commande and agent in RESERVES.values():
    autres = [s for s, p in RESERVES.items() if p != agent and s in commande]
    if autres:
        print("Refusé : un agent ne fait que sa propre recherche.", file=sys.stderr)
        sys.exit(2)
if outil in ("WebSearch", "WebFetch") and not agent:
    print("Refusé : les recherches sur internet sont faites par les agents dédiés (un agent par recherche), "
          "jamais directement.", file=sys.stderr)
    sys.exit(2)
