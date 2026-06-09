const express = require('express')
const router = express.Router()
const { listarUsuarios, crearUsuario, toggleActivo, actualizarUsuario, obtenerPerfil } = require('../controllers/usuariosController')
const { verificarToken, soloAdmin } = require('../middlewares/auth')

router.get('/', verificarToken, soloAdmin, listarUsuarios)
router.post('/', verificarToken, soloAdmin, crearUsuario)
router.patch('/:id/toggle', verificarToken, soloAdmin, toggleActivo)
router.put('/:id', verificarToken, actualizarUsuario)
router.get('/perfil', verificarToken, obtenerPerfil)

module.exports = router