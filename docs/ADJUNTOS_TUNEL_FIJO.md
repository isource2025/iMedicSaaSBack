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

## Puesta en marcha del dominio (una vez, no por clínica)

1. En [dash.cloudflare.com](https://dash.cloudflare.com) → **Add a site** →
   `imedic.com.ar` → plan Free. Cloudflare devuelve dos nameservers.
2. En [nic.ar](https://nic.ar) → Mis dominios → `imedic.com.ar` →
   **Delegaciones** → reemplazar por esos dos nameservers. Tarda entre unos
   minutos y 24 h en propagar.
3. Crear un API token en
   [profile/api-tokens](https://dash.cloudflare.com/profile/api-tokens) con
   permiso **Zone → DNS → Edit** sobre la zona.
4. Cargar los registros de la aplicación:

```powershell
$env:CF_API_TOKEN = "el-token"
$env:API_CNAME    = "imedicsaasback-production.up.railway.app"  # el de Railway
node scripts/cloudflare/configurar-dominio.js            # simula
node scripts/cloudflare/configurar-dominio.js --aplicar  # escribe
```

El script es idempotente y muestra el estado de la zona, los nameservers que
espera Cloudflare y los `files-*` que ya existen.

5. En Vercel, agregar `imedic.com.ar`, `www` y `app` como dominios del
   proyecto.

---

## Alta de una clínica

En la PC de la clínica (la que tiene el disco con los adjuntos), con el repo
`iMedicSaaSBack` clonado y Node instalado, **como Administrador**:

```powershell
cd C:\iMedic\iMedicSaaSBack
.\scripts\tunnel\Instalar-Clinica.ps1 -Clinica sarmiento -Root "E:\adjuntos"
```

Con token compartido (recomendado en cuanto se pueda):

```powershell
.\scripts\tunnel\Instalar-Clinica.ps1 -Clinica sarmiento -Root "E:\adjuntos" -Token "un-secreto-largo"
```

El script:

1. Instala `cloudflared` si falta.
2. Abre el navegador una vez para autorizar el dominio (`tunnel login`).
3. Crea el túnel `imedic-sarmiento` y guarda sus credenciales en
   `C:\ProgramData\Cloudflare\cloudflared\` (no en el perfil del usuario: el
   servicio corre como `LocalSystem` y no ve `%USERPROFILE%`).
4. Apunta `files-sarmiento.imedic.com.ar` al túnel.
5. Instala `cloudflared` como servicio con arranque automático y reinicio ante
   falla.
6. Registra el file server como tarea de sistema al arranque, con un reintento
   cada 5 minutos por si el proceso muere.
7. Verifica el health local y el público.

Es idempotente: si algo quedó mal, se vuelve a correr.

### Único paso manual

Super Admin → Empresas → la clínica → **FileServerUrl**:

```
https://files-sarmiento.imedic.com.ar
```

Se carga una vez y no se toca más. Si se usó `-Token`, la misma cadena va en
Railway como `FILE_SERVER_TOKEN`.

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

```powershell
.\scripts\tunnel\Estado.ps1
```

Chequea configuración, carpeta, servicio `cloudflared`, tarea del file server,
puerto local y hostname público, e indica qué comando corregir en cada caso.

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
