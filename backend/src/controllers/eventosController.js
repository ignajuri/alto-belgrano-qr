const supabase = require('../config/supabase')

const crearEvento = async (req, res) => {
  const { nombre_evento, fecha, limite_invitados, anfitrion_nombre, anfitrion_telefono } = req.body

  if (!nombre_evento || !fecha || !limite_invitados || !anfitrion_nombre) {
    return res.status(400).json({ error: 'Faltan campos obligatorios' })
  }

  try {
    const { data, error } = await supabase
      .from('eventos')
      .insert([{
        nombre_evento,
        fecha,
        limite_invitados,
        anfitrion_nombre,
        anfitrion_telefono: anfitrion_telefono || null,
        creado_por: req.usuario.id
      }])
      .select()
      .single()

    if (error) throw error

    res.status(201).json({ mensaje: 'Evento creado correctamente', evento: data })
  } catch (error) {
    console.error('Error al crear evento:', error)
    res.status(500).json({ error: 'Error al crear el evento' })
  }
}

const listarEventos = async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('eventos')
      .select('*')
      .order('fecha', { ascending: false })

    if (error) throw error

    res.json({ eventos: data })
  } catch (error) {
    console.error('Error al listar eventos:', error)
    res.status(500).json({ error: 'Error al obtener los eventos' })
  }
}

const obtenerEvento = async (req, res) => {
  const { id } = req.params

  try {
    const { data, error } = await supabase
      .from('eventos')
      .select('*, invitados(*)')
      .eq('id', id)
      .single()

    if (error || !data) {
      return res.status(404).json({ error: 'Evento no encontrado' })
    }

    res.json({ evento: data })
  } catch (error) {
    console.error('Error al obtener evento:', error)
    res.status(500).json({ error: 'Error al obtener el evento' })
  }
}

const eliminarEvento = async (req, res) => {
  const { id } = req.params

  try {
    const { error } = await supabase
      .from('eventos')
      .delete()
      .eq('id', id)

    if (error) throw error

    res.json({ mensaje: 'Evento eliminado correctamente' })
  } catch (error) {
    console.error('Error al eliminar evento:', error)
    res.status(500).json({ error: 'Error al eliminar el evento' })
  }
}

module.exports = { crearEvento, listarEventos, obtenerEvento, eliminarEvento }