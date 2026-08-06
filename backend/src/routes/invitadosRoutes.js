const express = require('express')
const router = express.Router({ mergeParams: true })
const multer = require('multer')
const config = require('../config/env')
const { importarInvitados, reenviarQR, listarInvitados, eliminarInvitado } = require('../controllers/invitadosController')
const { verificarToken, soloAdmin } = require('../middlewares/auth')
const { limiteImportacion, limiteEmail } = require('../middlewares/rateLimit')

const TIPOS_PERMITIDOS = [
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'application/octet-stream' // algunos navegadores mandan esto para .xlsx
]

// Sin límite de tamaño, memoryStorage permite tumbar el proceso de Render
// subiendo un archivo grande (out of memory).
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxArchivoBytes, files: 1, fields: 10 },
  fileFilter: (req, file, cb) => {
    const extensionOk = /\.xlsx$/i.test(file.originalname || '')
    if (!extensionOk || !TIPOS_PERMITIDOS.includes(file.mimetype)) {
      return cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', 'archivo'))
    }
    cb(null, true)
  }
})

router.post('/importar', verificarToken, soloAdmin, limiteImportacion, upload.single('archivo'), importarInvitados)
router.get('/', verificarToken, soloAdmin, listarInvitados)
router.post('/:invitadoId/reenviar-qr', verificarToken, soloAdmin, limiteEmail, reenviarQR)
router.delete('/:invitadoId', verificarToken, soloAdmin, eliminarInvitado)

module.exports = router
