// tests/api.test.mjs — Fase 4: cliente de API y cola de reintento (sin red real).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  leerConfig, guardarConfig, configCompleta, leerCola, encolar, vaciarCola,
  guardarEnServidor, cuerpoParaApi,
} from '../frontend/src/api.js';

function storageFalso() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}
const config = { baseUrl: 'https://x.trycloudflare.com', apiKey: 'k' };
const assessment = {
  empresa: { nombre: 'E', rubro: 'R', perfil: 'exporta_actualmente', fecha: '2026-10-14', mercadosObjetivo: [] },
  respuestas: [{ itemId: 'IA1', situacion: 3, impacto: 2, observacion: '' }],
  resultados: { cualquiera: true },
  metadata: { versionCuestionario: '1.1.0' },
};
const ok = (data = { id: 'srv-1', resultados: {} }) => async () => ({ ok: true, status: 201, json: async () => data });
const caido = async () => { throw new Error('network down'); };
const status = (s) => async () => ({ ok: false, status: s, json: async () => ({ detail: 'x' }) });

test('config: guarda, normaliza barra final y detecta completitud', () => {
  const st = storageFalso();
  assert.equal(configCompleta(leerConfig(st)), false);
  guardarConfig({ baseUrl: ' https://a.b/// ', apiKey: ' k ' }, st);
  assert.deepEqual(leerConfig(st), { baseUrl: 'https://a.b', apiKey: 'k' });
  assert.equal(configCompleta(leerConfig(st)), true);
});

test('cuerpoParaApi NO incluye resultados (el servidor recalcula)', () => {
  const b = cuerpoParaApi(assessment);
  assert.equal('resultados' in b, false);
  assert.equal(b.versionCuestionario, '1.1.0');
});

test('envío exitoso vacía la cola', async () => {
  const st = storageFalso();
  const r = await guardarEnServidor(config, assessment, st, ok());
  assert.equal(r.enviados.length, 1);
  assert.equal(r.pendientes, 0);
  assert.equal(leerCola(st).length, 0);
});

test('sin red: la evaluación queda en la cola (no se pierde) y se reintenta después', async () => {
  const st = storageFalso();
  let r = await guardarEnServidor(config, assessment, st, caido);
  assert.equal(r.pendientes, 1);
  const cola = leerCola(st);
  assert.equal(cola[0].intentos, 1);
  assert.equal(cola[0].reintentable, true);
  assert.match(cola[0].ultimoError, /Sin conexión/);
  r = await vaciarCola(config, st, ok());
  assert.equal(r.enviados.length, 1);
  assert.equal(leerCola(st).length, 0);
});

test('401 queda en la cola marcado como NO reintentable (hay que corregir la clave)', async () => {
  const st = storageFalso();
  await guardarEnServidor(config, assessment, st, status(401));
  const [item] = leerCola(st);
  assert.equal(item.reintentable, false);
  assert.match(item.ultimoError, /401/);
});

test('500 es reintentable', async () => {
  const st = storageFalso();
  await guardarEnServidor(config, assessment, st, status(500));
  assert.equal(leerCola(st)[0].reintentable, true);
});

test('varias evaluaciones encoladas se envían todas', async () => {
  const st = storageFalso();
  encolar(cuerpoParaApi(assessment), st);
  encolar(cuerpoParaApi(assessment), st);
  const r = await vaciarCola(config, st, ok());
  assert.equal(r.enviados.length, 2);
  assert.equal(r.pendientes, 0);
});
