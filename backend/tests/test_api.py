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
