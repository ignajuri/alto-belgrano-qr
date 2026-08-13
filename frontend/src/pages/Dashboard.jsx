import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import api, { cerrarSesionLocal } from '../services/api'
import { useIsMobile } from '../hooks/useIsMobile'

const leerUsuarioLocal = () => {
  try {
    return JSON.parse(sessionStorage.getItem('usuario') || '{}')
  } catch {
    return {}
  }
}

const etiquetaRol = (rol) => (rol === 'admin' ? 'Administrador' : 'Guardia')

export default function Dashboard() {
  const [eventos, setEventos] = useState([])
  const [usuarios, setUsuarios] = useState([])
  const [vistaActual, setVistaActual] = useState('eventos')
  const [eventoSeleccionado, setEventoSeleccionado] = useState(null)
  const [invitados, setInvitados] = useState([])
  const [cargando, setCargando] = useState(false)
  const [mensaje, setMensaje] = useState('')
  const [usuarioEditando, setUsuarioEditando] = useState(null)
  const [eventoEditando, setEventoEditando] = useState(null)
  const [menuAbierto, setMenuAbierto] = useState(false)
  const [reEnviando, setReEnviando] = useState(null)
  const [deshaciendo, setDeshaciendo] = useState(null)
  // null = modal cerrado | 'nuevo' = alta | objeto invitado = edición
  const [invitadoEditando, setInvitadoEditando] = useState(null)
  const [formInvitado, setFormInvitado] = useState({ nombre: '', apellido: '', dni: '', email: '' })
  const navigate = useNavigate()
  const isMobile = useIsMobile()

  const usuarioLocal = leerUsuarioLocal()

  const [nuevoEvento, setNuevoEvento] = useState({
    nombre_evento: '', fecha: '', limite_invitados: '',
    anfitrion_nombre: '', anfitrion_telefono: ''
  })
  const [nuevoUsuario, setNuevoUsuario] = useState({
    nombre: '', email: '', password: '', rol: 'guardia'
  })
  const [formEdicion, setFormEdicion] = useState({
    nombre: '', email: '', password: ''
  })
  const [formEdicionEvento, setFormEdicionEvento] = useState({
    nombre_evento: '', fecha: '', limite_invitados: '', anfitrion_nombre: '', anfitrion_telefono: ''
  })
  const [miPerfil, setMiPerfil] = useState({
    nombre: '', email: '', passwordActual: '', password: '', confirmarPassword: ''
  })

  const formatearHora = (fechaStr) => {
    const str = fechaStr.endsWith('Z') ? fechaStr : fechaStr + 'Z'
    const fecha = new Date(str)
    const h = (fecha.getUTCHours() - 3 + 24) % 24
    const m = fecha.getUTCMinutes().toString().padStart(2, '0')
    return `${h.toString().padStart(2, '0')}:${m}`
  }

  const cargarEventos = async () => {
    try {
      const res = await api.get('/eventos')
      setEventos(res.data.eventos)
    } catch (err) { console.error(err) }
  }

  const cargarUsuarios = async () => {
    try {
      const res = await api.get('/usuarios')
      setUsuarios(res.data.usuarios)
    } catch (err) { console.error(err) }
  }

  useEffect(() => {
    const cargarInicial = async () => {
      try {
        const res = await api.get('/eventos')
        setEventos(res.data.eventos)
      } catch (err) { console.error(err) }
    }
    cargarInicial()
  }, [])

  // Antes esto era una suscripción de Supabase Realtime con la anon key. Como
  // las tablas tienen RLS y no hay policy para el rol anon, el servidor nunca
  // entregaba los eventos: la actualización en vivo no funcionaba. Agregar esa
  // policy expondría públicamente los qr_token, así que la vía correcta es
  // consultar al backend, que es quien tiene la service key.
  useEffect(() => {
    if (vistaActual !== 'invitados' || !eventoSeleccionado) return

    const eventoId = eventoSeleccionado.id
    const intervalo = setInterval(async () => {
      // No consultamos con la pestaña en segundo plano: el guardia en la puerta
      // no gana nada y le ahorramos requests al backend.
      if (document.hidden) return
      try {
        const res = await api.get(`/eventos/${eventoId}/invitados`)
        setInvitados(res.data.invitados)
      } catch {
        // Un fallo puntual de red no debe cortar el refresco automático.
      }
    }, 8000)

    return () => clearInterval(intervalo)
  }, [vistaActual, eventoSeleccionado])

  const mostrarMensaje = (texto) => {
    setMensaje(texto)
    setTimeout(() => setMensaje(''), 3000)
  }

  const crearEvento = async (e) => {
    e.preventDefault()
    setCargando(true)
    try {
      await api.post('/eventos', { ...nuevoEvento, limite_invitados: parseInt(nuevoEvento.limite_invitados) })
      mostrarMensaje('Evento creado correctamente')
      setNuevoEvento({ nombre_evento: '', fecha: '', limite_invitados: '', anfitrion_nombre: '', anfitrion_telefono: '' })
      await cargarEventos()
      setTimeout(() => setVistaActual('eventos'), 1500)
    } catch {
      mostrarMensaje('Error al crear el evento')
    } finally { setCargando(false) }
  }

  const abrirEdicionEvento = (ev) => {
    setEventoEditando(ev)
    setFormEdicionEvento({
      nombre_evento: ev.nombre_evento,
      fecha: ev.fecha,
      limite_invitados: ev.limite_invitados,
      anfitrion_nombre: ev.anfitrion_nombre,
      anfitrion_telefono: ev.anfitrion_telefono || ''
    })
  }

  const guardarEdicionEvento = async (e) => {
    e.preventDefault()
    setCargando(true)
    try {
      await api.put(`/eventos/${eventoEditando.id}`, {
        ...formEdicionEvento,
        limite_invitados: parseInt(formEdicionEvento.limite_invitados)
      })
      mostrarMensaje('Evento actualizado correctamente')
      setEventoEditando(null)
      await cargarEventos()
    } catch {
      mostrarMensaje('Error al actualizar el evento')
    } finally { setCargando(false) }
  }

  const crearUsuario = async (e) => {
    e.preventDefault()
    setCargando(true)
    try {
      await api.post('/usuarios', nuevoUsuario)
      mostrarMensaje('Usuario creado correctamente')
      setNuevoUsuario({ nombre: '', email: '', password: '', rol: 'guardia' })
      await cargarUsuarios()
    } catch (err) {
      mostrarMensaje(err.response?.data?.error || 'Error al crear el usuario')
    } finally { setCargando(false) }
  }

  const abrirEdicion = (u) => {
    setUsuarioEditando(u)
    setFormEdicion({ nombre: u.nombre, email: u.email, password: '' })
  }

  const guardarEdicion = async (e) => {
    e.preventDefault()
    setCargando(true)
    try {
      const datos = { nombre: formEdicion.nombre, email: formEdicion.email }
      if (formEdicion.password) datos.password = formEdicion.password
      await api.put(`/usuarios/${usuarioEditando.id}`, datos)
      mostrarMensaje('Usuario actualizado correctamente')
      setUsuarioEditando(null)
      await cargarUsuarios()
    } catch (err) {
      mostrarMensaje(err.response?.data?.error || 'Error al actualizar')
    } finally { setCargando(false) }
  }

  const guardarMiPerfil = async (e) => {
    e.preventDefault()
    if (miPerfil.password) {
      if (miPerfil.password !== miPerfil.confirmarPassword) {
        mostrarMensaje('Error: las contraseñas no coinciden')
        return
      }
      if (!miPerfil.passwordActual) {
        mostrarMensaje('Error: ingresá tu contraseña actual')
        return
      }
    }
    setCargando(true)
    try {
      const datos = { nombre: miPerfil.nombre, email: miPerfil.email }
      if (miPerfil.password) {
        datos.password = miPerfil.password
        datos.password_actual = miPerfil.passwordActual
      }
      const res = await api.put(`/usuarios/${usuarioLocal.id}`, datos)

      // Cambiar la contraseña invalida todos los tokens previos, incluido el
      // que estamos usando ahora: hay que volver a iniciar sesión.
      if (res.data.sesionInvalidada) {
        mostrarMensaje('Contraseña actualizada. Volvé a iniciar sesión.')
        setTimeout(() => { cerrarSesionLocal(); navigate('/login') }, 1800)
        return
      }

      const usuarioActualizado = { ...usuarioLocal, nombre: res.data.usuario.nombre, email: res.data.usuario.email }
      sessionStorage.setItem('usuario', JSON.stringify(usuarioActualizado))
      mostrarMensaje('Perfil actualizado correctamente')
      setMiPerfil({ ...miPerfil, passwordActual: '', password: '', confirmarPassword: '' })
    } catch (err) {
      mostrarMensaje('Error: ' + (err.response?.data?.error || 'no se pudo actualizar el perfil'))
    } finally { setCargando(false) }
  }

  const handleNavPerfil = () => {
    setVistaActual('perfil')
    setMiPerfil({
      nombre: usuarioLocal.nombre || '', email: usuarioLocal.email || '',
      passwordActual: '', password: '', confirmarPassword: ''
    })
    setMenuAbierto(false)
  }

  const toggleUsuario = async (id) => {
    try {
      const res = await api.patch(`/usuarios/${id}/toggle`)
      mostrarMensaje(res.data.mensaje)
      await cargarUsuarios()
    } catch (err) {
      mostrarMensaje(err.response?.data?.error || 'Error al actualizar usuario')
    }
  }

  const verInvitados = async (evento) => {
    setEventoSeleccionado(evento)
    setCargando(true)
    try {
      const res = await api.get(`/eventos/${evento.id}/invitados`)
      setInvitados(res.data.invitados)
      setVistaActual('invitados')
    } catch (err) { console.error(err) }
    finally { setCargando(false) }
  }

  const importarExcel = async (e, eventoId) => {
    const archivo = e.target.files[0]
    if (!archivo) return
    const formData = new FormData()
    formData.append('archivo', archivo)
    setCargando(true)
    try {
      const res = await api.post(`/eventos/${eventoId}/invitados/importar`, formData)
      mostrarMensaje(`✓ ${res.data.mensaje}`)
      await verInvitados(eventoSeleccionado || { id: eventoId })
    } catch (err) {
      // El backend detalla qué filas del Excel están mal; conviene mostrarlo.
      const datos = err.response?.data
      const detalle = Array.isArray(datos?.detalle) ? ` — ${datos.detalle.slice(0, 3).join('; ')}` : ''
      mostrarMensaje('Error: ' + (datos?.error || 'no se pudo importar el archivo') + detalle)
    } finally { setCargando(false); e.target.value = '' }
  }

  const eliminarEvento = async (id) => {
    if (!window.confirm('¿Eliminar este evento y todos sus invitados?')) return
    try {
      await api.delete(`/eventos/${id}`)
      await cargarEventos()
    } catch (err) { console.error(err) }
  }

  const eliminarInvitado = async (id) => {
    if (!window.confirm('¿Eliminar este invitado?')) return
    try {
      await api.delete(`/eventos/${eventoSeleccionado.id}/invitados/${id}`)
      setInvitados(prev => prev.filter(i => i.id !== id))
    } catch {
      mostrarMensaje('Error al eliminar el invitado')
    }
  }

  const abrirNuevoInvitado = () => {
    setFormInvitado({ nombre: '', apellido: '', dni: '', email: '' })
    setInvitadoEditando('nuevo')
  }

  const abrirEdicionInvitado = (inv) => {
    setFormInvitado({ nombre: inv.nombre, apellido: inv.apellido, dni: inv.dni, email: inv.email })
    setInvitadoEditando(inv)
  }

  const guardarInvitado = async (ev) => {
    ev.preventDefault()
    const esNuevo = invitadoEditando === 'nuevo'
    setCargando(true)
    try {
      const base = `/eventos/${eventoSeleccionado.id}/invitados`
      const res = esNuevo
        ? await api.post(base, formInvitado)
        : await api.put(`${base}/${invitadoEditando.id}`, formInvitado)

      setInvitados(prev => esNuevo
        ? [...prev, res.data.invitado].sort((a, b) => a.apellido.localeCompare(b.apellido, 'es'))
        : prev.map(i => (i.id === res.data.invitado.id ? res.data.invitado : i)))

      setInvitadoEditando(null)
      mostrarMensaje(`✓ ${res.data.mensaje}`)
    } catch (err) {
      mostrarMensaje('Error: ' + (err.response?.data?.error || 'no se pudo guardar el invitado'))
    } finally { setCargando(false) }
  }

  // Para el caso en que un QR se escanea por error y el invitado queda sin
  // poder entrar. Devuelve el QR a estado válido.
  const deshacerIngreso = async (inv) => {
    const ok = window.confirm(
      `¿Deshacer el ingreso de ${inv.nombre} ${inv.apellido}?\n\n` +
      'Su código QR va a volver a ser válido y va a poder usarse de nuevo. ' +
      'Queda registrado quién hizo este cambio.'
    )
    if (!ok) return

    setDeshaciendo(inv.id)
    try {
      const res = await api.post(`/eventos/${eventoSeleccionado.id}/invitados/${inv.id}/deshacer-ingreso`)
      setInvitados(prev => prev.map(i => (i.id === inv.id ? res.data.invitado : i)))
      mostrarMensaje(`✓ ${res.data.mensaje}`)
    } catch (err) {
      mostrarMensaje('Error: ' + (err.response?.data?.error || 'no se pudo deshacer el ingreso'))
    } finally { setDeshaciendo(null) }
  }

  const reenviarQR = async (invitadoId, nombre) => {
    setReEnviando(invitadoId)
    try {
      await api.post(`/eventos/${eventoSeleccionado.id}/invitados/${invitadoId}/reenviar-qr`)
      mostrarMensaje(`✓ QR reenviado a ${nombre}`)
    } catch {
      mostrarMensaje('Error al reenviar el QR')
    } finally { setReEnviando(null) }
  }

  const cerrarSesion = async () => {
    // Se avisa al backend para dejar registro en la auditoría; si falla, el
    // token local se descarta igual.
    try { await api.post('/auth/logout') } catch { /* ignorado a propósito */ }
    cerrarSesionLocal()
    navigate('/login')
  }

  const navActivo = (key) => {
    if (key === 'eventos') return vistaActual === 'eventos' || vistaActual === 'invitados'
    return vistaActual === key
  }

  const navegar = (vista, extra) => {
    setVistaActual(vista)
    if (extra) extra()
    setMenuAbierto(false)
  }

  const irAlInicio = () => {
    setVistaActual('eventos')
    setMenuAbierto(false)
  }

  const tituloPagina = {
    eventos: 'Eventos',
    crear: 'Nuevo evento',
    invitados: eventoSeleccionado?.nombre_evento || 'Invitados',
    usuarios: 'Gestión de usuarios',
    perfil: 'Mi perfil'
  }

  // Los eventos cuyos datos personales ya se purgaron muestran agregados en
  // vez de la lista nominal, que dejó de existir.
  const purgado = Boolean(eventoSeleccionado?.datos_purgados_en)

  const contenido = (
    <div style={isMobile ? e.contenidoMobile : e.contenido}>
      {mensaje && (
        <div style={mensaje.includes('Error') || mensaje.includes('no') ? e.alertaError : e.alerta}>
          {mensaje}
        </div>
      )}

      {/* Modal editar usuario */}
      {usuarioEditando && (
        <div style={e.modalOverlay}>
          <div style={e.modal}>
            <div style={e.modalHeader}>
              <h3 style={e.modalTitulo}>Editar usuario</h3>
              <button type="button" onClick={() => setUsuarioEditando(null)} style={e.modalClose}>✕</button>
            </div>
            <form onSubmit={guardarEdicion}>
              <div style={e.modalBody}>
                <div style={e.campo}>
                  <label style={e.label}>Nombre</label>
                  <input type="text" value={formEdicion.nombre}
                    onChange={ev => setFormEdicion({ ...formEdicion, nombre: ev.target.value })}
                    style={e.input} required />
                </div>
                <div style={e.campo}>
                  <label style={e.label}>Email</label>
                  <input type="email" value={formEdicion.email}
                    onChange={ev => setFormEdicion({ ...formEdicion, email: ev.target.value })}
                    style={e.input} required />
                </div>
                <div style={e.campo}>
                  <label style={e.label}>Nueva contraseña <span style={e.opcional}>(dejar vacío para no cambiar)</span></label>
                  <input type="password" value={formEdicion.password} autoComplete="new-password"
                    onChange={ev => setFormEdicion({ ...formEdicion, password: ev.target.value })}
                    style={e.input} />
                  <p style={e.ayuda}>
                    Mínimo 10 caracteres, con letra y número. Al cambiarla se cierran
                    las sesiones abiertas de ese usuario.
                  </p>
                </div>
              </div>
              <div style={e.modalBotones}>
                <button type="button" onClick={() => setUsuarioEditando(null)} style={e.btnSecundario}>Cancelar</button>
                <button type="submit" style={e.btnPrimario} disabled={cargando}>
                  {cargando ? 'Guardando...' : 'Guardar cambios'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal alta / edición de invitado */}
      {invitadoEditando && (
        <div style={e.modalOverlay}>
          <div style={e.modal}>
            <div style={e.modalHeader}>
              <h3 style={e.modalTitulo}>
                {invitadoEditando === 'nuevo' ? 'Agregar invitado' : 'Editar invitado'}
              </h3>
              <button type="button" onClick={() => setInvitadoEditando(null)} style={e.modalClose}>✕</button>
            </div>
            <form onSubmit={guardarInvitado}>
              <div style={e.modalBody}>
                {[
                  { label: 'Nombre', key: 'nombre', type: 'text', placeholder: 'Ej: Sofía' },
                  { label: 'Apellido', key: 'apellido', type: 'text', placeholder: 'Ej: Gutiérrez' },
                  { label: 'DNI', key: 'dni', type: 'text', placeholder: 'Ej: 38452019' },
                  { label: 'Email', key: 'email', type: 'email', placeholder: 'sofia@ejemplo.com' },
                ].map(({ label, key, type, placeholder }) => (
                  <div key={key} style={e.campo}>
                    <label style={e.label}>{label}</label>
                    <input type={type} value={formInvitado[key]} placeholder={placeholder}
                      onChange={ev => setFormInvitado({ ...formInvitado, [key]: ev.target.value })}
                      style={e.input} required />
                    {key === 'dni' && <p style={e.ayuda}>Sin puntos ni espacios.</p>}
                  </div>
                ))}
                <p style={e.ayuda}>
                  {invitadoEditando === 'nuevo'
                    ? 'Al guardar se le envía el QR por email automáticamente.'
                    : 'Si cambiás el email, el QR se reenvía a la dirección nueva. El código sigue siendo el mismo, así que el que ya tenga la persona sigue sirviendo.'}
                </p>
              </div>
              <div style={e.modalBotones}>
                <button type="button" onClick={() => setInvitadoEditando(null)} style={e.btnSecundario}>Cancelar</button>
                <button type="submit" style={e.btnPrimario} disabled={cargando}>
                  {cargando
                    ? 'Guardando...'
                    : invitadoEditando === 'nuevo' ? 'Agregar y enviar QR' : 'Guardar cambios'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal editar evento */}
      {eventoEditando && (
        <div style={e.modalOverlay}>
          <div style={e.modal}>
            <div style={e.modalHeader}>
              <h3 style={e.modalTitulo}>Editar evento</h3>
              <button type="button" onClick={() => setEventoEditando(null)} style={e.modalClose}>✕</button>
            </div>
            <form onSubmit={guardarEdicionEvento}>
              <div style={e.modalBody}>
                {[
                  { label: 'Nombre del evento', key: 'nombre_evento', type: 'text' },
                  { label: 'Fecha', key: 'fecha', type: 'date' },
                  { label: 'Límite de invitados', key: 'limite_invitados', type: 'number' },
                  { label: 'Nombre del anfitrión', key: 'anfitrion_nombre', type: 'text' },
                  { label: 'Teléfono del anfitrión', key: 'anfitrion_telefono', type: 'text', opcional: true },
                ].map(({ label, key, type, opcional }) => (
                  <div key={key} style={e.campo}>
                    <label style={e.label}>
                      {label} {opcional && <span style={e.opcional}>(opcional)</span>}
                    </label>
                    <input type={type} value={formEdicionEvento[key]}
                      onChange={ev => setFormEdicionEvento({ ...formEdicionEvento, [key]: ev.target.value })}
                      style={e.input} required={!opcional} />
                  </div>
                ))}
              </div>
              <div style={e.modalBotones}>
                <button type="button" onClick={() => setEventoEditando(null)} style={e.btnSecundario}>Cancelar</button>
                <button type="submit" style={e.btnPrimario} disabled={cargando}>
                  {cargando ? 'Guardando...' : 'Guardar cambios'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {vistaActual === 'eventos' && (
        <div>
          {eventos.length === 0 ? (
            <div style={e.emptyState}>
              <div style={e.emptyIcon}>📅</div>
              <p style={e.emptyTitulo}>No hay eventos registrados</p>
              <p style={e.emptyDesc}>Creá el primer evento desde el menú.</p>
            </div>
          ) : (
            eventos.map(ev => (
              <div key={ev.id} style={isMobile ? e.cardMobile : e.card}>
                {!isMobile && <div style={e.cardAccent}></div>}
                <div style={e.cardInfo}>
                  <h3 style={e.cardTitulo}>{ev.nombre_evento}</h3>
                  <div style={isMobile ? e.cardMetaMobile : e.cardMeta}>
                    <span style={e.cardMetaItem}>📅 {new Date(ev.fecha + 'T12:00:00').toLocaleDateString('es-AR', { day: '2-digit', month: 'long', year: 'numeric' })}</span>
                    <span style={e.cardMetaItem}>👥 Límite: {ev.limite_invitados}</span>
                    <span style={e.cardMetaItem}>🎉 {ev.anfitrion_nombre}</span>
                  </div>
                </div>
                <div style={isMobile ? e.cardAccionesMobile : e.cardAcciones}>
                  <button onClick={() => verInvitados(ev)} style={e.btnPrimario}>Ver invitados</button>
                  <button onClick={() => abrirEdicionEvento(ev)} style={e.btnSecundario}>Editar</button>
                  <button onClick={() => eliminarEvento(ev.id)} style={e.btnDanger}>Eliminar</button>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {vistaActual === 'crear' && (
        <div style={isMobile ? e.formContenedorMobile : e.formContenedor}>
          <form onSubmit={crearEvento}>
            {[
              { label: 'Nombre del evento', key: 'nombre_evento', type: 'text', placeholder: 'Ej: Cumpleaños de Victoria' },
              { label: 'Fecha', key: 'fecha', type: 'date', placeholder: '' },
              { label: 'Límite de invitados', key: 'limite_invitados', type: 'number', placeholder: 'Ej: 150' },
              { label: 'Nombre del anfitrión', key: 'anfitrion_nombre', type: 'text', placeholder: 'Ej: Victoria García' },
              { label: 'Teléfono del anfitrión', key: 'anfitrion_telefono', type: 'text', placeholder: 'Opcional' },
            ].map(({ label, key, type, placeholder }) => (
              <div key={key} style={e.campo}>
                <label style={e.label}>{label}</label>
                <input type={type} value={nuevoEvento[key]} placeholder={placeholder}
                  onChange={ev => setNuevoEvento({ ...nuevoEvento, [key]: ev.target.value })}
                  style={e.input} required={key !== 'anfitrion_telefono'} />
              </div>
            ))}
            <div style={e.formFooter}>
              <button type="button" onClick={() => setVistaActual('eventos')} style={e.btnSecundario}>Cancelar</button>
              <button type="submit" style={e.btnPrimario} disabled={cargando}>
                {cargando ? 'Creando...' : 'Crear evento'}
              </button>
            </div>
          </form>
        </div>
      )}

      {vistaActual === 'invitados' && eventoSeleccionado && (
        <div>
          <div style={isMobile ? e.statsRowMobile : e.statsRow}>
            <div style={e.statCard}>
              <span style={e.statNum}>{purgado ? (eventoSeleccionado.total_invitados ?? 0) : invitados.length}</span>
              <span style={e.statLabel}>Total</span>
            </div>
            <div style={{ ...e.statCard, borderTop: '3px solid #16a34a' }}>
              <span style={{ ...e.statNum, color: '#16a34a' }}>
                {purgado ? (eventoSeleccionado.total_ingresados ?? 0) : invitados.filter(i => i.ingresado).length}
              </span>
              <span style={e.statLabel}>Ingresaron</span>
            </div>
            <div style={{ ...e.statCard, borderTop: '3px solid #dc2626' }}>
              <span style={{ ...e.statNum, color: '#dc2626' }}>
                {purgado
                  ? Math.max(0, (eventoSeleccionado.total_invitados ?? 0) - (eventoSeleccionado.total_ingresados ?? 0))
                  : invitados.filter(i => !i.ingresado).length}
              </span>
              <span style={e.statLabel}>{purgado ? 'No asistieron' : 'Pendientes'}</span>
            </div>
          </div>

          {/* Un evento purgado ya no admite importar: sus datos personales se
              borraron por política de retención y volver a cargarlos no tiene
              sentido ni sería lícito. */}
          {!purgado && (
            <div style={isMobile ? e.importarBoxMobile : e.importarBox}>
              <div>
                <p style={e.importarTitulo}>Importar lista de invitados</p>
                {!isMobile && <p style={e.importarDesc}>Subí un archivo Excel (.xlsx) con columnas: nombre, apellido, dni, email</p>}
              </div>
              <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
                <button onClick={abrirNuevoInvitado} style={e.btnSecundario} disabled={cargando}>
                  ＋ Agregar uno
                </button>
                <input type="file" accept=".xlsx" id="file-input"
                  onChange={ev => importarExcel(ev, eventoSeleccionado.id)}
                  style={{ display: 'none' }} disabled={cargando} />
                <label htmlFor="file-input" style={{ ...e.btnPrimario, display: 'inline-block', cursor: 'pointer' }}>
                  {cargando ? 'Procesando...' : '📤 Subir Excel'}
                </label>
              </div>
            </div>
          )}

          {purgado ? (
            <div style={e.purgadoBox}>
              <p style={e.purgadoTitulo}>🔒 Datos personales eliminados</p>
              <p style={e.purgadoDesc}>
                Los nombres, DNI y emails de los invitados se borraron
                automáticamente el {new Date(eventoSeleccionado.datos_purgados_en)
                  .toLocaleDateString('es-AR', { day: '2-digit', month: 'long', year: 'numeric' })},
                según la política de retención de datos personales. Los totales de
                arriba se conservan porque no identifican a ninguna persona.
              </p>
            </div>
          ) : invitados.length === 0 ? (
            <div style={e.emptyState}>
              <div style={e.emptyIcon}>👥</div>
              <p style={e.emptyTitulo}>No hay invitados cargados</p>
              <p style={e.emptyDesc}>Importá un archivo Excel o agregalos de a uno.</p>
            </div>
          ) : isMobile ? (
            invitados.map(inv => (
              <div key={inv.id} style={{ ...e.cardMobile, flexDirection: 'column', alignItems: 'flex-start' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', marginBottom: '8px' }}>
                  <div>
                    <p style={{ margin: 0, fontWeight: '600', fontSize: '15px', color: '#0f172a' }}>{inv.nombre} {inv.apellido}</p>
                    <p style={{ margin: '2px 0 0', fontSize: '13px', color: '#64748b' }}>DNI: {inv.dni}</p>
                  </div>
                  <div style={{ display: 'flex', gap: '6px' }}>
                    {inv.ingresado && (
                      <button onClick={() => deshacerIngreso(inv)} style={e.btnDeshacerSmall}
                        disabled={deshaciendo === inv.id} title="Deshacer ingreso">
                        {deshaciendo === inv.id ? '...' : '↩'}
                      </button>
                    )}
                    <button onClick={() => abrirEdicionInvitado(inv)} style={e.btnEditarSmall} title="Editar datos">✎</button>
                    <button onClick={() => reenviarQR(inv.id, inv.nombre)} style={e.btnReenviarSmall} disabled={reEnviando === inv.id} title="Reenviar QR">
                      {reEnviando === inv.id ? '...' : '✉'}
                    </button>
                    <button onClick={() => eliminarInvitado(inv.id)} style={e.btnEliminarSmall}>✕</button>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  <span style={inv.ingresado ? e.badgeVerde : e.badgeGris}>{inv.ingresado ? 'Ingresó' : 'Pendiente'}</span>
                  {inv.fecha_ingreso && <span style={e.badgeGris}>{formatearHora(inv.fecha_ingreso)}</span>}
                  {inv.qr_enviado && <span style={e.badgeVerde}>QR enviado</span>}
                </div>
              </div>
            ))
          ) : (
            <div style={e.tableWrapper}>
              <table style={e.tabla}>
                <thead>
                  <tr>
                    {['Nombre', 'Apellido', 'DNI', 'Email', 'QR', 'Estado', 'Ingreso', ''].map(col => (
                      <th key={col} style={e.th}>{col}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {invitados.map(inv => (
                    <tr key={inv.id} style={inv.ingresado ? e.filaIngresado : {}}>
                      <td style={e.td}>{inv.nombre}</td>
                      <td style={e.td}>{inv.apellido}</td>
                      <td style={e.td}>{inv.dni}</td>
                      <td style={e.td}>{inv.email}</td>
                      <td style={e.td}>{inv.qr_enviado ? <span style={e.badgeVerde}>Enviado</span> : <span style={e.badgeGris}>Pendiente</span>}</td>
                      <td style={e.td}><span style={inv.ingresado ? e.badgeVerde : e.badgeGris}>{inv.ingresado ? 'Ingresó' : 'Pendiente'}</span></td>
                      <td style={e.td}>{inv.fecha_ingreso ? formatearHora(inv.fecha_ingreso) : '—'}</td>
                      <td style={e.td}>
                        <div style={{ display: 'flex', gap: '6px' }}>
                          {inv.ingresado && (
                            <button onClick={() => deshacerIngreso(inv)} style={e.btnDeshacerSmall}
                              disabled={deshaciendo === inv.id} title="Deshacer ingreso">
                              {deshaciendo === inv.id ? '...' : '↩'}
                            </button>
                          )}
                          <button onClick={() => abrirEdicionInvitado(inv)} style={e.btnEditarSmall} title="Editar datos">✎</button>
                          <button onClick={() => reenviarQR(inv.id, inv.nombre)} style={e.btnReenviarSmall} disabled={reEnviando === inv.id} title="Reenviar QR">
                            {reEnviando === inv.id ? '...' : '✉'}
                          </button>
                          <button onClick={() => eliminarInvitado(inv.id)} style={e.btnEliminarSmall}>✕</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {vistaActual === 'usuarios' && (
        <div style={isMobile ? {} : e.dosColumnas}>
          <div style={isMobile ? e.formContenedorMobile : e.formContenedor}>
            <h3 style={e.formTitulo}>Crear nuevo usuario</h3>
            <form onSubmit={crearUsuario}>
              {[
                { label: 'Nombre completo', key: 'nombre', type: 'text', placeholder: 'Ej: Juan García' },
                { label: 'Email', key: 'email', type: 'email', placeholder: 'juan@ejemplo.com' },
                { label: 'Contraseña', key: 'password', type: 'password', placeholder: '••••••••' },
              ].map(({ label, key, type, placeholder }) => (
                <div key={key} style={e.campo}>
                  <label style={e.label}>{label}</label>
                  <input type={type} value={nuevoUsuario[key]} placeholder={placeholder}
                    onChange={ev => setNuevoUsuario({ ...nuevoUsuario, [key]: ev.target.value })}
                    style={e.input} required
                    autoComplete={key === 'password' ? 'new-password' : 'off'} />
                  {key === 'password' && (
                    <p style={e.ayuda}>Mínimo 10 caracteres, con al menos una letra y un número.</p>
                  )}
                </div>
              ))}
              <div style={e.campo}>
                <label style={e.label}>Rol</label>
                <select value={nuevoUsuario.rol}
                  onChange={ev => setNuevoUsuario({ ...nuevoUsuario, rol: ev.target.value })}
                  style={e.input}>
                  <option value="guardia">Guardia</option>
                  <option value="admin">Administrador</option>
                </select>
              </div>
              <button type="submit" style={e.btnPrimario} disabled={cargando}>
                {cargando ? 'Creando...' : 'Crear usuario'}
              </button>
            </form>
          </div>

          <div style={isMobile ? { marginTop: '20px' } : {}}>
            <h3 style={e.formTitulo}>Usuarios del sistema</h3>
            {usuarios.map(u => (
              <div key={u.id} style={{ ...(isMobile ? e.cardMobile : e.card), opacity: u.activo ? 1 : 0.6 }}>
                {!isMobile && <div style={e.cardAccent}></div>}
                <div style={e.userCardInfo}>
                  <div style={e.userAvatarSmall}>{u.nombre[0].toUpperCase()}</div>
                  <div style={e.cardInfo}>
                    <h3 style={e.cardTitulo}>{u.nombre}</h3>
                    <div style={e.cardMeta}>
                      {!isMobile && <span style={e.cardMetaItem}>{u.email}</span>}
                      <span style={u.rol === 'admin' ? e.badgeAdmin : e.badgeGuardia}>{u.rol}</span>
                      <span style={u.activo ? e.badgeVerde : e.badgeGris}>{u.activo ? 'Activo' : 'Inactivo'}</span>
                    </div>
                  </div>
                </div>
                <div style={e.cardAcciones}>
                  <button onClick={() => abrirEdicion(u)} style={e.btnSecundario}>Editar</button>
                  <button onClick={() => toggleUsuario(u.id)} style={u.activo ? e.btnDanger : e.btnSuccess}>
                    {u.activo ? 'Desactivar' : 'Activar'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {vistaActual === 'perfil' && (
        <div style={isMobile ? e.formContenedorMobile : e.formContenedor}>
          <form onSubmit={guardarMiPerfil}>
            <div style={e.campo}>
              <label style={e.label}>Nombre</label>
              <input type="text" value={miPerfil.nombre}
                onChange={ev => setMiPerfil({ ...miPerfil, nombre: ev.target.value })}
                style={e.input} required />
            </div>
            <div style={e.campo}>
              <label style={e.label}>Email</label>
              <input type="email" value={miPerfil.email}
                onChange={ev => setMiPerfil({ ...miPerfil, email: ev.target.value })}
                style={e.input} required />
            </div>
            <div style={e.campo}>
              <label style={e.label}>Nueva contraseña <span style={e.opcional}>(dejar vacío para no cambiar)</span></label>
              <input type="password" value={miPerfil.password} autoComplete="new-password"
                onChange={ev => setMiPerfil({ ...miPerfil, password: ev.target.value })}
                style={e.input} />
              <p style={e.ayuda}>Mínimo 10 caracteres, con al menos una letra y un número.</p>
            </div>
            {miPerfil.password && (
              <>
                <div style={e.campo}>
                  <label style={e.label}>Confirmar nueva contraseña</label>
                  <input type="password" value={miPerfil.confirmarPassword} autoComplete="new-password"
                    onChange={ev => setMiPerfil({ ...miPerfil, confirmarPassword: ev.target.value })}
                    style={e.input} />
                </div>
                <div style={e.campo}>
                  <label style={e.label}>Contraseña actual</label>
                  <input type="password" value={miPerfil.passwordActual} autoComplete="current-password"
                    onChange={ev => setMiPerfil({ ...miPerfil, passwordActual: ev.target.value })}
                    style={e.input} required />
                  <p style={e.ayuda}>
                    Al cambiar la contraseña se cierran todas las sesiones abiertas.
                  </p>
                </div>
              </>
            )}
            <div style={e.formFooter}>
              <button type="button" onClick={() => setVistaActual('eventos')} style={e.btnSecundario}>Cancelar</button>
              <button type="submit" style={e.btnPrimario} disabled={cargando}>
                {cargando ? 'Guardando...' : 'Guardar cambios'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  )

  if (isMobile) {
    return (
      <div style={e.appMobile}>
        <div style={e.headerMobile}>
          <div style={e.headerMobileIzq}>
            {vistaActual === 'invitados' && (
              <button onClick={() => setVistaActual('eventos')} style={e.btnVolverMobile}>←</button>
            )}
            <div style={{ ...e.sidebarLogoCircle, cursor: 'pointer' }} onClick={irAlInicio}>AB</div>
            <h2 style={e.topbarTituloMobile}>{tituloPagina[vistaActual]}</h2>
          </div>
          <button onClick={() => setMenuAbierto(!menuAbierto)} style={e.hamburger}>
            {menuAbierto ? '✕' : '☰'}
          </button>
        </div>

        {menuAbierto && (
          <div style={e.mobileMenuOverlay} onClick={() => setMenuAbierto(false)}>
            <div style={e.mobileMenu} onClick={ev => ev.stopPropagation()}>
              <div style={e.mobileMenuUser}>
                <div style={e.userAvatar}>{usuarioLocal.nombre?.[0]?.toUpperCase()}</div>
                <div>
                  <p style={e.userName}>{usuarioLocal.nombre}</p>
                  <p style={e.userRole}>{etiquetaRol(usuarioLocal.rol)}</p>
                </div>
              </div>
              {[
                { key: 'eventos', label: '📋 Eventos' },
                { key: 'crear', label: '＋ Nuevo evento' },
                { key: 'usuarios', label: '👤 Usuarios', extra: cargarUsuarios },
              ].map(item => (
                <button key={item.key} onClick={() => navegar(item.key, item.extra)}
                  style={navActivo(item.key) ? e.mobileMenuItemActivo : e.mobileMenuItem}>
                  {item.label}
                </button>
              ))}
              <button onClick={handleNavPerfil} style={e.mobileMenuItem}>👤 Mi perfil</button>
              <button onClick={cerrarSesion} style={e.mobileMenuSalir}>Cerrar sesión</button>
            </div>
          </div>
        )}

        {contenido}
      </div>
    )
  }

  return (
    <div style={e.app}>
      <aside style={e.sidebar}>
        <div style={e.sidebarHeader}>
          <div style={{ ...e.sidebarLogoCircle, cursor: 'pointer' }} onClick={irAlInicio}>AB</div>
          <div>
            <p style={e.sidebarNombre}>Alto Belgrano</p>
            <p style={e.sidebarSub}>Administración</p>
          </div>
        </div>
        <nav style={e.sidebarNav}>
          <button onClick={() => setVistaActual('eventos')} style={navActivo('eventos') ? e.navItemActivo : e.navItem}>
            <span>📋</span> Eventos
          </button>
          <button onClick={() => setVistaActual('crear')} style={navActivo('crear') ? e.navItemActivo : e.navItem}>
            <span>＋</span> Nuevo evento
          </button>
          <button onClick={() => { setVistaActual('usuarios'); cargarUsuarios() }} style={navActivo('usuarios') ? e.navItemActivo : e.navItem}>
            <span>👤</span> Usuarios
          </button>
        </nav>
        <div style={e.sidebarFooter}>
          <div style={e.userCard}>
            <div style={e.userAvatar}>{usuarioLocal.nombre?.[0]?.toUpperCase()}</div>
            <div style={e.userInfo}>
              <p style={e.userName}>{usuarioLocal.nombre}</p>
              <p style={e.userRole}>{etiquetaRol(usuarioLocal.rol)}</p>
            </div>
          </div>
          <div style={e.sidebarBtns}>
            <button onClick={handleNavPerfil} style={e.sidebarBtn}>Mi perfil</button>
            <button onClick={cerrarSesion} style={e.sidebarBtnSalir}>Salir</button>
          </div>
        </div>
      </aside>
      <main style={e.main}>
        <div style={e.topbar}>
          <div style={e.topbarIzq}>
            {vistaActual === 'invitados' && (
              <button onClick={() => setVistaActual('eventos')} style={e.btnVolver}>← Volver</button>
            )}
            <h2 style={e.topbarTitulo}>{tituloPagina[vistaActual]}</h2>
          </div>
        </div>
        {contenido}
      </main>
    </div>
  )
}

const e = {
  app: { display: 'flex', minHeight: '100vh', backgroundColor: '#f1f5f9', fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif" },
  appMobile: { minHeight: '100vh', backgroundColor: '#f1f5f9', fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif" },
  sidebar: { width: '240px', backgroundColor: '#0f2554', display: 'flex', flexDirection: 'column', position: 'fixed', top: 0, left: 0, height: '100vh', zIndex: 100, boxShadow: '2px 0 8px rgba(0,0,0,0.15)' },
  sidebarHeader: { padding: '20px', display: 'flex', alignItems: 'center', gap: '12px', borderBottom: '1px solid rgba(255,255,255,0.1)', marginBottom: '8px' },
  sidebarLogoCircle: { width: '36px', height: '36px', backgroundColor: '#3b82f6', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: '700', fontSize: '13px', flexShrink: 0 },
  sidebarNombre: { color: 'white', fontSize: '14px', fontWeight: '600', margin: 0, lineHeight: 1.3 },
  sidebarSub: { color: 'rgba(255,255,255,0.45)', fontSize: '11px', margin: '2px 0 0' },
  sidebarNav: { flex: 1, padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: '2px' },
  navItem: { display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 12px', color: 'rgba(255,255,255,0.6)', cursor: 'pointer', fontSize: '14px', border: 'none', background: 'none', width: '100%', textAlign: 'left', borderRadius: '8px' },
  navItemActivo: { display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 12px', color: 'white', cursor: 'pointer', fontSize: '14px', border: 'none', background: 'rgba(59,130,246,0.25)', width: '100%', textAlign: 'left', borderRadius: '8px', fontWeight: '500' },
  sidebarFooter: { padding: '16px', borderTop: '1px solid rgba(255,255,255,0.1)' },
  userCard: { display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' },
  userAvatar: { width: '36px', height: '36px', backgroundColor: '#3b82f6', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: '600', fontSize: '14px', flexShrink: 0 },
  userAvatarSmall: { width: '36px', height: '36px', backgroundColor: '#dbeafe', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#1d4ed8', fontWeight: '600', fontSize: '14px', flexShrink: 0, marginRight: '12px' },
  userInfo: { flex: 1, minWidth: 0 },
  userName: { color: 'white', fontSize: '13px', fontWeight: '500', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  userRole: { color: 'rgba(255,255,255,0.45)', fontSize: '11px', margin: '2px 0 0' },
  sidebarBtns: { display: 'flex', gap: '8px' },
  sidebarBtn: { flex: 1, padding: '7px 0', backgroundColor: 'rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.8)', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '12px' },
  sidebarBtnSalir: { flex: 1, padding: '7px 0', backgroundColor: 'transparent', color: 'rgba(255,255,255,0.5)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '6px', cursor: 'pointer', fontSize: '12px' },
  main: { marginLeft: '240px', flex: 1, display: 'flex', flexDirection: 'column', minHeight: '100vh' },
  topbar: { backgroundColor: 'white', borderBottom: '1px solid #e2e8f0', padding: '0 32px', height: '62px', display: 'flex', alignItems: 'center', position: 'sticky', top: 0, zIndex: 50 },
  topbarIzq: { display: 'flex', alignItems: 'center', gap: '12px' },
  topbarTitulo: { fontSize: '17px', fontWeight: '600', color: '#0f172a', margin: 0 },
  contenido: { padding: '28px 32px', flex: 1 },
  btnVolver: { padding: '6px 12px', backgroundColor: '#f1f5f9', color: '#475569', border: '1px solid #e2e8f0', borderRadius: '6px', cursor: 'pointer', fontSize: '13px', fontWeight: '500' },
  headerMobile: { backgroundColor: '#0f2554', padding: '0 16px', height: '60px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', position: 'sticky', top: 0, zIndex: 100 },
  headerMobileIzq: { display: 'flex', alignItems: 'center', gap: '10px' },
  topbarTituloMobile: { fontSize: '15px', fontWeight: '600', color: 'white', margin: 0 },
  btnVolverMobile: { background: 'none', border: 'none', color: 'white', fontSize: '20px', cursor: 'pointer', padding: '0 4px' },
  hamburger: { background: 'none', border: 'none', color: 'white', fontSize: '22px', cursor: 'pointer', padding: '8px' },
  mobileMenuOverlay: { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 200 },
  mobileMenu: { position: 'absolute', top: 0, right: 0, width: '280px', height: '100%', backgroundColor: '#0f2554', display: 'flex', flexDirection: 'column', padding: '16px' },
  mobileMenuUser: { display: 'flex', alignItems: 'center', gap: '12px', padding: '16px 0 20px', borderBottom: '1px solid rgba(255,255,255,0.1)', marginBottom: '12px' },
  mobileMenuItem: { display: 'flex', alignItems: 'center', gap: '10px', padding: '14px 12px', color: 'rgba(255,255,255,0.7)', cursor: 'pointer', fontSize: '15px', border: 'none', background: 'none', width: '100%', textAlign: 'left', borderRadius: '8px' },
  mobileMenuItemActivo: { display: 'flex', alignItems: 'center', gap: '10px', padding: '14px 12px', color: 'white', cursor: 'pointer', fontSize: '15px', border: 'none', background: 'rgba(59,130,246,0.25)', width: '100%', textAlign: 'left', borderRadius: '8px', fontWeight: '500' },
  mobileMenuSalir: { marginTop: 'auto', padding: '14px 12px', color: 'rgba(255,100,100,0.8)', cursor: 'pointer', fontSize: '15px', border: 'none', background: 'none', width: '100%', textAlign: 'left', borderRadius: '8px' },
  contenidoMobile: { padding: '16px' },
  cardMobile: { backgroundColor: 'white', borderRadius: '12px', padding: '16px', marginBottom: '10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', border: '1px solid #e2e8f0' },
  cardMetaMobile: { display: 'flex', flexDirection: 'column', gap: '3px', marginTop: '4px' },
  cardAccionesMobile: { display: 'flex', flexDirection: 'column', gap: '6px', flexShrink: 0, marginLeft: '12px' },
  statsRowMobile: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px', marginBottom: '16px' },
  importarBoxMobile: { backgroundColor: 'white', borderRadius: '12px', padding: '14px 16px', marginBottom: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', border: '1px solid #e2e8f0', gap: '12px' },
  formContenedorMobile: { backgroundColor: 'white', borderRadius: '12px', padding: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', border: '1px solid #e2e8f0' },
  alerta: { backgroundColor: '#f0fdf4', color: '#15803d', padding: '12px 16px', borderRadius: '8px', marginBottom: '16px', fontSize: '14px', border: '1px solid #bbf7d0' },
  alertaError: { backgroundColor: '#fef2f2', color: '#dc2626', padding: '12px 16px', borderRadius: '8px', marginBottom: '16px', fontSize: '14px', border: '1px solid #fecaca' },
  card: { backgroundColor: 'white', borderRadius: '12px', marginBottom: '12px', display: 'flex', alignItems: 'center', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', border: '1px solid #e2e8f0', overflow: 'hidden' },
  cardAccent: { width: '4px', alignSelf: 'stretch', backgroundColor: '#3b82f6', flexShrink: 0 },
  cardInfo: { flex: 1, padding: '16px 20px' },
  cardTitulo: { margin: '0 0 6px', fontSize: '15px', fontWeight: '600', color: '#0f172a' },
  cardMeta: { display: 'flex', gap: '16px', flexWrap: 'wrap', alignItems: 'center' },
  cardMetaItem: { fontSize: '13px', color: '#64748b' },
  cardAcciones: { display: 'flex', gap: '8px', padding: '0 20px', flexShrink: 0 },
  userCardInfo: { flex: 1, display: 'flex', alignItems: 'center', padding: '16px 20px' },
  emptyState: { backgroundColor: 'white', borderRadius: '12px', padding: '40px 24px', textAlign: 'center', border: '1px solid #e2e8f0' },
  emptyIcon: { fontSize: '40px', marginBottom: '12px' },
  emptyTitulo: { fontSize: '15px', fontWeight: '600', color: '#0f172a', margin: '0 0 6px' },
  emptyDesc: { fontSize: '13px', color: '#64748b', margin: 0 },
  statsRow: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px', marginBottom: '24px' },
  statCard: { backgroundColor: 'white', borderRadius: '12px', padding: '16px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', border: '1px solid #e2e8f0', borderTop: '3px solid #3b82f6', textAlign: 'center' },
  statNum: { display: 'block', fontSize: '24px', fontWeight: '700', color: '#0f172a' },
  statLabel: { display: 'block', fontSize: '12px', color: '#64748b', marginTop: '4px' },
  importarBox: { backgroundColor: 'white', borderRadius: '12px', padding: '20px 24px', marginBottom: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', gap: '16px' },
  importarTitulo: { fontSize: '14px', fontWeight: '600', color: '#0f172a', margin: '0 0 4px' },
  importarDesc: { fontSize: '13px', color: '#64748b', margin: 0 },
  tableWrapper: { borderRadius: '12px', overflow: 'hidden', border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' },
  tabla: { width: '100%', borderCollapse: 'collapse', backgroundColor: 'white' },
  th: { backgroundColor: '#f8fafc', color: '#475569', padding: '12px 16px', textAlign: 'left', fontSize: '12px', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid #e2e8f0' },
  td: { padding: '12px 16px', fontSize: '13px', borderBottom: '1px solid #f1f5f9', color: '#334155' },
  filaIngresado: { backgroundColor: '#f0fdf4' },
  formContenedor: { backgroundColor: 'white', borderRadius: '12px', padding: '28px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', border: '1px solid #e2e8f0', maxWidth: '480px' },
  formTitulo: { fontSize: '15px', fontWeight: '600', color: '#0f172a', marginTop: 0, marginBottom: '20px' },
  dosColumnas: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px', alignItems: 'start' },
  campo: { marginBottom: '16px' },
  label: { display: 'block', marginBottom: '6px', fontSize: '13px', fontWeight: '500', color: '#374151' },
  opcional: { color: '#9ca3af', fontWeight: '400', fontSize: '12px' },
  ayuda: { fontSize: '12px', color: '#64748b', margin: '6px 0 0', lineHeight: 1.4 },
  purgadoBox: { backgroundColor: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '24px' },
  purgadoTitulo: { fontSize: '15px', fontWeight: '600', color: '#0f172a', margin: '0 0 8px' },
  purgadoDesc: { fontSize: '13px', color: '#64748b', margin: 0, lineHeight: 1.6 },
  input: { width: '100%', padding: '10px 14px', border: '1px solid #d1d5db', borderRadius: '8px', fontSize: '14px', boxSizing: 'border-box', color: '#111827', backgroundColor: 'white' },
  formFooter: { display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '8px' },
  btnPrimario: { padding: '10px 20px', backgroundColor: '#1d4ed8', color: 'white', border: 'none', borderRadius: '8px', fontSize: '14px', fontWeight: '500', cursor: 'pointer' },
  btnSecundario: { padding: '10px 20px', backgroundColor: 'white', color: '#374151', border: '1px solid #d1d5db', borderRadius: '8px', fontSize: '14px', cursor: 'pointer' },
  btnDanger: { padding: '8px 14px', backgroundColor: 'white', color: '#dc2626', border: '1px solid #fca5a5', borderRadius: '6px', cursor: 'pointer', fontSize: '13px' },
  btnSuccess: { padding: '8px 14px', backgroundColor: 'white', color: '#16a34a', border: '1px solid #86efac', borderRadius: '6px', cursor: 'pointer', fontSize: '13px' },
  btnEliminarSmall: { padding: '4px 8px', backgroundColor: 'white', color: '#dc2626', border: '1px solid #fca5a5', borderRadius: '4px', cursor: 'pointer', fontSize: '12px' },
  btnReenviarSmall: { padding: '4px 8px', backgroundColor: 'white', color: '#1d4ed8', border: '1px solid #93c5fd', borderRadius: '4px', cursor: 'pointer', fontSize: '12px' },
  btnDeshacerSmall: { padding: '4px 8px', backgroundColor: 'white', color: '#b45309', border: '1px solid #fcd34d', borderRadius: '4px', cursor: 'pointer', fontSize: '12px' },
  btnEditarSmall: { padding: '4px 8px', backgroundColor: 'white', color: '#475569', border: '1px solid #cbd5e1', borderRadius: '4px', cursor: 'pointer', fontSize: '12px' },
  badgeVerde: { backgroundColor: '#dcfce7', color: '#15803d', padding: '3px 10px', borderRadius: '999px', fontSize: '12px', fontWeight: '500' },
  badgeGris: { backgroundColor: '#f1f5f9', color: '#64748b', padding: '3px 10px', borderRadius: '999px', fontSize: '12px', fontWeight: '500' },
  badgeAdmin: { backgroundColor: '#dbeafe', color: '#1d4ed8', padding: '3px 10px', borderRadius: '999px', fontSize: '12px', fontWeight: '500' },
  badgeGuardia: { backgroundColor: '#f3e8ff', color: '#7c3aed', padding: '3px 10px', borderRadius: '999px', fontSize: '12px', fontWeight: '500' },
  modalOverlay: { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, backdropFilter: 'blur(2px)' },
  modal: { backgroundColor: 'white', borderRadius: '16px', width: '100%', maxWidth: '440px', margin: '0 16px', boxShadow: '0 20px 60px rgba(0,0,0,0.2)', overflow: 'hidden' },
  modalHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '20px 24px', borderBottom: '1px solid #f1f5f9' },
  modalTitulo: { fontSize: '16px', fontWeight: '600', color: '#0f172a', margin: 0 },
  modalClose: { background: 'none', border: 'none', fontSize: '18px', color: '#94a3b8', cursor: 'pointer', padding: '4px', lineHeight: 1 },
  modalBody: { padding: '20px 24px' },
  modalBotones: { display: 'flex', gap: '10px', justifyContent: 'flex-end', padding: '16px 24px', borderTop: '1px solid #f1f5f9' },
}