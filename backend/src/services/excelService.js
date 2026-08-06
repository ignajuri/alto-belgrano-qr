const ExcelJS = require('exceljs')
const { normalizarEmail, esEmailValido, normalizarDni, esDniValido, texto } = require('../utils/validacion')

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

module.exports = { leerInvitados, MAX_FILAS }
