# Configuration locale

Les vrais fichiers de ce dossier contiennent des clés et ne sont jamais publiés (voir `.gitignore`).
Ils sont créés au premier lancement ou par `scripts/deployer_relais.sh`. Les fichiers `*.example.json` montrent leur forme.

| Fichier | Rôle |
|---|---|
| `relais.json` | Adresse et clés du relais Vercel qui relie le téléphone au Mac |
| `push.json` | Canaux ntfy pour les notifications du téléphone |
| `agenda_demo.json`, `geocodage.json`, `envois.json` | États et caches locaux, recréés automatiquement |

Les canaux ntfy.sh sont publics : leur nom doit rester secret et aléatoire.
