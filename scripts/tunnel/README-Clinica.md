# Instalador por clínica (una vez)

Archivo: **`Instalar-Clinica-UnaVez.ps1`**

Copiá el `.ps1` a la PC de la clínica. Editá **solo** el bloque `CONFIG` al inicio:

| Campo | Ejemplo | Qué es |
|-------|---------|--------|
| `Clinica` | `vidal` | slug → `files-vidal.imedic.com.ar` |
| `EmpresaId` | `1` | IDEMPRESA en Super Admin |
| `UncRoot` | `\\server\Imagenes\Vidal` | carpeta real de adjuntos |
| `LocalRoot` | `E:\adjuntos` | fallback local |
| `TunnelToken` | `eyJ...` | token que imprime `cf-setup.js` |
| `SigningKey` | (64 hex) | clave de firma de la clínica: `node scripts/tunnel/clave-firma.js --servicio fs --empresa <id>`. Vacío = conserva la instalada o genera una (y la imprime para Railway) |
| `ExtraRoots` | `D:\Imagenes` | otras carpetas que el file server puede servir, separadas por `;` |
| `SoloFileServer` | `$true` | solo reinstala el file server (el túnel ya existe) |
| `LegacyToken` | | solo transición: el `FILE_SERVER_TOKEN` de Railway, si existe |

El file server solo sirve archivos dentro de `UncRoot`, `LocalRoot` y `ExtraRoots`, y sin credencial responde 401. Ver `docs/SEGURIDAD_MISALUD.md`.

Opcional: `SaPass` para grabar `FileServerUrl` por API; si queda vacío, se pone a mano en Super Admin.

## Antes (desde tu máquina / repo)

```bash
node scripts/cloudflare/cf-setup.js clinica <slug> --aplicar
```

Pegá el token en `TunnelToken`.

## En la PC de la clínica (Administrador)

```powershell
Set-ExecutionPolicy Bypass -Scope Process -Force
.\Instalar-Clinica-UnaVez.ps1
```

Health esperado: `encoding=ps1-unc-v2`, `uncReachable=true`.

**Arranque:** si `UncRoot` es disco local (`D:\...`), la tarea corre como **SYSTEM al boot** (sin iniciar sesión). Si es share UNC (`\\server\...`), corre como el usuario que instaló al loguearse — SYSTEM no ve la red.
