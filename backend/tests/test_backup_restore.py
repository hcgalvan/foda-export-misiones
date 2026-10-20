"""
backend/tests/test_backup_restore.py — backup y restauración (scripts/backup_db.py, restore_db.py).

La base de prueba se genera con la API REAL (PUT /assessments/{id} en un subproceso),
y Google Cloud Storage se simula con tests/fake_gcloud.py (carpeta local).
NO prueba permisos ni red reales de GCS: eso se verifica en la VM (README_DEPLOY §6).

Corrida: cd backend && python3 -m pytest tests/test_backup_restore.py -v
"""
from __future__ import annotations

import gzip
import json
import os
import sqlite3
import subprocess
import sys
import textwrap
import uuid
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parents[1]
SCRIPTS = BACKEND / "scripts"
FAKE = BACKEND / "tests" / "fake_gcloud.py"
sys.path.insert(0, str(SCRIPTS))

import backup_db  # noqa: E402
import restore_db  # noqa: E402

GCS = "gs://bucket-test/foda"


@pytest.fixture()
def entorno(tmp_path, monkeypatch):
    raiz = tmp_path / "gcs"
    raiz.mkdir()
    monkeypatch.setenv("FAKE_GCS_ROOT", str(raiz))
    monkeypatch.delenv("FAKE_GCS_FAIL", raising=False)
    # backup_lib lee FODA_GCLOUD al importarse: lo fijamos en el módulo
    import backup_lib
    monkeypatch.setattr(backup_lib, "GCLOUD", str(FAKE))
    return tmp_path


def crear_db_con_api(ruta: Path, n: int = 3) -> None:
    """Crea la base usando la API real, con n evaluaciones."""
    codigo = textwrap.dedent(f"""
        import os, json, uuid
        os.environ["FODA_DATABASE_URL"] = "sqlite:///{ruta}"
        os.environ["FODA_API_KEYS"] = "eq:clave"
        os.environ["FODA_CORS_ORIGINS"] = "https://x.netlify.app"
        from pathlib import Path
        from fastapi.testclient import TestClient
        from main import app
        g = json.loads((Path("..") / "tests" / "golden.demo.json").read_text(encoding="utf-8"))
        resp = [{{"itemId": k, "situacion": v["situacion"], "impacto": v["impacto"], "observacion": ""}}
                for k, v in g["respuestas"].items()]
        with TestClient(app) as c:
            for i in range({n}):
                body = {{"empresa": {{"nombre": f"Empresa {{i}}", "rubro": "Madera", "mercadosObjetivo": [],
                         "perfil": "exporta_actualmente", "fecha": "2026-10-14"}},
                         "respuestas": resp, "versionCuestionario": "1.1.0"}}
                r = c.put(f"/assessments/{{uuid.uuid4()}}", json=body, headers={{"X-API-Key": "clave"}})
                assert r.status_code == 201, r.text
    """)
    r = subprocess.run([sys.executable, "-c", codigo], cwd=BACKEND, capture_output=True, text=True)
    assert r.returncode == 0, r.stderr


def correr(modulo, *args):
    return modulo.main([str(a) for a in args])


def test_backup_local_y_en_gcs_con_manifiesto(entorno):
    db = entorno / "foda.db"
    crear_db_con_api(db, 3)
    dest = entorno / "bk"
    assert correr(backup_db, "--db", db, "--dir", dest, "--gcs", GCS) == 0
    gz = list(dest.glob("foda_*.db.gz"))
    man = list(dest.glob("foda_*.json"))
    assert len(gz) == 1 and len(man) == 1
    datos = json.loads(man[0].read_text())
    assert datos["filas"] == 3 and datos["equipos"] == 1
    remoto = Path(os.environ["FAKE_GCS_ROOT"]) / "bucket-test" / "foda"
    assert (remoto / gz[0].name).is_file() and (remoto / man[0].name).is_file()
    assert oct(gz[0].stat().st_mode)[-3:] == "600"


def test_backup_consistente_mientras_se_escribe(entorno):
    db = entorno / "foda.db"
    crear_db_con_api(db, 2)
    escritor = sqlite3.connect(db)
    escritor.execute("begin immediate")  # transacción de escritura abierta (como la API)
    escritor.execute("update assessments set version_motor='x' where 1=1")
    assert correr(backup_db, "--db", db, "--dir", entorno / "bk") == 0  # lee el estado confirmado
    escritor.rollback()
    escritor.close()


def test_restauracion_verificar_desde_gcs_latest_no_toca_la_viva(entorno):
    db = entorno / "foda.db"
    crear_db_con_api(db, 3)
    assert correr(backup_db, "--db", db, "--dir", entorno / "bk", "--gcs", GCS) == 0
    antes = db.read_bytes()
    assert correr(restore_db, "verificar", "latest", "--gcs", GCS) == 0
    assert db.read_bytes() == antes


def test_restauracion_aplicar_recupera_datos_borrados_y_guarda_la_previa(entorno):
    db = entorno / "foda.db"
    crear_db_con_api(db, 3)
    assert correr(backup_db, "--db", db, "--dir", entorno / "bk", "--gcs", GCS) == 0
    con = sqlite3.connect(db)
    original = sorted(con.execute("select id, empresa, respuestas, resultados from assessments").fetchall())
    con.close()
    # desastre: se borran las evaluaciones
    con = sqlite3.connect(db); con.execute("delete from assessments"); con.commit(); con.close()
    assert sqlite3.connect(db).execute("select count(*) from assessments").fetchone()[0] == 0
    assert correr(restore_db, "aplicar", "latest", "--gcs", GCS, "--db", db, "--sin-servicio") == 0
    con = sqlite3.connect(db)
    assert con.execute("select count(*) from assessments").fetchone()[0] == 3
    # contenido idéntico al original, fila por fila (incluye resultados calculados)
    assert sorted(con.execute("select id, empresa, respuestas, resultados from assessments").fetchall()) == original
    con.close()
    previas = list(entorno.glob("foda.db.pre-restore-*"))
    assert len(previas) == 1
    assert sqlite3.connect(previas[0]).execute("select count(*) from assessments").fetchone()[0] == 0


def test_restaurar_desde_archivo_local(entorno):
    db = entorno / "foda.db"
    crear_db_con_api(db, 2)
    bk = entorno / "bk"
    assert correr(backup_db, "--db", db, "--dir", bk) == 0
    gz = next(bk.glob("foda_*.db.gz"))
    assert correr(restore_db, "verificar", gz) == 0
    assert correr(restore_db, "verificar", "latest", "--dir", bk) == 0


def test_backup_corrupto_se_detecta_sha(entorno):
    db = entorno / "foda.db"
    crear_db_con_api(db, 2)
    bk = entorno / "bk"
    correr(backup_db, "--db", db, "--dir", bk)
    gz = next(bk.glob("foda_*.db.gz"))
    datos = bytearray(gz.read_bytes()); datos[len(datos) // 2] ^= 0xFF
    gz.write_bytes(bytes(datos))
    assert correr(restore_db, "verificar", gz) == 1


def test_backup_con_manifiesto_adulterado_pero_gz_valido_se_detecta(entorno):
    """Un .gz bien formado pero que no es el original: el SHA no coincide."""
    db = entorno / "foda.db"
    crear_db_con_api(db, 2)
    bk = entorno / "bk"
    correr(backup_db, "--db", db, "--dir", bk)
    gz = next(bk.glob("foda_*.db.gz"))
    otro = entorno / "otra.db"
    crear_db_con_api(otro, 1)
    gz.write_bytes(gzip.compress(otro.read_bytes()))
    assert correr(restore_db, "verificar", gz) == 1


def test_base_con_json_invalido_no_se_da_por_buena(entorno):
    db = entorno / "foda.db"
    crear_db_con_api(db, 2)
    con = sqlite3.connect(db); con.execute("update assessments set respuestas='no es json'"); con.commit(); con.close()
    assert correr(backup_db, "--db", db, "--dir", entorno / "bk") == 1
    assert not list((entorno / "bk").glob("foda_*.db.gz"))


def test_base_inexistente_falla(entorno):
    assert correr(backup_db, "--db", entorno / "no_existe.db", "--dir", entorno / "bk") == 1


def test_falla_la_subida_codigo_2_pero_queda_el_backup_local(entorno, monkeypatch):
    db = entorno / "foda.db"
    crear_db_con_api(db, 1)
    monkeypatch.setenv("FAKE_GCS_FAIL", "1")
    assert correr(backup_db, "--db", db, "--dir", entorno / "bk", "--gcs", GCS) == 2
    assert len(list((entorno / "bk").glob("foda_*.db.gz"))) == 1


def test_poda_local_borra_solo_lo_viejo(entorno):
    db = entorno / "foda.db"
    crear_db_con_api(db, 1)
    bk = entorno / "bk"; bk.mkdir()
    viejo = bk / "foda_20200101_000000.db.gz"; viejo.write_bytes(b"x")
    (bk / "foda_20200101_000000.json").write_text("{}")
    os.utime(viejo, (1_577_836_800, 1_577_836_800))
    assert correr(backup_db, "--db", db, "--dir", bk, "--keep-days", 14) == 0
    assert not viejo.exists() and not (bk / "foda_20200101_000000.json").exists()
    assert len(list(bk.glob("foda_*.db.gz"))) == 1
