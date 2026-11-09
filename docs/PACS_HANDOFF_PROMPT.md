# Handoff — Integración PACS Sarmiento (tomógrafo ClearCanvas) ↔ HCE iMedic

Rama: `feature/pacs-sarmiento`. Copiá TODO el bloque "PROMPT" en el agente de la otra PC.

---

## PROMPT

Estoy continuando una integración ya avanzada. Trabajá en el repo `iMedicSaaSBack`
(https://github.com/isource2025/iMedicSaaSBack), rama `feature/pacs-sarmiento`
(`git fetch && git checkout feature/pacs-sarmiento`). Leé primero
`docs/PACS_HANDOFF_PROMPT.md`, `docs/PACS_TUNEL.md` y `scripts/tunnel/sarmiento-pc/README.md`.
Hacé vos todo lo que se pueda por CLI; pedime solo lo que requiera mi navegador o AnyDesk.

### Objetivo

Que la HCE (front Vercel + API Railway, multi-tenant) muestre los estudios de
tomografía de un paciente del Sanatorio Sarmiento buscando por DNI, leyendo el PACS
ClearCanvas ImageServer del tomógrafo.

Flujo final:

```
HCE (Vercel) → API Railway /api/pacs/... → https://pacs-sarmiento.imedic.com.ar
  → Cloudflare Tunnel EXISTENTE "imedic-sarmiento" (corre en la PC de adjuntos de Sarmiento)
  → http://192.168.1.83:9013 (bridge PowerShell en el server del tomógrafo, por LAN)
  → SQL localhost\SQLCC / base ImageServer (auth Windows) + archivos D:\FS\Primary\...
```

### Restricciones del usuario (NO negociables)

- NADA de Docker. Usar la misma infra que ya existe (scripts + túneles Cloudflare como adjuntos).
- Tiene que ser "un script que ejecuto y queda todo listo".
- No existe `CF_API_TOKEN` ni Global API Key en `.env`, Railway ni Cloudflare. No inventar tokens.
- El server del tomógrafo es MUY lento, Windows viejo, **PowerShell 2.0**, no puede bajar
  de GitHub (falla TLS), y **no se le puede copiar cloudflared.exe**. Acceso solo por AnyDesk,
  donde pegar textos largos se trunca (lo que funcionó: abrir Notepad, pegar el script,
  guardar como `.ps1` con tipo "Todos los archivos").
- SQL entra con **autenticación de Windows** (sin usuario/contraseña).
- No publicar el puerto DICOM 104 a Internet.

### Datos confirmados del server del tomógrafo

| Campo | Valor |
|-------|-------|
| Host / IP LAN | `WMSvc-D5C79HS1` / `192.168.1.83` |
| Software | ClearCanvas ImageServer (discontinuado) |
| SQL | SQL Server 2012, instancia `localhost\SQLCC`, base `ImageServer` (también `ImageServerAdmin`) |
| DICOM | AE `SARMIENTO_PACS`, puerto 104, AcceptAnyDevice=True (SCP activo, responde C-ECHO/C-FIND) |
| Archivos | `Filesystem.FilesystemPath` (`D:\FS`) + `ServerPartition.PartitionFolder` (`Primary`) + `FilesystemStudyStorage.StudyFolder` (YYYYMMDD) + `StudyInstanceUid` |
| Vinculación | `Study.PatientId` ≈ DNI (7–8 dígitos, a veces con puntos/guiones). `AccessionNumber` vacío |
| EmpresaId Sarmiento | `101` (tabla `Empresas`, MySQL plataforma) |
| Túnel adjuntos existente | `imedic-sarmiento` → `files-sarmiento.imedic.com.ar` → file-server `127.0.0.1:9012` en la PC de adjuntos (`C:\imedic\adjuntos`) |

Join SQL de la ruta: `Study` → `ServerPartition` (GUID=ServerPartitionGUID) → `StudyStorage`
(ServerPartitionGUID + StudyInstanceUid) → `FilesystemStudyStorage` (StudyStorageGUID) → `Filesystem` (GUID).

### Lo que YA está hecho en esta rama

Backend (API Railway):
- `src/routes/pacs.routes.js` montado en `app.js` como `/api/pacs` (JWT + tenant + permiso
  `INTERNACION.ESTUDIOS.VER` / `TURNOS.AGENDA.VER` / `INTERNACION.ADJUNTOS.VER`):
  `GET /health`, `/pacientes/:patientId/estudios`, `/estudios/:uid`, `/estudios/:uid/series`,
  `/estudios/:uid/files`, `/estudios/:uid/file?path=`.
- `src/controllers/pacs.controller.js`, `src/services/pacs.service.js` (proxy al bridge),
  `src/utils/pacsUrl.js` (resuelve `PacsUrl` del tenant).
- Columna nueva `Empresas.PacsUrl`: `platformMysql.service.js` (`ensurePacsUrlColumn`, selects,
  `guardarConexionEmpresa`), `tenantDb.js`, `authCentral.service.js` (fallback si falta la columna),
  `superAdmin.service.js` (`conexion.pacsUrl`), `utils/empresaDbConnection.js`.
- `scripts/tunnel/set-pacs-url.js`:
  `node scripts/tunnel/set-pacs-url.js --empresa 101 --url https://pacs-sarmiento.imedic.com.ar`
- `scripts/cloudflare/cf-setup.js pacs <slug>` (camino API; requiere CF_API_TOKEN que NO hay → no usar).

Server del tomógrafo:
- `scripts/tunnel/sarmiento-pc/Instalar-Solo-Bridge-Pacs.ps1` ← **el script vigente**. PS 2.0,
  sin cloudflared. Escribe `C:\ProgramData\iMedic\pacs\pacs-bridge.ps1` (HttpListener en
  `http://+:9013/`), `netsh http add urlacl`, regla de firewall "iMedic PACS 9013", SQL con
  `Integrated Security=SSPI`, tarea programada "iMedic PACS Bridge" (ONLOGON). Endpoints:
  `/health`, `/studies?patientId=`, `/studies/:uid`, `/studies/:uid/series`, `/studies/:uid/files`,
  `/studies/:uid/file?path=`. Correr con:
  `powershell -ExecutionPolicy Bypass -File "$env:USERPROFILE\Desktop\Instalar-Solo-Bridge-Pacs.ps1"`
- Obsoletos (no usar en este server): `Instalar-Sarmiento-Pacs-UnaVez.ps1` (falla al bajar
  cloudflared), `scripts/tunnel/Instalar-Pacs.ps1` y `pacs-bridge.js` (Node + usuario SQL; sirven
  para clínicas con Node y TLS moderno). `crear_usuario_pacs_ro.sql` solo si se usa `pacs-bridge.js`.

Herramienta de diagnóstico (fuera del repo, en la otra PC): `dicom_probe.py` (pynetdicom C-ECHO/C-FIND).

### Estado NO verificado (confirmar primero)

1. Si `Instalar-Solo-Bridge-Pacs.ps1` ya se ejecutó en el tomógrafo y si
   `http://127.0.0.1:9013/health` responde OK ahí.
2. Si la PC de adjuntos llega por LAN a `http://192.168.1.83:9013/health`
   (en la PC de adjuntos: `(New-Object Net.WebClient).DownloadString('http://192.168.1.83:9013/health')`).
3. Si el túnel `imedic-sarmiento` es **remotely-managed** (config en el dashboard Zero Trust)
   o **locally-managed** (`config.yml` en la PC de adjuntos). Eso define cómo se agrega la ruta.

### Estado al 2026-11-09

- Bridge instalado y corriendo en el tomógrafo (tarea "iMedic PACS Bridge", ONLOGON: si el
  server reinicia, alguien tiene que iniciar sesión). Clave en `key.txt` y en Railway
  (`PACS_BRIDGE_KEY`, cargada con `--skip-deploys`).
- Túnel: ingress `pacs-sarmiento.imedic.com.ar → http://192.168.1.83:9013` agregado por API
  (versión 2 de la config, `files-sarmiento` intacto) + CNAME creado. Cert de `imedic.com.ar`
  en `%USERPROFILE%\.cloudflared\cert-imedic.pem` de la PC de desarrollo.
- Verificado desde Internet: `/health` público sin datos, resto 401 sin clave; con clave
  `/studies`, `/studies/:uid`, `/series`, `/files` y `/file` (DICOM real) OK; traversal → 400.
- Pendiente: merge a `main` (push directo bloqueado por hook → PR), deploy Railway,
  `set-pacs-url.js` (el proxy público de MySQL cierra la conexión: correrlo con `railway ssh`
  dentro del contenedor después del deploy), y el front.

### Tareas pendientes, en orden

1. **[HECHO] Autenticar el bridge.** El instalador genera `C:\ProgramData\iMedic\pacs\key.txt`
   (64 hex, se conserva al re-ejecutar) y la imprime al final; el bridge exige
   `X-iMedic-Pacs-Key` (o `x-imedic-token`) en todo salvo `/health`, que sin clave solo devuelve
   `ok/sql/keyConfigured`. El backend la envía desde `PACS_BRIDGE_KEY` (Railway).
   `/file?path=` rechaza `..`, `:` y rutas absolutas y valida que quede dentro de la carpeta del
   estudio. También se corrigió: `$pid` (variable de solo lectura en PS → `/studies` daba 500),
   serialización de bools/DBNull, y el script quedó 100% ASCII (sin BOM fallaba al parsear).
   Texto original de la tarea, como referencia: Hoy el bridge NO pide
   ningún token: cualquiera con la URL podría listar estudios por DNI y bajar DICOM (datos de salud).
   Implementar un secreto compartido: el bridge exige header `X-iMedic-Pacs-Key` (valor guardado
   en el server, p.ej. en `C:\ProgramData\iMedic\pacs\key.txt`, generado por el instalador e impreso
   al final) y `src/services/pacs.service.js` lo envía (variable de Railway `PACS_BRIDGE_KEY`, o
   columna por empresa si se prefiere multi-tenant). `/health` puede quedar público pero sin datos.
   Mantener compatibilidad PS 2.0. Alternativa: Cloudflare Access con service token.
   Además validar en `/studies/:uid/file?path=` que la ruta resuelta quede dentro de la carpeta del
   estudio (evitar path traversal).
2. Correr/re-correr el instalador del bridge en el tomógrafo (Notepad → pegar → guardar
   `.ps1` "Todos los archivos" → comando de arriba). Verificar `/health` y copiar la CLAVE
   impresa a Railway como `PACS_BRIDGE_KEY`.
3. Verificar conectividad LAN desde la PC de adjuntos (punto 2 del estado no verificado).
4. **Agregar el public hostname al túnel existente `imedic-sarmiento`** SIN romper `files-sarmiento`:
   `pacs-sarmiento.imedic.com.ar` → `http://192.168.1.83:9013`.
   - Opción A (CLI, en la PC del agente): `cloudflared tunnel login` (el usuario autoriza
     `imedic.com.ar` en el navegador) → `%USERPROFILE%\.cloudflared\cert.pem`. Con eso:
     `cloudflared tunnel list` para ver el ID; `cloudflared tunnel route dns imedic-sarmiento pacs-sarmiento.imedic.com.ar`.
     Si el túnel es remotely-managed, la ingress se edita vía API
     `GET/PUT /accounts/{acct}/cfd_tunnel/{id}/configurations` (insertar la regla ANTES del catch-all
     `http_status:404`, conservar la de files-sarmiento); si el cert.pem no trae token usable, ir a opción B.
     Si es locally-managed, editar `config.yml` en la PC de adjuntos (AnyDesk) agregando la regla
     y reiniciar el servicio cloudflared.
   - Opción B (navegador): dash.cloudflare.com → Zero Trust → Networks → Tunnels →
     `imedic-sarmiento` → Public Hostname → Add: subdomain `pacs-sarmiento`, domain
     `imedic.com.ar`, service `HTTP` `192.168.1.83:9013`.
   - En la PC del agente original, `cloudflared tunnel login` desde la shell del agente quedó
     colgado esperando autorización; correrlo en una terminal visible o usar la opción B.
5. Verificar desde Internet: `curl https://pacs-sarmiento.imedic.com.ar/health` (y con la key,
   `/studies?patientId=<DNI real>`).
6. `node scripts/tunnel/set-pacs-url.js --empresa 101 --url https://pacs-sarmiento.imedic.com.ar`
   (necesita el `.env` de plataforma MySQL).
7. Merge de `feature/pacs-sarmiento` → deploy Railway. Probar con JWT de Sarmiento:
   `GET /api/pacs/health` y `GET /api/pacs/pacientes/{DNI}/estudios`.
8. (Después) Front `iMedicSaaSFront`: pestaña/listado de estudios PACS en la ficha del paciente
   usando esos endpoints. Visor DICOM (p.ej. OHIF/Cornerstone) queda como fase siguiente.

### Errores ya vistos (no repetir)

- AnyDesk trunca pegados largos en la consola → usar Notepad y guardar como `.ps1`.
- PS 2.0: no `#Requires`, no `ConvertTo-Json`, `Invoke-RestMethod`, `Invoke-WebRequest`,
  ni cmdlets `*-ScheduledTask` → usar `JavaScriptSerializer`, `Net.WebClient`, `schtasks`, `netsh`.
- El operador `&` con rutas falla en ese server → usar `powershell -ExecutionPolicy Bypass -File "..."`.
- Descarga de cloudflared desde GitHub en el server: "underlying connection was closed" (TLS).
