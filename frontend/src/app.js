// frontend/src/app.js — Fase 3: componente Alpine.js del MVP offline-first.
//
// Toda la lógica de negocio (puntajes, semáforos, veredicto, cuadrante FODA)
// vive en engine/calc.js, ya validada contra tests golden (Fase 2) — este
// archivo solo conecta esa lógica con el formulario y los gráficos.

import {
  calcularAssessment,
  UMBRALES_DEFAULT,
} from './engine/calc.js';
import {
  leerConfig, guardarConfig, configCompleta, leerCola, guardarEnServidor, vaciarCola,
} from './api.js';

const CLAVE_LOCALSTORAGE = 'foda-export-misiones:draft-v1';
const VERSION_MOTOR = '1.0.0-fase4';

const SITUACION_LABELS = ['No corresp.', 'Muy Desfav.', 'Desfavorable', 'Favorable', 'Muy Favorable'];
const IMPACTO_LABELS = ['Muy insignif.', 'Insignificante', 'Significante', 'Muy Signific.'];

const COLOR_SEMAFORO = {
  'Excelencia': '#1d6f42',
  'Bueno': '#3f9142',
  'Regular': '#c8961e',
  'Alarmante': '#c0392b',
  'sin datos': '#9aa0a6',
};

function vacio() {
  return {
    empresa: {
      nombre: '',
      rubro: '',
      mercadosObjetivo: '',
      perfil: 'no_exporta_evalua_iniciar',
      relevadoPor: '',
      fecha: new Date().toISOString().slice(0, 10),
      autorizaRecontacto: false,
    },
    respuestas: {}, // { itemId: { situacion: 0-4|null, impacto: 0-3|null, observacion: '' } }
  };
}

export function fodaApp() {
  // IMPORTANTE: las instancias de Chart.js NO se guardan como propiedad
  // reactiva de Alpine (this.chartBarras = ...). Chart.js tiene referencias
  // internas circulares, y el Proxy reactivo de Alpine intenta envolverlas
  // recursivamente -> "Maximum call stack size exceeded" (se reprodujo y se
  // verificó con Playwright durante la Fase 3). Por eso viven en estas
  // variables de clausura, fuera del objeto que Alpine hace reactivo.
  let chartBarras = null;
  let chartBurbujas = null;

  return {
    // --- estado ---------------------------------------------------------
    cargando: true,
    error: null,
    questionnaire: null,
    dependenciasFoda: null,
    empresa: vacio().empresa,
    respuestas: {},
    areaActualId: null,
    ambitoActual: 'interno', // 'interno' | 'externo'
    mostrarGuia: {}, // { itemId: bool }
    mostrarPerfil: true,
    panelResultadosAbierto: true,
    resultado: null,
    mensaje: '',

    // --- API / cola de reintento (Fase 4) ---------------------------------
    mostrarConfig: false,
    apiConfig: { baseUrl: '', apiKey: '' },
    pendientesEnCola: 0,
    errorCola: '',
    guardandoEnServidor: false,

    // --- inicialización ---------------------------------------------------
    async init() {
      try {
        const [q, dep] = await Promise.all([
          fetch('./src/data/questionnaire.json').then((r) => r.json()),
          fetch('./src/data/dependenciasFoda.json').then((r) => r.json()),
        ]);
        this.questionnaire = q;
        this.dependenciasFoda = dep;
        this.cargarDeLocalStorage();
        this.apiConfig = leerConfig();
        this.refrescarCola();
        window.addEventListener('online', () => this.reintentarCola(true));
        this.areaActualId = this.areas[0]?.id ?? null;
        this.recalcular();
        this.cargando = false;
        this.$nextTick(() => this.dibujarGraficos());
      } catch (e) {
        this.error = 'No se pudo cargar el cuestionario (' + (e?.message || e) + '). Si abriste el archivo directamente (file://), serví la carpeta con un servidor local, p. ej.: python3 -m http.server';
        this.cargando = false;
      }
    },

    cargarDeLocalStorage() {
      try {
        const raw = localStorage.getItem(CLAVE_LOCALSTORAGE);
        if (!raw) return;
        const data = JSON.parse(raw);
        this.empresa = { ...vacio().empresa, ...(data.empresa || {}) };
        this.respuestas = data.respuestas || {};
      } catch (e) {
        console.warn('No se pudo leer el borrador guardado en este navegador:', e);
      }
    },

    guardarEnLocalStorage() {
      try {
        localStorage.setItem(
          CLAVE_LOCALSTORAGE,
          JSON.stringify({ empresa: this.empresa, respuestas: this.respuestas })
        );
      } catch (e) {
        console.warn('No se pudo guardar el borrador en este navegador:', e);
      }
    },

    // --- áreas / navegación ----------------------------------------------
    get areasInternas() {
      return this.questionnaire?.areasInternas ?? [];
    },
    get areasExternas() {
      return this.questionnaire?.areasExternas ?? [];
    },
    get areas() {
      return [...this.areasInternas, ...this.areasExternas];
    },
    get areasDelAmbito() {
      return this.ambitoActual === 'interno' ? this.areasInternas : this.areasExternas;
    },
    get areaActual() {
      return this.areas.find((a) => a.id === this.areaActualId) || null;
    },
    irAArea(id) {
      this.areaActualId = id;
      const area = this.areas.find((a) => a.id === id);
      if (area) this.ambitoActual = area.tipo;
      window.scrollTo({ top: 0, behavior: 'smooth' });
    },
    indiceAreaActual() {
      return this.areas.findIndex((a) => a.id === this.areaActualId);
    },
    irAreaSiguiente() {
      const i = this.indiceAreaActual();
      if (i < this.areas.length - 1) this.irAArea(this.areas[i + 1].id);
    },
    irAreaAnterior() {
      const i = this.indiceAreaActual();
      if (i > 0) this.irAArea(this.areas[i - 1].id);
    },
    progresoArea(area) {
      const total = area.items.length;
      const respondidos = area.items.filter((it) => this.respuestaDe(it.id).situacion != null).length;
      return { respondidos, total };
    },
    get progresoTotal() {
      const total = this.areas.reduce((s, a) => s + a.items.length, 0);
      const respondidos = this.areas.reduce(
        (s, a) => s + a.items.filter((it) => this.respuestaDe(it.id).situacion != null).length,
        0
      );
      return { respondidos, total, pct: total === 0 ? 0 : Math.round((respondidos / total) * 100) };
    },

    // --- respuestas ---------------------------------------------------
    respuestaDe(itemId) {
      return this.respuestas[itemId] || { situacion: null, impacto: null, observacion: '' };
    },
    marcarSituacion(itemId, idx) {
      const r = this.respuestas[itemId] || { situacion: null, impacto: null, observacion: '' };
      r.situacion = idx;
      this.respuestas[itemId] = r;
      this.onCambio();
    },
    marcarImpacto(itemId, idx) {
      const r = this.respuestas[itemId] || { situacion: null, impacto: null, observacion: '' };
      r.impacto = idx;
      this.respuestas[itemId] = r;
      this.onCambio();
    },
    actualizarObservacion(itemId, texto) {
      const r = this.respuestas[itemId] || { situacion: null, impacto: null, observacion: '' };
      r.observacion = texto;
      this.respuestas[itemId] = r;
      this.guardarEnLocalStorage();
    },
    onCambio() {
      this.guardarEnLocalStorage();
      this.recalcular();
      this.$nextTick(() => this.dibujarGraficos());
    },
    toggleGuia(itemId) {
      this.mostrarGuia[itemId] = !this.mostrarGuia[itemId];
    },

    // --- cálculo --------------------------------------------------------
    recalcular() {
      if (!this.questionnaire) return;
      this.resultado = calcularAssessment(
        this.questionnaire,
        this.respuestas,
        UMBRALES_DEFAULT,
        this.dependenciasFoda
      );
    },
    areaResultado(areaId) {
      return this.resultado?.porArea?.find((a) => a.areaId === areaId) || null;
    },
    colorSemaforo(semaforo) {
      return COLOR_SEMAFORO[semaforo] || '#9aa0a6';
    },
    colorVeredicto(v) {
      if (v === 'VIABLE') return '#1d6f42';
      if (v === 'VIABLE_CON_CONDICIONES') return '#3f9142';
      if (v === 'EMPRESA_NO_LISTA' || v === 'ENTORNO_DESFAVORABLE') return '#c8961e';
      if (v === 'NO_VIABLE') return '#c0392b';
      return '#9aa0a6';
    },
    textoVeredicto(v) {
      const textos = {
        VIABLE: 'Viable',
        VIABLE_CON_CONDICIONES: 'Viable con condiciones',
        EMPRESA_NO_LISTA: 'Empresa no lista (entorno favorable, empresa no)',
        ENTORNO_DESFAVORABLE: 'Entorno desfavorable (empresa lista, entorno no)',
        NO_VIABLE: 'No viable',
        DATOS_INCOMPLETOS: 'Datos incompletos — seguí completando el formulario',
      };
      return textos[v] || v;
    },

    // --- gráficos (Chart.js) --------------------------------------------
    dibujarGraficos() {
      if (!this.resultado || typeof Chart === 'undefined') return;
      this.dibujarBarras();
      this.dibujarBurbujas();
    },
    dibujarBarras() {
      const canvas = this.$refs.graficoBarras;
      if (!canvas) return;
      const areas = this.resultado.porArea;
      const data = {
        labels: areas.map((a) => a.areaId),
        datasets: [
          {
            label: 'Puntaje (0-10)',
            data: areas.map((a) => a.puntaje),
            backgroundColor: areas.map((a) => this.colorSemaforo(a.semaforo)),
          },
        ],
      };
      if (chartBarras) {
        chartBarras.data = data;
        chartBarras.update('none');
        return;
      }
      chartBarras = new Chart(canvas.getContext('2d'), {
        type: 'bar',
        data,
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: { y: { beginAtZero: true, max: 17 } },
          plugins: { legend: { display: false }, title: { display: true, text: 'Puntaje por área (19)' } },
        },
      });
    },
    dibujarBurbujas() {
      const canvas = this.$refs.graficoBurbujas;
      if (!canvas || !this.resultado.matrizFoda) return;
      const burbujas = this.resultado.matrizFoda.burbujas;
      const colores = { FO: '#1d6f42', FA: '#c8961e', DO: '#2e6da4', DA: '#c0392b' };
      const data = {
        datasets: burbujas.map((b) => ({
          label: `${b.cuadrante} (${Math.round(b.tamano * 100)}%)`,
          data: [{ x: b.x, y: b.y, r: 10 + b.tamano * 60 }],
          backgroundColor: colores[b.cuadrante] + 'aa',
        })),
      };
      if (chartBurbujas) {
        chartBurbujas.data = data;
        chartBurbujas.update('none');
        return;
      }
      chartBurbujas = new Chart(canvas.getContext('2d'), {
        type: 'bubble',
        data,
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: {
            x: { min: 0, max: 12, title: { display: true, text: 'Oportunidades ←  →  Amenazas' } },
            y: { min: 0, max: 8, title: { display: true, text: 'Debilidades ↓  ↑  Fortalezas' } },
          },
          plugins: { title: { display: true, text: 'Matriz FODA (FO / FA / DO / DA)' } },
        },
      });
    },

    // --- exportar / importar / imprimir / reiniciar ----------------------
    construirAssessment() {
      const respuestasArr = Object.entries(this.respuestas)
        .filter(([, r]) => r.situacion != null || r.impacto != null)
        .map(([itemId, r]) => ({
          itemId,
          situacion: r.situacion,
          impacto: r.impacto,
          observacion: r.observacion || '',
        }));
      return {
        id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
        empresa: {
          ...this.empresa,
          mercadosObjetivo: String(this.empresa.mercadosObjetivo || '')
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
        },
        respuestas: respuestasArr,
        resultados: this.resultado,
        metadata: {
          versionMotor: VERSION_MOTOR,
          versionCuestionario: this.questionnaire.version,
          creadoEn: new Date().toISOString(),
        },
      };
    },
    exportarJSON() {
      const assessment = this.construirAssessment();
      const blob = new Blob([JSON.stringify(assessment, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const nombreArchivo = (this.empresa.nombre || 'evaluacion').replace(/[^a-z0-9]+/gi, '_').toLowerCase();
      a.href = url;
      a.download = `foda_${nombreArchivo}_${this.empresa.fecha}.json`;
      a.click();
      URL.revokeObjectURL(url);
    },
    importarJSON(event) {
      const file = event.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = JSON.parse(e.target.result);
          this.empresa = {
            ...vacio().empresa,
            ...data.empresa,
            mercadosObjetivo: Array.isArray(data.empresa?.mercadosObjetivo)
              ? data.empresa.mercadosObjetivo.join(', ')
              : data.empresa?.mercadosObjetivo || '',
          };
          const nuevasRespuestas = {};
          for (const r of data.respuestas || []) {
            nuevasRespuestas[r.itemId] = {
              situacion: r.situacion,
              impacto: r.impacto,
              observacion: r.observacion || '',
            };
          }
          this.respuestas = nuevasRespuestas;
          this.onCambio();
          this.mensaje = 'Evaluación importada correctamente.';
          setTimeout(() => (this.mensaje = ''), 4000);
        } catch (err) {
          this.mensaje = 'No se pudo leer el archivo: ' + err.message;
        }
      };
      reader.readAsText(file);
      event.target.value = '';
    },
    // --- guardar en el servidor (Fase 4) -----------------------------------
    refrescarCola() {
      const cola = leerCola();
      this.pendientesEnCola = cola.length;
      this.errorCola = cola.find((i) => i.ultimoError)?.ultimoError || '';
    },
    guardarConfigApi() {
      this.apiConfig = guardarConfig(this.apiConfig);
      this.flash('Configuración de la API guardada en este navegador.');
    },
    flash(texto) {
      this.mensaje = texto;
      setTimeout(() => (this.mensaje = ''), 5000);
    },
    async guardarEnServidor() {
      if (!configCompleta(this.apiConfig)) {
        this.mostrarConfig = true;
        this.flash('Primero cargá la URL de la API y la API key en Configuración.');
        return;
      }
      this.guardandoEnServidor = true;
      const r = await guardarEnServidor(this.apiConfig, this.construirAssessment());
      this.guardandoEnServidor = false;
      this.refrescarCola();
      this.flash(
        r.pendientes === 0
          ? 'Evaluación guardada en el servidor (recalculada y verificada).'
          : 'No se pudo guardar en el servidor: quedó en cola local y se reintenta. ' + this.errorCola
      );
    },
    async reintentarCola(silencioso = false) {
      if (!configCompleta(this.apiConfig) || leerCola().length === 0) return;
      const r = await vaciarCola(this.apiConfig);
      this.refrescarCola();
      if (!silencioso || r.enviados.length) {
        this.flash(`Cola: ${r.enviados.length} enviada(s), ${r.pendientes} pendiente(s).`);
      }
    },
    imprimir() {
      window.print();
    },
    reiniciar() {
      if (!confirm('¿Borrar todas las respuestas cargadas en este navegador? Esta acción no se puede deshacer (exportá antes si querés guardarlas).')) return;
      const limpio = vacio();
      this.empresa = limpio.empresa;
      this.respuestas = {};
      localStorage.removeItem(CLAVE_LOCALSTORAGE);
      this.onCambio();
    },

    // --- utilidades para la plantilla ------------------------------------
    SITUACION_LABELS,
    IMPACTO_LABELS,
  };
}
