const supabase = require('../config/supabase')
const { leerInvitados } = require('../services/excelService')
const { enviarInvitacion, enviarInvitacionesEnLote } = require('../services/emailService')
const { registrar, ACCIONES } = require('../utils/auditoria')
const {
  esUuid, texto, normalizarEmail, esEmailValido, normalizarDni, esDniValido
} = require('../utils/validacion')

// Postgres devuelve este código cuando se viola un índice único. Acá solo puede
// ser el de (evento_id, dni) que crea la migración 001.
const COD_DUPLICADO = '23505'

// Valida y normaliza los datos de un invitado cargado a mano. Aplica las mismas
// reglas que el importador de Excel para que no haya dos criterios distintos
// según por dónde entre el dato.
const parsearInvitado = (body) => {
  const nombre = texto(body?.nombre, 120)
  const apellido = texto(body?.apellido, 120)
  const dni = normalizarDni(body?.dni)
  const email = normalizarEmail(body?.email)

  if (!nombre) return { error: 'El nombre es obligatorio' }
  if (!apellido) return { error: 'El apellido es obligatorio' }
  if (!dni) return { error: 'El DNI es obligatorio' }
  if (!esDniValido(dni)) return { error: `El DNI "${dni}" no es válido: tiene que ser numérico, de 6 a 10 dígitos` }
  if (!email) return { error: 'El email es obligatorio' }
  if (!esEmailValido(email)) return { error: `El email "${email}" no tiene un formato válido` }

  return { datos: { nombre, apellido, dni, email } }
}

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

// Alta manual de un invitado suelto, para el que se sumó después de importar
// la lista. A diferencia de la importación, el email sale en el momento: es uno
// solo y el administrador quiere saber ahí mismo si salió bien.
const crearInvitado = async (req, res) => {
  const { id: evento_id } = req.params

  if (!esUuid(evento_id)) {
    return res.status(400).json({ error: 'Identificador de evento inválido' })
  }

  const { datos, error: errorValidacion } = parsearInvitado(req.body)
  if (errorValidacion) return res.status(400).json({ error: errorValidacion })

  try {
    const { data: evento } = await supabase
      .from('eventos')
      .select('id, nombre_evento, fecha, limite_invitados, datos_purgados_en')
      .eq('id', evento_id)
      .maybeSingle()

    if (!evento) {
      return res.status(404).json({ error: 'Evento no encontrado' })
    }

    // Un evento ya purgado no admite datos personales nuevos: sus invitados se
    // borraron por política de retención y volver a cargarlos contradice eso.
    if (evento.datos_purgados_en) {
      return res.status(400).json({
        error: 'Este evento ya pasó y sus datos personales fueron eliminados. No se pueden agregar invitados.'
      })
    }

    const { count } = await supabase
      .from('invitados')
      .select('id', { count: 'exact', head: true })
      .eq('evento_id', evento_id)

    if ((count || 0) >= evento.limite_invitados) {
      return res.status(400).json({
        error: `El evento ya alcanzó su límite de ${evento.limite_invitados} invitados.`
      })
    }

    const { data: creado, error } = await supabase
      .from('invitados')
      .insert([{ ...datos, evento_id }])
      .select('id, nombre, apellido, dni, email, qr_token, qr_enviado, ingresado, fecha_ingreso')
      .single()

    if (error) {
      if (error.code === COD_DUPLICADO) {
        return res.status(409).json({ error: `Ya hay un invitado con el DNI ${datos.dni} en este evento` })
      }
      throw error
    }

    await registrar(req, ACCIONES.INVITADO_CREADO, {
      entidad: 'invitados', entidadId: creado.id, detalle: { evento_id }
    })

    // El invitado ya está cargado: si el mail falla, no deshacemos el alta.
    // Se informa y queda el botón de reenviar para reintentar.
    let qrEnviado = true
    try {
      await enviarInvitacion(creado, evento)
    } catch (errorEmail) {
      qrEnviado = false
      console.error(`[email] falló el envío al invitado ${creado.id}: ${errorEmail.message}`)
    }

    const { qr_token, ...invitadoPublico } = creado
    res.status(201).json({
      mensaje: qrEnviado
        ? `${datos.nombre} ${datos.apellido} fue agregado y su QR salió por email.`
        : `${datos.nombre} ${datos.apellido} fue agregado, pero falló el envío del QR. Usá el botón de reenviar.`,
      invitado: { ...invitadoPublico, qr_enviado: qrEnviado }
    })

  } catch (error) {
    console.error('Error al crear invitado:', error)
    res.status(500).json({ error: 'Error al agregar el invitado' })
  }
}

// Corrección de datos mal cargados. Nunca regenera el qr_token: el código que
// el invitado ya tiene en su casilla tiene que seguir sirviendo.
const editarInvitado = async (req, res) => {
  const { id: evento_id, invitadoId } = req.params

  if (!esUuid(evento_id) || !esUuid(invitadoId)) {
    return res.status(400).json({ error: 'Identificador inválido' })
  }

  const { datos, error: errorValidacion } = parsearInvitado(req.body)
  if (errorValidacion) return res.status(400).json({ error: errorValidacion })

  try {
    const { data: actual } = await supabase
      .from('invitados')
      .select('id, nombre, apellido, dni, email, qr_token, qr_enviado')
      .eq('id', invitadoId)
      .eq('evento_id', evento_id)
      .maybeSingle()

    if (!actual) {
      return res.status(404).json({ error: 'Invitado no encontrado' })
    }

    const { data: actualizado, error } = await supabase
      .from('invitados')
      .update(datos)
      .eq('id', invitadoId)
      .eq('evento_id', evento_id)
      .select('id, nombre, apellido, dni, email, qr_token, qr_enviado, ingresado, fecha_ingreso')
      .single()

    if (error) {
      if (error.code === COD_DUPLICADO) {
        return res.status(409).json({ error: `Ya hay otro invitado con el DNI ${datos.dni} en este evento` })
      }
      throw error
    }

    await registrar(req, ACCIONES.INVITADO_EDITADO, {
      entidad: 'invitados',
      entidadId: invitadoId,
      detalle: {
        evento_id,
        // Qué campos cambiaron, sin volcar los valores personales al log.
        campos: Object.keys(datos).filter(c => datos[c] !== actual[c])
      }
    })

    // Si se corrigió el email, la casilla nueva nunca recibió el QR: se reenvía
    // solo. Es justamente el caso de uso más común de esta pantalla.
    const cambioEmail = datos.email !== actual.email
    let reenviado = false

    if (cambioEmail && actual.qr_enviado) {
      try {
        const { data: evento } = await supabase
          .from('eventos')
          .select('id, nombre_evento, fecha')
          .eq('id', evento_id)
          .maybeSingle()

        if (evento) {
          await enviarInvitacion(actualizado, evento)
          reenviado = true
          await registrar(req, ACCIONES.QR_REENVIADO, {
            entidad: 'invitados', entidadId: invitadoId, detalle: { motivo: 'cambio_de_email' }
          })
        }
      } catch (errorEmail) {
        console.error(`[email] falló el reenvío al invitado ${invitadoId}: ${errorEmail.message}`)
      }
    }

    const { qr_token, ...invitadoPublico } = actualizado
    res.json({
      mensaje: cambioEmail
        ? (reenviado
            ? `Datos actualizados. El QR se reenvió a ${datos.email}.`
            : `Datos actualizados, pero falló el reenvío del QR a ${datos.email}. Usá el botón de reenviar.`)
        : 'Datos actualizados correctamente.',
      invitado: invitadoPublico
    })

  } catch (error) {
    console.error('Error al editar invitado:', error)
    res.status(500).json({ error: 'Error al actualizar el invitado' })
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

// Revierte un ingreso marcado por error. Sin esto, un QR escaneado de más
// dejaba al invitado sin forma de entrar: la única salida era borrarlo y
// re-importarlo, lo que genera un QR nuevo y reenvía el email — inservible con
// la persona esperando en la puerta.
//
// Restringido a administradores a propósito: es la operación que permitiría
// reciclar un QR para hacer entrar a dos personas con el mismo código. Que
// tenga que hacerla un admin y quede en auditoría es el control que lo evita.
const deshacerIngreso = async (req, res) => {
  const { id: evento_id, invitadoId } = req.params

  if (!esUuid(evento_id) || !esUuid(invitadoId)) {
    return res.status(400).json({ error: 'Identificador inválido' })
  }

  try {
    const { data: invitado } = await supabase
      .from('invitados')
      .select('id, nombre, apellido, ingresado, fecha_ingreso, validado_por')
      .eq('id', invitadoId)
      .eq('evento_id', evento_id)
      .maybeSingle()

    if (!invitado) {
      return res.status(404).json({ error: 'Invitado no encontrado' })
    }

    if (!invitado.ingresado) {
      return res.status(400).json({ error: 'Este invitado no figura como ingresado' })
    }

    // Condicionado a ingresado = true, igual que la validación: si dos admins
    // lo deshacen a la vez, solo uno afecta la fila.
    const { data: actualizados, error } = await supabase
      .from('invitados')
      .update({ ingresado: false, fecha_ingreso: null, validado_por: null })
      .eq('id', invitadoId)
      .eq('evento_id', evento_id)
      .eq('ingresado', true)
      .select('id, nombre, apellido, dni, email, qr_enviado, ingresado, fecha_ingreso')

    if (error) throw error

    if (!actualizados || actualizados.length === 0) {
      return res.status(409).json({ error: 'El ingreso ya había sido deshecho' })
    }

    await registrar(req, ACCIONES.INGRESO_DESHECHO, {
      entidad: 'invitados',
      entidadId: invitadoId,
      detalle: {
        evento_id,
        // Guardamos el ingreso que se revierte: es lo que permite reconstruir
        // qué pasó si después hay una discusión.
        fecha_ingreso_previa: invitado.fecha_ingreso,
        validado_por_previo: invitado.validado_por
      }
    })

    res.json({
      mensaje: `Se deshizo el ingreso de ${invitado.nombre} ${invitado.apellido}. Su QR vuelve a ser válido.`,
      invitado: actualizados[0]
    })

  } catch (error) {
    console.error('Error al deshacer ingreso:', error)
    res.status(500).json({ error: 'Error al deshacer el ingreso' })
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

module.exports = {
  importarInvitados, crearInvitado, editarInvitado,
  reenviarQR, listarInvitados, eliminarInvitado, deshacerIngreso
}
