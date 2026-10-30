const express = require('express')
const router = express.Router({ mergeParams: true })
const {
  importarGrupos, listarGrupos, editarGrupo, reenviarGrupo, eliminarGrupo
} = require('../controllers/gruposController')
const { upload } = require('./invitadosRoutes')
const { verificarToken, soloAdmin } = require('../middlewares/auth')
const { limiteImportacion, limiteEmail } = require('../middlewares/rateLimit')

// Familias de una fiesta de egresados. Todo es exclusivo del administrador;
// el guardia solo usa el escáner.
router.post('/importar', verificarToken, soloAdmin, limiteImportacion, upload.single('archivo'), importarGrupos)
router.get('/', verificarToken, soloAdmin, listarGrupos)
router.put('/:grupoId', verificarToken, soloAdmin, limiteEmail, editarGrupo)
router.post('/:grupoId/reenviar', verificarToken, soloAdmin, limiteEmail, reenviarGrupo)
router.delete('/:grupoId', verificarToken, soloAdmin, eliminarGrupo)

module.exports = router
