# Classroom Notas

Extensión de Chrome para docentes. Conserva las notas personales por curso y permite preparar guías de estudio a partir de los exámenes y del material de Google Classroom.

## Instalación y conexión con Google

1. Con Node.js 22.13 o posterior, ejecuta `npm ci` y `npm run build` en la raíz del proyecto. El segundo comando prepara en `vendor/` el lector de PDF, el motor de OCR y el modelo de español.
2. En `chrome://extensions`, activa **Modo de desarrollador** y carga esta carpeta descomprimida. Si ya usabas las notas, actualiza la extensión desde la misma carpeta y perfil de Chrome para conservarlas. Copia el ID que muestra Chrome.
3. En Google Cloud, habilita **Google Classroom API** y **Google Drive API**. Configura la audiencia y el consentimiento OAuth con los permisos que figuran en `manifest.json`. Si la aplicación está en pruebas, agrega la cuenta docente como usuario de prueba cuando corresponda.
4. Crea un cliente OAuth de tipo **Extensión de Chrome** y registra el ID de extensión del paso 2. Sustituye `CONFIGURAR.apps.googleusercontent.com` en `manifest.json` por el **ID de cliente OAuth** que devuelve Google. Recarga la extensión y la página de Classroom. El cliente de Chrome utiliza un identificador público.
5. Abre **Mis notas → Analizar exámenes** en Classroom o pulsa el icono de la extensión. Selecciona **Conectar con Google** con el perfil de Chrome del docente y elige un curso.

La cuenta necesita impartir el curso y tener acceso al material. Un dominio escolar puede requerir que su administrador habilite la aplicación. Para distribuir la extensión, registra un cliente OAuth asociado al ID de la versión distribuida. [Identidad y OAuth en extensiones de Chrome](https://developer.chrome.com/docs/extensions/how-to/integrate/oauth)

## Preparar una evaluación

1. **Consulta el material importado.** El catálogo incluye publicaciones de tipo Material, sus descripciones, temas y adjuntos. Lee PDF, texto y exportaciones PDF de Documentos, Presentaciones, Hojas de cálculo y Dibujos de Google. Los videos, formularios, enlaces externos y otros formatos quedan como referencias. Los fallos de acceso se muestran por recurso. Los borradores aparecen en el catálogo. Las guías seleccionan material publicado para todos sus destinatarios. [Materiales de Classroom](https://developers.google.com/workspace/classroom/reference/rest/v1/courses.courseWorkMaterials/list) · [Descarga y exportación en Drive](https://developers.google.com/workspace/drive/api/guides/manage-downloads)
2. **Escribe la pauta o importa el solucionario en PDF.** Cada línea contiene número, tema, respuestas aceptadas y dificultad que se debe reforzar. Las dos columnas finales admiten errores frecuentes y un ejercicio de práctica. Usa punto y coma entre alternativas. Al importar un solucionario numerado, revisa el texto extraído y completa los criterios.

```text
1 | Fracciones | 5/6 | Sumar con denominadores distintos | 2/5 | Calcula 1/4 + 2/3 y verifica el resultado.
2 | Fracciones | 1/2 | Simplificar fracciones | 2/4;4/8 | Simplifica 12/18 y explica cómo elegiste el divisor.
```

3. **Carga los PDF.** Usa un examen por estudiante. Verifica la asociación propuesta por nombre y selecciona manualmente las restantes. El panel identifica archivos repetidos y estudiantes sin examen. Para la detección automática, usa preguntas numeradas, por ejemplo `1. 2/5` o `Pregunta 1: …` seguida de `Respuesta: 2/5`.
4. **Revisa los diagnósticos.** El motor compara respuestas con la pauta, reconoce errores frecuentes y detecta diferencias numéricas. Las respuestas abiertas sin coincidencia, las ausentes y las leídas mediante OCR quedan pendientes. Puedes abrir la página del PDF y corregir el diagnóstico, el tema y la dificultad.
5. **Forma los grupos.** La propuesta cuenta errores confirmados por tema y dificultad. En un empate usa el orden de la pauta. Los demás temas aparecen junto al estudiante. Edita el grupo principal, crea uno escribiendo su nombre o deja el campo vacío para excluir al estudiante de esta entrega.
6. **Edita y publica.** Cada guía incluye un objetivo, lecturas relacionadas cuando están disponibles, ejercicios y una autoevaluación. Comprueba los destinatarios y los enlaces antes de pulsar **Publicar para este grupo**. Los permisos de archivos y sitios externos siguen dependiendo de su propietario. Si se corta la conexión, **Reanudar publicación** recupera el borrador o la tarea mediante su referencia y su ID. [Tareas de Classroom](https://developers.google.com/workspace/classroom/reference/rest/v1/courses.courseWork)

## Datos guardados

El análisis y el OCR se ejecutan en el navegador. Los PDF de estudiantes, textos extraídos, diagnósticos y borradores se guardan en IndexedDB del perfil, por cuenta docente y curso. Al volver a abrir el panel, selecciona el curso para recuperar el trabajo. **Nueva evaluación** reemplaza los datos locales de esa evaluación después de confirmar. Las notas personales siguen en `chrome.storage.local`.

Google recibe las solicitudes de autenticación, consulta de materiales y publicación de las guías. Al publicar se envían el título, el texto revisado y los identificadores de destinatarios. Los PDF de los exámenes se mantienen en el navegador.

## Pruebas

- `npm test` comprueba el diagnóstico, el agrupamiento, las referencias, la importación paginada y la recuperación de una publicación.
- Para probar el flujo completo con datos ficticios, ejecuta `npm run build`, `npx playwright-core install chromium` y `node tests/browser.mjs`. También puedes indicar un Chromium de pruebas instalado con la variable `CLASSROOM_TEST_CHROME`. La prueba carga la extensión y procesa dos PDF, uno de ellos escaneado. Las respuestas de Google están simuladas.
- Para validar la entrega real, usa un curso de prueba y dos cuentas de estudiante en grupos distintos. Desde cada cuenta, comprueba que aparece la guía asignada y que se abren sus lecturas.
