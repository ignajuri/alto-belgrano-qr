import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Html5Qrcode } from 'html5-qrcode'
import api, { cerrarSesionLocal } from '../services/api'
import CampoPassword from '../components/CampoPassword'

// SVG inline (la CSP no permite iconos de un CDN). Los tres cuadrados de las
// esquinas son los patrones de posición que todo QR tiene; el resto son módulos
// sueltos para que se lea como un código y no como un cuadrado negro.
const IconoQR = () => (
  <svg width="46" height="46" viewBox="0 0 29 29" fill="currentColor" aria-hidden="true">
    {[[0, 0], [22, 0], [0, 22]].map(([x, y]) => (
      <g key={`${x}-${y}`}>
        <rect x={x + 0.5} y={y + 0.5} width="6" height="6" fill="none" stroke="currentColor" strokeWidth="1.4" />
        <rect x={x + 2.5} y={y + 2.5} width="2" height="2" />
      </g>
    ))}
    <rect x="10" y="1" width="2" height="2" />
    <rect x="14" y="3" width="2" height="2" />
    <rect x="10" y="6" width="2" height="2" />
    <rect x="1" y="10" width="2" height="2" />
    <rect x="5" y="14" width="2" height="2" />
    <rect x="10" y="10" width="3" height="3" />
    <rect x="16" y="10" width="2" height="2" />
    <rect x="21" y="12" width="2" height="2" />
    <rect x="25" y="10" width="2" height="2" />
    <rect x="10" y="16" width="2" height="2" />
    <rect x="14" y="19" width="2" height="2" />
    <rect x="19" y="16" width="2" height="2" />
    <rect x="24" y="17" width="2" height="2" />
    <rect x="11" y="22" width="2" height="2" />
    <rect x="15" y="25" width="2" height="2" />
    <rect x="20" y="21" width="3" height="3" />
    <rect x="25" y="24" width="2" height="2" />
  </svg>
)

const leerUsuarioLocal = () => {
  try {
    return JSON.parse(sessionStorage.getItem('usuario') || '{}')
  } catch {
    return {}
  }
}

export default function Escaner() {
  const [escaneando, setEscaneando] = useState(false)
  const [resultado, setResultado] = useState(null)
  const [cargando, setCargando] = useState(false)
  const [vista, setVista] = useState('escaner')
  const [mensaje, setMensaje] = useState('')
  const [perfil, setPerfil] = useState({ nombre: '', email: '', passwordActual: '', password: '', confirmarPassword: '' })
  const [eventos, setEventos] = useState([])
  const [eventoId, setEventoId] = useState('')
  const [cargandoEventos, setCargandoEventos] = useState(true)
  // El botón "Actualizar ahora" incrementa esto y así vuelve a correr el efecto
  // que trae los eventos, sin duplicar la lógica de carga fuera de él.
  const [refrescoEventos, setRefrescoEventos] = useState(0)
  const scannerRef = useRef(null)
  // El callback del escáner se registra una sola vez al arrancar la cámara;
  // este ref le da acceso al evento vigente sin recrear el escáner.
  const eventoIdRef = useRef('')
  const navigate = useNavigate()
  const usuario = leerUsuarioLocal()

  useEffect(() => { eventoIdRef.current = eventoId }, [eventoId])

  const formatearHora = (fechaStr) => {
    const str = fechaStr.endsWith('Z') ? fechaStr : fechaStr + 'Z'
    const fecha = new Date(str)
    const h = (fecha.getUTCHours() - 3 + 24) % 24
    const m = fecha.getUTCMinutes().toString().padStart(2, '0')
    return `${h.toString().padStart(2, '0')}:${m}`
  }

  useEffect(() => {
    return () => {
      if (scannerRef.current) {
        scannerRef.current.stop().catch(() => {})
      }
    }
  }, [])

  // Los eventos activos son los que están dentro de su ventana de validez: no
  // es "el más próximo" sino todos los que se pueden escanear ahora, que pueden
  // ser varios. El backend lo calcula contra la hora actual en cada consulta.
  //
  // Se refresca cada minuto porque la ventana se abre sola: un guardia que
  // llega temprano y deja la app abierta veía "no hay eventos" para siempre,
  // aunque la ventana se hubiera abierto mientras tanto.
  useEffect(() => {
    let vivo = true

    const cargar = async () => {
      try {
        const res = await api.get('/eventos/activos')
        if (!vivo) return
        setEventos(res.data.eventos)
        // Si hay uno solo, lo dejamos elegido para ahorrarle un toque al guardia.
        if (res.data.eventos.length === 1) setEventoId(res.data.eventos[0].id)
      } catch {
        if (vivo) setEventos([])
      } finally {
        if (vivo) setCargandoEventos(false)
      }
    }

    cargar()
    const intervalo = setInterval(() => { if (!document.hidden) cargar() }, 60000)
    return () => { vivo = false; clearInterval(intervalo) }
  }, [refrescoEventos])

  const iniciarEscaner = async () => {
    setResultado(null)
    const html5Qrcode = new Html5Qrcode('lector-qr')
    scannerRef.current = html5Qrcode
    try {
      await html5Qrcode.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 250, height: 250 } },
        async (textoDecodificado) => {
          await html5Qrcode.stop()
          setEscaneando(false)
          await validarToken(textoDecodificado)
        },
        () => {}
      )
      setEscaneando(true)
    } catch {
      setResultado({ valido: false, motivo: 'No se pudo acceder a la cámara. Verificá los permisos.', color: 'rojo' })
    }
  }

  const detenerEscaner = async () => {
    if (scannerRef.current) {
      await scannerRef.current.stop().catch(() => {})
      scannerRef.current = null
    }
    setEscaneando(false)
  }

  const validarToken = async (token) => {
    setCargando(true)
    try {
      const res = await api.post('/validar', { token, evento_id: eventoIdRef.current || undefined })
      setResultado(res.data)
    } catch (err) {
      const datos = err.response?.data
      setResultado(datos?.motivo
        ? datos
        : { valido: false, motivo: datos?.error || 'Error al validar. Intentá de nuevo.', color: 'rojo' })
    } finally {
      setCargando(false)
    }
  }

  const mostrarMensaje = (texto) => {
    setMensaje(texto)
    setTimeout(() => setMensaje(''), 3000)
  }

  const handleNavPerfil = () => {
    if (escaneando) detenerEscaner()
    setPerfil({
      nombre: usuario.nombre || '', email: usuario.email || '',
      passwordActual: '', password: '', confirmarPassword: ''
    })
    setVista('perfil')
  }

  const guardarPerfil = async (e) => {
    e.preventDefault()
    if (perfil.password) {
      if (perfil.password !== perfil.confirmarPassword) {
        mostrarMensaje('Error: las contraseñas no coinciden')
        return
      }
      if (!perfil.passwordActual) {
        mostrarMensaje('Error: ingresá tu contraseña actual')
        return
      }
    }
    setCargando(true)
    try {
      const datos = { nombre: perfil.nombre, email: perfil.email }
      if (perfil.password) {
        datos.password = perfil.password
        datos.password_actual = perfil.passwordActual
      }
      const res = await api.put(`/usuarios/${usuario.id}`, datos)

      // Cambiar la contraseña revoca todos los tokens previos, incluido este.
      if (res.data.sesionInvalidada) {
        mostrarMensaje('Contraseña actualizada. Volvé a iniciar sesión.')
        setTimeout(() => { cerrarSesionLocal(); navigate('/login') }, 1800)
        return
      }

      const usuarioActualizado = { ...usuario, nombre: res.data.usuario.nombre, email: res.data.usuario.email }
      sessionStorage.setItem('usuario', JSON.stringify(usuarioActualizado))
      mostrarMensaje('Perfil actualizado correctamente')
      setPerfil({ ...perfil, passwordActual: '', password: '', confirmarPassword: '' })
    } catch (err) {
      mostrarMensaje('Error: ' + (err.response?.data?.error || 'no se pudo actualizar el perfil'))
    } finally {
      setCargando(false)
    }
  }

  const cerrarSesion = async () => {
    if (escaneando) await detenerEscaner()
    try { await api.post('/auth/logout') } catch { /* ignorado a propósito */ }
    cerrarSesionLocal()
    navigate('/login')
  }

  return (
    <div style={es.contenedor}>
      <div style={es.header}>
        <div style={es.headerIzq}>
          <div style={es.headerLogo}>AB</div>
          <div>
            <h1 style={es.headerTitulo}>Control de acceso</h1>
            <p style={es.headerSub}>Salón Alto Belgrano</p>
          </div>
        </div>
        <div style={es.headerDer}>
          <button onClick={handleNavPerfil} style={es.btnPerfil}>{usuario.nombre}</button>
          <button onClick={cerrarSesion} style={es.btnSalir}>Salir</button>
        </div>
      </div>

      <div style={es.cuerpo}>
        {mensaje && (
          <div style={mensaje.includes('Error') || mensaje.includes('no') ? es.alertaError : es.alerta}>
            {mensaje}
          </div>
        )}

        {vista === 'escaner' && (
          <div style={es.scanCard}>
            <div id="lector-qr" style={escaneando ? es.lector : es.lectorOculto}></div>
            {escaneando && (
              <button onClick={detenerEscaner} style={es.btnDetener}>✕ Detener cámara</button>
            )}

            {!escaneando && !cargando && !resultado && (
              <div style={es.idleState}>
                <div style={es.idleIconBox}>
                  <IconoQR />
                </div>
                <h2 style={es.idleTitulo}>Escanear código QR</h2>

                {cargandoEventos ? (
                  <p style={es.idleDesc}>Buscando eventos activos...</p>
                ) : eventos.length === 0 ? (
                  <div style={es.avisoSinEventos}>
                    <p style={{ margin: 0, fontWeight: 600 }}>No hay eventos activos</p>
                    <p style={{ margin: '6px 0 12px', fontSize: '13px' }}>
                      Los QR se pueden validar desde el mediodía anterior al evento.
                      La lista se actualiza sola cada minuto.
                    </p>
                    <button onClick={() => setRefrescoEventos(n => n + 1)} style={es.btnActualizar}>
                      Actualizar ahora
                    </button>
                  </div>
                ) : (
                  <>
                    <div style={es.campoEvento}>
                      <label style={es.label}>Evento</label>
                      <select value={eventoId} onChange={ev => setEventoId(ev.target.value)} style={es.input}>
                        <option value="">Seleccioná un evento…</option>
                        {eventos.map(ev => (
                          <option key={ev.id} value={ev.id}>
                            {ev.nombre_evento} — {new Date(ev.fecha + 'T12:00:00').toLocaleDateString('es-AR')}
                          </option>
                        ))}
                      </select>
                    </div>
                    <p style={es.idleDesc}>
                      Activá la cámara y apuntá al código QR del invitado. Los QR de
                      otros eventos se rechazan automáticamente.
                    </p>
                    <button onClick={iniciarEscaner} style={eventoId ? es.btnEscanear : es.btnEscanearDeshabilitado}
                      disabled={!eventoId}>
                      📷 Activar cámara
                    </button>
                  </>
                )}
              </div>
            )}

            {cargando && (
              <div style={es.cargandoArea}>
                <div style={es.cargandoCircle}>⟳</div>
                <p style={es.cargandoText}>Verificando QR...</p>
              </div>
            )}

            {resultado && !cargando && (
              <div style={resultado.color === 'verde' ? es.resultadoOk : es.resultadoError}>
                <div style={resultado.color === 'verde' ? es.iconoOk : es.iconoError}>
                  {resultado.color === 'verde' ? '✓' : '✗'}
                </div>
                <p style={resultado.color === 'verde' ? es.motivoOk : es.motivoError}>
                  {resultado.motivo}
                </p>
                {resultado.detalle && (
                  <div style={es.detalleBox}>
                    <div style={es.detalleItem}>
                      <span style={es.detalleKey}>Nombre</span>
                      <span style={es.detalleVal}>{resultado.detalle.nombre} {resultado.detalle.apellido}</span>
                    </div>
                    {resultado.detalle.dni && (
                      <div style={es.detalleItem}>
                        <span style={es.detalleKey}>DNI</span>
                        <span style={es.detalleVal}>{resultado.detalle.dni}</span>
                      </div>
                    )}
                    {resultado.detalle.evento && (
                      <div style={es.detalleItem}>
                        <span style={es.detalleKey}>Evento</span>
                        <span style={es.detalleVal}>{resultado.detalle.evento}</span>
                      </div>
                    )}
                    {resultado.detalle.fecha_ingreso && (
                      <div style={es.detalleItem}>
                        <span style={es.detalleKey}>Ingresó a las</span>
                        <span style={es.detalleVal}>{formatearHora(resultado.detalle.fecha_ingreso)}</span>
                      </div>
                    )}
                  </div>
                )}
                <button onClick={() => setResultado(null)} style={es.btnNuevo}>
                  Escanear otro
                </button>
              </div>
            )}
          </div>
        )}

        {vista === 'perfil' && (
          <div style={es.formCard}>
            <h2 style={es.formTitulo}>Mi perfil</h2>
            <form onSubmit={guardarPerfil}>
              <div style={es.campo}>
                <label style={es.label}>Nombre</label>
                <input type="text" value={perfil.nombre}
                  onChange={ev => setPerfil({ ...perfil, nombre: ev.target.value })}
                  style={es.input} required />
              </div>
              <div style={es.campo}>
                <label style={es.label}>Email</label>
                <input type="email" value={perfil.email}
                  onChange={ev => setPerfil({ ...perfil, email: ev.target.value })}
                  style={es.input} required />
              </div>
              <div style={es.campo}>
                <label style={es.label}>
                  Nueva contraseña <span style={es.opcional}>(dejar vacío para no cambiar)</span>
                </label>
                <CampoPassword valor={perfil.password} autoComplete="new-password"
                  onChange={ev => setPerfil({ ...perfil, password: ev.target.value })}
                  estiloInput={es.input} />
                <p style={es.ayuda}>Mínimo 10 caracteres, con al menos una letra y un número.</p>
              </div>
              {perfil.password && (
                <>
                  <div style={es.campo}>
                    <label style={es.label}>Confirmar nueva contraseña</label>
                    <CampoPassword valor={perfil.confirmarPassword} autoComplete="new-password"
                      onChange={ev => setPerfil({ ...perfil, confirmarPassword: ev.target.value })}
                      estiloInput={es.input} />
                  </div>
                  <div style={es.campo}>
                    <label style={es.label}>Contraseña actual</label>
                    <CampoPassword valor={perfil.passwordActual} autoComplete="current-password"
                      onChange={ev => setPerfil({ ...perfil, passwordActual: ev.target.value })}
                      estiloInput={es.input} required />
                    <p style={es.ayuda}>Al cambiarla se cierran todas tus sesiones abiertas.</p>
                  </div>
                </>
              )}
              <div style={es.formBotones}>
                <button type="button" onClick={() => setVista('escaner')} style={es.btnSecundario}>
                  Volver
                </button>
                <button type="submit" style={es.btnPrimario} disabled={cargando}>
                  {cargando ? 'Guardando...' : 'Guardar cambios'}
                </button>
              </div>
            </form>
          </div>
        )}
      </div>
    </div>
  )
}

const es = {
  contenedor: { minHeight: '100vh', backgroundColor: '#f1f5f9', fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif" },
  header: { backgroundColor: '#0f2554', padding: '0 28px', height: '64px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', boxShadow: '0 2px 8px rgba(0,0,0,0.2)' },
  headerIzq: { display: 'flex', alignItems: 'center', gap: '14px' },
  headerLogo: { width: '38px', height: '38px', backgroundColor: '#3b82f6', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: '700', fontSize: '13px', flexShrink: 0 },
  headerTitulo: { color: 'white', margin: 0, fontSize: '16px', fontWeight: '600' },
  headerSub: { color: 'rgba(255,255,255,0.5)', margin: '2px 0 0', fontSize: '11px' },
  headerDer: { display: 'flex', alignItems: 'center', gap: '10px' },
  btnPerfil: { padding: '7px 14px', backgroundColor: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)', color: 'rgba(255,255,255,0.85)', borderRadius: '7px', cursor: 'pointer', fontSize: '13px' },
  btnSalir: { padding: '7px 14px', backgroundColor: 'transparent', border: '1px solid rgba(255,255,255,0.15)', color: 'rgba(255,255,255,0.5)', borderRadius: '7px', cursor: 'pointer', fontSize: '13px' },
  cuerpo: { display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '40px 16px', gap: '20px' },
  alerta: { backgroundColor: '#f0fdf4', color: '#15803d', padding: '12px 20px', borderRadius: '10px', fontSize: '14px', width: '100%', maxWidth: '420px', textAlign: 'center', border: '1px solid #bbf7d0' },
  alertaError: { backgroundColor: '#fef2f2', color: '#dc2626', padding: '12px 20px', borderRadius: '10px', fontSize: '14px', width: '100%', maxWidth: '420px', textAlign: 'center', border: '1px solid #fecaca' },
  scanCard: { backgroundColor: 'white', borderRadius: '16px', width: '100%', maxWidth: '420px', overflow: 'hidden', boxShadow: '0 4px 20px rgba(0,0,0,0.08)', border: '1px solid #e2e8f0' },
  lector: { width: '100%' },
  lectorOculto: { height: 0, overflow: 'hidden' },
  idleState: { padding: '48px 32px', textAlign: 'center' },
  idleIconBox: { width: '80px', height: '80px', backgroundColor: '#eff6ff', borderRadius: '20px', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 24px', color: '#1d4ed8' },
  idleTitulo: { fontSize: '20px', fontWeight: '700', color: '#0f172a', margin: '0 0 10px' },
  idleDesc: { fontSize: '14px', color: '#64748b', margin: '0 0 28px', lineHeight: 1.6 },
  btnEscanear: { width: '100%', padding: '14px', backgroundColor: '#1d4ed8', color: 'white', border: 'none', borderRadius: '10px', fontSize: '16px', fontWeight: '600', cursor: 'pointer' },
  btnEscanearDeshabilitado: { width: '100%', padding: '14px', backgroundColor: '#cbd5e1', color: '#64748b', border: 'none', borderRadius: '10px', fontSize: '16px', fontWeight: '600', cursor: 'not-allowed' },
  campoEvento: { marginBottom: '20px', textAlign: 'left' },
  avisoSinEventos: { backgroundColor: '#fffbeb', border: '1px solid #fde68a', color: '#92400e', borderRadius: '10px', padding: '16px', textAlign: 'left' },
  btnActualizar: { padding: '8px 14px', backgroundColor: 'white', color: '#92400e', border: '1px solid #fcd34d', borderRadius: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: '500' },
  ayuda: { fontSize: '12px', color: '#64748b', margin: '6px 0 0', lineHeight: 1.4 },
  btnDetener: { margin: '16px', padding: '12px', backgroundColor: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca', borderRadius: '10px', fontSize: '15px', cursor: 'pointer', fontWeight: '500', width: 'calc(100% - 32px)' },
  cargandoArea: { padding: '60px 32px', textAlign: 'center' },
  cargandoCircle: { fontSize: '40px', marginBottom: '16px', display: 'block' },
  cargandoText: { fontSize: '16px', color: '#64748b', margin: 0 },
  resultadoOk: { backgroundColor: '#f0fdf4', borderTop: '4px solid #16a34a', padding: '32px', textAlign: 'center' },
  resultadoError: { backgroundColor: '#fef2f2', borderTop: '4px solid #dc2626', padding: '32px', textAlign: 'center' },
  iconoOk: { width: '64px', height: '64px', backgroundColor: '#16a34a', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: '28px', fontWeight: '700', margin: '0 auto 16px' },
  iconoError: { width: '64px', height: '64px', backgroundColor: '#dc2626', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: '28px', fontWeight: '700', margin: '0 auto 16px' },
  motivoOk: { fontSize: '18px', fontWeight: '700', color: '#15803d', margin: '0 0 20px' },
  motivoError: { fontSize: '18px', fontWeight: '700', color: '#dc2626', margin: '0 0 20px' },
  detalleBox: { backgroundColor: 'white', borderRadius: '10px', padding: '16px', marginBottom: '20px', textAlign: 'left', border: '1px solid #e2e8f0' },
  detalleItem: { display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #f1f5f9' },
  detalleKey: { fontSize: '13px', color: '#64748b', fontWeight: '500' },
  detalleVal: { fontSize: '13px', color: '#0f172a', fontWeight: '500' },
  btnNuevo: { width: '100%', padding: '13px', backgroundColor: '#0f2554', color: 'white', border: 'none', borderRadius: '10px', fontSize: '15px', fontWeight: '600', cursor: 'pointer' },
  formCard: { backgroundColor: 'white', borderRadius: '16px', padding: '32px', width: '100%', maxWidth: '420px', boxShadow: '0 4px 20px rgba(0,0,0,0.08)', border: '1px solid #e2e8f0' },
  formTitulo: { fontSize: '18px', fontWeight: '700', color: '#0f172a', marginTop: 0, marginBottom: '24px' },
  campo: { marginBottom: '16px' },
  label: { display: 'block', marginBottom: '6px', fontSize: '13px', fontWeight: '500', color: '#374151' },
  opcional: { color: '#9ca3af', fontWeight: '400', fontSize: '12px' },
  input: { width: '100%', padding: '10px 14px', border: '1px solid #d1d5db', borderRadius: '8px', fontSize: '14px', boxSizing: 'border-box', color: '#111827', backgroundColor: 'white' },
  formBotones: { display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '8px' },
  btnPrimario: { padding: '10px 20px', backgroundColor: '#1d4ed8', color: 'white', border: 'none', borderRadius: '8px', fontSize: '14px', fontWeight: '500', cursor: 'pointer' },
  btnSecundario: { padding: '10px 20px', backgroundColor: 'white', color: '#374151', border: '1px solid #d1d5db', borderRadius: '8px', fontSize: '14px', cursor: 'pointer' },
}
