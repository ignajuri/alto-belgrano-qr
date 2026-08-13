# Seguridad — Alto Belgrano QR

Notas operativas del endurecimiento de seguridad. Leer antes de desplegar.

## Orden de despliegue (importante)

El backend depende de columnas que no existen todavía. Si desplegás el código
antes de correr la migración, el login va a fallar.

1. **Supabase** → SQL Editor → ejecutar las migraciones de `backend/migrations/`
   en orden numérico (`001_seguridad.sql`, después `002_retencion_datos.sql`).
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

## Retención de datos personales (Ley 25.326)

La ley pide que los datos se destruyan cuando dejan de ser necesarios para el
fin con que se recolectaron. Acá ese fin es controlar el acceso a un evento
puntual, así que una vez pasado el evento no hay razón para conservarlos.

`purgar_invitados_vencidos()` corre **todos los días a las 02:00 (hora
argentina)** vía pg_cron y borra nombre, apellido, DNI y email de los invitados
de todo evento cuya ventana de retención haya vencido. Antes de borrar congela
en la tabla `eventos` dos agregados —`total_invitados` y `total_ingresados`—
que no identifican a nadie, para no perder la estadística del salón.

**La ventana por defecto es 48 horas** después del fin del día del evento.

> ⚠️ **No bajar de 24 horas.** El QR sigue siendo válido hasta
> `QR_HORAS_DESPUES` (24 por defecto) después del fin del día del evento. Una
> retención menor borraría invitados cuyo QR todavía se puede escanear en la
> puerta. Las 48 horas dejan un día completo de margen para reclamos del tipo
> "no me dejaron entrar" o "¿cuántos vinieron?".

Para cambiar la ventana (ejemplo a 72 horas):

```sql
select cron.unschedule('purga-invitados-vencidos');
select cron.schedule('purga-invitados-vencidos', '0 5 * * *',
  $$ select public.purgar_invitados_vencidos(72) $$);
```

Para ejecutarla a mano:

```sql
select * from public.purgar_invitados_vencidos(48);
```

Para ver qué eventos siguen conservando datos personales y cuándo se purgan,
usar la consulta de la sección 6 de `002_retencion_datos.sql`.

En el dashboard, los eventos ya purgados muestran los totales y un aviso en vez
de la lista nominal, y no permiten importar.

## Auditoría

Tabla `auditoria`. Registra logins (exitosos y fallidos), bloqueos, altas y bajas
de usuarios y eventos, importaciones, reenvíos de QR, cada validación y cada
ingreso deshecho.

### Alta y edición manual de invitados

Además de la importación por Excel, un administrador puede agregar invitados de
a uno y corregir los datos de uno existente. Ambas operaciones aplican las
**mismas validaciones que el importador** (DNI numérico de 6 a 10 dígitos con
los puntos normalizados, email con formato válido en minúsculas), para que no
haya dos criterios distintos según por dónde entre el dato.

Dos invariantes que conviene no romper:

- **Editar nunca regenera el `qr_token`.** El código que el invitado ya tiene en
  su casilla tiene que seguir sirviendo. El token identifica la fila, no los
  datos.
- **El `qr_token` no sale nunca en las respuestas de la API.** Ni al crear, ni al
  editar, ni al listar. Es la credencial de acceso.

Si al editar cambia el email, el QR se reenvía solo a la dirección nueva: la
casilla corregida nunca había recibido nada. Queda en auditoría como
`qr_reenviado` con motivo `cambio_de_email`.

Un evento ya purgado rechaza altas nuevas: sus datos personales se borraron por
política de retención y volver a cargarlos contradice esa decisión.

### Deshacer un ingreso

Si un QR se escanea por error, el invitado queda sin poder entrar y su código no
sirve más. El botón **↩** en la lista de invitados revierte esa marca y devuelve
el QR a estado válido.

Está restringido a **administradores**, no a guardias: es exactamente la
operación que permitiría reciclar un QR para hacer entrar a dos personas con el
mismo código. Cada uso queda en `auditoria` con la acción `ingreso_deshecho`,
guardando quién lo hizo y cuál era el ingreso previo que se revirtió.

```sql
select a.creado_en, u.nombre as admin, a.detalle
from auditoria a left join usuarios u on u.id = a.usuario_id
where a.accion = 'ingreso_deshecho'
order by a.creado_en desc;
```

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

2. **Vulnerabilidad residual de dependencias.** `npm audit` reporta 2 moderadas
   en `uuid`, arrastrada por `exceljs`. El fallo afecta a `uuid.v3/v5/v6` cuando
   se les pasa un buffer; `exceljs` solo usa `uuid.v4()`, así que no es
   explotable acá. La única "solución" que ofrece npm es bajar `exceljs` a la
   versión 3.4.0, que es una regresión mayor. Revisar cuando exceljs actualice.
