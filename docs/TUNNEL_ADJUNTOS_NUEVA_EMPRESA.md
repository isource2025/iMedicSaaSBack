# Túnel de adjuntos — empresa nueva (como Vidal)

Un comando configura **todo**: file server iMedic, carpeta `E:\adjuntos\{visita} {PACIENTE}\`, túnel Cloudflare y `FileServerUrl` en Super Admin.

```
Railway / front
      │
      ▼
https://xxxxx.trycloudflare.com     ← esto está en Empresas.FileServerUrl
      │                               (Railway NUNCA usa la IP de la PC ni 127.0.0.1)
      ▼
http://127.0.0.1:9012               file server, SOLO en la PC de Sarmiento
      │
      ▼
E:\adjuntos\{visita} {PACIENTE}\archivo.pdf
```

`http://127.0.0.1:9012/health` OK en esa PC solo prueba el file server local. Lo que usa producción es `https://xxxx.trycloudflare.com/health`.

Esa carpeta es la misma convención que Vidal (`{numeroVisita} {APELLIDO NOMBRES}\archivo`). Si la PC no tiene disco `E:`, el script hace `subst E: C:\imedic` y usa `E:\adjuntos` igual.

Por defecto graba la URL en **Sanatorio Sarmiento** (empresa `101`). No uses la URL de Vidal. Vidal sigue con su IP propia (`181.4.71.230:3002`); Sarmiento es **solo túnel**.

---

## 0. Una sola vez

```bat
winget install --id Cloudflare.cloudflared -e
cloudflared --version
```

Hace falta Node en PATH para grabar la URL en Super Admin (si no, la pega a mano).

---

## 1. Comando (este es el que se usa)

```bat
powershell -NoProfile -ExecutionPolicy Bypass -File "C:\Users\Emiliano\Desktop\iMedic\iMedicSaaSBack\scripts\tunnel\Start-QuickTunnel.ps1"
```

O doble clic en `scripts\tunnel\arrancar-tunel.cmd`.

Qué hace:

1. Crea `E:\adjuntos` (o `subst` si no hay `E:`).
2. Mata el stub del puerto 9012 si no es el file server iMedic.
3. Arranca `start-file-server.bat` oculto.
4. Prueba upload + `/file?path=` en local.
5. Abre el túnel, espera el health **público**, copia la URL, la graba en Super Admin (Sarmiento).
6. **Cierra la consola.** File server y `cloudflared` siguen en segundo plano.

Si `127.0.0.1:9012/health` anda y el upload sigue en 530, el file server está vivo pero el túnel no: hay que volver a correr el comando (sale otra URL y se actualiza sola).

Otra empresa:

```bat
powershell -NoProfile -ExecutionPolicy Bypass -File "...\Start-QuickTunnel.ps1" -EmpresaId 102 -EmpresaMatch "otra"
```

---

## 2. Dónde queda el archivo

```
E:\adjuntos\468 APELLIDO NOMBRE\HC_Ingreso_....pdf
```

No en `C:\imedic\adjuntos\upload.bin`.

Salud del server **correcto** (tiene `"status":"ok"`):

```
https://xxxx.trycloudflare.com/health
```

Si el health no trae `"status":"ok"`, todavía está el stub: volvé a correr el comando.

URL guardada también en `%ProgramData%\iMedic\adjuntos-tunnel\url.txt`.

---

## 3. Después de reiniciar la PC

Correr de nuevo el comando del punto 1. Sale **otra** URL y el script la actualiza en Super Admin.

---

## 4. Parar

```bat
taskkill /F /IM cloudflared.exe
```
