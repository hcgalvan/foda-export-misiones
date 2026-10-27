/**
 * frontend/src/report.js — Reporte "Diagnóstico de viabilidad exportadora".
 *
 * Dos capas, ambas sin dependencias externas (se prueban con `node --test`):
 *   1. construirReporte(assessment, questionnaire, dependenciasFoda) → modelo de datos.
 *      RECALCULA todo con el motor (calc.js) a partir de las respuestas; si el
 *      assessment trae `resultados` guardados y difieren, lo avisa en `advertencias`.
 *   2. reporteHTML(modelo) → HTML (con gráficos SVG en línea) listo para imprimir.
 *
 * Criterio: el reporte NO inventa cálculos. Todo número sale del motor; lo único
 * "editorial" son (a) los textos de lectura por veredicto y (b) el orden en que se
 * listan los factores (impacto desc., puntaje asc.), ambos marcados como tales en
 * el propio reporte. Esos textos son decisión del autor: ver ARCHITECTURE.md §9.
 */

import {
  calcularAssessment, calcularItem, clasificarFactor, UMBRALES_DEFAULT,
} from './engine/calc.js';

// ---------------------------------------------------------------------------
// Textos editoriales (decisión abierta del autor; ver ARCHITECTURE.md §9)
// ---------------------------------------------------------------------------

export const TEXTO_VEREDICTO = {
  VIABLE: {
    titulo: 'VIABLE',
    lectura: 'Tanto las condiciones internas de la empresa como las del entorno alcanzan el nivel requerido para exportar. Conviene pasar a planificar la entrada al mercado y sostener las áreas de menor puntaje.',
  },
  VIABLE_CON_CONDICIONES: {
    titulo: 'VIABLE CON CONDICIONES',
    lectura: 'La empresa y el entorno superan el mínimo exigido, pero al menos uno no llega al nivel de plena viabilidad. Exportar es posible si se atienden primero las áreas en estado de alarma y los factores críticos que se detallan más abajo.',
  },
  EMPRESA_NO_LISTA: {
    titulo: 'EMPRESA NO LISTA',
    lectura: 'El entorno es suficientemente favorable, pero la preparación interna de la empresa está por debajo del mínimo. La prioridad es fortalecer las áreas internas críticas antes de salir a exportar.',
  },
  ENTORNO_DESFAVORABLE: {
    titulo: 'ENTORNO DESFAVORABLE',
    lectura: 'La empresa tiene una preparación interna suficiente, pero las condiciones del entorno y del mercado de destino están por debajo del mínimo. Conviene revisar mercados alternativos, condiciones de acceso o esperar un cambio de contexto.',
  },
  NO_VIABLE: {
    titulo: 'NO VIABLE (por ahora)',
    lectura: 'Ni la preparación interna ni las condiciones del entorno alcanzan el mínimo. No se recomienda exportar en las condiciones actuales; el diagnóstico sirve para ordenar qué debería cambiar primero.',
  },
  DATOS_INCOMPLETOS: {
    titulo: 'DATOS INCOMPLETOS',
    lectura: 'No hay respuestas suficientes para calcular un índice interno y uno externo. Completá el cuestionario para obtener el veredicto.',
  },
};

export const PERFIL_TEXTO = {
  exporta_actualmente: 'Exporta actualmente',
  exporto_antes: 'Exportó anteriormente',
  no_exporta_evalua_iniciar: 'No exporta; evalúa iniciar',
  no_exporta_sin_interes: 'No exporta; sin interés actual',
};

const CLASE_POR_AMBITO = {
  interno: { positivo: 'Fortaleza', negativo: 'Debilidad' },
  externo: { positivo: 'Oportunidad', negativo: 'Amenaza' },
};

export const MAX_FACTORES_DESTACADOS = 8;

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

export function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Número con coma decimal (es-AR) y N decimales fijos. Determinista (no usa Intl). */
export function num(x, dec = 2) {
  if (x == null || Number.isNaN(x)) return '—';
  return Number(x).toFixed(dec).replace('.', ',');
}

export function pct(x, dec = 1) {
  return x == null ? '—' : `${num(x * 100, dec)} %`;
}

function fechaLarga(iso) {
  if (!iso) return '—';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

// ---------------------------------------------------------------------------
// 1. Modelo de datos
// ---------------------------------------------------------------------------

export function construirReporte(assessment, questionnaire, dependenciasFoda, opciones = {}) {
  const ahora = opciones.ahora ?? new Date().toISOString();
  const umbrales = opciones.umbrales ?? UMBRALES_DEFAULT;

  const respuestasPorItem = {};
  for (const r of assessment.respuestas || []) {
    respuestasPorItem[r.itemId] = { situacion: r.situacion ?? null, impacto: r.impacto ?? null, observacion: r.observacion || '' };
  }

  const res = calcularAssessment(questionnaire, respuestasPorItem, umbrales, dependenciasFoda);

  const advertencias = [];
  const g = assessment.resultados;
  if (g && typeof g === 'object' && g.indiceInterno != null) {
    const dif = (a, b) => Math.abs((a ?? 0) - (b ?? 0)) > 0.01;
    if (dif(g.indiceInterno, res.indiceInterno) || dif(g.indiceExterno, res.indiceExterno) || g.veredicto !== res.veredicto) {
      advertencias.push(
        'Los resultados guardados en el archivo no coinciden con los que se obtienen al recalcular las respuestas con el motor actual. El reporte usa el recálculo.'
      );
    }
  }

  const escalaSit = questionnaire.escalas.situacion;
  const escalaImp = questionnaire.escalas.impacto;
  const puntosPorItem = new Map(res.porItem.map((p) => [p.itemId, p.puntos0a10]));
  const areaRes = new Map(res.porArea.map((a) => [a.areaId, a]));

  const areas = [];
  const items = [];
  for (const area of [...questionnaire.areasInternas, ...questionnaire.areasExternas]) {
    const ar = areaRes.get(area.id);
    areas.push({
      id: area.id, nombre: area.nombre, ambito: area.tipo, marco: area.marco,
      puntaje: ar.puntaje, semaforo: ar.semaforo, alertas: ar.alertas,
      respondidos: ar.itemsRespondidos, total: ar.itemsTotales,
    });
    for (const it of area.items) {
      const r = respuestasPorItem[it.id] ?? { situacion: null, impacto: null, observacion: '' };
      const calc = calcularItem(r);
      const contado = calc.respondido; // situación distinta de "No corresp." y con impacto
      const clase = contado ? CLASE_POR_AMBITO[area.tipo][clasificarFactor(r.situacion)] ?? null : null;
      items.push({
        id: it.id, areaId: area.id, areaNombre: area.nombre, ambito: area.tipo,
        titulo: it.titulo, criterioFavorable: it.criterioFavorable,
        situacionIdx: r.situacion, impactoIdx: r.impacto,
        situacionTxt: r.situacion == null ? 'Sin responder' : escalaSit[r.situacion],
        impactoTxt: r.impacto == null ? '—' : escalaImp[r.impacto],
        puntos: puntosPorItem.get(it.id) ?? 0,
        contado, clase, observacion: r.observacion || '',
      });
    }
  }

  // Orden editorial: mayor impacto primero; entre iguales, menor puntaje primero
  // (para debilidades/amenazas) o mayor puntaje primero (para fortalezas/oportunidades).
  const ordenar = (lista, negativo) =>
    [...lista].sort((a, b) =>
      (b.impactoIdx - a.impactoIdx) || (negativo ? a.puntos - b.puntos : b.puntos - a.puntos) || a.id.localeCompare(b.id));
  const por = (clase) => items.filter((i) => i.clase === clase);

  const factores = {
    fortalezas: ordenar(por('Fortaleza'), false),
    debilidades: ordenar(por('Debilidad'), true),
    oportunidades: ordenar(por('Oportunidad'), false),
    amenazas: ordenar(por('Amenaza'), true),
  };

  const internas = areas.filter((a) => a.ambito === 'interno');
  const externas = areas.filter((a) => a.ambito === 'externo');
  const alarmantes = areas.filter((a) => a.semaforo === 'Alarmante');
  const ordenAreas = (l) => [...l].filter((a) => a.respondidos > 0).sort((a, b) => a.puntaje - b.puntaje);

  const sinResponder = items.filter((i) => i.situacionIdx == null || i.impactoIdx == null);
  const noCorresponde = items.filter((i) => i.situacionIdx === 0 && i.impactoIdx != null);

  return {
    generadoEn: ahora,
    advertencias,
    empresa: {
      nombre: assessment.empresa?.nombre || '(sin nombre)',
      rubro: assessment.empresa?.rubro || '—',
      perfil: PERFIL_TEXTO[assessment.empresa?.perfil] || assessment.empresa?.perfil || '—',
      mercados: (assessment.empresa?.mercadosObjetivo || []).join(', ') || '—',
      relevadoPor: assessment.empresa?.relevadoPor || '—',
      fecha: fechaLarga(assessment.empresa?.fecha),
    },
    versiones: {
      motor: assessment.metadata?.versionMotor || '—',
      cuestionario: assessment.metadata?.versionCuestionario || questionnaire.version,
      id: assessment.id || null,
    },
    umbrales,
    veredicto: { codigo: res.veredicto, ...(TEXTO_VEREDICTO[res.veredicto] || { titulo: res.veredicto, lectura: '' }) },
    indices: { interno: res.indiceInterno, externo: res.indiceExterno },
    progreso: {
      respondidos: items.length - sinResponder.length, // valorados (incluye "No corresponde", que el motor puntúa)
      total: items.length,
      sinResponder: sinResponder.length,
      noCorresponde: noCorresponde.length,
    },
    areas,
    areasMasBajas: { internas: ordenAreas(internas).slice(0, 3), externas: ordenAreas(externas).slice(0, 3) },
    alarmantes,
    matriz: res.matrizFoda,
    factores,
    items,
    sinResponder,
    noCorresponde,
    observaciones: items.filter((i) => i.observacion.trim() !== ''),
  };
}

// ---------------------------------------------------------------------------
// 2. HTML con gráficos SVG (sin librerías: se imprime igual en cualquier navegador)
// ---------------------------------------------------------------------------

const COLOR = {
  'Excelencia': '#1d6f42', 'Bueno': '#3f9142', 'Regular': '#d9a21b', 'Alarmante': '#c0392b', 'sin datos': '#9aa0a6',
};
const COLOR_VEREDICTO = {
  VIABLE: '#1d6f42', VIABLE_CON_CONDICIONES: '#3f9142', EMPRESA_NO_LISTA: '#b8860b',
  ENTORNO_DESFAVORABLE: '#b8860b', NO_VIABLE: '#c0392b', DATOS_INCOMPLETOS: '#6b7280',
};

export function svgBarrasAreas(areas, umbrales) {
  const fila = 14, izq = 190, ancho = 560, tope = 28;
  const alto = tope + areas.length * fila + 26;
  const x = (v) => izq + (Math.min(v, 10) / 10) * (ancho - izq - 30);
  let s = `<svg viewBox="0 0 ${ancho} ${alto}" role="img" aria-label="Puntaje por área (0 a 10)" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;font:10px sans-serif">`;
  for (const v of [0, 2, 4, 6, 8, 10]) {
    s += `<line x1="${x(v)}" y1="${tope - 6}" x2="${x(v)}" y2="${alto - 22}" stroke="#e3e6ea"/><text x="${x(v)}" y="${alto - 8}" text-anchor="middle" fill="#6b7280">${v}</text>`;
  }
  areas.forEach((a, i) => {
    const y = tope + i * fila;
    const sep = i > 0 && areas[i - 1].ambito !== a.ambito ? `<line x1="4" y1="${y - 2}" x2="${ancho - 8}" y2="${y - 2}" stroke="#9aa0a6" stroke-dasharray="3 3"/>` : '';
    const w = Math.max(0, x(a.puntaje) - izq);
    s += `${sep}<text x="${izq - 6}" y="${y + 9}" text-anchor="end" fill="#1f2933">${esc(a.id)} · ${esc(a.nombre.length > 30 ? a.nombre.slice(0, 29) + '…' : a.nombre)}</text>`;
    s += `<rect x="${izq}" y="${y + 1}" width="${w}" height="10" fill="${COLOR[a.semaforo] || '#9aa0a6'}"/>`;
    s += `<text x="${izq + w + 4}" y="${y + 10}" fill="#1f2933">${num(a.puntaje)}</text>`;
  });
  for (const [v, t] of [[umbrales.viableConCondiciones, `mín. ${umbrales.viableConCondiciones}`], [umbrales.viable, `viable ${umbrales.viable}`]]) {
    s += `<line x1="${x(v)}" y1="${tope - 6}" x2="${x(v)}" y2="${alto - 22}" stroke="#1f2933" stroke-dasharray="4 3"/><text x="${x(v)}" y="${tope - 10}" text-anchor="middle" fill="#1f2933">${t}</text>`;
  }
  return s + '</svg>';
}

export function svgMatriz(m) {
  const W = 420, H = 300, cx = [150, 320], cy = [80, 205];
  const celdas = [
    ['FO', 0, 0, 'Fortaleza × Oportunidad'], ['FA', 1, 0, 'Fortaleza × Amenaza'],
    ['DO', 0, 1, 'Debilidad × Oportunidad'], ['DA', 1, 1, 'Debilidad × Amenaza'],
  ];
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Matriz FODA: cantidad de cruces por cuadrante" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:440px;height:auto;font:11px sans-serif">`;
  s += `<text x="${cx[0]}" y="16" text-anchor="middle" font-weight="700">Oportunidades</text><text x="${cx[1]}" y="16" text-anchor="middle" font-weight="700">Amenazas</text>`;
  s += `<text x="12" y="${cy[0]}" transform="rotate(-90 12 ${cy[0] + 30})" font-weight="700" text-anchor="middle">Fortalezas</text>`;
  s += `<text x="12" y="${cy[1]}" transform="rotate(-90 12 ${cy[1] + 30})" font-weight="700" text-anchor="middle">Debilidades</text>`;
  for (const [k, c, f, etq] of celdas) {
    const x0 = cx[c] - 80, y0 = cy[f] - 55, dom = m.cuadranteDominante === k;
    const p = m.porcentajes[k] || 0;
    const r = 8 + Math.sqrt(p) * 34;
    s += `<rect x="${x0}" y="${y0}" width="160" height="118" fill="${dom ? '#fff7e6' : '#f8f9fa'}" stroke="${dom ? '#c8961e' : '#cfd4da'}" stroke-width="${dom ? 2 : 1}"/>`;
    s += `<circle cx="${cx[c]}" cy="${cy[f] - 4}" r="${r}" fill="${dom ? '#c8961e' : '#7d8b99'}" fill-opacity="0.75"/>`;
    s += `<text x="${cx[c]}" y="${cy[f] - 1}" text-anchor="middle" font-weight="700" fill="#fff" style="paint-order:stroke;stroke:#1f2933;stroke-width:2px">${m.cruces[k]}</text>`;
    s += `<text x="${cx[c]}" y="${y0 + 14}" text-anchor="middle" fill="#1f2933" font-weight="700">${k}${dom ? ' · dominante' : ''}</text>`;
    s += `<text x="${cx[c]}" y="${y0 + 112}" text-anchor="middle" fill="#4b5563">${etq} · ${pct(p)}</text>`;
  }
  return s + '</svg>';
}

function tablaFactores(lista, max, vacio) {
  if (lista.length === 0) return `<p class="vacio">${vacio}</p>`;
  const filas = lista.slice(0, max).map((i) => `<tr>
    <td class="id">${esc(i.id)}</td><td>${esc(i.titulo)}<div class="sub">${esc(i.areaNombre)}</div></td>
    <td>${esc(i.situacionTxt)}</td><td>${esc(i.impactoTxt)}</td><td class="n">${num(i.puntos, 1)}</td></tr>`).join('');
  const resto = lista.length > max ? `<p class="sub">…y ${lista.length - max} más (ver Anexo A).</p>` : '';
  return `<table class="t"><thead><tr><th>Ítem</th><th>Factor</th><th>Situación</th><th>Impacto</th><th class="n">Pts</th></tr></thead><tbody>${filas}</tbody></table>${resto}`;
}

export function reporteHTML(r) {
  const v = r.veredicto, m = r.matriz;
  const colorV = COLOR_VEREDICTO[v.codigo] || '#6b7280';
  const f = r.factores;
  const interpretacionUmbrales = `Índices de 0 a 10 (promedio de las áreas con datos). Viable: ambos ≥ ${r.umbrales.viable}. Viable con condiciones: ambos ≥ ${r.umbrales.viableConCondiciones}. Si uno solo está por debajo de ${r.umbrales.viableConCondiciones}, el veredicto señala cuál (empresa no lista o entorno desfavorable); si ambos, no viable.`;

  const tablaAreas = (amb, titulo) => `<h3>${titulo}</h3><table class="t"><thead><tr><th>Área</th><th class="n">Puntaje</th><th>Semáforo</th><th class="n">Alertas</th><th class="n">Ítems</th></tr></thead><tbody>${
    r.areas.filter((a) => a.ambito === amb).map((a) => `<tr><td><b>${esc(a.id)}</b> ${esc(a.nombre)}</td><td class="n">${num(a.puntaje)}</td><td><span class="dot" style="background:${COLOR[a.semaforo] || '#9aa0a6'}"></span>${esc(a.semaforo)}</td><td class="n">${a.alertas}</td><td class="n">${a.respondidos}/${a.total}</td></tr>`).join('')
  }</tbody></table>`;

  const lecturaAreas = (() => {
    const baja = (l) => l.map((a) => `${esc(a.id)} ${esc(a.nombre)} (${num(a.puntaje)})`).join('; ') || '—';
    return `<p><b>Áreas internas más bajas:</b> ${baja(r.areasMasBajas.internas)}.<br><b>Áreas externas más bajas:</b> ${baja(r.areasMasBajas.externas)}.<br><b>Áreas en estado Alarmante (&lt; 5):</b> ${r.alarmantes.length === 0 ? 'ninguna' : r.alarmantes.map((a) => esc(a.id)).join(', ')}.</p>`;
  })();

  const matrizHTML = m && m.totalCruces > 0 ? `
    <div class="dos-col">
      <div>${svgMatriz(m)}</div>
      <div>
        <table class="t"><thead><tr><th>Cuadrante</th><th class="n">Cruces</th><th class="n">%</th></tr></thead><tbody>
          ${['FO', 'FA', 'DO', 'DA'].map((k) => `<tr${m.cuadranteDominante === k ? ' class="dom"' : ''}><td>${k}</td><td class="n">${m.cruces[k]}</td><td class="n">${pct(m.porcentajes[k])}</td></tr>`).join('')}
          <tr><td>Total considerado</td><td class="n">${m.totalCruces}</td><td></td></tr>
          <tr><td>Sin considerar</td><td class="n">${m.sinConsiderar}</td><td></td></tr>
        </tbody></table>
        <p><b>Cuadrante dominante: ${esc(m.cuadranteDominante)}.</b> ${esc(m.orientacionEstrategica)}</p>
        <p class="sub">Cada cruce combina un factor interno con un factor externo vinculado según la tabla fija del instrumento (VariablesFoda). "Sin considerar": cruces donde alguno de los dos factores quedó sin responder o como "No corresponde".</p>
      </div>
    </div>` : '<p class="vacio">No hay cruces suficientes para construir la matriz FODA.</p>';

  const anexoItems = (() => {
    let html = '', area = null;
    for (const i of r.items) {
      if (i.areaId !== area) {
        area = i.areaId;
        html += `<tr class="grupo"><td colspan="6">${esc(i.areaId)} — ${esc(i.areaNombre)} (${i.ambito})</td></tr>`;
      }
      html += `<tr><td class="id">${esc(i.id)}</td><td>${esc(i.titulo)}</td><td>${esc(i.situacionTxt)}</td><td>${esc(i.impactoTxt)}</td><td class="n">${i.contado ? num(i.puntos, 1) : '—'}</td><td>${esc(i.clase || '')}</td></tr>`;
    }
    return `<table class="t compacta"><thead><tr><th>Ítem</th><th>Descripción</th><th>Situación</th><th>Impacto</th><th class="n">Pts</th><th>Clase</th></tr></thead><tbody>${html}</tbody></table>`;
  })();

  return `
<header class="portada">
  <div class="kicker">FODA Export Misiones · Instituto Alfa</div>
  <h1>Diagnóstico de viabilidad exportadora</h1>
  <table class="ficha"><tbody>
    <tr><th>Empresa</th><td>${esc(r.empresa.nombre)}</td><th>Fecha del relevamiento</th><td>${esc(r.empresa.fecha)}</td></tr>
    <tr><th>Rubro</th><td>${esc(r.empresa.rubro)}</td><th>Relevado por</th><td>${esc(r.empresa.relevadoPor)}</td></tr>
    <tr><th>Perfil exportador</th><td>${esc(r.empresa.perfil)}</td><th>Mercados objetivo</th><td>${esc(r.empresa.mercados)}</td></tr>
  </tbody></table>
</header>

${r.advertencias.map((a) => `<div class="aviso">⚠ ${esc(a)}</div>`).join('')}

<section>
  <h2>1. Veredicto</h2>
  <div class="veredicto" style="border-color:${colorV};"><span class="v-titulo" style="color:${colorV}">${esc(v.titulo)}</span>
    <div class="indices">
      <div><b>${num(r.indices.interno)}</b><span>Índice interno (empresa)</span></div>
      <div><b>${num(r.indices.externo)}</b><span>Índice externo (entorno)</span></div>
      <div><b>${r.progreso.respondidos}/${r.progreso.total}</b><span>Ítems valorados</span></div>
    </div>
  </div>
  <p>${esc(v.lectura)}</p>
  <p class="sub">${esc(interpretacionUmbrales)}</p>
  ${r.progreso.sinResponder > 0 ? `<p class="aviso">Atención: ${r.progreso.sinResponder} de ${r.progreso.total} ítems están sin responder y no entran en el cálculo. Ver Anexo B.</p>` : ''}
  ${r.progreso.noCorresponde > 0 ? `<p class="aviso">${r.progreso.noCorresponde} ítem(s) marcados "No corresponde" (${r.noCorresponde.map((i) => esc(i.id)).join(', ')}). Según el cálculo del instrumento, en el puntaje del área se computan con el valor mínimo de la escala y quedan fuera de la matriz FODA. Conviene revisar si realmente no aplican a la empresa.</p>` : ''}
</section>

<section>
  <h2>2. Resultados por área</h2>
  <div style="max-width:640px;margin:0 auto">${svgBarrasAreas(r.areas, r.umbrales)}</div>
  ${lecturaAreas}
  ${tablaAreas('interno', 'Áreas internas (Canvas)')}
  ${tablaAreas('externo', 'Áreas externas (PESTEL / Porter)')}
  <p class="sub">Semáforo: Alarmante &lt; 5 · Regular 5 a &lt; 8 · Bueno ≥ 8. "Alertas" = ítems respondidos con puntaje entre 0 y 5 (exclusive).</p>
</section>

<section>
  <h2>3. Matriz FODA</h2>
  ${matrizHTML}
</section>

<section>
  <h2>4. Factores clave</h2>
  <p class="sub">Un factor se clasifica según su situación: Favorable o Muy favorable → Fortaleza (interno) u Oportunidad (externo); Desfavorable o Muy desfavorable → Debilidad o Amenaza. <b>Orden de presentación (criterio editorial, no del modelo):</b> mayor impacto primero y, entre iguales, menor puntaje primero en debilidades/amenazas y mayor puntaje primero en fortalezas/oportunidades. Se muestran hasta ${MAX_FACTORES_DESTACADOS} por tipo.</p>
  <h3>Debilidades a atender (${f.debilidades.length})</h3>${tablaFactores(f.debilidades, MAX_FACTORES_DESTACADOS, 'No se registraron debilidades.')}
  <h3>Amenazas del entorno (${f.amenazas.length})</h3>${tablaFactores(f.amenazas, MAX_FACTORES_DESTACADOS, 'No se registraron amenazas.')}
  <h3>Fortalezas a aprovechar (${f.fortalezas.length})</h3>${tablaFactores(f.fortalezas, MAX_FACTORES_DESTACADOS, 'No se registraron fortalezas.')}
  <h3>Oportunidades (${f.oportunidades.length})</h3>${tablaFactores(f.oportunidades, MAX_FACTORES_DESTACADOS, 'No se registraron oportunidades.')}
</section>

<section>
  <h2>5. Qué se consideraría favorable en las principales debilidades</h2>
  <p class="sub">Criterio del instrumento para cada ítem; sirve de guía para definir acciones. Las acciones concretas las define el equipo con la empresa.</p>
  ${f.debilidades.length === 0 ? '<p class="vacio">Sin debilidades registradas.</p>' : `<table class="t"><thead><tr><th>Ítem</th><th>Se considera favorable si…</th></tr></thead><tbody>${
    f.debilidades.slice(0, 5).map((i) => `<tr><td class="id">${esc(i.id)}<div class="sub">${esc(i.titulo)}</div></td><td>${esc(String(i.criterioFavorable || '').replace(/^Se considera favorable si\s*/i, ''))}</td></tr>`).join('')
  }</tbody></table>`}
</section>

${r.observaciones.length ? `<section><h2>6. Observaciones del relevamiento</h2><table class="t"><tbody>${
  r.observaciones.map((i) => `<tr><td class="id">${esc(i.id)}</td><td>${esc(i.observacion)}</td></tr>`).join('')
}</tbody></table></section>` : ''}

<section class="salto">
  <h2>Anexo A — Detalle por ítem</h2>
  ${anexoItems}
</section>

<section>
  <h2>Anexo B — Ítems sin responder o "No corresponde"</h2>
  ${r.sinResponder.length + r.noCorresponde.length === 0 ? '<p class="vacio">Todos los ítems fueron valorados.</p>' : `
  <p><b>Sin responder (${r.sinResponder.length}):</b> ${r.sinResponder.map((i) => esc(i.id)).join(', ') || 'ninguno'}.<br>
  <b>"No corresponde" (${r.noCorresponde.length}):</b> ${r.noCorresponde.map((i) => esc(i.id)).join(', ') || 'ninguno'} (puntuados con el valor mínimo en el área; excluidos de la matriz FODA).</p>`}
</section>

<section class="metodo">
  <h2>Nota metodológica y alcance</h2>
  <p>Instrumento de autodiagnóstico con fines educativos y de investigación; el resultado es <b>orientativo</b> y depende de la calidad de la información relevada. No reemplaza un estudio de mercado ni asesoramiento profesional.</p>
  <p>Cálculo adaptado de la metodología FODA Matemático (Prof. Mario Héctor Vogel, Club Tablero de Comando): conversión de la valoración de cada ítem en puntaje 0–10 mediante pendiente discontinua, ponderación por impacto dentro de cada área, índices interno y externo, y cruce de factores en la matriz FODA. Los cuestionarios se estructuran con Business Model Canvas (internos) y PESTEL / cinco fuerzas de Porter (externos).</p>
  <p class="sub">Motor v${esc(r.versiones.motor)} · Cuestionario v${esc(r.versiones.cuestionario)}${r.versiones.id ? ` · Evaluación ${esc(r.versiones.id)}` : ''} · Reporte generado el ${esc(fechaLarga(r.generadoEn))}.<br>
  Autor: Hugo César Galván (ORCID 0009-0008-0729-8969), Instituto Alfa, Posadas, Misiones. Código MIT; contenido metodológico CC BY-NC-SA 4.0.</p>
</section>`;
}

export const CSS_REPORTE = `
:root { --tinta:#1f2933; --suave:#6b7280; --linea:#d9dde2; --azul:#1f4e79; }
* { box-sizing: border-box; }
body { font: 13px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; color: var(--tinta); margin: 0; background:#eef1f4; }
.hoja { max-width: 820px; margin: 0 auto; background: #fff; padding: 28px 34px; }
h1 { font-size: 24px; margin: 4px 0 12px; color: var(--azul); }
h2 { font-size: 16px; margin: 22px 0 8px; color: var(--azul); border-bottom: 2px solid var(--azul); padding-bottom: 3px; break-after: avoid; }
p { orphans: 3; widows: 3; }
h3 { font-size: 13px; margin: 14px 0 6px; break-after: avoid; }
.kicker { font-size: 11px; letter-spacing: .06em; text-transform: uppercase; color: var(--suave); }
.sub { font-size: 11px; color: var(--suave); }
.vacio { color: var(--suave); font-style: italic; }
.aviso { background:#fff7e6; border:1px solid #f0dca0; border-radius:6px; padding:6px 10px; margin:8px 0; font-size:12px; }
table { border-collapse: collapse; width: 100%; }
table.t th, table.t td { border-bottom: 1px solid var(--linea); padding: 4px 6px; text-align: left; vertical-align: top; }
table.t th { background: #f3f5f7; font-size: 11px; }
table.t tr { break-inside: avoid; }
table.compacta td, table.compacta th { padding: 2px 5px; font-size: 11px; }
tr.grupo td { background:#e8eef5; font-weight:700; }
tr.dom td { background:#fff7e6; font-weight:700; }
td.n, th.n { text-align: right; white-space: nowrap; }
td.id { white-space: nowrap; font-weight: 700; }
.dot { display:inline-block; width:9px; height:9px; border-radius:50%; margin-right:5px; }
table.ficha th { width: 18%; font-size: 11px; color: var(--suave); text-align: left; padding: 3px 6px; }
table.ficha td { padding: 3px 6px; border-bottom: 1px solid var(--linea); }
.veredicto { border: 3px solid; border-radius: 10px; padding: 12px 16px; display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:10px; break-inside: avoid; }
.v-titulo { font-size: 22px; font-weight: 800; }
.indices { display:flex; gap: 18px; }
.indices div { text-align:center; } .indices b { display:block; font-size: 22px; } .indices span { font-size: 10px; color: var(--suave); }
.dos-col { display:grid; grid-template-columns: 1.15fr 1fr; gap: 16px; align-items: start; }
.barra-acciones { position: sticky; top:0; background:#1f4e79; color:#fff; padding:8px 16px; display:flex; gap:10px; align-items:center; flex-wrap:wrap; }
.barra-acciones button, .barra-acciones label { background:#fff; color:#1f4e79; border:0; border-radius:6px; padding:6px 12px; font-weight:600; cursor:pointer; }
.barra-acciones input { display:none; }
.metodo { font-size: 11.5px; margin-top: 18px; }
@media (max-width: 640px) { .hoja { padding: 16px; } .dos-col { grid-template-columns: 1fr; } }
@page { size: A4; margin: 14mm 12mm; }
@media print {
  body { background:#fff; font-size: 11.5px; }
  .hoja { max-width: none; padding: 0; }
  .barra-acciones { display: none !important; }
  .salto { break-before: page; }
  * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
}
`;
