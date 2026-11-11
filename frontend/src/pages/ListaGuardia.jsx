import { useEffect, useState } from 'react'
import api from '../services/api'

// Lista de control para el guardia: quién ingresó y quién falta en el evento
// elegido en el escáner. Es de solo lectura (el guardia no puede deshacer
// ingresos ni ver datos de contacto) y se refresca sola cada 10 segundos para
// reflejar lo que escanean otros guardias.

const FILTROS = [
  { id: 'todos', texto: 'Todos' },
  { id: 'pendientes', texto: 'Faltan' },
  { id: 'ingresaron', texto: 'Ingresaron' }
]

const textoTipo = (tipo) => (tipo === 'cena' ? 'Cena' : 'Baile')

export default function ListaGuardia({ eventoId, formatearHora, onVolver }) {
  const [datos, setDatos] = useState(null)
  const [error, setError] = useState('')
  const [filtro, setFiltro] = useState('todos')
  const [busqueda, setBusqueda] = useState('')
  const [refresco, setRefresco] = useState(0)
  const [actualizado, setActualizado] = useState(null)

  useEffect(() => {
    let vivo = true
    const traer = async () => {
      try {
        const res = await api.get(`/eventos/${eventoId}/control`)
        if (!vivo) return
        setDatos(res.data)
        setError('')
        setActualizado(new Date())
      } catch (err) {
        if (vivo) setError(err.response?.data?.error || 'No se pudo cargar la lista. Revisá la conexión.')
      }
    }
    traer()
    const intervalo = setInterval(() => { if (!document.hidden) traer() }, 10000)
    return () => { vivo = false; clearInterval(intervalo) }
  }, [eventoId, refresco])

  // Por familia: egresados, o un casamiento configurado así.
  const esEgresados = (datos?.evento.modo_carga || (datos?.evento.tipo === 'egresados' ? 'familia' : 'individual')) === 'familia'
  const q = busqueda.trim().toLowerCase()

  const cumpleFiltro = (ingresado) =>
    filtro === 'todos' || (filtro === 'ingresaron' ? ingresado : !ingresado)

  // Egresados: una familia aparece en "Faltan" si le falta alguien y en
  // "Ingresaron" si ya entró al menos uno; se muestra con todas sus entradas.
  const grupos = (datos?.grupos || []).filter(g =>
    g.nombre.toLowerCase().includes(q) &&
    (filtro === 'todos' ||
      (filtro === 'ingresaron' ? g.ingresados > 0 : g.ingresados < g.entradas.length))
  )

  const invitados = (datos?.invitados || []).filter(i =>
    `${i.nombre} ${i.apellido}`.toLowerCase().includes(q) && cumpleFiltro(i.ingresado)
  )

  const total = datos?.resumen.total || 0
  const ingresados = datos?.resumen.ingresados || 0
  const porcentaje = total ? Math.round((ingresados / total) * 100) : 0

  return (
    <div style={ls.card}>
      <div style={ls.cabecera}>
        <button onClick={onVolver} style={ls.btnVolver}>← Escáner</button>
        <button onClick={() => setRefresco(n => n + 1)} style={ls.btnActualizar}>⟳ Actualizar</button>
      </div>

      {error && <div style={ls.error}>{error}</div>}

      {!datos && !error && <p style={ls.vacio}>Cargando lista...</p>}

      {datos && (
        <>
          <h2 style={ls.titulo}>{datos.evento.nombre_evento}</h2>

          <div style={ls.resumen}>
            <div style={ls.resumenFila}>
              <span><b style={ls.numVerde}>{ingresados}</b> ingresaron</span>
              <span><b style={ls.numRojo}>{total - ingresados}</b> faltan</span>
              <span style={{ color: '#64748b' }}>de {total}</span>
            </div>
            <div style={ls.barra}><div style={{ ...ls.barraLlena, width: `${porcentaje}%` }} /></div>
            {actualizado && (
              <p style={ls.actualizado}>
                Actualizado {actualizado.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}
                {' '}· se actualiza solo cada 10 s
              </p>
            )}
          </div>

          <div style={ls.filtros} role="tablist">
            {FILTROS.map(f => (
              <button key={f.id} role="tab" aria-selected={filtro === f.id}
                onClick={() => setFiltro(f.id)}
                style={filtro === f.id ? ls.filtroActivo : ls.filtro}>
                {f.texto}
              </button>
            ))}
          </div>

          <input type="search" value={busqueda} onChange={ev => setBusqueda(ev.target.value)}
            placeholder={esEgresados ? 'Buscar familia...' : 'Buscar invitado...'} style={ls.buscador} />

          {esEgresados ? (
            grupos.length === 0 ? <p style={ls.vacio}>No hay familias para mostrar.</p> : (
              grupos.map(g => {
                const completa = g.entradas.length > 0 && g.ingresados === g.entradas.length
                return (
                  <div key={g.id} style={completa ? { ...ls.familia, ...ls.familiaCompleta } : ls.familia}>
                    <div style={ls.familiaCabecera}>
                      <span style={ls.familiaNombre}>{g.nombre}</span>
                      <span style={completa ? ls.badgeVerde : ls.badgeGris}>
                        {completa ? '✓ Completa' : `${g.ingresados}/${g.entradas.length}`}
                      </span>
                    </div>
                    {g.entradas.map(en => (
                      <div key={en.id} style={ls.entrada}>
                        <span style={ls.entradaNum}>{en.numero} de {g.total}</span>
                        <span style={en.tipo_entrada === 'cena' ? ls.tipoCena : ls.tipoBaile}>{textoTipo(en.tipo_entrada)}</span>
                        <span style={en.ingresado ? ls.estadoOk : ls.estadoFalta}>
                          {en.ingresado ? `✓ ${en.fecha_ingreso ? formatearHora(en.fecha_ingreso) : ''}` : 'Falta'}
                        </span>
                      </div>
                    ))}
                  </div>
                )
              })
            )
          ) : (
            invitados.length === 0 ? <p style={ls.vacio}>No hay invitados para mostrar.</p> : (
              <div style={ls.lista}>
                {invitados.map(i => (
                  <div key={i.id} style={ls.invitado}>
                    <span style={ls.invitadoNombre}>{i.apellido}, {i.nombre}</span>
                    <span style={i.tipo_entrada === 'baile' ? ls.tipoBaile : ls.tipoCena}>{textoTipo(i.tipo_entrada)}</span>
                    <span style={i.ingresado ? ls.estadoOk : ls.estadoFalta}>
                      {i.ingresado ? `✓ ${i.fecha_ingreso ? formatearHora(i.fecha_ingreso) : ''}` : 'Falta'}
                    </span>
                  </div>
                ))}
              </div>
            )
          )}
        </>
      )}
    </div>
  )
}

const chip = { fontSize: '12px', fontWeight: '600', padding: '3px 9px', borderRadius: '999px', whiteSpace: 'nowrap' }

const ls = {
  card: { backgroundColor: 'white', borderRadius: '20px', padding: '18px 16px 22px', boxShadow: '0 4px 20px rgba(0,0,0,0.06)', border: '1px solid #e2e8f0' },
  cabecera: { display: 'flex', justifyContent: 'space-between', gap: '8px', marginBottom: '14px' },
  btnVolver: { padding: '9px 14px', backgroundColor: '#f1f5f9', color: '#334155', border: '1px solid #e2e8f0', borderRadius: '10px', fontSize: '14px', fontWeight: '600', cursor: 'pointer' },
  btnActualizar: { padding: '9px 14px', backgroundColor: 'white', color: '#1d4ed8', border: '1px solid #bfdbfe', borderRadius: '10px', fontSize: '14px', fontWeight: '600', cursor: 'pointer' },
  titulo: { margin: '0 0 12px', fontSize: '19px', fontWeight: '700', color: '#0f172a' },
  resumen: { backgroundColor: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '12px 14px', marginBottom: '14px' },
  resumenFila: { display: 'flex', gap: '14px', alignItems: 'baseline', flexWrap: 'wrap', fontSize: '14px', color: '#334155' },
  numVerde: { fontSize: '22px', color: '#16a34a' },
  numRojo: { fontSize: '22px', color: '#dc2626' },
  barra: { height: '8px', backgroundColor: '#e2e8f0', borderRadius: '999px', overflow: 'hidden', marginTop: '10px' },
  barraLlena: { height: '100%', backgroundColor: '#16a34a', borderRadius: '999px', transition: 'width 0.3s' },
  actualizado: { margin: '8px 0 0', fontSize: '12px', color: '#94a3b8' },
  filtros: { display: 'flex', gap: '6px', backgroundColor: '#f1f5f9', padding: '4px', borderRadius: '12px', marginBottom: '12px' },
  filtro: { flex: 1, padding: '9px 6px', border: 'none', borderRadius: '9px', backgroundColor: 'transparent', color: '#475569', fontSize: '14px', fontWeight: '600', cursor: 'pointer' },
  filtroActivo: { flex: 1, padding: '9px 6px', border: 'none', borderRadius: '9px', backgroundColor: 'white', color: '#0f172a', fontSize: '14px', fontWeight: '700', cursor: 'pointer', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' },
  buscador: { width: '100%', boxSizing: 'border-box', padding: '11px 14px', border: '1px solid #e2e8f0', borderRadius: '10px', fontSize: '16px', marginBottom: '14px', outline: 'none' },
  vacio: { textAlign: 'center', color: '#64748b', fontSize: '14px', margin: '24px 0' },
  error: { backgroundColor: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca', borderRadius: '10px', padding: '10px 12px', fontSize: '14px', marginBottom: '12px' },
  familia: { border: '1px solid #e2e8f0', borderRadius: '12px', padding: '12px', marginBottom: '10px' },
  familiaCompleta: { backgroundColor: '#f0fdf4', borderColor: '#bbf7d0' },
  familiaCabecera: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', marginBottom: '8px' },
  familiaNombre: { fontSize: '16px', fontWeight: '700', color: '#0f172a' },
  entrada: { display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 0', borderTop: '1px solid #f1f5f9', fontSize: '14px' },
  entradaNum: { minWidth: '52px', color: '#475569', fontWeight: '600' },
  tipoCena: { ...chip, backgroundColor: '#dcfce7', color: '#15803d' },
  tipoBaile: { ...chip, backgroundColor: '#ede9fe', color: '#6d28d9' },
  estadoOk: { marginLeft: 'auto', color: '#16a34a', fontWeight: '700', fontSize: '14px', whiteSpace: 'nowrap' },
  estadoFalta: { marginLeft: 'auto', color: '#dc2626', fontWeight: '600', fontSize: '14px', whiteSpace: 'nowrap' },
  badgeVerde: { ...chip, backgroundColor: '#dcfce7', color: '#15803d' },
  badgeGris: { ...chip, backgroundColor: '#f1f5f9', color: '#475569' },
  lista: { display: 'flex', flexDirection: 'column' },
  invitado: { display: 'flex', alignItems: 'center', gap: '10px', padding: '11px 4px', borderBottom: '1px solid #f1f5f9' },
  invitadoNombre: { fontSize: '15px', color: '#0f172a' }
}
