---
name: QuestionBank
description: Banco de preguntas colaborativo para alumnos del IB, en estilo tipográfico internacional.
colors:
  ink: "#0a0a0a"
  paper: "#ffffff"
  cobalt: "#0b2bff"
  cobalt-deep: "#0820cc"
  cobalt-tint: "#e4e8ff"
  signal: "#ffe500"
  success: "#00803c"
  success-tint: "#d9f7e6"
  warning: "#8a5a00"
  warning-tint: "#fff3c4"
  danger: "#d4161c"
  danger-tint: "#ffe3e1"
  text-muted: "#3f3f46"
  text-faint: "#55555f"
  rail-muted: "#c4c4cc"
typography:
  poster:
    fontFamily: "Archivo Variable, Inter Variable, sans-serif"
    fontSize: "16.5rem"
    fontWeight: 900
    lineHeight: 0.8
    letterSpacing: "-0.04em"
  display:
    fontFamily: "Archivo Variable, Inter Variable, sans-serif"
    fontSize: "4.75rem"
    fontWeight: 900
    lineHeight: 1
    letterSpacing: "-0.04em"
  headline:
    fontFamily: "Archivo Variable, Inter Variable, sans-serif"
    fontSize: "1.625rem"
    fontWeight: 800
    lineHeight: 1.1
    letterSpacing: "-0.025em"
  figure:
    fontFamily: "Archivo Variable, Inter Variable, sans-serif"
    fontSize: "3rem"
    fontWeight: 900
    lineHeight: 1
    letterSpacing: "-0.03em"
  body:
    fontFamily: "Inter Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Inter Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 700
    lineHeight: 1.4
rounded:
  none: "0px"
spacing:
  gutter-phone: "1rem"
  gutter-tablet: "1.5rem"
  gutter-desktop: "2.5rem"
  rail: "14.5rem"
components:
  button-primary:
    backgroundColor: "{colors.cobalt}"
    textColor: "{colors.paper}"
    rounded: "{rounded.none}"
    height: "2.75rem"
    padding: "0 1.25rem"
  button-primary-hover:
    backgroundColor: "{colors.cobalt-deep}"
    textColor: "{colors.paper}"
  button-secondary:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    height: "2.75rem"
    padding: "0 1.25rem"
  button-signal:
    backgroundColor: "{colors.signal}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    height: "2.75rem"
    padding: "0 1.25rem"
  input:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    height: "2.75rem"
    padding: "0 0.75rem"
  nav-item-active:
    backgroundColor: "{colors.cobalt}"
    textColor: "{colors.paper}"
    rounded: "{rounded.none}"
    height: "2.25rem"
    padding: "0 1.5rem"
---

# Design System: QuestionBank

## Overview

**Creative North Star: "El cartel que avanza"**

Estilo tipográfico internacional aplicado a una herramienta de estudio: retícula estricta, grotesca enorme y campos de color planos. La pieza central es la banda de progreso: la cabecera de cada pantalla con algo que medir se rellena de color, y la cifra gigante cambia de color justo al cruzar el borde del relleno.

La energía está en el marco y en las cifras. Delante de una pregunta todo se retira: una banda baja arriba, texto en Inter sobre papel y una columna de lectura de 42 rem. La navegación, los formularios y las tablas son los de siempre; el mundo sólo aporta tipo, color, densidad y la banda.

Sería un fallo que pareciera un panel de oficina o que las fórmulas se leyeran peor que antes.

**Key Characteristics:**
- Barra lateral negra a sangre y activo en acento hasta el borde.
- Cabeceras a sangre: banda de progreso, o campo de tinta cuando no hay nada que medir.
- Cifras en Archivo Black; lectura en Inter.
- Esquinas rectas, reglas negras, ninguna sombra.
- Amarillo señal sólo para lo que te necesita ahora.

## Colors

Tinta y papel, un acento a plena potencia y un amarillo reservado. El acento lo elige cada persona entre seis, comprobados a 4,5:1 en los dos temas.

### Primary
- **Cobalto** (#0b2bff): relleno de la banda, acción principal, navegación activa y lo visto en las barras de avance. Es el acento por defecto.

### Secondary
- **Amarillo señal** (#ffe500): la acción de hacer ahora y la columna «A reforzar». Siempre con tinta encima.

### Neutral
- **Tinta** (#0a0a0a): texto, barra lateral, reglas y lo dominado en las barras de avance.
- **Papel** (#ffffff): fondo y superficies.
- **Tinte de cobalto** (#e4e8ff): fondo de la banda, barras vacías, estados hover y rellenos suaves.

### Named Rules
**The No Grey Fill Rule.** Ninguna superficie es gris: es tinta, papel o un tinte del acento. Los grises sólo existen como color de texto secundario.

**The Signal Rule.** El amarillo sólo marca lo que te necesita ahora. Si todo es urgente, nada lo es.

**The Strong Color Rule.** El color fuerte recorre lo que estás haciendo en este momento: dónde estás, cuánto llevas y qué pulsar.

## Typography

**Display Font:** Archivo Variable (con Inter de reserva)
**Body Font:** Inter Variable (con la fuente del sistema; se puede cambiar en Configuración)

**Character:** Una grotesca muy negra para cifras y títulos, frente a una neutra pensada para pantalla que se ocupa de leer bien enunciados y fórmulas.

### Hierarchy
- **Poster** (900, hasta 16.5rem, 0.8): sólo la cifra de la banda.
- **Display** (900, hasta 4.75rem, 1): títulos de pantalla.
- **Headline** (800, 1.625rem, 1.1): títulos de sección.
- **Figure** (900, hasta 3rem, 1): cifras de resumen y porcentajes.
- **Body** (400, 0.9375rem, 1.5): interfaz y enunciados, con medida máxima de 42 rem en las preguntas.
- **Label** (700, 0.8125rem): etiquetas de campo y pies de cifra.

### Named Rules
**The Two Extremes Rule.** O texto de lectura o cartel. Casi nada en medio.

## Layout

Barra lateral fija de 14.5 rem y contenido alineado a la izquierda con un máximo de 72 rem. Márgenes de 1, 1.5 y 2.5 rem según el ancho. Bandas, cabeceras y la columna amarilla van a sangre con márgenes negativos del mismo valor. Por debajo de 64 rem la barra lateral pasa a una barra inferior negra de cinco posiciones y la cifra de la banda baja bajo el texto.

## Elevation & Depth

Sistema plano, sin sombras. La profundidad la dan los campos de color, las reglas y el telón al 60 % de negro detrás de los diálogos.

## Shapes

Todo es rectangular: 0 de radio en botones, campos, fichas e imágenes. Sólo son redondos los indicadores de carga.

**The Square Rule.** Si tiene esquinas, son rectas.

## Components

### Buttons
- **Shape:** rectos, 2.75 rem de alto, negrita.
- **Primary:** cobalto con texto blanco; al pasar, cobalto más oscuro.
- **Secondary:** papel con borde de tinta de 2 px; al pasar, se invierte.
- **Signal y Plate:** placas amarilla y blanca con borde de tinta, para campos de color: se leen igual sobre el relleno y sobre el fondo de la banda.

### Cards / Containers
- **Corner Style:** recto.
- **Border:** sólo una regla superior de tinta de 2 px.
- **Internal Padding:** 1 rem.

### Inputs / Fields
- **Style:** borde de tinta de 2 px sobre papel.
- **Focus:** el borde pasa al acento.
- **Error:** borde de peligro y mensaje debajo.

### Navigation
Cinco secciones como mucho, en negrita sobre negro y sin iconos en escritorio. El activo es un bloque de acento de borde a borde. En móvil, las mismas cinco abajo, con icono y texto. Las páginas de cada sección son una fila de pestañas sobre el contenido, también con el activo en acento.

### Banda de progreso
Fondo de tinte del acento y relleno recortado con `clip-path`. El contenido se pinta dos veces para invertir el color al cruzar el borde; las acciones van una sola vez por encima. Entra barriendo en 900 ms y se mueve en 700 ms al cambiar el valor, con ease-out exponencial; sin movimiento con `prefers-reduced-motion`. Versión baja en las sesiones de estudio.

### Ficha de asignatura
Cuadrado con dos letras cuyo color sale del id: no cambia aunque cambie el orden.

## Do's and Don'ts

### Do:
- **Do** usar la banda de progreso en toda cabecera que tenga algo que medir.
- **Do** usar el campo de tinta en las cabeceras sin nada que medir.
- **Do** dejar la pregunta en Inter, sobre papel y a 42 rem como máximo.
- **Do** escribir siempre el dato exacto junto a cualquier barra.

### Don't:
- **Don't** usar sombras, degradados o esquinas redondeadas.
- **Don't** rellenar superficies con gris.
- **Don't** usar el amarillo como decoración.
- **Don't** poner etiquetas pequeñas en mayúsculas encima de los títulos.
- **Don't** imitar documentos ni la identidad de la Organización del Bachillerato Internacional.
