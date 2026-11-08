# Modelo de datos

Los esquemas ejecutables están en `core/schema/`: son la definición autoritativa, y validan tanto en
el navegador como en Actions. Este documento explica el porqué.

## Tres capas

| Capa | Dónde | ¿Quién escribe? | Si se pierde |
|---|---|---|---|
| **Local** | IndexedDB | El usuario | Se pierde. Hay exportación y `storage.persist()` |
| **Comunitaria** | Rama `data`; réplica en IndexedDB | Sólo Actions, tras validar | Se vuelve a bajar |
| **Derivada** | `dist/community/*`; réplica en IndexedDB | Sólo el build | Se recalcula |

La sincronización nunca toca lo local: las tablas son distintas. Una edición de algo publicado es una
copia local con el mismo id, que tapa a la comunitaria hasta que se publica.

## Entidades

| Entidad | Capa | Esquema o tabla | Notas |
|---|---|---|---|
| `User` | Comunitaria | `UserDoc` (`users/<login>.json`) | `login` y `githubId` salen de GitHub |
| `Profile` | Comunitaria + derivada | `DerivedProfile` | El usuario sólo decide `displayName` y `bio`. `nameChangedAt` (hora del issue) marca la espera de 30 días entre cambios de nombre |
| `Subject`, `Unit`, `Topic` | Las dos | `SubjectDoc` (`taxonomy/<id>.json`) | Un documento por asignatura, con su árbol |
| `Question` | Las dos | `McqQuestion`, `OpenQuestion` | UUID estable, `rev` incremental. Hasta 10 imágenes. Una de desarrollo puede llevar `parts` (apartados con su enunciado, su solución y sus puntos), y cada apartado `subparts` (subapartados i), ii)…); sin ellos, esos campos no aparecen |
| `Answer` | Dentro de `Question` | `Answer` | Id estable: corregir una errata no invalida resultados |
| `QuestionImage` | Dentro de `Question` | `QuestionImage` | El fichero se llama `<sha256>.<ext>` |
| `StudySession` | Local | tabla `sessions` | Se guarda en cada respuesta: se reanuda tras cerrar |
| `UserProgress` | Local | tabla `progress` | Estado FSRS, favorita, difícil |
| `Competition` | Comunitaria | `Competition` | Preguntas elegidas por Actions |
| `CompetitionParticipant` | Comunitaria | `CompetitionEntry`, `CompetitionRegistration` | Sólo lo marcado: la corrección se calcula |
| `Achievement` | Derivada | `core/scoring/achievements.ts` | Catálogo + predicado. No hay fichero |
| `Leaderboard` | Derivada | `Leaderboard` | Recalculado en cada despliegue |
| `Contribution` | Local + GitHub | tabla `outbox` | Estado del envío; el rastro queda en el issue y el PR |
| `SyncMetadata` | Local | tablas `shards`, `kv`, `syncLog` | Hash por fragmento, última sincronización, registro |

## Formato de una pregunta

Contenido en **Markdown**, no HTML ni JSON de editor: se revisa bien en el diff de un PR, es compacto
y no permite HTML crudo. Fórmulas en LaTeX con `$...$` y `$$...$$`. Imágenes con `![alt](qbimg:<sha256>)`.

```json
{
  "schemaVersion": 1,
  "id": "6f1c…",
  "rev": 2,
  "type": "mcq",
  "statement": "Si duplicamos la velocidad, $E_c$…",
  "explanation": "Porque $(2v)^2 = 4v^2$.",
  "images": [],
  "difficulty": 3,
  "subjectId": "a1b2…",
  "topicIds": ["c3d4…"],
  "tags": ["energía"],
  "references": [{ "title": "Tipler, cap. 6" }],
  "author": { "login": "ana", "id": 123 },
  "createdAt": "2026-11-05T10:00:00.000Z",
  "updatedAt": "2026-11-06T09:30:00.000Z",
  "license": "CC-BY-SA-4.0",
  "answers": [
    { "id": "a", "text": "Se duplica", "correct": false },
    { "id": "b", "text": "Se cuadruplica", "correct": true, "feedback": "Va al cuadrado." }
  ],
  "multiple": false,
  "reveal": { "explanationAfterAnswer": true, "solutionsAtExamEnd": true }
}
```

(El ejemplo acorta las opciones: el mínimo real son cuatro.)

## Registro de eventos

Un fichero por usuario y mes de recepción, sólo de añadir: `events/2026/11/ana.jsonl`.

```json
{"id":"k3Jd9_aQ2xLm","q":"6f1c…","sel":["b"],"ms":8400,"at":1793880000,"s":"e91a…","m":"practice","rcv":1793880310,"src":412}
```

| Campo | Lo pone | Significado |
|---|---|---|
| `id` | Cliente | Id del intento. Hace idempotente el reenvío |
| `q`, `sel` o `g`, `ms`, `at`, `s`, `m` | Cliente | Qué respondió, cuánto tardó, cuándo dice que fue |
| `rcv`, `src` | **Actions, desde el issue** | Hora de GitHub y número de issue |

No hay `correct` ni `points`, y el esquema rechaza cualquier campo desconocido.

## Sobre de un envío

Un issue con este título y este cuerpo:

    [QB:results] 42 respuestas · k3Jd9aQ2

    Resumen legible para quien pulsa «Create».

    ```qb1
    <JSON → gzip → base64url>
    ```

Va comprimido por el límite de la URL: unos 6 000 caracteres (6 500 funciona y 7 000 da error, medido
contra GitHub). Si no cabe, se copia al portapapeles (hasta 65 000). Si tampoco, se parte en varios.
Cabe en URL una sesión típica de unas 60 respuestas.

## Datos publicados

`dist/community/` se genera en cada despliegue:

| Fichero | Contenido |
|---|---|
| `manifest.json` | Lista de fragmentos con su hash. Lo primero que se pide |
| `taxonomy.<hash>.json` | Todo el temario |
| `q/<asignatura>/<cubo>.<hash>.json` | Preguntas en 16 cubos por asignatura: un cambio sólo invalida uno |
| `profiles`, `leaderboards`, `competitions`, `question-stats`, `moderation` | Lo derivado |
| `images/<sha256>.<ext>` | Sólo las de preguntas visibles |
| `u/<login>.json` | Actividad de cada usuario. Se pide al abrir su perfil |
| `integrity.json` | Cuentas marcadas y documentos apartados. La moderación también es pública |

## Versionado

- **Documentos:** todo lleva `schemaVersion`. Git los conserva tal como se escribieron, así que se migran
  **al leerlos**, con `core/schema/migrations.ts`, y no reescribiendo el repositorio. Un documento de una
  versión futura se rechaza con un mensaje que pide actualizar.
- **IndexedDB:** versiones de Dexie en `src/infra/db/db.ts`. Se añade un `version(n)`, nunca se edita uno.
- **Envíos:** campo `v`.
- **Fechas:** ISO 8601 en UTC en los documentos; epoch en segundos en el registro, para ahorrar espacio.

Para cambiar el esquema: sube `SCHEMA_VERSION`, añade la migración y una prueba con un documento real de
la versión anterior.

## Repetición espaciada

FSRS 4.5 (`core/srs/fsrs.ts`), que Anki incorpora desde 2023, con los pesos por defecto del proyecto.
Modela la memoria con estabilidad, dificultad y recuperabilidad. Se ajusta en `preferences.retention`.
Repetir una pregunta el mismo día no infla su estabilidad.

El estado es **local**: no se publica nunca.
