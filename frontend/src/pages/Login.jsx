import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../services/api'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [cargando, setCargando] = useState(false)
  const navigate = useNavigate()

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
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
      setError('Email o contraseña incorrectos')
    } finally {
      setCargando(false)
    }
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

          {error && (
            <div style={s.error}>
              <span>⚠</span> {error}
            </div>
          )}

          <form onSubmit={handleSubmit}>
            <div style={s.campo}>
              <label style={s.label}>Email</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                style={s.input}
                placeholder="tu@email.com"
                required
                autoFocus
              />
            </div>
            <div style={s.campo}>
              <label style={s.label}>Contraseña</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                style={s.input}
                placeholder="••••••••"
                required
              />
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
  campo: { marginBottom: '18px' },
  label: { display: 'block', marginBottom: '6px', fontSize: '13px', fontWeight: '500', color: '#374151' },
  input: { width: '100%', padding: '11px 14px', border: '1px solid #d1d5db', borderRadius: '8px', fontSize: '14px', boxSizing: 'border-box', color: '#111827', backgroundColor: 'white', outline: 'none' },
  btn: { width: '100%', padding: '13px', backgroundColor: '#1d4ed8', color: 'white', border: 'none', borderRadius: '8px', fontSize: '15px', fontWeight: '600', cursor: 'pointer', marginTop: '4px' },
  footer: { fontSize: '12px', color: '#94a3b8', textAlign: 'center', marginTop: '32px' },
}
