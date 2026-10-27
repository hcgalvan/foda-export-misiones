// tests/report.test.mjs — Reporte "Diagnóstico de viabilidad exportadora".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { construirReporte, reporteHTML, esc, num } from '../frontend/src/report.js';

const leer = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'));
const q = leer('../frontend/src/data/questionnaire.json');
const dep = leer('../frontend/src/data/dependenciasFoda.json');
const ejemplo = leer('./fixtures/ejemplo_prueba_1.json'); // exportado desde la app en Netlify el 27/10/2026
const AHORA = '2026-10-27T12:00:00Z';

test('el recálculo del reporte coincide con los resultados que exportó la app (Netlify)', () => {
  const r = construirReporte(ejemplo, q, dep, { ahora: AHORA });
  assert.deepEqual(r.advertencias, []);
  assert.equal(r.indices.interno, ejemplo.resultados.indiceInterno);
  assert.equal(r.indices.externo, ejemplo.resultados.indiceExterno);
  assert.equal(r.veredicto.codigo, ejemplo.resultados.veredicto);
  assert.equal(r.matriz.cuadranteDominante, ejemplo.resultados.matrizFoda.cuadranteDominante);
  assert.deepEqual(r.matriz.cruces, ejemplo.resultados.matrizFoda.cruces);
  for (const a of ejemplo.resultados.porArea) {
    const mio = r.areas.find((x) => x.id === a.areaId);
    assert.equal(mio.puntaje, a.puntaje, a.areaId);
    assert.equal(mio.semaforo, a.semaforo, a.areaId);
    assert.equal(mio.alertas, a.alertas, a.areaId);
  }
});

test('conteos coherentes: 110 ítems, clases de factor y "No corresponde"', () => {
  const r = construirReporte(ejemplo, q, dep, { ahora: AHORA });
  assert.equal(r.items.length, 110);
  const f = r.factores;
  assert.equal(f.fortalezas.length + f.debilidades.length + f.oportunidades.length + f.amenazas.length + r.noCorresponde.length + r.sinResponder.length, 110);
  assert.equal(r.progreso.respondidos, 110); // "No corresponde" cuenta como valorado: el motor lo puntúa (validado contra el Excel)
  assert.deepEqual(r.noCorresponde.map((i) => i.id).sort(), ['IE3', 'II2', 'IJ7']); // situacion = 0 en el JSON
  assert.equal(r.sinResponder.length, 0);
  assert.ok(f.debilidades.every((i) => i.ambito === 'interno' && i.situacionIdx <= 2));
  assert.ok(f.amenazas.every((i) => i.ambito === 'externo' && i.situacionIdx <= 2));
});

test('orden editorial: debilidades por impacto desc y luego puntaje asc', () => {
  const d = construirReporte(ejemplo, q, dep, { ahora: AHORA }).factores.debilidades;
  for (let k = 1; k < d.length; k++) {
    const a = d[k - 1], b = d[k];
    assert.ok(a.impactoIdx > b.impactoIdx || (a.impactoIdx === b.impactoIdx && a.puntos <= b.puntos));
  }
});

test('avisa si los resultados guardados no coinciden con el recálculo', () => {
  const adulterado = structuredClone(ejemplo);
  adulterado.resultados.indiceInterno = 9.9;
  assert.equal(construirReporte(adulterado, q, dep).advertencias.length, 1);
});

test('el HTML contiene las secciones, datos y atribución; no afirma certificación', () => {
  const html = reporteHTML(construirReporte(ejemplo, q, dep, { ahora: AHORA }));
  for (const t of ['Diagnóstico de viabilidad exportadora', 'Prueba 1', 'VIABLE CON CONDICIONES', '5,50', '5,34',
    'Matriz FODA', 'Cuadrante dominante: DA', 'Anexo A', 'Anexo B', 'adaptado de la metodología FODA Matemático (Prof. Mario Héctor Vogel',
    '<svg']) {
    assert.ok(html.includes(t) || html.includes(t.replace('adaptado', 'Adaptado')) || html.toLowerCase().includes(t.toLowerCase()), `falta: ${t}`);
  }
  assert.ok(!/Vogel[^<]{0,120}(certific|avala|aval )|(certific|avala)[^<]{0,120}Vogel/i.test(html), 'no debe afirmar que Vogel certificó/avaló');
  assert.ok(!/FODA Matemático"?\s*(propio|de Galván)/i.test(html));
});

test('escapa HTML en nombre de empresa y observaciones (sin inyección)', () => {
  const a = structuredClone(ejemplo);
  a.empresa.nombre = '<img src=x onerror=alert(1)>';
  a.respuestas[0].observacion = '<script>alert(2)</script>';
  const html = reporteHTML(construirReporte(a, q, dep));
  assert.ok(!html.includes('<img src=x'));
  assert.ok(!html.includes('<script>alert(2)'));
  assert.ok(html.includes('&lt;img src=x'));
});

test('evaluación vacía: veredicto DATOS_INCOMPLETOS y el HTML se genera igual', () => {
  const vacia = { id: null, empresa: { nombre: '' }, respuestas: [], metadata: {} };
  const r = construirReporte(vacia, q, dep);
  assert.equal(r.veredicto.codigo, 'DATOS_INCOMPLETOS');
  const html = reporteHTML(r);
  assert.ok(html.includes('DATOS INCOMPLETOS'));
});

test('formato numérico es-AR determinista', () => {
  assert.equal(num(5.5), '5,50');
  assert.equal(num(6.9999, 1), '7,0');
  assert.equal(esc('a&b"<'), 'a&amp;b&quot;&lt;');
});
