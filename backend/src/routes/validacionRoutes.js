const express = require('express')
const router = express.Router()
const { validarQR } = require('../controllers/validacionController')
const { verificarToken } = require('../middlewares/auth')
const { limiteValidacion } = require('../middlewares/rateLimit')

router.post('/', verificarToken, limiteValidacion, validarQR)

module.exports = router
