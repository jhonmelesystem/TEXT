const nodemailer = require('nodemailer');

// Opcion SMTP (funciona en tu PC o en planes de Railway que permiten SMTP)
let smtp = null;
if (process.env.SMTP_HOST) {
  smtp = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });
}

// Opcion API HTTPS de Brevo (necesaria en Railway Hobby, que bloquea SMTP)
async function viaBrevo(email, code) {
  if (!process.env.MAIL_FROM_EMAIL) throw new Error('Falta MAIL_FROM_EMAIL (el remitente verificado en Brevo)');
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': process.env.BREVO_API_KEY,
      'content-type': 'application/json',
      accept: 'application/json'
    },
    body: JSON.stringify({
      sender: { name: process.env.MAIL_FROM_NAME || 'text', email: process.env.MAIL_FROM_EMAIL },
      to: [{ email }],
      subject: 'Tu codigo de text',
      textContent: `Tu codigo de verificacion es ${code}. Vence en 10 minutos. Si no lo pediste, ignora este mensaje.`
    }),
    signal: AbortSignal.timeout(15000)
  });
  if (!res.ok) throw new Error(`Brevo respondio ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

async function sendCode(email, code) {
  if (process.env.BREVO_API_KEY) return viaBrevo(email, code);
  if (smtp) {
    return smtp.sendMail({
      from: process.env.MAIL_FROM,
      to: email,
      subject: 'Tu codigo de text',
      text: `Tu codigo de verificacion es ${code}. Vence en 10 minutos.`
    });
  }
  // Sin proveedor de correo: el codigo solo se muestra en desarrollo
  // (o en produccion si pones SHOW_CODES_IN_LOGS=true, solo para pruebas)
  if (process.env.NODE_ENV !== 'production' || process.env.SHOW_CODES_IN_LOGS === 'true') {
    console.log(`\n[DEV] Codigo para ${email}: ${code}\n`);
    return;
  }
  throw new Error('No hay proveedor de correo configurado (define BREVO_API_KEY)');
}

module.exports = { sendCode };
