# Fase 3 — Frontend usable sin backend (MVP offline-first)

## Qué archivos van a cada carpeta de tu repo

```
frontend/index.html                      → nuevo (la app completa, una sola página)
frontend/src/app.js                      → nuevo (lógica de UI: Alpine.js + Chart.js)
frontend/src/engine/calc.js              → reemplaza el de Fase 2 (agrega calcularMatrizFoda)
frontend/src/data/questionnaire.json     → el mismo de Fase 1, sin cambios
frontend/src/data/dependenciasFoda.json  → nuevo (tabla fija interno→externo, ver más abajo)
scripts/extraer_dependencias_foda.py     → nuevo
tests/calc.golden.test.mjs               → reemplaza el de Fase 2 (agrega tests de la matriz FODA)
tests/golden.demo.json                   → regenerado (ahora incluye matrizFoda)
ARCHITECTURE.md                          → reemplaza el que ya tenías
```

## El hallazgo grande de esta fase: el cuadrante FODA SÍ es automático

En el cierre de Fase 2 te dije que `cuadranteDominante` (el gráfico de burbujas FO/FA/DO/DA) necesitaba carga cualitativa manual. **Vos me corregiste** — dijiste que `PART2 FODA` es todo automático — y tenías razón: volví a leer las fórmulas con más cuidado y era un error mío de Fase 2, no una limitación real del Excel.

Lo que realmente pasa: hay una tabla fija en la hoja `VariablesFoda` (como la tabla `Rango`, no depende de ninguna evaluación) que dice, para cada uno de los 64 factores internos, con qué factores externos se cruza (93 pares en total; 9 factores internos no tienen cruce y quedan afuera). Con las respuestas de situación de esos pares, el Excel clasifica automáticamente cada factor en Fortaleza/Debilidad (interno) u Oportunidad/Amenaza (externo), cuenta los cruces en FO/FA/DO/DA, y el cuadrante dominante es el que tiene más cruces.

`extraer_dependencias_foda.py` extrae esa tabla fija del Excel una sola vez. `calcularMatrizFoda` en `calc.js` reproduce el resto del cálculo. **Validado contra el Excel real**: con las respuestas del DEMO, la app da exactamente los mismos 14 FO / 28 FA / 12 DO / 30 DA y el mismo cuadrante dominante ("Debilidades-Amenazas") que `MATRIZ FODA`/`VIABILIDAD!C53` del Excel. El detalle completo queda en `ARCHITECTURE.md §5`.

## Qué tiene la app

- Los 110 ítems, navegables por área (19), con las dos escalas (situación e impacto) y la guía de entrevista de cada ítem desplegable.
- Resultado en vivo mientras completás: semáforo por área, índices interno/externo, veredicto, cuadrante FODA dominante, gráfico de barras (19 áreas) y gráfico de burbujas FO/FA/DO/DA — todo con Chart.js.
- Perfil de empresa (exporta / no exporta, mercados objetivo, quién releva).
- Guarda automáticamente en `localStorage` del navegador — si cerrás la pestaña a mitad de entrevista, al volver sigue donde quedó.
- Exportar la evaluación completa a un archivo `.json` (según `assessment.schema.json`) e importarla de vuelta.
- Botón de imprimir (oculta el formulario y deja un resumen limpio para entregar en papel).
- Responsive — se probó en viewport de celular (390px) sin scroll horizontal.

## Cómo probarla vos mismo

**No la abras con doble clic (`file://`)** — el navegador bloquea la carga de los `.json` del cuestionario por seguridad. Serví la carpeta `frontend/` con un servidor local:

```bash
cd frontend
python3 -m http.server 8000
# abrí http://localhost:8000 en el navegador
```

En Netlify esto no hace falta — ahí siempre se sirve por HTTPS y funciona directo.

## Cómo se probó antes de entregarte esto

Un detalle para que confíes en que no es solo "se ve bien": usé un navegador automatizado (Playwright) para cargar la app de verdad en un navegador, clickear las mismas 110 respuestas del Excel DEMO una por una a través de la interfaz (no llamando a `calc.js` directo), y comparé el resultado que mostró la app contra los valores reales del Excel — índices, veredicto y los 4 cruces FO/FA/DO/DA coincidieron exactamente. También probé: recargar la página y que el borrador se mantenga, exportar e importar un archivo de ejemplo, y el CSS de impresión.

De paso encontré y corregí un bug real: guardar un `Chart` de Chart.js como propiedad reactiva de Alpine.js rompe (`Maximum call stack size exceeded`, un problema conocido de esa combinación) — las instancias de los gráficos ahora viven fuera del estado reactivo.

## Qué falta para cerrar del todo la Fase 3

- Nada bloqueante para el criterio de cierre del plan ("un estudiante completa una entrevista de punta a punta y el resultado coincide con el Excel") — eso ya está demostrado.
- Pulido visual/UX si querés iterar sobre el diseño (esto es un MVP funcional, no una pasada de diseño).
- El export a PDF por ahora es "imprimir desde el navegador → guardar como PDF", no un botón dedicado — si lo querés como botón aparte, es un agregado chico.
