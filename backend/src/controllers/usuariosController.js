const supabase = require('../config/supabase')
const bcrypt = require('bcryptjs')
const { registrar, ACCIONES } = require('../utils/auditoria')
const {
  esUuid, esEmailValido, normalizarEmail, validarPassword, texto
} = require('../utils/validacion')

const BCRYPT_ROUNDS = 12

const CAMPOS_PUBLICOS = 'id, nombre, email, rol, activo, creado_en, ultimo_acceso'

const listarUsuarios = async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('usuarios')
      .select(CAMPOS_PUBLICOS)
      .order('creado_en', { ascending: false })

    if (error) throw error
    res.json({ usuarios: data })
  } catch (error) {
    console.error('Error al listar usuarios:', error)
    res.status(500).json({ error: 'Error al obtener usuarios' })
  }
}

const crearUsuario = async (req, res) => {
  const nombre = texto(req.body?.nombre, 120)
  const email = normalizarEmail(req.body?.email)
  const password = req.body?.password
  const rol = req.body?.rol

  if (!nombre || !email || !password || !rol) {
    return res.status(400).json({ error: 'Todos los campos son obligatorios' })
  }

  if (!esEmailValido(email)) {
    return res.status(400).json({ error: 'El email no tiene un formato válido' })
  }

  if (!['admin', 'guardia'].includes(rol)) {
    return res.status(400).json({ error: 'El rol debe ser admin o guardia' })
  }

  const errorPassword = validarPassword(password)
  if (errorPassword) {
    return res.status(400).json({ error: errorPassword })
  }

  try {
    const { data: existente } = await supabase
      .from('usuarios')
      .select('id')
      .eq('email', email)
      .maybeSingle()

    if (existente) {
      return res.status(409).json({ error: 'Ya existe un usuario con ese email' })
    }

    const password_hash = await bcrypt.hash(password, BCRYPT_ROUNDS)

    const { data, error } = await supabase
      .from('usuarios')
      .insert([{ nombre, email, password_hash, rol }])
      .select(CAMPOS_PUBLICOS)
      .single()

    if (error) throw error

    await registrar(req, ACCIONES.USUARIO_CREADO, {
      entidad: 'usuarios', entidadId: data.id, detalle: { email, rol }
    })

    res.status(201).json({ mensaje: 'Usuario creado correctamente', usuario: data })
  } catch (error) {
    console.error('Error al crear usuario:', error)
    res.status(500).json({ error: 'Error al crear el usuario' })
  }
}

const toggleActivo = async (req, res) => {
  const { id } = req.params

  if (!esUuid(id)) {
    return res.status(400).json({ error: 'Identificador inválido' })
  }

  try {
    const { data: usuario } = await supabase
      .from('usuarios')
      .select('id, activo, email, rol')
      .eq('id', id)
      .maybeSingle()

    if (!usuario) {
      return res.status(404).json({ error: 'Usuario no encontrado' })
    }

    if (usuario.id === req.usuario.id) {
      return res.status(400).json({ error: 'No podés desactivar tu propia cuenta' })
    }

    // Impide quedarse sin ningún admin activo capaz de administrar el sistema.
    if (usuario.activo && usuario.rol === 'admin') {
      const { count } = await supabase
        .from('usuarios')
        .select('id', { count: 'exact', head: true })
        .eq('rol', 'admin')
        .eq('activo', true)

      if ((count || 0) <= 1) {
        return res.status(400).json({ error: 'No podés desactivar al único administrador activo' })
      }
    }

    const { data, error } = await supabase
      .from('usuarios')
      .update({ activo: !usuario.activo })
      .eq('id', id)
      .select('id, nombre, email, rol, activo')
      .single()

    if (error) throw error

    await registrar(req, ACCIONES.USUARIO_TOGGLE, {
      entidad: 'usuarios', entidadId: id, detalle: { email: usuario.email, activo: data.activo }
    })

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
  const { password_actual, password } = req.body || {}

  if (!esUuid(id)) {
    return res.status(400).json({ error: 'Identificador inválido' })
  }

  const esPropio = req.usuario.id === id
  const esAdmin = req.usuario.rol === 'admin'

  if (!esPropio && !esAdmin) {
    return res.status(403).json({ error: 'No tenés permiso para editar este usuario' })
  }

  try {
    const { data: objetivo } = await supabase
      .from('usuarios')
      .select('id, email, password_hash')
      .eq('id', id)
      .maybeSingle()

    if (!objetivo) {
      return res.status(404).json({ error: 'Usuario no encontrado' })
    }

    const actualizacion = {}

    if (req.body?.nombre !== undefined) {
      const nombre = texto(req.body.nombre, 120)
      if (!nombre) return res.status(400).json({ error: 'El nombre no puede estar vacío' })
      actualizacion.nombre = nombre
    }

    if (req.body?.email !== undefined) {
      const email = normalizarEmail(req.body.email)
      if (!esEmailValido(email)) {
        return res.status(400).json({ error: 'El email no tiene un formato válido' })
      }
      actualizacion.email = email
    }

    if (password !== undefined && password !== '') {
      const errorPassword = validarPassword(password)
      if (errorPassword) {
        return res.status(400).json({ error: errorPassword })
      }

      // Cambiar la propia contraseña exige conocer la anterior. Sin esto, quien
      // se apodere de una sesión abierta o de un token robado se queda con la
      // cuenta de forma permanente.
      if (esPropio) {
        if (!password_actual || typeof password_actual !== 'string') {
          return res.status(400).json({ error: 'Ingresá tu contraseña actual para cambiarla' })
        }
        const coincide = await bcrypt.compare(password_actual, objetivo.password_hash)
        if (!coincide) {
          return res.status(401).json({ error: 'La contraseña actual es incorrecta' })
        }
      }

      actualizacion.password_hash = await bcrypt.hash(password, BCRYPT_ROUNDS)
      // Invalida todos los JWT emitidos antes de este momento (ver middleware
      // de auth): cambiar la contraseña cierra el resto de las sesiones.
      actualizacion.password_changed_at = new Date().toISOString()
    }

    if (Object.keys(actualizacion).length === 0) {
      return res.status(400).json({ error: 'No se enviaron datos para actualizar' })
    }

    if (actualizacion.email && actualizacion.email !== objetivo.email) {
      const { data: existente } = await supabase
        .from('usuarios')
        .select('id')
        .eq('email', actualizacion.email)
        .neq('id', id)
        .maybeSingle()

      if (existente) {
        return res.status(409).json({ error: 'Ese email ya está en uso por otro usuario' })
      }
    }

    const { data, error } = await supabase
      .from('usuarios')
      .update(actualizacion)
      .eq('id', id)
      .select('id, nombre, email, rol, activo')
      .single()

    if (error) throw error

    await registrar(req, ACCIONES.USUARIO_ACTUALIZADO, {
      entidad: 'usuarios',
      entidadId: id,
      detalle: { campos: Object.keys(actualizacion).filter(c => c !== 'password_hash') }
    })

    if (actualizacion.password_hash) {
      await registrar(req, ACCIONES.PASSWORD_CAMBIADA, { entidad: 'usuarios', entidadId: id })
    }

    res.json({
      mensaje: 'Usuario actualizado correctamente',
      usuario: data,
      // El frontend usa esto para saber que tiene que volver a loguearse.
      sesionInvalidada: Boolean(actualizacion.password_hash) && esPropio
    })
  } catch (error) {
    console.error('Error al actualizar usuario:', error)
    res.status(500).json({ error: 'Error al actualizar el usuario' })
  }
}

const obtenerPerfil = async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('usuarios')
      .select(CAMPOS_PUBLICOS)
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
