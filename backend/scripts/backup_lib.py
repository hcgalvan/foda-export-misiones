"""
backend/scripts/backup_lib.py — funciones comunes de backup_db.py y restore_db.py.

Solo biblioteca estándar de Python (no hace falta instalar nada en la VM, ni el
comando `sqlite3`). Usa la API de backup de SQLite (`Connection.backup`), que
toma una copia CONSISTENTE aunque la API esté escribiendo en ese momento (un
`cp` directo del archivo no lo garantiza).

Subida/bajada a Google Cloud Storage: se delega en `gcloud storage ...`
(el binario se puede cambiar con la variable FODA_GCLOUD; los tests usan un
gcloud falso).
"""

from __future__ import annotations

import gzip
import hashlib
import os
import shutil
import sqlite3
import subprocess
from datetime import datetime
from pathlib import Path

GCLOUD = os.environ.get("FODA_GCLOUD", "gcloud")


class ErrorBackup(Exception):
    """Algo salió mal y el backup/restauración NO debe darse por bueno."""


def log(msg: str) -> None:
    print(f"[{datetime.now().isoformat(timespec='seconds')}] {msg}", flush=True)


# --------------------------------------------------------------------------
# SQLite
# --------------------------------------------------------------------------


def snapshot(origen: Path, destino: Path) -> None:
    """Copia consistente de `origen` en `destino` (API de backup de SQLite)."""
    if not origen.is_file():
        raise ErrorBackup(f"No existe la base {origen} (¿la API ya corrió al menos una vez?).")
    src = sqlite3.connect(f"file:{origen}?mode=ro", uri=True)
    try:
        dst = sqlite3.connect(destino)
        try:
            src.backup(dst)
        finally:
            dst.close()
    except sqlite3.DatabaseError as e:
        raise ErrorBackup(f"No se pudo copiar la base: {e}") from e
    finally:
        src.close()


def inspeccionar(db: Path) -> dict:
    """Verifica que una base sea sana y devuelve un resumen. Controles:
    integrity_check de SQLite, existe la tabla `assessments`, y las tres
    columnas JSON de TODAS las filas son JSON válido."""
    try:
        con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
    except sqlite3.DatabaseError as e:
        raise ErrorBackup(f"No se pudo abrir la base: {e}") from e
    try:
        try:
            ic = con.execute("PRAGMA integrity_check").fetchall()
        except sqlite3.DatabaseError as e:
            raise ErrorBackup(f"La base está dañada (integrity_check falló: {e}).") from e
        if ic != [("ok",)]:
            raise ErrorBackup(f"integrity_check no dio 'ok': {ic[:3]}")
        tablas = {r[0] for r in con.execute("select name from sqlite_master where type='table'")}
        if "assessments" not in tablas:
            raise ErrorBackup("La base no tiene la tabla 'assessments'.")
        filas = con.execute("select count(*) from assessments").fetchone()[0]
        json_ok = con.execute(
            "select count(*) from assessments "
            "where json_valid(empresa) and json_valid(respuestas) and json_valid(resultados)"
        ).fetchone()[0]
        if json_ok != filas:
            raise ErrorBackup(f"{filas - json_ok} de {filas} filas tienen JSON inválido.")
        ultimo = con.execute("select max(actualizado_en) from assessments").fetchone()[0]
        equipos = con.execute("select count(distinct equipo_id) from assessments").fetchone()[0]
        return {"filas": filas, "equipos": equipos, "ultimoActualizadoEn": ultimo,
                "versionSqlite": sqlite3.sqlite_version}
    finally:
        con.close()


# --------------------------------------------------------------------------
# Archivos
# --------------------------------------------------------------------------


def sha256(ruta: Path) -> str:
    h = hashlib.sha256()
    with ruta.open("rb") as f:
        for bloque in iter(lambda: f.read(1024 * 1024), b""):
            h.update(bloque)
    return h.hexdigest()


def comprimir(origen: Path, destino: Path) -> None:
    with origen.open("rb") as i, gzip.open(destino, "wb", compresslevel=9) as o:
        shutil.copyfileobj(i, o)


def descomprimir(origen: Path, destino: Path) -> None:
    try:
        with gzip.open(origen, "rb") as i, destino.open("wb") as o:
            shutil.copyfileobj(i, o)
    except (OSError, EOFError) as e:
        raise ErrorBackup(f"El archivo .gz está dañado o incompleto: {e}") from e


# --------------------------------------------------------------------------
# Google Cloud Storage (vía gcloud)
# --------------------------------------------------------------------------


def _gcloud(*args: str) -> str:
    try:
        r = subprocess.run([GCLOUD, *args], capture_output=True, text=True, timeout=300)
    except FileNotFoundError as e:
        raise ErrorBackup(
            f"No se encontró '{GCLOUD}'. Instalalo o definí FODA_GCLOUD con la ruta al binario."
        ) from e
    except subprocess.TimeoutExpired as e:
        raise ErrorBackup(f"gcloud tardó demasiado: {' '.join(args[:3])}") from e
    if r.returncode != 0:
        raise ErrorBackup(f"gcloud {' '.join(args[:3])} falló: {r.stderr.strip() or r.stdout.strip()}")
    return r.stdout


def gcs_subir(local: Path, uri_destino: str) -> None:
    _gcloud("storage", "cp", str(local), uri_destino)


def gcs_bajar(uri: str, local: Path) -> None:
    _gcloud("storage", "cp", uri, str(local))


def gcs_tamano(uri: str) -> int:
    salida = _gcloud("storage", "objects", "describe", uri, "--format=value(size)").strip()
    try:
        return int(salida)
    except ValueError as e:
        raise ErrorBackup(f"No se pudo leer el tamaño remoto de {uri}: {salida!r}") from e


def gcs_listar(patron: str) -> list[str]:
    salida = _gcloud("storage", "ls", patron)
    return sorted(l.strip() for l in salida.splitlines() if l.strip().startswith("gs://"))
