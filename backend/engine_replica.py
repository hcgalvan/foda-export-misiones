"""
backend/engine_replica.py — réplica Python del motor de cálculo

Puerto 1:1 de frontend/src/engine/calc.js (Fase 2/3, ya validado contra
tests golden del Excel DEMO). Se usa server-side para RECALCULAR cada
evaluación antes de persistirla en SQLite (ver ARCHITECTURE.md §1: "la API
recalcula con una réplica Python antes de persistir", como control de
integridad -- el dato guardado no depende de que el JS del cliente no haya
sido alterado).

Cualquier cambio en calc.js tiene que reflejarse acá también. Los mismos
tests golden (tests/golden.demo.json) validan ambos motores -- ver
backend/tests/test_engine_replica.py.

No se "mejora" ni se "prolija" nada acá que no esté también en calc.js --
incluye el mismo épsilon de interpolación, el mismo criterio de alertas,
etc. Ver ARCHITECTURE.md §5 para el detalle de cada fórmula.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional


# Tabla "Rango" del Excel: interpolación de pendiente discontinua, % de logro -> puntos.
RANGO = [
    {"desde": 0, "hasta": 0, "pts": 0},
    {"desde": 0, "hasta": 20, "pts": 1},
    {"desde": 21, "hasta": 40, "pts": 3},
    {"desde": 41, "hasta": 60, "pts": 5},
    {"desde": 61, "hasta": 80, "pts": 7},
    {"desde": 81, "hasta": 100, "pts": 10},
    {"desde": 101, "hasta": 120, "pts": 13},
    {"desde": 121, "hasta": 140, "pts": 16},
    {"desde": 141, "hasta": 200, "pts": 17},
]

META = 5  # CalculosFoda!S: constante, igual al peso máximo de Situación

# índice 0..4: No corresp., Muy Desfav., Desfav., Fav., Muy Fav. (CalculosFoda!E2:I2)
PESO_SITUACION = [1, 2, 3, 4, 5]
# índice 0..3: Muy insignif., Insignif., Significante, Muy Signif. (CalculosFoda!K2:N2)
PESO_IMPACTO = [1, 2, 3, 4]

UMBRALES_DEFAULT = {"viable": 7, "viableConCondiciones": 5}

# CalculoFoda-1!S2:V2 -- signo por opción de situación (ver ARCHITECTURE.md §5,
# hallazgo de Fase 3: existe un signo real, pero en la ruta de la matriz FODA,
# no en la de VIABILIDAD).
SIGNO_SITUACION = [0, -1, -0.5, 0.5, 1]

ORIENTACION_POR_CUADRANTE = {
    "FO": "Ofensiva: usar las fortalezas para aprovechar las oportunidades del mercado.",
    "FA": "Defensiva: usar las fortalezas para neutralizar amenazas del entorno.",
    "DO": "Reorientación: superar debilidades para capturar oportunidades.",
    "DA": "Supervivencia: reducir debilidades y evitar amenazas; no exportar aún.",
}


@dataclass
class Respuesta:
    situacion: Optional[int] = None  # 0..4
    impacto: Optional[int] = None  # 0..3
    observacion: str = ""


def interpolar_puntos(pct_logro: float) -> float:
    """
    Replica CalculosFoda!AB, interpolando sobre W = CalculosFoda!W = ABS(V)-0.001
    (ver ARCHITECTURE.md §5: épsilon deliberado para evitar ambigüedad de
    MATCH/VLOOKUP exactamente en los límites de cada tramo de Rango).
    """
    if pct_logro == 0:
        return 0
    w = abs(pct_logro) - 0.001
    i = next((idx for idx, r in enumerate(RANGO) if w <= r["hasta"]), len(RANGO) - 1)
    sup = RANGO[i]
    inf = RANGO[max(0, i - 1)]
    if sup["hasta"] == inf["hasta"]:
        return sup["pts"]
    frac = (w - inf["hasta"]) / (sup["hasta"] - inf["hasta"])
    return inf["pts"] + frac * (sup["pts"] - inf["pts"])


def calcular_item(r: Optional[Respuesta]) -> dict:
    """
    Replica CalculosFoda!J (situación bruta), V (% de logro), AB (Puntos),
    AC (respondido: 1/0 -- NO es un signo) y AD (Pts = Puntos x respondido).
    """
    if r is None or r.situacion is None or r.impacto is None:
        return {"puntos0a10": 0, "respondido": False, "impactoIdx": None}
    situacion_bruta = PESO_SITUACION[r.situacion]  # J
    pct_logro = (situacion_bruta / META) * 100  # V
    puntos = interpolar_puntos(pct_logro)  # AB
    respondido = situacion_bruta > 0  # AC (1/0, no es un signo)
    return {
        "puntos0a10": puntos if respondido else 0,  # AD
        "respondido": respondido,
        "impactoIdx": r.impacto,
    }


def calcular_area(items_del_area: list[Optional[Respuesta]]) -> dict:
    """
    Replica CalculosFoda!O (impacto bruto), P (peso relativo del impacto
    dentro del área) y AE (Valor Pond), sumados = VIABILIDAD!C15..C37.
    """
    calculados = [calcular_item(r) for r in items_del_area]
    respondidos = [c for c in calculados if c["respondido"]]

    if not respondidos:
        return {
            "puntaje": 0,
            "itemsRespondidos": 0,
            "itemsTotales": len(items_del_area),
            "alertas": 0,
            "semaforo": semaforo_de(0),
        }

    impactos_brutos = [PESO_IMPACTO[c["impactoIdx"]] for c in respondidos]
    suma_impactos = sum(impactos_brutos)

    puntaje_area = 0.0
    for c, impacto_bruto in zip(respondidos, impactos_brutos):
        peso_relativo = 0 if suma_impactos == 0 else impacto_bruto / suma_impactos  # P
        puntaje_area += c["puntos0a10"] * peso_relativo  # AE, sumado

    # VIABILIDAD!F15..F37: COUNTIFS(AD,"<5",AD,">0") -- ítem respondido con puntaje bajo.
    alertas = sum(1 for c in respondidos if 0 < c["puntos0a10"] < 5)

    return {
        "puntaje": round(puntaje_area, 2),
        "itemsRespondidos": len(respondidos),
        "itemsTotales": len(items_del_area),
        "alertas": alertas,
        "semaforo": semaforo_de(puntaje_area),
    }


def semaforo_de(puntaje: float) -> str:
    """Replica VIABILIDAD!D15..D37 (y C25/C38): semáforo por puntaje de área."""
    if puntaje == 0:
        return "sin datos"
    if puntaje > 10:
        return "Excelencia"
    if puntaje >= 8:
        return "Bueno"
    if puntaje >= 5:
        return "Regular"
    return "Alarmante"


def calcular_viabilidad(
    areas_internas: list[dict], areas_externas: list[dict], umbrales: dict = UMBRALES_DEFAULT
) -> dict:
    """Replica VIABILIDAD!C25/C38 (AVERAGEIF) y C44 (regla de 5 ramas)."""

    def promedio(areas: list[dict]) -> float:
        con_datos = [a for a in areas if a["puntaje"] > 0]
        if not con_datos:
            return 0
        return sum(a["puntaje"] for a in con_datos) / len(con_datos)

    indice_interno = promedio(areas_internas)
    indice_externo = promedio(areas_externas)

    if indice_interno == 0 or indice_externo == 0:
        veredicto = "DATOS_INCOMPLETOS"
    elif indice_interno >= umbrales["viable"] and indice_externo >= umbrales["viable"]:
        veredicto = "VIABLE"
    elif (
        indice_interno >= umbrales["viableConCondiciones"]
        and indice_externo >= umbrales["viableConCondiciones"]
    ):
        veredicto = "VIABLE_CON_CONDICIONES"
    elif (
        indice_interno < umbrales["viableConCondiciones"]
        and indice_externo >= umbrales["viableConCondiciones"]
    ):
        veredicto = "EMPRESA_NO_LISTA"
    elif (
        indice_interno >= umbrales["viableConCondiciones"]
        and indice_externo < umbrales["viableConCondiciones"]
    ):
        veredicto = "ENTORNO_DESFAVORABLE"
    else:
        veredicto = "NO_VIABLE"

    return {
        "indiceInterno": round(indice_interno, 2),
        "indiceExterno": round(indice_externo, 2),
        "veredicto": veredicto,
    }


def clasificar_factor(situacion_idx: Optional[int]) -> Optional[str]:
    """
    Clasifica un factor (interno o externo) según su respuesta de situación.
    Favorable/Muy Favorable -> 'positivo' (Fortaleza/Oportunidad);
    Muy Desfavorable/Desfavorable -> 'negativo' (Debilidad/Amenaza);
    "No corresponde" o sin responder -> None (no participa del cruce).
    """
    if situacion_idx in (3, 4):
        return "positivo"
    if situacion_idx in (1, 2):
        return "negativo"
    return None


def calcular_matriz_foda(
    respuestas_por_item: dict[str, Respuesta], dependencias_foda: dict[str, list[str]]
) -> dict:
    """
    Calcula la matriz FODA (cruces FO/FA/DO/DA), el cuadrante dominante y los
    datos del gráfico de burbujas. Replica MATRIZ FODA!C15:F16, VIABILIDAD!B53
    y las posiciones fijas del gráfico de burbujas (MATRIZ FODA!C24:E27). Ver
    ARCHITECTURE.md §5 para el hallazgo completo (Fase 3): es 100% automático,
    a partir de la tabla fija `dependencias_foda` (de VariablesFoda) y las
    mismas respuestas de situación de los 110 ítems.
    """

    def situacion_de(item_id: str) -> Optional[int]:
        r = respuestas_por_item.get(item_id)
        return r.situacion if r else None

    conteo = {"FO": 0, "FA": 0, "DO": 0, "DA": 0}
    sin_considerar = 0

    for id_interno, externos in dependencias_foda.items():
        clasif_interno = clasificar_factor(situacion_de(id_interno))
        for id_externo in externos:
            clasif_externo = clasificar_factor(situacion_de(id_externo))
            if clasif_interno == "positivo" and clasif_externo == "positivo":
                conteo["FO"] += 1
            elif clasif_interno == "positivo" and clasif_externo == "negativo":
                conteo["FA"] += 1
            elif clasif_interno == "negativo" and clasif_externo == "positivo":
                conteo["DO"] += 1
            elif clasif_interno == "negativo" and clasif_externo == "negativo":
                conteo["DA"] += 1
            else:
                sin_considerar += 1

    total_cruces = sum(conteo.values())
    porcentajes = {
        k: (0 if total_cruces == 0 else v / total_cruces) for k, v in conteo.items()
    }

    cuadrante_dominante = None
    if total_cruces > 0:
        cuadrante_dominante = max(conteo, key=lambda k: conteo[k])

    burbujas = [
        {"cuadrante": "FO", "x": 4, "y": 6, "tamano": porcentajes["FO"]},
        {"cuadrante": "FA", "x": 8, "y": 6, "tamano": porcentajes["FA"]},
        {"cuadrante": "DO", "x": 4, "y": 2, "tamano": porcentajes["DO"]},
        {"cuadrante": "DA", "x": 8, "y": 2, "tamano": porcentajes["DA"]},
    ]

    return {
        "cruces": conteo,
        "sinConsiderar": sin_considerar,
        "totalCruces": total_cruces,
        "porcentajes": porcentajes,
        "cuadranteDominante": cuadrante_dominante,
        "orientacionEstrategica": (
            ORIENTACION_POR_CUADRANTE[cuadrante_dominante] if cuadrante_dominante else None
        ),
        "burbujas": burbujas,
    }


def calcular_assessment(
    questionnaire: dict,
    respuestas_por_item: dict[str, Respuesta],
    umbrales: dict = UMBRALES_DEFAULT,
    dependencias_foda: Optional[dict[str, list[str]]] = None,
) -> dict:
    """
    Calcula un assessment completo a partir del cuestionario (questionnaire.json,
    tal como se lee en el servidor) y un mapa de respuestas { itemId: Respuesta }.
    """

    def calcular_areas(areas: list[dict]) -> list[dict]:
        resultado = []
        for area in areas:
            respuestas_area = [
                respuestas_por_item.get(it["id"], Respuesta()) for it in area["items"]
            ]
            r = calcular_area(respuestas_area)
            resultado.append({"areaId": area["id"], "ambito": area["tipo"], **r})
        return resultado

    por_area_interno = calcular_areas(questionnaire["areasInternas"])
    por_area_externo = calcular_areas(questionnaire["areasExternas"])

    por_item = []
    for area in [*questionnaire["areasInternas"], *questionnaire["areasExternas"]]:
        for it in area["items"]:
            r = respuestas_por_item.get(it["id"], Respuesta())
            c = calcular_item(r)
            por_item.append({"itemId": it["id"], "puntos0a10": c["puntos0a10"]})

    viabilidad = calcular_viabilidad(por_area_interno, por_area_externo, umbrales)

    resultado = {
        "porItem": por_item,
        "porArea": [*por_area_interno, *por_area_externo],
        **viabilidad,
    }

    if dependencias_foda:
        resultado["matrizFoda"] = calcular_matriz_foda(respuestas_por_item, dependencias_foda)

    return resultado
