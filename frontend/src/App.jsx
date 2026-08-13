import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Escaner from './pages/Escaner'
import Recuperar from './pages/Recuperar'

const leerUsuario = () => {
  try {
    return JSON.parse(sessionStorage.getItem('usuario') || '{}')
  } catch {
    return {}
  }
}

// Nota: esto es solo para la experiencia de uso. La autorización real la hace
// el backend en cada request; el frontend no es una barrera de seguridad y no
// hay que tratarlo como tal.
const RutaPrivada = ({ children, rol }) => {
  const token = sessionStorage.getItem('token')
  if (!token) return <Navigate to="/login" replace />

  const usuario = leerUsuario()

  // Un guardia que entra a /dashboard solo vería una pantalla vacía con errores
  // 403; lo mandamos directo a la pantalla que le corresponde.
  if (rol && usuario.rol !== rol) {
    return <Navigate to={usuario.rol === 'admin' ? '/dashboard' : '/escanear'} replace />
  }

  return children
}

const Inicio = () => {
  const token = sessionStorage.getItem('token')
  if (!token) return <Navigate to="/login" replace />
  const usuario = leerUsuario()
  return <Navigate to={usuario.rol === 'admin' ? '/dashboard' : '/escanear'} replace />
}

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        {/* Públicas: las usa alguien que justamente no puede autenticarse.
            Ambas rutas apuntan al mismo componente, que decide qué formulario
            mostrar según venga o no un token en la URL. */}
        <Route path="/recuperar" element={<Recuperar />} />
        <Route path="/restablecer" element={<Recuperar />} />
        <Route path="/dashboard" element={
          <RutaPrivada rol="admin">
            <Dashboard />
          </RutaPrivada>
        } />
        <Route path="/escanear" element={
          <RutaPrivada>
            <Escaner />
          </RutaPrivada>
        } />
        <Route path="*" element={<Inicio />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
