#!/usr/bin/env python3
"""
backend/scripts/backup_db.py — backup de foda.db: copia consistente, verificada,
comprimida, con manifiesto, subida a Google Cloud Storage (opcional) y poda local.

Pasos (si cualquiera falla, sale con código != 0 y NO da el backup por bueno):
  1. Copia consistente de la base (API de backup de SQLite).
  2. Verifica la copia: integrity_check, tabla `assessments`, JSON válido en todas las filas.
  3. Comprime (.db.gz) y calcula SHA-256.
  4. Escribe un manifiesto .json (filas, equipos, último cambio, sha256, tamaño).
  5. Si hay --gcs: sube ambos archivos y verifica que el tamaño remoto coincida.
  6. Borra backups locales más viejos que --keep-days.

Códigos de salida: 0 ok · 1 falló la copia o la verificación · 2 el backup local
quedó bien pero falló la subida a Cloud Storage.

Uso:
  python3 backup_db.py --db ~/foda-export-misiones/backend/foda.db \\
      --dir ~/foda-backups --gcs gs://backup-bot-academico/foda
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

from backup_lib import (ErrorBackup, comprimir, gcs_subir, gcs_tamano, inspeccionar, log,
                        sha256, snapshot)


def podar_locales(carpeta: Path, dias: int) -> None:
    limite = time.time() - dias * 86400
    for f in carpeta.glob("foda_*.db.gz"):
        if f.stat().st_mtime < limite:
            manifiesto = f.with_name(f.name[: -len(".db.gz")] + ".json")
            f.unlink()
            manifiesto.unlink(missing_ok=True)
            log(f"Borrado backup local viejo: {f.name}")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Backup de foda.db")
    ap.add_argument("--db", required=True, type=Path, help="ruta a foda.db")
    ap.add_argument("--dir", required=True, type=Path, help="carpeta local de backups")
    ap.add_argument("--gcs", default=os.environ.get("FODA_BACKUP_GCS", ""),
                    help="destino en Cloud Storage, p. ej. gs://bucket/foda (o env FODA_BACKUP_GCS)")
    ap.add_argument("--keep-days", type=int, default=int(os.environ.get("DIAS_A_CONSERVAR", "14")),
                    help="días de backups locales a conservar (default 14)")
    args = ap.parse_args(argv)

    args.dir.mkdir(parents=True, exist_ok=True)
    os.chmod(args.dir, 0o700)  # los backups contienen datos de empresas
    sello = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    base = f"foda_{sello}"
    tmp_db = args.dir / f"{base}.db.tmp"
    gz = args.dir / f"{base}.db.gz"
    manifiesto = args.dir / f"{base}.json"

    try:
        snapshot(args.db, tmp_db)
        info = inspeccionar(tmp_db)
        if info["filas"] == 0:
            log("AVISO: la base no tiene ninguna evaluación (el backup se hace igual).")
        comprimir(tmp_db, gz)
        os.chmod(gz, 0o600)
        datos = {
            "archivo": gz.name,
            "creadoEn": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "sha256Gz": sha256(gz),
            "bytesGz": gz.stat().st_size,
            **info,
        }
        manifiesto.write_text(json.dumps(datos, indent=2, ensure_ascii=False), encoding="utf-8")
        os.chmod(manifiesto, 0o600)
        log(f"Backup local OK: {gz.name} ({datos['bytesGz']} bytes, {info['filas']} evaluaciones, "
            f"{info['equipos']} equipo(s), último cambio {info['ultimoActualizadoEn']})")
    except ErrorBackup as e:
        log(f"ERROR: {e}")
        return 1
    finally:
        tmp_db.unlink(missing_ok=True)

    codigo = 0
    if args.gcs:
        destino = args.gcs.rstrip("/")
        try:
            gcs_subir(gz, f"{destino}/{gz.name}")
            gcs_subir(manifiesto, f"{destino}/{manifiesto.name}")
            remoto = gcs_tamano(f"{destino}/{gz.name}")
            if remoto != datos["bytesGz"]:
                raise ErrorBackup(f"Tamaño remoto {remoto} != local {datos['bytesGz']}")
            log(f"Subido y verificado en {destino}/{gz.name}")
        except ErrorBackup as e:
            log(f"ERROR de subida (el backup local quedó guardado): {e}")
            codigo = 2
    else:
        log("AVISO: sin --gcs, el backup queda solo en esta VM (no protege si la VM se pierde).")

    podar_locales(args.dir, args.keep_days)
    return codigo


if __name__ == "__main__":
    sys.exit(main())
