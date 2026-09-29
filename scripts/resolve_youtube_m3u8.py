#!/usr/bin/env python3
"""
Resuelve las URLs .m3u8 reales de los directos de YouTube pendientes
(config/cctv/live/espana-pendientes-youtube.json) usando yt-dlp, y genera
el pack final que el proyecto puede cargar directamente:
config/cctv/live/espana-youtube-resuelto.json

USO (en tu ordenador, CON conexión a internet):

    pip install -U yt-dlp
    python3 scripts/resolve_youtube_m3u8.py

Vuelve a ejecutarlo de vez en cuando: los directos 24/7 de YouTube a veces
cambian de video_id o de manifest, así que el .m3u8 resuelto puede caducar.

No hace falta tocar config/cctv/index.json: el pack
"espana-youtube-live" ya está registrado ahí. Mientras
espana-youtube-resuelto.json no exista (o esté vacío), el proyecto
simplemente no carga esas cámaras — no rompe nada.
"""

from __future__ import annotations

import json
import re
import subprocess
import sys
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PENDING_FILE = ROOT / "config" / "cctv" / "live" / "espana-pendientes-youtube.json"
OUTPUT_FILE = ROOT / "config" / "cctv" / "live" / "espana-youtube-resuelto.json"


def slugify(text: str) -> str:
    text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode("ascii")
    text = text.lower()
    text = re.sub(r"[^a-z0-9]+", "-", text)
    return text.strip("-")


def resolve_m3u8(youtube_url: str) -> str | None:
    """Pide a yt-dlp la URL .m3u8 real del directo (formato hls, la mejor calidad)."""
    try:
        result = subprocess.run(
            [
                "yt-dlp",
"--remote-components",
"ejs:github",
"-g",
"-f",
"bestvideo*",
youtube_url,
            ],
            capture_output=True,
            text=True,
            timeout=60,
        )
    except FileNotFoundError:
        print("ERROR: no se encontró yt-dlp. Instálalo con: pip install -U yt-dlp")
        sys.exit(1)

    if result.returncode != 0:
        print(f"  ! yt-dlp falló para {youtube_url}: {result.stderr.strip()[:200]}")
        return None

    url = result.stdout.strip().splitlines()[-1] if result.stdout.strip() else ""
    if not url.startswith("http"):
        print(f"  ! yt-dlp no devolvió una URL utilizable para {youtube_url}")
        return None
    return url


def main() -> None:
    if not PENDING_FILE.exists():
        print(f"ERROR: no existe {PENDING_FILE}")
        sys.exit(1)

    data = json.loads(PENDING_FILE.read_text(encoding="utf-8"))
    cams = data.get("camaras", [])
    print(f"Cámaras pendientes a resolver: {len(cams)}\n")

    resolved = []
    for cam in cams:
        nombre = cam.get("nombre", cam.get("id", "?"))
        youtube_url = cam.get("url_youtube", "")
        print(f"- {nombre} ({youtube_url})")
        if not youtube_url:
            print("  ! sin url_youtube, se omite")
            continue

        m3u8_url = resolve_m3u8(youtube_url)
        if not m3u8_url:
            continue

        coords = cam.get("coordenadas") or {}
        city = cam.get("ciudad", "")
        entry = {
            "id": f"es-live-yt-{cam.get('id', slugify(nombre))}",
            "name": nombre,
            "city": city,
            "cityId": slugify(city) if city else slugify(cam.get("id", nombre)),
            "provider": cam.get("proveedor", "YouTube Live"),
            "lat": coords.get("lat"),
            "lon": coords.get("lon"),
            "feedType": "hls",
            "url": m3u8_url,
            "snapshotUrl": "",
            "sourceUrl": cam.get("pagina_origen", youtube_url),
            "sourceKind": "espana-youtube-live-hls",
            "credit": cam.get("proveedor", "YouTube Live"),
        }
        resolved.append(entry)
        print("  OK")

    OUTPUT_FILE.write_text(
        json.dumps(resolved, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(f"\nResueltas {len(resolved)}/{len(cams)} cámaras -> {OUTPUT_FILE}")
    print("Reinicia el proyecto (o espera al refresco de caché del catálogo CCTV) para verlas.")


if __name__ == "__main__":
    main()
