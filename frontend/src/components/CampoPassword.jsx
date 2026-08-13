import { useState } from 'react'

// SVG inline: la CSP no permite cargar iconos de un CDN.
const OjoIcono = ({ tachado }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
    <circle cx="12" cy="12" r="3" />
    {tachado && <line x1="3" y1="3" x2="21" y2="21" />}
  </svg>
)

// El botón trae su propio estilo en vez de recibirlo: cada pantalla tiene su
// objeto de estilos, pero el ojo se ve igual en todas. Lo único que varía es el
// estilo del input, que sí cambia entre el login y el resto.
const estiloContenedor = { position: 'relative' }

// 44x44 es el área táctil mínima recomendada para dedo. El ícono sigue midiendo
// 18px; lo que crece es la zona sensible al toque.
const estiloOjo = {
  position: 'absolute', right: '4px', top: '50%', transform: 'translateY(-50%)',
  width: '44px', height: '44px', background: 'none', border: 'none', padding: 0,
  cursor: 'pointer', color: '#6b7280',
  display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 0
}

// IMPORTANTE: este componente tiene que vivir en su propio módulo y no
// declararse dentro del render de una página. Si se declarara ahí, React lo
// trataría como un componente nuevo en cada render, remontaría el input y el
// campo perdería el foco en cada tecla.
export default function CampoPassword({
  valor,
  onChange,
  estiloInput,
  placeholder,
  required = false,
  autoComplete = 'current-password'
}) {
  const [visible, setVisible] = useState(false)
  const etiqueta = visible ? 'Ocultar contraseña' : 'Mostrar contraseña'

  return (
    <div style={estiloContenedor}>
      <input
        type={visible ? 'text' : 'password'}
        value={valor}
        onChange={onChange}
        style={{ ...estiloInput, paddingRight: '52px' }}
        placeholder={placeholder}
        autoComplete={autoComplete}
        required={required}
      />
      <button type="button" onClick={() => setVisible(v => !v)}
        style={estiloOjo} aria-label={etiqueta} title={etiqueta}>
        <OjoIcono tachado={visible} />
      </button>
    </div>
  )
}
