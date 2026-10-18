"""
backend/tests/test_api.py — tests de la API (POST/GET /assessments, auth, CORS).

Usa una base SQLite temporal (nunca toca foda.db real) y verifica lo más
importante de Fase 4: que el servidor RECALCULA (no confía en el cliente) y
que el resultado persistido coincide con el golden del Excel DEMO.

Corrida: cd backend && python3 -m pytest tests/ -v
"""

from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path

import pytest

# La base temporal y las claves se fijan ANTES de importar la app (config.py
# lee el entorno al importarse).
_tmpdir = tempfile.mkdtemp(prefix="foda_test_")
os.environ["FODA_DATABASE_URL"] = f"sqlite:///{_tmpdir}/test.db"
os.environ["FODA_API_KEYS"] = "equipo-a:clave-a,equipo-b:clave-b"
os.environ["FODA_CORS_ORIGINS"] = "https://foda-test.netlify.app"

from fastapi.testclient import TestClient  # noqa: E402

from main import app  # noqa: E402

RAIZ_REPO = Path(__file__).resolve().parents[2]
GOLDEN = json.loads((RAIZ_REPO / "tests" / "golden.demo.json").read_text(encoding="utf-8"))

HEADERS_A = {"X-API-Key": "clave-a"}
HEADERS_B = {"X-API-Key": "clave-b"}


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


def _body(**over):
    respuestas = [
        {"itemId": k, "situacion": v["situacion"], "impacto": v["impacto"], "observacion": ""}
        for k, v in GOLDEN["respuestas"].items()
    ]
    body = {
        "empresa": {
            "nombre": "Empresa Demo SA",
            "rubro": "Madera",
            "mercadosObjetivo": ["Brasil"],
            "perfil": "no_exporta_evalua_iniciar",
            "fecha": "2026-10-14",
        },
        "respuestas": respuestas,
        "versionCuestionario": "1.1.0",
    }
    body.update(over)
    return body


def test_health(client):
    assert client.get("/health").json()["status"] == "ok"


def test_post_recalcula_y_coincide_con_golden(client):
    r = client.post("/assessments", json=_body(), headers=HEADERS_A)
    assert r.status_code == 201
    res = r.json()["resultados"]
    esp = GOLDEN["esperado"]
    assert abs(res["indiceInterno"] - esp["indiceInterno"]) <= 0.01
    assert abs(res["indiceExterno"] - esp["indiceExterno"]) <= 0.01
    assert res["veredicto"] == esp["veredicto"]
    assert res["matrizFoda"]["cruces"] == esp["matrizFoda"]["cruces"]
    assert res["matrizFoda"]["cuadranteDominante"] == esp["matrizFoda"]["cuadranteDominante"]


def test_post_ignora_resultados_manipulados_por_el_cliente(client):
    # Aunque el cliente mande un "resultados" falso, el schema no lo acepta
    # (se ignora) y el servidor devuelve el recalculado real.
    body = _body()
    body["resultados"] = {"veredicto": "VIABLE", "indiceInterno": 10, "indiceExterno": 10}
    r = client.post("/assessments", json=body, headers=HEADERS_A)
    assert r.status_code == 201
    assert r.json()["resultados"]["veredicto"] == GOLDEN["esperado"]["veredicto"]


def test_post_sin_api_key_falla(client):
    assert client.post("/assessments", json=_body()).status_code == 422  # header obligatorio


def test_post_api_key_invalida_da_401(client):
    r = client.post("/assessments", json=_body(), headers={"X-API-Key": "nope"})
    assert r.status_code == 401


def test_post_valida_rangos(client):
    body = _body()
    body["respuestas"][0]["situacion"] = 9
    assert client.post("/assessments", json=body, headers=HEADERS_A).status_code == 422


def test_aislamiento_entre_equipos(client):
    creado = client.post("/assessments", json=_body(), headers=HEADERS_A).json()
    # El equipo B no ve ni lista la evaluación del A.
    assert client.get(f"/assessments/{creado['id']}", headers=HEADERS_B).status_code == 404
    ids_b = [a["id"] for a in client.get("/assessments", headers=HEADERS_B).json()]
    assert creado["id"] not in ids_b
    # El A sí.
    assert client.get(f"/assessments/{creado['id']}", headers=HEADERS_A).status_code == 200
    ids_a = [a["id"] for a in client.get("/assessments", headers=HEADERS_A).json()]
    assert creado["id"] in ids_a


def test_cors_permite_solo_origen_configurado(client):
    ok = client.options(
        "/assessments",
        headers={
            "Origin": "https://foda-test.netlify.app",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "X-API-Key,Content-Type",
        },
    )
    assert ok.headers.get("access-control-allow-origin") == "https://foda-test.netlify.app"
    mal = client.options(
        "/assessments",
        headers={"Origin": "https://evil.example.com", "Access-Control-Request-Method": "POST"},
    )
    assert "access-control-allow-origin" not in mal.headers


# --- Fase 4b: upsert por id (PUT) y listado liviano ---------------------------

import uuid  # noqa: E402


def test_put_crea_y_luego_actualiza_sin_duplicar(client):
    aid = str(uuid.uuid4())
    r1 = client.put(f"/assessments/{aid}", json=_body(), headers=HEADERS_A)
    assert r1.status_code == 201 and r1.json()["id"] == aid
    cambiado = _body()
    cambiado["empresa"]["nombre"] = "Nombre corregido"
    r2 = client.put(f"/assessments/{aid}", json=cambiado, headers=HEADERS_A)
    assert r2.status_code == 200
    assert r2.json()["empresa"]["nombre"] == "Nombre corregido"
    assert r2.json()["metadata"]["creadoEn"] == r1.json()["metadata"]["creadoEn"]
    ids = [a["id"] for a in client.get("/assessments?limit=200", headers=HEADERS_A).json()]
    assert ids.count(aid) == 1


def test_put_recalcula_en_el_servidor(client):
    aid = str(uuid.uuid4())
    r = client.put(f"/assessments/{aid}", json=_body(), headers=HEADERS_A)
    assert r.json()["resultados"]["veredicto"] == GOLDEN["esperado"]["veredicto"]


def test_put_id_de_otro_equipo_da_409_y_no_lo_pisa(client):
    aid = str(uuid.uuid4())
    client.put(f"/assessments/{aid}", json=_body(), headers=HEADERS_A)
    r = client.put(f"/assessments/{aid}", json=_body(), headers=HEADERS_B)
    assert r.status_code == 409
    assert client.get(f"/assessments/{aid}", headers=HEADERS_A).json()["empresa"]["nombre"] == "Empresa Demo SA"


def test_put_id_invalido_da_422(client):
    assert client.put("/assessments/no-es-uuid", json=_body(), headers=HEADERS_A).status_code == 422


def test_put_sin_api_key_o_con_key_mala(client):
    aid = str(uuid.uuid4())
    assert client.put(f"/assessments/{aid}", json=_body(), headers={"X-API-Key": "x"}).status_code == 401


def test_resumen_es_liviano_ordenado_y_aislado_por_equipo(client):
    aid = str(uuid.uuid4())
    client.put(f"/assessments/{aid}", json=_body(), headers=HEADERS_A)
    filas = client.get("/assessments/resumen", headers=HEADERS_A).json()
    fila = next(f for f in filas if f["id"] == aid)
    assert fila["nombre"] == "Empresa Demo SA"
    assert fila["veredicto"] == GOLDEN["esperado"]["veredicto"]
    assert fila["cuadranteDominante"] == GOLDEN["esperado"]["matrizFoda"]["cuadranteDominante"]
    assert "respuestas" not in fila and "resultados" not in fila
    assert aid not in [f["id"] for f in client.get("/assessments/resumen", headers=HEADERS_B).json()]
    assert client.get("/assessments/resumen").status_code == 422


def test_cors_permite_put(client):
    r = client.options(
        "/assessments/x",
        headers={"Origin": "https://foda-test.netlify.app", "Access-Control-Request-Method": "PUT",
                 "Access-Control-Request-Headers": "X-API-Key,Content-Type"},
    )
    assert "PUT" in r.headers.get("access-control-allow-methods", "")
