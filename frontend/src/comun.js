// frontend/src/comun.js — constantes y utilidades compartidas por app.js y report.js.

// Única fuente de verdad de la versión del motor de cálculo (se muestra en el reporte
// y se guarda con cada evaluación). Cambiarla acá y en backend/config.py.
export const VERSION_MOTOR = '1.0.0';

/** Fecha LOCAL (zona horaria de la persona) en formato AAAA-MM-DD.
 *  `new Date().toISOString()` da la fecha en UTC: en Argentina (UTC-3), después de las
 *  21:00 ya devuelve el día siguiente. */
export function fechaLocalISO(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
