// Los nombres de invitados y eventos vienen de un Excel subido y de formularios.
// Si se interpolan crudos en el HTML de un email, un nombre como
//   Juan<a href="http://sitio-falso.com">Confirmá acá</a>
// convierte la invitación en phishing enviado desde nuestro propio dominio.
const escaparHtml = (valor) => {
  if (valor === null || valor === undefined) return ''
  return String(valor)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

module.exports = { escaparHtml }
