"""
backend/cuestionario.py — carga (una sola vez, al arrancar) de
questionnaire.json y dependenciasFoda.json para poder recalcular cada
evaluación server-side con engine_replica.py.

Deliberadamente NO se duplican esos dos archivos acá: se leen del
frontend (rutas en config.py) porque backend/ y frontend/ viven en el
mismo repo como hermanos (ARCHITECTURE.md §4.3) y son, por diseño, la
MISMA fuente de verdad que usa el motor JS del cliente -- duplicarlos a
mano es exactamente el tipo de drift que los tests golden (ambos
motores, mismo tests/golden.demo.json) existen para evitar.
"""

from __future__ import annotations

import json
from functools import lru_cache

from config import DEPENDENCIAS_PATH, QUESTIONNAIRE_PATH
from engine_replica import Respuesta
from schemas import RespuestaIn


@lru_cache(maxsize=1)
def questionnaire() -> dict:
    with QUESTIONNAIRE_PATH.open("r", encoding="utf-8") as f:
        return json.load(f)


@lru_cache(maxsize=1)
def dependencias_foda() -> dict:
    with DEPENDENCIAS_PATH.open("r", encoding="utf-8") as f:
        return json.load(f)


def version_cuestionario_actual() -> str:
    return questionnaire().get("version", "desconocida")


def respuestas_a_mapa(respuestas: list[RespuestaIn]) -> dict[str, Respuesta]:
    """Convierte la lista plana que manda el frontend (misma forma que
    assessment.schema.json -> respuestas[]) al mapa {itemId: Respuesta}
    que espera engine_replica.calcular_assessment."""
    return {
        r.itemId: Respuesta(situacion=r.situacion, impacto=r.impacto, observacion=r.observacion)
        for r in respuestas
    }
