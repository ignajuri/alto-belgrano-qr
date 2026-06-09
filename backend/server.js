require('dotenv').config()
const express = require('express')
const cors = require('cors')

const authRoutes = require('./src/routes/authRoutes')
const eventosRoutes = require('./src/routes/eventosRoutes')
const invitadosRoutes = require('./src/routes/invitadosRoutes')
const validacionRoutes = require('./src/routes/validacionRoutes')
const usuariosRoutes = require('./src/routes/usuariosRoutes')

const app = express()

app.use(cors())
app.use(express.json())

app.use('/api/auth', authRoutes)
app.use('/api/eventos', eventosRoutes)
app.use('/api/eventos/:id/invitados', invitadosRoutes)
app.use('/api/validar', validacionRoutes)
app.use('/api/usuarios', usuariosRoutes)

app.get('/', (req, res) => {
  res.json({ mensaje: 'Servidor Alto Belgrano QR funcionando' })
})

const PORT = process.env.PORT || 3000
app.listen(PORT, () => {
  console.log(`Servidor corriendo en puerto ${PORT}`)
})
