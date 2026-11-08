---
version: 1
slug: "src-app-layout-tsx"
primary_target: "src/app/Layout.tsx"
related_targets: ["src/styles/app.css","src/ui/Surface.tsx","src/features/dashboard/DashboardPage.tsx"]
---

Alcance: toda la aplicación (shell, kit de interfaz y todas las pantallas). Modo: Operate.
Público y tarea: alumnos del IB que estudian en móvil y portátil; ver cómo van hoy, practicar, leer preguntas con fórmulas y seguir su avance por temario.
Restricciones: claro y oscuro, seis acentos, cuatro tamaños de texto, tres tipos de letra, móvil y sin conexión. Sería un fallo parecer un panel de oficina o leerse peor que antes.
Momento memorable: la banda de progreso que avanza y cambia de color el número gigante al cruzarlo.

## Direction contract

THESIS: La cabecera de cada pantalla con algo que medir es la barra de progreso. Rechaza la fila de tarjetas de métricas sobre fondo gris del panel de la categoría.

OWN-WORLD: Tinta negra y papel blanco; campo cobalto a sangre; amarillo señal sólo para lo que te necesita ahora. Sin grises de relleno: cada superficie es tinta plena, tinte del acento o papel. Archivo 800-900 para cifras y títulos, Inter para leer. Retícula estricta, reglas negras de 2 px, esquinas rectas, sin sombras. Controles web estándar.

STORY: Al abrir sabes cuánto llevas hoy, pulsas Practicar, respondes sin nada que distraiga, y la banda avanza. Lo flojo está en amarillo y se practica de un toque.

FIRST VIEWPORT: Barra lateral negra de 232 px con «QB», «Nueva pregunta» en placa blanca y el activo en acento hasta el borde. Arriba a sangre, banda de 330 px: relleno hasta el porcentaje del día; a la izquierda «Hoy», fecha, «76 de 90 preguntas» y las acciones; cifra de hasta 16,5 rem partida por el borde del relleno. Debajo, cuatro cifras grandes, filas por unidad con barras negras y, a la derecha, columna amarilla «A reforzar».

FORM: Estilo Internacional, posición 3 de la lista ordenada. seed:ebe0a719efbda134

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

Interacción característica: al cargar y al responder, el relleno barre con clip-path en una sola transición y la cifra cambia de color al cruzarla. Sin movimiento con prefers-reduced-motion.
Elevaciones aceptadas: sin grises de relleno; ficha fija por asignatura (color, código y orden estables); color fuerte sólo en lo que haces ahora; escala de dos extremos, lectura o cartel.
