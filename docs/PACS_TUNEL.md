# PACS Sarmiento — túnel fijo (igual que adjuntos)

```
HCE (Vercel) → API (Railway) → https://pacs-sarmiento.imedic.com.ar
                              → Cloudflare Tunnel imedic-pacs-sarmiento
                              → 127.0.0.1:9013 (pacs-bridge.js)
                              → SQL ImageServer + D:\FS\Primary\...
```

No se publica el puerto DICOM 104 a Internet. El bridge habla SQL/archivos en
local y expone HTTP detrás del mismo modelo de túnel que `files-sarmiento`.

## Datos confirmados en el servidor del tomógrafo

| Campo | Valor |
|-------|--------|
| Host | `WMSvc-D5C79HS1` / `192.168.1.83` |
| Software | ClearCanvas ImageServer |
| SQL | `localhost\SQLCC` → base `ImageServer` |
| AE Title | `SARMIENTO_PACS` |
| Puerto DICOM | `104` (sigue para el tomógrafo; no para la nube) |
| Disco | `D:\FS\Primary\[YYYYMMDD]\[StudyInstanceUID]` |
| Vinculación HCE | PatientId ≈ DNI (7–8 dígitos); AccessionNumber vacío |

## Sin CF_API_TOKEN ni Railway

Los túneles de adjuntos **no** viven en Railway ni usan un API token
global. Usan `cloudflared` en la PC de la clínica (`tunnel login` o el
token de ese túnel). El PACS hace **lo mismo**, en la PC del tomógrafo:

```powershell
.\scripts\tunnel\Instalar-Pacs.ps1 -Clinica sarmiento -SqlUser imedic_pacs_ro
```

Eso abre el navegador una vez (`cloudflared tunnel login` → elegís
`imedic.com.ar`), crea el túnel `imedic-pacs-sarmiento`, el DNS
`pacs-sarmiento.imedic.com.ar` y el bridge. No hace falta nada en `.env`
de Cloudflare.

(Opcional) Si preferís el camino API como `cf-setup.js clinica`, también
existe `cf-setup.js pacs`, pero **no es necesario**.

## Pasos de producción

### A) En la PC del PACS (AnyDesk, Administrador)

1. Instalar **Node.js LTS** si no está.

2. Copiar el repo (o al menos `pacs-bridge.js`, `package.json`, `scripts/tunnel/*`).

3. En SSMS, ejecutar `scripts/tunnel/sarmiento-pc/crear_usuario_pacs_ro.sql`
   (cambiar la contraseña).

4. Instalar (sin token):

```powershell
cd C:\ruta\iMedicSaaSBack
npm install --omit=dev
.\scripts\tunnel\Instalar-Pacs.ps1 -Clinica sarmiento -SqlUser imedic_pacs_ro
```

5. Probar local:

```powershell
Invoke-RestMethod http://127.0.0.1:9013/health
```

### B) En tu PC / nube

```powershell
node scripts/tunnel/set-pacs-url.js --empresa 101 --url https://pacs-sarmiento.imedic.com.ar
```

Deploy del backend (Railway) con los cambios de `/api/pacs`.

### C) Prueba end-to-end

```http
GET /api/pacs/health
GET /api/pacs/pacientes/{DNI}/estudios
```

(requiere JWT + tenant Sarmiento + permiso de estudios/adjuntos)

## API del bridge (local / vía túnel)

| Método | Ruta | Uso |
|--------|------|-----|
| GET | `/health` | SQL + FS |
| GET | `/studies?patientId=` | Lista estudios |
| GET | `/studies/:uid` | Detalle + ruta |
| GET | `/studies/:uid/series` | Series |
| GET | `/studies/:uid/files` | Lista `.dcm` |
| GET | `/studies/:uid/file?path=` | Descarga un `.dcm` |

La API de la HCE proxea lo mismo bajo `/api/pacs/...`.
