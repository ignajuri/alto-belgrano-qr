const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/

const PASSWORD_MIN = 10
const PASSWORD_MAX = 128

const esUuid = (valor) => typeof valor === 'string' && UUID_RE.test(valor)

const esEmailValido = (valor) =>
  typeof valor === 'string' && valor.length <= 255 && EMAIL_RE.test(valor)

const normalizarEmail = (valor) => String(valor || '').trim().toLowerCase()

// Devuelve null si está bien, o el mensaje de error si no.
const validarPassword = (password) => {
  if (typeof password !== 'string') return 'La contraseña es inválida'
  if (password.length < PASSWORD_MIN) return `La contraseña debe tener al menos ${PASSWORD_MIN} caracteres`
  if (password.length > PASSWORD_MAX) return `La contraseña no puede superar los ${PASSWORD_MAX} caracteres`
  if (!/[a-zA-Z]/.test(password)) return 'La contraseña debe incluir al menos una letra'
  if (!/[0-9]/.test(password)) return 'La contraseña debe incluir al menos un número'
  return null
}

// Corta y limpia strings que van a la base de datos.
const texto = (valor, max = 255) => String(valor ?? '').trim().slice(0, max)

const esFechaValida = (valor) => {
  if (typeof valor !== 'string' || !FECHA_RE.test(valor)) return false
  const d = new Date(valor + 'T12:00:00Z')
  return !Number.isNaN(d.getTime())
}

// Los DNI argentinos son numéricos; aceptamos puntos y espacios y los limpiamos.
const normalizarDni = (valor) => String(valor ?? '').replace(/[.\s-]/g, '').trim()

const esDniValido = (valor) => /^\d{6,10}$/.test(valor)

const enteroPositivo = (valor, max = 100000) => {
  const n = parseInt(valor, 10)
  if (Number.isNaN(n) || n < 1 || n > max) return null
  return n
}

module.exports = {
  esUuid,
  esEmailValido,
  normalizarEmail,
  validarPassword,
  texto,
  esFechaValida,
  normalizarDni,
  esDniValido,
  enteroPositivo,
  PASSWORD_MIN
}
