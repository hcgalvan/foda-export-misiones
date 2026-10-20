#!/usr/bin/env python3
"""
backend/scripts/restore_db.py — verificar y restaurar un backup de foda.db.

Dos modos. NUNCA pisa la base viva sin dejar antes una copia de seguridad de ella.

  verificar <origen>   Baja/descomprime el backup en una carpeta temporal y lo
                       inspecciona (SHA-256 contra el manifiesto si existe,
                       integrity_check, filas, JSON válido). No toca la base viva.
                       Es la "restauración de prueba": se puede correr cuando quieras.

  aplicar <origen>     Hace lo anterior y luego: detiene el servicio, mueve la base
                       actual a foda.db.pre-restore-<fecha>, instala la restaurada,
                       reinicia el servicio y consulta /health.

<origen> puede ser:
  - un archivo local  ~/foda-backups/foda_20261019_060000.db.gz
  - un objeto         gs://backup-bot-academico/foda/foda_20261019_060000.db.gz
  - la palabra  latest  (el más reciente de --gcs, o de --dir si no hay --gcs)

Ejemplos:
  python3 restore_db.py verificar latest --gcs gs://backup-bot-academico/foda
  python3 restore_db.py aplicar   latest --gcs gs://backup-bot-academico/foda \\
          --db ~/foda-export-misiones/backend/foda.db
"""

from __future__ import annotations

import argparse
import json
import os
import shlex
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request
from datetime import datetime
from pathlib import Path

from backup_lib import (ErrorBackup, descomprimir, gcs_bajar, gcs_listar, inspeccionar, log,
                        sha256)

SYSTEMCTL = shlex.split(os.environ.get("FODA_SYSTEMCTL", "sudo systemctl"))


def resolver_origen(origen: str, gcs: str, carpeta: Path | None) -> str:
    if origen != "latest":
        return origen
    if gcs:
        objetos = gcs_listar(f"{gcs.rstrip('/')}/foda_*.db.gz")
        if not objetos:
            raise ErrorBackup(f"No hay backups foda_*.db.gz en {gcs}")
        return objetos[-1]  # los nombres llevan fecha UTC: el último es el más nuevo
    if carpeta:
        locales = sorted(carpeta.glob("foda_*.db.gz"))
        if not locales:
            raise ErrorBackup(f"No hay backups foda_*.db.gz en {carpeta}")
        return str(locales[-1])
    raise ErrorBackup("Para 'latest' indicá --gcs o --dir.")


def obtener_y_verificar(origen: str, trabajo: Path) -> tuple[Path, dict]:
    """Deja una base .db verificada en `trabajo` y devuelve (ruta, resumen)."""
    gz = trabajo / "backup.db.gz"
    manifiesto_local = trabajo / "backup.json"
    if origen.startswith("gs://"):
        gcs_bajar(origen, gz)
        try:
            gcs_bajar(origen[: -len(".db.gz")] + ".json", manifiesto_local)
        except ErrorBackup:
            log("AVISO: no se encontró el manifiesto .json; se omite el control de SHA-256.")
    else:
        p = Path(origen).expanduser()
        if not p.is_file():
            raise ErrorBackup(f"No existe el archivo {p}")
        shutil.copy(p, gz)
        m = p.with_name(p.name[: -len(".db.gz")] + ".json")
        if p.name.endswith(".db.gz") and m.is_file():
            shutil.copy(m, manifiesto_local)

    manifiesto = None
    if manifiesto_local.is_file():
        manifiesto = json.loads(manifiesto_local.read_text(encoding="utf-8"))
        if sha256(gz) != manifiesto["sha256Gz"]:
            raise ErrorBackup("El SHA-256 del archivo no coincide con el manifiesto (archivo alterado o corrupto).")
        log("SHA-256 coincide con el manifiesto.")

    db = trabajo / "restaurada.db"
    descomprimir(gz, db)
    info = inspeccionar(db)
    if manifiesto and manifiesto.get("filas") != info["filas"]:
        raise ErrorBackup(f"El manifiesto dice {manifiesto['filas']} filas y la base tiene {info['filas']}.")
    return db, info


def health(url: str, intentos: int = 15) -> bool:
    for _ in range(intentos):
        try:
            with urllib.request.urlopen(url, timeout=3) as r:
                if r.status == 200:
                    return True
        except Exception:
            pass
        time.sleep(1)
    return False


def systemctl(*args: str) -> None:
    r = subprocess.run([*SYSTEMCTL, *args], capture_output=True, text=True)
    if r.returncode != 0:
        raise ErrorBackup(f"systemctl {' '.join(args)} falló: {r.stderr.strip()}")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Verificar / restaurar un backup de foda.db")
    ap.add_argument("modo", choices=["verificar", "aplicar"])
    ap.add_argument("origen", help="archivo .db.gz, gs://..., o 'latest'")
    ap.add_argument("--gcs", default=os.environ.get("FODA_BACKUP_GCS", ""))
    ap.add_argument("--dir", type=Path, default=None, help="carpeta local de backups (para latest)")
    ap.add_argument("--db", type=Path, help="ruta de la base viva (obligatorio en 'aplicar')")
    ap.add_argument("--servicio", default="foda-api")
    ap.add_argument("--health-url", default="http://127.0.0.1:8000/health")
    ap.add_argument("--sin-servicio", action="store_true",
                    help="no parar/arrancar systemd (para pruebas)")
    args = ap.parse_args(argv)

    if args.modo == "aplicar" and not args.db:
        ap.error("'aplicar' necesita --db")

    try:
        origen = resolver_origen(args.origen, args.gcs, args.dir)
        log(f"Origen: {origen}")
        with tempfile.TemporaryDirectory(prefix="foda-restore-") as t:
            os.chmod(t, 0o700)
            db, info = obtener_y_verificar(origen, Path(t))
            log(f"VERIFICACIÓN OK: {info['filas']} evaluaciones, {info['equipos']} equipo(s), "
                f"último cambio {info['ultimoActualizadoEn']}, integrity_check = ok, JSON válido.")
            if args.modo == "verificar":
                log("Modo verificar: no se tocó la base viva.")
                return 0

            destino: Path = args.db.expanduser()
            previa = destino.with_name(f"{destino.name}.pre-restore-{datetime.now():%Y%m%d_%H%M%S}")
            nueva = destino.with_name(destino.name + ".restoring")
            shutil.copy(db, nueva)  # misma carpeta => el reemplazo final es atómico
            if not args.sin_servicio:
                log(f"Deteniendo {args.servicio}...")
                systemctl("stop", args.servicio)
            try:
                if destino.exists():
                    shutil.move(str(destino), str(previa))
                    log(f"Base anterior guardada en {previa}")
                for sufijo in ("-wal", "-shm"):
                    Path(str(destino) + sufijo).unlink(missing_ok=True)
                os.replace(nueva, destino)
            except Exception as e:
                # volver atrás si algo falló a mitad de camino
                if previa.exists() and not destino.exists():
                    shutil.move(str(previa), str(destino))
                raise ErrorBackup(f"Falló el reemplazo (se dejó la base anterior): {e}") from e
            finally:
                if not args.sin_servicio:
                    systemctl("start", args.servicio)
            if not args.sin_servicio:
                if health(args.health_url):
                    log("API arriba: /health responde 200.")
                else:
                    log(f"ERROR: la API no respondió en {args.health_url}. "
                        f"Para volver atrás: mover {previa} a {destino} y reiniciar el servicio.")
                    return 3
            log("RESTAURACIÓN APLICADA.")
            return 0
    except ErrorBackup as e:
        log(f"ERROR: {e}")
        return 1


if __name__ == "__main__":
    sys.exit(main())
