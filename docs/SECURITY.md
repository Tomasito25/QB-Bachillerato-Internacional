# Seguridad

Modelo de amenazas de una aplicación sin backend propio. La idea central: **el cliente no es de
confianza**. Todo lo que entra en la rama `data` pasa por código que el usuario no controla.

## Fronteras de confianza

| Zona | ¿De confianza? | Qué garantiza |
|---|---|---|
| Navegador del usuario | **No** | Nada: se puede manipular por completo |
| GitHub (autenticación, marcas de tiempo) | Sí | Quién creó un issue o PR, y cuándo |
| Código de `main` en Actions | Sí | La validación. Un issue o un PR no pueden cambiarlo |
| Contenido de issues y PR | **No** | Se trata siempre como datos hostiles |
| Rama `data` | A medias | Lo que entra por Actions está validado; lo que entra por commit directo se revalida al compilar |

## Amenazas y defensas

Cada defensa tiene pruebas automáticas, salvo donde se indica.

### Falsear resultados

| Ataque | Defensa | Dónde |
|---|---|---|
| Declarar «acerté» o unos puntos | El esquema no tiene esos campos, y los campos desconocidos se rechazan. Se recorrige siempre | `core/schema/events.ts`, `core/scoring/aggregate.ts` |
| Editar el fichero de rankings | No existe: se recalculan en cada despliegue | `tools/build-community.ts` |
| Hacerse pasar por otro | El autor sale de `issue.user`, nunca del contenido. El login se ata al id numérico de GitHub | `tools/actions/intake.ts` |
| Puntos infinitos repitiendo | Rendimiento decreciente, intervalo mínimo y topes diarios | `core/scoring/rules.ts` |
| Reenviar un lote | Id de evento único por usuario | `tools/actions/intake.ts` |
| Fechas falsas | Se contrastan con la hora de GitHub. El periodo del ranking usa la hora de recepción | `core/scoring/aggregate.ts` |
| Entregar fuera de plazo | Lo decide `issue.created_at` | `core/competitions/competitions.ts` |
| Elegir las preguntas de tu competición | Semilla con el commit actual de `data`, desconocida al enviar | `tools/actions/intake.ts` |

**Lo que no se puede evitar** (ver [LIMITATIONS.md](LIMITATIONS.md)): consultar las respuestas, que
son públicas.

### Atacar a la Action

Es lo más delicado: corre con permiso de escritura sobre entrada de cualquiera.

| Ataque | Defensa |
|---|---|
| **Inyección de comandos** con un título o cuerpo | Nada del usuario se interpola en `run:`. Git se invoca sin shell. Una prueba revisa los workflows |
| **«Pwn request»**: ejecutar código de un PR con permisos | `pull_request_target` **nunca hace checkout del PR**: los ficheros se leen por API como bytes. Una prueba lo vigila |
| Dependencias maliciosas al instalar | `npm ci --ignore-scripts`, y el `package-lock` lo fija `main` |
| Acción de terceros comprometida | Todas fijadas por SHA de commit, con prueba que lo exige |
| **Bomba de descompresión** en un issue | `gunzip` con tope de 8 MB |
| Escritura fuera de lugar (`../`) | Las rutas se construyen con ids validados con expresión regular, y una lista blanca en los PR |
| Fusionar algo distinto de lo validado | La fusión indica el SHA revisado |
| Agotar la API | Lotes de 25 envíos; respeta `retry-after` |
| Crear un flujo de issues | Cuotas por usuario y día. Además, GitHub permite limitar interacciones |

### Atacar a otros usuarios (XSS)

El contenido lo escribe cualquiera y lo pinta la app de todos. Cuatro barreras:

1. **Markdown con `html: false`:** el HTML crudo se escapa.
2. **KaTeX con `trust: false`:** sin `\href` ni `\includegraphics`.
3. **DOMPurify** sobre el resultado final.
4. **CSP** con `script-src 'self'`: un script inyectado no se ejecutaría aunque lo anterior fallara.

Además: un único punto de inserción de HTML en toda la app; los textos planos (biografía, títulos)
nunca pasan por ahí; los enlaces llevan `rel="noopener noreferrer nofollow"`; y `tests/app/markdown.test.ts`
prueba 27 vectores de ataque.

| Ataque | Defensa |
|---|---|
| Píxeles de rastreo | Sólo se admiten imágenes propias (`qbimg:<hash>`). El validador rechaza las externas, y el `img-src` de la CSP también |
| **SVG con script** | SVG prohibido. Se comprueban los *magic bytes*, no la extensión |
| Enlaces `javascript:` | Bloqueados en el esquema, en markdown-it y en DOMPurify |
| Metadatos en fotos (GPS) | El canvas los elimina al procesar la imagen |

### Robo del token

Es opcional, y el modo por defecto no lo usa, de modo que **por defecto no hay ningún secreto en el
navegador**.

| Riesgo | Defensa |
|---|---|
| Que acabe en el bundle | Es entrada del usuario. Una prueba busca credenciales en el código, y sólo se leen variables `VITE_` públicas |
| Copia del almacenamiento | Nunca en `localStorage`. En memoria por defecto; con «recordar», AES-GCM con clave no extraíble |
| **XSS activo** | **El cifrado no ayuda aquí**: un script podría pedir descifrarlo. La defensa son las barreras de arriba, y `connect-src` limita a dónde podría enviarlo |
| Permisos excesivos | La app comprueba el alcance real y avisa si tiene de más. Recomienda caducidad corta |

**Riesgo residual honesto:** con un token, un XSS que superase las cuatro barreras podría escribir en
los repositorios públicos del usuario. Por eso el modo sin token es el predeterminado.

### Abuso de contenido

| Abuso | Defensa |
|---|---|
| Spam de preguntas | Cuotas, duplicados exactos rechazados, casi duplicados a revisión |
| Contenido con derechos de autor | Declaración de origen y licencia; reportes; ocultación por mantenedores |
| Usar el repo como almacén | Las imágenes no referenciadas se descartan; tamaño y número limitados |
| Sockpuppets para inflar el uso de preguntas | Topes por pregunta y día. **No se puede impedir del todo** |
| Bots haciéndose pasar por rápidos | Marca automática de lo inverosímil, pública en `integrity.json` y revisable |

## Lo que queda fuera

- **Clickjacking:** Pages no permite `frame-ancestors`. Riesgo bajo: ninguna acción en la app publica
  nada sin pasar por github.com o por un token.
- **Otro código en el mismo origen:** `usuario.github.io` comparte origen entre todos los repos de la
  cuenta. Usa un dominio propio o una cuenta dedicada si tienes otras apps allí.
- **Confianza en GitHub:** es una dependencia total, y aceptada.

## Si encuentras un problema

Si es de seguridad, no abras un issue público: usa los avisos privados de seguridad del
repositorio (Security → Report a vulnerability).
