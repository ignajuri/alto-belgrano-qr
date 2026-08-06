const supabase = require('../config/supabase')
const bcrypt = require('bcryptjs')
const jwt = require('jsonwebtoken')
const config = require('../config/env')
const { registrar, ACCIONES } = require('../utils/auditoria')
const { esEmailValido, normalizarEmail } = require('../utils/validacion')

// Hash descartable con el que comparamos cuando el usuario no existe. Sin esto,
// un email inexistente responde en ~1ms y uno existente en ~80ms (el costo de
// bcrypt), y esa diferencia permite enumerar qué cuentas están dadas de alta.
const HASH_DUMMY = '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy'

const CREDENCIALES_INVALIDAS = 'Credenciales incorrectas'

const login = async (req, res) => {
  const email = normalizarEmail(req.body?.email)
  const password = req.body?.password

  if (!email || !password || typeof password !== 'string') {
    return res.status(400).json({ error: 'Email y contraseña son requeridos' })
  }

  if (!esEmailValido(email)) {
    return res.status(401).json({ error: CREDENCIALES_INVALIDAS })
  }

  try {
    const { data: usuario } = await supabase
      .from('usuarios')
      .select('id, nombre, email, rol, activo, password_hash, intentos_fallidos, bloqueado_hasta')
      .eq('email', email)
      .maybeSingle()

    // Bloqueo por cuenta: complementa al rate limit por IP, que un atacante
    // distribuido puede esquivar rotando direcciones.
    if (usuario?.bloqueado_hasta && new Date(usuario.bloqueado_hasta) > new Date()) {
      const minutos = Math.ceil((new Date(usuario.bloqueado_hasta) - new Date()) / 60000)
      await registrar(req, ACCIONES.LOGIN_BLOQUEADO, {
        entidad: 'usuarios', entidadId: usuario.id, detalle: { email }
      })
      return res.status(429).json({
        error: `Cuenta bloqueada temporalmente. Reintentá en ${minutos} minuto(s).`
      })
    }

    // Siempre corremos bcrypt, exista o no el usuario, para que el tiempo de
    // respuesta sea indistinguible.
    const hash = usuario?.password_hash || HASH_DUMMY
    const passwordValida = await bcrypt.compare(password, hash)

    // Un usuario desactivado se trata igual que credenciales inválidas: no le
    // confirmamos al atacante que la cuenta existe.
    if (!usuario || !usuario.activo || !passwordValida) {
      if (usuario) await registrarFallo(req, usuario)
      return res.status(401).json({ error: CREDENCIALES_INVALIDAS })
    }

    // Login correcto: se limpia el contador de fallos.
    await supabase
      .from('usuarios')
      .update({ intentos_fallidos: 0, bloqueado_hasta: null, ultimo_acceso: new Date().toISOString() })
      .eq('id', usuario.id)

    const token = jwt.sign(
      { id: usuario.id, rol: usuario.rol },
      config.jwtSecret,
      { expiresIn: config.jwtExpiracion }
    )

    // req.usuario todavía no está seteado (este endpoint es previo al auth
    // middleware); lo asignamos para que la auditoría registre quién entró.
    req.usuario = { id: usuario.id, email: usuario.email, rol: usuario.rol }
    await registrar(req, ACCIONES.LOGIN_OK, { entidad: 'usuarios', entidadId: usuario.id })

    res.json({
      token,
      usuario: {
        id: usuario.id,
        nombre: usuario.nombre,
        email: usuario.email,
        rol: usuario.rol
      }
    })

  } catch (error) {
    console.error('Error en login:', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

const registrarFallo = async (req, usuario) => {
  const intentos = (usuario.intentos_fallidos || 0) + 1
  const actualizacion = { intentos_fallidos: intentos }

  if (intentos >= config.loginMaxIntentos) {
    actualizacion.bloqueado_hasta = new Date(
      Date.now() + config.loginBloqueoMinutos * 60 * 1000
    ).toISOString()
    actualizacion.intentos_fallidos = 0
  }

  await supabase.from('usuarios').update(actualizacion).eq('id', usuario.id)

  await registrar(req, ACCIONES.LOGIN_FALLIDO, {
    entidad: 'usuarios',
    entidadId: usuario.id,
    detalle: { email: usuario.email, intento: intentos }
  })
}

// Cierre de sesión explícito. Como los JWT son stateless no se pueden invalidar
// de a uno; el frontend descarta el token. Queda registrado para auditoría.
const logout = async (req, res) => {
  await registrar(req, 'logout', { entidad: 'usuarios', entidadId: req.usuario.id })
  res.json({ mensaje: 'Sesión cerrada' })
}

module.exports = { login, logout }
