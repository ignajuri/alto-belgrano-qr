const config = require('../config/env')

// Argentina no tiene horario de verano: UTC-3 fijo.
const OFFSET_AR = '-03:00'

// Un QR emitido con meses de anticipación no debe servir para entrar a un
// evento anterior. La ventana va desde N horas antes del inicio del día del
// evento hasta M horas después de su fin.
const calcularVentana = (fechaEvento) => {
  const inicioDia = new Date(`${fechaEvento}T00:00:00${OFFSET_AR}`)
  const finDia = new Date(`${fechaEvento}T23:59:59${OFFSET_AR}`)

  return {
    desde: new Date(inicioDia.getTime() - config.qrHorasAntes * 60 * 60 * 1000),
    hasta: new Date(finDia.getTime() + config.qrHorasDespues * 60 * 60 * 1000)
  }
}

// Devuelve null si el QR está dentro de la ventana, o el motivo del rechazo.
const evaluarVentana = (fechaEvento, ahora = new Date()) => {
  if (!fechaEvento) return 'El evento no tiene fecha asignada'

  const { desde, hasta } = calcularVentana(fechaEvento)

  if (Number.isNaN(desde.getTime())) return 'La fecha del evento es inválida'
  if (ahora < desde) return 'Este QR todavía no es válido'
  if (ahora > hasta) return 'Este QR ha expirado'

  return null
}

module.exports = { calcularVentana, evaluarVentana }
