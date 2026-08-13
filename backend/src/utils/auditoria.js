const supabase = require('../config/supabase')

// Registro de acciones sensibles. Nunca debe romper el request principal:
// si la auditoría falla, se loguea y se sigue.
const registrar = async (req, accion, { entidad, entidadId, detalle } = {}) => {
  try {
    await supabase.from('auditoria').insert([{
      usuario_id: req.usuario?.id || null,
      usuario_email: req.usuario?.email || detalle?.email || null,
      accion,
      entidad: entidad || null,
      entidad_id: entidadId ? String(entidadId) : null,
      detalle: detalle || null,
      ip: obtenerIp(req)
    }])
  } catch (error) {
    console.error('[auditoria] no se pudo registrar', accion, error.message)
  }
}

// Render corre detrás de un proxy, así que la IP real viene en X-Forwarded-For.
// Con `trust proxy` configurado en Express, req.ip ya la resuelve.
const obtenerIp = (req) => {
  const ip = req.ip || req.socket?.remoteAddress || ''
  return String(ip).slice(0, 64)
}

const ACCIONES = {
  LOGIN_OK: 'login_exitoso',
  LOGIN_FALLIDO: 'login_fallido',
  LOGIN_BLOQUEADO: 'login_bloqueado',
  USUARIO_CREADO: 'usuario_creado',
  USUARIO_ACTUALIZADO: 'usuario_actualizado',
  USUARIO_TOGGLE: 'usuario_estado_cambiado',
  PASSWORD_CAMBIADA: 'password_cambiada',
  RECUPERACION_SOLICITADA: 'recuperacion_solicitada',
  RECUPERACION_COMPLETADA: 'recuperacion_completada',
  RECUPERACION_RECHAZADA: 'recuperacion_rechazada',
  EVENTO_CREADO: 'evento_creado',
  EVENTO_ACTUALIZADO: 'evento_actualizado',
  EVENTO_ELIMINADO: 'evento_eliminado',
  INVITADOS_IMPORTADOS: 'invitados_importados',
  INVITADO_CREADO: 'invitado_creado',
  INVITADO_EDITADO: 'invitado_editado',
  INVITADO_ELIMINADO: 'invitado_eliminado',
  QR_REENVIADO: 'qr_reenviado',
  QR_VALIDADO: 'qr_validado',
  QR_RECHAZADO: 'qr_rechazado',
  INGRESO_DESHECHO: 'ingreso_deshecho'
}

module.exports = { registrar, obtenerIp, ACCIONES }
