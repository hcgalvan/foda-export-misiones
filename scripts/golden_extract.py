#!/usr/bin/env python3
"""
golden_extract.py — FODA Export Misiones (Fase 2)

Extrae, directamente del Excel (valores cacheados, openpyxl data_only=True,
sin recalcular nada), los datos "golden" para validar el motor de cálculo:

- Las respuestas de situación/impacto marcadas en FormularioFODA (columnas
  D-H y J-M), por ítem.
- El puntaje esperado por ítem (CalculosFoda!AD).
- El puntaje/semáforo/ítems respondidos/alertas esperados por área
  (VIABILIDAD!C..F, filas 15-24 internas y 29-37 externas).
- El índice interno/externo y el veredicto de viabilidad esperados
  (VIABILIDAD!C25/C38/C44).

El resultado (golden.json) es lo que tests/calc.golden.test.mjs usa como
"verdad" contra la que compara frontend/src/engine/calc.js, con tolerancia
≤ 0.01 (ver ARCHITECTURE.md §5 y el plan de Fase 2 del proyecto).

Por qué los números de fila de VIABILIDAD están hardcodeados (AREA_VIABILIDAD_ROW)
en vez de derivarse dinámicamente: la estructura de filas de VIABILIDAD es fija
para este instrumento (19 áreas en las mismas 19 filas, siempre) — no depende
de las respuestas de una evaluación particular, a diferencia de FormularioFODA/
GUIA_ENTREVISTA que si varían ítem por ítem y por eso sí se leen dinámicamente
en xlsx_to_json.py. Si la estructura de VIABILIDAD cambia alguna vez, este
mapeo hay que actualizarlo a mano (se verificó una vez, visualmente, contra
el DEMO — ver ARCHITECTURE.md §5).

Uso:
    python3 scripts/golden_extract.py \
        --excel docs/referencia/FODA_Export_Misiones_2026_DEMO.xlsx \
        --out tests/golden.demo.json

Requisitos: openpyxl
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

try:
    import openpyxl
except ImportError:
    sys.exit("Falta openpyxl. Instalá con:\n  pip install openpyxl --break-system-packages")

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_EXCEL = REPO_ROOT / "docs" / "referencia" / "FODA_Export_Misiones_2026_DEMO.xlsx"
DEFAULT_OUT = REPO_ROOT / "tests" / "golden.demo.json"

SHEET_FORMULARIO = "FormularioFODA"
SHEET_GUIA = "GUIA_ENTREVISTA"
SHEET_CALCULOS = "CalculosFoda"
SHEET_VIABILIDAD = "VIABILIDAD"

# FormularioFODA: columnas de marca 'x' de Situación (D..H) e Impacto (J..M),
# en el mismo orden que questionnaire.json -> escalas.situacion / escalas.impacto.
SITUACION_MARK_COLS = [4, 5, 6, 7, 8]      # D, E, F, G, H
IMPACTO_MARK_COLS = [10, 11, 12, 13]        # J, K, L, M

# VIABILIDAD: fila por área (verificado visualmente contra el DEMO, ver docstring).
AREA_VIABILIDAD_ROW = {
    "IA": 15, "IB": 16, "IC": 17, "ID": 18, "IE": 19,
    "IF": 20, "IG": 21, "IH": 22, "II": 23, "IJ": 24,
    "EA": 29, "EB": 30, "EC": 31, "ED": 32, "EE": 33,
    "EF": 34, "EG": 35, "EH": 36, "EI": 37,
}
VIABILIDAD_INDICE_INTERNO_ROW = 25
VIABILIDAD_INDICE_EXTERNO_ROW = 38
VIABILIDAD_VEREDICTO_ROW = 44

VEREDICTO_MAP = [
    ("Datos incompletos", "DATOS_INCOMPLETOS"),
    ("VIABLE CON CONDICIONES", "VIABLE_CON_CONDICIONES"),
    ("EMPRESA NO LISTA", "EMPRESA_NO_LISTA"),
    ("ENTORNO", "ENTORNO_DESFAVORABLE"),
    ("NO VIABLE", "NO_VIABLE"),
    ("VIABLE", "VIABLE"),  # debe ir al final: es substring de los otros 2 "VIABLE..."
]


def read_guia_rows(ws) -> list[dict]:
    filas = []
    r = 5
    while r <= ws.max_row:
        codigo = ws.cell(row=r, column=2).value
        if codigo is None:
            r += 1
            if ws.cell(row=r, column=2).value is None and ws.cell(row=r + 1, column=2).value is None:
                break
            continue
        filas.append({"codigo": str(codigo).strip(), "filaFormulario": ws.cell(row=r, column=7).value})
        r += 1
    return filas


def leer_respuesta(ws_form, fila: int) -> dict:
    situacion = None
    for idx, col in enumerate(SITUACION_MARK_COLS):
        if str(ws_form.cell(row=fila, column=col).value or "").strip().lower() == "x":
            situacion = idx
            break
    impacto = None
    for idx, col in enumerate(IMPACTO_MARK_COLS):
        if str(ws_form.cell(row=fila, column=col).value or "").strip().lower() == "x":
            impacto = idx
            break
    return {"situacion": situacion, "impacto": impacto}


def mapear_veredicto(texto: str) -> str:
    for clave, codigo in VEREDICTO_MAP:
        if clave in texto:
            return codigo
    return f"DESCONOCIDO: {texto!r}"


def extraer(excel_path: Path) -> dict:
    wb = openpyxl.load_workbook(excel_path, data_only=True)
    for sheet in (SHEET_FORMULARIO, SHEET_GUIA, SHEET_CALCULOS, SHEET_VIABILIDAD):
        if sheet not in wb.sheetnames:
            sys.exit(f"Falta la hoja {sheet!r} en {excel_path}")

    ws_form = wb[SHEET_FORMULARIO]
    ws_guia = wb[SHEET_GUIA]
    ws_calc = wb[SHEET_CALCULOS]
    ws_via = wb[SHEET_VIABILIDAD]

    guia_rows = read_guia_rows(ws_guia)
    if len(guia_rows) != 110:
        sys.exit(f"Se esperaban 110 filas en GUIA_ENTREVISTA, se encontraron {len(guia_rows)}.")

    # Código -> fila en CalculosFoda (columna C tiene el código, ej. IA1).
    calc_code_row = {}
    for r in range(3, 300):
        code = ws_calc.cell(row=r, column=3).value
        if code:
            calc_code_row[str(code).strip()] = r

    respuestas = {}
    por_item = []
    items_por_area: dict[str, list[str]] = {}
    warnings = []

    for row in guia_rows:
        codigo = row["codigo"]
        fila = row["filaFormulario"]
        area_id = re.match(r"^[A-Z]+", codigo).group(0)
        items_por_area.setdefault(area_id, []).append(codigo)

        respuesta = leer_respuesta(ws_form, fila)
        respuestas[codigo] = respuesta

        r_calc = calc_code_row.get(codigo)
        if r_calc is None:
            warnings.append(f"{codigo}: no se encontró en CalculosFoda!C — se omite del golden de ítems.")
            continue
        puntos_esperado = ws_calc.cell(row=r_calc, column=30).value  # AD
        por_item.append({"itemId": codigo, "puntos0a10": puntos_esperado})

    por_area = []
    for area_id, fila_via in AREA_VIABILIDAD_ROW.items():
        puntaje = ws_via.cell(row=fila_via, column=3).value  # C
        semaforo = ws_via.cell(row=fila_via, column=4).value  # D
        alertas = ws_via.cell(row=fila_via, column=6).value  # F
        items_evaluados_txt = ws_via.cell(row=fila_via, column=5).value or ""  # E, ej. "5 de 5"
        m = re.match(r"(\d+)\s+de\s+(\d+)", str(items_evaluados_txt))
        items_respondidos = int(m.group(1)) if m else None
        items_totales = int(m.group(2)) if m else len(items_por_area.get(area_id, []))
        if items_totales != len(items_por_area.get(area_id, [])):
            warnings.append(
                f"{area_id}: VIABILIDAD dice {items_totales} ítems totales, "
                f"GUIA_ENTREVISTA tiene {len(items_por_area.get(area_id, []))}."
            )
        por_area.append(
            {
                "areaId": area_id,
                "puntaje": puntaje,
                "semaforo": semaforo,
                "itemsRespondidos": items_respondidos,
                "itemsTotales": items_totales,
                "alertas": alertas,
            }
        )

    indice_interno = ws_via.cell(row=VIABILIDAD_INDICE_INTERNO_ROW, column=3).value
    indice_externo = ws_via.cell(row=VIABILIDAD_INDICE_EXTERNO_ROW, column=3).value
    veredicto_texto = ws_via.cell(row=VIABILIDAD_VEREDICTO_ROW, column=3).value
    veredicto = mapear_veredicto(str(veredicto_texto))

    golden = {
        "fuente": excel_path.name,
        "respuestas": respuestas,
        "esperado": {
            "porItem": por_item,
            "porArea": por_area,
            "indiceInterno": indice_interno,
            "indiceExterno": indice_externo,
            "veredicto": veredicto,
        },
    }
    return golden, warnings


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--excel", type=Path, default=DEFAULT_EXCEL)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    args = parser.parse_args()

    if not args.excel.exists():
        sys.exit(f"No se encontró el Excel en {args.excel}")

    golden, warnings = extraer(args.excel)

    args.out.parent.mkdir(parents=True, exist_ok=True)
    with args.out.open("w", encoding="utf-8") as f:
        json.dump(golden, f, ensure_ascii=False, indent=2)

    print(f"OK: {args.out} generado desde {args.excel.name}.")
    print(f"  Ítems con golden: {len(golden['esperado']['porItem'])} (esperado: 110)")
    print(f"  Áreas con golden: {len(golden['esperado']['porArea'])} (esperado: 19)")
    print(f"  Índice interno: {golden['esperado']['indiceInterno']} | externo: {golden['esperado']['indiceExterno']}")
    print(f"  Veredicto: {golden['esperado']['veredicto']}")
    if warnings:
        print(f"\nAdvertencias ({len(warnings)}):")
        for w in warnings:
            print(f"  - {w}")
        sys.exit(1)


if __name__ == "__main__":
    main()
