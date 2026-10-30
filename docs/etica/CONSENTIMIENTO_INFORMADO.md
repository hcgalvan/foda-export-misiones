# Consentimiento informado para participar en el diagnóstico de viabilidad exportadora

**Proyecto FODA Export Misiones — práctica profesionalizante de Investigación de Mercados**

> **BORRADOR PARA REVISIÓN.** Redactado como modelo a partir de cómo funciona hoy la aplicación. Antes de usarlo con empresas reales conviene que lo revise el autor y, si lo desea, un asesor legal. Debe entregarse junto con la nota de colaboración de la Rectora. Los campos entre corchetes [así] hay que completarlos o decidirlos.

## 1. Quiénes realizan el estudio

El relevamiento se realiza como **práctica profesionalizante** de la cátedra *Investigación de Mercados* (2.º año de la carrera Técnico Superior en Comercio Internacional y Despacho Aduanero) del **Instituto Alfa** (Posadas, Misiones), con la nota de colaboración de la Rectora que su empresa recibió. Lo realizan estudiantes regulares de la institución, bajo la supervisión del **Prof. Hugo César Galván**.

La herramienta de diagnóstico (la aplicación web, el cuestionario y el informe) fue desarrollada por el Prof. Galván, quien es el **responsable del tratamiento de la información cargada en ella**. El Instituto Alfa respalda la práctica de los estudiantes; no interviene en la administración de la aplicación ni de sus datos. Contacto del docente: [correo y teléfono]. Contacto institucional: según la nota de colaboración.

## 2. De qué se trata

Se le propone realizar un **diagnóstico de viabilidad exportadora** de su empresa: una entrevista guiada con 110 preguntas sobre la situación interna de la empresa y su entorno. Con las respuestas, la aplicación calcula puntajes, un veredicto de viabilidad y un informe con prioridades, que **se le entrega sin costo**. La entrevista dura aproximadamente [duración estimada].

La participación es **voluntaria**, no tiene fines comerciales y no genera ninguna obligación para su empresa. Puede negarse a responder cualquier pregunta y retirarse en cualquier momento sin consecuencia alguna.

## 3. Qué información se registra

- **Identificación de la empresa:** razón social, rubro, mercados de destino de interés, si exporta o no, y fecha del relevamiento.
- **Sus respuestas:** para cada pregunta, la situación de la empresa y la importancia que le asigna, más las observaciones que usted quiera agregar.
- **Quién relevó:** el nombre del equipo de estudiantes. (Los datos personales de los estudiantes que figuran en la nota de colaboración no se cargan en la aplicación.)

**No se solicita** CUIT, estados contables, datos bancarios ni datos personales de empleados o clientes. Le pedimos que no incluya esos datos en las observaciones. [Si se registra el nombre o contacto de una persona de la empresa, indicarlo acá.]

## 4. Para qué se usará

1. Elaborar el informe de diagnóstico que se le entrega.
2. Aprendizaje: los estudiantes practican el análisis con casos reales, bajo supervisión docente.
3. **Solo si usted lo autoriza expresamente (opción 2 al final):** investigación académica y publicación de resultados **anonimizados**.

## 5. Cómo se guarda y quién accede

- La aplicación está alojada en Netlify. Mientras se completa, el borrador queda en el navegador del equipo.
- Al guardar, la información se envía a un servidor administrado por el docente (máquina virtual en Google Cloud, región [completar]) mediante una conexión cifrada (HTTPS) que pasa por un túnel de Cloudflare.
- Se hacen **copias de seguridad diarias** en Google Cloud Storage, en la región **us-central1 (Estados Unidos)**. Esto implica que la información se almacena fuera de la Argentina.
- Acceden el docente responsable y el equipo que realizó su relevamiento, mediante una clave de equipo. Cada equipo ve únicamente sus propias evaluaciones.
- **Plazo de conservación:** [definir: por ejemplo, hasta [X] años o hasta que usted retire su consentimiento].

## 6. Confidencialidad

Los estudiantes participantes firman un compromiso de confidencialidad y se comprometen a no divulgar la información de su empresa. El informe se entrega solo a su empresa. No se compartirá información identificable con terceros ni con otras empresas.

## 7. Publicación de resultados

Si usted marca la opción 2, los datos podrían incluirse en un conjunto de datos y en publicaciones académicas **sin razón social**, con el rubro generalizado, sin las observaciones escritas y con la fecha reducida al mes. Aun así, en una región con pocas empresas por rubro **existe un riesgo de que una empresa sea reconocible**; por eso la inclusión es opcional, se evaluará caso por caso y, si su empresa fuera fácilmente identificable, solo se publicarán resultados agregados.

## 8. Sus derechos

Usted puede, en cualquier momento y sin costo: acceder a la información registrada, pedir su corrección, pedir su eliminación y retirar su consentimiento, escribiendo al contacto indicado. Si retira el consentimiento, sus datos se eliminarán del servidor y de las copias de seguridad en un plazo de [definir]. Los resultados que ya estuvieran incluidos en análisis agregados anonimizados publicados no podrán separarse.

[Texto de la autoridad de control, a verificar con el texto vigente:] El titular de los datos personales tiene la facultad de ejercer el derecho de acceso a los mismos en forma gratuita a intervalos no inferiores a seis meses, salvo que se acredite un interés legítimo al efecto conforme lo establecido en el artículo 14, inciso 3 de la Ley Nº 25.326. La Agencia de Acceso a la Información Pública, en su carácter de Órgano de Control de la Ley Nº 25.326, tiene la atribución de atender las denuncias y reclamos que se interpongan con relación al incumplimiento de las normas sobre protección de datos personales.

## 9. Riesgos y beneficios

No hay riesgos físicos. El principal riesgo es la divulgación de información comercial de su empresa, que se reduce con las medidas descritas. El beneficio es recibir un diagnóstico gratuito. El resultado es **orientativo**: depende de la información relevada, no reemplaza un estudio de mercado ni asesoramiento profesional, y no garantiza resultados exportadores.

## 10. Consentimiento

Marque lo que corresponda. Solo la opción 1 es necesaria para participar.

- [ ] **1. Participación.** He leído y comprendido este documento, pude hacer preguntas, y acepto participar y que mis respuestas se usen para elaborar el diagnóstico de mi empresa y con fines de enseñanza.
- [ ] **2. Publicación anonimizada (opcional).** Acepto que los datos de mi empresa, anonimizados como se describe en el punto 7, se incluyan en análisis académicos y en un conjunto de datos abierto.
- [ ] **3. Nuevo contacto (opcional).** Acepto que el equipo me contacte nuevamente para validar o actualizar el diagnóstico.

Empresa (razón social): ____________________________________________

Nombre y apellido del representante: ____________________________________________

Cargo: ______________________  DNI: ______________________

Firma: ______________________  Lugar y fecha: ______________________

Equipo que realiza el relevamiento: ______________________  Firma del docente responsable: ______________________

*Este formulario firmado se guarda por separado de los datos de la aplicación, en un lugar de acceso restringido, y no se incluye en el repositorio público.*
