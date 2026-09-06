# Sarmiento — túnel fijo

Adjuntos en SQL: `C:\imedic\adjuntos\...` (disco local de la PC, **no** UNC).

| Campo | Valor |
|-------|--------|
| Clínica | `sarmiento` |
| EmpresaId | `101` |
| Carpeta | `C:\imedic\adjuntos` |
| Hostname | `https://files-sarmiento.imedic.com.ar` |

## 1) Crear túnel (desde tu PC / repo)

Hace falta `CF_API_TOKEN` con **Account → Cloudflare Tunnel → Edit**.

```bash
node scripts/cloudflare/cf-setup.js clinica sarmiento --root "C:\imedic\adjuntos" --aplicar
```

Copiá el token que imprime y pegalo en `$TunnelToken` de `Instalar-Sarmiento-UnaVez.ps1`.

## 2) En la PC de Sarmiento (Administrador)

1. Copiá `Instalar-Sarmiento-UnaVez.ps1`
2. Confirmá que existe `C:\imedic\adjuntos`
3. Corré:

```powershell
Set-ExecutionPolicy Bypass -Scope Process -Force
.\Instalar-Sarmiento-UnaVez.ps1
```

Health local esperado: `encoding=ps1-unc-v1`, `root=C:\imedic\adjuntos`.

## 3) FileServerUrl

Desde el repo:

```bash
node scripts/tunnel/set-fileserver-url.js --empresa 101 --url https://files-sarmiento.imedic.com.ar
```

(o lo graba el instalador si ponés `SaPass`).
