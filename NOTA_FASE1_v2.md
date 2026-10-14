# Fase 1 — actualización (incorpora tus 3 archivos nuevos)

Analicé `Distinciones_PESTEL_PORTER.md`, `mapeo_Canvas_internos.csv` y `mapeo_PESTEL_Porter_externos.csv`, y resolví la columna C de `FormularioFODA` con el dato que diste (`CalculosFoda!AD`). Esto es lo que cambió respecto de la entrega anterior de Fase 1.

## 1. Columna C de `FormularioFODA` — resuelta

Verifiqué tu explicación celda por celda contra el DEMO, no la di por buena solo porque sonaba razonable:

- **`FormularioFODA!C` es idéntica a `CalculosFoda!AD`** en las 110 filas (0 discrepancias). `AD` ("Pts") = `AB × AC`, donde `AB` ("Puntos") es la interpolación de la tabla `Rango` que ya documentaba `ARCHITECTURE.md §5`, y `AC` es un signo ±1 según si el Logro superó o no la Meta.
- En el Excel **en blanco** (sin respuestas cargadas), esa misma columna da **0 en las 110 filas**.

Conclusión: la columna C no es un dato del ítem (no pertenece a `questionnaire.json`), es un **resultado por ítem que depende de las respuestas de una evaluación concreta** — exactamente lo que la Fase 1 ya había decidido no incluir, solo que ahora en vez de "no sé qué es, no lo toco" puedo decirte con precisión qué es y por qué no va ahí. Queda documentado en `ARCHITECTURE.md §4.1` como destino futuro: `assessment.schema.json → resultados.porItem[].puntos0a10`.

**Hallazgo colateral para la Fase 2** (no lo toqué, el motor real todavía no se construyó): el signo verdadero del Excel es binario (+1/−1), pero el borrador de `calc.js` en `ARCHITECTURE.md §5` tiene una escala de 4 niveles (`-1/-0.5/0.5/1`). Quedó anotado ahí mismo para que la Fase 2 no lo redescubra de cero.

La tabla de colorimetría que me pasaste (azul >10 Excelencia / verde 8-10 Bueno / amarillo 5-8 Regular / rojo <5 Alarmante) ya coincidía exactamente con los umbrales que tenía `semaforoDe()` en el borrador del motor — no hubo que tocar nada ahí, solo quedó confirmado.

## 2. Los CSV de clasificación — incorporados a `questionnaire.json`

Antes de usarlos, los crucé contra los 110 códigos que ya tenía: **coinciden 1:1, sin faltantes ni sobrantes** en ninguno de los dos (64 internos, 46 externos). Con esa garantía, reemplacé el mapeo que yo había hardcodeado por ÁREA (`MARCO_AREAS_EXTERNAS` en el script viejo) por tu clasificación ítem por ítem, que es estrictamente más precisa.

Esto no es un matiz menor — tu clasificación **corrige un error real** de mi primera versión: yo le había puesto la etiqueta "PESTEL — Infraestructura/Logística" a todo el bloque `EE` (Logística e Infraestructura Regional), y tu análisis ítem por ítem muestra que en realidad **ningún ítem de `EE` encaja en una dimensión PESTEL ni en una fuerza de Porter** — los 7 son "Agregado" (infraestructura física, fuera de ambos marcos). Lo mismo pasa en menor medida con `EA5`, `EC5`, `EF6`, `EG2` (agregados dentro de bloques que a nivel de área yo había etiquetado como puros).

Cada ítem ahora tiene un campo nuevo, `clasificacionMarco`:

- **Internos**: `{tipo, bloquePrincipal, bloqueSecundario, nota}` — `tipo` es `Canvas puro` (52), `Combinada` (5, dos bloques a la vez) o `Agregado` (7, el bloque `IJ` transversal, fuera de los 9 bloques de Osterwalder).
- **Externos**: `{tipo, pestel, porter, nota}` — `tipo` es `PESTEL puro` (20), `Porter puro` (10), `Combinada` (5) o `Agregado` (11).

El campo `marco` a nivel de ÁREA ya no es una etiqueta fija — ahora es un resumen automático contando los tipos de sus ítems (p. ej. para `EE`: `"Ámbito externo (7 Agregado) — ver 'clasificacionMarco' por ítem"`), y dejo escrito en el schema que no es la fuente de verdad: la fuente de verdad es `clasificacionMarco` de cada ítem.

## 3. Qué corrí y qué dio

```
OK: frontend/src/data/questionnaire.json generado.
  Áreas internas: 10 (esperado: 10)
  Áreas externas: 9 (esperado: 9)
  Total ítems: 110 (esperado: 110)

Validación contra el JSON Schema: OK.

Criterio de cierre de Fase 1 cumplido: 110 ítems, 19 áreas, sin advertencias.
```

0 ítems sin clasificar (los dos CSV cubren el 100% de los códigos). Reproducibilidad confirmada otra vez (dos corridas, mismo archivo). `questionnaire.json` pasó de versión `1.0.0` a `1.1.0` por este cambio de esquema (campo nuevo, no es un cambio retrocompatible silencioso).

## 4. Qué archivos te llegan en esta entrega

```
scripts/xlsx_to_json.py                              # actualizado: lee los 2 CSV nuevos
data/schema/questionnaire.schema.json                  # actualizado: define clasificacionMarco
frontend/src/data/questionnaire.json                    # regenerado, v1.1.0
docs/clasificacion/mapeo_Canvas_internos.csv             # copiado desde el proyecto, para que el script lo encuentre en esa ruta
docs/clasificacion/mapeo_PESTEL_Porter_externos.csv      # idem
ARCHITECTURE.md                                          # §4.1 actualizado con todo esto
```

Guardá los dos CSV en `docs/clasificacion/` de tu repo (es la ruta por defecto del script; si preferís otra, está el flag `--canvas-csv`/`--pestel-csv`).

## 5. Lo que no cambié, a propósito

- No toqué `calc.js` ni `CalculosFoda!AC` todavía — eso es trabajo de Fase 2, acá solo dejé documentado el hallazgo para no perderlo.
- No forcé una sola etiqueta por ítem en los casos "Combinada" (EA3, EB2, EB8, EI2, EI3 en externos; IC4, IC5, IF4, IF6, II2 en internos) — guardé ambas dimensiones, tal como las diste, en vez de elegir una "dominante" y perder información.
