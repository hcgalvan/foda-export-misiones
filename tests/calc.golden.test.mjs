// tests/calc.golden.test.mjs — Fase 2: tests "golden" del motor de cálculo.
//
// Compara frontend/src/engine/calc.js contra valores extraídos directamente
// del Excel DEMO (tests/golden.demo.json, generado por
// scripts/golden_extract.py — NO se edita a mano, se regenera con el script).
//
// Corrida: node --test tests/   (Node >= 18 trae node:test incorporado, sin
// dependencias que instalar).
//
// Tolerancia: 0.01, tal como pide el plan de Fase 2 del proyecto, salvo en
// semáforo/veredicto/itemsRespondidos/alertas que son valores discretos
// (comparación exacta).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  calcularItem,
  calcularArea,
  calcularViabilidad,
  calcularAssessment,
  calcularMatrizFoda,
  clasificarFactor,
  interpolarPuntos,
} from '../frontend/src/engine/calc.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TOL = 0.01;

function closeEnough(a, b, tol = TOL) {
  return Math.abs(a - b) <= tol;
}

function leerJSON(relPath) {
  return JSON.parse(readFileSync(path.join(__dirname, '..', relPath), 'utf-8'));
}

const golden = leerJSON('tests/golden.demo.json');
const questionnaire = leerJSON('frontend/src/data/questionnaire.json');
const dependenciasFoda = leerJSON('frontend/src/data/dependenciasFoda.json');

// --- Tests unitarios de la tabla Rango (tramos conocidos) -----------------

test('interpolarPuntos: tramos de la tabla Rango', () => {
  // OJO: el Excel real resta un épsilon de 0.001 antes de interpolar
  // (CalculosFoda!W = ABS(V)-0.001), así que un valor que cae justo en un
  // límite de tramo (20, 40, 60, 80, 100...) da p. ej. 0.9999 en vez de 1,
  // no el valor "limpio" — se compara con tolerancia, no con igualdad
  // exacta, salvo en 0 (que no pasa por la resta de épsilon).
  assert.equal(interpolarPuntos(0), 0);
  assert.ok(closeEnough(interpolarPuntos(20), 1)); // No corresp. (único respondido posible en ese tramo) -> 0.9999 real
  assert.ok(closeEnough(interpolarPuntos(40), 3));
  assert.ok(closeEnough(interpolarPuntos(60), 5));
  assert.ok(closeEnough(interpolarPuntos(80), 7));
  assert.ok(closeEnough(interpolarPuntos(100), 10)); // Muy Favorable
});

// --- Golden: puntaje por ítem (escenario DEMO) -----------------------------

test('calcularItem: puntaje por ítem coincide con CalculosFoda!AD (DEMO)', () => {
  const porItemEsperado = new Map(golden.esperado.porItem.map((i) => [i.itemId, i.puntos0a10]));
  let comparados = 0;
  for (const [itemId, esperado] of porItemEsperado) {
    const respuesta = golden.respuestas[itemId];
    const { puntos0a10 } = calcularItem(respuesta);
    assert.ok(
      closeEnough(puntos0a10, esperado),
      `${itemId}: calc.js dio ${puntos0a10}, Excel dio ${esperado}`
    );
    comparados++;
  }
  assert.equal(comparados, 110, 'deben compararse los 110 ítems');
});

// --- Golden: puntaje/semáforo/alertas por área (escenario DEMO) -----------

test('calcularArea: puntaje, semáforo, ítems respondidos y alertas coinciden con VIABILIDAD (DEMO)', () => {
  const areasPorId = new Map(
    [...questionnaire.areasInternas, ...questionnaire.areasExternas].map((a) => [a.id, a])
  );
  let comparadas = 0;
  for (const esperadoArea of golden.esperado.porArea) {
    const area = areasPorId.get(esperadoArea.areaId);
    assert.ok(area, `área ${esperadoArea.areaId} no está en questionnaire.json`);
    const respuestas = area.items.map((it) => golden.respuestas[it.id]);
    const resultado = calcularArea(respuestas);

    assert.ok(
      closeEnough(resultado.puntaje, esperadoArea.puntaje),
      `${esperadoArea.areaId}: puntaje calc.js=${resultado.puntaje} Excel=${esperadoArea.puntaje}`
    );
    assert.equal(resultado.semaforo, esperadoArea.semaforo, `${esperadoArea.areaId}: semáforo`);
    assert.equal(
      resultado.itemsRespondidos,
      esperadoArea.itemsRespondidos,
      `${esperadoArea.areaId}: itemsRespondidos`
    );
    assert.equal(resultado.itemsTotales, esperadoArea.itemsTotales, `${esperadoArea.areaId}: itemsTotales`);
    assert.equal(resultado.alertas, esperadoArea.alertas, `${esperadoArea.areaId}: alertas`);
    comparadas++;
  }
  assert.equal(comparadas, 19, 'deben compararse las 19 áreas');
});

// --- Golden: índices globales y veredicto (escenario DEMO) ----------------

test('calcularViabilidad: índices interno/externo y veredicto coinciden con VIABILIDAD (DEMO)', () => {
  const areasPorId = new Map(
    [...questionnaire.areasInternas, ...questionnaire.areasExternas].map((a) => [a.id, a])
  );
  const calcularAreaPorId = (id) => {
    const area = areasPorId.get(id);
    const respuestas = area.items.map((it) => golden.respuestas[it.id]);
    return calcularArea(respuestas);
  };

  const areasInternas = questionnaire.areasInternas.map((a) => calcularAreaPorId(a.id));
  const areasExternas = questionnaire.areasExternas.map((a) => calcularAreaPorId(a.id));

  const { indiceInterno, indiceExterno, veredicto } = calcularViabilidad(areasInternas, areasExternas);

  assert.ok(
    closeEnough(indiceInterno, golden.esperado.indiceInterno),
    `índice interno: calc.js=${indiceInterno} Excel=${golden.esperado.indiceInterno}`
  );
  assert.ok(
    closeEnough(indiceExterno, golden.esperado.indiceExterno),
    `índice externo: calc.js=${indiceExterno} Excel=${golden.esperado.indiceExterno}`
  );
  assert.equal(veredicto, golden.esperado.veredicto, 'veredicto');
});

// --- Golden: calcularAssessment end-to-end (toma questionnaire.json completo) --

test('calcularAssessment: resultado end-to-end coincide con el golden del DEMO', () => {
  const resultado = calcularAssessment(questionnaire, golden.respuestas);

  assert.ok(closeEnough(resultado.indiceInterno, golden.esperado.indiceInterno), 'indiceInterno end-to-end');
  assert.ok(closeEnough(resultado.indiceExterno, golden.esperado.indiceExterno), 'indiceExterno end-to-end');
  assert.equal(resultado.veredicto, golden.esperado.veredicto, 'veredicto end-to-end');
  assert.equal(resultado.porItem.length, 110, 'porItem debe tener 110 entradas');
  assert.equal(resultado.porArea.length, 19, 'porArea debe tener 19 entradas');
});

// --- Escenarios sintéticos (sin depender del Excel): casos borde ----------

test('escenario sintético: ítem no respondido da puntos0a10=0 y no cuenta como respondido', () => {
  const r = calcularItem({ situacion: null, impacto: null });
  assert.equal(r.puntos0a10, 0);
  assert.equal(r.respondido, false);
});

test('escenario sintético: área sin ningún ítem respondido da "sin datos"', () => {
  const r = calcularArea([{ situacion: null, impacto: null }, { situacion: null, impacto: null }]);
  assert.equal(r.puntaje, 0);
  assert.equal(r.semaforo, 'sin datos');
  assert.equal(r.itemsRespondidos, 0);
});

test('escenario sintético: todas las áreas en "Muy Favorable"/"Muy Signific." dan puntaje 10 (Bueno, no Excelencia)', () => {
  // Situación máxima (Muy Favorable, índice 4) -> 100% de logro -> interpolarPuntos(100) = 10.
  // Con peso de impacto uniforme, el promedio ponderado del área también da 10.
  const items = Array.from({ length: 5 }, () => ({ situacion: 4, impacto: 3 }));
  const r = calcularArea(items);
  assert.ok(closeEnough(r.puntaje, 10));
  assert.equal(r.semaforo, 'Bueno'); // semaforoDe: >10 Excelencia, 10 cae en >=8 => "Bueno"
});

test('escenario sintético: todas las áreas en "No corresp." (mínimo marcable) dan puntaje bajo, no cero', () => {
  // OJO: "No corresp." tiene peso 1 (no 0) en el Excel real — un ítem "No
  // corresponde" sigue sumando como si fuera la peor situación posible, no
  // se excluye del cálculo. Esto es una rareza documentada del instrumento
  // original (ARCHITECTURE.md), no un error de este motor — se reproduce
  // tal cual, no se "corrige" en silencio.
  const items = Array.from({ length: 5 }, () => ({ situacion: 0, impacto: 3 }));
  const r = calcularArea(items);
  assert.ok(closeEnough(r.puntaje, 1)); // 20% de logro -> interpolarPuntos(20) = 1
  assert.equal(r.semaforo, 'Alarmante');
  assert.equal(r.alertas, 5); // los 5 ítems están respondidos con puntaje < 5
});

test('escenario sintético: índices en 0 da veredicto DATOS_INCOMPLETOS', () => {
  const sinDatos = { puntaje: 0 };
  const conDatos = { puntaje: 8 };
  const r = calcularViabilidad([sinDatos], [conDatos]);
  assert.equal(r.veredicto, 'DATOS_INCOMPLETOS');
});

// --- Golden: matriz FODA (cuadrante dominante) — escenario DEMO ----------
//
// Hallazgo de Fase 3: el cuadrante dominante SÍ es automático (no requiere
// carga cualitativa manual) — ver la corrección en calc.js y ARCHITECTURE.md
// §5. Se valida acá contra 'MATRIZ FODA'!C15:F15 y VIABILIDAD!C53 del DEMO.

test('clasificarFactor: Fav./Muy Fav. -> positivo, Muy Desfav./Desfav. -> negativo, resto -> null', () => {
  assert.equal(clasificarFactor(3), 'positivo');
  assert.equal(clasificarFactor(4), 'positivo');
  assert.equal(clasificarFactor(1), 'negativo');
  assert.equal(clasificarFactor(2), 'negativo');
  assert.equal(clasificarFactor(0), null);
  assert.equal(clasificarFactor(null), null);
  assert.equal(clasificarFactor(undefined), null);
});

test('calcularMatrizFoda: cruces FO/FA/DO/DA y cuadrante dominante coinciden con MATRIZ FODA (DEMO)', () => {
  const resultado = calcularMatrizFoda(questionnaire, golden.respuestas, dependenciasFoda);
  const esperado = golden.esperado.matrizFoda;
  assert.ok(esperado, 'el golden debe traer matrizFoda (¿se regeneró golden.demo.json tras agregar la hoja MATRIZ FODA?)');
  assert.equal(resultado.cruces.FO, esperado.cruces.FO, 'cruces FO');
  assert.equal(resultado.cruces.FA, esperado.cruces.FA, 'cruces FA');
  assert.equal(resultado.cruces.DO, esperado.cruces.DO, 'cruces DO');
  assert.equal(resultado.cruces.DA, esperado.cruces.DA, 'cruces DA');
  assert.equal(resultado.cuadranteDominante, esperado.cuadranteDominante, 'cuadrante dominante');
});

test('escenario sintético: matriz FODA sin cruces (todo "No corresponde") da cuadranteDominante null', () => {
  const dependencias = { IA1: ['EA1'] };
  const respuestas = { IA1: { situacion: 0 }, EA1: { situacion: 0 } };
  const r = calcularMatrizFoda(questionnaire, respuestas, dependencias);
  assert.equal(r.totalCruces, 0);
  assert.equal(r.cuadranteDominante, null);
  assert.equal(r.sinConsiderar, 1);
});

test('escenario sintético: Fortaleza + Oportunidad da un cruce FO y orientación Ofensiva', () => {
  const dependencias = { IA1: ['EA1'] };
  const respuestas = { IA1: { situacion: 4 }, EA1: { situacion: 3 } }; // Muy Fav. / Fav.
  const r = calcularMatrizFoda(questionnaire, respuestas, dependencias);
  assert.equal(r.cruces.FO, 1);
  assert.equal(r.totalCruces, 1);
  assert.equal(r.cuadranteDominante, 'FO');
  assert.match(r.orientacionEstrategica, /Ofensiva/);
});
