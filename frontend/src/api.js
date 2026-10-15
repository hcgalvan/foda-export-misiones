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

/**
 * Un POST. Devuelve { ok:true, data } | { ok:false, reintentable, error }.
 * Errores de red y 5xx son reintentables; 4xx (clave mala, datos inválidos)
 * no: reintentar igual no lo arregla, hay que corregir la causa.
 */
export async function enviar(config, body, fetchFn = globalThis.fetch) {
  try {
    const r = await fetchFn(config.baseUrl + '/assessments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': config.apiKey },
      body: JSON.stringify(body),
    });
    if (r.ok) return { ok: true, data: await r.json() };
    let detalle = '';
    try { detalle = JSON.stringify((await r.json()).detail); } catch { /* sin cuerpo */ }
    return {
      ok: false,
      reintentable: r.status >= 500,
      error: `HTTP ${r.status}${r.status === 401 ? ' (API key inválida)' : ''} ${detalle}`.trim(),
    };
  } catch (e) {
    return { ok: false, reintentable: true, error: 'Sin conexión con la API (' + (e?.message || e) + ')' };
  }
}

/** Encola un body (siempre, antes de intentar enviar: así nada se pierde). */
export function encolar(body, storage = globalThis.localStorage, ahora = () => new Date().toISOString()) {
  const cola = leerCola(storage);
  const item = {
    localId: (globalThis.crypto?.randomUUID?.() ?? String(Date.now()) + Math.random()),
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
    const r = await enviar(config, item.body, fetchFn);
    if (r.ok) {
      enviados.push({ localId: item.localId, id: r.data.id, resultados: r.data.resultados });
    } else {
      restantes.push({
        ...item,
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
  encolar(cuerpoParaApi(assessment), storage);
  return vaciarCola(config, storage, fetchFn);
}
