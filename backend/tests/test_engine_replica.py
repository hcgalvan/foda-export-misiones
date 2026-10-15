"""
backend/tests/test_engine_replica.py — tests "golden" del motor Python.

Mismo propósito que tests/calc.golden.test.mjs (JS), pero contra
engine_replica.py: valida que la réplica Python usada server-side (para
recalcular antes de persistir, ver ARCHITECTURE.md §1) da EXACTAMENTE los
mismos resultados que el motor JS del cliente, ambos contra los valores
reales extraídos del Excel DEMO (tests/golden.demo.json, generado por
scripts/golden_extract.py -- no se edita a mano).

Corrida:
    cd backend
    python3 -m pytest tests/test_engine_replica.py -v

Tolerancia: 0.01 (igual que el test JS), salvo en semáforo/veredicto/
itemsRespondidos/alertas/cruces/cuadranteDominante que son valores discretos
(comparación exacta).
"""

from __future__ import annotations

import json
import math
from pathlib import Path

import pytest

from engine_replica import (
    Respuesta,
    calcular_area,
    calcular_assessment,
    calcular_item,
    calcular_matriz_foda,
    calcular_viabilidad,
    clasificar_factor,
    interpolar_puntos,
)

TOL = 0.01

# Las fuentes golden viven en el repo del frontend (Fase 2/3), no se
# duplican a mano -- se leen desde ahí para garantizar que backend y
# frontend comparan contra EL MISMO archivo.
# En el repo real, backend/ vive junto a frontend/ y tests/ en la raíz del
# proyecto (ver ARCHITECTURE.md §4.3), así que desde
# backend/tests/test_engine_replica.py la raíz del repo es parents[2].
RAIZ_REPO = Path(__file__).resolve().parents[2]
RAIZ_FRONTEND = RAIZ_REPO / "frontend"
RAIZ_TESTS_JS = RAIZ_REPO / "tests"


def _leer_json(ruta: Path) -> dict:
    with ruta.open("r", encoding="utf-8") as f:
        return json.load(f)


@pytest.fixture(scope="module")
def golden() -> dict:
    return _leer_json(RAIZ_TESTS_JS / "golden.demo.json")


@pytest.fixture(scope="module")
def questionnaire() -> dict:
    return _leer_json(RAIZ_FRONTEND / "src" / "data" / "questionnaire.json")


@pytest.fixture(scope="module")
def dependencias_foda() -> dict:
    return _leer_json(RAIZ_FRONTEND / "src" / "data" / "dependenciasFoda.json")


@pytest.fixture(scope="module")
def respuestas_golden(golden: dict) -> dict[str, Respuesta]:
    """golden['respuestas'] viene como {itemId: {situacion, impacto}} (dict
    plano, sin 'observacion') -- se convierte a Respuesta tal como lo
    recibiría el endpoint real desde el body de un POST."""
    return {
        item_id: Respuesta(situacion=r.get("situacion"), impacto=r.get("impacto"))
        for item_id, r in golden["respuestas"].items()
    }


def cerca(a: float, b: float, tol: float = TOL) -> bool:
    return math.isclose(a, b, abs_tol=tol)


# --- Tests unitarios de la tabla Rango (tramos conocidos) -------------------


def test_interpolar_puntos_tramos_de_rango():
    # El Excel real resta un épsilon de 0.001 antes de interpolar
    # (CalculosFoda!W = ABS(V)-0.001), así que un valor que cae justo en un
    # límite de tramo da p. ej. 0.9999 en vez de 1 -- se compara con
    # tolerancia, no con igualdad exacta, salvo en 0.
    assert interpolar_puntos(0) == 0
    assert cerca(interpolar_puntos(20), 1)
    assert cerca(interpolar_puntos(40), 3)
    assert cerca(interpolar_puntos(60), 5)
    assert cerca(interpolar_puntos(80), 7)
    assert cerca(interpolar_puntos(100), 10)


# --- Golden: puntaje por ítem (escenario DEMO) ------------------------------


def test_calcular_item_puntaje_coincide_con_calculosfoda_ad(
    golden: dict, respuestas_golden: dict[str, Respuesta]
):
    por_item_esperado = {i["itemId"]: i["puntos0a10"] for i in golden["esperado"]["porItem"]}
    comparados = 0
    for item_id, esperado in por_item_esperado.items():
        respuesta = respuestas_golden[item_id]
        resultado = calcular_item(respuesta)
        assert cerca(resultado["puntos0a10"], esperado), (
            f"{item_id}: engine_replica.py dio {resultado['puntos0a10']}, Excel dio {esperado}"
        )
        comparados += 1
    assert comparados == 110, "deben compararse los 110 ítems"


# --- Golden: puntaje/semáforo/alertas por área (escenario DEMO) ------------


def test_calcular_area_coincide_con_viabilidad(
    golden: dict, questionnaire: dict, respuestas_golden: dict[str, Respuesta]
):
    areas_por_id = {
        a["id"]: a for a in [*questionnaire["areasInternas"], *questionnaire["areasExternas"]]
    }
    comparadas = 0
    for esperado_area in golden["esperado"]["porArea"]:
        area = areas_por_id.get(esperado_area["areaId"])
        assert area is not None, f"área {esperado_area['areaId']} no está en questionnaire.json"
        respuestas = [respuestas_golden[it["id"]] for it in area["items"]]
        resultado = calcular_area(respuestas)

        assert cerca(resultado["puntaje"], esperado_area["puntaje"]), (
            f"{esperado_area['areaId']}: puntaje engine_replica.py="
            f"{resultado['puntaje']} Excel={esperado_area['puntaje']}"
        )
        assert resultado["semaforo"] == esperado_area["semaforo"], f"{esperado_area['areaId']}: semáforo"
        assert resultado["itemsRespondidos"] == esperado_area["itemsRespondidos"], (
            f"{esperado_area['areaId']}: itemsRespondidos"
        )
        assert resultado["itemsTotales"] == esperado_area["itemsTotales"], (
            f"{esperado_area['areaId']}: itemsTotales"
        )
        assert resultado["alertas"] == esperado_area["alertas"], f"{esperado_area['areaId']}: alertas"
        comparadas += 1
    assert comparadas == 19, "deben compararse las 19 áreas"


# --- Golden: índices globales y veredicto (escenario DEMO) -----------------


def test_calcular_viabilidad_indices_y_veredicto(
    golden: dict, questionnaire: dict, respuestas_golden: dict[str, Respuesta]
):
    areas_por_id = {
        a["id"]: a for a in [*questionnaire["areasInternas"], *questionnaire["areasExternas"]]
    }

    def calcular_area_por_id(area_id: str) -> dict:
        area = areas_por_id[area_id]
        respuestas = [respuestas_golden[it["id"]] for it in area["items"]]
        return calcular_area(respuestas)

    areas_internas = [calcular_area_por_id(a["id"]) for a in questionnaire["areasInternas"]]
    areas_externas = [calcular_area_por_id(a["id"]) for a in questionnaire["areasExternas"]]

    resultado = calcular_viabilidad(areas_internas, areas_externas)

    assert cerca(resultado["indiceInterno"], golden["esperado"]["indiceInterno"]), (
        f"índice interno: engine_replica.py={resultado['indiceInterno']} "
        f"Excel={golden['esperado']['indiceInterno']}"
    )
    assert cerca(resultado["indiceExterno"], golden["esperado"]["indiceExterno"]), (
        f"índice externo: engine_replica.py={resultado['indiceExterno']} "
        f"Excel={golden['esperado']['indiceExterno']}"
    )
    assert resultado["veredicto"] == golden["esperado"]["veredicto"], "veredicto"


# --- Golden: calcular_assessment end-to-end (questionnaire.json completo) --


def test_calcular_assessment_end_to_end(
    golden: dict, questionnaire: dict, respuestas_golden: dict[str, Respuesta]
):
    resultado = calcular_assessment(questionnaire, respuestas_golden)

    assert cerca(resultado["indiceInterno"], golden["esperado"]["indiceInterno"]), "indiceInterno end-to-end"
    assert cerca(resultado["indiceExterno"], golden["esperado"]["indiceExterno"]), "indiceExterno end-to-end"
    assert resultado["veredicto"] == golden["esperado"]["veredicto"], "veredicto end-to-end"
    assert len(resultado["porItem"]) == 110, "porItem debe tener 110 entradas"
    assert len(resultado["porArea"]) == 19, "porArea debe tener 19 entradas"


def test_calcular_assessment_end_to_end_con_matriz_foda(
    golden: dict,
    questionnaire: dict,
    respuestas_golden: dict[str, Respuesta],
    dependencias_foda: dict,
):
    resultado = calcular_assessment(
        questionnaire, respuestas_golden, dependencias_foda=dependencias_foda
    )
    esperado = golden["esperado"]["matrizFoda"]
    assert "matrizFoda" in resultado, "calcular_assessment debe incluir matrizFoda cuando se pasa dependenciasFoda"
    assert resultado["matrizFoda"]["cruces"]["FO"] == esperado["cruces"]["FO"]
    assert resultado["matrizFoda"]["cruces"]["FA"] == esperado["cruces"]["FA"]
    assert resultado["matrizFoda"]["cruces"]["DO"] == esperado["cruces"]["DO"]
    assert resultado["matrizFoda"]["cruces"]["DA"] == esperado["cruces"]["DA"]
    assert resultado["matrizFoda"]["cuadranteDominante"] == esperado["cuadranteDominante"]


# --- Escenarios sintéticos (sin depender del Excel): casos borde -----------


def test_sintetico_item_no_respondido_da_cero():
    r = calcular_item(Respuesta(situacion=None, impacto=None))
    assert r["puntos0a10"] == 0
    assert r["respondido"] is False


def test_sintetico_area_sin_respuestas_da_sin_datos():
    r = calcular_area([Respuesta(situacion=None, impacto=None), Respuesta(situacion=None, impacto=None)])
    assert r["puntaje"] == 0
    assert r["semaforo"] == "sin datos"
    assert r["itemsRespondidos"] == 0


def test_sintetico_todas_muy_favorable_da_puntaje_10_bueno():
    # Situación máxima (Muy Favorable, índice 4) -> 100% de logro ->
    # interpolar_puntos(100) = 10. Con peso de impacto uniforme, el promedio
    # ponderado del área también da 10.
    items = [Respuesta(situacion=4, impacto=3) for _ in range(5)]
    r = calcular_area(items)
    assert cerca(r["puntaje"], 10)
    assert r["semaforo"] == "Bueno"  # semaforo_de: >10 Excelencia, 10 cae en >=8 => "Bueno"


def test_sintetico_no_corresponde_da_puntaje_bajo_no_cero():
    # "No corresp." tiene peso 1 (no 0) en el Excel real -- rareza
    # documentada del instrumento original (ARCHITECTURE.md), se reproduce
    # tal cual, no se "corrige" en silencio.
    items = [Respuesta(situacion=0, impacto=3) for _ in range(5)]
    r = calcular_area(items)
    assert cerca(r["puntaje"], 1)  # 20% de logro -> interpolar_puntos(20) = 1
    assert r["semaforo"] == "Alarmante"
    assert r["alertas"] == 5  # los 5 ítems están respondidos con puntaje < 5


def test_sintetico_indices_en_cero_da_datos_incompletos():
    sin_datos = {"puntaje": 0}
    con_datos = {"puntaje": 8}
    r = calcular_viabilidad([sin_datos], [con_datos])
    assert r["veredicto"] == "DATOS_INCOMPLETOS"


# --- Golden: matriz FODA (cuadrante dominante) — escenario DEMO -----------
#
# Hallazgo de Fase 3: el cuadrante dominante SÍ es automático (no requiere
# carga cualitativa manual) — ver ARCHITECTURE.md §5. Se valida acá contra
# 'MATRIZ FODA'!C15:F15 y VIABILIDAD!C53 del DEMO, igual que el test JS.


def test_clasificar_factor():
    assert clasificar_factor(3) == "positivo"
    assert clasificar_factor(4) == "positivo"
    assert clasificar_factor(1) == "negativo"
    assert clasificar_factor(2) == "negativo"
    assert clasificar_factor(0) is None
    assert clasificar_factor(None) is None


def test_calcular_matriz_foda_coincide_con_matriz_foda_demo(
    golden: dict, respuestas_golden: dict[str, Respuesta], dependencias_foda: dict
):
    resultado = calcular_matriz_foda(respuestas_golden, dependencias_foda)
    esperado = golden["esperado"]["matrizFoda"]
    assert esperado, "el golden debe traer matrizFoda"
    assert resultado["cruces"]["FO"] == esperado["cruces"]["FO"], "cruces FO"
    assert resultado["cruces"]["FA"] == esperado["cruces"]["FA"], "cruces FA"
    assert resultado["cruces"]["DO"] == esperado["cruces"]["DO"], "cruces DO"
    assert resultado["cruces"]["DA"] == esperado["cruces"]["DA"], "cruces DA"
    assert resultado["cuadranteDominante"] == esperado["cuadranteDominante"], "cuadrante dominante"


def test_sintetico_sin_cruces_da_cuadrante_dominante_none():
    dependencias = {"IA1": ["EA1"]}
    respuestas = {"IA1": Respuesta(situacion=0), "EA1": Respuesta(situacion=0)}
    r = calcular_matriz_foda(respuestas, dependencias)
    assert r["totalCruces"] == 0
    assert r["cuadranteDominante"] is None
    assert r["sinConsiderar"] == 1


def test_sintetico_fortaleza_oportunidad_da_cruce_fo_ofensiva():
    dependencias = {"IA1": ["EA1"]}
    respuestas = {"IA1": Respuesta(situacion=4), "EA1": Respuesta(situacion=3)}  # Muy Fav. / Fav.
    r = calcular_matriz_foda(respuestas, dependencias)
    assert r["cruces"]["FO"] == 1
    assert r["totalCruces"] == 1
    assert r["cuadranteDominante"] == "FO"
    assert "Ofensiva" in r["orientacionEstrategica"]
