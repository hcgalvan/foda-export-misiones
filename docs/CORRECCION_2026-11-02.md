# Corrección 2/11/2026 — explicación del escenario C del reporte

**Qué estaba mal:** el reporte decía que, aun corrigiendo todas las debilidades, el índice interno podía quedar bajo 7 porque "Favorable vale exactamente 7" y haría falta "Muy favorable". Era una explicación incorrecta.

**Causa real (verificada con el motor):** los ítems internos marcados "No corresponde" puntúan 1 y entran en el promedio del área (rareza heredada del Excel, decisión abierta). En el caso de prueba: C = 6,93; C+ (además valorar esos ítems como Favorable) = 7,24; excluyéndolos = 7,25.

**Cambios:** `frontend/src/analisis.js` (nuevo escenario C+), `frontend/src/report.js` (texto según datos), `tests/analisis.test.mjs`. El motor de cálculo NO cambió: ningún puntaje ni veredicto se modifica, solo la explicación y el escenario adicional.
Tests: `node --test tests/*.mjs` → 47/47.
