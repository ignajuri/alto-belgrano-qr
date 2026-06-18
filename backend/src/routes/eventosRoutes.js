const express = require('express')
const router = express.Router()
const { crearEvento, editarEvento, listarEventos, obtenerEvento, eliminarEvento } = require('../controllers/eventosController')
const { verificarToken, soloAdmin } = require('../middlewares/auth')

router.post('/', verificarToken, soloAdmin, crearEvento)
router.get('/', verificarToken, soloAdmin, listarEventos)
router.get('/:id', verificarToken, soloAdmin, obtenerEvento)
router.put('/:id', verificarToken, soloAdmin, editarEvento)
router.delete('/:id', verificarToken, soloAdmin, eliminarEvento)

module.exports = router