# QuestionBank

Banco de preguntas colaborativo: la gente que lo usa lo mantiene. Crea preguntas, compártelas,
estudia con repetición espaciada, compite con otras personas y sigue tu progreso, también sin
conexión.

Funciona **sin servidores propios ni base de datos**: se publica en GitHub Pages y usa GitHub
Actions como backend. Es una PWA instalable.

| | |
|---|---|
| **Sin cuenta** | Crear preguntas, estudiar, exámenes, repaso y estadísticas, con tema y color a tu gusto y una guía paso a paso dentro de la app. Todo queda en el dispositivo |
| **Con cuenta de GitHub** | Publicar preguntas, perfil público, rankings y competiciones |

## Empezar en local

Requisitos: Node 22 o superior.

```bash
npm install
```

```bash
npm run dev
```

| Orden | Para qué |
|---|---|
| `npm run dev` | Servidor de desarrollo |
| `npm run check` | Lint, tipos, pruebas y compilación: lo mismo que CI |
| `npm test` | Sólo las pruebas |
| `npm run build` | Compilación de producción |
| `npm run community:build -- --data <rama data> --out <salida>` | Recalcula los datos comunitarios y los rankings |
| `npm run icons` | Regenera los iconos desde su dibujo |

## Desplegar

Lo explica paso a paso [docs/SETUP.md](docs/SETUP.md). En resumen: crear un repositorio público,
subir `main` y ejecutar `tools/setup-repo.sh`. Después, cada push a `main` despliega solo.
El nombre que muestra la app se cambia con la variable de repositorio `QB_APP_NAME`.

## Cómo funciona

GitHub Pages sólo sirve ficheros, pero GitHub tiene todo lo demás. El navegador nunca escribe
datos oficiales: **propone** cambios con un issue o un pull request, y GitHub Actions los valida y
los consolida en una rama `data`. Los rankings no se guardan: se recalculan desde el registro de
eventos en cada despliegue, así que no hay ningún número que manipular.

```
Navegador ──lee sin cuota──▶ GitHub Pages ◀──despliega── GitHub Actions
    │                                                        ▲   │
    └───propone con issue o PR───▶ GitHub (certifica autor) ─┘   ▼
                                                             rama data
```

## Documentación

- [Arquitectura](docs/ARCHITECTURE.md): decisiones, diagramas y restricciones comprobadas.
- [Modelo de datos](docs/DATA-MODEL.md): entidades, formatos y versionado.
- [Limitaciones](docs/LIMITATIONS.md): lo que esta arquitectura no puede garantizar, sin rodeos, y lo que se ha probado contra GitHub de verdad.
- [Seguridad](docs/SECURITY.md): modelo de amenazas.
- [Puesta en marcha](docs/SETUP.md): configurar el repositorio y moderar.

## Estructura

```
core/      Dominio puro: esquemas, corrección, FSRS, puntos, competiciones. Corre igual en el
           navegador y en Actions: es lo que permite predecir en cliente y decidir en servidor.
tools/     Lo que se ejecuta en Actions: procesar envíos, revisar PR, compilar datos.
src/       La PWA: features por dominio, infraestructura y kit de interfaz.
tests/     Pruebas de core, de tools (con git real) y de la app.
docs/      Documentación.
```

## Licencias

El **contenido** que aporta la comunidad se publica con [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/deed.es):
quien publica lo acepta en la propia app. La licencia del **código** está por decidir: hasta
entonces, se aplican los derechos de autor por defecto.
