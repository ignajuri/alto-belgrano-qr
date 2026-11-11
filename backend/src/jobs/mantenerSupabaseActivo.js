const supabase = require('../config/supabase')

// Supabase pausa los proyectos del plan gratuito que pasan unos 7 días con
// poca actividad. Entre eventos el sistema puede quedar semanas sin uso, y el
// día de la fiesta la base estaría pausada hasta reactivarla a mano.
//
// Esta tarea hace una consulta mínima (cuenta eventos, sin traer filas) cada
// 12 horas mientras el backend está corriendo. Depende de que Render no apague
// el servidor por inactividad, o sea, del plan pago de Render.

const INTERVALO_MS = 12 * 60 * 60 * 1000
const PRIMERA_CONSULTA_MS = 60 * 1000

const consultar = async () => {
  try {
    const { count, error } = await supabase
      .from('eventos')
      .select('id', { count: 'exact', head: true })
    if (error) throw error
    console.log(`[supabase-activo] consulta ok (${count} eventos)`)
  } catch (error) {
    // Un fallo puntual no detiene la tarea: se reintenta en el próximo ciclo.
    console.error('[supabase-activo] la consulta falló:', error.message)
  }
}

const iniciarMantenerSupabaseActivo = () => {
  // unref: los temporizadores no impiden que el proceso termine en un reinicio.
  setTimeout(consultar, PRIMERA_CONSULTA_MS).unref()
  setInterval(consultar, INTERVALO_MS).unref()
}

module.exports = { iniciarMantenerSupabaseActivo, consultar }
