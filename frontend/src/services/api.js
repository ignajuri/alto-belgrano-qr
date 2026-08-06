import axios from 'axios'

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:3000/api',
  timeout: 30000
})

export const cerrarSesionLocal = () => {
  sessionStorage.removeItem('token')
  sessionStorage.removeItem('usuario')
}

api.interceptors.request.use((config) => {
  const token = sessionStorage.getItem('token')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

// El backend ahora revoca sesiones del lado del servidor (cuenta desactivada,
// contraseña cambiada, token vencido). Cuando eso pasa hay que sacar al usuario
// de la app en vez de dejarlo en una pantalla que falla en silencio.
api.interceptors.response.use(
  (respuesta) => respuesta,
  (error) => {
    const status = error.response?.status
    const enLogin = window.location.pathname === '/login'

    if ((status === 401 || status === 403) && !enLogin) {
      const mensaje = error.response?.data?.error || ''
      const sesionMuerta =
        status === 401 ||
        mensaje.includes('Cuenta desactivada')

      if (sesionMuerta) {
        cerrarSesionLocal()
        window.location.replace('/login?sesion=expirada')
      }
    }

    return Promise.reject(error)
  }
)

export default api
