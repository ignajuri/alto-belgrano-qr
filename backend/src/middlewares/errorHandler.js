const multer = require('multer')
const config = require('../config/env')

const noEncontrado = (req, res) => {
  res.status(404).json({ error: 'Recurso no encontrado' })
}

// Handler global: garantiza que ningún stack trace ni detalle interno de
// Supabase llegue al cliente.
// eslint-disable-next-line no-unused-vars
const manejadorErrores = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      const mb = Math.round(config.maxArchivoBytes / (1024 * 1024))
      return res.status(413).json({ error: `El archivo supera el límite de ${mb} MB` })
    }
    return res.status(400).json({ error: 'Error al procesar el archivo subido' })
  }

  if (err?.type === 'entity.too.large') {
    return res.status(413).json({ error: 'El cuerpo de la solicitud es demasiado grande' })
  }

  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'JSON inválido' })
  }

  if (err?.message === 'ORIGEN_NO_PERMITIDO') {
    return res.status(403).json({ error: 'Origen no permitido' })
  }

  console.error('[error no manejado]', err)
  res.status(500).json({ error: 'Error interno del servidor' })
}

module.exports = { noEncontrado, manejadorErrores }
