const express = require('express')
const router = express.Router()
const {
  crearEvento, editarEvento, listarEventos,
  listarEventosActivos, obtenerEvento, eliminarEvento
} = require('../controllers/eventosController')
const { verificarToken, soloAdmin } = require('../middlewares/auth')

// Accesible a cualquier usuario autenticado: los guardias lo necesitan para
// elegir sobre qué evento están escaneando. Devuelve solo id, nombre y fecha.
// Va antes de '/:id' para que "activos" no se interprete como un identificador.
router.get('/activos', verificarToken, listarEventosActivos)

router.post('/', verificarToken, soloAdmin, crearEvento)
router.get('/', verificarToken, soloAdmin, listarEventos)
router.get('/:id', verificarToken, soloAdmin, obtenerEvento)
router.put('/:id', verificarToken, soloAdmin, editarEvento)
router.delete('/:id', verificarToken, soloAdmin, eliminarEvento)

module.exports = router
