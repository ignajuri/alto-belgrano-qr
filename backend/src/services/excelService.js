const ExcelJS = require('exceljs')
const {
  normalizarEmail, esEmailValido, normalizarDni, esDniValido, texto, enteroNoNegativo
} = require('../utils/validacion')

const MAX_FILAS = 2000

const COLUMNAS = ['nombre', 'apellido', 'dni', 'email']

// ExcelJS devuelve objetos para celdas con hipervínculo o texto enriquecido.
// Esta función las aplana siempre a string.
const celdaATexto = (valor) => {
  if (valor === null || valor === undefined) return ''
  if (typeof valor === 'object') {
    if (valor.text) return String(valor.text)
    if (valor.hyperlink) return String(valor.hyperlink).replace(/^mailto:/i, '')
    if (Array.isArray(valor.richText)) return valor.richText.map(t => t.text).join('')
    if (valor.result !== undefined) return String(valor.result)
    return ''
  }
  return String(valor)
}

// Reemplaza a SheetJS 0.18.5, que arrastra prototype pollution (CVE-2023-30533)
// y ReDoS (CVE-2024-22363) sin parche disponible en npm.
const leerInvitados = async (buffer) => {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(buffer)

  const hoja = workbook.worksheets[0]
  if (!hoja) {
    return { error: 'El archivo no contiene ninguna hoja' }
  }

  // Mapeo de encabezados: acepta las columnas en cualquier orden.
  const encabezados = {}
  const filaEncabezado = hoja.getRow(1)
  filaEncabezado.eachCell((celda, col) => {
    const nombre = celdaATexto(celda.value).trim().toLowerCase()
    if (COLUMNAS.includes(nombre)) encabezados[nombre] = col
  })

  const faltantes = COLUMNAS.filter(c => !encabezados[c])
  if (faltantes.length > 0) {
    return { error: `El Excel debe tener las columnas: ${COLUMNAS.join(', ')}. Faltan: ${faltantes.join(', ')}` }
  }

  const filasTotales = hoja.rowCount - 1
  if (filasTotales > MAX_FILAS) {
    return { error: `El archivo tiene ${filasTotales} filas. El máximo permitido es ${MAX_FILAS}.` }
  }

  const errores = []
  const invitados = []
  const dnisEnArchivo = new Set()

  for (let n = 2; n <= hoja.rowCount; n++) {
    const fila = hoja.getRow(n)
    const leer = (col) => celdaATexto(fila.getCell(encabezados[col]).value).trim()

    const nombre = texto(leer('nombre'), 120)
    const apellido = texto(leer('apellido'), 120)
    const dni = normalizarDni(leer('dni'))
    const email = normalizarEmail(leer('email'))

    // Fila completamente vacía: la salteamos sin reportar error.
    if (!nombre && !apellido && !dni && !email) continue

    if (!nombre) { errores.push(`Fila ${n}: falta el nombre`); continue }
    if (!apellido) { errores.push(`Fila ${n}: falta el apellido`); continue }
    if (!dni) { errores.push(`Fila ${n}: falta el DNI`); continue }
    if (!esDniValido(dni)) { errores.push(`Fila ${n}: el DNI "${dni}" no es válido`); continue }
    if (!email) { errores.push(`Fila ${n}: falta el email`); continue }
    if (!esEmailValido(email)) { errores.push(`Fila ${n}: el email "${email}" no es válido`); continue }

    if (dnisEnArchivo.has(dni)) {
      errores.push(`Fila ${n}: el DNI ${dni} está repetido dentro del archivo`)
      continue
    }
    dnisEnArchivo.add(dni)

    invitados.push({ nombre, apellido, dni, email })
  }

  // Solo devolvemos las primeras 20 líneas de error para no generar una
  // respuesta gigante con un archivo mal armado.
  return { invitados, errores: errores.slice(0, 20), totalErrores: errores.length }
}

// ── Egresados: una fila por familia ─────────────────────────────────────────

// Máximo de entradas por familia en una fila. Frena un "500" tipeado por
// error en vez de 5, que generaría 500 QR y un correo inmanejable.
const MAX_ENTRADAS_POR_FAMILIA = 30

// Encabezado → campo. Se aceptan variantes comunes para que el Excel armado a
// mano no falle por escribir "Correo" en vez de "email" o "Teléfono" con tilde.
const ALIAS_GRUPOS = {
  familia: 'familia', nombre: 'familia', grupo: 'familia',
  email: 'email', correo: 'email', mail: 'email', 'e-mail': 'email',
  telefono: 'telefono', celular: 'telefono', whatsapp: 'telefono',
  cena: 'cena',
  baile: 'baile', 'post cena': 'baile', postcena: 'baile'
}
const COLUMNAS_GRUPOS_OBLIGATORIAS = ['familia', 'email', 'cena', 'baile']

const normalizarEncabezado = (valor) =>
  celdaATexto(valor).trim().toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')

const leerGrupos = async (buffer) => {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(buffer)

  const hoja = workbook.worksheets[0]
  if (!hoja) return { error: 'El archivo no contiene ninguna hoja' }

  const encabezados = {}
  hoja.getRow(1).eachCell((celda, col) => {
    const campo = ALIAS_GRUPOS[normalizarEncabezado(celda.value)]
    if (campo && !encabezados[campo]) encabezados[campo] = col
  })

  const faltantes = COLUMNAS_GRUPOS_OBLIGATORIAS.filter(c => !encabezados[c])
  if (faltantes.length > 0) {
    return {
      error: 'El Excel de egresados debe tener las columnas: familia, email, telefono (opcional), cena, baile. ' +
             `Faltan: ${faltantes.join(', ')}`
    }
  }

  const filasTotales = hoja.rowCount - 1
  if (filasTotales > MAX_FILAS) {
    return { error: `El archivo tiene ${filasTotales} filas. El máximo permitido es ${MAX_FILAS}.` }
  }

  const errores = []
  const grupos = []
  const emailsEnArchivo = new Map()

  for (let n = 2; n <= hoja.rowCount; n++) {
    const fila = hoja.getRow(n)
    const leer = (campo) => encabezados[campo]
      ? celdaATexto(fila.getCell(encabezados[campo]).value).trim()
      : ''

    const familia = texto(leer('familia'), 160)
    const email = normalizarEmail(leer('email'))
    const telefono = texto(leer('telefono'), 40)
    const cenaTxt = leer('cena')
    const baileTxt = leer('baile')

    if (!familia && !email && !telefono && !cenaTxt && !baileTxt) continue

    if (!familia) { errores.push(`Fila ${n}: falta el nombre de la familia`); continue }
    if (!email) { errores.push(`Fila ${n}: falta el email`); continue }
    if (!esEmailValido(email)) { errores.push(`Fila ${n}: el email "${email}" no es válido`); continue }

    const cena = enteroNoNegativo(cenaTxt, MAX_ENTRADAS_POR_FAMILIA)
    const baile = enteroNoNegativo(baileTxt, MAX_ENTRADAS_POR_FAMILIA)
    if (cena === null) { errores.push(`Fila ${n}: la cantidad de cena "${cenaTxt}" no es válida (0 a ${MAX_ENTRADAS_POR_FAMILIA})`); continue }
    if (baile === null) { errores.push(`Fila ${n}: la cantidad de baile "${baileTxt}" no es válida (0 a ${MAX_ENTRADAS_POR_FAMILIA})`); continue }
    if (cena + baile === 0) { errores.push(`Fila ${n}: ${familia} no tiene ninguna entrada`); continue }
    if (cena + baile > MAX_ENTRADAS_POR_FAMILIA) {
      errores.push(`Fila ${n}: ${familia} suma ${cena + baile} entradas, el máximo por familia es ${MAX_ENTRADAS_POR_FAMILIA}`)
      continue
    }

    // El correo identifica a la familia. Dos filas con el mismo correo casi
    // siempre son una ampliación cargada abajo en vez de actualizar la fila
    // original: sumarlas a ciegas duplicaría entradas, así que se frena.
    if (emailsEnArchivo.has(email)) {
      errores.push(`Fila ${n}: el email ${email} ya aparece en la fila ${emailsEnArchivo.get(email)}. ` +
                   'Si la familia compró más entradas, actualizá la cantidad en esa fila.')
      continue
    }
    emailsEnArchivo.set(email, n)

    grupos.push({ familia, email, telefono: telefono || null, cena, baile, fila: n })
  }

  return { grupos, errores: errores.slice(0, 20), totalErrores: errores.length }
}

module.exports = { leerInvitados, leerGrupos, MAX_FILAS, MAX_ENTRADAS_POR_FAMILIA }
