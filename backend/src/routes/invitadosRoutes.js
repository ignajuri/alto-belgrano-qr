const express = require('express')
const router = express.Router({ mergeParams: true })
const multer = require('multer')
const { importarInvitados, reenviarQR, listarInvitados, eliminarInvitado } = require('../controllers/invitadosController')
const { verificarToken, soloAdmin } = require('../middlewares/auth')

const upload = multer({ storage: multer.memoryStorage() })

router.post('/importar', verificarToken, soloAdmin, upload.single('archivo'), importarInvitados)
router.get('/', verificarToken, soloAdmin, listarInvitados)
router.post('/:invitadoId/reenviar-qr', verificarToken, soloAdmin, reenviarQR)
router.delete('/:invitadoId', verificarToken, soloAdmin, eliminarInvitado)

module.exports = router