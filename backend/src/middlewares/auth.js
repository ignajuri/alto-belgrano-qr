const jwt = require('jsonwebtoken')
const supabase = require('../config/supabase')
const config = require('../config/env')

// El JWT solo prueba que en algún momento hubo un login válido. NO alcanza:
// dura 12 horas y durante ese lapso el usuario puede haber sido desactivado,
// haberle cambiado el rol, o haber cambiado la contraseña tras un robo de token.
// Por eso cada request revalida el estado real contra la base.
const verificarToken = async (req, res, next) => {
  const authHeader = req.headers['authorization']
  const token = authHeader && authHeader.startsWith('Bearer ')
    ? authHeader.slice(7).trim()
    : null

  if (!token) {
    return res.status(401).json({ error: 'Token requerido' })
  }

  let payload
  try {
    payload = jwt.verify(token, config.jwtSecret)
  } catch (error) {
    return res.status(401).json({ error: 'Token inválido o expirado' })
  }

  try {
    const { data: usuario, error } = await supabase
      .from('usuarios')
      .select('id, nombre, email, rol, activo, password_changed_at')
      .eq('id', payload.id)
      .single()

    if (error || !usuario) {
      return res.status(401).json({ error: 'Sesión inválida' })
    }

    if (!usuario.activo) {
      return res.status(403).json({ error: 'Cuenta desactivada' })
    }

    // Cualquier token emitido antes del último cambio de contraseña queda
    // revocado. Es el mecanismo de "cerrar todas las sesiones".
    const cambioPassword = Math.floor(new Date(usuario.password_changed_at).getTime() / 1000)
    if (payload.iat < cambioPassword) {
      return res.status(401).json({ error: 'La sesión expiró, volvé a iniciar sesión' })
    }

    // Usamos el rol de la base, no el del token: si un admin fue degradado a
    // guardia, el cambio surte efecto inmediatamente.
    req.usuario = {
      id: usuario.id,
      nombre: usuario.nombre,
      email: usuario.email,
      rol: usuario.rol
    }
    next()
  } catch (error) {
    console.error('Error al verificar sesión:', error)
    return res.status(500).json({ error: 'Error interno del servidor' })
  }
}

const soloAdmin = (req, res, next) => {
  if (req.usuario?.rol !== 'admin') {
    return res.status(403).json({ error: 'Acceso restringido a administradores' })
  }
  next()
}

module.exports = { verificarToken, soloAdmin }
