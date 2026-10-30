# Checklist de release v1.0.0 — FODA Export Misiones

Estado al 30/10/2026. **No se crea ningún tag ni Release hasta que los puntos de la sección A estén tildados.**
Zenodo se conecta, pero no se taggea nada antes (decisión 4 del proyecto).

## 0. Dónde va cada objeto (verificado el 30/10/2026)

| Objeto | Plataforma | Identificador | Por qué |
|---|---|---|---|
| Software (código + app) | GitHub → **Zenodo** | DOI de Zenodo por versión (+ DOI de concepto) | Zenodo archiva automáticamente cada Release de GitHub y lee `CITATION.cff` |
| Modelo matemático (preprint) | **OSF Preprints** | DOI de OSF | Es un documento, no código |
| Instrumento (110 ítems + guía) | **OSF** (componente) | DOI de componente OSF | Es contenido metodológico (CC BY-NC-SA) |
| Dataset anonimizado | **OSF** (componente) | DOI de componente OSF | Requiere consentimiento y revisión ética, y OSF permite control de acceso por componente |
| Hub del proyecto | **OSF** | — | Enlaza GitHub, el DOI de Zenodo y los demás componentes |

**Qué se verificó:** (1) Zenodo lee `CITATION.cff` al archivar un Release; si el repositorio tiene un `.zenodo.json`, Zenodo usa solo ese y **ignora** `CITATION.cff` (help.zenodo.org). No hay que crear `.zenodo.json`. (2) OSF documenta otra vía para código: vincular GitHub al proyecto y crear un *Registration* ("Open-Ended"), que recibe DOI y se puede etiquetar como software (help.osf.io, "Archive Code"). Es una alternativa válida, pero **no se usa para el software** para no tener dos DOI distintos para el mismo objeto (dividiría las citas). OSF queda como hub y casa de los demás objetos.
**Qué NO se pudo verificar:** el detalle de DOI de componentes OSF y de OSF Preprints (la página de ayuda no cargó), y el funcionamiento del "DOI de concepto" y de reservar el DOI antes del Release (la FAQ de Zenodo solo mostró los títulos). Confirmarlo en la interfaz antes del release.

## A. Gates bloqueantes (sin esto no hay Release)

- [ ] **Tests de paridad verdes en CI** (GitHub Actions): `pytest` en `backend/` y `node --test tests/*.mjs`. Confirmar que el workflow incluye los tests nuevos (`analisis`, `report`, `backup_restore`).
- [ ] **Vogel — atribución resuelta por escrito.** Hoy: autorización de uso académico recibida el 1/10/2026. La **certificación** ofrecida el 26/9 sigue pendiente. Una de dos: (a) llega la respuesta escrita, se guarda en `docs/atribucion/` (con su permiso) y se actualizan `ARCHITECTURE.md §3.2`, `CITATION.cff` y el preprint; (b) decisión explícita del autor de publicar con la cita provisoria. **Ningún texto puede decir que Vogel certificó o avaló.**
- [x] **Propiedad intelectual / institución — decisión del autor (30/10/2026).** El autor declara que el desarrollo se realizó fuera de su horario, sin financiamiento ni recursos de la institución, y que el modo de enseñar es decisión docente propia. Las visitas a empresas se realizan como práctica profesionalizante con **nota de colaboración de la Rectora** (marco académico y seguimiento, ya vigente): eso respalda la *práctica*, pero la nota no trata la titularidad del software ni su publicación. Por decisión del autor **no se solicita una autorización institucional adicional** para publicar bajo MIT / CC BY-NC-SA. Redacción a respetar: la herramienta y el instrumento son obra del autor; el Instituto respalda la práctica de los estudiantes. Pendiente sin trámite institucional: releer el propio contrato y el reglamento docente (cláusulas de propiedad intelectual o producción docente). No es una opinión legal.
- [ ] **`CITATION.cff` con versión y fecha reales** (ver `CITATION.cff.v1.0.0-borrador`).

## B. Contenido que debe validar el autor (marcado como borrador en el código)

- [ ] `frontend/src/data/relacionesCausales.json`: revisar los textos y poner `"validado": true`.
- [ ] `TEXTO_VEREDICTO` y títulos de sección en `frontend/src/report.js`.
- [ ] Definición de los escenarios A/B/C y R1/R2 en `frontend/src/analisis.js`.
- [ ] Decisión sobre la rareza de "No corresponde" en el motor (`ARCHITECTURE.md §9`, punto 3): mantener la réplica fiel del Excel o cambiar el modelo. Si se mantiene, debe quedar documentada en el preprint.
- [ ] Referencias de `CITATION.cff`: año e ISBN de la obra de Vogel; autores reales del artículo de Reciena (hoy comentado).

## C. Limpieza del repositorio público

Ejecutar en la copia local del repo:

```bash
git log --all --name-only --pretty=format: | grep -E '\.db$|\.env|\.pem|\.key|credentials' | sort -u    # debe salir vacío
git grep -n -I -E 'X-API-Key|FODA_API_KEYS=|trycloudflare|api[_-]?key *[:=]' -- . ':!*.md' ':!tests'    # revisar que no haya claves reales
```

- [ ] `.gitignore` incluye `*.db`, `.env`, `venv/`, `node_modules/`, `__pycache__/`, `.pytest_cache/`, credenciales de túnel.
- [ ] Ninguna API key, URL de túnel ni nombre de bucket con datos reales en archivos versionados (el nombre `backup-bot-academico` figura en `README_DEPLOY.md`: decidir si se deja o se reemplaza por un ejemplo).
- [ ] `tests/fixtures/ejemplo_prueba_1.json` es una empresa **ficticia** ("Prueba 1"): confirmar que ningún fixture contiene datos de una pyme real.
- [ ] Si algún secreto o `.db` apareció alguna vez en el historial: rotar la clave y limpiar el historial **antes** de publicar (Zenodo archiva el repositorio completo del Release).

## D. Congelar versiones

Hoy `versionMotor` es `1.0.0-fase4` y `versionCuestionario` es `1.1.0`.

- [ ] Cambiar `VERSION_MOTOR` a `1.0.0` en `frontend/src/app.js`, el valor por defecto en `backend/config.py` y el fixture de `backend/tests/test_schema.py`. (Alternativa para el servidor: variable `FODA_VERSION_MOTOR` en `/etc/foda-api.env`.)
- [ ] Decidir qué pasa con las evaluaciones ya guardadas con `1.0.0-fase4`: se conservan con su versión (recomendado: es la verdad del momento) o se descartan. Las de prueba se borran antes del piloto.
- [ ] `questionnaire.json` queda en la versión que se use en el piloto, sin cambios después (si cambia un solo texto, sube la versión).
- [ ] Verificar `/health` tras reiniciar `foda-api`.

## E. Documentación y licencias

- [ ] `README.md` con licenciamiento dual (MIT para código; CC BY-NC-SA 4.0 para contenido), atribución "adaptado de la metodología FODA Matemático (Vogel)", y aclaración de que el resultado es orientativo.
- [ ] `LICENSE` y `LICENSE-CONTENT` presentes.
- [ ] No hay diapositivas ni materiales de los cursos de Vogel en el repositorio.
- [ ] `docs/etica/CONSENTIMIENTO_INFORMADO.md` incluido (es una plantilla, sin datos de nadie). Los consentimientos **firmados** NO van al repositorio.
- [ ] `docs/referencia/` con los Excel de referencia (DEMO y completo), sin datos de empresas reales.

## F. Zenodo (antes de crear el Release)

- [ ] Cuenta de Zenodo iniciada con GitHub, repositorio habilitado en Settings → GitHub. **Hay que habilitarlo antes del Release**: Zenodo archiva los Releases que se crean después.
- [ ] No existe `.zenodo.json` en el repositorio (si existiera, mandaría sobre `CITATION.cff`).
- [ ] `CITATION.cff` definitivo en la raíz y valida (`pip install cffconvert && cffconvert --validate`).
- [ ] Probar con un repositorio descartable si hay dudas del flujo (un Release en Zenodo no se borra).

## G. Hacer el release

1. Reemplazar `CITATION.cff` por la versión definitiva (con `date-released` real). Commit.
2. Confirmar que el CI está verde en ese commit.
3. Crear el tag `v1.0.0` y el Release en GitHub, con notas (qué incluye, qué no, aviso de "orientativo", atribución).
4. Esperar a que Zenodo cree el registro. Revisar título, autores, licencia y descripción en Zenodo (se pueden editar los metadatos en Zenodo, el archivo no).
5. Copiar el **DOI de concepto** y el DOI de la versión.

## H. Después del release

- [ ] Commit con `identifiers` (DOI) en `CITATION.cff` y badge de Zenodo en `README.md`.
- [ ] Actualizar la cita de §3.6 de `ARCHITECTURE.md` con el DOI real.
- [ ] Crear el proyecto OSF con sus componentes (Software enlazado a GitHub, Modelo matemático, Metodología, Guía de entrevista, Dataset) y subir el preprint.
- [ ] **Dataset:** solo con consentimiento específico firmado (opción 2 del formulario), anonimización revisada y la evaluación del propio autor sobre si corresponde algún aval ético. No bloquea el release del software.
