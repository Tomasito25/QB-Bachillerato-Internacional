# Puesta en marcha

## 1. Crear el repositorio

Tiene que ser **público**: la rama `data` y los datos publicados son abiertos, y los minutos de
Actions sólo son gratuitos e ilimitados en repositorios públicos.

```bash
git init -b main
```

```bash
git add -A
```

```bash
git commit -m "QuestionBank"
```

```bash
gh repo create questionbank --public --source . --push
```

El primer despliegue fallará al configurar Pages, porque aún no está activado. Es normal: el
paso siguiente lo arregla y lo repite.

GitHub falla de vez en cuando: en el despliegue real, `gh repo create` respondió «Something went
wrong» aunque el repositorio acabó creándose, y un `git push` se rechazó con «fatal error in
commit_refs_rules». Espera un minuto, mira si ya existe con `gh repo view` y repite lo que falte.

## 2. Configurarlo

```bash
bash tools/setup-repo.sh
```

Hace esto, y se puede repetir sin riesgo:

| Ajuste | Por qué | A mano, en GitHub |
|---|---|---|
| Pages mediante Actions | Es lo que despliega `deploy.yml` | Settings → Pages → Source: GitHub Actions |
| Actions puede abrir PR | Sin esto, las aportaciones por issue fallan | Settings → Actions → General → Allow GitHub Actions to create and approve pull requests |
| Issues activados | Son la cola de entrada | Settings → General → Features |
| Etiquetas `qb:*` | Comunican el estado de cada envío a la app | Las crea el script |
| Rama `data` | Guarda el contenido comunitario | Se crea sola al primer envío |
| Despliegue | Publica el sitio ya con Pages activado | `gh workflow run deploy.yml` |

## 3. Abrir la app

En un par de minutos estará en:

```
https://<propietario>.github.io/<repositorio>/
```

Desde entonces, cada push a `main` despliega solo.

## 4. Comprobarlo

1. Abre la app. Debe funcionar sin errores, aunque el banco esté vacío.
2. En **Configuración → Cuenta**, pulsa **Conectar con GitHub** y sigue los pasos. En unos segundos
   debe reconocer tu cuenta.
3. Crea una pregunta y publícala desde **Sincronización**.
4. Mira la pestaña **Actions** del repositorio: **Procesar envíos** debe abrir y fusionar un PR
   contra `data`, y lanzar **Desplegar**.
5. En 2 o 3 minutos, la app debe traer la pregunta como comunitaria sin que hagas nada, si sigue
   abierta. Si no, ocurrirá al volver a abrirla o al pulsar **Sincronizar**.

## Variables opcionales

Se definen en Settings → Secrets and variables → Actions → **Variables**. No hay secretos que
configurar: basta el `GITHUB_TOKEN` que da Actions.

| Variable | Por defecto | Efecto |
|---|---|---|
| `QB_AUTO_MERGE` | activado | Con `false`, toda aportación espera a una revisión humana |
| `QB_APP_NAME` | `QuestionBank` | Nombre de la app: título, menú y nombre al instalarla (máx. 40 caracteres). Se aplica en el siguiente despliegue |

Si renombras el repositorio, la dirección de la web cambia y la página publicada sigue
apuntando a la antigua hasta que se vuelva a compilar. Relanza el despliegue:

```bash
gh workflow run deploy.yml --ref main
```

Quien tenga la app instalada con la dirección antigua tendrá que instalarla de nuevo: GitHub
no redirige las páginas de un repositorio renombrado. Su progreso no se pierde, porque el
navegador lo guarda por dominio (`<usuario>.github.io`), no por ruta.

## Moderar

Todo se hace con Git y GitHub. Mantenedor es quien tiene permiso de escritura en el repositorio.

| Quiero… | Cómo |
|---|---|
| Revisar lo dudoso | PR con etiqueta `qb:review`: fusiónalo o ciérralo. La app del autor se entera sola |
| Atender reportes | Issues con etiqueta `qb:report` |
| Ocultar una pregunta | Añade su id a `moderation/hidden.json` en la rama `data`. Deja de servirse y de dar puntos |
| Vetar una cuenta | Añade su login a `moderation/banned.json`. Sus envíos se rechazan y sale de los rankings |
| Rehabilitar una cuenta marcada como sospechosa | Añade su login a `moderation/trusted.json`. Las cuentas marcadas se publican en `community/integrity.json` |
| Corregir una pregunta | Edítala en la rama `data`: el commit directo también es válido, y lo inválido se aparta al compilar |
| Retirar contenido con derechos de autor | Ocúltala como arriba. **Para borrarla del historial hay que reescribir la rama**: `git filter-repo` y push forzado |

Formato de los ficheros de moderación:

```json
{ "questions": ["uuid-de-la-pregunta"] }
```

```json
{ "logins": ["usuario-en-minusculas"] }
```

Tras un cambio manual en `data`, publícalo:

```bash
gh workflow run deploy.yml
```

## Vigilar el crecimiento

| Señal | Qué hacer |
|---|---|
| El sitio publicado se acerca a 1 GB, el límite de Pages | Ver el plan de escala en [LIMITATIONS.md](LIMITATIONS.md) |
| `manifest.quarantined` mayor que 0 | Mira `community/integrity.json`: hay documentos inválidos en `data` |
| Un envío con la etiqueta `qb:error` | Falló de forma inesperada: revisa el registro de **Procesar envíos**. Para reintentarlo, quita la etiqueta; entra en el siguiente barrido, o lánzalo con `gh workflow run intake.yml`. La app de quien lo envió sigue consultándolo y se actualiza sola |
| Un envío abierto, sin etiquetas, durante más de 30 minutos | Los fallos pasajeros de GitHub se reintentan solos cada 15 minutos. Si sigue ahí, revisa el registro |

## Comprobar los rankings por tu cuenta

Son una función pura de la rama `data`. Cualquiera puede recalcularlos y compararlos con lo
publicado:

```bash
git clone --branch data --depth 1 https://github.com/<propietario>/<repositorio>.git datos
```

```bash
npm run community:build -- --data datos --out salida
```
