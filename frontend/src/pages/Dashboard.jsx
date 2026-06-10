import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../services/api'

export default function Dashboard() {
  const [eventos, setEventos] = useState([])
  const [usuarios, setUsuarios] = useState([])
  const [vistaActual, setVistaActual] = useState('eventos')
  const [eventoSeleccionado, setEventoSeleccionado] = useState(null)
  const [invitados, setInvitados] = useState([])
  const [cargando, setCargando] = useState(false)
  const [mensaje, setMensaje] = useState('')
  const [usuarioEditando, setUsuarioEditando] = useState(null)
  const navigate = useNavigate()

  const usuarioLocal = JSON.parse(sessionStorage.getItem('usuario') || '{}')

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

  const [miPerfil, setMiPerfil] = useState({
    nombre: '', email: '', password: '', confirmarPassword: ''
  })

  const formatearHora = (fechaStr) => {
    const str = fechaStr.endsWith('Z') ? fechaStr : fechaStr + 'Z'
    const fecha = new Date(str)
    const h = (fecha.getUTCHours() - 3 + 24) % 24
    const m = fecha.getUTCMinutes().toString().padStart(2, '0')
    return `${h.toString().padStart(2, '0')}:${m}`
  }

  useEffect(() => { cargarEventos() }, [])

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
    } catch (err) {
      mostrarMensaje('Error al crear el evento')
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
    if (miPerfil.password && miPerfil.password !== miPerfil.confirmarPassword) {
      mostrarMensaje('Las contraseñas no coinciden')
      return
    }
    setCargando(true)
    try {
      const datos = { nombre: miPerfil.nombre, email: miPerfil.email }
      if (miPerfil.password) datos.password = miPerfil.password
      const res = await api.put(`/usuarios/${usuarioLocal.id}`, datos)
      const usuarioActualizado = { ...usuarioLocal, nombre: res.data.usuario.nombre, email: res.data.usuario.email }
      sessionStorage.setItem('usuario', JSON.stringify(usuarioActualizado))
      mostrarMensaje('Perfil actualizado correctamente')
      setMiPerfil({ ...miPerfil, password: '', confirmarPassword: '' })
    } catch (err) {
      mostrarMensaje(err.response?.data?.error || 'Error al actualizar el perfil')
    } finally { setCargando(false) }
  }

  const handleNavPerfil = () => {
    setVistaActual('perfil')
    setMiPerfil({ nombre: usuarioLocal.nombre, email: usuarioLocal.email, password: '', confirmarPassword: '' })
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
      mostrarMensaje(`✓ ${res.data.mensaje} — QRs enviados por email`)
      await verInvitados(eventoSeleccionado || { id: eventoId })
    } catch (err) {
      mostrarMensaje('Error al importar el archivo')
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
    } catch (err) {
      mostrarMensaje('Error al eliminar el invitado')
    }
  }

  const cerrarSesion = () => {
    sessionStorage.removeItem('token')
    sessionStorage.removeItem('usuario')
    navigate('/login')
  }

  const navActivo = (key) => {
    if (key === 'eventos') return vistaActual === 'eventos' || vistaActual === 'invitados'
    return vistaActual === key
  }

  const tituloPagina = {
    eventos: 'Eventos',
    crear: 'Nuevo evento',
    invitados: eventoSeleccionado?.nombre_evento || 'Invitados',
    usuarios: 'Gestión de usuarios',
    perfil: 'Mi perfil'
  }

  return (
    <div style={e.app}>

      {/* SIDEBAR */}
      <aside style={e.sidebar}>
        <div style={e.sidebarHeader}>
          <div style={e.sidebarLogoCircle}>AB</div>
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
              <p style={e.userRole}>Administrador</p>
            </div>
          </div>
          <div style={e.sidebarBtns}>
            <button onClick={handleNavPerfil} style={e.sidebarBtn}>Mi perfil</button>
            <button onClick={cerrarSesion} style={e.sidebarBtnSalir}>Salir</button>
          </div>
        </div>
      </aside>

      {/* MAIN */}
      <main style={e.main}>
        <div style={e.topbar}>
          <div style={e.topbarIzq}>
            {vistaActual === 'invitados' && (
              <button onClick={() => setVistaActual('eventos')} style={e.btnVolver}>← Volver</button>
            )}
            <h2 style={e.topbarTitulo}>{tituloPagina[vistaActual]}</h2>
          </div>
        </div>

        <div style={e.contenido}>
          {mensaje && (
            <div style={mensaje.includes('Error') || mensaje.includes('no') ? e.alertaError : e.alerta}>
              {mensaje}
            </div>
          )}

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
                      <input type="password" value={formEdicion.password}
                        onChange={ev => setFormEdicion({ ...formEdicion, password: ev.target.value })}
                        style={e.input} />
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

          {vistaActual === 'eventos' && (
            <div>
              {eventos.length === 0 ? (
                <div style={e.emptyState}>
                  <div style={e.emptyIcon}>📅</div>
                  <p style={e.emptyTitulo}>No hay eventos registrados</p>
                  <p style={e.emptyDesc}>Creá el primer evento desde el menú lateral.</p>
                </div>
              ) : (
                eventos.map(ev => (
                  <div key={ev.id} style={e.card}>
                    <div style={e.cardAccent}></div>
                    <div style={e.cardInfo}>
                      <h3 style={e.cardTitulo}>{ev.nombre_evento}</h3>
                      <div style={e.cardMeta}>
                        <span style={e.cardMetaItem}>📅 {new Date(ev.fecha + 'T12:00:00').toLocaleDateString('es-AR', { day: '2-digit', month: 'long', year: 'numeric' })}</span>
                        <span style={e.cardMetaItem}>👥 Límite: {ev.limite_invitados} personas</span>
                        <span style={e.cardMetaItem}>🎉 Anfitrión: {ev.anfitrion_nombre}</span>
                      </div>
                    </div>
                    <div style={e.cardAcciones}>
                      <button onClick={() => verInvitados(ev)} style={e.btnPrimario}>Ver invitados</button>
                      <button onClick={() => eliminarEvento(ev.id)} style={e.btnDanger}>Eliminar</button>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {vistaActual === 'crear' && (
            <div style={e.formContenedor}>
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
              <div style={e.statsRow}>
                <div style={e.statCard}>
                  <span style={e.statNum}>{invitados.length}</span>
                  <span style={e.statLabel}>Total invitados</span>
                </div>
                <div style={{ ...e.statCard, borderTop: '3px solid #16a34a' }}>
                  <span style={{ ...e.statNum, color: '#16a34a' }}>{invitados.filter(i => i.ingresado).length}</span>
                  <span style={e.statLabel}>Ingresaron</span>
                </div>
                <div style={{ ...e.statCard, borderTop: '3px solid #dc2626' }}>
                  <span style={{ ...e.statNum, color: '#dc2626' }}>{invitados.filter(i => !i.ingresado).length}</span>
                  <span style={e.statLabel}>Pendientes</span>
                </div>
              </div>

              <div style={e.importarBox}>
                <div>
                  <p style={e.importarTitulo}>Importar lista de invitados</p>
                  <p style={e.importarDesc}>Subí un archivo Excel (.xlsx) con columnas: nombre, apellido, dni, email</p>
                </div>
                <div>
                  <input type="file" accept=".xlsx" id="file-input"
                    onChange={ev => importarExcel(ev, eventoSeleccionado.id)}
                    style={{ display: 'none' }} disabled={cargando} />
                  <label htmlFor="file-input" style={{ ...e.btnPrimario, display: 'inline-block', cursor: 'pointer' }}>
                    {cargando ? 'Procesando...' : '📤 Subir Excel'}
                  </label>
                </div>
              </div>

              {invitados.length === 0 ? (
                <div style={e.emptyState}>
                  <div style={e.emptyIcon}>👥</div>
                  <p style={e.emptyTitulo}>No hay invitados cargados</p>
                  <p style={e.emptyDesc}>Importá un archivo Excel para comenzar.</p>
                </div>
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
                            <button onClick={() => eliminarInvitado(inv.id)} style={e.btnEliminarSmall}>✕</button>
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
            <div style={e.dosColumnas}>
              <div style={e.formContenedor}>
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
                        style={e.input} required />
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

              <div>
                <h3 style={e.formTitulo}>Usuarios del sistema</h3>
                {usuarios.map(u => (
                  <div key={u.id} style={{ ...e.card, opacity: u.activo ? 1 : 0.6 }}>
                    <div style={e.cardAccent}></div>
                    <div style={e.userCardInfo}>
                      <div style={e.userAvatarSmall}>{u.nombre[0].toUpperCase()}</div>
                      <div style={e.cardInfo}>
                        <h3 style={e.cardTitulo}>{u.nombre}</h3>
                        <div style={e.cardMeta}>
                          <span style={e.cardMetaItem}>{u.email}</span>
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
            <div style={e.formContenedor}>
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
                  <input type="password" value={miPerfil.password}
                    onChange={ev => setMiPerfil({ ...miPerfil, password: ev.target.value })}
                    style={e.input} />
                </div>
                {miPerfil.password && (
                  <div style={e.campo}>
                    <label style={e.label}>Confirmar nueva contraseña</label>
                    <input type="password" value={miPerfil.confirmarPassword}
                      onChange={ev => setMiPerfil({ ...miPerfil, confirmarPassword: ev.target.value })}
                      style={e.input} />
                  </div>
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
      </main>
    </div>
  )
}

const e = {
  app: { display: 'flex', minHeight: '100vh', backgroundColor: '#f1f5f9', fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif" },
  sidebar: { width: '240px', backgroundColor: '#0f2554', display: 'flex', flexDirection: 'column', position: 'fixed', top: 0, left: 0, height: '100vh', zIndex: 100, boxShadow: '2px 0 8px rgba(0,0,0,0.15)' },
  sidebarHeader: { padding: '20px', display: 'flex', alignItems: 'center', gap: '12px', borderBottom: '1px solid rgba(255,255,255,0.1)', marginBottom: '8px' },
  sidebarLogoCircle: { width: '40px', height: '40px', backgroundColor: '#3b82f6', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: '700', fontSize: '14px', flexShrink: 0 },
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
  alerta: { backgroundColor: '#f0fdf4', color: '#15803d', padding: '12px 16px', borderRadius: '8px', marginBottom: '20px', fontSize: '14px', border: '1px solid #bbf7d0' },
  alertaError: { backgroundColor: '#fef2f2', color: '#dc2626', padding: '12px 16px', borderRadius: '8px', marginBottom: '20px', fontSize: '14px', border: '1px solid #fecaca' },
  card: { backgroundColor: 'white', borderRadius: '12px', marginBottom: '12px', display: 'flex', alignItems: 'center', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', border: '1px solid #e2e8f0', overflow: 'hidden' },
  cardAccent: { width: '4px', alignSelf: 'stretch', backgroundColor: '#3b82f6', flexShrink: 0 },
  cardInfo: { flex: 1, padding: '16px 20px' },
  cardTitulo: { margin: '0 0 6px', fontSize: '15px', fontWeight: '600', color: '#0f172a' },
  cardMeta: { display: 'flex', gap: '16px', flexWrap: 'wrap', alignItems: 'center' },
  cardMetaItem: { fontSize: '13px', color: '#64748b' },
  cardAcciones: { display: 'flex', gap: '8px', padding: '0 20px', flexShrink: 0 },
  userCardInfo: { flex: 1, display: 'flex', alignItems: 'center', padding: '16px 20px' },
  emptyState: { backgroundColor: 'white', borderRadius: '12px', padding: '60px 32px', textAlign: 'center', border: '1px solid #e2e8f0' },
  emptyIcon: { fontSize: '48px', marginBottom: '16px' },
  emptyTitulo: { fontSize: '16px', fontWeight: '600', color: '#0f172a', margin: '0 0 8px' },
  emptyDesc: { fontSize: '14px', color: '#64748b', margin: 0 },
  statsRow: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px', marginBottom: '24px' },
  statCard: { backgroundColor: 'white', borderRadius: '12px', padding: '20px 24px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', border: '1px solid #e2e8f0', borderTop: '3px solid #3b82f6' },
  statNum: { display: 'block', fontSize: '28px', fontWeight: '700', color: '#0f172a' },
  statLabel: { display: 'block', fontSize: '13px', color: '#64748b', marginTop: '4px' },
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
  input: { width: '100%', padding: '10px 14px', border: '1px solid #d1d5db', borderRadius: '8px', fontSize: '14px', boxSizing: 'border-box', color: '#111827', backgroundColor: 'white' },
  formFooter: { display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '8px' },
  btnPrimario: { padding: '10px 20px', backgroundColor: '#1d4ed8', color: 'white', border: 'none', borderRadius: '8px', fontSize: '14px', fontWeight: '500', cursor: 'pointer' },
  btnSecundario: { padding: '10px 20px', backgroundColor: 'white', color: '#374151', border: '1px solid #d1d5db', borderRadius: '8px', fontSize: '14px', cursor: 'pointer' },
  btnDanger: { padding: '8px 14px', backgroundColor: 'white', color: '#dc2626', border: '1px solid #fca5a5', borderRadius: '6px', cursor: 'pointer', fontSize: '13px' },
  btnSuccess: { padding: '8px 14px', backgroundColor: 'white', color: '#16a34a', border: '1px solid #86efac', borderRadius: '6px', cursor: 'pointer', fontSize: '13px' },
  btnEliminarSmall: { padding: '4px 8px', backgroundColor: 'white', color: '#dc2626', border: '1px solid #fca5a5', borderRadius: '4px', cursor: 'pointer', fontSize: '12px' },
  badgeVerde: { backgroundColor: '#dcfce7', color: '#15803d', padding: '3px 10px', borderRadius: '999px', fontSize: '12px', fontWeight: '500' },
  badgeGris: { backgroundColor: '#f1f5f9', color: '#64748b', padding: '3px 10px', borderRadius: '999px', fontSize: '12px', fontWeight: '500' },
  badgeAdmin: { backgroundColor: '#dbeafe', color: '#1d4ed8', padding: '3px 10px', borderRadius: '999px', fontSize: '12px', fontWeight: '500' },
  badgeGuardia: { backgroundColor: '#f3e8ff', color: '#7c3aed', padding: '3px 10px', borderRadius: '999px', fontSize: '12px', fontWeight: '500' },
  modalOverlay: { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, backdropFilter: 'blur(2px)' },
  modal: { backgroundColor: 'white', borderRadius: '16px', width: '100%', maxWidth: '440px', boxShadow: '0 20px 60px rgba(0,0,0,0.2)', overflow: 'hidden' },
  modalHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '20px 24px', borderBottom: '1px solid #f1f5f9' },
  modalTitulo: { fontSize: '16px', fontWeight: '600', color: '#0f172a', margin: 0 },
  modalClose: { background: 'none', border: 'none', fontSize: '18px', color: '#94a3b8', cursor: 'pointer', padding: '4px', lineHeight: 1 },
  modalBody: { padding: '20px 24px' },
  modalBotones: { display: 'flex', gap: '10px', justifyContent: 'flex-end', padding: '16px 24px', borderTop: '1px solid #f1f5f9' },
}
