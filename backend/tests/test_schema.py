"""
backend/tests/test_schema.py — la salida REAL del motor Python (y lo que
devuelve la API) tiene que validar contra data/schema/assessment.schema.json.
Evita que schema y motor vuelvan a divergir (ARCHITECTURE.md §7).
Requiere `pip install jsonschema` (solo para tests; se omite si falta).
"""
import json
from pathlib import Path

import pytest

jsonschema = pytest.importorskip("jsonschema")

from engine_replica import Respuesta, calcular_assessment  # noqa: E402

RAIZ = Path(__file__).resolve().parents[2]
SCHEMA = json.loads((RAIZ / "data" / "schema" / "assessment.schema.json").read_text(encoding="utf-8"))
Q = json.loads((RAIZ / "frontend" / "src" / "data" / "questionnaire.json").read_text(encoding="utf-8"))
DEP = json.loads((RAIZ / "frontend" / "src" / "data" / "dependenciasFoda.json").read_text(encoding="utf-8"))
GOLDEN = json.loads((RAIZ / "tests" / "golden.demo.json").read_text(encoding="utf-8"))


def _doc(resultados, respuestas):
    return {
        "id": "0e2ceb97-46b2-4704-b439-2d1257b0b042",
        "empresa": {"nombre": "E", "rubro": "R", "perfil": "exporta_actualmente", "fecha": "2026-10-14",
                    "mercadosObjetivo": [], "autorizaRecontacto": False},
        "respuestas": respuestas,
        "resultados": resultados,
        "metadata": {"versionMotor": "1.0.0-fase4", "versionCuestionario": "1.1.0",
                     "creadoEn": "2026-10-14T10:00:00Z"},
    }


def _validar(doc):
    return list(jsonschema.Draft202012Validator(SCHEMA).iter_errors(doc))


def test_schema_es_valido():
    jsonschema.Draft202012Validator.check_schema(SCHEMA)


@pytest.mark.parametrize("caso", ["demo", "vacio", "no_corresponde"])
def test_salida_del_motor_valida_contra_el_schema(caso):
    if caso == "demo":
        rs = {k: Respuesta(v["situacion"], v["impacto"]) for k, v in GOLDEN["respuestas"].items()}
    elif caso == "no_corresponde":
        rs = {k: Respuesta(0, 0) for k in GOLDEN["respuestas"]}
    else:
        rs = {}
    res = calcular_assessment(Q, rs, dependencias_foda=DEP)
    resp = [{"itemId": k, "situacion": r.situacion, "impacto": r.impacto, "observacion": ""} for k, r in rs.items()]
    assert _validar(_doc(res, resp)) == []


def test_forma_plana_vieja_ya_no_valida():
    rs = {k: Respuesta(v["situacion"], v["impacto"]) for k, v in GOLDEN["respuestas"].items()}
    res = calcular_assessment(Q, rs, dependencias_foda=DEP)
    res["cuadranteDominante"] = "DA"
    assert _validar(_doc(res, [])) != []
