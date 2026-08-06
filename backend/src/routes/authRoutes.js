const express = require('express')
const router = express.Router()
const { login, logout } = require('../controllers/authController')
const { verificarToken } = require('../middlewares/auth')
const { limiteLogin } = require('../middlewares/rateLimit')

router.post('/login', limiteLogin, login)
router.post('/logout', verificarToken, logout)

module.exports = router
