import { useState } from 'react'
import { useNavigate, useSearchParams, Link } from 'react-router-dom'
import api from '../services/api'
import CampoPassword from '../components/CampoPassword'

// Un solo componente para las dos etapas del flujo: pedir el enlace y elegir la
// contraseña nueva. Comparten toda la presentación y solo cambia el formulario,
// así que separarlos en dos archivos duplicaría los estilos sin ganar nada.
export default function Recuperar() {
  const [params] = useSearchParams()
  const token = params.get('token')
  return token ? <FormRestablecer token={token} /> : <FormSolicitar />
}

// ── Etapa 1: pedir el enlace ────────────────────────────────────────────────
function FormSolicitar() {
  const [email, setEmail] = useState('')
  const [enviado, setEnviado] = useState(false)
  const [mensaje, setMensaje] = useState('')
  const [cargando, setCargando] = useState(false)

  const enviar = async (e) => {
    e.preventDefault()
    setCargando(true)
    try {
      const res = await api.post('/auth/recuperar', { email })
      setMensaje(res.data.mensaje)
      setEnviado(true)
    } catch (err) {
      // El 429 del rate limit sí trae información útil para el usuario.
      setMensaje(err.response?.status === 429
        ? (err.response?.data?.error || 'Demasiadas solicitudes. Esperá un rato.')
        : 'No pudimos procesar la solicitud. Intentá de nuevo en unos minutos.')
      setEnviado(err.response?.status !== 429)
    } finally { setCargando(false) }
  }

  return (
    <Marco titulo="Recuperar contraseña">
      {enviado ? (
        <>
          <div style={s.exito}>{mensaje}</div>
          <p style={s.ayuda}>
            El enlace vence en 1 hora y se puede usar una sola vez. Si no lo ves
            en unos minutos, revisá la carpeta de correo no deseado.
          </p>
          <Link to="/login" style={s.volver}>← Volver al inicio de sesión</Link>
        </>
      ) : (
        <>
          <p style={s.subtitulo}>
            Escribí tu email y te mandamos un enlace para elegir una contraseña nueva.
          </p>
          {mensaje && <div style={s.error}>⚠ {mensaje}</div>}
          <form onSubmit={enviar}>
            <div style={s.campo}>
              <label style={s.label}>Email</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                style={s.input} placeholder="tu@email.com" required autoFocus />
            </div>
            <button type="submit" style={s.btn} disabled={cargando}>
              {cargando ? 'Enviando...' : 'Enviar enlace'}
            </button>
          </form>
          <Link to="/login" style={s.volver}>← Volver al inicio de sesión</Link>
        </>
      )}
    </Marco>
  )
}

// ── Etapa 2: elegir la contraseña nueva ─────────────────────────────────────
function FormRestablecer({ token }) {
  const [password, setPassword] = useState('')
  const [confirmar, setConfirmar] = useState('')
  const [error, setError] = useState('')
  const [listo, setListo] = useState(false)
  const [cargando, setCargando] = useState(false)
  const navigate = useNavigate()

  const noCoinciden = Boolean(confirmar) && password !== confirmar

  const enviar = async (e) => {
    e.preventDefault()
    setError('')
    if (password !== confirmar) {
      setError('Las contraseñas no coinciden')
      return
    }
    setCargando(true)
    try {
      await api.post('/auth/restablecer', { token, password })
      setListo(true)
      setTimeout(() => navigate('/login'), 2500)
    } catch (err) {
      setError(err.response?.data?.error || 'No pudimos restablecer la contraseña')
    } finally { setCargando(false) }
  }

  if (listo) {
    return (
      <Marco titulo="Contraseña actualizada">
        <div style={s.exito}>
          Listo. Ya podés iniciar sesión con tu contraseña nueva.
        </div>
        <p style={s.ayuda}>
          Por seguridad se cerraron todas las sesiones que tenías abiertas.
          Te llevamos al inicio de sesión...
        </p>
        <Link to="/login" style={s.volver}>Ir ahora →</Link>
      </Marco>
    )
  }

  return (
    <Marco titulo="Elegí tu nueva contraseña">
      {error && <div style={s.error}>⚠ {error}</div>}
      <form onSubmit={enviar}>
        <div style={s.campo}>
          <label style={s.label}>Nueva contraseña</label>
          <CampoPassword valor={password} onChange={e => setPassword(e.target.value)}
            estiloInput={s.input} autoComplete="new-password" required />
          <p style={s.ayuda}>Mínimo 10 caracteres, con al menos una letra y un número.</p>
        </div>
        <div style={s.campo}>
          <label style={s.label}>Confirmar contraseña</label>
          <CampoPassword valor={confirmar} onChange={e => setConfirmar(e.target.value)}
            estiloInput={s.input} autoComplete="new-password" required />
          {noCoinciden && <p style={s.ayudaError}>Las contraseñas no coinciden.</p>}
        </div>
        <button type="submit"
          style={noCoinciden ? { ...s.btn, backgroundColor: '#cbd5e1', cursor: 'not-allowed' } : s.btn}
          disabled={cargando || noCoinciden}>
          {cargando ? 'Guardando...' : 'Guardar contraseña'}
        </button>
      </form>
      <Link to="/login" style={s.volver}>← Volver al inicio de sesión</Link>
    </Marco>
  )
}

const Marco = ({ titulo, children }) => (
  <div style={s.contenedor}>
    <div style={s.caja}>
      <div style={s.logo}>AB</div>
      <h1 style={s.titulo}>{titulo}</h1>
      {children}
      <p style={s.pie}>Salón Alto Belgrano — Mendoza, Argentina</p>
    </div>
  </div>
)

const s = {
  contenedor: { minHeight: '100vh', backgroundColor: '#0f2554', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px', fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif" },
  caja: { backgroundColor: '#f8fafc', borderRadius: '16px', padding: '32px', width: '100%', maxWidth: '400px', boxShadow: '0 10px 40px rgba(0,0,0,0.25)' },
  logo: { width: '48px', height: '48px', backgroundColor: '#3b82f6', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: '700', fontSize: '16px', marginBottom: '20px' },
  titulo: { fontSize: '22px', fontWeight: '700', color: '#0f172a', margin: '0 0 10px' },
  subtitulo: { fontSize: '14px', color: '#64748b', margin: '0 0 24px', lineHeight: 1.5 },
  campo: { marginBottom: '18px' },
  label: { display: 'block', marginBottom: '6px', fontSize: '13px', fontWeight: '500', color: '#374151' },
  input: { width: '100%', padding: '12px 14px', border: '1px solid #d1d5db', borderRadius: '8px', fontSize: '16px', boxSizing: 'border-box', color: '#111827', backgroundColor: 'white' },
  btn: { width: '100%', padding: '13px', backgroundColor: '#1d4ed8', color: 'white', border: 'none', borderRadius: '8px', fontSize: '15px', fontWeight: '600', cursor: 'pointer' },
  error: { backgroundColor: '#fef2f2', color: '#b91c1c', border: '1px solid #fecaca', borderRadius: '8px', padding: '12px 14px', fontSize: '14px', marginBottom: '20px' },
  exito: { backgroundColor: '#f0fdf4', color: '#15803d', border: '1px solid #bbf7d0', borderRadius: '8px', padding: '14px 16px', fontSize: '14px', marginBottom: '16px', lineHeight: 1.5 },
  ayuda: { fontSize: '12px', color: '#64748b', margin: '6px 0 0', lineHeight: 1.5 },
  ayudaError: { fontSize: '12px', color: '#b91c1c', margin: '6px 0 0', fontWeight: '500' },
  volver: { display: 'inline-block', marginTop: '20px', fontSize: '13px', color: '#1d4ed8', textDecoration: 'none' },
  pie: { fontSize: '12px', color: '#94a3b8', textAlign: 'center', marginTop: '28px', marginBottom: 0 },
}
