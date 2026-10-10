const nodemailer = require('nodemailer');

let transporter = null;
if (process.env.SMTP_HOST) {
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });
}

async function sendCode(email, code) {
  if (!transporter) {
    // Modo desarrollo: el codigo se ve en la terminal
    console.log(`\n[DEV] Codigo para ${email}: ${code}\n`);
    return;
  }
  await transporter.sendMail({
    from: process.env.MAIL_FROM,
    to: email,
    subject: 'Tu codigo de text',
    text: `Tu codigo de verificacion es ${code}. Vence en 10 minutos.`
  });
}

module.exports = { sendCode };
