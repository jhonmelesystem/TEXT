const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.MAIL_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.MAIL_PORT || '465'),
  secure: process.env.MAIL_PORT === '465', // true para puerto 465
  auth: {
    user: process.env.MAIL_USER,
    pass: process.env.MAIL_PASS,
  },
});

async function sendCode(to, code) {
  // Si tienes activado SHOW_CODES_IN_LOGS, también podemos imprimirlo por seguridad en la consola
  if (process.env.SHOW_CODES_IN_LOGS === 'true' || process.env.SHOW_CODES_IN_LOGS === '1') {
    console.log(`[DEBUG] Código para ${to}: ${code}`);
  }

  const mailOptions = {
    from: process.env.MAIL_FROM || process.env.MAIL_USER,
    to: to,
    subject: 'Tu código de verificación',
    text: `Tu código de verificación es: ${code}`,
    html: `<div style="font-family: Arial, sans-serif; padding: 20px;">
             <h2>Tu código de verificación</h2>
             <p>Usa el siguiente código para completar tu registro:</p>
             <h1 style="color: #4F46E5; letter-spacing: 4px;">${code}</h1>
           </div>`,
  };

  return await transporter.sendMail(mailOptions);
}

module.exports = { sendCode };
