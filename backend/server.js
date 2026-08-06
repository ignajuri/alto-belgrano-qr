const config = require('./src/config/env')
const express = require('express')
const cors = require('cors')
const helmet = require('helmet')

const authRoutes = require('./src/routes/authRoutes')
const eventosRoutes = require('./src/routes/eventosRoutes')
const invitadosRoutes = require('./src/routes/invitadosRoutes')
const validacionRoutes = require('./src/routes/validacionRoutes')
const usuariosRoutes = require('./src/routes/usuariosRoutes')
const { limiteGeneral } = require('./src/middlewares/rateLimit')
const { noEncontrado, manejadorErrores } = require('./src/middlewares/errorHandler')

const app = express()

// Render corre detrás de un proxy: sin esto, express-rate-limit vería la IP del
// proxy para todo el tráfico y limitaría a todos los usuarios como si fueran uno.
app.set('trust proxy', 1)
app.disable('x-powered-by')

app.use(helmet({
  // La API solo devuelve JSON, no renderiza HTML: no necesita CSP propia.
  contentSecurityPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  hsts: { maxAge: 31536000, includeSubDomains: true, preload: true }
}))

// CORS restringido: antes aceptaba cualquier origen.
app.use(cors({
  origin: (origen, callback) => {
    // Sin cabecera Origin (curl, health checks, apps nativas) se permite:
    // esas peticiones no son cross-origin y CORS no aplica.
    if (!origen) return callback(null, true)
    if (config.corsOrigenes.includes(origen)) return callback(null, true)
    return callback(new Error('ORIGEN_NO_PERMITIDO'))
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  maxAge: 86400
}))

app.use(express.json({ limit: '100kb' }))
app.use(express.urlencoded({ extended: false, limit: '100kb' }))

app.use('/api', limiteGeneral)

app.use('/api/auth', authRoutes)
app.use('/api/eventos', eventosRoutes)
app.use('/api/eventos/:id/invitados', invitadosRoutes)
app.use('/api/validar', validacionRoutes)
app.use('/api/usuarios', usuariosRoutes)

app.get('/', (req, res) => {
  res.json({ mensaje: 'Servidor Alto Belgrano QR funcionando' })
})

// Para el health check de Render, sin pasar por el rate limit de /api.
app.get('/health', (req, res) => {
  res.json({ estado: 'ok', hora: new Date().toISOString() })
})

app.use(noEncontrado)
app.use(manejadorErrores)

app.listen(config.puerto, () => {
  console.log(`Servidor corriendo en puerto ${config.puerto} [${config.entorno}]`)
  console.log(`Orígenes CORS permitidos: ${config.corsOrigenes.join(', ')}`)
})
