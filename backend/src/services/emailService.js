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

// ── Recuperación de contraseña ──────────────────────────────────────────────

const enviarEnlaceRecuperacion = async (usuario, enlace, minutos) => {
  const nombre = escaparHtml(usuario.nombre)
  const url = escaparHtml(enlace)

  const { error } = await resend.emails.send({
    from: config.emailRemitente,
    to: usuario.email,
    subject: 'Restablecer tu contraseña — Alto Belgrano',
    ...(config.emailRespuesta ? { replyTo: config.emailRespuesta } : {}),
    html: `
  <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 20px; color: #1f2937;">
    <h2 style="color: #1a3a6b;">Hola ${nombre}</h2>
    <p>Pediste restablecer la contraseña de tu cuenta del sistema de acceso del
       Salón Alto Belgrano.</p>
    <div style="text-align: center; margin: 32px 0;">
      <a href="${url}" style="display: inline-block; background-color: #1d4ed8; color: #ffffff;
         padding: 14px 28px; border-radius: 8px; text-decoration: none; font-weight: bold;">
        Restablecer mi contraseña
      </a>
    </div>
    <p style="color: #4b5563; font-size: 14px;">
      El enlace vence en ${minutos} minutos y se puede usar una sola vez.
    </p>
    <p style="color: #4b5563; font-size: 14px;">
      <strong>Si no pediste esto, ignorá el correo.</strong> Tu contraseña no
      cambia hasta que uses el enlace.
    </p>
    <p style="color: #6b7280; font-size: 13px;">
      Si el botón no funciona, copiá y pegá esta dirección en el navegador:<br/>
      <span style="word-break: break-all;">${url}</span>
    </p>
    <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;"/>
    <p style="color: #6b7280; font-size: 13px; margin: 0;">
      Salón Alto Belgrano — Mendoza, Argentina
    </p>
  </div>`,
    text: `Hola ${usuario.nombre}

Pediste restablecer la contraseña de tu cuenta del sistema de acceso del
Salón Alto Belgrano.

Entrá a esta dirección para elegir una nueva:

${enlace}

El enlace vence en ${minutos} minutos y se puede usar una sola vez.

Si no pediste esto, ignorá el correo: tu contraseña no cambia hasta que
uses el enlace.

--
Salón Alto Belgrano — Mendoza, Argentina`
  })

  if (error) throw new Error(error.message || 'Resend rechazó el envío')
}

// Aviso posterior al cambio. Es la alarma del sistema: si alguien lograra
// restablecer la contraseña de una cuenta ajena, el dueño se entera en el
// momento en vez de descubrirlo cuando no puede entrar.
const enviarAvisoPasswordCambiada = async (usuario) => {
  const nombre = escaparHtml(usuario.nombre)
  const cuando = new Date().toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })

  const { error } = await resend.emails.send({
    from: config.emailRemitente,
    to: usuario.email,
    subject: 'Tu contraseña fue cambiada — Alto Belgrano',
    ...(config.emailRespuesta ? { replyTo: config.emailRespuesta } : {}),
    html: `
  <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 20px; color: #1f2937;">
    <h2 style="color: #1a3a6b;">Hola ${nombre}</h2>
    <p>La contraseña de tu cuenta del Salón Alto Belgrano se cambió el
       <strong>${escaparHtml(cuando)}</strong>.</p>
    <p>Todas las sesiones que tenías abiertas se cerraron.</p>
    <div style="background-color: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 16px; margin: 24px 0;">
      <p style="margin: 0; color: #b91c1c; font-size: 14px;">
        <strong>Si no fuiste vos</strong>, avisá de inmediato a la administración
        del salón para que desactiven la cuenta.
      </p>
    </div>
    <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;"/>
    <p style="color: #6b7280; font-size: 13px; margin: 0;">
      Salón Alto Belgrano — Mendoza, Argentina
    </p>
  </div>`,
    text: `Hola ${usuario.nombre}

La contraseña de tu cuenta del Salón Alto Belgrano se cambió el ${cuando}.
Todas las sesiones que tenías abiertas se cerraron.

Si no fuiste vos, avisá de inmediato a la administración del salón para que
desactiven la cuenta.

--
Salón Alto Belgrano — Mendoza, Argentina`
  })

  if (error) throw new Error(error.message || 'Resend rechazó el envío')
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

module.exports = {
  enviarInvitacion,
  enviarInvitacionesEnLote,
  enviarEnlaceRecuperacion,
  enviarAvisoPasswordCambiada
}
