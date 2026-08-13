const rateLimit = require('express-rate-limit')

const respuesta = (mensaje) => (req, res) =>
  res.status(429).json({ error: mensaje })

// El login es el endpoint más atacado: sin límite, un script prueba miles de
// contraseñas por minuto. Este límite es por IP; el bloqueo por cuenta vive en
// authController y cubre el caso del atacante distribuido.
const limiteLogin = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  handler: respuesta('Demasiados intentos de inicio de sesión. Esperá 15 minutos.')
})

// Pedir un enlace de recuperación manda un email a un tercero: sin un límite
// duro, cualquiera puede bombardear la casilla de un usuario.
const limiteRecuperacion = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  handler: respuesta('Demasiadas solicitudes de recuperación. Esperá una hora.')
})

// Restablecer no manda emails a terceros, pero conviene frenar la fuerza bruta
// sobre tokens (aunque son de 256 bits y adivinarlos es inviable).
const limiteRestablecer = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  handler: respuesta('Demasiados intentos. Esperá una hora.')
})

// Techo general para toda la API: frena scraping y abuso automatizado.
const limiteGeneral = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  handler: respuesta('Demasiadas solicitudes. Intentá de nuevo en unos minutos.')
})

// Cada importación dispara decenas de emails y una lectura de archivo: más
// restrictivo que el resto.
const limiteImportacion = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  handler: respuesta('Demasiadas importaciones. Esperá una hora.')
})

// Reenviar QR manda un email por request: es un vector de spam hacia terceros.
const limiteEmail = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  handler: respuesta('Demasiados reenvíos de QR. Esperá una hora.')
})

// El escáner en la puerta hace muchas validaciones seguidas y es legítimo,
// pero conviene un techo por las dudas.
const limiteValidacion = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  handler: respuesta('Demasiadas validaciones seguidas. Esperá un momento.')
})

module.exports = {
  limiteLogin,
  limiteRecuperacion,
  limiteRestablecer,
  limiteGeneral,
  limiteImportacion,
  limiteEmail,
  limiteValidacion
}
