const QRCode = require('qrcode')
const { Resend } = require('resend')
const supabase = require('../config/supabase')
const config = require('../config/env')
const { escaparHtml } = require('../utils/html')

const resend = new Resend(config.resendApiKey)

const formatearFecha = (fecha) => {
  try {
    return new Date(fecha + 'T12:00:00').toLocaleDateString('es-AR', {
      day: '2-digit', month: 'long', year: 'numeric'
    })
  } catch {
    return fecha
  }
}

// Todo dato que venga del Excel o de un formulario se escapa antes de entrar al
// HTML. Sin esto, un nombre con etiquetas convierte la invitación en un vector
// de phishing enviado desde nuestro propio remitente.
const generarHtmlEmail = (invitado, evento) => `
  <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 20px;">
    <h2 style="color: #1a3a6b;">¡Hola ${escaparHtml(invitado.nombre)}!</h2>
    <p>Estás invitado/a a <strong>${escaparHtml(evento.nombre_evento)}</strong>.</p>
    <p><strong>Fecha:</strong> ${escaparHtml(formatearFecha(evento.fecha))}</p>
    <p>Presentá este código QR en la entrada del evento:</p>
    <div style="text-align: center; margin: 30px 0;">
      <img src="cid:qr-code" alt="Código QR" width="250"/>
    </div>
    <p style="color: #666; font-size: 13px;">Este QR es personal e intransferible. Solo puede usarse una vez.</p>
    <p style="color: #666; font-size: 13px;">Salón Alto Belgrano — Mendoza</p>
  </div>
`

const enviarInvitacion = async (invitado, evento) => {
  const qrBase64 = await QRCode.toDataURL(invitado.qr_token, { width: 300, margin: 2 })
  const qrImagen = qrBase64.replace('data:image/png;base64,', '')

  const { error } = await resend.emails.send({
    from: config.emailRemitente,
    to: invitado.email,
    subject: `Tu invitación para ${evento.nombre_evento}`,
    html: generarHtmlEmail(invitado, evento),
    attachments: [{ filename: 'qr-invitacion.png', content: qrImagen, content_id: 'qr-code' }]
  })

  // El SDK de Resend devuelve el error en la respuesta en vez de lanzarlo.
  if (error) throw new Error(error.message || 'Resend rechazó el envío')

  await supabase.from('invitados').update({ qr_enviado: true }).eq('id', invitado.id)
}

const esperar = (ms) => new Promise(resolve => setTimeout(resolve, ms))

// Envío en segundo plano: la request HTTP responde apenas se insertan los
// invitados y los correos salen después, espaciados para respetar el rate limit
// de Resend. Antes, importar 200 invitados bloqueaba el request hasta el
// timeout del cliente.
const enviarInvitacionesEnLote = async (invitados, evento) => {
  let enviados = 0
  let fallidos = 0

  for (const invitado of invitados) {
    try {
      await enviarInvitacion(invitado, evento)
      enviados++
    } catch (error) {
      fallidos++
      // No logueamos el email completo para no volcar datos personales a los
      // logs de Render, que son retenidos por el proveedor.
      console.error(`[email] falló el envío al invitado ${invitado.id}: ${error.message}`)
    }
    await esperar(config.emailIntervaloMs)
  }

  console.log(`[email] lote del evento ${evento.id}: ${enviados} enviados, ${fallidos} fallidos`)
}

module.exports = { enviarInvitacion, enviarInvitacionesEnLote }
