#!/usr/bin/env bash
# Crea la rama `data` si no existe: huérfana, sin historia común con main, sólo con contenido.
set -euo pipefail
repo="$1"

if gh api "repos/$repo/git/ref/heads/data" --silent 2>/dev/null; then
  exit 0
fi

readme='# Datos comunitarios de QuestionBank

Esta rama guarda el contenido compartido. No se edita a mano: la escriben las Actions de `main`.

- `questions/`, `taxonomy/` e `images/`: preguntas, temario e imágenes. Licencia CC BY-SA 4.0.
- `users/`, `events/`, `system-events/` y `competitions/`: perfiles y registro de actividad.
- `moderation/`: `banned.json`, `hidden.json` y `trusted.json` los editan los mantenedores.
'
tree=$(gh api -X POST "repos/$repo/git/trees" --input - --jq .sha <<JSON
{"tree":[{"path":"README.md","mode":"100644","type":"blob","content":$(printf '%s' "$readme" | node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>process.stdout.write(JSON.stringify(s)))')}]}
JSON
)
commit=$(gh api -X POST "repos/$repo/git/commits" -f message='Inicio de los datos comunitarios' -f "tree=$tree" --jq .sha)
gh api -X POST "repos/$repo/git/refs" -f ref=refs/heads/data -f "sha=$commit" --silent
echo "Rama data creada."
