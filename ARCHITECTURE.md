# ARCHITECTURE.md — FODA Export Misiones

Documento de arquitectura técnica del proyecto **FODA Export Misiones**: aplicación web para el diagnóstico de viabilidad exportadora de pymes industriales de Misiones (Argentina), desarrollado en el marco de investigación aplicada y docencia universitaria en la Tecnicatura Superior en Comercio Exterior.

Este documento consolida las decisiones de arquitectura, stack tecnológico, estrategia de protección intelectual/ciencia abierta, modelo de datos y motor de cálculo. Vive en la raíz del repositorio y se actualiza cada vez que cambia una decisión estructural — no un detalle de implementación menor.

---

## 0. Estado del documento

| Sección | Estado |
|---|---|
| Arquitectura (Fase 1) | Definida |
| Stack tecnológico (Fase 2) | Definida |
| Propiedad intelectual / DOI (Fase 3) | **Resuelta** — autorización del Prof. Mario Héctor Vogel recibida por escrito (1/10/2026); queda solo un dato de URL confirmado tácitamente (ver §3.2) |
| Modelo de datos (Fase 4) | `questionnaire.schema.json` **implementado y cerrado** (Fase 1 del plan de trabajo: `scripts/xlsx_to_json.py`, 110 ítems/19 áreas verificados); `assessment.schema.json` definido, pendiente de uso en Fase 3 |
| Motor de cálculo (Fase 5 de esta sección / Fase 2 del plan de trabajo) | `calcularItem`/`calcularArea`/`calcularViabilidad` **validados contra tests golden** (11/10/2026). `calcularMatrizFoda` (cuadrante dominante FO/FA/DO/DA) **también validado contra tests golden** (13/10/2026) — resultó ser 100% automático, ver §5 |

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

**Elegido: Cloudflare Tunnel**, no Nginx+Certbot ni Ngrok/Tailscale. Esto no cambia. Lo que sí se decide acá (11/10/2026) es **qué variante de Cloudflare Tunnel usar mientras no hay presupuesto para un dominio propio**.

**Restricción real:** un *tunnel nombrado* (`cloudflared tunnel create` + `tunnel route dns`) necesita un dominio dado de alta como zona DNS en la cuenta de Cloudflare — eso implica comprar un dominio (aun el más barato, del orden de USD 10-15/año) o conseguir uno gratis de forma confiable, lo cual hoy no es el caso.

**Decisión para las Fases 4-5 (piloto): usar un *Quick Tunnel*** (`cloudflared tunnel --url http://localhost:8000`, sin `tunnel create` ni dominio propio) — gratis, HTTPS automático, cero configuración de DNS. La contrapartida: Cloudflare asigna una URL aleatoria tipo `https://algo-random.trycloudflare.com` **cada vez que el proceso arranca**, y no es estable entre reinicios.

Cómo se compensa esa inestabilidad sin pagar nada:

1. **El proceso corre bajo `systemd` con `Restart=on-failure`** (igual que ya estaba previsto en §1.2) — mientras no se caiga ni se reinicie la VM, la URL se mantiene estable durante toda una clase o un período de relevamiento.
2. **El frontend NO hardcodea la URL de la API en el build.** Guarda la URL base de la API en `localStorage` (configurable desde una pantalla simple de "Configuración" en la app), con un valor por defecto de `localStorage` → si no hay API disponible, igual funciona en modo offline-first (ya era un requisito de la Fase 3: guardar en `localStorage` y reintentar el `POST`). Así, si la URL cambia, se actualiza una vez en el navegador del equipo que está usando la app — sin re-deploy de Netlify.
3. **Antes de cada sesión de entrevistas** (clase, jornada de relevamiento), quien gestiona la VM corre un script corto que imprime la URL activa del túnel (se puede capturar del log de `cloudflared` o exponiendo un endpoint `/health` que la devuelva) y la comparte con el equipo si cambió.

```bash
# En la VM — Quick Tunnel, sin dominio propio (Fases 4-5)
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o cloudflared
sudo mv cloudflared /usr/local/bin/ && sudo chmod +x /usr/local/bin/cloudflared
cloudflared tunnel --url http://localhost:8000
# La URL pública queda en la salida del comando / en journalctl -u foda-tunnel -f
```

**Camino de migración cuando haya presupuesto (no urgente, no bloquea ninguna fase):** comprar un dominio barato (.xyz/.lol/.com, ~USD 10-15/año en Namecheap o Porkbun) o conseguir uno institucional a través del Instituto Alfa, agregarlo como zona en Cloudflare, y recién ahí migrar a un *tunnel nombrado* (los comandos `tunnel create`/`tunnel route dns` que ya estaban documentados abajo quedan como referencia para ese momento). Ninguna otra parte de la arquitectura cambia con esta migración — es solo reemplazar el Quick Tunnel por uno nombrado.

```bash
# Migración futura, cuando haya un dominio propio en Cloudflare — NO ejecutar todavía
cloudflared tunnel login
cloudflared tunnel create foda-export-api
cloudflared tunnel route dns foda-export-api api.tudominio.com
```

CORS se resuelve en FastAPI con `CORSMiddleware`. Con Quick Tunnel, `allow_origins` no puede fijarse a un subdominio propio estable (no existe todavía) — se restringe en cambio al dominio de Netlify (que si es estable: `*.netlify.app` o el dominio final del proyecto), que es el origen real desde donde llegan las requests, no el origen del túnel.

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

### 3.2 Atribución del modelo matemático — **resuelta** (dato de URL confirmado tácitamente)

El sistema de ponderación situación×impacto de este instrumento (interpolación no lineal de % de logro a puntos 0-10, con pendiente discontinua que da más peso a cada punto porcentual cuanto más cerca o por encima de la meta) adapta la lógica de la metodología **FODA Matemático**, desarrollada por el **Prof. Mario Héctor Vogel**, fundador del **Club Tablero de Comando** (tablerodecomando.com, 1998–presente), formado en Balanced Scorecard directamente con su creador, el Dr. Robert Kaplan, en la Universidad de Harvard.

El autor del presente proyecto realizó dos capacitaciones del Club Tablero de Comando (Desarrollo BSC Integral, 32 hs, 2005; Desarrollo BSC Integral e Indicadores No Financieros, 32 hs, 2004), dictadas en Buenos Aires por el Cdor. Horacio Tuchszerer, Consultor Senior, durante su relación laboral con Forestadora Tapebicuá SA (Virasoro, Corrientes). De esas capacitaciones proviene el conocimiento del modelo de pendiente discontinua adaptado en este proyecto.

**Autorización escrita recibida (1/10/2026):**

> "Por el presente autorizo a Hugo César Galván a citar en su publicación el uso académico de la metodología de FODA MATEMATICO."
> — Prof. Mario Héctor Vogel, 1/10/2026 (ver `docs/atribucion/ProfVogel_Galvan_011026.docx` y `docs/atribucion/INTERCAMBIO_EMAILS.md`)

En esa misma respuesta, Vogel firmó como *"Prof. Mario Hector Vogel, Director de planeamientoestrategico.net, Creador de la metodología FODA Matemático"*. Ese dominio no se pudo verificar como propio en una búsqueda independiente; el 1/10/2026 se le envió un mail de agradecimiento que dejaba asentada, de forma afirmativa y corregible, la cita con el dominio `planeacionestrategica.net` (la variante que sí es un sitio activo y explorable, consistente con un error de tipeo del original). **Al 6/10/2026 — 5 días después, sin respuesta — se da por confirmado tácitamente**, dado que sus dos respuestas anteriores llegaron en 3 días como máximo. Queda registrado explícitamente como **confirmación tácita por ausencia de objeción**, no como confirmación expresa — distinción que se mantiene en cualquier texto publicado que cite el dato.

Firma completa a usar en atribuciones: *"Prof. Mario Héctor Vogel, Director de planeacionestrategica.net, Creador de la metodología FODA Matemático"*.

**Fuente primaria citada:**

> Vogel, M. H. (s.f.). *Balanced Scorecard, Software Indicadores de Gestión y FODA Matemático con Rigor Científico*. Autopublicado (Amazon). [pendiente: año de edición, ISBN/ASIN — a confirmar]

Como referencia secundaria (sitio del autor, contexto institucional del Club Tablero de Comando):

> Vogel, M. H. (s.f.). *FODA Matemático*. Club Tablero de Comando. Recuperado de https://www.tablerodecomando.com

Referencia académica independiente que respalda la autoría (no autopublicada, hallada por fuera del intercambio directo con Vogel):

> Granizo et al. (2026). FODA Matemático, herramienta de diagnóstico estratégico en empresas agroindustriales. *Reciena*, 6(1), 19–23. [atribuye el desarrollo del enfoque matemático del FODA a Mario Héctor Vogel, 2003]

#### 3.2.1 Nota de alcance — por qué no se cita Singer & Willett / regresión discontinua para el motor actual

Vogel sugirió además anclar el modelo en literatura de regresión segmentada / *regression discontinuity design* (Singer & Willett, 2003; Imbens & Lemieux, 2008; Muggeo, 2003). **Esa literatura no describe el motor implementado en `CalculosFoda`/`Rango`** y no se usa para documentarlo, por una razón concreta: esos modelos estiman una relación a partir de datos observados (ajustan una regresión, inferencia de un efecto, datos longitudinales con mediciones repetidas en el tiempo), mientras que la tabla `Rango` es una **función de conversión fija y determinística** (% de logro → puntos), sin ajuste de ningún modelo, sin componente temporal y sin inferencia causal — más cercana, en términos de teoría de decisión, a una función de valor no lineal (ver nota en el preprint, documento de fundamento §2).

Se deja registrada esta sugerencia como **línea de trabajo futura** (ver §6, ítem 8: diseño longitudinal pre-post), no como fundamento del motor vigente — de modo de no mezclar un instrumento de corte transversal con citas que exigen diseño de datos pareados/longitudinales que hoy no se releva.

- Pendiente, no bloqueante: si en algún momento Vogel confirma o corrige expresamente el dominio, actualizar esta sección y el preprint.

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
Galván, H. C. (2026). FODA Export Misiones: instrumento de diagnóstico de viabilidad
exportadora para pymes industriales (v1.0.0) [Software]. Zenodo. https://doi.org/10.5281/zenodo.XXXXXXX

[Modelo matemático — adaptado, con autorización del autor]
Vogel, M. H. (s.f.). Balanced Scorecard, Software Indicadores de Gestión y FODA Matemático
con Rigor Científico. Autopublicado.

[Proyecto de investigación]
Galván, H. C. (2026). FODA Export Misiones: metodología, instrumento y dataset [Proyecto de
investigación]. OSF. https://doi.org/10.17605/OSF.IO/XXXXX
```

---

## 4. Modelo de datos

### 4.1 Esquema del cuestionario — `questionnaire.schema.json`

**Implementado en Fase 1** (`scripts/xlsx_to_json.py`, validado con `data/schema/questionnaire.schema.json`). La versión anterior de este documento mostraba `areasInternas` con ítems como objetos completos y `areasExternas` con ítems como un array plano de IDs (`["EE1", "EE2", ...]`) — esa inconsistencia **se resolvió al implementar el script**: ambas usan ítems como objetos completos, porque `GUIA_ENTREVISTA` tiene la misma información completa (pregunta de entrevista, evidencia, quién responde, lectura sin exportar) para los 46 ítems externos que para los 64 internos.

```json
{
  "version": "1.1.0",
  "fuente": "FODA_Export_Misiones_2026_DEMO.xlsx",
  "escalas": {
    "situacion": ["No corresp.", "Muy Desfav.", "Desfavorable", "Favorable", "Muy Favorable"],
    "impacto": ["Muy insignif", "Insignificante", "Significante", "Muy Signific."]
  },
  "areasInternas": [
    {
      "id": "IA",
      "nombre": "Segmentos de clientes",
      "tipo": "interno",
      "marco": "Canvas — Segmentos de clientes",
      "items": [
        {
          "id": "IA1",
          "orden": 1,
          "titulo": "Definición de segmentos y países objetivo",
          "criterioFavorable": "Se considera favorable si la empresa tiene definidos, con datos, los tipos de cliente externo (importador, distribuidor, industria, retail) y los 2 o 3 países prioritarios.",
          "preguntaEntrevista": "¿A qué tipo de clientes y en qué países querría vender? ¿Con qué datos lo decidió?",
          "evidenciaSugerida": "Lista de países y segmentos priorizados; estudio o fuente consultada.",
          "quienResponde": "Empresario: datos de cartera y experiencia actuales. Estudiante: investigación de países y segmentos candidatos, a validar con el empresario.",
          "lecturaSinExportar": "Favorable si, aunque nunca exportó, el equipo ya identificó con datos 2-3 países/segmentos candidatos...",
          "clasificacionMarco": { "tipo": "Canvas puro", "bloquePrincipal": "Segmentos de clientes", "bloqueSecundario": null, "nota": null },
          "filaFormularioFoda": 6
        }
      ]
    }
  ],
  "areasExternas": [
    {
      "id": "EE",
      "nombre": "Logística e Infraestructura Regional",
      "tipo": "externo",
      "marco": "Ámbito externo (7 Agregado) — ver 'clasificacionMarco' por ítem",
      "items": [
        {
          "id": "EE1",
          "orden": 1,
          "titulo": "Red vial y conectividad multimodal",
          "criterioFavorable": "Se considera favorable si rutas y accesos (p. ej., RN 12 y RN 14) permiten trasladar la carga a frontera y puertos en tiempo y costo razonables.",
          "preguntaEntrevista": "¿Cómo es hoy el traslado de su mercadería hacia frontera y puertos?",
          "evidenciaSugerida": "Estado de rutas; tiempos y costos de transporte.",
          "quienResponde": "Estudiante (investigación de rutas, pasos de frontera, puertos y prestadores logísticos regionales).",
          "lecturaSinExportar": "No depende de si la empresa exporta: describe el entorno o el mercado destino, no a la empresa.",
          "clasificacionMarco": { "tipo": "Agregado", "pestel": null, "porter": null, "nota": "Infraestructura física; no está en PESTEL ni en Porter" },
          "filaFormularioFoda": 124
        }
      ]
    }
  ]
}
```

**Fuente de cada campo:**

| Campo | Hoja de origen | Columna |
|---|---|---|
| `id` (código corto, p. ej. `IA1`) | `GUIA_ENTREVISTA` | B |
| `titulo`, `criterioFavorable` | `FormularioFODA` | B (parseado: `"N - Título. Se considera favorable si <criterio>."`) |
| `preguntaEntrevista` | `GUIA_ENTREVISTA` | E |
| `evidenciaSugerida` | `GUIA_ENTREVISTA` | F |
| `quienResponde` | `GUIA_ENTREVISTA` | H |
| `lecturaSinExportar` | `GUIA_ENTREVISTA` | I |
| `clasificacionMarco` | `docs/clasificacion/mapeo_Canvas_internos.csv` (internas) / `mapeo_PESTEL_Porter_externos.csv` (externas) | — (ver abajo) |
| `filaFormularioFoda` (trazabilidad) | `GUIA_ENTREVISTA` | G ("Fila en FormularioFODA") |

**Decisión documentada — `clasificacionMarco` por ítem (actualiza la decisión anterior sobre `marco` de áreas externas):** el Excel no tiene ninguna columna que clasifique cada ítem contra PESTEL/Porter (externas) o contra los bloques del Canvas de Osterwalder (internas). La primera versión de este script resolvía esto con un único "marco" hardcodeado por ÁREA (`MARCO_AREAS_EXTERNAS`), una aproximación que resultó **inexacta en los bordes** — por ejemplo, etiquetaba todo el bloque `EE` (Logística e Infraestructura Regional) como "PESTEL" cuando, mirado ítem por ítem, ningún factor de `EE` encaja realmente en una dimensión PESTEL ni en una fuerza de Porter.

El autor hizo esa clasificación a mano, ítem por ítem, en dos CSV (`docs/clasificacion/mapeo_Canvas_internos.csv`, 64 filas; `mapeo_PESTEL_Porter_externos.csv`, 46 filas — ver también `Distinciones_PESTEL_PORTER.md`). Antes de incorporarlos se verificó que sus 110 códigos coinciden 1:1 con los 110 códigos extraídos de `GUIA_ENTREVISTA`/`FormularioFODA` (sin faltantes ni sobrantes de ningún lado). El script ahora lee esos CSV y arma, por ítem, un campo `clasificacionMarco`:

- **Internos** (`tipo`: `Canvas puro` 52 ítems / `Combinada` 5 / `Agregado` 7 — el bloque `IJ`, transversal, fuera de los 9 bloques de Osterwalder): `bloquePrincipal`, `bloqueSecundario` (solo si `Combinada`), `nota`.
- **Externos** (`tipo`: `PESTEL puro` 20 / `Porter puro` 10 / `Combinada` 5 / `Agregado` 11): `pestel`, `porter` (cada uno `null` si no aplica), `nota`.

El campo `marco` a nivel de ÁREA se mantiene como un resumen agregado legible (p. ej. `"Ámbito externo (7 Agregado) — ver 'clasificacionMarco' por ítem"` para `EE`), pero deja de ser la fuente de verdad — la clasificación autorizada vive en `clasificacionMarco` de cada ítem. Detalle completo del análisis en `data/schema/questionnaire.schema.json` → `$defs/clasificacionCanvas` y `$defs/clasificacionPestelPorter`.

**Decisión documentada — columna C de `FormularioFODA` — resuelta (ya no es una duda pendiente):** se verificó celda por celda, en las 110 filas del DEMO, que `FormularioFODA!C` es **idéntica** a `CalculosFoda!AD` ("Pts" = `Puntos × Respondido`, ver corrección abajo). En el Excel **en blanco** (sin respuestas cargadas) esa misma columna da 0 en las 110 filas. Conclusión: la columna C **no es un dato del ítem**, es un **resultado** que depende de las respuestas de situación/impacto de una evaluación concreta. Por eso correctamente no se incorpora a `questionnaire.json` (que describe las preguntas, no las respuestas) — corresponde, cuando exista el motor, a `assessment.schema.json` → `resultados.porItem[].puntos0a10` (§4.2).

**Corrección (11/10/2026) a lo que se había anotado acá sobre `CalculosFoda!AC`:** en la entrega anterior de esta sección se afirmó, sin haberlo verificado con suficiente cuidado, que `AC` era un signo ±1 según si el Logro superaba la Meta (favorable/desfavorable). Al revisar la fórmula real de `AC` (`=IF(V3>0,1)+(IF(V3<0,-1))`) y de `V` (`=IF(ISERROR(T3/S3*100-...),0,T3/S3*100-...)`, que es **% de logro = Logro/Meta×100**, no "Logro − Meta") se comprobó que `V` es siempre ≥ 0 bajo este instrumento: `Logro` (peso de la situación marcada, 1-5) nunca puede ser negativo ni superar `Meta` (constante = 5), así que `V` va de 0% (nada marcado) a 100% (Muy Favorable). **`AC` nunca vale −1 en los datos reales** — se verificó contra los 110 ítems del DEMO (110 de 110 en `AC=1`). `AC` es, en los hechos, un indicador binario de **"¿se marcó una opción de situación?"** (1 si sí, 0 si no), no un signo favorable/desfavorable. No existe ningún componente de "signo" a nivel de ítem en el motor real — la noción `SIGNO_SITUACION`/`situacionPonderada` del borrador de `calc.js` (§5) y de `assessment.schema.json` (§4.2) **no tiene contraparte en el Excel** y se elimina de ambos. Se deja esta corrección explícita, en vez de borrar en silencio el error anterior, siguiendo la regla del proyecto de no presentar como hecho lo que no se verificó.

**Corrección/ampliación (11/10/2026) — el épsilon de `CalculosFoda!W`:** al construir los tests golden de Fase 2 se encontró que el Excel real no interpola directamente sobre `V` (% de logro), sino sobre `W = ABS(V) - 0.001` (`CalculosFoda!W`). Es un truco deliberado para evitar ambigüedad de `MATCH`/`VLOOKUP` exactamente en los límites de cada tramo de la tabla `Rango` (20, 40, 60, 80, 100...). Por eso valores que caen justo en un límite de tramo (p. ej. situación "Desfavorable" → 60% de logro exacto) dan en el Excel real `4.9999`, no `5` — de ahí los `.9999` que aparecían en los datos sin que hubiera, al principio, una explicación. `interpolarPuntos` en `calc.js` (§5) ya replica este épsilon. Se documenta como la rareza deliberada que es, no como algo a "limpiar".

**Corrección (13/10/2026) — SÍ existe un "signo" de situación en el Excel, pero en otra hoja:** la corrección del 11/10/2026 decía, de forma demasiado general, que "no existe ningún componente de signo a nivel de ítem en el motor real". Eso es correcto para la ruta `CalculosFoda`/`Rango`/`VIABILIDAD` (puntaje 0-10, semáforo, índices, veredicto — lo que calculan `calcularItem`/`calcularArea`/`calcularViabilidad`), pero es **incorrecto como afirmación general**: existe una ruta paralela, la hoja `CalculoFoda-1` (nombre parecido a `CalculosFoda` a propósito en el Excel original — fuente de confusión), que sí usa un signo real de 4 niveles (`S2:V2` = -1/-0.5/0.5/1 para Muy Desfav./Desfav./Fav./Muy Fav.) para clasificar cada factor en Fortaleza/Debilidad (internos) u Oportunidad/Amenaza (externos). Esta ruta alimenta `PART1 FODA`, `PART2 FODA`, `MATRIZ FODA`, `ResumenFODA!E` (un índice de "situación actual" de -1 a +1, distinto del puntaje 0-10 de VIABILIDAD) y, en definitiva, el cuadrante FODA dominante — ver el hallazgo completo en §5. Se corrige acá en vez de borrar en silencio la afirmación anterior, por la misma regla del proyecto.

### 4.2 Esquema del resultado — `assessment.schema.json`

```json
{
  "id": "uuid-v4",
  "empresa": {
    "nombre": "Aserradero Norte S.R.L.",
    "empresaId": null,
    "rubro": "Forestal-maderero",
    "mercadosObjetivo": ["Brasil", "Chile"],
    "perfil": "exporta_actualmente | no_exporta_evalua_iniciar",
    "relevadoPor": "Equipo 3",
    "fecha": "2026-09-25",
    "autorizaRecontacto": false
  },
  "respuestas": [
    { "itemId": "IA1", "situacion": 4, "impacto": 3, "observacion": "" }
  ],
  "resultados": {
    "porItem": [
      { "itemId": "IA1", "puntos0a10": 7.2 }
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

`empresaId` (hash estable, ej. derivado del CUIT, nunca el CUIT en texto plano) y `autorizaRecontacto` son campos opcionales que preparan la posibilidad de un diseño longitudinal pre-post (§6, ítem 8) sin comprometer nada del diagnóstico de corte transversal actual. Quedan en `null`/`false` salvo que el equipo decida usarlos.

### 4.3 Estructura de carpetas

```
foda-export-misiones/
├── LICENSE                   # MIT (código)
├── LICENSE-CONTENT            # CC BY-NC-SA 4.0 (metodología)
├── CITATION.cff
├── README.md
├── ARCHITECTURE.md            # este documento
├── .gitignore
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
│   └── routers/
├── docs/
│   ├── metodologia/             # EXPLICACION.md versionado
│   ├── atribucion/              # ProfVogel_Galvan_011026.docx, INTERCAMBIO_EMAILS.md
│   ├── referencia/              # Excel originales (DEMO y en blanco), solo lectura
│   ├── clasificacion/           # mapeo_Canvas_internos.csv, mapeo_PESTEL_Porter_externos.csv (§4.1)
│   └── guia-entrevista/
├── data/
│   └── schema/                   # JSON Schema de preguntas y resultados
├── tests/                         # tests golden del motor (calc.golden.test.mjs, golden.demo.json)
├── .github/
│   └── workflows/                 # tests.yml — CI de los tests golden
└── scripts/
    ├── xlsx_to_json.py              # convierte el Excel original a questionnaire.json
    ├── golden_extract.py            # extrae valores golden del DEMO para los tests
    └── extraer_dependencias_foda.py # extrae la tabla fija de VariablesFoda -> dependenciasFoda.json
```

`frontend/src/data/dependenciasFoda.json` (generado por `extraer_dependencias_foda.py`) se agrega junto a `questionnaire.json` en `frontend/src/data/` — ver §5.

---

## 5. Motor de cálculo

Réplica fiel de las fórmulas de `CalculosFoda`, `CalculoFoda-1` y la tabla `Rango` del Excel original (no es un algoritmo genérico de interpolación — sigue exactamente la ruta de cálculo del instrumento: situación normalizada → % de logro → interpolación de pendiente discontinua vía tabla `Rango` → puntos 0-10, ponderados por el peso relativo del impacto dentro de cada bloque).

```javascript
// frontend/src/engine/calc.js
// Implementado y validado en Fase 2 contra tests golden extraídos del DEMO
// (ver scripts/golden_extract.py y tests/calc.golden.test.mjs). Reemplaza el
// borrador anterior: se eliminó todo concepto de "signo" a nivel de ítem
// (SIGNO_SITUACION / situacionPonderada) porque no existe en el Excel real
// — ver la corrección en §4.1/§3.2.1 y la nota al pie de esta sección.

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

const META = 5; // CalculosFoda!S: constante, igual al peso máximo de Situación
const PESO_SITUACION = [1, 2, 3, 4, 5];   // índice 0..4: No corresp., Muy Desfav., Desfav., Fav., Muy Fav. (CalculosFoda!E2:I2)
const PESO_IMPACTO = [1, 2, 3, 4];         // índice 0..3: Muy insignif., Insignif., Significante, Muy Signif. (CalculosFoda!K2:N2)

// Replica CalculosFoda!AB: =IF(AND(Y=0,X<>0),X,IF(AA=0,0,X+((W-Z)*(Y-X))/AA)),
// donde W = CalculosFoda!W = ABS(V)-0.001.
//
// Decisión documentada (no es un "error" a corregir): el Excel real le resta
// un épsilon de 0.001 al % de logro ANTES de ubicarlo en la tabla Rango. Es
// un truco deliberado para evitar ambigüedad de MATCH exactamente en los
// límites de cada tramo (20, 40, 60, 80...). El efecto visible en
// CalculosFoda es que un ítem que cae justo en un límite de tramo (p. ej.
// situación "Desfavorable" -> 60% de logro exacto) da 4.9999 en vez de 5 —
// de ahí los `.9999` que aparecen en los datos reales. Se reproduce tal
// cual, no se "limpia", siguiendo la regla del proyecto de no aproximar
// rarezas del Excel por prolijidad.
function interpolarPuntos(pctLogro) {
  if (pctLogro === 0) return 0;
  const w = Math.abs(pctLogro) - 0.001; // CalculosFoda!W
  let i = RANGO.findIndex(r => w <= r.hasta);
  if (i === -1) i = RANGO.length - 1;
  const sup = RANGO[i];
  const inf = RANGO[Math.max(0, i - 1)];
  if (sup.hasta === inf.hasta) return sup.pts;
  const frac = (w - inf.hasta) / (sup.hasta - inf.hasta);
  return inf.pts + frac * (sup.pts - inf.pts);
}

// Replica CalculosFoda!J (situación bruta), V (% de logro), AB (Puntos),
// AC (respondido: 1/0 — NO es un signo, ver nota de la sección) y AD (Pts).
function calcularItem(r) {
  if (r.situacion == null || r.impacto == null) {
    return { puntos0a10: 0, respondido: false };
  }
  const situacionBruta = PESO_SITUACION[r.situacion];       // J
  const pctLogro = (situacionBruta / META) * 100;            // V
  const puntos = interpolarPuntos(pctLogro);                 // AB
  const respondido = situacionBruta > 0 ? 1 : 0;              // AC
  return {
    puntos0a10: puntos * respondido,                          // AD
    respondido: respondido === 1,
    impactoIdx: r.impacto,
  };
}

// Replica CalculosFoda!O (impacto bruto), P (peso relativo del impacto
// dentro del área) y AE (Valor Pond) sumados = VIABILIDAD!C15..C37.
function calcularArea(itemsDelArea) {
  const calculados = itemsDelArea.map(calcularItem);
  const respondidos = calculados.filter(c => c.respondido);
  if (respondidos.length === 0) {
    return { puntaje: 0, itemsRespondidos: 0, itemsTotales: itemsDelArea.length, alertas: 0, semaforo: 'sin datos' };
  }
  const impactosBrutos = respondidos.map(c => PESO_IMPACTO[c.impactoIdx]);
  const sumaImpactos = impactosBrutos.reduce((a, b) => a + b, 0);

  let puntajeArea = 0;
  respondidos.forEach((c, idx) => {
    const pesoRelativo = sumaImpactos === 0 ? 0 : impactosBrutos[idx] / sumaImpactos; // P
    puntajeArea += c.puntos0a10 * pesoRelativo;                                        // AE, sumado
  });

  // VIABILIDAD!F15..F37: COUNTIFS(AD,"<5",AD,">0") — alerta = respondido con puntos bajos
  const alertas = respondidos.filter(c => c.puntos0a10 > 0 && c.puntos0a10 < 5).length;

  return {
    puntaje: Math.round(puntajeArea * 100) / 100,
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

// --- Matriz FODA (cuadrante dominante) -- CalculoFoda-1/VariablesFoda/
// PART2 FODA/MATRIZ FODA. Ver el hallazgo de Fase 3 más abajo: es 100%
// automático, no requiere carga cualitativa manual.

const SIGNO_SITUACION = [0, -1, -0.5, 0.5, 1]; // CalculoFoda-1!S2:V2

function clasificarFactor(situacionIdx) {
  if (situacionIdx === 3 || situacionIdx === 4) return 'positivo'; // Fav./Muy Fav. -> Fortaleza/Oportunidad
  if (situacionIdx === 1 || situacionIdx === 2) return 'negativo'; // Muy Desfav./Desfav. -> Debilidad/Amenaza
  return null; // "No corresponde" o sin responder -> no participa del cruce
}

const ORIENTACION_POR_CUADRANTE = {
  FO: 'Ofensiva: usar las fortalezas para aprovechar las oportunidades del mercado.',
  FA: 'Defensiva: usar las fortalezas para neutralizar amenazas del entorno.',
  DO: 'Reorientación: superar debilidades para capturar oportunidades.',
  DA: 'Supervivencia: reducir debilidades y evitar amenazas; no exportar aún.',
};

// dependenciasFoda = { idInterno: [idExterno, ...] } -- tabla FIJA extraída de
// VariablesFoda por scripts/extraer_dependencias_foda.py (no depende de la evaluación).
function calcularMatrizFoda(questionnaire, respuestasPorItem, dependenciasFoda) {
  const situacionDe = (id) => respuestasPorItem[id]?.situacion ?? null;
  const conteo = { FO: 0, FA: 0, DO: 0, DA: 0 };
  let sinConsiderar = 0;

  for (const [idInterno, externos] of Object.entries(dependenciasFoda)) {
    const cInterno = clasificarFactor(situacionDe(idInterno));
    for (const idExterno of externos) {
      const cExterno = clasificarFactor(situacionDe(idExterno));
      if (cInterno === 'positivo' && cExterno === 'positivo') conteo.FO++;
      else if (cInterno === 'positivo' && cExterno === 'negativo') conteo.FA++;
      else if (cInterno === 'negativo' && cExterno === 'positivo') conteo.DO++;
      else if (cInterno === 'negativo' && cExterno === 'negativo') conteo.DA++;
      else sinConsiderar++;
    }
  }

  const totalCruces = conteo.FO + conteo.FA + conteo.DO + conteo.DA;
  const porcentajes = Object.fromEntries(
    Object.entries(conteo).map(([k, v]) => [k, totalCruces === 0 ? 0 : v / totalCruces])
  );

  let cuadranteDominante = null;
  if (totalCruces > 0) {
    cuadranteDominante = Object.keys(conteo).reduce((max, k) => (conteo[k] > conteo[max] ? k : max), 'FO');
  }

  return {
    cruces: conteo,
    sinConsiderar,
    totalCruces,
    porcentajes,
    cuadranteDominante,
    orientacionEstrategica: cuadranteDominante ? ORIENTACION_POR_CUADRANTE[cuadranteDominante] : null,
    // MATRIZ FODA!C24:E27: posiciones FIJAS de la grilla 2x2 (no son datos);
    // el tamaño sí es dato (% del total).
    burbujas: [
      { cuadrante: 'FO', x: 4, y: 6, tamano: porcentajes.FO },
      { cuadrante: 'FA', x: 8, y: 6, tamano: porcentajes.FA },
      { cuadrante: 'DO', x: 4, y: 2, tamano: porcentajes.DO },
      { cuadrante: 'DA', x: 8, y: 2, tamano: porcentajes.DA },
    ],
  };
}

export {
  calcularItem,
  calcularArea,
  calcularViabilidad,
  interpolarPuntos,
  calcularMatrizFoda,
  clasificarFactor,
};
```

**Nota de integridad:** este mismo cálculo debe portarse 1:1 a `backend/engine_replica.py` y recalcularse server-side antes de persistir cada evaluación, para que el dato guardado en SQLite no dependa de que el JS del cliente no haya sido alterado.

**Estado de validación (Fase 2, 11/10/2026):** `calcularItem`, `calcularArea`, `semaforoDe` y `calcularViabilidad` (puntajes por ítem, por área, índices interno/externo y veredicto) están **validados contra tests golden** extraídos del DEMO con tolerancia ≤ 0,01 (ver `scripts/golden_extract.py`, `tests/calc.golden.test.mjs`, `.github/workflows/tests.yml`; 10/10 tests verdes). `calcularViabilidad` no cambió respecto del borrador original: ya reproducía correctamente `VIABILIDAD!C44`. `interpolarPuntos` sí cambió respecto del borrador original: incorpora el épsilon `-0.001` de `CalculosFoda!W` (ver nota en el código arriba) — sin él, un test golden fallaba porque el área IA daba 0 alertas en vez de las 2 reales del DEMO (ítems que caen justo en un límite de tramo, con Excel dando `.9999` y el motor sin épsilon dando el valor "limpio").

**Corrección (Fase 3, 13/10/2026) a un hallazgo de Fase 2 — `cuadranteDominante` SÍ es derivable automáticamente, no requiere carga cualitativa manual.** La entrega de Fase 2 afirmó, sin haberlo verificado con suficiente profundidad, que el cuadrante FODA dominante (`VIABILIDAD!B53`) dependía de texto cualitativo cargado a mano en `PART2 FODA`. El autor señaló (13/10/2026) que `PART2 FODA` es "todo automático" — al releer las fórmulas con más cuidado, tenía razón y la afirmación de Fase 2 era incorrecta. Se deja esta corrección explícita, no se borra en silencio.

Lo que realmente pasa, celda por celda:

1. La hoja `VariablesFoda` es una **tabla fija y estructural del instrumento** (como `Rango`): define, para cada uno de los 64 factores internos, de qué factores externos "depende" (con cuáles se cruza). No depende de ninguna evaluación concreta — es parte del diseño del cuestionario, no un dato a cargar. 9 de los 64 factores internos son "Independientes" (no tienen ningún factor externo asociado y no participan del cruce); los otros 55 tienen entre 1 y 3 dependencias cada uno (93 pares interno-externo en total).
2. `CalculoFoda-1` (hoja distinta de `CalculosFoda`, ver la corrección de signo más arriba en §4.1) clasifica automáticamente cada factor, a partir de su respuesta de situación, en Fortaleza/Debilidad (si es interno) u Oportunidad/Amenaza (si es externo): Favorable o Muy Favorable → positivo; Muy Desfavorable o Desfavorable → negativo; "No corresponde" o sin responder → ninguno de los dos (no participa del cruce).
3. `PART2 FODA` cruza, para cada par (interno, externo) de la tabla fija de `VariablesFoda`, las dos clasificaciones automáticas del paso 2, y lo cuenta en la columna que corresponde: Fortaleza+Oportunidad → FO, Fortaleza+Amenaza → FA, Debilidad+Oportunidad → DO, Debilidad+Amenaza → DA, cualquier otro caso → "Variables no consideradas" (no se suma a ningún cuadrante).
4. `MATRIZ FODA!C15:F15` suma esos cruces por cuadrante (fórmulas `SUMPRODUCT`, no texto tipeado a mano) y `VIABILIDAD!C53` toma el cuadrante con más cruces (`INDEX`/`MATCH` del máximo) como el "cuadrante con mayor peso". `MATRIZ FODA!C24:E27` define además las coordenadas fijas (no derivadas de los datos) y el tamaño (el % del total, eso sí es dato) de las 4 burbujas del gráfico FO/FA/DO/DA.

Implementado en `calcularMatrizFoda` (ver código más abajo), usando una tabla de dependencias extraída de `VariablesFoda` por `scripts/extraer_dependencias_foda.py` → `frontend/src/data/dependenciasFoda.json`. **Validado contra tests golden del DEMO**: cruces FO=14/FA=28/DO=12/DA=30, cuadrante dominante "Debilidades-Amenazas (DA)" → orientación "Supervivencia", coincide exactamente con `MATRIZ FODA`/`VIABILIDAD!C53` del Excel real.

`cuadranteDominante`/`orientacionEstrategica` en `assessment.schema.json` (§4.2) ya no son una incógnita de diseño: son un resultado más del motor, calculado automáticamente igual que el resto.

---

## 6. Riesgos y pendientes abiertos

1. **Autenticación mínima** en la API antes de exponerla públicamente vía Cloudflare Tunnel (al menos una API key por equipo/cátedra).
2. **Backups automáticos** del SQLite (cronjob diario a Google Drive o GCS).
3. **Consentimiento informado y anonimización** del dataset antes de publicarlo en OSF — verificar si aplica comité de ética de la universidad.
4. **Versionado del cuestionario**: cada `assessment` debe quedar asociado a la versión de `questionnaire.json` con la que se respondió (campo `versionMotor`).
5. **Disponibilidad de la VM**: sin SLA; el frontend debería bufferizar en `localStorage` y reintentar el `POST` si la API no responde, para no perder una entrevista de 45 minutos por una caída puntual.
6. **Dato de dominio de Vogel confirmado solo tácitamente** (§3.2) — si corrige el dato más adelante, actualizar esta sección, el preprint y el `CITATION.cff`.
7. ~~`cuadranteDominante`/`orientacionEstrategica` no son derivables automáticamente de las 110 respuestas~~ — **resuelto (13/10/2026): sí son automáticos.** Lo que decía este ítem en Fase 2 era un error de análisis, corregido en §5 (`calcularMatrizFoda`, validado contra tests golden del DEMO). No queda ninguna decisión de diseño pendiente acá.
8. **Optatividad para un futuro diseño longitudinal (pre-post) — NO bloquea ninguna fase actual.** A partir de la sugerencia de Vogel sobre modelos de cambio discontinuo (§3.2.1), queda abierta la posibilidad de, más adelante, re-evaluar a las mismas pymes en una segunda ventana temporal y analizar el cambio con el aparato estadístico que él mismo sugirió (Singer & Willett, 2003) — un estudio distinto y más ambicioso que el diagnóstico actual, de corte transversal. Para no cerrar esa puerta sin costo hoy, alcanza con dos ajustes baratos, sin impacto en el cronograma de las Fases 0-6:
   - **Campo opcional `empresaId`** en `assessment.schema.json` (§4.2) — ya incorporado al esquema.
   - **Campo opcional `autorizaRecontacto`** en `assessment.schema.json` (§4.2) — ya incorporado al esquema.
   - Agregar una cláusula optativa en el consentimiento informado de la Fase 5 ("¿autoriza a que la cátedra la recontacte en el futuro para una segunda evaluación con fines de investigación?").
   - El diseño del análisis estadístico en sí (qué intervención se usa como punto de corte, qué cohortes, qué software estadístico) se define en un chat/documento aparte cuando exista una segunda ventana de datos real — no antes.
