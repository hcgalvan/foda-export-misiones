# ARCHITECTURE.md — FODA Export Misiones

Documento de arquitectura técnica del proyecto **FODA Export Misiones**: aplicación web para el diagnóstico de viabilidad exportadora de pymes industriales de Misiones (Argentina), desarrollado en el marco de investigación aplicada y docencia universitaria en la Tecnicatura Superior en Comercio Exterior.

Este documento consolida las decisiones de arquitectura, stack tecnológico, estrategia de protección intelectual/ciencia abierta, modelo de datos y motor de cálculo. Vive en la raíz del repositorio y se actualiza cada vez que cambia una decisión estructural — no un detalle de implementación menor.

---

## 0. Estado del documento

| Sección | Estado |
|---|---|
| Arquitectura (Fase 1) | Definida |
| Stack tecnológico (Fase 2) | Definida |
| Propiedad intelectual / DOI (Fase 3) | **Parcial** — pendiente de confirmación del Prof. Mario Héctor Vogel sobre la fuente primaria a citar del modelo de pendiente discontinua (consulta enviada) |
| Modelo de datos (Fase 4) | Definida |
| Motor de cálculo (Fase 5) | Definida, réplica fiel del Excel original |

---

## 1. Arquitectura recomendada

**JAMstack con motor de cálculo en el cliente + persistencia híbrida en VM de GCP.**

```
┌─────────────────────┐         ┌──────────────────────────────┐
│   Netlify (frontend)  │        │   VM e2-micro GCP (backend)    │
│                        │        │                                  │
│  HTML/Svelte o Alpine  │  HTTPS │  Cloudflare Tunnel → FastAPI     │
│  Motor de cálculo JS   │───────▶│  (systemd, 1 worker)             │
│  (situación×impacto)   │        │  SQLite (persistencia)           │
│  Chart.js (gráficos)   │◀───────│  Réplica Python del motor         │
│                        │        │  (validación server-side)        │
└─────────────────────┘         │  (convive con bot de Discord)    │
                                    └──────────────────────────────┘
```

**Por qué esta combinación y no las otras dos evaluadas:**

| Criterio | A) JAMstack + GAS/Sheets | **B) Híbrida GCP VM (elegida)** | C) Full Serverless (Supabase) |
|---|---|---|---|
| Control y portabilidad de datos (clave para citar en OSF) | Bajo | **Alto** — SQLite es un archivo versionable | Medio — depende de un proveedor externo |
| Latencia y cuotas | Impredecible (cold starts de Apps Script) | Estable, controlada por vos | Cold starts de función serverless |
| Riesgo de colisión con el bot de Discord existente | N/A | Real, pero mitigable (ver §1.2) | N/A |
| Costo a 3-5 años | $0 | $0 dentro del Always Free Tier | $0 hasta que Supabase pause o cobre |

El motor de cálculo (~110 factores, aritmética simple de interpolación y sumas ponderadas) corre en **JavaScript en el cliente** para feedback instantáneo durante la entrevista, sin depender de la disponibilidad de la VM. La API en la VM se reserva para lo que sí necesita estado: guardar y listar evaluaciones, y **recalcular en Python el mismo resultado antes de persistirlo**, como control de integridad.

### 1.1 Conectividad Netlify (HTTPS) ↔ API Python en la VM

**Elegido: Cloudflare Tunnel**, no Nginx+Certbot ni Ngrok/Tailscale.

- No requiere abrir puertos en el firewall de GCP (la VM inicia la conexión hacia Cloudflare, no al revés) — menor superficie de ataque en una VM que ya expone un bot de Discord.
- HTTPS y certificado gestionados automáticamente, con subdominio fijo gratuito.
- Nginx+Certbot es válido pero exige más hardening del necesario para un MVP académico; Ngrok free tier cambia de URL en cada reinicio; Tailscale es para redes privadas, no para exponer un servicio a estudiantes/empresarios externos.

```bash
# En la VM, una sola vez
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o cloudflared
sudo mv cloudflared /usr/local/bin/ && sudo chmod +x /usr/local/bin/cloudflared
cloudflared tunnel login
cloudflared tunnel create foda-export-api
cloudflared tunnel route dns foda-export-api api.tudominio.com
```

CORS se resuelve en FastAPI con `CORSMiddleware`, restringiendo `allow_origins` al dominio de Netlify.

### 1.2 Convivencia con el bot de Discord (VM e2-micro: 1 vCPU compartida, 1 GB RAM)

1. **Servicio `systemd` separado**, con límites explícitos de memoria/CPU:

```ini
# /etc/systemd/system/foda-api.service
[Unit]
Description=FODA Export Misiones API
After=network.target

[Service]
ExecStart=/home/tuusuario/foda-api/venv/bin/uvicorn main:app --host 127.0.0.1 --port 8000 --workers 1
MemoryMax=200M
CPUQuota=40%
Restart=on-failure
User=tuusuario

[Install]
WantedBy=multi-user.target
```

2. **Un solo worker de Uvicorn**, sin `--reload` en producción.
3. **SQLite, no Postgres**: sin proceso de servidor propio, cero overhead de RAM en reposo.
4. **Swap de 2 GB** como colchón ante picos simultáneos:

```bash
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

5. Monitoreo mínimo vía cronjob que alerte por el propio bot de Discord si la RAM libre baja de un umbral.

Consumo esperado en reposo: 40-80 MB de RAM para la API (FastAPI + Uvicorn + SQLite).

---

## 2. Stack tecnológico

| Capa | Elección | Por qué |
|---|---|---|
| Frontend | **Vanilla JS + Alpine.js** (o Svelte si se prefiere compilar) | 110 preguntas repetitivas no requieren el overhead de React/Vue (bundler, virtual DOM); Alpine se pega como un `<script>`, sin pipeline de build |
| Gráficos | **Chart.js** | Cubre barras de evolución y burbujas FODA (tipo `bubble` con `scales` fijas para los 4 cuadrantes); Plotly y D3 son sobredimensionados para este alcance |
| Backend | **FastAPI** | Validación automática de los 110 campos con Pydantic, documentación OpenAPI autogenerada, asíncrono y liviano en RAM |
| Persistencia | **SQLite + SQLModel** | Un archivo, cero administración, backup = copiar el archivo, portable a OSF como dataset |
| Túnel/HTTPS | **Cloudflare Tunnel** | Ver §1.1 |

---

## 3. Propiedad intelectual, DOI y ciencia abierta

### 3.1 Objetos a citar, separados

No todo el proyecto es "una cosa" a efectos de citación. Se documentan y citan por separado:

| Objeto | Dónde vive | DOI | Autoría |
|---|---|---|---|
| **Modelo matemático** (ponderación de pendiente discontinua, tabla de conversión, fórmula de interpolación) | Preprint corto en OSF Preprints, documento independiente | DOI propio de OSF Preprints | **Adaptación** de la metodología *FODA Matemático* — ver §3.2 |
| **Instrumento** (110 preguntas PESTEL/Porter/Canvas + guía de entrevista) | Componente OSF "Metodología pedagógica" | DOI de componente OSF | Autoría propia (compilación y selección original) |
| **Software** (motor de cálculo + web app) | GitHub → Zenodo, vía Release | DOI versionado de Zenodo | Autoría propia del código |
| **Dataset** (relevamientos reales, anonimizados) | Componente OSF, cuando exista | DOI de componente OSF | Autoría/curaduría propia |

### 3.2 Atribución del modelo matemático — **pendiente de confirmación**

El sistema de ponderación situación×impacto de este instrumento (interpolación no lineal de % de logro a puntos 0-10, con pendiente discontinua que da más peso a cada punto porcentual cuanto más cerca o por encima de la meta) adapta la lógica de la metodología **FODA Matemático**, desarrollada por el **Prof. Mario Héctor Vogel**, fundador del **Club Tablero de Comando** (tablerodecomando.com, 1998–presente), formado en Balanced Scorecard directamente con su creador, el Dr. Robert Kaplan, en la Universidad de Harvard.

El autor del presente proyecto realizó dos capacitaciones del Club Tablero de Comando (Desarrollo BSC Integral, 32 hs, 2005; Desarrollo BSC Integral e Indicadores No Financieros, 32 hs, 2004), dictadas en Buenos Aires por el Cdor. Horacio Tuchszerer, Consultor Senior, durante su relación laboral con Forestadora Tapebicuá SA (Virasoro, Corrientes). De esas capacitaciones proviene el conocimiento del modelo de pendiente discontinua adaptado en este proyecto.

**Se envió consulta formal al Prof. Vogel** solicitando: (1) confirmación de la fuente primaria específica a citar, (2) autorización explícita para adaptar y citar el modelo en esta publicación académica sin fines de lucro, y (3) el formato de atribución que prefiera. **Este documento no debe considerarse cerrado hasta recibir esa respuesta.** Mientras tanto:

- No se usa el nombre **"FODA Matemático"** como nombre del instrumento propio (podría ser una marca de la consultora de Vogel); el instrumento se llama *FODA Export Misiones*.
- La cita provisional a usar en el software y la documentación, sujeta a actualización:

> Vogel, M. H. (s.f.). *FODA Matemático*. Club Tablero de Comando. Recuperado de https://www.tablerodecomando.com [pendiente de fecha/documento primario específico]

- Cuando Vogel responda, actualizar: esta sección, el preprint de OSF, el `CITATION.cff` del modelo matemático, y el `README.md` del repo.

### 3.3 Licencias

| Componente | Licencia | Motivo |
|---|---|---|
| Código fuente (`frontend/`, `backend/`) | **MIT** | Difusión amplia sin fricción legal para otras universidades/cátedras |
| Contenido metodológico (110 preguntas, guía de entrevista, documento explicativo) | **CC BY-NC-SA 4.0** | Es la contribución intelectual diferencial propia: se permite reuso con atribución y bajo la misma licencia, no comercialización sin permiso |

### 3.4 GitHub → Zenodo → DOI

1. Cuenta en Zenodo con login de GitHub (zenodo.org).
2. Zenodo → Settings → GitHub → activar el toggle en el repositorio.
3. Cada **Release** de GitHub (ej. `v1.0.0`) genera un **DOI versionado** automáticamente; existe además un "DOI concept" que siempre apunta a la última versión.
4. Completar `CITATION.cff` en la raíz — GitHub lo usa para el botón "Cite this repository" y Zenodo lo lee como metadata.
5. Agregar el badge de DOI de Zenodo al `README.md`.

### 3.5 Organización en OSF

- **Componente "Software"**: enlazado al repositorio de GitHub.
- **Componente "Modelo matemático"**: el preprint de fundamento (§3.2), con su propio DOI.
- **Componente "Metodología pedagógica"**: `EXPLICACION.md`, guía docente, rúbricas.
- **Componente "Guía de entrevista"**: PDF/MD exportado de `GUIA_ENTREVISTA`.
- **Componente "Dataset"** (cuando exista): datos de pymes **anonimizados** (sin razón social ni CUIT), con registro de consentimiento informado de cada empresa — revisar si corresponde aprobación de comité de ética de la universidad antes de publicar.

### 3.6 Cómo citar formalmente

```
[Software]
Apellido, N. (2026). FODA Export Misiones: instrumento de diagnóstico de viabilidad
exportadora para pymes industriales (v1.0.0) [Software]. Zenodo. https://doi.org/10.5281/zenodo.XXXXXXX

[Modelo matemático — adaptado]
Vogel, M. H. (s.f.). FODA Matemático [pendiente cita primaria]. Club Tablero de Comando.

[Proyecto de investigación]
Apellido, N. (2026). FODA Export Misiones: metodología, instrumento y dataset [Proyecto de
investigación]. OSF. https://doi.org/10.17605/OSF.IO/XXXXX
```

---

## 4. Modelo de datos

### 4.1 Esquema del cuestionario — `questionnaire.schema.json`

```json
{
  "version": "1.0.0",
  "areasInternas": [
    {
      "id": "IA",
      "nombre": "Segmentos de Clientes",
      "bloqueCanvas": "Segmentos de clientes",
      "items": [
        {
          "id": "IA1",
          "orden": 1,
          "titulo": "Definición de segmentos y países objetivo",
          "criterioFavorable": "La empresa tiene definidos, con datos, los tipos de cliente externo y los 2-3 países prioritarios.",
          "preguntaEntrevista": "¿Qué países o mercados tienen priorizados hoy, y con qué datos concretos lo decidieron?",
          "evidenciaSugerida": "Listado de países objetivo, estudio de mercado propio o de cámara sectorial",
          "quienResponde": "empresario",
          "lecturaSinExportar": null
        }
      ]
    }
  ],
  "areasExternas": [
    {
      "id": "EE",
      "nombre": "Logística e infraestructura regional",
      "marco": "PESTEL - Infraestructura",
      "items": ["EE1", "EE2", "EE3", "EE4", "EE5", "EE6", "EE7"]
    }
  ]
}
```

### 4.2 Esquema del resultado — `assessment.schema.json`

```json
{
  "id": "uuid-v4",
  "empresa": {
    "nombre": "Aserradero Norte S.R.L.",
    "rubro": "Forestal-maderero",
    "mercadosObjetivo": ["Brasil", "Chile"],
    "perfil": "exporta_actualmente | no_exporta_evalua_iniciar",
    "relevadoPor": "Equipo 3",
    "fecha": "2026-09-25"
  },
  "respuestas": [
    { "itemId": "IA1", "situacion": 4, "impacto": 3, "observacion": "" }
  ],
  "resultados": {
    "porItem": [
      { "itemId": "IA1", "puntos0a10": 7.2, "situacionPonderada": 0.5 }
    ],
    "porArea": [
      { "areaId": "IA", "ambito": "interno", "puntaje": 6.8, "semaforo": "Regular", "itemsRespondidos": 5, "alertas": 1 }
    ],
    "indiceInterno": 6.4,
    "indiceExterno": 5.9,
    "cuadranteDominante": "DO",
    "orientacionEstrategica": "Reorientación",
    "veredicto": "VIABLE_CON_CONDICIONES"
  },
  "metadata": { "versionMotor": "1.0.0", "creadoEn": "...", "actualizadoEn": "..." }
}
```

### 4.3 Estructura de carpetas

```
foda-export-misiones/
├── LICENSE                   # MIT (código)
├── LICENSE-CONTENT            # CC BY-NC-SA 4.0 (metodología)
├── CITATION.cff
├── README.md
├── ARCHITECTURE.md            # este documento
├── frontend/
│   ├── index.html
│   └── src/
│       ├── engine/            # calc.js — motor puro, testeable sin DOM
│       ├── data/               # questionnaire.json
│       ├── components/
│       └── charts/
├── backend/
│   ├── main.py                 # FastAPI
│   ├── models.py                # SQLModel
│   ├── engine_replica.py        # réplica Python del motor (validación server-side)
│   ├── database.db
│   └── routers/
├── docs/
│   ├── metodologia/             # EXPLICACION.md versionado
│   └── guia-entrevista/
├── data/
│   └── schema/                   # JSON Schema de preguntas y resultados
└── scripts/
    └── xlsx_to_json.py            # convierte el Excel original a questionnaire.json
```

---

## 5. Motor de cálculo

Réplica fiel de las fórmulas de `CalculosFoda`, `CalculoFoda-1` y la tabla `Rango` del Excel original (no es un algoritmo genérico de interpolación — sigue exactamente la ruta de cálculo del instrumento: situación normalizada → % de logro → interpolación de pendiente discontinua vía tabla `Rango` → puntos 0-10, ponderados por el peso relativo del impacto dentro de cada bloque).

```javascript
// frontend/src/engine/calc.js

// Tabla "Rango" del Excel: interpolación de pendiente discontinua, % de logro -> puntos
const RANGO = [
  { desde: 0,   hasta: 0,   pts: 0 },
  { desde: 0,   hasta: 20,  pts: 1 },
  { desde: 21,  hasta: 40,  pts: 3 },
  { desde: 41,  hasta: 60,  pts: 5 },
  { desde: 61,  hasta: 80,  pts: 7 },
  { desde: 81,  hasta: 100, pts: 10 },
  { desde: 101, hasta: 120, pts: 13 },
  { desde: 121, hasta: 140, pts: 16 },
  { desde: 141, hasta: 200, pts: 17 },
];

const PESO_SITUACION = [1, 2, 3, 4, 5];   // D..H: No corresp., Muy Desfav., Desfav., Fav., Muy Fav.
const PESO_IMPACTO = [1, 2, 3, 4];         // J..M: Muy insignif., Insignif., Significante, Muy Signif.
const SIGNO_SITUACION = { muyDesf: -1, desf: -0.5, fav: 0.5, muyFav: 1 };

function interpolarPuntos(pctLogro) {
  if (pctLogro === 0) return 0;
  let i = RANGO.findIndex(r => pctLogro <= r.hasta);
  if (i === -1) i = RANGO.length - 1;
  const sup = RANGO[i];
  const inf = RANGO[Math.max(0, i - 1)];
  if (sup.hasta === inf.hasta) return sup.pts;
  const frac = (pctLogro - inf.hasta) / (sup.hasta - inf.hasta);
  return inf.pts + frac * (sup.pts - inf.pts);
}

function calcularItem(r) {
  if (r.situacion == null || r.impacto == null) {
    return { puntos0a10: 0, situacionPonderada: 0, respondido: false };
  }
  const situacionBruta = PESO_SITUACION[r.situacion];
  const pctLogro = (situacionBruta / 5) * 100;
  const puntos = interpolarPuntos(pctLogro);
  const signos = [0, SIGNO_SITUACION.muyDesf, SIGNO_SITUACION.desf, SIGNO_SITUACION.fav, SIGNO_SITUACION.muyFav];
  return {
    puntos0a10: puntos,
    situacionPonderada: signos[r.situacion],
    respondido: true,
    impactoIdx: r.impacto,
  };
}

function calcularArea(itemsDelArea) {
  const calculados = itemsDelArea.map(calcularItem);
  const respondidos = calculados.filter(c => c.respondido);
  if (respondidos.length === 0) {
    return { puntaje: 0, itemsRespondidos: 0, alertas: 0, semaforo: 'sin datos' };
  }
  const impactosBrutos = respondidos.map(c => PESO_IMPACTO[c.impactoIdx]);
  const sumaImpactos = impactosBrutos.reduce((a, b) => a + b, 0);

  let puntajeArea = 0;
  let situacionPonderadaArea = 0;
  respondidos.forEach((c, idx) => {
    const pesoRelativo = impactosBrutos[idx] / sumaImpactos;
    puntajeArea += c.puntos0a10 * pesoRelativo;
    situacionPonderadaArea += c.situacionPonderada * pesoRelativo;
  });

  const alertas = respondidos.filter(c => c.puntos0a10 > 0 && c.puntos0a10 < 5).length;

  return {
    puntaje: Math.round(puntajeArea * 100) / 100,
    situacionPonderadaPromedio: situacionPonderadaArea,
    itemsRespondidos: respondidos.length,
    itemsTotales: itemsDelArea.length,
    alertas,
    semaforo: semaforoDe(puntajeArea),
  };
}

function semaforoDe(puntaje) {
  if (puntaje === 0) return 'sin datos';
  if (puntaje > 10) return 'Excelencia';
  if (puntaje >= 8) return 'Bueno';
  if (puntaje >= 5) return 'Regular';
  return 'Alarmante';
}

function calcularViabilidad(areasInternas, areasExternas, umbrales = { viable: 7, viableConCondiciones: 5 }) {
  const promedio = (areas) => {
    const conDatos = areas.filter(a => a.puntaje > 0);
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

export { calcularItem, calcularArea, calcularViabilidad, interpolarPuntos };
```

**Nota de integridad:** este mismo cálculo debe portarse 1:1 a `backend/engine_replica.py` y recalcularse server-side antes de persistir cada evaluación, para que el dato guardado en SQLite no dependa de que el JS del cliente no haya sido alterado.

---

## 6. Riesgos y pendientes abiertos

1. **Autenticación mínima** en la API antes de exponerla públicamente vía Cloudflare Tunnel (al menos una API key por equipo/cátedra).
2. **Backups automáticos** del SQLite (cronjob diario a Google Drive o GCS).
3. **Consentimiento informado y anonimización** del dataset antes de publicarlo en OSF — verificar si aplica comité de ética de la universidad.
4. **Versionado del cuestionario**: cada `assessment` debe quedar asociado a la versión de `questionnaire.json` con la que se respondió (campo `versionMotor`).
5. **Confirmación pendiente del Prof. Vogel** (§3.2) — bloquea la publicación final del preprint de fundamento matemático hasta recibir respuesta.
6. **Disponibilidad de la VM**: sin SLA; el frontend debería bufferizar en `localStorage` y reintentar el `POST` si la API no responde, para no perder una entrevista de 45 minutos por una caída puntual.
