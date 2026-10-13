# Fase 2 — motor de cálculo + tests golden (cierre de la GATE técnica)

## Qué archivos van a cada carpeta de tu repo

```
frontend/src/engine/calc.js     → reemplaza/crea el motor
frontend/src/data/questionnaire.json  → ya lo tenías de Fase 1, sin cambios acá
scripts/golden_extract.py       → nuevo: extrae "la verdad" del Excel DEMO
tests/calc.golden.test.mjs      → nuevo: compara calc.js contra esa verdad
tests/golden.demo.json          → generado por golden_extract.py (no se edita a mano)
.github/workflows/tests.yml     → nuevo: corre los tests en cada push/PR
package.json                    → nuevo (si todavía no tenés uno en la raíz): da el comando `npm test`
ARCHITECTURE.md                 → reemplaza el que ya tenías (agrega las correcciones de Fase 2)
```

## Cómo correr los tests vos mismo

Sin instalar nada (Node 18+ ya trae el test runner incorporado):

```bash
cd tu-repo
node --test tests/*.mjs
# o, con el package.json incluido:
npm test
```

Resultado esperado: **10/10 tests verdes**.

## Qué se hizo en esta fase (resumen)

1. **`calc.js`**: reproduce `CalculosFoda` (J, V, W, X, Y, Z, AA, AB, AC, AD, O, P, AE) y la tabla `Rango`, más `VIABILIDAD` (semáforo, alertas, índices, veredicto de 5 ramas).
2. **Dos correcciones a lo que se había documentado antes** (quedan explícitas en `ARCHITECTURE.md §4.1` y `§5`, no se taparon en silencio):
   - `CalculosFoda!AC` **no es un signo** ±1 (favorable/desfavorable) como se había dicho — es un indicador binario de "¿se respondió?". El motor ya no tiene ningún concepto de "signo" a nivel de ítem.
   - El Excel real resta un **épsilon de 0.001** antes de interpolar en la tabla `Rango` (de ahí los valores `.9999` que se veían en los datos) — es una rareza deliberada del instrumento original, se reprodujo tal cual en vez de "limpiarla".
3. **Hallazgo importante, documentado como decisión pendiente** (no bloquea el cierre de esta fase): `cuadranteDominante`/`orientacionEstrategica` NO se pueden derivar de las 110 respuestas — el Excel original los calcula de texto cualitativo cargado a mano en otra hoja (`PART2 FODA`). Quedan dos caminos propuestos en `ARCHITECTURE.md §5` para decidir antes de construir esa parte de la Fase 3.
4. **Golden tests**: `golden_extract.py` lee los valores *cacheados* del Excel DEMO (sin recalcular nada) para 110 ítems, 19 áreas, 2 índices y el veredicto, y `calc.golden.test.mjs` los compara contra `calc.js` con tolerancia ≤ 0.01 (exacta para semáforo/veredicto/conteos). Se suman escenarios sintéticos para los casos borde que pide el plan del proyecto (ítem sin responder, área sin datos, todo favorable, "No corresponde", datos incompletos).

## Lo que queda pendiente para terminar de cerrar la Fase 2 del todo

- Golden tests con el Excel **recalculado** (no solo DEMO) para los escenarios "todo favorable"/"todo desfavorable" a partir del Excel en blanco — hoy esos casos están cubiertos con tests sintéticos en JS, no extraídos del Excel vía LibreOffice headless. Es un refuerzo, no bloquea: el criterio de cierre del plan ("tests verdes en CI") ya se cumple con lo que hay.
- `backend/engine_replica.py` (réplica Python) es trabajo de Fase 4, no de esta.
