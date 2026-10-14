/**
 * frontend/src/engine/calc.js — Motor de cálculo FODA Export Misiones
 *
 * Implementado y validado en Fase 2 contra tests golden extraídos del Excel
 * DEMO (ver scripts/golden_extract.py y tests/calc.golden.test.mjs).
 *
 * Replica, celda por celda, las fórmulas de las hojas `CalculosFoda` y
 * `Rango` del Excel original (puntaje por ítem/área, semáforo, índices,
 * veredicto). Ver ARCHITECTURE.md §5 para el detalle de a qué columna de
 * `CalculosFoda` corresponde cada paso.
 *
 * `CalculosFoda!AC` (usado en calcularItem más abajo) es un indicador
 * binario de "¿se marcó una opción de situación?", NO un signo
 * favorable/desfavorable — verificado contra el Excel, nunca vale -1 en la
 * práctica. Ver ARCHITECTURE.md §4.1.
 *
 * Corrección (Fase 3) a una nota anterior de este archivo: acá se había
 * afirmado, de forma demasiado general, que el motor "no tiene ningún
 * componente de signo a nivel de ítem". Eso vale para la ruta de cálculo de
 * VIABILIDAD (arriba), pero es FALSO para la ruta paralela de la matriz FODA
 * (CalculoFoda-1 / VariablesFoda / PART2 FODA / MATRIZ FODA, más abajo en
 * este archivo): ahí sí existe un signo real de 4 niveles
 * (-1/-0.5/0.5/1 según Muy Desfav./Desfav./Fav./Muy Fav.), usado para
 * clasificar cada factor en Fortaleza/Debilidad (internos) u
 * Oportunidad/Amenaza (externos) y cruzarlos automáticamente en la matriz
 * FODA. Ver ARCHITECTURE.md §5 para el detalle completo de este hallazgo.
 */

// Tabla "Rango" del Excel: interpolación de pendiente discontinua, % de logro -> puntos.
export const RANGO = [
  { desde: 0, hasta: 0, pts: 0 },
  { desde: 0, hasta: 20, pts: 1 },
  { desde: 21, hasta: 40, pts: 3 },
  { desde: 41, hasta: 60, pts: 5 },
  { desde: 61, hasta: 80, pts: 7 },
  { desde: 81, hasta: 100, pts: 10 },
  { desde: 101, hasta: 120, pts: 13 },
  { desde: 121, hasta: 140, pts: 16 },
  { desde: 141, hasta: 200, pts: 17 },
];

// CalculosFoda!S: constante, igual al peso máximo de la escala de Situación.
export const META = 5;

// Índice 0..4 -> peso bruto (CalculosFoda!E2:I2). Orden: No corresp., Muy
// Desfav., Desfav., Fav., Muy Fav. — mismo orden que questionnaire.json
// escalas.situacion.
export const PESO_SITUACION = [1, 2, 3, 4, 5];

// Índice 0..3 -> peso bruto (CalculosFoda!K2:N2). Orden: Muy insignif.,
// Insignificante, Significante, Muy Signific. — mismo orden que
// questionnaire.json escalas.impacto.
export const PESO_IMPACTO = [1, 2, 3, 4];

export const UMBRALES_DEFAULT = { viable: 7, viableConCondiciones: 5 };

/**
 * Interpola % de logro -> puntos 0-10 (o más, hasta 17 si pctLogro > 100),
 * usando la tabla RANGO con pendiente discontinua entre tramos.
 * Replica CalculosFoda!AB: `=IF(AND(Y=0,X<>0),X,IF(AA=0,0,X+((W-Z)*(Y-X))/AA))`,
 * donde W = CalculosFoda!W = ABS(V)-0.001.
 *
 * Decisión documentada (no es un "error" a corregir): el Excel real le resta
 * un épsilon de 0.001 al % de logro ANTES de ubicarlo en la tabla Rango. Es
 * un truco deliberado para evitar ambigüedad de MATCH exactamente en los
 * límites de cada tramo (20, 40, 60, 80...). El efecto visible en
 * CalculosFoda es que un ítem que cae justo en un límite de tramo (p. ej.
 * situación "Desfavorable" -> 60% de logro exacto) da 4.9999 en vez de 5 —
 * de ahí los `.9999` que aparecen en los datos reales. Se reproduce tal
 * cual, no se "limpia", siguiendo la regla del proyecto de no aproximar
 * rarezas del Excel por prolijidad.
 */
export function interpolarPuntos(pctLogro) {
  if (pctLogro === 0) return 0;
  const w = Math.abs(pctLogro) - 0.001; // CalculosFoda!W
  let i = RANGO.findIndex((r) => w <= r.hasta);
  if (i === -1) i = RANGO.length - 1;
  const sup = RANGO[i];
  const inf = RANGO[Math.max(0, i - 1)];
  if (sup.hasta === inf.hasta) return sup.pts;
  const frac = (w - inf.hasta) / (sup.hasta - inf.hasta);
  return inf.pts + frac * (sup.pts - inf.pts);
}

/**
 * Calcula el puntaje de UN ítem a partir de su respuesta.
 * `r` = { situacion: 0-4 | null, impacto: 0-3 | null }.
 * Replica CalculosFoda!J (situación bruta), V (% de logro), AB (Puntos),
 * AC (respondido, 1/0) y AD (Pts = Puntos × respondido).
 */
export function calcularItem(r) {
  if (r == null || r.situacion == null || r.impacto == null) {
    return { puntos0a10: 0, respondido: false, impactoIdx: null };
  }
  const situacionBruta = PESO_SITUACION[r.situacion]; // J
  const pctLogro = (situacionBruta / META) * 100; // V
  const puntos = interpolarPuntos(pctLogro); // AB
  const respondido = situacionBruta > 0; // AC (1/0, no es un signo)
  return {
    puntos0a10: respondido ? puntos : 0, // AD
    respondido,
    impactoIdx: r.impacto,
  };
}

/**
 * Calcula el puntaje de un ÁREA a partir de las respuestas de sus ítems.
 * `itemsDelArea` = array de respuestas { situacion, impacto } en el mismo
 * orden que los ítems del área en questionnaire.json.
 * Replica CalculosFoda!O (impacto bruto), P (peso relativo del impacto
 * dentro del área) y AE (Valor Pond), sumados = VIABILIDAD!C15..C37.
 */
export function calcularArea(itemsDelArea) {
  const calculados = itemsDelArea.map(calcularItem);
  const respondidos = calculados.filter((c) => c.respondido);

  if (respondidos.length === 0) {
    return {
      puntaje: 0,
      itemsRespondidos: 0,
      itemsTotales: itemsDelArea.length,
      alertas: 0,
      semaforo: semaforoDe(0),
    };
  }

  const impactosBrutos = respondidos.map((c) => PESO_IMPACTO[c.impactoIdx]);
  const sumaImpactos = impactosBrutos.reduce((a, b) => a + b, 0);

  let puntajeArea = 0;
  respondidos.forEach((c, idx) => {
    const pesoRelativo = sumaImpactos === 0 ? 0 : impactosBrutos[idx] / sumaImpactos; // P
    puntajeArea += c.puntos0a10 * pesoRelativo; // AE, sumado
  });

  // VIABILIDAD!F15..F37: COUNTIFS(AD,"<5",AD,">0") — ítem respondido con puntaje bajo.
  const alertas = respondidos.filter((c) => c.puntos0a10 > 0 && c.puntos0a10 < 5).length;

  return {
    puntaje: Math.round(puntajeArea * 100) / 100,
    itemsRespondidos: respondidos.length,
    itemsTotales: itemsDelArea.length,
    alertas,
    semaforo: semaforoDe(puntajeArea),
  };
}

/** Replica VIABILIDAD!D15..D37 (y C25/C38): semáforo por puntaje de área. */
export function semaforoDe(puntaje) {
  if (puntaje === 0) return 'sin datos';
  if (puntaje > 10) return 'Excelencia';
  if (puntaje >= 8) return 'Bueno';
  if (puntaje >= 5) return 'Regular';
  return 'Alarmante';
}

/**
 * Calcula los índices interno/externo y el veredicto de viabilidad.
 * `areasInternas`/`areasExternas` = arrays de { puntaje } (salida de
 * calcularArea, una por área: 10 internas, 9 externas).
 * Replica VIABILIDAD!C25/C38 (AVERAGEIF) y C44 (regla de 5 ramas).
 */
export function calcularViabilidad(areasInternas, areasExternas, umbrales = UMBRALES_DEFAULT) {
  const promedio = (areas) => {
    const conDatos = areas.filter((a) => a.puntaje > 0);
    if (conDatos.length === 0) return 0;
    return conDatos.reduce((s, a) => s + a.puntaje, 0) / conDatos.length;
  };

  const indiceInterno = promedio(areasInternas);
  const indiceExterno = promedio(areasExternas);

  let veredicto;
  if (indiceInterno === 0 || indiceExterno === 0) {
    veredicto = 'DATOS_INCOMPLETOS';
  } else if (indiceInterno >= umbrales.viable && indiceExterno >= umbrales.viable) {
    veredicto = 'VIABLE';
  } else if (indiceInterno >= umbrales.viableConCondiciones && indiceExterno >= umbrales.viableConCondiciones) {
    veredicto = 'VIABLE_CON_CONDICIONES';
  } else if (indiceInterno < umbrales.viableConCondiciones && indiceExterno >= umbrales.viableConCondiciones) {
    veredicto = 'EMPRESA_NO_LISTA';
  } else if (indiceInterno >= umbrales.viableConCondiciones && indiceExterno < umbrales.viableConCondiciones) {
    veredicto = 'ENTORNO_DESFAVORABLE';
  } else {
    veredicto = 'NO_VIABLE';
  }

  return {
    indiceInterno: Math.round(indiceInterno * 100) / 100,
    indiceExterno: Math.round(indiceExterno * 100) / 100,
    veredicto,
  };
}

/**
 * Calcula un assessment completo a partir del cuestionario (questionnaire.json)
 * y un mapa de respuestas { itemId: { situacion, impacto } }.
 * Incluye cuadranteDominante/orientacionEstrategica (ver calcularMatrizFoda
 * más abajo) cuando se pasa `dependenciasFoda`.
 */
export function calcularAssessment(questionnaire, respuestasPorItem, umbrales = UMBRALES_DEFAULT, dependenciasFoda = null) {
  const calcularAreas = (areas) =>
    areas.map((area) => {
      const respuestasArea = area.items.map((it) => respuestasPorItem[it.id] ?? { situacion: null, impacto: null });
      const resultado = calcularArea(respuestasArea);
      return { areaId: area.id, ambito: area.tipo, ...resultado };
    });

  const porAreaInterno = calcularAreas(questionnaire.areasInternas);
  const porAreaExterno = calcularAreas(questionnaire.areasExternas);

  const porItem = [];
  for (const area of [...questionnaire.areasInternas, ...questionnaire.areasExternas]) {
    for (const it of area.items) {
      const r = respuestasPorItem[it.id] ?? { situacion: null, impacto: null };
      const { puntos0a10 } = calcularItem(r);
      porItem.push({ itemId: it.id, puntos0a10 });
    }
  }

  const { indiceInterno, indiceExterno, veredicto } = calcularViabilidad(porAreaInterno, porAreaExterno, umbrales);

  const resultado = {
    porItem,
    porArea: [...porAreaInterno, ...porAreaExterno],
    indiceInterno,
    indiceExterno,
    veredicto,
  };

  if (dependenciasFoda) {
    resultado.matrizFoda = calcularMatrizFoda(questionnaire, respuestasPorItem, dependenciasFoda);
  }

  return resultado;
}

// ---------------------------------------------------------------------------
// Matriz FODA (cuadrante dominante) — CalculoFoda-1 / VariablesFoda /
// PART2 FODA / MATRIZ FODA / ResumenFODA del Excel original.
//
// Hallazgo de Fase 3 (corrige lo documentado en Fase 2): el cuadrante FODA
// dominante SÍ es automático. No depende de texto cualitativo cargado a
// mano — depende de una tabla FIJA del instrumento (`VariablesFoda`, acá
// `dependenciasFoda.json`) que define, para cada factor interno, con qué
// factores externos se cruza. El cruce en sí se clasifica automáticamente
// a partir de las mismas respuestas de situación de los 110 ítems. Ver
// ARCHITECTURE.md §5 para el detalle completo.
// ---------------------------------------------------------------------------

// CalculoFoda-1!S2:V2 — signo por opción de situación. Índice 0..4: No
// corresp. (no cuenta), Muy Desfav., Desfav., Fav., Muy Fav.
export const SIGNO_SITUACION = [0, -1, -0.5, 0.5, 1];

/**
 * Clasifica un factor (interno o externo) según su respuesta de situación.
 * Replica el patrón `OR(H=1,I=1)` (positivo) / `OR(F=1,G=1)` (negativo) de
 * `PART1 FODA`/`PART2 FODA`: Favorable o Muy Favorable -> 'positivo'
 * (Fortaleza si es interno, Oportunidad si es externo); Muy Desfavorable o
 * Desfavorable -> 'negativo' (Debilidad / Amenaza); "No corresponde" o sin
 * responder -> null (no participa del cruce: "Variable no considerada").
 */
export function clasificarFactor(situacionIdx) {
  if (situacionIdx === 3 || situacionIdx === 4) return 'positivo';
  if (situacionIdx === 1 || situacionIdx === 2) return 'negativo';
  return null;
}

const ORIENTACION_POR_CUADRANTE = {
  FO: 'Ofensiva: usar las fortalezas para aprovechar las oportunidades del mercado.',
  FA: 'Defensiva: usar las fortalezas para neutralizar amenazas del entorno.',
  DO: 'Reorientación: superar debilidades para capturar oportunidades.',
  DA: 'Supervivencia: reducir debilidades y evitar amenazas; no exportar aún.',
};

/**
 * Calcula la matriz FODA (cruces FO/FA/DO/DA), el cuadrante dominante y los
 * datos del gráfico de burbujas. Replica `MATRIZ FODA!C15:F16`,
 * `VIABILIDAD!B53` y los puntos fijos del gráfico de burbujas
 * (`MATRIZ FODA!C24:E27`).
 *
 * `dependenciasFoda` = objeto { idItemInterno: [idItemExterno, ...] },
 * generado por scripts/extraer_dependencias_foda.py desde la hoja
 * `VariablesFoda` (tabla fija del instrumento, no depende de la evaluación).
 */
export function calcularMatrizFoda(questionnaire, respuestasPorItem, dependenciasFoda) {
  const situacionDe = (itemId) => respuestasPorItem[itemId]?.situacion ?? null;

  const conteo = { FO: 0, FA: 0, DO: 0, DA: 0 };
  let sinConsiderar = 0;

  for (const [idInterno, externos] of Object.entries(dependenciasFoda)) {
    const clasifInterno = clasificarFactor(situacionDe(idInterno)); // Fortaleza/Debilidad
    for (const idExterno of externos) {
      const clasifExterno = clasificarFactor(situacionDe(idExterno)); // Oportunidad/Amenaza
      if (clasifInterno === 'positivo' && clasifExterno === 'positivo') conteo.FO++;
      else if (clasifInterno === 'positivo' && clasifExterno === 'negativo') conteo.FA++;
      else if (clasifInterno === 'negativo' && clasifExterno === 'positivo') conteo.DO++;
      else if (clasifInterno === 'negativo' && clasifExterno === 'negativo') conteo.DA++;
      else sinConsiderar++; // alguno de los dos sin responder o "No corresponde"
    }
  }

  const totalCruces = conteo.FO + conteo.FA + conteo.DO + conteo.DA; // sin contar "sin considerar"
  const porcentajes = {
    FO: totalCruces === 0 ? 0 : conteo.FO / totalCruces,
    FA: totalCruces === 0 ? 0 : conteo.FA / totalCruces,
    DO: totalCruces === 0 ? 0 : conteo.DO / totalCruces,
    DA: totalCruces === 0 ? 0 : conteo.DA / totalCruces,
  };

  // VIABILIDAD!C53: INDEX/MATCH del máximo entre los 4 cuadrantes.
  let cuadranteDominante = null;
  if (totalCruces > 0) {
    cuadranteDominante = Object.keys(conteo).reduce((max, k) => (conteo[k] > conteo[max] ? k : max), 'FO');
  }

  // MATRIZ FODA!C24:E27 — posiciones fijas del gráfico de burbujas (no
  // surgen de los datos; son el layout fijo de la grilla 2x2 Fortaleza/
  // Debilidad × Oportunidad/Amenaza). El tamaño sí es dato: % del total.
  const burbujas = [
    { cuadrante: 'FO', x: 4, y: 6, tamano: porcentajes.FO },
    { cuadrante: 'FA', x: 8, y: 6, tamano: porcentajes.FA },
    { cuadrante: 'DO', x: 4, y: 2, tamano: porcentajes.DO },
    { cuadrante: 'DA', x: 8, y: 2, tamano: porcentajes.DA },
  ];

  return {
    cruces: conteo,
    sinConsiderar,
    totalCruces,
    porcentajes,
    cuadranteDominante,
    orientacionEstrategica: cuadranteDominante ? ORIENTACION_POR_CUADRANTE[cuadranteDominante] : null,
    burbujas,
  };
}
