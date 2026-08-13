require('dotenv').config()

// Si falta una variable crítica queremos enterarnos al arrancar, no cuando el
// primer usuario intente loguearse en producción.
const REQUERIDAS = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_KEY',
  'JWT_SECRET',
  'RESEND_API_KEY'
]

const faltantes = REQUERIDAS.filter(clave => !process.env[clave])

if (faltantes.length > 0) {
  console.error(`[FATAL] Faltan variables de entorno: ${faltantes.join(', ')}`)
  process.exit(1)
}

// Un JWT_SECRET corto se puede romper por fuerza bruta offline y permite
// firmar tokens de admin arbitrarios. Exigimos al menos 32 caracteres.
if (process.env.JWT_SECRET.length < 32) {
  console.error('[FATAL] JWT_SECRET debe tener al menos 32 caracteres. Generá uno con: openssl rand -base64 48')
  process.exit(1)
}

const listaDeOrigenes = (valor) =>
  (valor || '').split(',').map(o => o.trim()).filter(Boolean)

module.exports = {
  entorno: process.env.NODE_ENV || 'development',
  puerto: parseInt(process.env.PORT || '3000', 10),

  supabaseUrl: process.env.SUPABASE_URL,
  supabaseServiceKey: process.env.SUPABASE_SERVICE_KEY,

  jwtSecret: process.env.JWT_SECRET,
  jwtExpiracion: process.env.JWT_EXPIRACION || '12h',

  resendApiKey: process.env.RESEND_API_KEY,
  // El dominio de pruebas de Resend solo entrega a la casilla dueña de la cuenta.
  // En producción tiene que ser un dominio propio verificado con SPF/DKIM/DMARC.
  emailRemitente: process.env.EMAIL_REMITENTE || 'Alto Belgrano <onboarding@resend.dev>',
  // Casilla real que recibe las respuestas de los invitados. Si queda vacía no
  // se manda cabecera Reply-To: mejor eso que apuntar a un buzón inexistente.
  emailRespuesta: process.env.EMAIL_RESPUESTA || null,
  // Resend en plan gratuito acepta ~2 req/s. Espaciamos los envíos para no
  // comernos un 429 en medio de una importación de 200 invitados.
  emailIntervaloMs: parseInt(process.env.EMAIL_INTERVALO_MS || '600', 10),

  // El dominio propio es el definitivo; el de Vercel se mantiene mientras el
  // personal siga usando la dirección vieja.
  corsOrigenes: listaDeOrigenes(
    process.env.CORS_ORIGENES ||
      'https://qr.altobelgrano.com.ar,https://alto-belgrano-qr.vercel.app'
  ),

  // Ventana de validez del QR, relativa al día del evento.
  qrHorasAntes: parseInt(process.env.QR_HORAS_ANTES || '12', 10),
  qrHorasDespues: parseInt(process.env.QR_HORAS_DESPUES || '24', 10),

  // Bloqueo de cuenta por intentos fallidos de login.
  loginMaxIntentos: parseInt(process.env.LOGIN_MAX_INTENTOS || '5', 10),
  loginBloqueoMinutos: parseInt(process.env.LOGIN_BLOQUEO_MINUTOS || '15', 10),

  maxArchivoBytes: parseInt(process.env.MAX_ARCHIVO_BYTES || String(5 * 1024 * 1024), 10)
}
