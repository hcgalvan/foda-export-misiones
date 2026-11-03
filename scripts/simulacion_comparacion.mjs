#!/usr/bin/env node
/**
 * scripts/simulacion_comparacion.mjs
 *
 * Reproduce las cifras de la sección 5 del preprint: compara la conversión por tramos
 * (motor real, frontend/src/engine/calc.js) con una conversión proporcional
 * (puntos = situación/META*10), con el mismo cuestionario, ponderación y umbrales.
 *
 * Datos 100 % SINTÉTICOS. Semilla fija: mismos resultados en cualquier máquina.
 * Uso (desde la raíz del repo):  node scripts/simulacion_comparacion.mjs [N] [semilla]
 */
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { calcularAssessment, PESO_SITUACION, PESO_IMPACTO, META } from '../frontend/src/engine/calc.js';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const q = JSON.parse(fs.readFileSync(path.join(raiz, 'frontend/src/data/questionnaire.json'), 'utf8'));

const N = Number(process.argv[2] || 10000);
let seed = Number(process.argv[3] || 20261102);
// Generador congruencial lineal (Numerical Recipes): determinístico y sin dependencias.
const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };

const ids = [...q.areasInternas, ...q.areasExternas].flatMap((a) => a.items.map((i) => i.id));

function veredicto(ii, ie, hi = 7, lo = 5) {
  if (ii >= hi && ie >= hi) return 'VIABLE';
  if (ii >= lo && ie >= lo) return 'VIABLE_CON_CONDICIONES';
  if (ii < lo && ie >= lo) return 'EMPRESA_NO_LISTA';
  if (ii >= lo && ie < lo) return 'ENTORNO_DESFAVORABLE';
  return 'NO_VIABLE';
}
const ORDEN = ['NO_VIABLE', 'EMPRESA_NO_LISTA', 'ENTORNO_DESFAVORABLE', 'VIABLE_CON_CONDICIONES', 'VIABLE'];

function indicesProporcional(R) {
  const area = (a) => {
    const imp = a.items.map((it) => PESO_IMPACTO[R[it.id].impacto]);
    const s = imp.reduce((x, y) => x + y, 0);
    const v = a.items.reduce((acc, it, k) => acc + (PESO_SITUACION[R[it.id].situacion] / META * 10) * imp[k] / s, 0);
    return Math.round(v * 100) / 100;
  };
  const prom = (as) => as.map(area).reduce((x, y) => x + y, 0) / as.length;
  return [prom(q.areasInternas), prom(q.areasExternas)];
}

let dif = 0, difUmbralesAjustados = 0, propMasBenigno = 0, propMasSevero = 0;
let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
const matriz = {};
for (let n = 0; n < N; n++) {
  const base = rnd() * 3 + 0.5; // "nivel base" por evaluación: genera desde muy malas hasta muy buenas
  const R = {};
  for (const id of ids) {
    let s = Math.round(base + (rnd() - 0.5) * 2.2);
    s = Math.min(4, Math.max(1, s));            // índice de situación 1..4 (Muy desfavorable..Muy favorable)
    R[id] = { situacion: s, impacto: Math.floor(rnd() * 4) }; // impacto 0..3 (peso 1..4)
  }
  const m = calcularAssessment(q, R, undefined, null);
  const [pi, pe] = indicesProporcional(R);
  const vm = m.veredicto, vp = veredicto(pi, pe);
  const k = `${vm} | ${vp}`; matriz[k] = (matriz[k] || 0) + 1;
  if (vm !== vp) {
    dif++;
    ORDEN.indexOf(vp) > ORDEN.indexOf(vm) ? propMasBenigno++ : propMasSevero++;
  }
  if (vm !== veredicto(pi, pe, 8, 6)) difUmbralesAjustados++;
  const x = m.indiceInterno, y = pi;
  sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y;
}
const r = (sxy / N - (sx / N) * (sy / N)) / Math.sqrt((sxx / N - (sx / N) ** 2) * (syy / N - (sy / N) ** 2));

console.log(`N = ${N}  semilla = ${process.argv[3] || 20261102}`);
console.log(`Correlación de índices internos (tramos vs proporcional): r = ${r.toFixed(4)}`);
console.log(`Veredicto distinto con los mismos umbrales (7 y 5): ${dif} (${(dif / N * 100).toFixed(1)} %)`);
console.log(`  proporcional más benigna: ${propMasBenigno} · más severa: ${propMasSevero}`);
console.log(`Veredicto distinto si la proporcional usa umbrales 8 y 6: ${difUmbralesAjustados} (${(difUmbralesAjustados / N * 100).toFixed(1)} %)`);
console.log('Matriz  tramos | proporcional:');
for (const [k, v] of Object.entries(matriz).sort((a, b) => b[1] - a[1])) console.log(`  ${k}: ${v}`);
