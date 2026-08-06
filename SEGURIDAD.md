# Seguridad — Alto Belgrano QR

Notas operativas del endurecimiento de seguridad. Leer antes de desplegar.

## Orden de despliegue (importante)

El backend depende de columnas que no existen todavía. Si desplegás el código
antes de correr la migración, el login va a fallar.

1. **Supabase** → SQL Editor → ejecutar `backend/migrations/001_seguridad.sql`.
2. **Render** → cargar las variables de entorno nuevas (ver abajo) → redeploy.
3. **Vercel** → verificar `VITE_API_URL` → redeploy.

## Variables de entorno

### Render (backend)

Ver `backend/.env.example` para la lista completa. Las que hay que agregar o
revisar sí o sí:

| Variable | Notas |
|---|---|
| `JWT_SECRET` | **Mínimo 32 caracteres.** El servidor no arranca si es más corto. Generar con `openssl rand -base64 48`. |
| `CORS_ORIGENES` | `https://alto-belgrano-qr.vercel.app`. Separar por comas si hay más de uno. |
| `EMAIL_REMITENTE` | Cambiar por un dominio propio verificado en Resend. |
| `NODE_ENV` | `production` |

Si cambiás el `JWT_SECRET`, todas las sesiones abiertas se invalidan. Es lo
esperado y conviene hacerlo una vez al pasar a producción real.

### Vercel (frontend)

| Variable | Valor |
|---|---|
| `VITE_API_URL` | `https://alto-belgrano-qr.onrender.com/api` |

`VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` **ya no se usan** y se pueden
borrar. El frontend no habla con Supabase directamente.

> Recordá: cualquier variable con prefijo `VITE_` termina dentro del bundle
> público. Nunca poner ahí una clave que deba ser secreta.

## Decisiones de diseño

### Row Level Security

Las cuatro tablas (`usuarios`, `eventos`, `invitados`, `auditoria`) tienen RLS
activo y **solo** políticas para `service_role`. El rol `anon` no puede leer ni
escribir nada.

**No agregar políticas para `anon`.** La tabla `invitados` contiene los
`qr_token`, que son la credencial de acceso al evento: exponerlos permitiría
generar QRs válidos. Si el frontend necesita datos nuevos, se agregan al backend.

Esto es también la razón por la que se eliminó la suscripción de Supabase
Realtime del dashboard: con RLS activo y sin policy para `anon`, el servidor
nunca entregaba los eventos, así que la actualización "en vivo" no funcionaba.
Ahora el dashboard consulta al backend cada 8 segundos.

### Revocación de sesiones

Los JWT son stateless y duran 12 horas, pero `verificarToken` consulta la base
en cada request y verifica:

- que el usuario siga existiendo y esté `activo`
- el **rol real** (no el que dice el token)
- que el token se haya emitido después de `password_changed_at`

Consecuencias prácticas:

- Desactivar un usuario lo saca del sistema **inmediatamente**.
- Cambiar la contraseña de alguien cierra todas sus sesiones abiertas.

### Ventana de validez del QR

Configurable con `QR_HORAS_ANTES` (default 12) y `QR_HORAS_DESPUES` (default 24),
relativas al día del evento en horario argentino (UTC-3).

Con los valores por defecto, el QR de un evento del sábado sirve desde el viernes
al mediodía hasta el domingo a la noche. Antes no había límite inferior: un QR
emitido con meses de anticipación servía desde el momento del envío.

Además, el escáner opera sobre un evento seleccionado y el backend rechaza
cualquier QR que pertenezca a otro.

### Doble uso del mismo QR

La marca de ingreso usa un `UPDATE ... WHERE ingresado = false` y verifica que
haya afectado una fila. Dos escaneos simultáneos del mismo código: solo uno pasa.

Por eso la migración fuerza `ingresado NOT NULL` — la condición no matchearía
filas con `NULL`.

## Política de contraseñas

Mínimo 10 caracteres, al menos una letra y un número. Hash con bcrypt, coste 12.

- **Login**: máximo 10 intentos por IP cada 15 minutos, y bloqueo de la cuenta
  por 15 minutos tras 5 fallos (cubre al atacante que rota IPs).
- **Cambio de contraseña propia**: exige la contraseña actual.
- Un admin puede resetear la contraseña de otro usuario sin conocer la anterior;
  queda registrado en `auditoria`.

## Auditoría

Tabla `auditoria`. Registra logins (exitosos y fallidos), bloqueos, altas y bajas
de usuarios y eventos, importaciones, reenvíos de QR y cada validación.

Consultas útiles:

```sql
-- Intentos de login fallidos de las últimas 24 horas
select creado_en, usuario_email, ip, detalle
from auditoria
where accion = 'login_fallido' and creado_en > now() - interval '24 hours'
order by creado_en desc;

-- Quién validó cada ingreso de un evento
select a.creado_en, u.nombre as guardia, a.detalle
from auditoria a left join usuarios u on u.id = a.usuario_id
where a.accion = 'qr_validado'
order by a.creado_en desc;
```

Conviene purgar periódicamente:

```sql
delete from auditoria where creado_en < now() - interval '12 months';
```

## Pendientes que requieren decisión

Estas quedan fuera del código porque dependen de vos:

1. **Dominio propio en Resend.** Hoy el remitente es `onboarding@resend.dev`, que
   solo entrega a la casilla dueña de la cuenta. Con invitados reales los mails
   van a fallar o a spam. Hay que verificar un dominio con SPF, DKIM y DMARC.

2. **Retención de datos personales.** Los invitados (nombre, DNI, email) quedan
   indefinidamente. La Ley 25.326 pide un plazo definido. Sugerencia: borrar
   invitados de eventos con más de 12 meses.

   ```sql
   delete from invitados
   where evento_id in (select id from eventos where fecha < current_date - interval '12 months');
   ```

3. **Historial de git.** Los archivos `prueba.xlsx` e `invitados_prueba.xlsx`
   fueron sacados del seguimiento, pero siguen en los commits anteriores con
   emails reales. Para purgarlos del historial hace falta reescribirlo
   (`git filter-repo`), lo que obliga a un push forzado. Decisión tuya.

4. **Vulnerabilidad residual de dependencias.** `npm audit` reporta 2 moderadas
   en `uuid`, arrastrada por `exceljs`. El fallo afecta a `uuid.v3/v5/v6` cuando
   se les pasa un buffer; `exceljs` solo usa `uuid.v4()`, así que no es
   explotable acá. La única "solución" que ofrece npm es bajar `exceljs` a la
   versión 3.4.0, que es una regresión mayor. Revisar cuando exceljs actualice.
