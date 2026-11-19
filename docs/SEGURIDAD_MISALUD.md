# Seguridad de adjuntos, PACS, fotos y RENAPER (S1–S7)

Cambios previos al portal del paciente MiSalud. Objetivo: que nada de lo que
corre en las clínicas (file server de adjuntos, bridge PACS) ni las fotos de
pacientes se pueda leer sin una credencial, y que ninguna credencial quede en
el código.

| | Qué cambia | Dónde |
|---|---|---|
| S1 | El file server exige credencial, solo lee/escribe dentro de sus carpetas y no manda CORS | `file-server.js`, `Instalar-Clinica.ps1`, `Instalar-Clinica-UnaVez.ps1` |
| S2 | Token firmado de vida corta (2 min) por pedido y clave propia por clínica | `src/utils/signedFileToken.js` + interceptor axios |
| S3 | Lo mismo para el bridge PACS (Node y PowerShell 2.0 de Sarmiento) | `pacs-bridge.js`, `Instalar-Pacs.ps1`, `sarmiento-pc/Instalar-Solo-Bridge-Pacs.ps1` |
| S4 | Script para el usuario SQL Server de solo lectura por clínica | `scripts/sql/misalud/crear_usuario_portal_ro_sqlserver.sql` |
| S5 | Script para el usuario MySQL de solo lectura del catálogo, sin contraseñas | `scripts/sql/misalud/crear_usuario_catalogo_ro_mysql.sql` |
| S6 | Credenciales RENAPER fuera del código | `src/services/renaper.service.js` |
| S7 | `/media/patients` y `/uploads` piden URL firmada o sesión | `src/app.js`, `src/utils/mediaUrl.js` |

## Cómo funciona el token firmado

El backend firma cada pedido a la clínica con la clave de esa clínica:

```
x-imedic-sig: v1.<IDEMPRESA>.<vence>.<firma>
firma = HMAC-SHA256(clave, "v1\n<IDEMPRESA>\n<MÉTODO>\n<ruta>\n<query ordenado>\n<vence>")
```

- Vale para **ese** método, ruta y query (un archivo) durante 120 s. Tolerancia
  de reloj: 5 minutos. El servidor rechaza tokens de más de 15 min de vida.
- Cada servidor solo conoce la clave de su clínica: si se filtra la de una, no
  sirve para las otras. Si el servidor tiene `IMEDIC_FS_EMPRESA_ID` /
  `$EmpresaId`, además rechaza tokens de otra empresa.
- Mismo formato en Node (`file-server.js`, `pacs-bridge.js`) y en PowerShell
  (`Instalar-Clinica-UnaVez.ps1`, `Instalar-Solo-Bridge-Pacs.ps1`);
  `tests/psSignatureParity.test.js` lo verifica con `pwsh`.
- MiSaludBack tiene que firmar igual (mismo módulo `signedFileToken.js`).

Claves en Railway (cualquiera de las dos formas, se pueden combinar):

| Variable | Uso |
|---|---|
| `IMEDIC_SIGNING_MASTER` | Una clave maestra. La de cada clínica se deriva: `node scripts/tunnel/clave-firma.js --servicio fs\|pacs --empresa <id>` |
| `FILE_SERVER_SIGNING_KEYS` / `PACS_SIGNING_KEYS` | Mapa explícito `{"101":"clave"}`. Pisa a la derivada |
| `FILE_SERVER_SIGNING_TTL_S` / `PACS_SIGNING_TTL_S` | Vida del token (default 120, máx. 900) |

Mientras exista `FILE_SERVER_TOKEN` / `PACS_BRIDGE_KEY`, el backend manda
también el token fijo viejo (`x-imedic-token`). Los servidores nuevos aceptan
firma **o** token viejo; los viejos ignoran la firma. Por eso se puede
desplegar en cualquier orden sin cortar descargas, y el token viejo se apaga al
final.

## Qué servidor tiene cada clínica

Mirar `https://files-<clinica>.imedic.com.ar/health` (y `pacs-<clinica>`).
Si **no** tiene `"security":"v1"`, es un servidor viejo:

| `/health` | Servidor | Cómo se actualiza |
|---|---|---|
| `encoding: utf8-v3` sin `security` | Node `file-server.js` (`Instalar-Clinica.ps1`) | Paso 3a |
| `encoding: ps1-unc-v2` (Vidal, Colman) | PowerShell de `Instalar-Clinica-UnaVez.ps1` / `Instalar-Colman-UnaVez` | Paso 3b |
| `service: imedic-pacs-bridge` | Node `pacs-bridge.js` (`Instalar-Pacs.ps1`) | Paso 4a |
| `service: imedic-pacs-bridge-ps1` (Sarmiento) | `sarmiento-pc/Instalar-Solo-Bridge-Pacs.ps1` | Paso 4b |

Los actualizados muestran `security: "v1"` y el modo de autenticación
(`auth` / `signing`). El PowerShell nuevo dice `encoding: ps1-unc-v3`.

## Despliegue paso a paso

### 1. Railway (iMedicSaaSBack) — antes del deploy

1. **RENAPER** (obligatorio, si no la validación de DNI responde 503):
   `RENAPER_NOMBRE` y `RENAPER_CLAVE` con las credenciales de MSAL que hoy usa
   el sistema. Se recomienda pedir a MSAL credenciales nuevas, porque las
   actuales estuvieron en el código y en el historial de git.
   Opcionales: `RENAPER_BASE_URL`, `RENAPER_COD_DOMINIO` (defaults = los de hoy).
2. **Clave maestra**: `node scripts/tunnel/clave-firma.js --maestra` y cargar
   el resultado en `IMEDIC_SIGNING_MASTER`.
3. Dejar `FILE_SERVER_TOKEN` / `PACS_BRIDGE_KEY` como están (si existen).
4. Opcional: `MEDIA_URL_SECRET` (si no, se deriva de `JWT_SECRET`) y
   `MEDIA_URL_TTL_S` (default 7200).

### 2. Deploy del backend

Nada cambia para las clínicas todavía: los servidores viejos ignoran el header
nuevo. Verificar que las descargas de adjuntos, PACS y las fotos de pacientes
siguen andando.

### 3. File server de cada clínica

Primero obtener la clave de la clínica (en una PC con el repo y la maestra):

```bash
IMEDIC_SIGNING_MASTER=... node scripts/tunnel/clave-firma.js --servicio fs --empresa 101
```

Es un secreto: pasarla por un canal seguro, no por chat.

**3a. Node (`Instalar-Clinica.ps1`)** — PowerShell admin, en el repo de la PC:

```powershell
git pull
.\scripts\tunnel\Instalar-Clinica.ps1 -Clinica sarmiento -Root 'C:\imedic\adjuntos' -EmpresaId 101 -SigningKey '<clave>'
```

Conserva túnel y servicio; deja la clave en `IMEDIC_FS_SIGNING_KEY` (variable
de máquina) y `clinica.env` (solo Administradores/SYSTEM).

**3b. PowerShell (Vidal, Colman)** — copiar `Instalar-Clinica-UnaVez.ps1` a la
PC y editar el bloque CONFIG:

```powershell
$Clinica     = 'vidal'
$EmpresaId   = 1
$UncRoot     = '\\server\Imagenes\Vidal'
$LocalRoot   = 'E:\adjuntos'
$SigningKey  = '<clave>'
$ExtraRoots  = ''          # ver "Carpetas permitidas"
$SoloFileServer = $true    # el túnel ya existe: no toca cloudflared ni Super Admin
```

Para Colman: `$Clinica='colman'`, `$EmpresaId=102`,
`$UncRoot=$LocalRoot='E:\imedic\adjuntos'`. El viejo
`Instalar-Colman-UnaVez` (b64) queda obsoleto.

Ejecutar como Administrador **logueado con el usuario que ve el UNC**.

**Verificar** (desde una PC con el repo y la maestra):

```bash
IMEDIC_SIGNING_MASTER=... node scripts/tunnel/verificar-servidores-clinica.js --empresa 1 --fs https://files-vidal.imedic.com.ar
```

Tiene que decir `security=v1`, sin CORS, 401 sin credencial, pedido firmado
aceptado, ruta fuera de la carpeta rechazada y reloj OK. Después abrir dos o
tres adjuntos viejos desde iMedic.

### 4. Bridge PACS

Clave: `node scripts/tunnel/clave-firma.js --servicio pacs --empresa 101`.

**4a. Node**: `.\scripts\tunnel\Instalar-Pacs.ps1 -Clinica sarmiento -EmpresaId 101 -SigningKey '<clave>'` (más los parámetros SQL de siempre).

**4b. Sarmiento (PowerShell 2.0, tomógrafo)**: en `Instalar-Solo-Bridge-Pacs.ps1`
poner `$SignKeyIn = '<clave>'` y ejecutarlo como Administrador. Conserva
`key.txt` (clave vieja) hasta el paso 5.

Verificar: `verificar-servidores-clinica.js --empresa 101 --pacs https://pacs-sarmiento.imedic.com.ar`
y abrir un estudio desde iMedic.

### 5. Apagar los tokens viejos (cuando todas las clínicas estén en `security=v1`)

1. Railway: borrar `FILE_SERVER_TOKEN` y `PACS_BRIDGE_KEY`. Deploy.
2. En cada PC (opcional, endurece más): borrar `IMEDIC_FS_TOKEN`
   (variable de máquina / `clinica.env`), `C:\ProgramData\iMedic\fs-legacy-token.txt`,
   `C:\ProgramData\iMedic\pacs\key.txt` o `IMEDIC_PACS_TOKEN` de `pacs.env`, y
   reiniciar la tarea/servicio.

### Volver atrás

- Backend: el código anterior no firma. Las clínicas ya actualizadas solo
  van a aceptar al backend viejo si tienen el token fijo
  (`FILE_SERVER_TOKEN` / `PACS_BRIDGE_KEY` en Railway y el mismo valor en la
  PC). Por eso conviene no hacer el paso 5 hasta que todo esté estable.
- Clínica: volver a ejecutar el instalador de la versión anterior de `main`.

## Carpetas permitidas (confinamiento)

El file server ahora solo sirve archivos dentro de:

- Node: `IMEDIC_FS_ROOT` + `IMEDIC_FS_EXTRA_ROOTS` (separadas por `;`).
- PowerShell: `$UncRoot` + `$LocalRoot` + `$ExtraRoots`.

Rutas viejas guardadas en la base con otra unidad o share (por ejemplo
`D:\Imagenes\...` o `\\OTROSERVER\...`) ya no se sirven salvo que su carpeta
esté en la lista. Las `D:\`/`F:\` que antes se reescribían a `E:\` siguen
funcionando si quedan dentro de la carpeta. Antes de actualizar una clínica,
revisar en SQL los prefijos que existen:

```sql
SELECT LEFT(PatchServidor, 25) AS prefijo, COUNT(*) AS n
FROM imPedidosEstudiosAdjuntos GROUP BY LEFT(PatchServidor, 25) ORDER BY n DESC;
SELECT LEFT(PatchDestino, 25) AS prefijo, COUNT(*) AS n
FROM imVisitaRequisitos GROUP BY LEFT(PatchDestino, 25) ORDER BY n DESC;
```

Si después aparecen 404, el log del file server dice
`bloqueado, fuera de las carpetas permitidas: <ruta>`: agregar esa carpeta a
`ExtraRoots` y reinstalar.

## Fotos de pacientes (S7)

- La API devuelve `FotoURL` con `?exp=&sig=` (vale ~2–3 h, estable dentro de la
  hora para que el navegador la cachee). `<img src>` funciona sin cambios en
  el front.
- Sin firma vigente hace falta sesión (cookie / Bearer); si no, 401.
- `/uploads` solo sirve archivos sueltos de la raíz y de `patient-photos/`:
  requisitos escaneados, fotos de personal y temporales ya no son públicos.
- Al guardar, el backend quita `exp`/`sig` de la URL que manda el front.

## Riesgos conocidos

- **Reloj de la PC**: con más de 5 minutos de diferencia, el servidor
  rechaza la firma (401). `verificar-servidores-clinica.js` lo muestra. Sincronizar la hora de Windows.
- **Rutas fuera de la carpeta**: ver "Carpetas permitidas".
- **Servidores PowerShell**: el instalador nuevo reemplaza `file-server.ps1`.
  Se probó la firma y la sintaxis con PowerShell 7 en Linux, no en un
  Windows real con UNC: probar en la clínica con la verificación del paso 3
  antes de borrar el token viejo.
- **Clínicas sin actualizar** siguen abiertas (como hoy) hasta el paso 3/4.
- **Fotos**: la URL firmada no está atada a la clínica; quien tenga una URL
  vigente ve esa foto hasta que vence. El disco de Railway es efímero (sin
  cambios respecto de hoy).
- **RENAPER**: si falta la variable, la validación de DNI y el alta automática
  del chatbot devuelven 503 hasta cargarla.
- Los scripts obsoletos (`vidal-pc/Parche-Unc-Vidal.ps1`,
  `vidal-pc/Start-QuickTunnel.ps1`, `sarmiento-pc/Instalar-Sarmiento-Pacs-UnaVez.ps1`)
  ahora cortan con error para que nadie reinstale un servidor abierto.

## Usuarios de solo lectura para MiSalud (S4, S5)

Ver `scripts/sql/misalud/README.md`.
