# Publicar text en Railway (24/7)

El proyecto de Railway tendra dos servicios: **MySQL** (la base de datos) y **text** (el servidor, desplegado desde GitHub).

## 1. Subir el codigo a GitHub

    git add .
    git commit -m "Preparar despliegue en Railway"
    git push

Deben subirse `Dockerfile`, `.dockerignore`, `package.json` y `package-lock.json`. No debe subirse `.env`.

## 2. Servicio del servidor

1. En tu proyecto de Railway: **+ New -> GitHub Repo** y elige el repositorio de text.
2. Railway detecta el `Dockerfile` y construye la imagen (incluye FFmpeg).

## 3. Variables del servidor

En el servicio **text** -> **Variables** -> **Raw Editor**, pega esto. Cambia `MySQL` por el nombre exacto que muestra tu servicio de base de datos:

    MYSQLHOST=${{MySQL.MYSQLHOST}}
    MYSQLPORT=${{MySQL.MYSQLPORT}}
    MYSQLUSER=${{MySQL.MYSQLUSER}}
    MYSQLPASSWORD=${{MySQL.MYSQLPASSWORD}}
    MYSQLDATABASE=${{MySQL.MYSQLDATABASE}}
    JWT_SECRET=PEGA_UNA_CLAVE_NUEVA_LARGA
    UPLOAD_DIR=/data/uploads
    TMP_DIR=/data/tmp
    SHOW_CODES_IN_LOGS=true

No definas `PORT`: Railway lo pone solo. Las tablas se crean solas al arrancar.

## 4. Volumen para fotos y videos

Clic derecho en el lienzo del proyecto -> **Volume** -> conectalo al servicio **text** y usa como mount path `/data`.
Sin volumen, las fotos y videos se pierden en cada despliegue.

## 5. Dominio publico

Servicio **text** -> **Settings -> Networking -> Generate Domain**. Copia la direccion `https://...up.railway.app`
y agregala como variable `APP_URL`. Redespliega.

## 6. Comprobar

- `https://TU-DOMINIO/api/health` debe responder `{"ok":true,"db":"conectada"}`
- `https://TU-DOMINIO/app` abre la app.
- Con `SHOW_CODES_IN_LOGS=true` el codigo de verificacion aparece en **Deploy Logs**.

## 7. Correos reales (obligatorio antes de abrirla a otras personas)

Railway Hobby bloquea SMTP, asi que se usa la API HTTPS de Brevo (plan gratis: 300 correos al dia):

1. Crea una cuenta en brevo.com.
2. **Senders**: agrega y verifica tu correo remitente.
3. **SMTP & API -> API Keys**: crea una clave.
4. En Railway agrega `BREVO_API_KEY`, `MAIL_FROM_EMAIL` (el remitente verificado) y `MAIL_FROM_NAME=text`.
5. **Borra** `SHOW_CODES_IN_LOGS`. Redespliega y prueba un registro con un correo real.

## 8. Despues

- Quita el acceso publico del servicio MySQL (ya no hace falta, el servidor usa la red privada).
- Cambia las claves que hayas compartido por error.
- Activa los backups del volumen y de la base de datos.
