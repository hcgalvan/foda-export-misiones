// tests/api.test.mjs — Fase 4: cliente de API y cola de reintento (sin red real).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  leerConfig, guardarConfig, configCompleta, leerCola, encolar, vaciarCola,
  guardarEnServidor, cuerpoParaApi, listarResumen, obtener, probarConexion,
} from '../frontend/src/api.js';

function storageFalso() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}
const config = { baseUrl: 'https://x.trycloudflare.com', apiKey: 'k' };
const ID = '0e2ceb97-46b2-4704-b439-2d1257b0b042';
const assessment = {
  id: ID,
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
  encolar('11111111-1111-4111-8111-111111111111', cuerpoParaApi(assessment), st);
  encolar('22222222-2222-4222-8222-222222222222', cuerpoParaApi(assessment), st);
  const r = await vaciarCola(config, st, ok());
  assert.equal(r.enviados.length, 2);
  assert.equal(r.pendientes, 0);
});

test('guardar usa PUT /assessments/{id} con la API key', async () => {
  const st = storageFalso();
  let visto;
  const espia = async (url, opts) => { visto = { url, opts }; return { ok: true, status: 200, json: async () => ({ id: ID, resultados: {} }) }; };
  await guardarEnServidor(config, assessment, st, espia);
  assert.equal(visto.url, `${config.baseUrl}/assessments/${ID}`);
  assert.equal(visto.opts.method, 'PUT');
  assert.equal(visto.opts.headers['X-API-Key'], 'k');
});

test('guardar la misma evaluación varias veces sin red deja UNA sola entrada en la cola (no duplica)', async () => {
  const st = storageFalso();
  await guardarEnServidor(config, assessment, st, caido);
  await guardarEnServidor(config, { ...assessment, empresa: { ...assessment.empresa, nombre: 'Nueva' } }, st, caido);
  await guardarEnServidor(config, assessment, st, caido);
  const cola = leerCola(st);
  assert.equal(cola.length, 1);
});

test('compatibilidad: un ítem de cola viejo (sin id, con localId) se envía igual', async () => {
  const st = storageFalso();
  st.setItem('foda-export-misiones:outbox-v1', JSON.stringify([{ localId: ID, body: cuerpoParaApi(assessment), intentos: 0, creadoEn: 'x' }]));
  let url;
  const r = await vaciarCola(config, st, async (u) => { url = u; return { ok: true, status: 200, json: async () => ({ id: ID, resultados: {} }) }; });
  assert.equal(r.enviados.length, 1);
  assert.match(url, new RegExp(ID));
});

test('listarResumen y obtener mandan la API key y devuelven los datos', async () => {
  const llamadas = [];
  const f = async (u, o) => { llamadas.push([u, o.headers['X-API-Key']]); return { ok: true, status: 200, json: async () => [{ id: ID }] }; };
  const l = await listarResumen(config, f);
  const o = await obtener(config, ID, f);
  assert.equal(l.ok, true);
  assert.equal(o.ok, true);
  assert.deepEqual(llamadas.map((c) => c[0]), [`${config.baseUrl}/assessments/resumen`, `${config.baseUrl}/assessments/${ID}`]);
  assert.ok(llamadas.every((c) => c[1] === 'k'));
});

test('probarConexion distingue: sin API / key mala / todo bien', async () => {
  const sinApi = await probarConexion(config, caido);
  assert.equal(sinApi.ok, false);
  assert.match(sinApi.pasos[0], /No se llegó a la API/);
  const keyMala = await probarConexion(config, async (u) =>
    u.endsWith('/health') ? { ok: true, status: 200, json: async () => ({}) } : { ok: false, status: 401, json: async () => ({ detail: 'x' }) });
  assert.equal(keyMala.ok, false);
  assert.match(keyMala.pasos.join(' '), /401/);
  const bien = await probarConexion(config, async (u) => ({ ok: true, status: 200, json: async () => (u.endsWith('/health') ? {} : [{}, {}]) }));
  assert.equal(bien.ok, true);
  assert.equal(bien.cantidad, 2);
});
