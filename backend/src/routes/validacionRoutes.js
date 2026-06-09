const express = require('express')
const router = express.Router()
const { validarQR } = require('../controllers/validacionController')
const { verificarToken } = require('../middlewares/auth')

router.post('/', verificarToken, validarQR)

module.exports = router