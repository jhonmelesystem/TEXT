# text

App de mensajeria ligera: registro con correo, contactos por ID, enlace o QR,
chat en tiempo real, fotos y videos cortos (hasta 60 s), fondos de chat y bloqueo con PIN.

## Requisitos

- Node.js 20 o superior
- MySQL 8
- FFmpeg (para los videos): https://www.gyan.dev/ffmpeg/builds/

## Instalacion

1. `npm install`
2. Crea la base de datos: ejecuta `database/schema.sql` en MySQL Workbench.
3. Copia `.env.example` como `.env` y rellena tus datos (contrasena de MySQL y `JWT_SECRET`).
4. `npm run dev`
5. Abre http://localhost:3000

En desarrollo, el codigo de verificacion del correo aparece en la terminal del servidor.

## Estructura

- `src/` servidor (Express, Socket.IO, MySQL)
- `public/app/` la app (HTML, CSS y JS sin librerias)
- `public/index.html` pagina de prueba del chat (`/test`)
- `database/schema.sql` tablas de MySQL
- `*.http` pruebas de la API con la extension REST Client de VS Code

## Estado

Hecho: registro por correo, contactos, chat en tiempo real, imagenes, videos, personalizacion, QR y PIN.
Pendiente: empaquetar para Android e iOS (Capacitor), notificaciones push, HTTPS y publicacion.
