#!/usr/bin/env bash
# Deja un repositorio de GitHub listo para QuestionBank. Se puede ejecutar varias veces.
#   bash tools/setup-repo.sh [propietario/nombre]
# Necesita `gh` con sesión iniciada y permisos de administración sobre el repositorio, y que
# `main` ya esté subida: la API de Git no funciona sobre un repositorio vacío.
set -euo pipefail
repo="${1:-$(gh repo view --json nameWithOwner --jq .nameWithOwner)}"
echo "Configurando $repo…"

# Pages publicado desde Actions, no desde una rama.
if gh api "repos/$repo/pages" --silent 2>/dev/null; then
  gh api -X PUT "repos/$repo/pages" -f build_type=workflow --silent
else
  gh api -X POST "repos/$repo/pages" -f build_type=workflow --silent
fi
echo "  Pages: mediante Actions"

# Sin esto, GITHUB_TOKEN no puede abrir pull requests y las aportaciones por issue fallarían.
gh api -X PUT "repos/$repo/actions/permissions/workflow" -f default_workflow_permissions=read -F can_approve_pull_request_reviews=true --silent
echo "  Actions: puede abrir y aprobar pull requests"

gh api -X PATCH "repos/$repo" -F has_issues=true -F allow_squash_merge=true --silent
echo "  Issues: activados"

while read -r name color description; do
  gh label create "$name" --repo "$repo" --color "$color" --description "$description" --force > /dev/null
done <<'LABELS'
qb:accepted 2da44e Envío aceptado
qb:rejected d1242f Envío rechazado
qb:review bf8700 Necesita revisión humana
qb:report 8250df Reporte de contenido
qb:error cf222e Fallo interno al procesar
LABELS
echo "  Etiquetas: creadas"

bash "$(dirname "$0")/actions/ensure-data-branch.sh" "$repo"
echo "  Rama data: lista"

# El despliegue que lanzó el push fallará si Pages aún no estaba activado: se repite ahora.
gh workflow run deploy.yml --repo "$repo"
echo "  Despliegue: lanzado"

echo
echo "Listo. Sigue el progreso con: gh run watch --repo $repo"
