#!/usr/bin/env python3
"""
xlsx_to_json.py — FODA Export Misiones (Fase 1)

Lee las hojas `FormularioFODA` y `GUIA_ENTREVISTA` del Excel original
(`FODA_Export_Misiones_2026_DEMO.xlsx` o el equivalente en blanco) y genera
`frontend/src/data/questionnaire.json`, siguiendo el esquema documentado en
`ARCHITECTURE.md §4.1` (data/schema/questionnaire.schema.json).

Por qué estas dos hojas y no solo una:
- `FormularioFODA` tiene el texto completo de cada ítem (título + criterio
  de "favorable") en la columna B, con el formato "N - Título. Se considera
  favorable si <criterio>." pero NO tiene el código corto (IA1, EB3, etc.)
  ni los campos de entrevista.
- `GUIA_ENTREVISTA` SÍ tiene el código corto, el área, la pregunta de
  entrevista, la evidencia sugerida, quién responde, la lectura para
  empresas que no exportan, y —clave— la columna "Fila en FormularioFODA"
  que enlaza cada código con su fila exacta en la otra hoja. Por eso
  `GUIA_ENTREVISTA` es la fuente de verdad para los códigos y el agrupamiento
  por área, y `FormularioFODA` aporta el texto largo del ítem.

Decisiones documentadas (no se resuelven "por prolijidad", quedan explícitas):

1. La clasificación de marco (PESTEL / 5 fuerzas de Porter para las áreas
   externas; bloque(s) del Canvas de Osterwalder para las internas) NO está
   en ninguna columna del Excel — el autor la hizo a mano, ítem por ítem
   (`docs/clasificacion/mapeo_PESTEL_Porter_externos.csv` y
   `mapeo_Canvas_internos.csv`, ver también `Distinciones_PESTEL_PORTER.md`)
   y se valió aquí: los 110 códigos de ambos CSV coinciden 1:1 con los 110
   códigos extraídos de `GUIA_ENTREVISTA`/`FormularioFODA` (verificado antes
   de incorporarlos). Reemplaza una primera versión de este script que
   hardcodeaba un único "marco" por ÁREA (más tosco e inexacto en los
   bordes: p. ej. clasificaba todo el bloque EE como "PESTEL" cuando en
   realidad ningún ítem de EE encaja en una dimensión PESTEL ni en una
   fuerza de Porter según el análisis ítem por ítem). Si los CSV no están
   presentes, el script sigue funcionando pero sin este detalle (con una
   advertencia), para no volver a depender de un archivo que podría faltar.
2. El esquema de `ARCHITECTURE.md §4.1` mostraba `areasInternas` con ítems
   como objetos completos y `areasExternas` con ítems como un array plano
   de strings (solo IDs). Esa inconsistencia se resuelve acá: AMBAS usan
   ítems como objetos completos con los mismos campos, porque la guía de
   entrevista completa (pregunta, evidencia, quién responde, lectura sin
   exportar) existe igual de completa para los 46 ítems externos que para
   los 64 internos — no hay motivo para truncar la info externa a solo IDs.
   `ARCHITECTURE.md` se actualiza en consecuencia.
3. La columna C de `FormularioFODA` (un valor numérico tipo 4.9999/6.9999)
   NO se usa en este script, y esto ya no es una duda pendiente sino una
   decisión verificada: es idéntica, celda a celda en las 110 filas, a
   `CalculosFoda!AD` ("Pts" = `Puntos * Respondido`, donde `Puntos` es la
   interpolación de la tabla `Rango` -- con el épsilon `ABS(V)-0.001` que
   el Excel resta antes de interpolar, de ahí los `.9999` -- y `Respondido`
   es un indicador binario 1/0 de si se marcó una opción de situación, NO
   un signo favorable/desfavorable). En el Excel EN BLANCO (sin respuestas)
   esa misma columna da 0 en las 110 filas. Es decir: no es un dato del
   ítem, es un RESULTADO que depende de las respuestas de situación/impacto
   de una evaluación concreta — no corresponde en `questionnaire.json` (que
   describe las preguntas, no las respuestas), corresponde en
   `assessment.schema.json` → `resultados.porItem[].puntos0a10` (Fase 2/3).
   Corrección respecto de una nota anterior de este mismo docstring: acá se
   había afirmado que existía un "Signo" ±1 (favorable/desfavorable) a nivel
   de ítem -- verificado en Fase 2 contra el Excel real que esto era
   incorrecto (`CalculosFoda!V`, el % de logro, nunca es negativo con la
   escala del instrumento, así que ese "signo" nunca vale -1 en la
   práctica). El motor de cálculo (`frontend/src/engine/calc.js`,
   `ARCHITECTURE.md §4.1` y `§5`) ya no tiene ningún concepto de "signo" ni
   `SIGNO_SITUACION`.

Uso:
    python3 scripts/xlsx_to_json.py \
        --excel docs/referencia/FODA_Export_Misiones_2026_DEMO.xlsx \
        --out frontend/src/data/questionnaire.json \
        --canvas-csv docs/clasificacion/mapeo_Canvas_internos.csv \
        --pestel-csv docs/clasificacion/mapeo_PESTEL_Porter_externos.csv

    (o sin argumentos, usa las rutas por defecto de abajo)

Requisitos: openpyxl (pip install openpyxl --break-system-packages)
Validación opcional: jsonschema (pip install jsonschema --break-system-packages)
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import sys
from pathlib import Path

try:
    import openpyxl
except ImportError:
    sys.exit(
        "Falta openpyxl. Instalá con:\n"
        "  pip install openpyxl --break-system-packages"
    )

# ---------------------------------------------------------------------------
# Configuración
# ---------------------------------------------------------------------------

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_EXCEL = REPO_ROOT / "docs" / "referencia" / "FODA_Export_Misiones_2026_DEMO.xlsx"
DEFAULT_OUT = REPO_ROOT / "frontend" / "src" / "data" / "questionnaire.json"
DEFAULT_SCHEMA = REPO_ROOT / "data" / "schema" / "questionnaire.schema.json"
DEFAULT_CANVAS_CSV = REPO_ROOT / "docs" / "clasificacion" / "mapeo_Canvas_internos.csv"
DEFAULT_PESTEL_CSV = REPO_ROOT / "docs" / "clasificacion" / "mapeo_PESTEL_Porter_externos.csv"

SHEET_FORMULARIO = "FormularioFODA"
SHEET_GUIA = "GUIA_ENTREVISTA"

SITUACION_COLS = {"No corresp.": 4, "Muy Desfav.": 5, "Desfavorable": 6, "Favorable": 7, "Muy Favorable": 8}
IMPACTO_COLS = {"Muy insignif": 10, "Insignificante": 11, "Significante": 12, "Muy Signific.": 13}

ITEM_TEXT_RE = re.compile(
    r"^\s*\d+\s*-\s*(?P<titulo>.+?)\.\s*Se considera favorable si\s*(?P<criterio>.+?)\s*$",
    re.IGNORECASE | re.DOTALL,
)


# ---------------------------------------------------------------------------
# Extracción
# ---------------------------------------------------------------------------

def parse_item_text(raw: str) -> tuple[str, str]:
    """Separa 'N - Título. Se considera favorable si <criterio>.' en (titulo, criterio).

    Si el texto no matchea el patrón esperado, se deja documentado (no se
    oculta el problema): devuelve el texto completo como título y un
    criterio vacío, y quien corre el script lo ve en el resumen final.
    """
    m = ITEM_TEXT_RE.match(raw.strip())
    if not m:
        return raw.strip(), ""
    titulo = m.group("titulo").strip()
    criterio = "Se considera favorable si " + m.group("criterio").strip()
    if not criterio.endswith("."):
        criterio += "."
    return titulo, criterio


def read_clasificacion_csv(path: Path, kind: str) -> dict[str, dict]:
    """Lee mapeo_Canvas_internos.csv o mapeo_PESTEL_Porter_externos.csv.

    `kind` es "canvas" o "pestel_porter" — cada uno tiene columnas distintas
    (ver docstring del módulo, decisión 1). Devuelve {codigo: clasificacion}.
    Si el archivo no existe, devuelve {} (el llamador decide si eso es una
    advertencia o un error).
    """
    if not path.exists():
        return {}
    out = {}
    with path.open(encoding="utf-8-sig", newline="") as f:
        for row in csv.DictReader(f):
            codigo = row["codigo"].strip()
            if kind == "canvas":
                # Para 'Combinada', bloque_canvas viene como "Principal/Secundario"
                # (ej. "Canales/Actividades clave"); para 'Agregado' (bloque IJ,
                # transversal, fuera de los 9 bloques de Osterwalder) viene vacío.
                bloque_canvas = row["bloque_canvas"].strip()
                principal, _, secundario = bloque_canvas.partition("/")
                out[codigo] = {
                    "tipo": row["tipo"].strip(),
                    "bloquePrincipal": principal or None,
                    "bloqueSecundario": secundario or None,
                    "nota": row["nota"].strip() or None,
                }
            else:
                out[codigo] = {
                    "tipo": row["tipo"].strip(),
                    "pestel": row["pestel_dimension"].strip() or None,
                    "porter": row["porter_fuerza"].strip() or None,
                    "nota": row["nota"].strip() or None,
                }
    return out


def read_guia_entrevista(ws) -> list[dict]:
    """Lee GUIA_ENTREVISTA fila por fila (header en fila 4, datos desde fila 5)."""
    filas = []
    r = 5
    while r <= ws.max_row:
        codigo = ws.cell(row=r, column=2).value
        if codigo is None:
            r += 1
            if ws.cell(row=r, column=2).value is None and ws.cell(row=r + 1, column=2).value is None:
                break
            continue
        filas.append(
            {
                "codigo": str(codigo).strip(),
                "areaTexto": (ws.cell(row=r, column=3).value or "").strip(),
                "factor": (ws.cell(row=r, column=4).value or "").strip(),
                "preguntaEntrevista": (ws.cell(row=r, column=5).value or "").strip() or None,
                "evidenciaSugerida": (ws.cell(row=r, column=6).value or "").strip() or None,
                "filaFormulario": ws.cell(row=r, column=7).value,
                "quienResponde": (ws.cell(row=r, column=8).value or "").strip() or None,
                "lecturaSinExportar": (ws.cell(row=r, column=9).value or "").strip() or None,
            }
        )
        r += 1
    return filas


def build_questionnaire(excel_path: Path, canvas_csv: Path, pestel_csv: Path) -> dict:
    wb = openpyxl.load_workbook(excel_path, data_only=True)
    if SHEET_FORMULARIO not in wb.sheetnames or SHEET_GUIA not in wb.sheetnames:
        sys.exit(f"El Excel no tiene las hojas esperadas ({SHEET_FORMULARIO}, {SHEET_GUIA}).")

    ws_form = wb[SHEET_FORMULARIO]
    ws_guia = wb[SHEET_GUIA]

    guia_rows = read_guia_entrevista(ws_guia)
    if not guia_rows:
        sys.exit("GUIA_ENTREVISTA no devolvió filas — revisar la hoja.")

    clasif_canvas = read_clasificacion_csv(canvas_csv, "canvas")
    clasif_pestel = read_clasificacion_csv(pestel_csv, "pestel_porter")
    clasif_warnings = []
    if not clasif_canvas:
        clasif_warnings.append(f"No se encontró o está vacío {canvas_csv} — los ítems internos quedan sin campo 'clasificacionMarco'.")
    if not clasif_pestel:
        clasif_warnings.append(f"No se encontró o está vacío {pestel_csv} — los ítems externos quedan sin campo 'clasificacionMarco'.")

    # Construye cada item combinando GUIA_ENTREVISTA (código, entrevista) +
    # FormularioFODA (texto largo, vía la fila que indica la guía).
    items_por_area: dict[str, list[dict]] = {}
    area_nombre: dict[str, str] = {}
    orden_areas: list[str] = []
    parse_warnings: list[str] = []
    # clasif_warnings son informativas (el CSV de clasificación es un enriquecimiento
    # opcional agregado después del cierre de Fase 1) y NO bloquean el criterio de
    # cierre de 110 ítems / 19 áreas — se listan aparte en el resumen final.
    codigos_sin_clasificar: list[str] = []

    for row in guia_rows:
        codigo = row["codigo"]
        area_id = re.match(r"^[A-Z]+", codigo).group(0)
        fila = row["filaFormulario"]
        if not isinstance(fila, int):
            parse_warnings.append(f"{codigo}: 'Fila en FormularioFODA' no es un entero ({fila!r}), se omite.")
            continue

        raw_texto = ws_form.cell(row=fila, column=2).value
        if not raw_texto:
            parse_warnings.append(f"{codigo}: fila {fila} de FormularioFODA está vacía.")
            continue
        titulo, criterio = parse_item_text(str(raw_texto))
        if not criterio:
            parse_warnings.append(f"{codigo}: no se pudo separar título/criterio en fila {fila} (texto: {raw_texto[:60]!r}...).")

        # Orden del item dentro del área: el número con el que arranca el texto.
        m_orden = re.match(r"^\s*(\d+)\s*-", str(raw_texto))
        orden = int(m_orden.group(1)) if m_orden else None

        es_interno = codigo[0] == "I"
        clasif_fuente = clasif_canvas if es_interno else clasif_pestel
        clasificacion = clasif_fuente.get(codigo)
        if clasif_fuente and clasificacion is None:
            codigos_sin_clasificar.append(codigo)

        item = {
            "id": codigo,
            "orden": orden,
            "titulo": titulo,
            "criterioFavorable": criterio,
            "preguntaEntrevista": row["preguntaEntrevista"],
            "evidenciaSugerida": row["evidenciaSugerida"],
            "quienResponde": row["quienResponde"],
            "lecturaSinExportar": row["lecturaSinExportar"],
            "clasificacionMarco": clasificacion,
            "filaFormularioFoda": fila,
        }
        items_por_area.setdefault(area_id, []).append(item)
        if area_id not in area_nombre:
            # Texto de GUIA_ENTREVISTA viene como "1. Segmentos de clientes"
            # o "Ámbito Político/Legal y Regulatorio" (externas no llevan numeral).
            nombre = re.sub(r"^\d+\.\s*", "", row["areaTexto"]).strip()
            area_nombre[area_id] = nombre
            orden_areas.append(area_id)

    areas_internas = []
    areas_externas = []
    for area_id in orden_areas:
        items = sorted(items_por_area[area_id], key=lambda i: (i["orden"] is None, i["orden"]))
        es_interna = area_id.startswith("I")
        if es_interna:
            marco = "Canvas — " + area_nombre[area_id]
        else:
            # Resumen legible del área a partir de la clasificación ítem por ítem
            # (docs/clasificacion/mapeo_PESTEL_Porter_externos.csv) — no es una
            # etiqueta única por área: cada ítem lleva su propia
            # 'clasificacionMarco', que es la fuente autorizada. Esto es solo
            # un resumen agregado para mostrar en pantalla sin recorrer ítems.
            tipos = [it["clasificacionMarco"]["tipo"] for it in items if it["clasificacionMarco"]]
            if not tipos:
                marco = "Ámbito externo — sin clasificación PESTEL/Porter cargada"
            else:
                from collections import Counter
                conteo = Counter(tipos)
                resumen = ", ".join(f"{n} {t}" for t, n in conteo.most_common())
                marco = f"Ámbito externo ({resumen}) — ver 'clasificacionMarco' por ítem"
        area_obj = {
            "id": area_id,
            "nombre": area_nombre[area_id],
            "tipo": "interno" if es_interna else "externo",
            "marco": marco,
            "items": items,
        }
        if es_interna:
            areas_internas.append(area_obj)
        else:
            areas_externas.append(area_obj)

    total_items = sum(len(a["items"]) for a in areas_internas) + sum(len(a["items"]) for a in areas_externas)

    questionnaire = {
        "version": "1.1.0",
        "fuente": excel_path.name,
        "escalas": {
            "situacion": list(SITUACION_COLS.keys()),
            "impacto": list(IMPACTO_COLS.keys()),
        },
        "areasInternas": areas_internas,
        "areasExternas": areas_externas,
    }

    info_warnings = list(clasif_warnings)
    if codigos_sin_clasificar:
        info_warnings.append(
            f"{len(codigos_sin_clasificar)} ítem(s) sin fila de clasificación en el CSV correspondiente: {', '.join(codigos_sin_clasificar)}"
        )

    return questionnaire, parse_warnings, info_warnings, total_items, len(areas_internas), len(areas_externas)


# ---------------------------------------------------------------------------
# Validación
# ---------------------------------------------------------------------------

def validate_against_schema(data: dict, schema_path: Path) -> list[str]:
    if not schema_path.exists():
        return [f"No se encontró el schema en {schema_path}, se omite la validación JSON Schema."]
    try:
        import jsonschema
    except ImportError:
        return ["jsonschema no está instalado (pip install jsonschema --break-system-packages); se omite la validación."]

    with schema_path.open(encoding="utf-8") as f:
        schema = json.load(f)
    validator = jsonschema.Draft202012Validator(schema)
    errores = [f"{'/'.join(str(p) for p in e.path)}: {e.message}" for e in validator.iter_errors(data)]
    return errores


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--excel", type=Path, default=DEFAULT_EXCEL, help="Ruta al Excel fuente (default: docs/referencia/FODA_Export_Misiones_2026_DEMO.xlsx)")
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT, help="Ruta de salida del JSON (default: frontend/src/data/questionnaire.json)")
    parser.add_argument("--schema", type=Path, default=DEFAULT_SCHEMA, help="Ruta al JSON Schema para validar (default: data/schema/questionnaire.schema.json)")
    parser.add_argument("--canvas-csv", type=Path, default=DEFAULT_CANVAS_CSV, help="CSV de clasificación Canvas de ítems internos (default: docs/clasificacion/mapeo_Canvas_internos.csv)")
    parser.add_argument("--pestel-csv", type=Path, default=DEFAULT_PESTEL_CSV, help="CSV de clasificación PESTEL/Porter de ítems externos (default: docs/clasificacion/mapeo_PESTEL_Porter_externos.csv)")
    parser.add_argument("--no-validate", action="store_true", help="Omite la validación contra el JSON Schema")
    args = parser.parse_args()

    if not args.excel.exists():
        sys.exit(f"No se encontró el Excel en {args.excel}")

    questionnaire, warnings, info_warnings, total_items, n_internas, n_externas = build_questionnaire(
        args.excel, args.canvas_csv, args.pestel_csv
    )

    args.out.parent.mkdir(parents=True, exist_ok=True)
    with args.out.open("w", encoding="utf-8") as f:
        json.dump(questionnaire, f, ensure_ascii=False, indent=2)

    print(f"OK: {args.out} generado.")
    print(f"  Áreas internas: {n_internas} (esperado: 10)")
    print(f"  Áreas externas: {n_externas} (esperado: 9)")
    print(f"  Total ítems: {total_items} (esperado: 110)")

    if warnings:
        print(f"\nAdvertencias de extracción ({len(warnings)}) — bloquean el cierre de Fase 1:")
        for w in warnings:
            print(f"  - {w}")

    if info_warnings:
        print(f"\nAvisos informativos ({len(info_warnings)}) — NO bloquean el cierre de Fase 1 (clasificación PESTEL/Porter/Canvas es un enriquecimiento posterior):")
        for w in info_warnings:
            print(f"  - {w}")

    if not args.no_validate:
        errores = validate_against_schema(questionnaire, args.schema)
        if errores:
            print(f"\nErrores de validación contra el schema ({len(errores)}):")
            for e in errores:
                print(f"  - {e}")
            if any("No se encontró" not in e and "no está instalado" not in e for e in errores):
                sys.exit(1)
        else:
            print("\nValidación contra el JSON Schema: OK.")

    # Chequeos de cierre de Fase 1 (ARCHITECTURE.md): 110 ítems, 19 áreas.
    cierre_ok = (total_items == 110) and (n_internas == 10) and (n_externas == 9) and not warnings
    if not cierre_ok:
        print(
            "\nATENCIÓN: no se cumple el criterio de cierre de Fase 1 "
            "(110 ítems / 19 áreas sin advertencias). Revisar antes de dar la fase por cerrada."
        )
        sys.exit(1)

    print("\nCriterio de cierre de Fase 1 cumplido: 110 ítems, 19 áreas, sin advertencias.")


if __name__ == "__main__":
    main()
