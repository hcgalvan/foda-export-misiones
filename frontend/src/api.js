// frontend/src/api.js — Fase 4: cliente de la API + cola local de reintento.
//
// Lógica pura (sin Alpine ni DOM, salvo localStorage/fetch inyectables) para
// poder testearla con node --test (ver tests/api.test.mjs).
//
// Decisiones (ARCHITECTURE.md §1.1 y §6 riesgo 5):
//  - La URL base de la API NO está en el build: vive en localStorage y se
//    edita desde "Configuración" (el Quick Tunnel cambia de URL al reiniciar).
//  - Guardar en el servidor nunca es obligatorio: la app sigue funcionando
//    offline-first. Si el POST falla, la evaluación queda en una cola local
//    ("outbox") y se reintenta; nada se pierde.
//  - El cliente NO manda `resultados`: el servidor recalcula (engine_replica).
//  - Cada evaluación tiene un id estable (UUID) y se guarda con PUT: guardar
//    dos veces la misma evaluación la ACTUALIZA, no la duplica.

export const CLAVE_CONFIG = 'foda-export-misiones:api-config-v1';
export const CLAVE_COLA = 'foda-export-misiones:outbox-v1';

export function leerConfig(storage = globalThis.localStorage) {
  try {
    const c = JSON.parse(storage.getItem(CLAVE_CONFIG) || '{}');
    return { baseUrl: c.baseUrl || '', apiKey: c.apiKey || '' };
  } catch {
    return { baseUrl: '', apiKey: '' };
  }
}

export function guardarConfig(config, storage = globalThis.localStorage) {
  const limpia = {
    baseUrl: String(config.baseUrl || '').trim().replace(/\/+$/, ''),
    apiKey: String(config.apiKey || '').trim(),
  };
  storage.setItem(CLAVE_CONFIG, JSON.stringify(limpia));
  return limpia;
}

export function configCompleta(config) {
  return Boolean(config.baseUrl && config.apiKey);
}

export function leerCola(storage = globalThis.localStorage) {
  try {
    const c = JSON.parse(storage.getItem(CLAVE_COLA) || '[]');
    return Array.isArray(c) ? c : [];
  } catch {
    return [];
  }
}

function guardarCola(cola, storage) {
  storage.setItem(CLAVE_COLA, JSON.stringify(cola));
}

/** Arma el body del POST a partir del assessment que construye app.js. */
export function cuerpoParaApi(assessment) {
  return {
    empresa: assessment.empresa,
    respuestas: assessment.respuestas,
    versionCuestionario: assessment.metadata.versionCuestionario,
  };
}

/** Clasifica una respuesta HTTP fallida en un mensaje entendible. */
async function errorDeRespuesta(r) {
  let detalle = '';
  try { detalle = JSON.stringify((await r.json()).detail); } catch { /* sin cuerpo */ }
  const pista = { 401: ' (API key inválida)', 409: ' (ese id pertenece a otro equipo)' }[r.status] || '';
  return `HTTP ${r.status}${pista} ${detalle}`.trim();
}

const ERROR_RED = (e) =>
  'Sin conexión con la API (' + (e?.message || e) + '). Revisá la URL, que el túnel esté activo y que el origen de esta página esté en FODA_CORS_ORIGINS.';

/**
 * Guarda (crea o actualiza) UNA evaluación: PUT /assessments/{id}, idempotente.
 * Devuelve { ok:true, data } | { ok:false, reintentable, error }.
 * Errores de red y 5xx son reintentables; 4xx (clave mala, datos inválidos)
 * no: reintentar igual no lo arregla, hay que corregir la causa.
 */
export async function enviar(config, id, body, fetchFn = globalThis.fetch) {
  try {
    const r = await fetchFn(`${config.baseUrl}/assessments/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': config.apiKey },
      body: JSON.stringify(body),
    });
    if (r.ok) return { ok: true, data: await r.json() };
    return { ok: false, reintentable: r.status >= 500, error: await errorDeRespuesta(r) };
  } catch (e) {
    return { ok: false, reintentable: true, error: ERROR_RED(e) };
  }
}

async function get(config, ruta, fetchFn) {
  try {
    const r = await fetchFn(config.baseUrl + ruta, { headers: { 'X-API-Key': config.apiKey } });
    if (r.ok) return { ok: true, data: await r.json() };
    return { ok: false, error: await errorDeRespuesta(r) };
  } catch (e) {
    return { ok: false, error: ERROR_RED(e) };
  }
}

/** Lista liviana de las evaluaciones del equipo (GET /assessments/resumen). */
export const listarResumen = (config, fetchFn = globalThis.fetch) => get(config, '/assessments/resumen', fetchFn);

/** Una evaluación completa (GET /assessments/{id}). */
export const obtener = (config, id, fetchFn = globalThis.fetch) => get(config, `/assessments/${id}`, fetchFn);

/**
 * "Probar conexión": distingue los tres problemas típicos (túnel/URL, CORS,
 * API key) en vez de dar un error genérico. Devuelve { ok, pasos:[...] }.
 */
export async function probarConexion(config, fetchFn = globalThis.fetch) {
  const pasos = [];
  const salud = await get(config, '/health', fetchFn);
  pasos.push(salud.ok ? 'API alcanzable (/health responde).' : 'No se llegó a la API: ' + salud.error);
  if (!salud.ok) return { ok: false, pasos };
  const lista = await listarResumen(config, fetchFn);
  if (!lista.ok) {
    pasos.push('API key / permisos: ' + lista.error);
    return { ok: false, pasos };
  }
  pasos.push(`API key válida. Evaluaciones guardadas en este equipo: ${lista.data.length}.`);
  return { ok: true, pasos, cantidad: lista.data.length };
}

/** Encola un body (siempre, antes de intentar enviar: así nada se pierde). */
export function encolar(id, body, storage = globalThis.localStorage, ahora = () => new Date().toISOString()) {
  // Una sola entrada por evaluación: si ya hay una pendiente con este id, se
  // reemplaza por la versión más nueva (no tiene sentido enviar la vieja).
  const cola = leerCola(storage).filter((i) => i.id !== id);
  const item = {
    id,
    localId: id,
    body,
    creadoEn: ahora(),
    intentos: 0,
    ultimoError: null,
    reintentable: true,
  };
  cola.push(item);
  guardarCola(cola, storage);
  return item.localId;
}

/**
 * Intenta enviar todo lo pendiente de la cola. Quita los enviados y deja
 * (con su último error) los que fallaron. Devuelve { enviados, pendientes }.
 */
export async function vaciarCola(config, storage = globalThis.localStorage, fetchFn = globalThis.fetch) {
  const cola = leerCola(storage);
  const restantes = [];
  const enviados = [];
  for (const item of cola) {
    // Un item con error NO reintentable (4xx) se reintenta solo si el usuario
    // lo pide (p. ej. después de corregir la API key): acá se reintenta todo
    // porque vaciarCola solo corre por acción explícita o al recuperar red.
    // Compatibilidad: ítems encolados por la versión anterior no tenían `id`
    // (usaban localId, que ya era un UUID).
    const id = item.id || item.localId;
    const r = await enviar(config, id, item.body, fetchFn);
    if (r.ok) {
      enviados.push({ id, resultados: r.data.resultados });
    } else {
      restantes.push({
        ...item,
        id,
        intentos: item.intentos + 1,
        ultimoError: r.error,
        reintentable: r.reintentable,
      });
    }
  }
  guardarCola(restantes, storage);
  return { enviados, pendientes: restantes.length };
}

/** Atajo: encola y lo intenta enviar en el momento. */
export async function guardarEnServidor(config, assessment, storage = globalThis.localStorage, fetchFn = globalThis.fetch) {
  encolar(assessment.id, cuerpoParaApi(assessment), storage);
  return vaciarCola(config, storage, fetchFn);
}
