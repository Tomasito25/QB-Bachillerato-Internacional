# Importar preguntas en bloque

Un fichero JSON puede traer varias asignaturas, con sus unidades y temas, y todas las preguntas
que quieras de golpe. Se importa en **Banco de preguntas › Importar**. Lo importado queda en
este dispositivo, «sin publicar», hasta que lo publiques; al publicar se declara el origen (propio,
con licencia abierta o de dominio público), y tiene que ser verdad.

Es el mismo formato que produce **Exportar**: la forma más rápida de tener una plantilla es crear
una pregunta en la app y exportarla. Hay un ejemplo completo, que se comprueba en las pruebas, en
[import-example.json](import-example.json): dos asignaturas, tipo test de una y de varias correctas,
una de desarrollo con apartados y una imagen.

## Estructura

```json
{
  "format": "questionbank-export",
  "version": 1,
  "exportedAt": "2026-11-08T10:00:00Z",
  "subjects": [],
  "questions": [],
  "images": []
}
```

Los seis campos son obligatorios y no se admite ninguno más. Lo mismo dentro: un campo de más
invalida esa pregunta o asignatura, y en una imagen o en la raíz hace que no se acepte el fichero.
Puede ocupar hasta 200 MB.

| Para | Formato |
|---|---|
| Identificadores (`id`, `subjectId`, `topicIds`) | UUID de verdad: `uuidgen` o `python3 -c "import uuid; print(uuid.uuid4())"` |
| Fechas | ISO 8601 en UTC, acabadas en `Z`: `2026-11-08T10:00:00Z` |
| Textos | Markdown, con fórmulas e imágenes (ver más abajo) |

## Asignaturas, unidades y temas

```json
{
  "schemaVersion": 1,
  "id": "UUID",
  "name": "Física SL",
  "description": "Opcional",
  "rev": 1,
  "createdBy": null,
  "createdAt": "2026-11-08T10:00:00Z",
  "updatedAt": "2026-11-08T10:00:00Z",
  "units": [
    {
      "id": "UUID",
      "name": "A. Espacio, tiempo y movimiento",
      "order": 0,
      "topics": [{ "id": "UUID", "name": "A.1 Cinemática", "order": 0 }]
    }
  ]
}
```

- `order` empieza en 0 y decide el orden en el Temario. Nombres de hasta 120 caracteres.
- **Para meter preguntas en una asignatura que ya tienes, usa el mismo nombre.** La asignatura,
  cada unidad y cada tema se emparejan por nombre, sin contar mayúsculas, tildes ni signos
  («Fisica sl» es «Física SL»). Lo que coincide se queda con su id de siempre y las preguntas se
  reasignan solas; lo que no existe se crea. Así no hace falta saber los UUID de la app.
- Una asignatura mal escrita se ignora, y entonces sus preguntas salen como no válidas.

## Preguntas

Campos comunes a los dos tipos:

| Campo | Valor |
|---|---|
| `schemaVersion` | `1` |
| `id` | UUID. Si ya hay una pregunta con ese id, se omite |
| `rev` | `1` |
| `statement` | Enunciado. Hasta 8 000 caracteres |
| `explanation` | Opcional. Hasta 8 000 |
| `images` | Las imágenes que usa la pregunta (sin el `base64`). Hasta 50. Si no usa, `[]` |
| `difficulty` | 1 muy fácil, 2 fácil, 3 intermedio, 4 difícil, 5 muy difícil |
| `subjectId` | La asignatura del fichero (o una que ya exista) |
| `topicIds` | De 1 a 8 temas, de la asignatura de la pregunta |
| `tags` | Hasta 12, de 40 caracteres como mucho. Si no hay, `[]` |
| `references` | Hasta 10: `{ "title": "Libro", "url": "https://…" }` (la `url` es opcional). Si no hay, `[]` |
| `author` | `null` (al importar se pone siempre así) |
| `createdAt`, `updatedAt` | Fechas en UTC |
| `license` | `"CC-BY-SA-4.0"` |

### Tipo test

```json
{
  "type": "mcq",
  "answers": [
    { "id": "a", "text": "$6\\,\\text{m s}^{-1}$", "correct": true },
    { "id": "b", "text": "$9\\,\\text{m s}^{-1}$", "correct": false, "feedback": "Eso es la distancia." }
  ],
  "multiple": false,
  "reveal": { "explanationAfterAnswer": true, "solutionsAtExamEnd": true }
}
```

- De 4 a 12 opciones. Cada `id`, de 1 a 8 letras minúsculas o cifras, sin repetir (lo normal: `a`, `b`, `c`…).
- `multiple: false` exige exactamente una correcta; `true` admite varias. Al menos una correcta siempre.
- `text` hasta 2 000 caracteres, y admite fórmulas e imágenes.
- `feedback` es opcional (hasta 1 000) y se muestra como **texto plano**: una fórmula con `$` se vería tal cual. Usa Unicode (`v²`, `λ = c/f`).
- `reveal`: si se ve la explicación nada más responder, y si se ven las soluciones al acabar un examen.

### Desarrollo

```json
{
  "type": "open",
  "modelAnswer": "Solución o respuesta modelo",
  "criteria": [{ "id": "a", "text": "Usa la ecuación correcta", "weight": 2 }],
  "keywords": ["pendiente"],
  "parts": [
    { "id": "a", "statement": "Calcula la aceleración.", "modelAnswer": "$a = 2\\,\\text{m s}^{-2}$", "marks": 2 },
    { "id": "b", "statement": "Calcula la distancia.", "modelAnswer": "$s = 16\\,\\text{m}$" }
  ]
}
```

- `modelAnswer` hasta 12 000 caracteres. **Con apartados puede ir vacía** (`""`); sin ellos es obligatoria.
- `parts` es opcional: de 1 a 10 apartados, que la app numera a), b), c)… en el orden del fichero.
  Cada uno con su `statement` (hasta 4 000), su `modelAnswer` (hasta 12 000) y, si quieres, `marks`
  de 1 a 20. **Si no hay apartados, no pongas el campo**: `"parts": []` no es válido.
- Un apartado se puede dividir en `subparts` (subapartados i), ii)…): de 1 a 8, cada uno con `id`,
  `statement`, `modelAnswer` y `marks` opcional. Entonces el `statement` y la `modelAnswer` del apartado
  pueden ir vacíos (`""`), y los puntos van en cada subapartado, no en el apartado.
- `criteria`: hasta 12, con `weight` de 1 a 10. `keywords`: hasta 20. Si no hay, `[]`.
- Los `id` de criterios y apartados siguen la misma regla que los de las opciones.

## Fórmulas y texto

- Markdown: `**negrita**`, `*cursiva*`, listas, `> citas`… Los saltos de línea en JSON son `\n`.
- Fórmula en la línea: `$v = u + at$`, sin espacio justo después del primer `$` ni antes del
  último, y sin una cifra pegada detrás. En un bloque aparte: `$$` en su propia línea, la fórmula, y
  otra vez `$$`.
- **En JSON, cada barra invertida de LaTeX va doble**: `"\\frac{a}{b}"`, `"\\text{m}"`, `"\\theta"`.
  Con una sola, `\f`, `\t`, `\b` o `\n` se leen como caracteres de control y la fórmula se rompe sin avisar.

## Imágenes

Cada imagen va una vez en `images` (el del fichero), aunque la usen varias preguntas:

```json
{ "hash": "SHA-256", "ext": "png", "width": 200, "height": 140, "bytes": 530, "alt": "Descripción", "base64": "iVBORw0KGgo…" }
```

- `ext`: `png`, `jpg` o `webp`. Hasta 512 KB y 8 000 px de lado. `alt` describe la imagen (hasta 300 caracteres).
- `hash` es el SHA-256 del fichero (`sha256sum figura.png`), y `base64` su contenido
  (`base64 -w0 figura.png`). **Si el hash no coincide, la imagen se descarta.** `bytes` es su tamaño.
- En los textos se usa así, en cualquier campo (enunciado, opciones, apartados, soluciones…):
  `![Descripción](qbimg:SHA-256)`. Y la pregunta la lista en su propio `images`, sin `base64`.
- Sólo vale `qbimg:`. Una imagen de otra web no se enseña y la pregunta no se puede publicar.

## Qué pasa al importar

Al acabar, la app dice cuántas preguntas entraron y cuántas se omitieron, y por qué:

| Omitida como | Motivo |
|---|---|
| Ya existía | Hay una pregunta con el mismo `id` |
| Duplicada | Ya hay una con el mismo enunciado y las mismas opciones o apartados |
| No válida | Falta un campo, sobra uno, se pasa de un límite o sus temas no existen |

Las preguntas entran con `rev: 1` y sin autor: al publicarlas, el autor es quien publica.
