# Vidal — túnel fijo (copiar esta carpeta a la PC)

Igual que el Quick Tunnel viejo: **doble clic en `arrancar-tunel.cmd`**.

Queda:

- hostname fijo `https://files-vidal.imedic.com.ar` (no cambia más)
- `cloudflared` como servicio de Windows
- file server en `E:\adjuntos` (127.0.0.1:9012)
- `FileServerUrl` en Super Admin (empresa 1)

## Cómo usarlo

1. En la PC de Vidal, tené el repo `iMedicSaaSBack` (con `git pull`).
2. Copiá toda la carpeta `scripts\tunnel\vidal-pc\` (incluye `tunnel-token.txt`).
3. Doble clic en **`arrancar-tunel.cmd`** (pide Administrador).
4. Cuando termine, listo. No hace falta volver a correrlo al reiniciar.

## Si no hay disco E:

```bat
powershell -NoProfile -ExecutionPolicy Bypass -File Start-NamedTunnel.ps1 -Root "D:\adjuntos"
```

`tunnel-token.txt` es secreto: no lo subas a git ni lo pegues en un chat.
