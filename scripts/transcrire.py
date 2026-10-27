"""Transcription locale d'une note vocale en français (faster-whisper), sans aucun service extérieur.

Usage : python scripts/transcrire.py audio/note.m4a [--modele small|medium]
Sortie : un fichier .txt à côté de l'audio, et un résumé JSON sur la sortie standard.
Le modèle (« small » par défaut, environ 480 Mo) est téléchargé une seule fois dans <données>/modeles.

Contournement prévu par le cahier des charges : si la transcription bloque, le commercial peut fournir
directement un texte dicté ; dans ce cas, passer un fichier .txt : il est simplement relu et renvoyé.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

from crm_lib import RACINE


def son_16k(audio: Path):
    """Son mono 16 kHz pour le modèle.
    Contournement (12/10/2026) : la version du décodeur audio installée (PyAV 19) n'est plus compatible avec
    faster-whisper 1.2, et l'ancienne ne s'installe pas sur Python 3.12. On convertit donc avec afconvert,
    l'outil audio intégré à macOS, qui lit le format des notes de l'iPhone (AAC/MP4) ainsi que WAV et AIFF."""
    import subprocess
    import tempfile
    import wave

    import numpy as np
    with tempfile.TemporaryDirectory() as tmp:
        wav = Path(tmp) / "son.wav"
        subprocess.run(["afconvert", "-f", "WAVE", "-d", "LEI16@16000", "-c", "1", str(audio), str(wav)], check=True, capture_output=True)
        with wave.open(str(wav)) as w:
            donnees = w.readframes(w.getnframes())
    return np.frombuffer(donnees, dtype=np.int16).astype(np.float32) / 32768.0


def transcrire(audio: Path, modele: str = "small") -> dict:
    if audio.suffix.lower() == ".txt":  # contournement : texte déjà dicté
        texte = audio.read_text(encoding="utf-8").strip()
        return {"statut": "ok", "texte": texte, "source": "texte fourni", "duree_audio_s": None}
    from faster_whisper import WhisperModel
    debut = time.time()
    m = WhisperModel(modele, device="cpu", compute_type="int8", download_root=str(RACINE / "modeles"))
    segments, info = m.transcribe(son_16k(audio), language="fr", vad_filter=True, beam_size=5)
    texte = " ".join(s.text.strip() for s in segments).strip()
    return {"statut": "ok", "texte": texte, "source": f"faster-whisper {modele}", "duree_audio_s": round(info.duration, 1),
            "duree_traitement_s": round(time.time() - debut, 1)}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("audio")
    ap.add_argument("--modele", default="small", choices=["base", "small", "medium"])
    args = ap.parse_args()
    audio = Path(args.audio)
    if not audio.exists():
        raise SystemExit(f"Fichier introuvable : {audio}")
    try:
        res = transcrire(audio, args.modele)
    except Exception as e:
        print(json.dumps({"statut": "erreur", "message": f"{type(e).__name__}: {e}"}, ensure_ascii=False))
        return 1
    sortie = audio.with_suffix(".txt") if audio.suffix.lower() != ".txt" else audio
    sortie.write_text(res["texte"] + "\n", encoding="utf-8")
    print(json.dumps({**{k: v for k, v in res.items() if k != "texte"}, "fichier": str(sortie), "mots": len(res["texte"].split())}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
