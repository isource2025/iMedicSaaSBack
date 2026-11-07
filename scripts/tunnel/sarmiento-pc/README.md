# Sarmiento — túneles fijos

## Adjuntos

Adjuntos en SQL: `C:\imedic\adjuntos\...` (disco local de la PC, **no** UNC).

| Campo | Valor |
|-------|--------|
| Clínica | `sarmiento` |
| EmpresaId | `101` |
| Carpeta | `C:\imedic\adjuntos` |
| Hostname | `https://files-sarmiento.imedic.com.ar` |

### 1) Crear túnel adjuntos (desde tu PC / repo)

```bash
node scripts/cloudflare/cf-setup.js clinica sarmiento --root "C:\imedic\adjuntos" --aplicar
```

### 2) FileServerUrl

```bash
node scripts/tunnel/set-fileserver-url.js --empresa 101 --url https://files-sarmiento.imedic.com.ar
```

---

## PACS / tomógrafo (ClearCanvas)

El bridge corre en la **PC del tomógrafo** (`192.168.1.83`, PowerShell 2.0, sin cloudflared).
El túnel es el **mismo `imedic-sarmiento`** de adjuntos, con un public hostname extra.
Estado y pasos pendientes: [`docs/PACS_HANDOFF_PROMPT.md`](../../../docs/PACS_HANDOFF_PROMPT.md).

| Campo | Valor |
|-------|--------|
| Hostname | `https://pacs-sarmiento.imedic.com.ar` |
| Túnel | `imedic-sarmiento` (existente) → `http://192.168.1.83:9013` |
| Bridge | `Instalar-Solo-Bridge-Pacs.ps1` → `http://+:9013` → SQL `localhost\SQLCC` (auth Windows) + `D:\FS` |
| AE Title local | `SARMIENTO_PACS` :104 (solo LAN / tomógrafo) |

### Una sola vez en la PC del tomógrafo (Administrador)

1. Abrí Notepad, pegá `Instalar-Solo-Bridge-Pacs.ps1` y guardalo en el Escritorio
   (tipo "Todos los archivos").
2. Corré:

```powershell
powershell -ExecutionPolicy Bypass -File "$env:USERPROFILE\Desktop\Instalar-Solo-Bridge-Pacs.ps1"
```

### En Cloudflare

Zero Trust → Tunnels → `imedic-sarmiento` → Public Hostname → `pacs-sarmiento.imedic.com.ar`
→ `HTTP 192.168.1.83:9013` (sin tocar `files-sarmiento`).

### PacsUrl

Desde tu PC:

```bash
node scripts/tunnel/set-pacs-url.js --empresa 101 --url https://pacs-sarmiento.imedic.com.ar
```
