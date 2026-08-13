const supabase = require('../config/supabase')
const bcrypt = require('bcryptjs')
const jwt = require('jsonwebtoken')
const config = require('../config/env')
const { registrar, obtenerIp, ACCIONES } = require('../utils/auditoria')
const { esEmailValido, normalizarEmail, validarPassword } = require('../utils/validacion')
const { generarToken, hashearToken } = require('../utils/tokens')
const { enviarEnlaceRecuperacion, enviarAvisoPasswordCambiada } = require('../services/emailService')

// Mismo costo que usuariosController: cambiarlo en un solo lado dejaría hashes
// con fortalezas distintas según por dónde se haya fijado la contraseña.
const BCRYPT_ROUNDS = 12

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

// ── Recuperación de contraseña ──────────────────────────────────────────────

// La respuesta es SIEMPRE la misma, exista o no la cuenta. Si dijera "no
// encontramos ese email", esta pantalla se convertiría en una herramienta para
// averiguar qué cuentas existen en el sistema.
const RESPUESTA_RECUPERACION = {
  mensaje: 'Si esa dirección corresponde a una cuenta, te enviamos un enlace para restablecer tu contraseña. Revisá tu correo, incluida la carpeta de no deseados.'
}

const solicitarRecuperacion = async (req, res) => {
  const email = normalizarEmail(req.body?.email)

  if (!esEmailValido(email)) {
    return res.json(RESPUESTA_RECUPERACION)
  }

  try {
    const { data: usuario } = await supabase
      .from('usuarios')
      .select('id, nombre, email, activo')
      .eq('email', email)
      .maybeSingle()

    // Cuenta inexistente o desactivada: no se manda nada, misma respuesta.
    if (!usuario || !usuario.activo) {
      await registrar(req, ACCIONES.RECUPERACION_RECHAZADA, {
        detalle: { email, motivo: usuario ? 'cuenta_inactiva' : 'sin_cuenta' }
      })
      return res.json(RESPUESTA_RECUPERACION)
    }

    // Pedir un enlace nuevo invalida los anteriores: solo el último sirve.
    await supabase
      .from('tokens_recuperacion')
      .update({ usado_en: new Date().toISOString() })
      .eq('usuario_id', usuario.id)
      .is('usado_en', null)

    const token = generarToken()
    const expira = new Date(Date.now() + config.recuperacionMinutos * 60 * 1000)

    const { error } = await supabase.from('tokens_recuperacion').insert([{
      usuario_id: usuario.id,
      token_hash: hashearToken(token),
      expira_en: expira.toISOString(),
      ip: obtenerIp(req)
    }])

    if (error) throw error

    await registrar(req, ACCIONES.RECUPERACION_SOLICITADA, {
      entidad: 'usuarios', entidadId: usuario.id, detalle: { email }
    })

    // Sin await a propósito: si esperáramos a Resend, una cuenta existente
    // tardaría casi un segundo más que una inexistente, y esa diferencia
    // permitiría deducir qué emails están registrados.
    const enlace = `${config.appUrl}/restablecer?token=${encodeURIComponent(token)}`
    enviarEnlaceRecuperacion(usuario, enlace, config.recuperacionMinutos)
      .catch(err => console.error(`[email] falló el enlace de recuperación: ${err.message}`))

    res.json(RESPUESTA_RECUPERACION)

  } catch (error) {
    console.error('Error al solicitar recuperación:', error)
    // Ni siquiera acá revelamos algo distinto.
    res.json(RESPUESTA_RECUPERACION)
  }
}

const restablecerPassword = async (req, res) => {
  const token = req.body?.token
  const password = req.body?.password

  if (!token || typeof token !== 'string') {
    return res.status(400).json({ error: 'Enlace inválido' })
  }

  const errorPassword = validarPassword(password)
  if (errorPassword) {
    return res.status(400).json({ error: errorPassword })
  }

  try {
    const ahora = new Date().toISOString()

    // El token se reclama de forma atómica ANTES de tocar la contraseña:
    // condicionado a no usado y no vencido. Si alguien envía el formulario dos
    // veces, solo la primera afecta una fila.
    const { data: reclamados, error: errorReclamo } = await supabase
      .from('tokens_recuperacion')
      .update({ usado_en: ahora })
      .eq('token_hash', hashearToken(token))
      .is('usado_en', null)
      .gt('expira_en', ahora)
      .select('id, usuario_id')

    if (errorReclamo) throw errorReclamo

    if (!reclamados || reclamados.length === 0) {
      await registrar(req, ACCIONES.RECUPERACION_RECHAZADA, {
        detalle: { motivo: 'token_invalido_vencido_o_usado' }
      })
      return res.status(400).json({
        error: 'El enlace no es válido, ya fue utilizado o venció. Pedí uno nuevo.'
      })
    }

    const { data: usuario } = await supabase
      .from('usuarios')
      .select('id, nombre, email, activo')
      .eq('id', reclamados[0].usuario_id)
      .maybeSingle()

    if (!usuario || !usuario.activo) {
      return res.status(400).json({ error: 'La cuenta no está disponible' })
    }

    const password_hash = await bcrypt.hash(password, BCRYPT_ROUNDS)

    // password_changed_at invalida todos los JWT previos (ver middleware de
    // auth): restablecer cierra las sesiones abiertas en todos los dispositivos.
    //
    // El bloqueo por intentos fallidos también se levanta: demostrar control de
    // la casilla de correo es una prueba de identidad más fuerte que saber la
    // contraseña, y si no se levantara la persona restablecería su clave y aun
    // así no podría entrar.
    const { error: errorUpdate } = await supabase
      .from('usuarios')
      .update({
        password_hash,
        password_changed_at: ahora,
        intentos_fallidos: 0,
        bloqueado_hasta: null
      })
      .eq('id', usuario.id)

    if (errorUpdate) throw errorUpdate

    req.usuario = { id: usuario.id, email: usuario.email }
    await registrar(req, ACCIONES.RECUPERACION_COMPLETADA, {
      entidad: 'usuarios', entidadId: usuario.id
    })

    enviarAvisoPasswordCambiada(usuario)
      .catch(err => console.error(`[email] falló el aviso de cambio: ${err.message}`))

    res.json({ mensaje: 'Tu contraseña se actualizó. Ya podés iniciar sesión.' })

  } catch (error) {
    console.error('Error al restablecer contraseña:', error)
    res.status(500).json({ error: 'Error al restablecer la contraseña' })
  }
}

// Cierre de sesión explícito. Como los JWT son stateless no se pueden invalidar
// de a uno; el frontend descarta el token. Queda registrado para auditoría.
const logout = async (req, res) => {
  await registrar(req, 'logout', { entidad: 'usuarios', entidadId: req.usuario.id })
  res.json({ mensaje: 'Sesión cerrada' })
}

module.exports = { login, logout, solicitarRecuperacion, restablecerPassword }
