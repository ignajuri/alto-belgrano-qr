// Compara las filas del Excel de egresados con las familias ya cargadas en el
// evento y decide qué hacer con cada una. Es una función pura (no toca la base
// ni manda correos) para poder mostrar el resumen antes de confirmar y para
// que la confirmación aplique exactamente lo mismo que se previsualizó.
//
// Reglas:
//   · correo nuevo                     → familia nueva, se crean sus entradas
//   · mismo correo, más entradas       → se crean solo las que faltan y se
//                                        manda un correo solo con esas
//   · mismo correo, mismas cantidades  → nada (si cambió el nombre o el
//                                        teléfono, se actualizan sin mandar mail)
//   · mismo correo, menos entradas     → no se borra nada automáticamente: se
//                                        marca para revisar y el administrador
//                                        anula desde el panel las que sobran

const ESTADOS = {
  NUEVO: 'nuevo',
  AMPLIAR: 'ampliar',
  SIN_CAMBIOS: 'sin_cambios',
  REVISAR: 'revisar'
}

const planificarImportacion = (filas, existentes) => {
  const porEmail = new Map(existentes.map(g => [g.email.toLowerCase(), g]))
  const emailsEnArchivo = new Set()
  const acciones = []

  for (const fila of filas) {
    emailsEnArchivo.add(fila.email)
    const actual = porEmail.get(fila.email)

    if (!actual) {
      acciones.push({
        estado: ESTADOS.NUEVO,
        fila: fila.fila,
        familia: fila.familia,
        email: fila.email,
        telefono: fila.telefono,
        actualCena: 0,
        actualBaile: 0,
        cena: fila.cena,
        baile: fila.baile,
        agregarCena: fila.cena,
        agregarBaile: fila.baile
      })
      continue
    }

    const base = {
      fila: fila.fila,
      grupoId: actual.id,
      familia: fila.familia,
      email: fila.email,
      telefono: fila.telefono,
      actualCena: actual.cena,
      actualBaile: actual.baile,
      cena: fila.cena,
      baile: fila.baile,
      datosCambiados: fila.familia !== actual.nombre || (fila.telefono || null) !== (actual.telefono || null)
    }

    if (fila.cena < actual.cena || fila.baile < actual.baile) {
      acciones.push({ ...base, estado: ESTADOS.REVISAR, agregarCena: 0, agregarBaile: 0 })
      continue
    }

    const agregarCena = fila.cena - actual.cena
    const agregarBaile = fila.baile - actual.baile

    acciones.push({
      ...base,
      estado: agregarCena + agregarBaile > 0 ? ESTADOS.AMPLIAR : ESTADOS.SIN_CAMBIOS,
      agregarCena,
      agregarBaile
    })
  }

  const cuenta = (estado) => acciones.filter(a => a.estado === estado).length
  const entradasCena = acciones.reduce((s, a) => s + a.agregarCena, 0)
  const entradasBaile = acciones.reduce((s, a) => s + a.agregarBaile, 0)
  const totalActual = existentes.reduce((s, g) => s + g.cena + g.baile, 0)

  return {
    acciones,
    resumen: {
      nuevos: cuenta(ESTADOS.NUEVO),
      ampliados: cuenta(ESTADOS.AMPLIAR),
      sinCambios: cuenta(ESTADOS.SIN_CAMBIOS),
      revisar: cuenta(ESTADOS.REVISAR),
      datosActualizados: acciones.filter(a => a.datosCambiados && a.estado !== ESTADOS.REVISAR).length,
      entradasNuevas: entradasCena + entradasBaile,
      entradasCena,
      entradasBaile,
      correos: cuenta(ESTADOS.NUEVO) + cuenta(ESTADOS.AMPLIAR),
      totalActual,
      totalResultante: totalActual + entradasCena + entradasBaile,
      // Familias cargadas que no figuran en este Excel. No se tocan (pueden
      // haberse cargado a mano), pero se avisa por si se borró una fila.
      noIncluidas: existentes.filter(g => !emailsEnArchivo.has(g.email.toLowerCase())).length
    }
  }
}

module.exports = { planificarImportacion, ESTADOS }
