const express = require('express')
const router = express.Router()
const { login, logout, solicitarRecuperacion, restablecerPassword } = require('../controllers/authController')
const { verificarToken } = require('../middlewares/auth')
const { limiteLogin, limiteRecuperacion, limiteRestablecer } = require('../middlewares/rateLimit')

router.post('/login', limiteLogin, login)
router.post('/logout', verificarToken, logout)

// Públicas por necesidad: quien las usa es justamente alguien que no puede
// autenticarse. La protección está en el rate limit, en que la respuesta no
// revela si la cuenta existe, y en que el token es de un solo uso y vence.
router.post('/recuperar', limiteRecuperacion, solicitarRecuperacion)
router.post('/restablecer', limiteRestablecer, restablecerPassword)

module.exports = router
