import { useNavigate } from 'react-router-dom'
import api, { cerrarSesionLocal } from '../services/api'
import { useIsMobile } from '../hooks/useIsMobile'

// Pantalla que ve un administrador al iniciar sesión: elige entre el panel de
// administración y la vista de guardia (escáner), sin necesitar una segunda
// cuenta. Los guardias nunca llegan acá: entran directo al escáner.

const leerUsuario = () => {
  try {
    return JSON.parse(sessionStorage.getItem('usuario') || '{}')
  } catch {
    return {}
  }
}

const OPCIONES = [
  {
    ruta: '/dashboard',
    icono: '🗂️',
    titulo: 'Panel de administración',
    desc: 'Eventos, invitados, carga de Excel, reenvío de QR y usuarios.'
  },
  {
    ruta: '/escanear',
    icono: '📷',
    titulo: 'Control de acceso',
    desc: 'La vista del guardia: escanear QR en la puerta y ver la lista de ingresos.'
  }
]

export default function ElegirVista() {
  const navigate = useNavigate()
  const isMobile = useIsMobile()
  const usuario = leerUsuario()

  const cerrarSesion = async () => {
    try { await api.post('/auth/logout') } catch { /* ignorado a propósito */ }
    cerrarSesionLocal()
    navigate('/login')
  }

  return (
    <div style={v.fondo}>
      <div style={v.contenido}>
        <div style={v.logo}>AB</div>
        <h1 style={v.titulo}>Hola{usuario.nombre ? `, ${usuario.nombre.split(' ')[0]}` : ''}</h1>
        <p style={v.subtitulo}>¿A qué vista querés entrar? Podés cambiar después sin cerrar sesión.</p>

        <div style={isMobile ? v.opcionesMobile : v.opciones}>
          {OPCIONES.map(op => (
            <button key={op.ruta} onClick={() => navigate(op.ruta)} style={v.opcion}>
              <span style={v.icono} aria-hidden="true">{op.icono}</span>
              <span style={v.opcionTitulo}>{op.titulo}</span>
              <span style={v.opcionDesc}>{op.desc}</span>
            </button>
          ))}
        </div>

        <button onClick={cerrarSesion} style={v.salir}>Cerrar sesión</button>
      </div>
    </div>
  )
}

const v = {
  fondo: { minHeight: '100vh', backgroundColor: '#0f2554', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px 16px', boxSizing: 'border-box', fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif" },
  contenido: { width: '100%', maxWidth: '640px', textAlign: 'center', color: 'white' },
  logo: { width: '56px', height: '56px', margin: '0 auto 20px', backgroundColor: '#3b82f6', borderRadius: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: '700', fontSize: '18px' },
  titulo: { fontSize: '26px', fontWeight: '700', margin: '0 0 8px' },
  subtitulo: { fontSize: '15px', color: 'rgba(255,255,255,0.6)', margin: '0 0 28px', lineHeight: 1.5 },
  opciones: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' },
  opcionesMobile: { display: 'grid', gridTemplateColumns: '1fr', gap: '12px' },
  opcion: { display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '8px', textAlign: 'left', backgroundColor: 'white', border: 'none', borderRadius: '16px', padding: '22px 20px', cursor: 'pointer', boxShadow: '0 8px 24px rgba(0,0,0,0.18)', fontFamily: 'inherit' },
  icono: { fontSize: '30px', lineHeight: 1 },
  opcionTitulo: { fontSize: '17px', fontWeight: '700', color: '#0f172a' },
  opcionDesc: { fontSize: '14px', color: '#64748b', lineHeight: 1.45 },
  salir: { marginTop: '28px', background: 'none', border: '1px solid rgba(255,255,255,0.25)', color: 'rgba(255,255,255,0.7)', borderRadius: '8px', padding: '9px 18px', fontSize: '14px', cursor: 'pointer' }
}
