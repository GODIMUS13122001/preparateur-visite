#!/bin/zsh
# Déploie l'appli mobile et son relais sur le compte Vercel de la personne (version gratuite suffisante),
# puis relie l'appli Mac à ce relais. Prérequis : Node.js, et `npx vercel login` déjà fait.
# Usage : ./scripts/deployer_relais.sh   (depuis le dossier Source)
set -e
export PATH="$HOME/.local/bin:$PATH"
SOURCE="$(cd "$(dirname "$0")/.." && pwd)"
ESPACE="${PREPARATEUR_ESPACE:-$HOME/Library/Application Support/Préparateur de visite}"
V="npx -y vercel@63.1.2"
cd "$SOURCE/relais"
$V whoami >/dev/null || { echo "Connectez-vous d'abord : npx vercel login"; exit 1; }
NOM="preparateur-visite-$(LC_ALL=C tr -dc 'a-z0-9' </dev/urandom | head -c 6)"
rm -rf .vercel
echo "1/5  Projet Vercel $NOM"
$V link --yes --project "$NOM" >/dev/null
echo "2/5  Stockage privé"
$V blob create-store "$NOM" --access private --region cdg1 --yes >/dev/null
echo "3/5  Clés"
trap 'rm -f .cles.json' EXIT  # jamais de clés qui traînent si le script s'arrête en route
npm install --silent >/dev/null
node -e "
const wp=require('web-push'),c=require('crypto'),v=wp.generateVAPIDKeys();
console.log(JSON.stringify({CLE_MOTEUR:c.randomBytes(24).toString('hex'),CLE_ACCES:c.randomBytes(16).toString('hex'),VAPID_PUBLIQUE:v.publicKey,VAPID_PRIVEE:v.privateKey,CANAL_MOTEUR:'preparateur-relais-'+c.randomBytes(6).toString('hex')}))" > .cles.json
for N in CLE_MOTEUR CLE_ACCES VAPID_PUBLIQUE VAPID_PRIVEE CANAL_MOTEUR; do
  node -e "process.stdout.write(require('./.cles.json')['$N'])" | $V env add $N production --sensitive >/dev/null
done
echo "4/5  Déploiement"
URL=$($V deploy --prod --yes 2>/dev/null | grep -o 'https://[a-z0-9-]*\.vercel\.app' | tail -1)
URL="https://$NOM.vercel.app"
echo "5/5  Liaison avec l'appli Mac"
mkdir -p "$ESPACE/config"
node -e "
const k=require('./.cles.json');
require('fs').writeFileSync(process.argv[1], JSON.stringify({url:process.argv[2],cle_moteur:k.CLE_MOTEUR,cle_acces:k.CLE_ACCES,canal:k.CANAL_MOTEUR,projet_vercel:process.argv[3]},null,2))" "$ESPACE/config/relais.json" "$URL" "$NOM"
rm -f .cles.json "$ESPACE/config/relais_curseur.txt"
echo "Prêt : $URL. Relancez l'application, puis « Relier mon téléphone » dans la pastille à votre prénom."
