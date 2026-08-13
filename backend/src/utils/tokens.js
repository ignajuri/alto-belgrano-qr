const crypto = require('crypto')

// 32 bytes del CSPRNG del sistema: 256 bits de entropía, imposible de adivinar
// por fuerza bruta. base64url para que viaje limpio en una URL, sin caracteres
// que haya que escapar.
const generarToken = () => crypto.randomBytes(32).toString('base64url')

// Lo que se guarda en la base es este hash, nunca el token. SHA-256 alcanza:
// a diferencia de una contraseña, el token ya es aleatorio de 256 bits, así que
// no hay diccionario posible y no hace falta el costo de bcrypt.
const hashearToken = (token) =>
  crypto.createHash('sha256').update(token).digest('hex')

module.exports = { generarToken, hashearToken }
