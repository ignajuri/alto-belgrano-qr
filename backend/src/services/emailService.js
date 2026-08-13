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
  <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 20px; color: #1f2937;">
    <h2 style="color: #1a3a6b;">¡Hola ${escaparHtml(invitado.nombre)}!</h2>
    <p>Estás invitado/a a <strong>${escaparHtml(evento.nombre_evento)}</strong>, en el Salón Alto Belgrano.</p>
    <p><strong>Fecha:</strong> ${escaparHtml(formatearFecha(evento.fecha))}<br/>
       <strong>Lugar:</strong> Salón Alto Belgrano, Mendoza</p>
    <p>Presentá este código QR en la entrada. Podés mostrarlo desde el celular
       o llevarlo impreso, como te resulte más cómodo.</p>
    <div style="text-align: center; margin: 30px 0;">
      <img src="cid:qr-code" alt="Código QR de tu invitación" width="250"/>
    </div>
    <p style="color: #4b5563; font-size: 14px;">
      Tu código es personal e intransferible, y se puede usar una sola vez.
      Si no vas a poder asistir, avisale a quien te invitó.
    </p>
    <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;"/>
    <p style="color: #6b7280; font-size: 13px; margin: 0;">
      Salón Alto Belgrano — Mendoza, Argentina<br/>
      Recibiste este correo porque figurás en la lista de invitados de este evento.
    </p>
  </div>
`

// Alternativa en texto plano. Un correo que es casi solo una imagen y no trae
// versión de texto puntúa peor en los filtros de spam (Outlook en particular).
// Además es lo que ven los lectores que no renderizan HTML.
const generarTextoEmail = (invitado, evento) => `¡Hola ${invitado.nombre}!

Estás invitado/a a ${evento.nombre_evento}, en el Salón Alto Belgrano.

Fecha: ${formatearFecha(evento.fecha)}
Lugar: Salón Alto Belgrano, Mendoza

Presentá en la entrada el código QR que va adjunto a este correo
(archivo qr-invitacion.png). Podés mostrarlo desde el celular o
llevarlo impreso.

Tu código es personal e intransferible, y se puede usar una sola vez.
Si no vas a poder asistir, avisale a quien te invitó.

--
Salón Alto Belgrano — Mendoza, Argentina
Recibiste este correo porque figurás en la lista de invitados de este evento.`

const enviarInvitacion = async (invitado, evento) => {
  const qrBase64 = await QRCode.toDataURL(invitado.qr_token, { width: 300, margin: 2 })
  const qrImagen = qrBase64.replace('data:image/png;base64,', '')

  const { error } = await resend.emails.send({
    from: config.emailRemitente,
    to: invitado.email,
    subject: `Tu invitación para ${evento.nombre_evento}`,
    html: generarHtmlEmail(invitado, evento),
    text: generarTextoEmail(invitado, evento),
    // Un Reply-To que apunte a una casilla real evita que las respuestas
    // reboten. Los filtros penalizan a los dominios que mandan pero no reciben.
    ...(config.emailRespuesta ? { replyTo: config.emailRespuesta } : {}),
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
