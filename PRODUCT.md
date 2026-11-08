# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Alumnos del Bachillerato Internacional (IB) en general, de cualquier colegio, que preparan sus exámenes. Estudian tanto en el móvil como en el portátil, sin que predomine ninguno. La interfaz está en español.

## Product Purpose

Un banco de preguntas colaborativo: quien lo usa lo mantiene. Sirve para crear preguntas, estudiar con repetición espaciada, hacer exámenes, seguir el progreso por asignatura, unidad y tema, y competir con otras personas, también sin conexión.

## Positioning

El banco lo escribe y lo mantiene la gente que estudia con él, y funciona sin servidores propios ni base de datos: GitHub Pages sirve la app y GitHub Actions valida lo que se propone. Los rankings no se guardan, se recalculan desde un registro público de eventos.

## Operating Context

- Sesiones cortas en el móvil y sesiones largas en el portátil, a veces resolviendo en papel antes de mirar la solución.
- Lo central es leer enunciados con fórmulas (KaTeX), figuras y apartados con puntos, y responder.
- Debe funcionar sin conexión y sin cuenta. Lo que se hace sin publicar se queda en el dispositivo.

## Capabilities and Constraints

- Modos de estudio: práctica, examen con reloj, repaso (FSRS), sesiones personalizadas y simulacros con el formato de las pruebas del IB; temario elegible (sólo lo marcado o todo menos lo marcado); objetivo diario separado por tipo de pregunta.
- Calendario: fechas de mocks y exámenes finales con lo que entra en cada uno, y un plan diario calculado con el progreso.
- Formulario propio de Física. El cuadernillo oficial tiene derechos del IB: no se publica, y cada cual puede abrir su PDF desde la app.
- Sincronización opcional entre los dispositivos de una persona, cifrada, en un gist secreto de su cuenta.
- Tipos de pregunta: tipo test (una o varias correctas, con imágenes y comentarios por opción) y desarrollo (apartados, subapartados, puntos, criterios y autoevaluación).
- Editor con asistente de fórmulas e imágenes; importación y exportación en bloque por JSON.
- Comunidad: publicar por issue o PR, perfil público, rankings, logros, amigos, duelos, grupos, torneos y retos diarios y semanales.
- Personalización que forma parte de la función: tema claro, oscuro o del sistema, color de acento, cuatro tamaños de texto, tres tipos de letra y el modo «Sólo estudiar».
- PWA instalable. Sólo GitHub Pages y el ecosistema de GitHub: sin servidores ni bases de datos externas. React, TypeScript, Vite y Tailwind.
- Terminología: asignatura, unidad, tema, tipo test, desarrollo, apartado, subapartado, temario, repaso, racha, dominadas.
- Sin decidir: la licencia del código. El contenido comunitario se publica con CC BY-SA 4.0.

## Brand Commitments

- Nombre: QuestionBank, configurable por despliegue con `QB_APP_NAME`.
- La persona propietaria ha decidido que nada del aspecto actual tiene que sobrevivir al rediseño, logo y color de marca incluidos.
- Sería un fallo que pareciera un panel de oficina, o que las fórmulas y el texto se leyeran peor que antes.
- Proyecto independiente: no está afiliado a la Organización del Bachillerato Internacional ni cuenta con su respaldo. No debe imitar sus documentos ni su identidad.
- Voz: español directo y claro, sin promesas que la arquitectura no pueda cumplir.

## Evidence on Hand

- 300 preguntas originales de Física SL (200 de tipo test y 100 de desarrollo) con 25 figuras, en `../banco-fisica-sl-300.json` (fuera del repositorio).
- Capturas del README en `docs/readme/`, hechas con progreso de prueba.
- No hay testimonios, cifras de uso ni datos de resultados académicos: no se deben inventar.

## Product Principles

1. Delante de una pregunta, lo primero es leerla bien.
2. Sin cuenta se puede hacer casi todo; publicar es siempre una decisión explícita.
3. Decir la verdad sobre lo que no se puede garantizar: los rankings son un juego de estudio, no una credencial.
4. El contenido es de quien estudia: sólo preguntas propias o con licencia abierta.

## Accessibility & Inclusion

Se mantienen contraste de al menos 4,5:1 en cada acento y tema, objetivos táctiles de 44 px, atajos de teclado para responder, foco visible, tamaños de texto ajustables y respeto por `prefers-reduced-motion`.
