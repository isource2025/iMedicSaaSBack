# Materno Infantil — túnel fijo (copy-paste)

Empresa: `103` · SANATORIO MATERNO INFANTIL  
Hostname: `https://files-materno.imedic.com.ar`  
Adjuntos por defecto: `D:\imedic\adjuntos`

| Qué | Auto al reiniciar |
|-----|-------------------|
| `cloudflared` | Servicio Windows `start=auto` |
| File server | Tarea `iMedic File Server` como **SYSTEM al boot** (disco `D:\`; sin iniciar sesión) |

## En la PC de Materno (Administrador) — una sola vez

1. Copiá `Instalar-Materno-UnaVez.ps1` (que no quede en 0 bytes).
2. Si la carpeta de adjuntos no es `D:\imedic\adjuntos`, editá `$UncRoot` y `$LocalRoot`.
3. Creá la carpeta si falta: `New-Item -ItemType Directory -Force -Path D:\imedic\adjuntos`
4. PowerShell **como Administrador**:

```powershell
cd C:\iSource   # o donde hayas pegado el .ps1
Unblock-File .\Instalar-Materno-UnaVez.ps1
Set-ExecutionPolicy Bypass -Scope Process -Force
powershell -NoProfile -ExecutionPolicy Bypass -File .\Instalar-Materno-UnaVez.ps1
```

Health local: `http://127.0.0.1:9012/health`  
Público: `https://files-materno.imedic.com.ar/health`

## FileServerUrl

Ya se puede dejar en Super Admin:

`https://files-materno.imedic.com.ar`

(desde repo: `node scripts/tunnel/set-fileserver-url.js --empresa 103 --url https://files-materno.imedic.com.ar`)
