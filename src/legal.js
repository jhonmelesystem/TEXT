const fs = require('fs');
const path = require('path');
const express = require('express');

const router = express.Router();

// Sube este numero (variable TERMS_VERSION) cuando cambien los terminos o la politica:
// a todas las personas se les pedira aceptarlos de nuevo.
const TERMS_VERSION = Number(process.env.TERMS_VERSION) || 1;

const vars = () => ({
  VERSION: TERMS_VERSION,
  NOMBRE: process.env.LEGAL_NAME || 'el equipo de text',
  CORREO: process.env.LEGAL_EMAIL || 'soporte@ejemplo.com',
  PAIS: process.env.LEGAL_COUNTRY || 'el pais del responsable del servicio',
  EDAD: process.env.LEGAL_MIN_AGE || '16',
  FECHA: process.env.LEGAL_DATE || 'octubre de 2026'
});

if (!process.env.LEGAL_EMAIL) {
  console.warn('Aviso: define LEGAL_EMAIL (y LEGAL_NAME, LEGAL_COUNTRY) para completar los terminos y la politica.');
}

function page(file) {
  const template = fs.readFileSync(path.join(__dirname, '..', 'legal', file), 'utf8');
  return (req, res) => {
    const v = vars();
    res.type('html').send(template.replace(/\{\{(\w+)\}\}/g, (_, k) => (v[k] == null ? '' : v[k])));
  };
}

router.get('/terminos', page('terminos.html'));
router.get('/privacidad', page('privacidad.html'));

module.exports = { router, TERMS_VERSION };
