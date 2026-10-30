const supabase = require('../config/supabase')
const { leerGrupos } = require('../services/excelService')
const { planificarImportacion, ESTADOS } = require('../services/planImportacion')
const { enviarEntradasGrupo, enviarGruposEnLote } = require('../services/emailService')
const { registrar, ACCIONES } = require('../utils/auditoria')
const { esUuid, texto, normalizarEmail, esEmailValido } = require('../utils/validacion')

const COD_DUPLICADO = '23505'

// ── Helpers ─────────────────────────────────────────────────────────────────

// Trae el evento y verifica que sea de egresados y que siga teniendo datos.
// Devuelve { evento } o { status, error } para responder directamente.
const obtenerEventoEgresados = async (eventoId) => {
  if (!esUuid(eventoId)) return { status: 400, error: 'Identificador de evento inválido' }

  const { data: evento } = await supabase
    .from('eventos')
    .select('id, nombre_evento, fecha, tipo, inicio_baile, limite_invitados, datos_purgados_en')
    .eq('id', eventoId)
    .maybeSingle()

  if (!evento) return { status: 404, error: 'Evento no encontrado' }
  if (evento.tipo !== 'egresados') {
    return { status: 400, error: 'Este evento no es una fiesta de egresados' }
  }
  return { evento }
}

// Familias del evento con sus entradas. Nunca incluye qr_token: la lista
// viaja al navegador del administrador y el token es la credencial.
const cargarGrupos = async (eventoId, { conToken = false } = {}) => {
  const [{ data: grupos, error: e1 }, { data: entradas, error: e2 }] = await Promise.all([
    supabase.from('grupos')
      .select('id, nombre, email, telefono, creado_en')
      .eq('evento_id', eventoId)
      .order('nombre', { ascending: true }),
    supabase.from('invitados')
      .select(`id, grupo_id, numero, tipo_entrada, ingresado, fecha_ingreso, qr_enviado${conToken ? ', qr_token' : ''}`)
      .eq('evento_id', eventoId)
      .not('grupo_id', 'is', null)
      .order('numero', { ascending: true })
  ])
  if (e1) throw e1
  if (e2) throw e2

  const porGrupo = new Map((grupos || []).map(g => [g.id, { ...g, entradas: [] }]))
  for (const e of entradas || []) porGrupo.get(e.grupo_id)?.entradas.push(e)

  return [...porGrupo.values()].map(g => ({
    ...g,
    cena: g.entradas.filter(e => e.tipo_entrada === 'cena').length,
    baile: g.entradas.filter(e => e.tipo_entrada === 'baile').length,
    ingresados: g.entradas.filter(e => e.ingresado).length,
    pendientesEnvio: g.entradas.filter(e => !e.qr_enviado).length,
    // El "de N" de cada entrada. Se usa el número más alto y no la cantidad
    // de filas para que anular la entrada 3 no deje una "entrada 5 de 4".
    total: g.entradas.reduce((m, e) => Math.max(m, e.numero || 0), 0)
  }))
}

const parsearGrupo = (body) => {
  const nombre = texto(body?.nombre, 160)
  const email = normalizarEmail(body?.email)
  const telefono = texto(body?.telefono, 40)

  if (!nombre) return { error: 'El nombre de la familia es obligatorio' }
  if (!email) return { error: 'El email es obligatorio' }
  if (!esEmailValido(email)) return { error: `El email "${email}" no tiene un formato válido` }

  return { datos: { nombre, email, telefono: telefono || null } }
}

// ── Importación ─────────────────────────────────────────────────────────────

// Se llama dos veces con el mismo archivo: primero con modo=previsualizar
// (no toca nada, devuelve el resumen) y después con modo=confirmar. Recalcular
// el plan al confirmar, en vez de guardar el de la previsualización, evita
// aplicar un resumen viejo si alguien cargó algo entre medio.
const importarGrupos = async (req, res) => {
  const confirmar = req.body?.modo === 'confirmar'

  if (!req.file) return res.status(400).json({ error: 'No se recibió ningún archivo Excel' })

  try {
    const { evento, status, error } = await obtenerEventoEgresados(req.params.id)
    if (error) return res.status(status).json({ error })

    if (evento.datos_purgados_en) {
      return res.status(400).json({
        error: 'Este evento ya pasó y sus datos personales fueron eliminados. No se pueden cargar entradas.'
      })
    }

    const { grupos: filas, errores, totalErrores, error: errorLectura } = await leerGrupos(req.file.buffer)
    if (errorLectura) return res.status(400).json({ error: errorLectura })
    if (totalErrores > 0) {
      return res.status(400).json({ error: `El archivo tiene ${totalErrores} error(es)`, detalle: errores })
    }
    if (filas.length === 0) return res.status(400).json({ error: 'El archivo no contiene familias válidas' })

    const existentes = await cargarGrupos(evento.id, { conToken: false })
    const { acciones, resumen } = planificarImportacion(filas, existentes)

    const superaLimite = resumen.totalResultante > evento.limite_invitados

    if (!confirmar) {
      return res.json({
        resumen: { ...resumen, limite: evento.limite_invitados, superaLimite },
        // Las filas sin cambios no aportan nada a la pantalla de confirmación.
        acciones: acciones.filter(a => a.estado !== ESTADOS.SIN_CAMBIOS || a.datosCambiados)
      })
    }

    if (superaLimite) {
      return res.status(400).json({
        error: `La importación superaría el límite del evento (${evento.limite_invitados}). ` +
               `Ya hay ${resumen.totalActual} entradas y estás agregando ${resumen.entradasNuevas}.`
      })
    }

    if (resumen.entradasNuevas === 0 && resumen.datosActualizados === 0) {
      return res.status(400).json({ error: 'El archivo no trae cambios respecto de lo que ya está cargado' })
    }

    const maxNumero = new Map(existentes.map(g => [g.id, g.total]))
    const envios = []

    for (const accion of acciones) {
      if (accion.estado === ESTADOS.REVISAR) continue

      let grupoId = accion.grupoId

      if (accion.estado === ESTADOS.NUEVO) {
        const { data: creado, error: errorGrupo } = await supabase
          .from('grupos')
          .insert([{ evento_id: evento.id, nombre: accion.familia, email: accion.email, telefono: accion.telefono }])
          .select('id')
          .single()
        if (errorGrupo) throw errorGrupo
        grupoId = creado.id
        maxNumero.set(grupoId, 0)
      } else if (accion.datosCambiados) {
        const { error: errorUpd } = await supabase
          .from('grupos')
          .update({ nombre: accion.familia, telefono: accion.telefono })
          .eq('id', grupoId)
        if (errorUpd) throw errorUpd
        await supabase.from('invitados').update({ nombre: accion.familia }).eq('grupo_id', grupoId)
      }

      if (accion.agregarCena + accion.agregarBaile === 0) continue

      // Cena primero y después baile: así en el correo las de cena quedan arriba.
      let n = maxNumero.get(grupoId) || 0
      const filasEntradas = [
        ...Array.from({ length: accion.agregarCena }, () => 'cena'),
        ...Array.from({ length: accion.agregarBaile }, () => 'baile')
      ].map(tipo_entrada => ({
        evento_id: evento.id,
        grupo_id: grupoId,
        nombre: accion.familia,
        apellido: null,
        dni: null,
        email: accion.email,
        tipo_entrada,
        numero: ++n
      }))

      const { data: creadas, error: errorEntradas } = await supabase
        .from('invitados')
        .insert(filasEntradas)
        .select('id, qr_token, numero, tipo_entrada')
      if (errorEntradas) throw errorEntradas

      maxNumero.set(grupoId, n)
      envios.push({
        grupo: { id: grupoId, nombre: accion.familia, email: accion.email },
        entradas: creadas,
        total: n,
        modo: accion.estado === ESTADOS.NUEVO ? 'inicial' : 'ampliacion'
      })
    }

    await registrar(req, ACCIONES.GRUPOS_IMPORTADOS, {
      entidad: 'eventos',
      entidadId: evento.id,
      detalle: {
        nuevos: resumen.nuevos,
        ampliados: resumen.ampliados,
        entradas: resumen.entradasNuevas,
        revisar: resumen.revisar
      }
    })

    enviarGruposEnLote(envios, evento).catch(err =>
      console.error('[email] el lote de grupos falló por completo:', err.message)
    )

    res.status(201).json({
      mensaje: `${resumen.entradasNuevas} entradas cargadas (${resumen.nuevos} familias nuevas, ` +
               `${resumen.ampliados} ampliadas). Se están enviando ${envios.length} correos.` +
               (resumen.revisar > 0 ? ` ${resumen.revisar} familia(s) quedaron para revisar.` : ''),
      resumen
    })
  } catch (error) {
    console.error('Error al importar grupos:', error)
    if (error.code === COD_DUPLICADO) {
      return res.status(409).json({ error: 'Otra carga se hizo al mismo tiempo. Volvé a subir el archivo.' })
    }
    res.status(500).json({ error: 'Error al procesar el archivo' })
  }
}

// ── Consulta y gestión ──────────────────────────────────────────────────────

const listarGrupos = async (req, res) => {
  try {
    const { evento, status, error } = await obtenerEventoEgresados(req.params.id)
    if (error) return res.status(status).json({ error })

    const grupos = await cargarGrupos(evento.id)
    res.json({ grupos })
  } catch (error) {
    console.error('Error al listar grupos:', error)
    res.status(500).json({ error: 'Error al obtener las familias' })
  }
}

// Corrige nombre, correo o teléfono. Si cambia el correo, la casilla nueva
// nunca recibió nada: se le reenvían todas las entradas.
const editarGrupo = async (req, res) => {
  const { grupoId } = req.params
  if (!esUuid(grupoId)) return res.status(400).json({ error: 'Identificador inválido' })

  const { datos, error: errorValidacion } = parsearGrupo(req.body)
  if (errorValidacion) return res.status(400).json({ error: errorValidacion })

  try {
    const { evento, status, error } = await obtenerEventoEgresados(req.params.id)
    if (error) return res.status(status).json({ error })

    const { data: actual } = await supabase
      .from('grupos')
      .select('id, nombre, email, telefono')
      .eq('id', grupoId)
      .eq('evento_id', evento.id)
      .maybeSingle()
    if (!actual) return res.status(404).json({ error: 'Familia no encontrada' })

    const { error: errorUpd } = await supabase.from('grupos').update(datos).eq('id', grupoId)
    if (errorUpd) {
      if (errorUpd.code === COD_DUPLICADO) {
        return res.status(409).json({ error: `Ya hay otra familia con el email ${datos.email} en este evento` })
      }
      throw errorUpd
    }

    await supabase.from('invitados')
      .update({ nombre: datos.nombre, email: datos.email })
      .eq('grupo_id', grupoId)

    await registrar(req, ACCIONES.GRUPO_EDITADO, {
      entidad: 'grupos',
      entidadId: grupoId,
      detalle: { evento_id: evento.id, campos: Object.keys(datos).filter(c => datos[c] !== actual[c]) }
    })

    const cambioEmail = datos.email !== actual.email
    let reenviado = false
    if (cambioEmail) {
      try {
        const [grupo] = (await cargarGrupos(evento.id, { conToken: true })).filter(g => g.id === grupoId)
        if (grupo?.entradas.length) {
          await enviarEntradasGrupo(grupo, grupo.entradas, evento, { modo: 'reenvio', total: grupo.total })
          reenviado = true
        }
      } catch (errorEmail) {
        console.error(`[email] falló el reenvío al grupo ${grupoId}: ${errorEmail.message}`)
      }
    }

    res.json({
      mensaje: cambioEmail
        ? (reenviado
            ? `Datos actualizados. Las entradas se reenviaron a ${datos.email}.`
            : `Datos actualizados, pero falló el reenvío a ${datos.email}. Usá el botón de reenviar.`)
        : 'Datos actualizados correctamente.'
    })
  } catch (error) {
    console.error('Error al editar grupo:', error)
    res.status(500).json({ error: 'Error al actualizar la familia' })
  }
}

// Reenvía todas las entradas de una familia en un solo correo.
const reenviarGrupo = async (req, res) => {
  const { grupoId } = req.params
  if (!esUuid(grupoId)) return res.status(400).json({ error: 'Identificador inválido' })

  try {
    const { evento, status, error } = await obtenerEventoEgresados(req.params.id)
    if (error) return res.status(status).json({ error })

    const [grupo] = (await cargarGrupos(evento.id, { conToken: true })).filter(g => g.id === grupoId)
    if (!grupo) return res.status(404).json({ error: 'Familia no encontrada' })
    if (grupo.entradas.length === 0) return res.status(400).json({ error: 'Esta familia no tiene entradas' })

    await enviarEntradasGrupo(grupo, grupo.entradas, evento, { modo: 'reenvio', total: grupo.total })

    await registrar(req, ACCIONES.QR_REENVIADO, {
      entidad: 'grupos', entidadId: grupoId, detalle: { evento_id: evento.id, entradas: grupo.entradas.length }
    })

    res.json({ mensaje: `${grupo.entradas.length} entradas reenviadas a ${grupo.email}` })
  } catch (error) {
    console.error('Error al reenviar grupo:', error)
    res.status(500).json({ error: 'Error al reenviar las entradas' })
  }
}

const eliminarGrupo = async (req, res) => {
  const { grupoId } = req.params
  if (!esUuid(grupoId)) return res.status(400).json({ error: 'Identificador inválido' })

  try {
    const { evento, status, error } = await obtenerEventoEgresados(req.params.id)
    if (error) return res.status(status).json({ error })

    // Las entradas se borran en cascada con el grupo (FK on delete cascade).
    const { data: eliminados, error: errorDel } = await supabase
      .from('grupos')
      .delete()
      .eq('id', grupoId)
      .eq('evento_id', evento.id)
      .select('id')
    if (errorDel) throw errorDel
    if (!eliminados?.length) return res.status(404).json({ error: 'Familia no encontrada' })

    await registrar(req, ACCIONES.GRUPO_ELIMINADO, {
      entidad: 'grupos', entidadId: grupoId, detalle: { evento_id: evento.id }
    })

    res.json({ mensaje: 'Familia y entradas eliminadas. Sus QR dejaron de ser válidos.' })
  } catch (error) {
    console.error('Error al eliminar grupo:', error)
    res.status(500).json({ error: 'Error al eliminar la familia' })
  }
}

// Envía lo que quedó sin salir (por ejemplo, porque se agotó la cuota diaria
// de Resend). Cada familia recibe solo sus entradas pendientes.
const enviosPendientesDeGrupos = async (evento) => {
  const grupos = await cargarGrupos(evento.id, { conToken: true })
  return grupos
    .filter(g => g.pendientesEnvio > 0)
    .map(g => {
      const pendientes = g.entradas.filter(e => !e.qr_enviado)
      return {
        grupo: g,
        entradas: pendientes,
        total: g.total,
        modo: pendientes.length === g.entradas.length ? 'inicial' : 'ampliacion'
      }
    })
}

module.exports = {
  importarGrupos,
  listarGrupos,
  editarGrupo,
  reenviarGrupo,
  eliminarGrupo,
  enviosPendientesDeGrupos
}
