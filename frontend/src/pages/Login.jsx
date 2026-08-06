import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../services/api'
import { useIsMobile } from '../hooks/useIsMobile'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  // El interceptor de axios redirige acá cuando el backend revoca la sesión
  // (cuenta desactivada, contraseña cambiada o token vencido).
  const [aviso, setAviso] = useState(() =>
    new URLSearchParams(window.location.search).get('sesion') === 'expirada'
      ? 'Tu sesión expiró. Volvé a iniciar sesión.'
      : ''
  )
  const [cargando, setCargando] = useState(false)
  const navigate = useNavigate()
  const isMobile = useIsMobile()

  // Limpia el parámetro de la URL para que no reaparezca al recargar.
  useEffect(() => {
    if (window.location.search) window.history.replaceState({}, '', '/login')
  }, [])

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setAviso('')
    setCargando(true)
    try {
      const res = await api.post('/auth/login', { email, password })
      sessionStorage.setItem('token', res.data.token)
      sessionStorage.setItem('usuario', JSON.stringify(res.data.usuario))
      if (res.data.usuario.rol === 'admin') {
        navigate('/dashboard')
      } else {
        navigate('/escanear')
      }
    } catch (err) {
      // El 429 trae información útil (cuenta bloqueada, demasiados intentos).
      // El 401 se mantiene genérico a propósito: no revelamos si el email existe.
      setError(err.response?.status === 429
        ? (err.response?.data?.error || 'Demasiados intentos. Esperá unos minutos.')
        : 'Email o contraseña incorrectos')
    } finally {
      setCargando(false)
    }
  }

  if (isMobile) {
    return (
      <div style={m.contenedor}>
        <div style={m.header}>
          <div style={m.logoCircle}>AB</div>
          <div>
            <h1 style={m.titulo}>Salón Alto Belgrano</h1>
            <p style={m.subtitulo}>Sistema de acceso QR</p>
          </div>
        </div>
        <div style={m.formBox}>
          {aviso && <div style={m.aviso}>{aviso}</div>}
          {error && <div style={m.error}>⚠ {error}</div>}
          <form onSubmit={handleSubmit}>
            <div style={m.campo}>
              <label style={m.label}>Email</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                style={m.input} placeholder="tu@email.com" required autoFocus />
            </div>
            <div style={m.campo}>
              <label style={m.label}>Contraseña</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)}
                style={m.input} placeholder="••••••••" required />
            </div>
            <button type="submit" style={m.btn} disabled={cargando}>
              {cargando ? 'Ingresando...' : 'Ingresar →'}
            </button>
          </form>
          <p style={m.footer}>Mendoza, Argentina</p>
        </div>
      </div>
    )
  }

  return (
    <div style={s.contenedor}>
      <div style={s.izquierda}>
        <div style={s.brandCircle}>AB</div>
        <h1 style={s.brandNombre}>Salón Alto Belgrano</h1>
        <p style={s.brandTagline}>Sistema de control de acceso con códigos QR</p>
        <div style={s.features}>
          <div style={s.feature}><span style={s.featureCheck}>✓</span> Gestión de eventos e invitados</div>
          <div style={s.feature}><span style={s.featureCheck}>✓</span> Envío automático de QR por email</div>
          <div style={s.feature}><span style={s.featureCheck}>✓</span> Validación en tiempo real en la puerta</div>
          <div style={s.feature}><span style={s.featureCheck}>✓</span> Control de acceso por rol</div>
        </div>
      </div>
      <div style={s.derecha}>
        <div style={s.formBox}>
          <div style={s.formHeader}>
            <h2 style={s.titulo}>Iniciar sesión</h2>
            <p style={s.subtitulo}>Ingresá tus credenciales para acceder al sistema</p>
          </div>
          {aviso && <div style={s.aviso}>{aviso}</div>}
          {error && <div style={s.error}><span>⚠</span> {error}</div>}
          <form onSubmit={handleSubmit}>
            <div style={s.campo}>
              <label style={s.label}>Email</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                style={s.input} placeholder="tu@email.com" required autoFocus />
            </div>
            <div style={s.campo}>
              <label style={s.label}>Contraseña</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)}
                style={s.input} placeholder="••••••••" required />
            </div>
            <button type="submit" style={s.btn} disabled={cargando}>
              {cargando ? 'Ingresando...' : 'Ingresar →'}
            </button>
          </form>
          <p style={s.footer}>Salón Alto Belgrano — Mendoza, Argentina</p>
        </div>
      </div>
    </div>
  )
}

// Mobile styles
const m = {
  contenedor: { minHeight: '100vh', backgroundColor: '#0f2554', fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif", display: 'flex', flexDirection: 'column' },
  header: { padding: '40px 24px 32px', display: 'flex', alignItems: 'center', gap: '16px' },
  logoCircle: { width: '48px', height: '48px', backgroundColor: '#3b82f6', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: '700', fontSize: '16px', flexShrink: 0 },
  titulo: { color: 'white', fontSize: '18px', fontWeight: '700', margin: 0 },
  subtitulo: { color: 'rgba(255,255,255,0.5)', fontSize: '12px', margin: '3px 0 0' },
  formBox: { flex: 1, backgroundColor: '#f8fafc', borderRadius: '24px 24px 0 0', padding: '32px 24px', marginTop: '8px' },
  error: { backgroundColor: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca', borderRadius: '8px', padding: '12px 14px', fontSize: '14px', marginBottom: '20px' },
  aviso: { backgroundColor: '#eff6ff', color: '#1d4ed8', border: '1px solid #bfdbfe', borderRadius: '8px', padding: '12px 14px', fontSize: '14px', marginBottom: '20px' },
  campo: { marginBottom: '16px' },
  label: { display: 'block', marginBottom: '6px', fontSize: '14px', fontWeight: '500', color: '#374151' },
  input: { width: '100%', padding: '14px', border: '1px solid #d1d5db', borderRadius: '10px', fontSize: '16px', boxSizing: 'border-box', color: '#111827', backgroundColor: 'white' },
  btn: { width: '100%', padding: '15px', backgroundColor: '#1d4ed8', color: 'white', border: 'none', borderRadius: '10px', fontSize: '16px', fontWeight: '600', cursor: 'pointer', marginTop: '8px' },
  footer: { fontSize: '12px', color: '#94a3b8', textAlign: 'center', marginTop: '24px' },
}

// Desktop styles
const s = {
  contenedor: { display: 'flex', minHeight: '100vh', fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif" },
  izquierda: { flex: 1, backgroundColor: '#0f2554', display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '60px', color: 'white' },
  brandCircle: { width: '56px', height: '56px', backgroundColor: '#3b82f6', borderRadius: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: '700', fontSize: '18px', marginBottom: '28px' },
  brandNombre: { fontSize: '30px', fontWeight: '700', margin: '0 0 14px', lineHeight: 1.2 },
  brandTagline: { fontSize: '16px', color: 'rgba(255,255,255,0.55)', margin: '0 0 48px', lineHeight: 1.6, maxWidth: '340px' },
  features: { display: 'flex', flexDirection: 'column', gap: '14px' },
  feature: { fontSize: '14px', color: 'rgba(255,255,255,0.7)', display: 'flex', alignItems: 'center', gap: '10px' },
  featureCheck: { color: '#60a5fa', fontWeight: '700' },
  derecha: { width: '480px', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#f8fafc', padding: '48px' },
  formBox: { width: '100%', maxWidth: '360px' },
  formHeader: { marginBottom: '28px' },
  titulo: { fontSize: '26px', fontWeight: '700', color: '#0f172a', margin: '0 0 8px' },
  subtitulo: { fontSize: '14px', color: '#64748b', margin: 0, lineHeight: 1.5 },
  error: { backgroundColor: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca', borderRadius: '8px', padding: '12px 14px', fontSize: '14px', marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '8px' },
  aviso: { backgroundColor: '#eff6ff', color: '#1d4ed8', border: '1px solid #bfdbfe', borderRadius: '8px', padding: '12px 14px', fontSize: '14px', marginBottom: '20px' },
  campo: { marginBottom: '18px' },
  label: { display: 'block', marginBottom: '6px', fontSize: '13px', fontWeight: '500', color: '#374151' },
  input: { width: '100%', padding: '11px 14px', border: '1px solid #d1d5db', borderRadius: '8px', fontSize: '14px', boxSizing: 'border-box', color: '#111827', backgroundColor: 'white', outline: 'none' },
  btn: { width: '100%', padding: '13px', backgroundColor: '#1d4ed8', color: 'white', border: 'none', borderRadius: '8px', fontSize: '15px', fontWeight: '600', cursor: 'pointer', marginTop: '4px' },
  footer: { fontSize: '12px', color: '#94a3b8', textAlign: 'center', marginTop: '32px' },
}
