const supabase = require('../config/supabase')
const { registrar, ACCIONES } = require('../utils/auditoria')
const { calcularVentana } = require('../utils/ventanaQr')
const { esUuid, texto, esFechaValida, enteroPositivo, TIPOS_EVENTO } = require('../utils/validacion')

const FECHA_HORA_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/

// El formulario manda la hora del baile como "AAAA-MM-DDTHH:mm" en hora
// argentina (input datetime-local). Se guarda como timestamptz. Tiene que caer
// entre el mediodía del día del evento y el mediodía siguiente: el baile de
// una cena de egresados casi siempre arranca pasada la medianoche.
const parsearInicioBaile = (valor, fecha) => {
  if (valor === null || valor === undefined || valor === '') return { valor: null }
  if (typeof valor !== 'string' || !FECHA_HORA_RE.test(valor)) {
    return { error: 'La hora de inicio del baile es inválida' }
  }
  const inicio = new Date(`${valor}:00-03:00`)
  const desde = new Date(`${fecha}T12:00:00-03:00`)
  const hasta = new Date(desde.getTime() + 24 * 60 * 60 * 1000)
  if (Number.isNaN(inicio.getTime())) return { error: 'La hora de inicio del baile es inválida' }
  if (inicio < desde || inicio > hasta) {
    return { error: 'El inicio del baile tiene que ser entre el mediodía del día del evento y el mediodía siguiente' }
  }
  return { valor: inicio.toISOString() }
}

// Valida y normaliza el cuerpo de creación/edición de eventos.
// Devuelve { datos } o { error }.
const parsearEvento = (body) => {
  const nombre_evento = texto(body?.nombre_evento, 160)
  const fecha = texto(body?.fecha, 10)
  const anfitrion_nombre = texto(body?.anfitrion_nombre, 120)
  const anfitrion_telefono = texto(body?.anfitrion_telefono, 40)
  const limite_invitados = enteroPositivo(body?.limite_invitados, 10000)

  if (!nombre_evento || !fecha || !anfitrion_nombre || limite_invitados === null) {
    return { error: 'Faltan campos obligatorios o el límite de invitados es inválido' }
  }

  if (!esFechaValida(fecha)) {
    return { error: 'La fecha debe tener el formato AAAA-MM-DD' }
  }

  const tipo = body?.tipo === undefined || body?.tipo === '' ? 'quince' : body.tipo
  if (!TIPOS_EVENTO.includes(tipo)) {
    return { error: 'El tipo de evento es inválido' }
  }

  const baile = parsearInicioBaile(body?.inicio_baile, fecha)
  if (baile.error) return { error: baile.error }

  return {
    datos: {
      nombre_evento,
      fecha,
      tipo,
      limite_invitados,
      anfitrion_nombre,
      anfitrion_telefono: anfitrion_telefono || null,
      inicio_baile: tipo === 'egresados' ? baile.valor : null
    }
  }
}

const crearEvento = async (req, res) => {
  const { datos, error: errorValidacion } = parsearEvento(req.body)
  if (errorValidacion) return res.status(400).json({ error: errorValidacion })

  try {
    const { data, error } = await supabase
      .from('eventos')
      .insert([{ ...datos, creado_por: req.usuario.id }])
      .select()
      .single()

    if (error) throw error

    await registrar(req, ACCIONES.EVENTO_CREADO, {
      entidad: 'eventos', entidadId: data.id, detalle: { nombre_evento: datos.nombre_evento }
    })

    res.status(201).json({ mensaje: 'Evento creado correctamente', evento: data })
  } catch (error) {
    console.error('Error al crear evento:', error)
    res.status(500).json({ error: 'Error al crear el evento' })
  }
}

const editarEvento = async (req, res) => {
  const { id } = req.params
  if (!esUuid(id)) return res.status(400).json({ error: 'Identificador inválido' })

  try {
    // El tipo no se cambia después de crear el evento: un cumpleaños con
    // invitados por DNI no se puede convertir en una fiesta por familias.
    const { data: actual } = await supabase
      .from('eventos')
      .select('id, tipo')
      .eq('id', id)
      .maybeSingle()
    if (!actual) return res.status(404).json({ error: 'Evento no encontrado' })

    const { datos, error: errorValidacion } = parsearEvento({ ...req.body, tipo: actual.tipo })
    if (errorValidacion) return res.status(400).json({ error: errorValidacion })

    const { data, error } = await supabase
      .from('eventos')
      .update(datos)
      .eq('id', id)
      .select()
      .maybeSingle()

    if (error) throw error
    if (!data) return res.status(404).json({ error: 'Evento no encontrado' })

    await registrar(req, ACCIONES.EVENTO_ACTUALIZADO, {
      entidad: 'eventos', entidadId: id, detalle: { nombre_evento: datos.nombre_evento }
    })

    res.json({ mensaje: 'Evento actualizado correctamente', evento: data })
  } catch (error) {
    console.error('Error al editar evento:', error)
    res.status(500).json({ error: 'Error al editar el evento' })
  }
}

const listarEventos = async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('eventos')
      .select('*')
      .order('fecha', { ascending: false })

    if (error) throw error

    // Antes se ordenaba solo por fecha descendente, así que un evento de dentro
    // de un año quedaba arriba del de mañana. Lo que importa en el salón es qué
    // viene primero: los próximos van arriba del más cercano al más lejano, y
    // debajo los pasados, del más reciente al más viejo.
    const hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' })
    const proximos = []
    const pasados = []

    for (const ev of data || []) {
      (ev.fecha >= hoy ? proximos : pasados).push(ev)
    }

    proximos.sort((a, b) => a.fecha.localeCompare(b.fecha))
    pasados.sort((a, b) => b.fecha.localeCompare(a.fecha))

    res.json({ eventos: [...proximos, ...pasados] })
  } catch (error) {
    console.error('Error al listar eventos:', error)
    res.status(500).json({ error: 'Error al obtener los eventos' })
  }
}

// Endpoint para los guardias: solo los eventos que están dentro de su ventana
// de validez, y solo los campos mínimos para poder elegir uno en el escáner.
// No expone anfitrión, teléfono ni invitados.
const listarEventosActivos = async (req, res) => {
  try {
    const hoy = new Date()
    // Traemos una franja acotada alrededor de hoy y filtramos con la misma
    // lógica de ventana que usa la validación, para que no haya discrepancias.
    const desde = new Date(hoy.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    const hasta = new Date(hoy.getTime() + 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

    const { data, error } = await supabase
      .from('eventos')
      .select('id, nombre_evento, fecha, tipo')
      .gte('fecha', desde)
      .lte('fecha', hasta)
      .order('fecha', { ascending: true })

    if (error) throw error

    const activos = (data || []).filter(ev => {
      const { desde: d, hasta: h } = calcularVentana(ev.fecha)
      return hoy >= d && hoy <= h
    })

    res.json({ eventos: activos })
  } catch (error) {
    console.error('Error al listar eventos activos:', error)
    res.status(500).json({ error: 'Error al obtener los eventos' })
  }
}

const obtenerEvento = async (req, res) => {
  const { id } = req.params
  if (!esUuid(id)) return res.status(400).json({ error: 'Identificador inválido' })

  try {
    const { data, error } = await supabase
      .from('eventos')
      .select('*, invitados(id, nombre, apellido, dni, email, qr_enviado, ingresado, fecha_ingreso, grupo_id, numero, tipo_entrada)')
      .eq('id', id)
      .maybeSingle()

    if (error) throw error
    if (!data) return res.status(404).json({ error: 'Evento no encontrado' })

    res.json({ evento: data })
  } catch (error) {
    console.error('Error al obtener evento:', error)
    res.status(500).json({ error: 'Error al obtener el evento' })
  }
}

const eliminarEvento = async (req, res) => {
  const { id } = req.params
  if (!esUuid(id)) return res.status(400).json({ error: 'Identificador inválido' })

  try {
    const { data: evento } = await supabase
      .from('eventos')
      .select('id, nombre_evento')
      .eq('id', id)
      .maybeSingle()

    if (!evento) return res.status(404).json({ error: 'Evento no encontrado' })

    const { error } = await supabase.from('eventos').delete().eq('id', id)
    if (error) throw error

    await registrar(req, ACCIONES.EVENTO_ELIMINADO, {
      entidad: 'eventos', entidadId: id, detalle: { nombre_evento: evento.nombre_evento }
    })

    res.json({ mensaje: 'Evento eliminado correctamente' })
  } catch (error) {
    console.error('Error al eliminar evento:', error)
    res.status(500).json({ error: 'Error al eliminar el evento' })
  }
}

module.exports = {
  crearEvento,
  editarEvento,
  listarEventos,
  listarEventosActivos,
  obtenerEvento,
  eliminarEvento
}
