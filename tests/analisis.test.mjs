// tests/analisis.test.mjs — análisis de decisión del reporte (simulaciones del motor + capa causal).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { calcularAssessment } from '../frontend/src/engine/calc.js';
import { analizar, cadenasCriticas, margen } from '../frontend/src/analisis.js';
import { construirReporte, reporteHTML } from '../frontend/src/report.js';

const leer = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'));
const q = leer('../frontend/src/data/questionnaire.json');
const dep = leer('../frontend/src/data/dependenciasFoda.json');
const causal = leer('../frontend/src/data/relacionesCausales.json');
const ejemplo = leer('./fixtures/ejemplo_prueba_1.json');
const R = {}; for (const r of ejemplo.respuestas) R[r.itemId] = { situacion: r.situacion, impacto: r.impacto };
const res = calcularAssessment(q, R, undefined, dep);
const an = analizar(q, dep, R, res);

test('escenarios = recálculo del motor (valores verificados a mano con calcularAssessment)', () => {
  const por = Object.fromEntries(an.escenarios.map((e) => [e.clave, e.resultado]));
  assert.equal(por.A.indiceInterno, 6.05); assert.equal(por.A.cuadrante, 'FA'); assert.equal(por.A.cruces.DA, 20);
  assert.equal(por.B.indiceInterno, 6.22);
  assert.equal(por.C.indiceInterno, 6.93); assert.equal(por.C.cruces.DA, 0); assert.equal(por.C.cruces.DO, 0);
  assert.equal(por.C.veredicto, 'VIABLE_CON_CONDICIONES'); // corregir todo no alcanza "Viable"
  const r1 = an.riesgos.find((x) => x.clave === 'R1');
  assert.equal(r1.resultado.indiceExterno, 4.93); assert.equal(r1.resultado.veredicto, 'ENTORNO_DESFAVORABLE');
});

test('los escenarios no modifican las respuestas originales', () => {
  const copia = structuredClone(R);
  analizar(q, dep, R, res);
  assert.deepEqual(R, copia);
});

test('márgenes a los umbrales', () => {
  assert.equal(an.margenes.externo.distanciaAlInferior, 0.34);
  assert.equal(an.margenes.interno.distanciaAlInferior, 0.5);
  assert.equal(an.margenes.interno.distanciaAlSuperior, 1.5);
  assert.equal(margen(7.5, { viable: 7, viableConCondiciones: 5 }).umbralSuperior, null);
  assert.equal(margen(3, { viable: 7, viableConCondiciones: 5 }).umbralInferior, null);
});

test('palancas: SOLO debilidades internas, sin "No corresponde", ordenadas por la regla acordada', () => {
  const ids = an.palancas.map((p) => p.id);
  for (const id of ['IE3', 'II2', 'IJ7']) assert.ok(!ids.includes(id), `${id} (No corresponde) no debe estar en prioridades`);
  assert.deepEqual(an.verificar.map((v) => v.id).sort(), ['IE3', 'II2', 'IJ7']);
  assert.ok(an.palancas.every((p) => p.situacionIdx >= 1 && p.situacionIdx <= 2 && p.id.startsWith('I')));
  for (let k = 1; k < an.palancas.length; k++) {
    const a = an.palancas[k - 1], b = an.palancas[k];
    const ok = a.mejoraIndice > b.mejoraIndice ||
      (a.mejoraIndice === b.mejoraIndice && (a.crucesDAResueltos > b.crucesDAResueltos ||
        (a.crucesDAResueltos === b.crucesDAResueltos && a.impactoIdx >= b.impactoIdx)));
    assert.ok(ok, `orden roto entre ${a.id} y ${b.id}`);
  }
  assert.deepEqual(an.horizontes.ahora.map((p) => p.id), ['IC5', 'IC2', 'IH2', 'IH5', 'IC4']);
  assert.equal(an.horizontes.ahora[0].crucesDAResueltos, 3);
});

test('"Ahora"+"Siguiente"+"Después" cubren todas las palancas sin repetir', () => {
  const h = an.horizontes;
  assert.equal(h.ahora.length + h.siguiente.length + h.despues.length, an.palancas.length);
  assert.equal(new Set([...h.ahora, ...h.siguiente, ...h.despues].map((p) => p.id)).size, an.palancas.length);
});

test('escala de puntos tomada del motor: 1 / 3 / 5 / 7 / 10', () => {
  assert.deepEqual(an.escalaPuntos.map((e) => e.puntos), [1, 3, 5, 7, 10]);
});

test('peso desigual de áreas: EH (2 ítems) vs EB (8 ítems)', () => {
  const p = an.pesosDesiguales.find((x) => x.ambito === 'externo');
  assert.equal(p.areaPesada, 'EH'); assert.equal(p.ratio, 4);
});

test('evaluación incompleta: no hay análisis (null) y el reporte se genera igual', () => {
  const vacia = { id: null, empresa: { nombre: 'X' }, respuestas: [], metadata: {} };
  const r = construirReporte(vacia, q, dep, { causal });
  assert.equal(r.analisis, null); assert.equal(r.resumen, null);
  assert.ok(reporteHTML(r).includes('DATOS INCOMPLETOS'));
});

// ---- capa causal ----
test('relacionesCausales.json: áreas existentes, textos no vacíos, sin duplicados', () => {
  const ids = new Set([...q.areasInternas, ...q.areasExternas].map((a) => a.id));
  const vistos = new Set();
  for (const r of causal.relaciones) {
    assert.ok(ids.has(r.desde), `desde inexistente: ${r.desde}`);
    assert.ok(r.hacia === 'INTERNAS' || ids.has(r.hacia), `hacia inexistente: ${r.hacia}`);
    assert.ok(r.texto.length > 20);
    assert.notEqual(r.desde, r.hacia);
    const k = `${r.desde}>${r.hacia}`; assert.ok(!vistos.has(k), `duplicada ${k}`); vistos.add(k);
  }
  // las relaciones desde externas solo apuntan a internas (el entorno condiciona a la empresa)
  for (const r of causal.relaciones.filter((x) => x.desde.startsWith('E'))) assert.ok(r.hacia.startsWith('I'));
  assert.equal(causal.validado, false); // borrador hasta que el autor lo valide
});

test('cadenas críticas: solo áreas en alarma; IJ transversal aparece como origen de las internas', () => {
  const r = construirReporte(ejemplo, q, dep, { causal });
  const ids = r.causal.cadenas.map((c) => c.area.id).sort();
  assert.deepEqual(ids, r.alarmantes.map((a) => a.id).sort().filter((id) => r.causal.cadenas.some((c) => c.area.id === id)));
  const ic = r.causal.cadenas.find((c) => c.area.id === 'IC');
  assert.ok(ic.arrastra.some((x) => x.id === 'IE'));
  assert.ok(ic.origen.some((x) => x.id === 'IA') && ic.origenTransversal?.id === 'IJ');
  const ij = r.causal.cadenas.find((c) => c.area.id === 'IJ');
  assert.ok(ij.arrastraATodas);
});

test('el reporte incluye resumen, cascada, cadenas, exposición, plan y alcances; marca el borrador causal', () => {
  const html = reporteHTML(construirReporte(ejemplo, q, dep, { causal, ahora: '2026-10-29T12:00:00Z' }));
  for (const t of ['Resumen ejecutivo', 'Cascada de efectos', 'Cadenas causales', 'Exposición del entorno', 'Plan de prioridades',
    'Verificar si realmente no aplican', 'Alcances y límites', 'Cómo leer los puntajes', 'Qué tan firme es el veredicto',
    'borrador pendiente de validación', 'Sin multiplicadores monetarios']) assert.ok(html.includes(t), `falta: ${t}`);
  assert.ok(!/Vogel[^<]{0,120}(certific|avala)|(certific|avala)[^<]{0,120}Vogel/i.test(html));
});

test('resumen ejecutivo usa números del análisis', () => {
  const r = construirReporte(ejemplo, q, dep, { causal });
  assert.match(r.resumen.hallazgos[0], /externo.*5,34.*0,34.*5/);
  assert.match(r.resumen.prioridades[0], /IC5.*0,09.*3 cruce/);
  assert.match(r.resumen.riesgo, /4,93.*ENTORNO DESFAVORABLE/);
});
