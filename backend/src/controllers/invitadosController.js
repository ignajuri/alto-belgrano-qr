const supabase = require('../config/supabase')
const { leerInvitados } = require('../services/excelService')
const { enviarInvitacion, enviarInvitacionesEnLote } = require('../services/emailService')
const { registrar, ACCIONES } = require('../utils/auditoria')
const { esUuid } = require('../utils/validacion')

const importarInvitados = async (req, res) => {
  const { id: evento_id } = req.params

  if (!esUuid(evento_id)) {
    return res.status(400).json({ error: 'Identificador de evento inválido' })
  }

  if (!req.file) {
    return res.status(400).json({ error: 'No se recibió ningún archivo Excel' })
  }

  try {
    const { data: evento } = await supabase
      .from('eventos')
      .select('id, nombre_evento, fecha, limite_invitados')
      .eq('id', evento_id)
      .maybeSingle()

    if (!evento) {
      return res.status(404).json({ error: 'Evento no encontrado' })
    }

    const { invitados, errores, totalErrores, error: errorLectura } = await leerInvitados(req.file.buffer)

    if (errorLectura) {
      return res.status(400).json({ error: errorLectura })
    }

    if (totalErrores > 0) {
      return res.status(400).json({
        error: `El archivo tiene ${totalErrores} error(es)`,
        detalle: errores
      })
    }

    if (invitados.length === 0) {
      return res.status(400).json({ error: 'El archivo no contiene invitados válidos' })
    }

    const { data: existentes } = await supabase
      .from('invitados')
      .select('dni')
      .eq('evento_id', evento_id)

    const dnisExistentes = new Set((existentes || []).map(i => String(i.dni).trim()))
    const nuevos = invitados
      .filter(inv => !dnisExistentes.has(inv.dni))
      .map(inv => ({ ...inv, evento_id }))

    if (nuevos.length === 0) {
      return res.status(400).json({ error: 'Todos los invitados del archivo ya están cargados en este evento' })
    }

    // El límite de invitados del evento se respeta de verdad, no es solo
    // informativo: evita cargas accidentales que excedan la capacidad del salón.
    const totalResultante = dnisExistentes.size + nuevos.length
    if (totalResultante > evento.limite_invitados) {
      return res.status(400).json({
        error: `La importación superaría el límite del evento (${evento.limite_invitados}). ` +
               `Ya hay ${dnisExistentes.size} invitados y estás agregando ${nuevos.length}.`
      })
    }

    const { data: creados, error: errorInsert } = await supabase
      .from('invitados')
      .insert(nuevos)
      .select('id, nombre, email, qr_token')

    if (errorInsert) throw errorInsert

    await registrar(req, ACCIONES.INVITADOS_IMPORTADOS, {
      entidad: 'eventos',
      entidadId: evento_id,
      detalle: { cantidad: creados.length, omitidos: invitados.length - nuevos.length }
    })

    // Los correos salen en segundo plano: la respuesta no espera a Resend.
    // El frontend refresca la lista y ve cómo se van marcando como enviados.
    enviarInvitacionesEnLote(creados, evento).catch(err =>
      console.error('[email] el lote falló por completo:', err.message)
    )

    const omitidos = invitados.length - nuevos.length
    res.status(201).json({
      mensaje: `${creados.length} invitados importados` +
               (omitidos > 0 ? ` (${omitidos} ya existían y fueron omitidos)` : '') +
               '. Los QR se están enviando por email.',
      importados: creados.length,
      omitidos
    })

  } catch (error) {
    console.error('Error al importar invitados:', error)
    res.status(500).json({ error: 'Error al procesar el archivo' })
  }
}

const reenviarQR = async (req, res) => {
  const { id: evento_id, invitadoId } = req.params

  if (!esUuid(evento_id) || !esUuid(invitadoId)) {
    return res.status(400).json({ error: 'Identificador inválido' })
  }

  try {
    // El filtro por evento_id, además del id, evita que un identificador de
    // otro evento se cuele por esta ruta.
    const { data: invitado } = await supabase
      .from('invitados')
      .select('id, nombre, email, qr_token')
      .eq('id', invitadoId)
      .eq('evento_id', evento_id)
      .maybeSingle()

    if (!invitado) {
      return res.status(404).json({ error: 'Invitado no encontrado' })
    }

    const { data: evento } = await supabase
      .from('eventos')
      .select('id, nombre_evento, fecha')
      .eq('id', evento_id)
      .maybeSingle()

    if (!evento) {
      return res.status(404).json({ error: 'Evento no encontrado' })
    }

    await enviarInvitacion(invitado, evento)

    await registrar(req, ACCIONES.QR_REENVIADO, {
      entidad: 'invitados', entidadId: invitadoId, detalle: { evento_id }
    })

    res.json({ mensaje: `QR reenviado correctamente a ${invitado.email}` })

  } catch (error) {
    console.error('Error al reenviar QR:', error)
    res.status(500).json({ error: 'Error al reenviar el QR' })
  }
}

const listarInvitados = async (req, res) => {
  const { id: evento_id } = req.params

  if (!esUuid(evento_id)) {
    return res.status(400).json({ error: 'Identificador de evento inválido' })
  }

  try {
    // qr_token queda deliberadamente fuera del select: es la credencial de
    // acceso y no tiene por qué viajar al navegador ni quedar en su memoria.
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
  const { id: evento_id, invitadoId } = req.params

  if (!esUuid(evento_id) || !esUuid(invitadoId)) {
    return res.status(400).json({ error: 'Identificador inválido' })
  }

  try {
    const { data: eliminados, error } = await supabase
      .from('invitados')
      .delete()
      .eq('id', invitadoId)
      .eq('evento_id', evento_id)
      .select('id')

    if (error) throw error

    if (!eliminados || eliminados.length === 0) {
      return res.status(404).json({ error: 'Invitado no encontrado' })
    }

    await registrar(req, ACCIONES.INVITADO_ELIMINADO, {
      entidad: 'invitados', entidadId: invitadoId, detalle: { evento_id }
    })

    res.json({ mensaje: 'Invitado eliminado correctamente' })
  } catch (error) {
    console.error('Error al eliminar invitado:', error)
    res.status(500).json({ error: 'Error al eliminar el invitado' })
  }
}

module.exports = { importarInvitados, reenviarQR, listarInvitados, eliminarInvitado }
