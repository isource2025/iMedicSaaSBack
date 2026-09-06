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

Health esperado: `encoding=ps1-unc-v1`, `uncReachable=true`.

**Importante:** el file server corre como el usuario que instaló (acceso al share UNC). SYSTEM no sirve para `\\server\...`.
