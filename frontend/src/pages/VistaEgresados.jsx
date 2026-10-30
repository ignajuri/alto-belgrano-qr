import { useState, useEffect, useCallback } from 'react'
import api from '../services/api'

// Vista de un evento de egresados: las entradas se cargan y se gestionan por
// familia (una fila del Excel = una familia con N entradas de cena y/o baile).
// Recibe los estilos del Dashboard para mantener el mismo aspecto.

const ESTADO_TEXTO = {
  nuevo: 'Nueva',
  ampliar: 'Agrega entradas',
  sin_cambios: 'Actualiza datos',
  revisar: 'Revisar'
}

const textoTipo = (tipo) => (tipo === 'cena' ? 'Cena + baile' : 'Solo baile')

export default function VistaEgresados({ evento, isMobile, e, mostrarMensaje, formatearHora }) {
  const [grupos, setGrupos] = useState([])
  const [cargando, setCargando] = useState(false)
  const [busqueda, setBusqueda] = useState('')
  const [abierto, setAbierto] = useState(null)
  const [ocupado, setOcupado] = useState(null)
  // Previsualización de la importación: { archivo, resumen, acciones }
  const [previa, setPrevia] = useState(null)
  const [grupoEditando, setGrupoEditando] = useState(null)
  const [formGrupo, setFormGrupo] = useState({ nombre: '', email: '', telefono: '' })

  const base = `/eventos/${evento.id}`

  const cargarGrupos = useCallback(async () => {
    try {
      const res = await api.get(`${base}/grupos`)
      setGrupos(res.data.grupos)
    } catch {
      // Un fallo puntual de red no corta el refresco automático.
    }
  }, [base])

  // Carga inicial y refresco cada 8 s, igual que la lista de invitados: así se
  // ven los ingresos y los correos que van saliendo en segundo plano.
  useEffect(() => {
    let activo = true
    const traer = async () => {
      try {
        const res = await api.get(`${base}/grupos`)
        if (activo) setGrupos(res.data.grupos)
      } catch {
        // Un fallo puntual de red no corta el refresco automático.
      }
    }
    traer()
    const intervalo = setInterval(() => { if (!document.hidden) traer() }, 8000)
    return () => { activo = false; clearInterval(intervalo) }
  }, [base])

  const error = (err, porDefecto) => {
    const datos = err.response?.data
    const detalle = Array.isArray(datos?.detalle) ? ` — ${datos.detalle.slice(0, 3).join('; ')}` : ''
    mostrarMensaje('Error: ' + (datos?.error || porDefecto) + detalle)
  }

  // ── Importación en dos pasos ──────────────────────────────────────────────

  const enviarArchivo = (archivo, modo) => {
    const formData = new FormData()
    formData.append('modo', modo)
    formData.append('archivo', archivo)
    return api.post(`${base}/grupos/importar`, formData)
  }

  const previsualizar = async (ev) => {
    const archivo = ev.target.files[0]
    ev.target.value = ''
    if (!archivo) return
    setCargando(true)
    try {
      const res = await enviarArchivo(archivo, 'previsualizar')
      setPrevia({ archivo, ...res.data })
    } catch (err) {
      error(err, 'no se pudo leer el archivo')
    } finally { setCargando(false) }
  }

  const confirmarImportacion = async () => {
    setCargando(true)
    try {
      const res = await enviarArchivo(previa.archivo, 'confirmar')
      setPrevia(null)
      mostrarMensaje(`✓ ${res.data.mensaje}`)
      await cargarGrupos()
    } catch (err) {
      error(err, 'no se pudo importar el archivo')
    } finally { setCargando(false) }
  }

  // ── Acciones por familia ──────────────────────────────────────────────────

  const reenviarPendientes = async () => {
    setCargando(true)
    try {
      const res = await api.post(`${base}/invitados/reenviar-pendientes`)
      mostrarMensaje(`✓ ${res.data.mensaje}`)
    } catch (err) {
      error(err, 'no se pudieron reenviar los pendientes')
    } finally { setCargando(false) }
  }

  const reenviarGrupo = async (g) => {
    setOcupado(g.id)
    try {
      const res = await api.post(`${base}/grupos/${g.id}/reenviar`)
      mostrarMensaje(`✓ ${res.data.mensaje}`)
      await cargarGrupos()
    } catch (err) {
      error(err, 'no se pudieron reenviar las entradas')
    } finally { setOcupado(null) }
  }

  const eliminarGrupo = async (g) => {
    const ingresados = g.ingresados > 0 ? `\n\nAtención: ${g.ingresados} de sus entradas ya ingresaron.` : ''
    if (!window.confirm(`¿Eliminar a ${g.nombre} y sus ${g.entradas.length} entradas? Los QR dejan de ser válidos.${ingresados}`)) return
    setOcupado(g.id)
    try {
      await api.delete(`${base}/grupos/${g.id}`)
      setGrupos(prev => prev.filter(x => x.id !== g.id))
      mostrarMensaje('✓ Familia eliminada')
    } catch (err) {
      error(err, 'no se pudo eliminar la familia')
    } finally { setOcupado(null) }
  }

  const abrirEdicion = (g) => {
    setFormGrupo({ nombre: g.nombre, email: g.email, telefono: g.telefono || '' })
    setGrupoEditando(g)
  }

  const guardarGrupo = async (ev) => {
    ev.preventDefault()
    setCargando(true)
    try {
      const res = await api.put(`${base}/grupos/${grupoEditando.id}`, formGrupo)
      setGrupoEditando(null)
      mostrarMensaje(`✓ ${res.data.mensaje}`)
      await cargarGrupos()
    } catch (err) {
      error(err, 'no se pudo guardar la familia')
    } finally { setCargando(false) }
  }

  // ── Acciones por entrada (reusan los endpoints de invitados) ──────────────

  const reenviarEntrada = async (entrada) => {
    setOcupado(entrada.id)
    try {
      await api.post(`${base}/invitados/${entrada.id}/reenviar-qr`)
      mostrarMensaje(`✓ Entrada ${entrada.numero} reenviada`)
    } catch (err) {
      error(err, 'no se pudo reenviar la entrada')
    } finally { setOcupado(null) }
  }

  const deshacerIngreso = async (g, entrada) => {
    if (!window.confirm(
      `¿Deshacer el ingreso de la entrada ${entrada.numero} de ${g.nombre}?\n\n` +
      'El QR vuelve a ser válido. Queda registrado quién hizo el cambio.'
    )) return
    setOcupado(entrada.id)
    try {
      await api.post(`${base}/invitados/${entrada.id}/deshacer-ingreso`)
      await cargarGrupos()
    } catch (err) {
      error(err, 'no se pudo deshacer el ingreso')
    } finally { setOcupado(null) }
  }

  const anularEntrada = async (g, entrada) => {
    if (!window.confirm(
      `¿Anular la entrada ${entrada.numero} (${textoTipo(entrada.tipo_entrada)}) de ${g.nombre}?\n\n` +
      'Su QR deja de ser válido. Usalo cuando la familia devolvió una entrada.'
    )) return
    setOcupado(entrada.id)
    try {
      await api.delete(`${base}/invitados/${entrada.id}`)
      await cargarGrupos()
      mostrarMensaje(`✓ Entrada ${entrada.numero} anulada`)
    } catch (err) {
      error(err, 'no se pudo anular la entrada')
    } finally { setOcupado(null) }
  }

  // ── Datos derivados ───────────────────────────────────────────────────────

  const totalEntradas = grupos.reduce((s, g) => s + g.entradas.length, 0)
  const totalIngresos = grupos.reduce((s, g) => s + g.ingresados, 0)
  const totalCena = grupos.reduce((s, g) => s + g.cena, 0)
  const totalBaile = grupos.reduce((s, g) => s + g.baile, 0)
  const pendientesEnvio = grupos.filter(g => g.pendientesEnvio > 0).length

  const filtro = busqueda.trim().toLowerCase()
  const visibles = filtro
    ? grupos.filter(g => g.nombre.toLowerCase().includes(filtro) || g.email.includes(filtro))
    : grupos

  const badgeEnvio = (g) => g.pendientesEnvio === 0
    ? <span style={e.badgeVerde}>Enviado</span>
    : <span style={es.badgeAmbar}>{g.pendientesEnvio} sin enviar</span>

  const accionesGrupo = (g) => (
    <div style={e.accionesInvitado}>
      <button onClick={() => setAbierto(abierto === g.id ? null : g.id)} style={e.btnAccionVioleta}>
        {abierto === g.id ? 'Ocultar' : 'Entradas'}
      </button>
      <button onClick={() => abrirEdicion(g)} style={e.btnAccionVioleta}>Editar</button>
      <button onClick={() => reenviarGrupo(g)} style={e.btnAccionAzul} disabled={ocupado === g.id}>
        {ocupado === g.id ? 'Enviando...' : 'Reenviar'}
      </button>
      <button onClick={() => eliminarGrupo(g)} style={e.btnAccionRojo} disabled={ocupado === g.id}>Eliminar</button>
    </div>
  )

  const detalleEntradas = (g) => (
    <div style={es.entradas}>
      {g.entradas.map(en => (
        <div key={en.id} style={isMobile ? es.entradaMobile : es.entrada}>
          <div style={es.entradaInfo}>
            <strong style={{ color: '#0f172a' }}>Entrada {en.numero} de {g.total}</strong>
            <span style={en.tipo_entrada === 'cena' ? e.badgeVerde : e.badgeGuardia}>{textoTipo(en.tipo_entrada)}</span>
            <span style={en.ingresado ? e.badgeVerde : e.badgeGris}>
              {en.ingresado ? `Ingresó ${en.fecha_ingreso ? formatearHora(en.fecha_ingreso) : ''}` : 'Pendiente'}
            </span>
            {!en.qr_enviado && <span style={es.badgeAmbar}>Sin enviar</span>}
          </div>
          <div style={e.accionesInvitado}>
            <button onClick={() => reenviarEntrada(en)} style={e.btnAccionAzul} disabled={ocupado === en.id}>Reenviar</button>
            {en.ingresado && (
              <button onClick={() => deshacerIngreso(g, en)} style={e.btnAccionAmbar} disabled={ocupado === en.id}>Deshacer ingreso</button>
            )}
            <button onClick={() => anularEntrada(g, en)} style={e.btnAccionRojo} disabled={ocupado === en.id}>Anular</button>
          </div>
        </div>
      ))}
    </div>
  )

  return (
    <div>
      {/* Modal de previsualización de la importación */}
      {previa && (
        <div style={e.modalOverlay}>
          <div style={{ ...e.modal, maxWidth: '620px' }}>
            <div style={e.modalHeader}>
              <h3 style={e.modalTitulo}>Revisá antes de confirmar</h3>
              <button type="button" onClick={() => setPrevia(null)} style={e.modalClose}>✕</button>
            </div>
            <div style={{ ...e.modalBody, maxHeight: '60vh', overflowY: 'auto' }}>
              <div style={es.resumenGrid}>
                <div style={es.resumenItem}><b style={es.resumenNum}>{previa.resumen.nuevos}</b>familias nuevas</div>
                <div style={es.resumenItem}><b style={es.resumenNum}>{previa.resumen.ampliados}</b>agregan entradas</div>
                <div style={es.resumenItem}><b style={es.resumenNum}>{previa.resumen.entradasNuevas}</b>entradas nuevas</div>
                <div style={es.resumenItem}><b style={es.resumenNum}>{previa.resumen.correos}</b>correos a enviar</div>
              </div>
              <p style={e.ayuda}>
                {previa.resumen.entradasCena} de cena y {previa.resumen.entradasBaile} de baile.
                Total del evento después de cargar: {previa.resumen.totalResultante} de {previa.resumen.limite}.
              </p>

              {previa.resumen.superaLimite && (
                <p style={e.ayudaError}>
                  Supera el límite del evento ({previa.resumen.limite}). Editá el evento o corregí el Excel.
                </p>
              )}
              {previa.resumen.revisar > 0 && (
                <p style={e.ayudaError}>
                  {previa.resumen.revisar} familia(s) tienen menos entradas que las ya cargadas. No se toca nada de
                  ellas: si devolvieron entradas, anulalas a mano desde la lista.
                </p>
              )}
              {previa.resumen.noIncluidas > 0 && (
                <p style={e.ayuda}>
                  {previa.resumen.noIncluidas} familia(s) ya cargadas no están en este Excel. Se mantienen como están.
                </p>
              )}
              {previa.resumen.correos > 20 && (
                <p style={e.ayuda}>
                  Con el plan gratuito de Resend salen hasta 100 correos por día. Si se corta, usá
                  "Reenviar pendientes" al día siguiente.
                </p>
              )}

              {previa.acciones.length > 0 && (
                <div style={{ ...e.tableWrapper, marginTop: '14px' }}>
                  <table style={e.tabla}>
                    <thead>
                      <tr>{['Fila', 'Familia', 'Cambio', 'Cena', 'Baile'].map(c => <th key={c} style={e.th}>{c}</th>)}</tr>
                    </thead>
                    <tbody>
                      {previa.acciones.map(a => (
                        <tr key={a.email}>
                          <td style={e.td}>{a.fila}</td>
                          <td style={e.td}>{a.familia}</td>
                          <td style={e.td}>
                            <span style={a.estado === 'revisar' ? es.badgeAmbar : a.estado === 'nuevo' ? e.badgeVerde : e.badgeAdmin}>
                              {ESTADO_TEXTO[a.estado]}
                            </span>
                          </td>
                          <td style={e.td}>{a.actualCena !== a.cena ? `${a.actualCena} → ${a.cena}` : a.cena}</td>
                          <td style={e.td}>{a.actualBaile !== a.baile ? `${a.actualBaile} → ${a.baile}` : a.baile}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            <div style={e.modalBotones}>
              <button type="button" onClick={() => setPrevia(null)} style={e.btnSecundario}>Cancelar</button>
              <button type="button" onClick={confirmarImportacion} style={e.btnPrimario}
                disabled={cargando || previa.resumen.superaLimite ||
                  (previa.resumen.entradasNuevas === 0 && previa.resumen.datosActualizados === 0)}>
                {cargando ? 'Cargando...' : `Confirmar y enviar ${previa.resumen.correos} correo(s)`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal editar familia */}
      {grupoEditando && (
        <div style={e.modalOverlay}>
          <div style={e.modal}>
            <div style={e.modalHeader}>
              <h3 style={e.modalTitulo}>Editar familia</h3>
              <button type="button" onClick={() => setGrupoEditando(null)} style={e.modalClose}>✕</button>
            </div>
            <form onSubmit={guardarGrupo}>
              <div style={e.modalBody}>
                {[
                  { label: 'Familia', key: 'nombre', type: 'text' },
                  { label: 'Email', key: 'email', type: 'email' },
                  { label: 'Teléfono', key: 'telefono', type: 'text', opcional: true },
                ].map(({ label, key, type, opcional }) => (
                  <div key={key} style={e.campo}>
                    <label style={e.label}>{label} {opcional && <span style={e.opcional}>(opcional)</span>}</label>
                    <input type={type} value={formGrupo[key]} required={!opcional} style={e.input}
                      onChange={ev => setFormGrupo({ ...formGrupo, [key]: ev.target.value })} />
                  </div>
                ))}
                <p style={e.ayuda}>
                  Si cambiás el email, todas las entradas se reenvían a la dirección nueva. Los QR no cambian.
                  Para sumar entradas, actualizá la cantidad en el Excel y volvé a subirlo.
                </p>
              </div>
              <div style={e.modalBotones}>
                <button type="button" onClick={() => setGrupoEditando(null)} style={e.btnSecundario}>Cancelar</button>
                <button type="submit" style={e.btnPrimario} disabled={cargando}>
                  {cargando ? 'Guardando...' : 'Guardar cambios'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <div style={isMobile ? e.statsRowMobile : e.statsRow}>
        <div style={e.statCard}>
          <span style={e.statNum}>{totalEntradas}</span>
          <span style={e.statLabel}>Entradas</span>
        </div>
        <div style={{ ...e.statCard, borderTop: '3px solid #16a34a' }}>
          <span style={{ ...e.statNum, color: '#16a34a' }}>{totalIngresos}</span>
          <span style={e.statLabel}>Ingresaron</span>
        </div>
        <div style={{ ...e.statCard, borderTop: '3px solid #dc2626' }}>
          <span style={{ ...e.statNum, color: '#dc2626' }}>{totalEntradas - totalIngresos}</span>
          <span style={e.statLabel}>Pendientes</span>
        </div>
      </div>
      <p style={{ ...e.ayuda, margin: '-8px 0 16px' }}>
        {grupos.length} familias · {totalCena} cena + baile · {totalBaile} solo baile
        {evento.inicio_baile && ` · baile desde las ${new Date(evento.inicio_baile).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Argentina/Buenos_Aires' })}`}
      </p>

      <div style={isMobile ? e.importarBoxMobile : e.importarBox}>
        <div>
          <p style={e.importarTitulo}>Cargar entradas por familia</p>
          {!isMobile && (
            <p style={e.importarDesc}>
              Excel (.xlsx) con columnas: familia, email, telefono (opcional), cena, baile. Podés volver a subirlo
              actualizado: solo se agregan y envían las entradas nuevas.
            </p>
          )}
        </div>
        <div style={isMobile ? { ...e.importarBotonesMobile, flexWrap: 'wrap' } : e.importarBotones}>
          <a href="/plantilla-egresados.xlsx" download
            style={{ ...e.btnSecundario, textDecoration: 'none', display: 'inline-block', textAlign: 'center', ...(isMobile ? { flex: 1 } : {}) }}>
            Plantilla
          </a>
          {pendientesEnvio > 0 && (
            <button onClick={reenviarPendientes} disabled={cargando}
              style={{ ...e.btnSecundario, color: '#b45309', borderColor: '#fcd34d', ...(isMobile ? { flex: 1 } : {}) }}>
              Reenviar pendientes ({pendientesEnvio})
            </button>
          )}
          <input type="file" accept=".xlsx" id="file-egresados" onChange={previsualizar}
            style={{ display: 'none' }} disabled={cargando} />
          <label htmlFor="file-egresados"
            style={{ ...e.btnPrimario, display: 'inline-block', cursor: 'pointer', textAlign: 'center', ...(isMobile ? { flex: 1 } : {}) }}>
            {cargando ? 'Procesando...' : '📤 Subir Excel'}
          </label>
        </div>
      </div>

      {grupos.length > 0 && (
        <input type="search" value={busqueda} placeholder="Buscar familia o email..."
          onChange={ev => setBusqueda(ev.target.value)}
          style={{ ...e.input, marginBottom: '14px', maxWidth: isMobile ? '100%' : '360px' }} />
      )}

      {grupos.length === 0 ? (
        <div style={e.emptyState}>
          <div style={e.emptyIcon}>🎓</div>
          <p style={e.emptyTitulo}>No hay familias cargadas</p>
          <p style={e.emptyDesc}>Descargá la plantilla, completala con lo vendido y subila.</p>
        </div>
      ) : isMobile ? (
        visibles.map(g => (
          <div key={g.id} style={{ ...e.cardMobile, flexDirection: 'column', alignItems: 'stretch' }}>
            <div style={{ marginBottom: '10px' }}>
              <p style={{ margin: 0, fontWeight: '600', fontSize: '15px', color: '#0f172a' }}>{g.nombre}</p>
              <p style={{ margin: '2px 0 0', fontSize: '13px', color: '#64748b', wordBreak: 'break-all' }}>{g.email}</p>
              {g.telefono && <p style={{ margin: '2px 0 0', fontSize: '13px', color: '#64748b' }}>{g.telefono}</p>}
            </div>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '12px' }}>
              <span style={e.badgeGris}>{g.cena} cena · {g.baile} baile</span>
              <span style={g.ingresados === g.entradas.length && g.ingresados > 0 ? e.badgeVerde : e.badgeGris}>
                Ingresaron {g.ingresados}/{g.entradas.length}
              </span>
              {badgeEnvio(g)}
            </div>
            {accionesGrupo(g)}
            {abierto === g.id && detalleEntradas(g)}
          </div>
        ))
      ) : (
        <div style={e.tableWrapper}>
          <table style={e.tabla}>
            <thead>
              <tr>
                {['Familia', 'Email', 'Cena', 'Baile', 'Ingresaron', 'Envío', ''].map(c => <th key={c} style={e.th}>{c}</th>)}
              </tr>
            </thead>
            <tbody>
              {visibles.map(g => (
                <FilaGrupo key={g.id} g={g} e={e} abierto={abierto === g.id}
                  badgeEnvio={badgeEnvio} acciones={accionesGrupo(g)} detalle={detalleEntradas(g)} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function FilaGrupo({ g, e, abierto, badgeEnvio, acciones, detalle }) {
  const completa = g.entradas.length > 0 && g.ingresados === g.entradas.length
  return (
    <>
      <tr style={completa ? e.filaIngresado : {}}>
        <td style={e.td}>
          <strong>{g.nombre}</strong>
          {g.telefono && <div style={{ fontSize: '12px', color: '#64748b' }}>{g.telefono}</div>}
        </td>
        <td style={e.td}>{g.email}</td>
        <td style={e.td}>{g.cena}</td>
        <td style={e.td}>{g.baile}</td>
        <td style={e.td}>
          <span style={completa ? e.badgeVerde : e.badgeGris}>{g.ingresados}/{g.entradas.length}</span>
        </td>
        <td style={e.td}>{badgeEnvio(g)}</td>
        <td style={e.td}>{acciones}</td>
      </tr>
      {abierto && (
        <tr>
          <td colSpan={7} style={{ ...e.td, backgroundColor: '#f8fafc' }}>{detalle}</td>
        </tr>
      )}
    </>
  )
}

const es = {
  badgeAmbar: { backgroundColor: '#fef3c7', color: '#92400e', padding: '3px 10px', borderRadius: '999px', fontSize: '12px', fontWeight: '500' },
  entradas: { display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '10px' },
  entrada: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', backgroundColor: 'white', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '8px 12px' },
  entradaMobile: { display: 'flex', flexDirection: 'column', gap: '8px', backgroundColor: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '10px' },
  entradaInfo: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', fontSize: '13px' },
  resumenGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '8px', marginBottom: '10px' },
  resumenItem: { backgroundColor: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '10px', fontSize: '12px', color: '#64748b' },
  resumenNum: { display: 'block', fontSize: '20px', color: '#0f172a' }
}
