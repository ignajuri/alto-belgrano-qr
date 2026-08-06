const { createClient } = require('@supabase/supabase-js')
const config = require('./env')

// Cliente con la SERVICE KEY: bypassea RLS. Esta clave NUNCA debe salir del
// backend ni aparecer en el bundle del frontend. Todas las tablas tienen RLS
// activo y solo policies para service_role, así que este es el único camino
// de acceso a los datos.
const supabase = createClient(config.supabaseUrl, config.supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
})

module.exports = supabase
