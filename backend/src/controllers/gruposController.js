const supabase = require('../config/supabase')
const { leerGrupos, MAX_ENTRADAS_POR_FAMILIA } = require('../services/excelService')
const { planificarImportacion, ESTADOS } = require('../services/planImportacion')
const { enviarEntradasGrupo, enviarGruposEnLote } = require('../services/emailService')
const { registrar, ACCIONES } = require('../utils/auditoria')
const {
  esUuid, texto, normalizarEmail, esEmailValido, enteroNoNegativo, normalizarTipoEntrada
} = require('../utils/validacion')

const COD_DUPLICADO = '23505'

// ── Helpers ─────────────────────────────────────────────────────────────────

// Trae el evento y verifica que cargue invitados por familia (egresados, o un
// casamiento configurado así).
// Devuelve { evento } o { status, error } para responder directamente.
const obtenerEventoEgresados = async (eventoId) => {
  if (!esUuid(eventoId)) return { status: 400, error: 'Identificador de evento inválido' }

  const { data: evento } = await supabase
    .from('eventos')
    .select('id, nombre_evento, fecha, tipo, modo_carga, inicio_baile, limite_invitados, datos_purgados_en')
    .eq('id', eventoId)
    .maybeSingle()

  if (!evento) return { status: 404, error: 'Evento no encontrado' }
  if (evento.modo_carga !== 'familia') {
    return { status: 400, error: 'Este evento carga a los invitados de forma individual, no por familia' }
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

// Cantidades de cena y baile de un formulario. `minimoUna`: al menos una entrada.
const parsearCantidades = (body) => {
  const cena = enteroNoNegativo(body?.cena, MAX_ENTRADAS_POR_FAMILIA)
  const baile = enteroNoNegativo(body?.baile, MAX_ENTRADAS_POR_FAMILIA)
  if (cena === null || baile === null) {
    return { error: `Las cantidades tienen que ser números enteros de 0 a ${MAX_ENTRADAS_POR_FAMILIA}` }
  }
  if (cena + baile === 0) return { error: 'Indicá al menos una entrada de cena o de baile' }
  return { cena, baile }
}

// Crea las entradas de una familia a continuación de las que ya tiene
// (cena primero y después baile, como en la importación). Devuelve las filas
// creadas, con su token, para mandarlas por correo.
const crearEntradas = async ({ evento, grupoId, nombre, email, cena, baile, desde }) => {
  let n = desde
  const filas = [
    ...Array.from({ length: cena }, () => 'cena'),
    ...Array.from({ length: baile }, () => 'baile')
  ].map(tipo_entrada => ({
    evento_id: evento.id,
    grupo_id: grupoId,
    nombre,
    apellido: null,
    dni: null,
    email,
    tipo_entrada,
    numero: ++n
  }))

  const { data: creadas, error } = await supabase
    .from('invitados')
    .insert(filas)
    .select('id, qr_token, numero, tipo_entrada')
  if (error) throw error
  return { creadas, total: n }
}

// Cuántas entradas tiene el evento hoy, para no pasar el límite.
const contarEntradasEvento = async (eventoId) => {
  const { count, error } = await supabase
    .from('invitados')
    .select('id', { count: 'exact', head: true })
    .eq('evento_id', eventoId)
  if (error) throw error
  return count || 0
}

const ERROR_PURGADO = 'Este evento ya pasó y sus datos personales fueron eliminados. No se pueden cargar entradas.'

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
      return res.status(400).json({ error: ERROR_PURGADO })
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

      const { creadas, total: n } = await crearEntradas({
        evento,
        grupoId,
        nombre: accion.familia,
        email: accion.email,
        cena: accion.agregarCena,
        baile: accion.agregarBaile,
        desde: maxNumero.get(grupoId) || 0
      })

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

// ── Carga manual (sin Excel) ────────────────────────────────────────────────

// Agrega una familia desde el panel con sus entradas y le manda el correo.
const crearGrupo = async (req, res) => {
  const { datos, error: errorDatos } = parsearGrupo(req.body)
  if (errorDatos) return res.status(400).json({ error: errorDatos })
  const { cena, baile, error: errorCant } = parsearCantidades(req.body)
  if (errorCant) return res.status(400).json({ error: errorCant })

  try {
    const { evento, status, error } = await obtenerEventoEgresados(req.params.id)
    if (error) return res.status(status).json({ error })
    if (evento.datos_purgados_en) return res.status(400).json({ error: ERROR_PURGADO })

    const actuales = await contarEntradasEvento(evento.id)
    if (actuales + cena + baile > evento.limite_invitados) {
      return res.status(400).json({
        error: `Se superaría el límite del evento (${evento.limite_invitados}). Ya hay ${actuales} entradas.`
      })
    }

    const { data: grupo, error: errorGrupo } = await supabase
      .from('grupos')
      .insert([{ evento_id: evento.id, ...datos }])
      .select('id, nombre, email, telefono')
      .single()
    if (errorGrupo) {
      if (errorGrupo.code === COD_DUPLICADO) {
        return res.status(409).json({
          error: `Ya hay una familia con el email ${datos.email} en este evento. Para sumarle entradas, usá «Sumar entradas» en esa familia.`
        })
      }
      throw errorGrupo
    }

    const { creadas, total } = await crearEntradas({
      evento, grupoId: grupo.id, nombre: grupo.nombre, email: grupo.email, cena, baile, desde: 0
    })

    await registrar(req, ACCIONES.GRUPO_CREADO, {
      entidad: 'grupos', entidadId: grupo.id, detalle: { evento_id: evento.id, cena, baile }
    })

    let enviado = true
    try {
      await enviarEntradasGrupo(grupo, creadas, evento, { modo: 'inicial', total })
    } catch (errorEmail) {
      enviado = false
      console.error(`[email] falló el envío al grupo ${grupo.id}: ${errorEmail.message}`)
    }

    res.status(201).json({
      mensaje: enviado
        ? `${grupo.nombre} fue agregada con ${total} entrada(s) y su correo salió a ${grupo.email}.`
        : `${grupo.nombre} fue agregada con ${total} entrada(s), pero falló el envío del correo. Usá «Reenviar».`,
      grupo: { ...grupo, total }
    })
  } catch (error) {
    console.error('Error al crear grupo:', error)
    res.status(500).json({ error: 'Error al agregar la familia' })
  }
}

// Suma entradas a una familia ya cargada. El correo trae solo las nuevas y
// aclara que las anteriores siguen valiendo, igual que al volver a subir el Excel.
const agregarEntradas = async (req, res) => {
  const { grupoId } = req.params
  if (!esUuid(grupoId)) return res.status(400).json({ error: 'Identificador inválido' })
  const { cena, baile, error: errorCant } = parsearCantidades(req.body)
  if (errorCant) return res.status(400).json({ error: errorCant })

  try {
    const { evento, status, error } = await obtenerEventoEgresados(req.params.id)
    if (error) return res.status(status).json({ error })
    if (evento.datos_purgados_en) return res.status(400).json({ error: ERROR_PURGADO })

    const [grupo] = (await cargarGrupos(evento.id)).filter(g => g.id === grupoId)
    if (!grupo) return res.status(404).json({ error: 'Familia no encontrada' })

    if (grupo.entradas.length + cena + baile > MAX_ENTRADAS_POR_FAMILIA) {
      return res.status(400).json({
        error: `Una familia puede tener hasta ${MAX_ENTRADAS_POR_FAMILIA} entradas. ${grupo.nombre} ya tiene ${grupo.entradas.length}.`
      })
    }

    const actuales = await contarEntradasEvento(evento.id)
    if (actuales + cena + baile > evento.limite_invitados) {
      return res.status(400).json({
        error: `Se superaría el límite del evento (${evento.limite_invitados}). Ya hay ${actuales} entradas.`
      })
    }

    const { creadas, total } = await crearEntradas({
      evento, grupoId, nombre: grupo.nombre, email: grupo.email, cena, baile, desde: grupo.total
    })

    await registrar(req, ACCIONES.ENTRADAS_AGREGADAS, {
      entidad: 'grupos', entidadId: grupoId, detalle: { evento_id: evento.id, cena, baile }
    })

    let enviado = true
    try {
      await enviarEntradasGrupo(grupo, creadas, evento, { modo: 'ampliacion', total })
    } catch (errorEmail) {
      enviado = false
      console.error(`[email] falló el envío al grupo ${grupoId}: ${errorEmail.message}`)
    }

    const cantidad = cena + baile
    res.status(201).json({
      mensaje: enviado
        ? `Se sumaron ${cantidad} entrada(s) a ${grupo.nombre} y le llegó un correo solo con las nuevas.`
        : `Se sumaron ${cantidad} entrada(s) a ${grupo.nombre}, pero falló el envío del correo. Usá «Reenviar».`
    })
  } catch (error) {
    console.error('Error al agregar entradas:', error)
    res.status(500).json({ error: 'Error al agregar las entradas' })
  }
}

// Cambia una entrada de "cena + baile" a "solo baile" o al revés. El QR es el
// mismo: el escáner lee el tipo de la base, así que vale según el tipo nuevo
// sin reenviar nada.
const cambiarTipoEntrada = async (req, res) => {
  const { grupoId, entradaId } = req.params
  if (!esUuid(grupoId) || !esUuid(entradaId)) return res.status(400).json({ error: 'Identificador inválido' })
  const tipo_entrada = normalizarTipoEntrada(req.body?.tipo_entrada)
  if (!tipo_entrada || !String(req.body?.tipo_entrada ?? '').trim()) {
    return res.status(400).json({ error: 'El tipo de entrada tiene que ser «cena» o «baile»' })
  }

  try {
    const { evento, status, error } = await obtenerEventoEgresados(req.params.id)
    if (error) return res.status(status).json({ error })

    const { data: actualizadas, error: errorUpd } = await supabase
      .from('invitados')
      .update({ tipo_entrada })
      .eq('id', entradaId)
      .eq('grupo_id', grupoId)
      .eq('evento_id', evento.id)
      .select('id, numero, tipo_entrada')
    if (errorUpd) throw errorUpd
    if (!actualizadas?.length) return res.status(404).json({ error: 'Entrada no encontrada' })

    await registrar(req, ACCIONES.ENTRADA_EDITADA, {
      entidad: 'invitados', entidadId: entradaId, detalle: { evento_id: evento.id, tipo_entrada }
    })

    const e = actualizadas[0]
    res.json({
      mensaje: `La entrada ${e.numero} ahora es «${tipo_entrada === 'baile' ? 'Solo baile' : 'Cena + baile'}». ` +
               'Su QR sigue sirviendo; si querés que la familia vea el tipo nuevo en el correo, reenviá esa entrada.',
      entrada: e
    })
  } catch (error) {
    console.error('Error al cambiar el tipo de entrada:', error)
    res.status(500).json({ error: 'Error al cambiar el tipo de entrada' })
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
  crearGrupo,
  agregarEntradas,
  cambiarTipoEntrada,
  listarGrupos,
  editarGrupo,
  reenviarGrupo,
  eliminarGrupo,
  enviosPendientesDeGrupos
}
