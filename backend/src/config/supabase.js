const { createClient } = require('@supabase/supabase-js')
require('dotenv').config()

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

module.exports = supabase  
// Al usar module.exports, cualquier otro archivo del proyecto puede importar esta conexión con un simple require('../config/supabase') sin tener que volver a configurarla.