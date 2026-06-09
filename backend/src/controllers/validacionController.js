const supabase = require('../config/supabase')

const validarQR = async (req, res) => {
  const { token } = req.body

  if (!token) {
    return res.status(400).json({ error: 'Token requerido' })
  }

  try {
    // Buscar el invitado por su qr_token
    const { data: invitado, error } = await supabase
      .from('invitados')
      .select('*, eventos(nombre_evento, fecha)')
      .eq('qr_token', token)
      .single()

    if (error || !invitado) {
      return res.status(404).json({
        valido: false,
        motivo: 'QR no reconocido',
        color: 'rojo'
      })
    }

    // Verificar si ya ingresó
    if (invitado.ingresado) {
      return res.status(200).json({
        valido: false,
        motivo: 'Este QR ya fue utilizado',
        color: 'rojo',
        detalle: {
          nombre: invitado.nombre,
          apellido: invitado.apellido,
          fecha_ingreso: invitado.fecha_ingreso
        }
      })
    }

    // Registrar el ingreso
    const ahora = new Date().toISOString()
    await supabase
      .from('invitados')
      .update({
        ingresado: true,
        fecha_ingreso: ahora,
        validado_por: req.usuario.id
      })
      .eq('id', invitado.id)

    return res.status(200).json({
      valido: true,
      motivo: 'Acceso autorizado',
      color: 'verde',
      detalle: {
        nombre: invitado.nombre,
        apellido: invitado.apellido,
        dni: invitado.dni,
        evento: invitado.eventos.nombre_evento
      }
    })

  } catch (error) {
    console.error('Error al validar QR:', error)
    res.status(500).json({ error: 'Error al validar el código QR' })
  }
}

module.exports = { validarQR }