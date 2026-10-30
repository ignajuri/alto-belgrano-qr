const supabase = require('../config/supabase')
const { registrar, ACCIONES } = require('../utils/auditoria')
const { evaluarVentana } = require('../utils/ventanaQr')
const { esUuid } = require('../utils/validacion')

const ZONA_AR = 'America/Argentina/Buenos_Aires'

const formatearHora = (fechaHora) =>
  new Date(fechaHora).toLocaleTimeString('es-AR', {
    hour: '2-digit', minute: '2-digit', hour12: false, timeZone: ZONA_AR
  })

// Datos que ve el guardia en pantalla. En un cumpleaños: nombre y DNI. En
// egresados: la familia, qué entrada es ("3 de 5") y si es de cena o de baile.
const armarDetalle = async (invitado) => {
  if (!invitado.grupo_id) {
    return { nombre: invitado.nombre, apellido: invitado.apellido }
  }

  const { data: hermanas } = await supabase
    .from('invitados')
    .select('numero')
    .eq('grupo_id', invitado.grupo_id)
  const total = (hermanas || []).reduce((m, e) => Math.max(m, e.numero || 0), 0)

  return {
    grupo: invitado.grupos?.nombre || invitado.nombre,
    entrada: `Entrada ${invitado.numero} de ${total}`,
    tipo_entrada: invitado.tipo_entrada
  }
}

const rechazo = (motivo, detalle) => ({
  valido: false,
  motivo,
  color: 'rojo',
  ...(detalle ? { detalle } : {})
})

const validarQR = async (req, res) => {
  const token = req.body?.token
  const eventoIdEsperado = req.body?.evento_id

  if (!token || typeof token !== 'string') {
    return res.status(400).json({ error: 'Token requerido' })
  }

  // El qr_token es un UUID. Descartamos cualquier cosa que no lo sea antes de
  // tocar la base: evita ruido de QRs ajenos y consultas inútiles.
  if (!esUuid(token)) {
    await registrar(req, ACCIONES.QR_RECHAZADO, { detalle: { motivo: 'formato_invalido' } })
    return res.status(404).json(rechazo('QR no reconocido'))
  }

  try {
    const { data: invitado } = await supabase
      .from('invitados')
      .select('id, nombre, apellido, dni, evento_id, ingresado, fecha_ingreso, grupo_id, numero, tipo_entrada, ' +
              'eventos(nombre_evento, fecha, inicio_baile), grupos(nombre)')
      .eq('qr_token', token)
      .maybeSingle()

    if (!invitado) {
      await registrar(req, ACCIONES.QR_RECHAZADO, { detalle: { motivo: 'no_encontrado' } })
      return res.status(404).json(rechazo('QR no reconocido'))
    }

    const nombreCompleto = await armarDetalle(invitado)

    // El escáner opera sobre un evento seleccionado. Un QR de otro evento se
    // rechaza automáticamente en vez de depender de que el guardia note la
    // diferencia en pantalla.
    if (eventoIdEsperado && invitado.evento_id !== eventoIdEsperado) {
      await registrar(req, ACCIONES.QR_RECHAZADO, {
        entidad: 'invitados',
        entidadId: invitado.id,
        detalle: { motivo: 'evento_incorrecto', esperado: eventoIdEsperado, real: invitado.evento_id }
      })
      return res.status(200).json(rechazo('Este QR es de otro evento', {
        ...nombreCompleto,
        evento: invitado.eventos?.nombre_evento
      }))
    }

    if (invitado.ingresado) {
      await registrar(req, ACCIONES.QR_RECHAZADO, {
        entidad: 'invitados', entidadId: invitado.id, detalle: { motivo: 'ya_ingresado' }
      })
      return res.status(200).json(rechazo('Este QR ya fue utilizado', {
        ...nombreCompleto,
        fecha_ingreso: invitado.fecha_ingreso
      }))
    }

    const motivoVentana = evaluarVentana(invitado.eventos?.fecha)
    if (motivoVentana) {
      await registrar(req, ACCIONES.QR_RECHAZADO, {
        entidad: 'invitados', entidadId: invitado.id, detalle: { motivo: 'fuera_de_ventana' }
      })
      return res.status(200).json(rechazo(motivoVentana, {
        ...nombreCompleto,
        evento: invitado.eventos?.nombre_evento
      }))
    }

    // Las entradas de baile no entran a la cena. Las de cena incluyen el
    // baile, así que no tienen restricción horaria.
    const inicioBaile = invitado.eventos?.inicio_baile
    if (invitado.tipo_entrada === 'baile' && inicioBaile && new Date() < new Date(inicioBaile)) {
      await registrar(req, ACCIONES.QR_RECHAZADO, {
        entidad: 'invitados', entidadId: invitado.id, detalle: { motivo: 'baile_antes_de_hora' }
      })
      return res.status(200).json(rechazo(`Entrada solo para el baile: habilitada desde las ${formatearHora(inicioBaile)}`, {
        ...nombreCompleto,
        evento: invitado.eventos?.nombre_evento
      }))
    }

    // UPDATE condicional: la comprobación de `ingresado` y la marca ocurren en
    // una sola operación atómica. Si dos guardias escanean el mismo QR en el
    // mismo instante, solo uno afecta la fila y el otro recibe 0 resultados.
    const { data: actualizados, error: errorUpdate } = await supabase
      .from('invitados')
      .update({
        ingresado: true,
        fecha_ingreso: new Date().toISOString(),
        validado_por: req.usuario.id
      })
      .eq('id', invitado.id)
      .eq('ingresado', false)
      .select('id')

    if (errorUpdate) throw errorUpdate

    if (!actualizados || actualizados.length === 0) {
      await registrar(req, ACCIONES.QR_RECHAZADO, {
        entidad: 'invitados', entidadId: invitado.id, detalle: { motivo: 'carrera_doble_uso' }
      })
      return res.status(200).json(rechazo('Este QR ya fue utilizado', nombreCompleto))
    }

    await registrar(req, ACCIONES.QR_VALIDADO, {
      entidad: 'invitados', entidadId: invitado.id, detalle: { evento_id: invitado.evento_id }
    })

    return res.status(200).json({
      valido: true,
      motivo: 'Acceso autorizado',
      color: 'verde',
      detalle: {
        ...nombreCompleto,
        ...(invitado.dni ? { dni: invitado.dni } : {}),
        evento: invitado.eventos?.nombre_evento
      }
    })

  } catch (error) {
    console.error('Error al validar QR:', error)
    res.status(500).json({ error: 'Error al validar el código QR' })
  }
}

module.exports = { validarQR }
