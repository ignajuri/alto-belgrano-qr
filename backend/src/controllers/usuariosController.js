const supabase = require('../config/supabase')
const bcrypt = require('bcryptjs')

const listarUsuarios = async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('usuarios')
      .select('id, nombre, email, rol, activo, creado_en')
      .order('creado_en', { ascending: false })

    if (error) throw error
    res.json({ usuarios: data })
  } catch (error) {
    console.error('Error al listar usuarios:', error)
    res.status(500).json({ error: 'Error al obtener usuarios' })
  }
}

const crearUsuario = async (req, res) => {
  const { nombre, email, password, rol } = req.body

  if (!nombre || !email || !password || !rol) {
    return res.status(400).json({ error: 'Todos los campos son obligatorios' })
  }

  if (!['admin', 'guardia'].includes(rol)) {
    return res.status(400).json({ error: 'El rol debe ser admin o guardia' })
  }

  try {
    // Verificar que el email no exista ya
    const { data: existente } = await supabase
      .from('usuarios')
      .select('id')
      .eq('email', email)
      .single()

    if (existente) {
      return res.status(400).json({ error: 'Ya existe un usuario con ese email' })
    }

    const password_hash = await bcrypt.hash(password, 10)

    const { data, error } = await supabase
      .from('usuarios')
      .insert([{ nombre, email, password_hash, rol }])
      .select('id, nombre, email, rol, activo, creado_en')
      .single()

    if (error) throw error

    res.status(201).json({ mensaje: 'Usuario creado correctamente', usuario: data })
  } catch (error) {
    console.error('Error al crear usuario:', error)
    res.status(500).json({ error: 'Error al crear el usuario' })
  }
}

const toggleActivo = async (req, res) => {
  const { id } = req.params

  try {
    // Obtener estado actual
    const { data: usuario, error: errorGet } = await supabase
      .from('usuarios')
      .select('activo, email')
      .eq('id', id)
      .single()

    if (errorGet || !usuario) {
      return res.status(404).json({ error: 'Usuario no encontrado' })
    }

    // No permitir desactivar al propio usuario
    if (usuario.email === req.usuario.email) {
      return res.status(400).json({ error: 'No podés desactivar tu propia cuenta' })
    }

    const { data, error } = await supabase
      .from('usuarios')
      .update({ activo: !usuario.activo })
      .eq('id', id)
      .select('id, nombre, email, rol, activo')
      .single()

    if (error) throw error

    res.json({
      mensaje: `Usuario ${data.activo ? 'activado' : 'desactivado'} correctamente`,
      usuario: data
    })
  } catch (error) {
    console.error('Error al cambiar estado:', error)
    res.status(500).json({ error: 'Error al actualizar el usuario' })
  }
}

const actualizarUsuario = async (req, res) => {
  const { id } = req.params
  const { nombre, email, password } = req.body

  // Solo el propio usuario o un admin puede editar
  if (req.usuario.id !== id && req.usuario.rol !== 'admin') {
    return res.status(403).json({ error: 'No tenés permiso para editar este usuario' })
  }

  try {
    const actualizacion = {}
    if (nombre) actualizacion.nombre = nombre
    if (email) actualizacion.email = email
    if (password) {
      actualizacion.password_hash = await bcrypt.hash(password, 10)
    }

    if (Object.keys(actualizacion).length === 0) {
      return res.status(400).json({ error: 'No se enviaron datos para actualizar' })
    }

    // Verificar que el nuevo email no esté en uso por otro usuario
    if (email) {
      const { data: existente } = await supabase
        .from('usuarios')
        .select('id')
        .eq('email', email)
        .neq('id', id)
        .single()

      if (existente) {
        return res.status(400).json({ error: 'Ese email ya está en uso por otro usuario' })
      }
    }

    const { data, error } = await supabase
      .from('usuarios')
      .update(actualizacion)
      .eq('id', id)
      .select('id, nombre, email, rol, activo')
      .single()

    if (error) throw error

    res.json({ mensaje: 'Usuario actualizado correctamente', usuario: data })
  } catch (error) {
    console.error('Error al actualizar usuario:', error)
    res.status(500).json({ error: 'Error al actualizar el usuario' })
  }
}

const obtenerPerfil = async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('usuarios')
      .select('id, nombre, email, rol, activo, creado_en')
      .eq('id', req.usuario.id)
      .single()

    if (error) throw error
    res.json({ usuario: data })
  } catch (error) {
    console.error('Error al obtener perfil:', error)
    res.status(500).json({ error: 'Error al obtener el perfil' })
  }
}

module.exports = { listarUsuarios, crearUsuario, toggleActivo, actualizarUsuario, obtenerPerfil }