const supabase = require('../config/supabase')
const xlsx = require('xlsx')
const QRCode = require('qrcode')
const { Resend } = require('resend')

const resend = new Resend(process.env.RESEND_API_KEY)

const importarInvitados = async (req, res) => {
  const { id: evento_id } = req.params

  if (!req.file) {
    return res.status(400).json({ error: 'No se recibió ningún archivo Excel' })
  }

  try {
    const { data: evento, error: errorEvento } = await supabase
      .from('eventos')
      .select('*')
      .eq('id', evento_id)
      .single()

    if (errorEvento || !evento) {
      return res.status(404).json({ error: 'Evento no encontrado' })
    }

    const workbook = xlsx.read(req.file.buffer, { type: 'buffer' })
    const hoja = workbook.Sheets[workbook.SheetNames[0]]
    const filas = xlsx.utils.sheet_to_json(hoja)

    if (filas.length === 0) {
      return res.status(400).json({ error: 'El archivo Excel está vacío' })
    }

    const errores = []
    const invitadosValidos = []

    filas.forEach((fila, index) => {
      const numero = index + 2
      if (!fila.nombre) errores.push(`Fila ${numero}: falta el nombre`)
      else if (!fila.apellido) errores.push(`Fila ${numero}: falta el apellido`)
      else if (!fila.dni) errores.push(`Fila ${numero}: falta el DNI`)
      else if (!fila.email) errores.push(`Fila ${numero}: falta el email`)
      else {
        invitadosValidos.push({
          evento_id,
          nombre: String(fila.nombre).trim(),
          apellido: String(fila.apellido).trim(),
          dni: String(fila.dni).trim(),
          email: String(fila.email).trim().toLowerCase()
        })
      }
    })

    if (errores.length > 0) {
      return res.status(400).json({ error: 'Errores en el archivo', detalle: errores })
    }

    const { data: existentes } = await supabase
      .from('invitados')
      .select('dni')
      .eq('evento_id', evento_id)

    const dnisExistentes = new Set((existentes || []).map(i => String(i.dni).trim()))
    const invitadosNuevos = invitadosValidos.filter(inv => !dnisExistentes.has(String(inv.dni).trim()))

    if (invitadosNuevos.length === 0) {
      return res.status(400).json({ error: 'Todos los invitados del archivo ya están cargados en este evento' })
    }

    const { data: invitadosCreados, error: errorInsert } = await supabase
      .from('invitados')
      .insert(invitadosNuevos)
      .select()

    if (errorInsert) throw errorInsert

    const resultados = []
    for (const invitado of invitadosCreados) {
      try {
        const qrBase64 = await QRCode.toDataURL(invitado.qr_token, {
          width: 300,
          margin: 2
        })

        const qrImagen = qrBase64.replace('data:image/png;base64,', '')

        await resend.emails.send({
          from: 'Alto Belgrano <onboarding@resend.dev>',
          to: invitado.email,
          subject: `Tu invitación para ${evento.nombre_evento}`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 20px;">
              <h2 style="color: #1a3a6b;">¡Hola ${invitado.nombre}!</h2>
              <p>Estás invitado/a a <strong>${evento.nombre_evento}</strong>.</p>
              <p><strong>Fecha:</strong> ${new Date(evento.fecha + 'T12:00:00').toLocaleDateString('es-AR', { day: '2-digit', month: 'long', year: 'numeric' })}</p>
              <p>Presentá este código QR en la entrada del evento:</p>
              <div style="text-align: center; margin: 30px 0;">
                <img src="cid:qr-code" alt="Código QR" width="250"/>
              </div>
              <p style="color: #666; font-size: 13px;">
                Este QR es personal e intransferible. Solo puede usarse una vez.
              </p>
              <p style="color: #666; font-size: 13px;">
                Salón Alto Belgrano — Mendoza
              </p>
            </div>
          `,
          attachments: [
            {
              filename: 'qr-invitacion.png',
              content: qrImagen,
              content_id: 'qr-code'
            }
          ]
        })

        await supabase
          .from('invitados')
          .update({ qr_enviado: true })
          .eq('id', invitado.id)

        resultados.push({ email: invitado.email, estado: 'enviado' })

      } catch (errorEmail) {
        console.error(`Error enviando email a ${invitado.email}:`, errorEmail)
        resultados.push({ email: invitado.email, estado: 'error' })
      }
    }

    res.status(201).json({
      mensaje: `${invitadosCreados.length} invitados nuevos importados${invitadosValidos.length - invitadosNuevos.length > 0 ? ` (${invitadosValidos.length - invitadosNuevos.length} ya existían y fueron omitidos)` : ''}`,
      resultados
    })

  } catch (error) {
    console.error('Error al importar invitados:', error)
    res.status(500).json({ error: 'Error al procesar el archivo' })
  }
}

const listarInvitados = async (req, res) => {
  const { id: evento_id } = req.params

  try {
    const { data, error } = await supabase
      .from('invitados')
      .select('id, nombre, apellido, dni, email, qr_enviado, ingresado, fecha_ingreso')
      .eq('evento_id', evento_id)
      .order('apellido', { ascending: true })

    if (error) throw error

    res.json({ invitados: data })
  } catch (error) {
    console.error('Error al listar invitados:', error)
    res.status(500).json({ error: 'Error al obtener los invitados' })
  }
}

const eliminarInvitado = async (req, res) => {
  const { invitadoId } = req.params
  try {
    const { error } = await supabase
      .from('invitados')
      .delete()
      .eq('id', invitadoId)

    if (error) throw error
    res.json({ mensaje: 'Invitado eliminado correctamente' })
  } catch (error) {
    console.error('Error al eliminar invitado:', error)
    res.status(500).json({ error: 'Error al eliminar el invitado' })
  }
}

module.exports = { importarInvitados, listarInvitados, eliminarInvitado }