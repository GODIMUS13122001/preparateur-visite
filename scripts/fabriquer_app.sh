#!/bin/zsh
# Fabrique « Préparateur de visite.app » (tout-en-un : Python, interface, agent) et son .dmg,
# déposé dans « 1 - Démo », à côté des deux CRM.
# Usage : ./scripts/fabriquer_app.sh        (depuis le dossier du projet, Mac Apple Silicon)
set -e
export PATH="$HOME/.local/bin:$PATH"
PROJET="$(cd "$(dirname "$0")/.." && pwd)"
NOM="Préparateur de visite"
TRAVAIL="$PROJET/.fabrication"
SORTIE="$(dirname "$(dirname "$PROJET")")/1 - Démo"  # le .dmg va dans le dossier de démo
APP="$TRAVAIL/$NOM.app"
RES="$APP/Contents/Resources"
cd "$PROJET"

echo "1/6  Interface"
if command -v npm >/dev/null 2>&1; then (cd app/web && npm run build --silent >/dev/null); fi
[ -f app/web/dist/index.html ] || { echo "Interface non compilée (app/web/dist absent)."; exit 1; }

echo "2/6  Python autonome"
uv python install 3.12 >/dev/null 2>&1 || true
PYSRC="$(dirname "$(dirname "$(readlink -f "$(uv python find --no-project 3.12 --managed-python 2>/dev/null || uv python find 3.12)")")")"
rm -rf "$TRAVAIL"; mkdir -p "$APP/Contents/MacOS" "$RES/app"
cp -R "$PYSRC" "$RES/python"
rm -f "$RES/python/lib/python3.12/EXTERNALLY-MANAGED"

echo "3/6  Dépendances"
uv pip install -q --python "$RES/python/bin/python3" --system --break-system-packages -r requirements-appli.txt

echo "4/6  Agent et interface"
mkdir -p "$RES/app/app/web" "$RES/app/demo"
cp app/serveur.py app/execution.py app/relais.py app/bureau.py "$RES/app/app/"
cp -R app/icone "$RES/app/app/icone"
cp -R app/web/dist "$RES/app/app/web/dist"
cp -R scripts .claude integrations CLAUDE.md "$RES/app/"
rm -f "$RES/app/scripts/fabriquer_app.sh" "$RES/app/scripts/creer_app.sh"
cp data/Export_CRM_Orvane_demo_20261009.xlsx "$RES/app/demo/" 2>/dev/null || true
find "$RES" -name "__pycache__" -type d -prune -exec rm -rf {} +
cp app/icone/icone.icns "$RES/icone.icns"

cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>$NOM</string>
  <key>CFBundleDisplayName</key><string>$NOM</string>
  <key>CFBundleIdentifier</key><string>fr.godimus.preparateur-visite</string>
  <key>CFBundleVersion</key><string>3.0</string>
  <key>CFBundleShortVersionString</key><string>3.0</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleExecutable</key><string>lanceur</string>
  <key>CFBundleIconFile</key><string>icone</string>
  <key>LSMinimumSystemVersion</key><string>12.0</string>
  <key>LSArchitecturePriority</key><array><string>arm64</string></array>
  <key>NSHighResolutionCapable</key><true/>
</dict></plist>
PLIST
cat > "$APP/Contents/MacOS/lanceur" <<'LANCEUR'
#!/bin/zsh
# Démarre le Préparateur de visite : le Python embarqué lance le serveur local et la fenêtre.
RES="$(cd "$(dirname "$0")/../Resources" && pwd)"
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
JOURNAL="$HOME/Library/Logs/Préparateur de visite.log"
exec "$RES/python/bin/python3" "$RES/app/app/bureau.py" >> "$JOURNAL" 2>&1
LANCEUR
chmod +x "$APP/Contents/MacOS/lanceur"

echo "5/6  Signature locale"
codesign --force --deep --sign - "$APP" >/dev/null 2>&1 || echo "     (signature locale ignorée)"

echo "6/6  Image disque"
mkdir -p "$SORTIE"
DMG="$SORTIE/$NOM.dmg"
rm -rf "$TRAVAIL/dmg" "$DMG"; mkdir -p "$TRAVAIL/dmg"
cp -R "$APP" "$TRAVAIL/dmg/"
ln -s /Applications "$TRAVAIL/dmg/Applications"
hdiutil create -volname "$NOM" -srcfolder "$TRAVAIL/dmg" -ov -format UDZO "$DMG" >/dev/null
rm -rf "$TRAVAIL/dmg"
du -sh "$APP" "$DMG"
echo "Prêt : $DMG"
