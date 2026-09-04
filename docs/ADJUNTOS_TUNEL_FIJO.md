# Adjuntos: dominio y túneles fijos

Cada clínica publica sus adjuntos en un hostname que **no cambia nunca**:

```
https://files-<clinica>.imedic.com.ar
```

Detrás hay un túnel con nombre de Cloudflare (no un Quick Tunnel) corriendo
como servicio de Windows en la PC de la clínica. Si la PC se reinicia, el
servicio vuelve solo y el hostname sigue siendo el mismo. **No hay ninguna URL
que actualizar en la base después de la instalación.**

## Estructura del dominio

| Hostname                      | Apunta a                        | Proxy CF |
| ----------------------------- | ------------------------------- | -------- |
| `imedic.com.ar`, `www`, `app` | Vercel (front)                  | no       |
| `api`                         | Railway (API central)           | no       |
| `files-vidal`                 | PC de Vidal, disco local        | sí       |
| `files-sarmiento`             | PC de Sarmiento, disco local    | sí       |

`app` y `api` van en DNS-only porque Vercel y Railway ya terminan TLS. Los
`files-*` van proxeados: los crea `cloudflared` y son la única puerta de
entrada a la PC de la clínica.

## Flujo

```
Usuario → Vercel → API (Railway) → resuelve la clínica del usuario
                                  → https://files-<clinica>.imedic.com.ar
                                  → Cloudflare
                                  → túnel permanente de esa clínica
                                  → 127.0.0.1:9012 (file server)
                                  → disco local de la clínica
```

La base guarda solo metadata (`HCAdjuntos`: nombre, tipo, ruta interna, fecha,
usuario). El archivo nunca se almacena ni se copia en Vercel ni en Railway.

---

## Los dos caminos

El alta se puede hacer de dos formas. Ninguna necesita tocar la base ni
generar URLs dinámicas; cambia solo cómo se autentica contra Cloudflare.

**Camino A — solo `cloudflared`, sin ningún API token.** Es el más simple si
no querés pelear con permisos. `cloudflared tunnel login` abre el navegador
una vez, deja un `cert.pem`, y con eso `Instalar-Clinica.ps1` crea el túnel,
apunta el DNS y escribe la config, todo por comando. Es el modo por defecto.

**Camino B — por API.** Los túneles se crean desde el repo con
`cf-setup.js`, quedan administrados por Cloudflare y en la PC de la clínica
no hay login ni config local. Requiere un API token bien scopeado.

Lo único que **ninguno** de los dos puede hacer es dar de alta el dominio en
Cloudflare por primera vez sin credenciales: eso son tres clics en el
dashboard (*Add domain* → `imedic.com.ar` → Free), o `cf-setup.js zona` si
tenés el token del camino B.

## La herramienta de Cloudflare (camino B)

`scripts/cloudflare/cf-setup.js` necesita un API token en `.env` como
`CF_API_TOKEN`, creado en
[profile/api-tokens](https://dash.cloudflare.com/profile/api-tokens) →
*Create Custom Token* con estos permisos:

| Tipo    | Permiso            | Nivel |
| ------- | ------------------ | ----- |
| Account | Cloudflare Tunnel  | Edit  |
| Account | Account Settings   | Read  |
| Zone    | Zone               | Edit  |
| Zone    | DNS                | Edit  |

Listar cuentas necesita *Account Settings → Read*; sin eso la API devuelve la
lista vacía en lugar de un 403. Si el token solo tiene permiso de túneles,
alcanza con poner `CF_ACCOUNT_ID` en `.env` (el id está en la URL del
dashboard cuando abrís un dominio: `dash.cloudflare.com/<id>/<dominio>`).

Los tres subcomandos son idempotentes y, sin `--aplicar`, solo simulan:

```powershell
node scripts/cloudflare/cf-setup.js estado              # cuenta, zona, DNS, túneles
node scripts/cloudflare/cf-setup.js zona --aplicar      # crea la zona y app/api/www
node scripts/cloudflare/cf-setup.js clinica vidal --aplicar   # crea el túnel de una clínica
```

## Puesta en marcha del dominio (una vez, no por clínica)

1. Crear la zona y los registros de la aplicación:

```powershell
$env:API_CNAME = "imedicsaasback-production.up.railway.app"  # el de Railway
node scripts/cloudflare/cf-setup.js zona --aplicar
```

El comando imprime los dos nameservers que asignó Cloudflare.

2. **Paso manual inevitable:** en [nic.ar](https://nic.ar) → Mis dominios →
   `imedic.com.ar` → **Delegaciones**, cargar esos dos nameservers. nic.ar no
   tiene API de escritura, así que esto solo se puede hacer desde el navegador.
   Tarda entre unas horas y 48 h en propagar; mientras tanto la zona figura
   como `pending`.

3. En Vercel, agregar `imedic.com.ar`, `www` y `app` como dominios del
   proyecto.

Con `cf-setup.js estado` se verifica cuándo la zona pasó a `active`.

---

## Alta de una clínica — camino A (sin API token)

En la PC de la clínica, con el repo clonado y Node instalado, **como
Administrador**:

```powershell
cd C:\iMedic\iMedicSaaSBack
.\scripts\tunnel\Instalar-Clinica.ps1 -Clinica vidal -Root "E:\adjuntos"
```

Abre el navegador una vez para que autorices `imedic.com.ar`; de ahí en
adelante no vuelve a pedir nada. Crea el túnel `imedic-vidal`, apunta
`files-vidal.imedic.com.ar`, escribe la config y deja los dos servicios
corriendo.

Las credenciales del túnel van a `C:\ProgramData\Cloudflare\cloudflared\` y
se referencian por ruta absoluta, porque el servicio corre como `LocalSystem`
y no ve `%USERPROFILE%`. Ese detalle es el que hacía fallar la instalación
después de reiniciar.

Si el dominio no aparece en la lista del navegador, todavía no está dado de
alta en Cloudflare.

## Alta de una clínica — camino B (por API)

### 1. Crear el túnel (desde acá, por API)

```powershell
node scripts/cloudflare/cf-setup.js clinica vidal --root "E:\adjuntos" --aplicar
```

Crea el túnel `imedic-vidal` como **administrado por Cloudflare**, le define
el ingress (`files-vidal.imedic.com.ar` → `http://127.0.0.1:9012`), crea el
CNAME proxeado, e imprime el comando exacto a correr en la clínica, con el
token del túnel incluido.

Que el túnel sea administrado por Cloudflare es lo que evita el login por
navegador en cada PC: la configuración del ingress vive en Cloudflare, no en
un `config.yml` local que se pueda desincronizar.

### 2. Instalar en la PC de la clínica

Con el repo `iMedicSaaSBack` clonado y Node instalado, **como Administrador**:

```powershell
cd C:\iMedic\iMedicSaaSBack
.\scripts\tunnel\Instalar-Clinica.ps1 -Clinica vidal -Root "E:\adjuntos" -TunnelToken "eyJhIjoi..."
```

No es interactivo. Instala `cloudflared` si falta, lo registra como servicio
con el token (arranque automático y reinicio ante falla), deja el file server
como tarea de sistema al arranque con reintento cada 5 minutos, y verifica el
health local y el público.

El `-TunnelToken` es una credencial: no se commitea.

Para exigir el secreto compartido, agregar `-Token "un-secreto-largo"` y poner
la misma cadena en Railway como `FILE_SERVER_TOKEN`.

### 3. Único paso en la web

Super Admin → Empresas → la clínica → **FileServerUrl**:

```
https://files-vidal.imedic.com.ar
```

Se carga una vez y no se toca más.

---

## El file server

`file-server.js`, en la raíz del repo. Escucha **solo en `127.0.0.1`**: desde
afuera se llega únicamente por el túnel, así no hay que abrir puertos en el
router de la clínica.

| Método   | Ruta                  | Qué hace                                  |
| -------- | --------------------- | ----------------------------------------- |
| `GET`    | `/health`             | Estado, carpeta, límite, modo de auth     |
| `GET`    | `/file?path=<ruta>`   | Devuelve el archivo                       |
| `POST`   | `/upload`             | `multipart/form-data`, campo `file`       |
| `DELETE` | `/file?path=<ruta>`   | Borra el archivo                          |

Variables (las setea el instalador en el entorno de la máquina):

| Variable          | Default        | Para qué                                    |
| ----------------- | -------------- | ------------------------------------------- |
| `IMEDIC_FS_PORT`  | `9012`         | Puerto de loopback                          |
| `IMEDIC_FS_ROOT`  | `E:\adjuntos`  | Carpeta de adjuntos                         |
| `IMEDIC_FS_TOKEN` | vacío          | Si está, exige el header `x-imedic-token`   |
| `IMEDIC_FS_MAX_MB`| `100`          | Tamaño máximo por archivo                   |

El límite de 100 MB es el de Cloudflare en los planes Free/Pro: subir más
falla en el borde, antes de llegar al origen.

Los archivos van a `<root>\<visita> <PACIENTE>\<archivo>`, la convención que
ya usa Clarion. Al leer, el server prueba variantes del nombre para encontrar
los archivos que las versiones viejas guardaron con la `Ñ` mal codificada.

---

## Diagnóstico

Desde la PC de la clínica:

```powershell
.\scripts\tunnel\Estado.ps1
```

Chequea configuración, carpeta, servicio `cloudflared`, tarea del file server,
puerto local y hostname público, e indica qué comando corregir en cada caso.

Desde cualquier lado, para ver si el túnel tiene conexiones activas:

```powershell
node scripts/cloudflare/cf-setup.js estado
```

Errores frecuentes:

| Síntoma                        | Causa                                          |
| ------------------------------ | ---------------------------------------------- |
| Cloudflare 530 / 1033          | La PC está apagada o sin internet              |
| 401 desde el file server       | `FILE_SERVER_TOKEN` no coincide con el de la PC |
| 413 al subir                   | El archivo pasa los 100 MB                     |
| `FileServerUrl` faltante       | No se cargó el hostname en Super Admin         |

---

## Pendiente

- **Vidal** sigue con su IP pública histórica (`181.4.71.230:3002`). Migrarla
  corriendo el instalador con `-Clinica vidal` y cambiando su `FileServerUrl`.
- **Subida directa desde el navegador.** Hoy el archivo pasa por Railway, que
  lo reenvía a la clínica. Para que vaya directo del navegador al hostname de
  la clínica hace falta que la API firme un token de subida de corta vida y
  que el file server lo valide, en lugar del secreto compartido.
