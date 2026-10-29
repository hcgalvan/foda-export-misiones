/**
 * frontend/src/analisis.js — Análisis de decisión para el reporte.
 *
 * Todo número sale del motor (calc.js): se SIMULAN respuestas alternativas y se
 * recalcula con `calcularAssessment`. No hay parámetros propios ni multiplicadores.
 * Lo único editorial es la REGLA DE PRIORIDAD (declarada abajo y en el reporte).
 *
 * Regla de prioridad (decisión del autor, 28/10/2026): las debilidades internas se
 * ordenan por (1) mejora del índice interno si el ítem pasara a Favorable
 * (redondeada a 2 decimales), (2) cantidad de cruces DA que se resuelven,
 * (3) impacto, (4) id. Los ítems "No corresponde" NO entran en las prioridades:
 * se listan aparte para verificar si realmente no aplican (el motor los puntúa con 1).
 */

import { calcularAssessment, calcularItem, UMBRALES_DEFAULT } from './engine/calc.js';

export const FAVORABLE = 3;       // índice de "Favorable" en la escala de situación
export const MAX_AHORA = 5;
export const MAX_SIGUIENTE = 5;
export const MAX_VIGILAR = 5;

const r2 = (x) => Math.round(x * 100) / 100;
const esDebil = (r) => r && r.situacion != null && r.situacion >= 1 && r.situacion <= 2 && r.impacto != null;

function indicesDeAreas(q) {
  const areaDe = {};
  for (const a of [...q.areasInternas, ...q.areasExternas]) for (const it of a.items) areaDe[it.id] = a;
  return areaDe;
}

function simular(q, R, dep, umbrales, cambios) {
  const R2 = structuredClone(R);
  for (const [id, sit] of Object.entries(cambios)) R2[id] = { ...R2[id], situacion: sit };
  return calcularAssessment(q, R2, umbrales, dep);
}

function resumenEscenario(res) {
  return {
    indiceInterno: res.indiceInterno, indiceExterno: res.indiceExterno, veredicto: res.veredicto,
    cuadrante: res.matrizFoda?.cuadranteDominante ?? null, cruces: res.matrizFoda?.cruces ?? null,
  };
}

/** Escala real de puntos por respuesta, tomada del motor (no escrita a mano). */
export function escalaPuntos(q) {
  const filas = q.escalas.situacion.map((nombre, i) => ({
    nombre, puntos: Math.round(calcularItem({ situacion: i, impacto: 0 }).puntos0a10),
  }));
  return filas;
}

/** Distancia de un índice a los umbrales vecinos (hacia arriba y hacia abajo). */
export function margen(valor, umbrales) {
  const cortes = [umbrales.viableConCondiciones, umbrales.viable].sort((a, b) => a - b);
  const abajo = [...cortes].reverse().find((c) => c <= valor);
  const arriba = cortes.find((c) => c > valor);
  return {
    valor,
    umbralInferior: abajo ?? null, distanciaAlInferior: abajo != null ? r2(valor - abajo) : null,
    umbralSuperior: arriba ?? null, distanciaAlSuperior: arriba != null ? r2(arriba - valor) : null,
  };
}

export function analizar(q, dep, R, res, umbrales = UMBRALES_DEFAULT) {
  if (!res || res.veredicto === 'DATOS_INCOMPLETOS' || !res.matrizFoda) return null;
  const areaDe = indicesDeAreas(q);
  const reverso = {}; // externo -> [internos vinculados]
  for (const [i, exs] of Object.entries(dep)) for (const e of exs) (reverso[e] ||= []).push(i);
  const items = (ids) => ids.filter((id) => R[id]);

  // --- palancas: debilidades internas -------------------------------------------------
  const base = res.matrizFoda;
  const palancas = [];
  for (const [id, r] of Object.entries(R)) {
    const a = areaDe[id];
    if (!a || a.tipo !== 'interno' || !esDebil(r)) continue;
    const sim = simular(q, R, dep, umbrales, { [id]: FAVORABLE });
    const it = a.items.find((x) => x.id === id);
    palancas.push({
      id, areaId: a.id, areaNombre: a.nombre, titulo: it.titulo, criterioFavorable: it.criterioFavorable,
      situacionIdx: r.situacion, impactoIdx: r.impacto,
      puntos: res.porItem.find((p) => p.itemId === id).puntos0a10,
      mejoraIndice: r2(sim.indiceInterno - res.indiceInterno),
      crucesDAResueltos: Math.max(0, base.cruces.DA - sim.matrizFoda.cruces.DA),
      crucesDOResueltos: Math.max(0, base.cruces.DO - sim.matrizFoda.cruces.DO),
      crucesTotales: (dep[id] || []).length,
    });
  }
  palancas.sort((a, b) =>
    (b.mejoraIndice - a.mejoraIndice) || (b.crucesDAResueltos - a.crucesDAResueltos) ||
    (b.impactoIdx - a.impactoIdx) || a.id.localeCompare(b.id));

  const ahora = palancas.slice(0, MAX_AHORA);
  const siguiente = palancas.slice(MAX_AHORA, MAX_AHORA + MAX_SIGUIENTE);
  const despues = palancas.slice(MAX_AHORA + MAX_SIGUIENTE);

  // --- verificar "No corresponde" -----------------------------------------------------
  const verificar = Object.entries(R)
    .filter(([, r]) => r.situacion === 0 && r.impacto != null)
    .map(([id]) => {
      const a = areaDe[id]; const it = a.items.find((x) => x.id === id);
      return { id, areaId: a.id, areaNombre: a.nombre, ambito: a.tipo, titulo: it.titulo, quienResponde: it.quienResponde, lecturaSinExportar: it.lecturaSinExportar };
    });

  // --- escenarios (solo simulaciones del motor) ---------------------------------------
  const debilesInternas = Object.entries(R).filter(([id, r]) => areaDe[id]?.tipo === 'interno' && esDebil(r));
  const alarmantes = new Set(res.porArea.filter((a) => a.ambito === 'interno' && a.semaforo === 'Alarmante').map((a) => a.areaId));
  const defs = [
    { clave: 'A', tipo: 'mejora', nombre: 'Corregir las áreas internas en alarma',
      detalle: `Debilidades de ${[...alarmantes].join(', ') || '—'} pasan a Favorable.`,
      cambios: debilesInternas.filter(([id]) => alarmantes.has(areaDe[id].id)).map(([id]) => id) },
    { clave: 'B', tipo: 'mejora', nombre: 'Corregir las debilidades de impacto máximo',
      detalle: 'Debilidades internas de impacto "Muy significante" pasan a Favorable.',
      cambios: debilesInternas.filter(([, r]) => r.impacto === 3).map(([id]) => id) },
    { clave: 'C', tipo: 'mejora', nombre: 'Corregir todas las debilidades internas',
      detalle: 'Todas las debilidades internas pasan a Favorable.',
      cambios: debilesInternas.map(([id]) => id) },
  ];
  const escenarios = defs.filter((d) => d.cambios.length > 0).map((d) => ({
    ...d, itemsModificados: d.cambios.length,
    resultado: resumenEscenario(simular(q, R, dep, umbrales, Object.fromEntries(d.cambios.map((id) => [id, FAVORABLE])))),
  }));
  escenarios.forEach((e) => { delete e.cambios; });

  // riesgos del entorno (no controlables)
  const ext = Object.entries(R).filter(([id, r]) => areaDe[id]?.tipo === 'externo' && r.situacion != null && r.impacto != null);
  const riesgos = [];
  const cambiosA = ext.filter(([, r]) => r.situacion === 2 && r.impacto === 3).map(([id]) => id);
  if (cambiosA.length) {
    riesgos.push({ clave: 'R1', nombre: 'Las amenazas externas de impacto máximo empeoran un nivel',
      detalle: 'Factores externos "Desfavorable" de impacto "Muy significante" pasan a "Muy desfavorable".',
      itemsModificados: cambiosA.length,
      resultado: resumenEscenario(simular(q, R, dep, umbrales, Object.fromEntries(cambiosA.map((id) => [id, 1])))) });
  }
  const cambiosB = ext.filter(([, r]) => r.situacion >= 2).map(([id, r]) => [id, r.situacion - 1]);
  if (cambiosB.length) {
    riesgos.push({ clave: 'R2', nombre: 'Deterioro general del entorno',
      detalle: 'Todos los factores externos valorados bajan un nivel en la escala.',
      itemsModificados: cambiosB.length,
      resultado: resumenEscenario(simular(q, R, dep, umbrales, Object.fromEntries(cambiosB))) });
  }

  // --- exposición externa -------------------------------------------------------------
  const expo = (id) => {
    const a = areaDe[id]; const it = a.items.find((x) => x.id === id);
    const vinculados = reverso[id] || [];
    return {
      id, areaId: a.id, areaNombre: a.nombre, titulo: it.titulo, situacionIdx: R[id].situacion, impactoIdx: R[id].impacto,
      puntos: res.porItem.find((p) => p.itemId === id).puntos0a10,
      internosVinculados: vinculados.length,
      internosDebiles: vinculados.filter((i) => esDebil(R[i])).length,
    };
  };
  const ordExt = (a, b) => (b.internosVinculados - a.internosVinculados) || (b.impactoIdx - a.impactoIdx) || (a.puntos - b.puntos) || a.id.localeCompare(b.id);
  const amenazas = ext.filter(([, r]) => r.situacion >= 1 && r.situacion <= 2).map(([id]) => expo(id)).sort(ordExt);
  const sostienen = ext.filter(([, r]) => r.situacion >= 3).map(([id]) => expo(id)).sort(ordExt);

  // --- pesos desiguales de las áreas -------------------------------------------------
  const porAmbito = (amb) => res.porArea.filter((a) => a.ambito === amb && a.itemsRespondidos > 0);
  const pesoItem = (a, amb) => 1 / (porAmbito(amb).length * a.itemsRespondidos); // aprox. con impactos iguales
  const nota = [];
  for (const amb of ['interno', 'externo']) {
    const as = porAmbito(amb);
    if (as.length < 2) continue;
    const mayor = as.reduce((m, a) => (pesoItem(a, amb) > pesoItem(m, amb) ? a : m));
    const menor = as.reduce((m, a) => (pesoItem(a, amb) < pesoItem(m, amb) ? a : m));
    const ratio = pesoItem(mayor, amb) / pesoItem(menor, amb);
    if (ratio >= 2) nota.push({ ambito: amb, areaPesada: mayor.areaId, itemsPesada: mayor.itemsRespondidos, areaLiviana: menor.areaId, itemsLiviana: menor.itemsRespondidos, ratio: r2(ratio) });
  }

  return {
    margenes: { interno: margen(res.indiceInterno, umbrales), externo: margen(res.indiceExterno, umbrales) },
    escalaPuntos: escalaPuntos(q),
    palancas, horizontes: { ahora, siguiente, despues },
    verificar, escenarios, riesgos,
    exposicion: { amenazas: amenazas.slice(0, MAX_VIGILAR), sostienen: sostienen.slice(0, 4), totalAmenazas: amenazas.length },
    pesosDesiguales: nota,
    // para "alcanzar Viable"
    brechaViable: {
      interno: r2(Math.max(0, umbrales.viable - res.indiceInterno)),
      externo: r2(Math.max(0, umbrales.viable - res.indiceExterno)),
    },
  };
}

// ---------------------------------------------------------------------------
// Capa causal (interpretativa, NO calculada): relacionesCausales.json
// ---------------------------------------------------------------------------

/** Cadenas críticas: para cada área en alarma, qué arrastra y qué la origina. */
export function cadenasCriticas(areas, causal) {
  const porId = new Map(areas.map((a) => [a.id, a]));
  const internas = areas.filter((a) => a.ambito === 'interno').map((a) => a.id);
  const rels = [];
  for (const r of causal.relaciones) {
    const destinos = r.hacia === 'INTERNAS' ? internas.filter((id) => id !== r.desde) : [r.hacia];
    for (const d of destinos) if (porId.has(r.desde) && porId.has(d)) rels.push({ desde: r.desde, hacia: d, texto: r.texto, todas: r.hacia === 'INTERNAS' });
  }
  const estado = (id) => { const a = porId.get(id); return { id, nombre: a.nombre, puntaje: a.puntaje, semaforo: a.semaforo }; };
  return areas.filter((a) => a.semaforo === 'Alarmante' && a.respondidos > 0).map((a) => ({
    area: estado(a.id),
    arrastra: rels.filter((r) => r.desde === a.id && !r.todas).map((r) => ({ ...estado(r.hacia), texto: r.texto })),
    arrastraATodas: rels.filter((r) => r.desde === a.id && r.todas).length > 0
      ? { texto: rels.find((r) => r.desde === a.id && r.todas).texto } : null,
    origen: rels.filter((r) => r.hacia === a.id && !r.todas).map((r) => ({ ...estado(r.desde), texto: r.texto })),
    origenTransversal: rels.some((r) => r.hacia === a.id && r.todas)
      ? { ...estado(rels.find((r) => r.hacia === a.id && r.todas).desde), texto: rels.find((r) => r.hacia === a.id && r.todas).texto } : null,
  })).filter((c) => c.arrastra.length || c.origen.length || c.arrastraATodas || c.origenTransversal);
}
