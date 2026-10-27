# Colman — túnel fijo (copy-paste)

Adjuntos por defecto: `E:\imedic\adjuntos` (disco local).  
Hostname: `https://files-colman.imedic.com.ar`  
Empresa: `102`

| Qué | Cómo arranca solo |
|-----|-------------------|
| `cloudflared` | Servicio Windows `start=auto` + restart on failure |
| File server | Tarea `iMedic File Server` (al loguearse el usuario + cada 5 min) |

## En la PC de Colman (Administrador) — una sola vez

1. Copiá a la PC remota: `Instalar-Colman-UnaVez.ps1`
2. Si los adjuntos **no** están en `E:\imedic\adjuntos`, editá `$UncRoot` y `$LocalRoot` al inicio del `.ps1`
3. Creá la carpeta si no existe: `E:\imedic\adjuntos`
4. PowerShell **como Administrador**:

```powershell
Set-ExecutionPolicy Bypass -Scope Process -Force
.\Instalar-Colman-UnaVez.ps1
```

Health local esperado: `http://127.0.0.1:9012/health` → `encoding=ps1-unc-v2`, `status=ok`.

URL pública: `https://files-colman.imedic.com.ar/health`

## FileServerUrl (desde tu repo / Super Admin)

```bash
node scripts/tunnel/set-fileserver-url.js --empresa 102 --url https://files-colman.imedic.com.ar
```

O en Super Admin → Empresas → Colman → `FileServerUrl`.

## DNS (si el hostname no resuelve)

El túnel ya existe (`imedic-colman`). Si falta el CNAME:

```
files-colman  CNAME  65dd0c4b-319e-41ed-9f8e-e4bbf0770733.cfargotunnel.com  (proxied)
```

O desde el repo:

```bash
node scripts/cloudflare/cf-setup.js clinica colman --root "C:\imedic\adjuntos" --aplicar
```

## Verificar autoarranque

```powershell
Get-Service cloudflared
Get-ScheduledTask -TaskName 'iMedic File Server'
```

Tras reiniciar: logueate (el file server usa el usuario interactivo para UNC) y comprobá de nuevo el `/health`.
