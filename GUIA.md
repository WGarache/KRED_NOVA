# Kred Nova · ERP de Cobros — v0.2

Sistema web para gestionar clientes, cartera y cobros, con la imagen de **Kred Nova**.
Funciona en computadora y en el celular del gestor (se puede agregar a la pantalla principal como una app).

---

## 1. Qué cambió en la v0.2

| Tema | Cómo funciona ahora |
|---|---|
| **Imagen** | Logo y colores de Kred Nova (azul marino y dorado) en todas las pantallas, recibos y estados de cuenta |
| **Interés** | Flat, expresado en **% mensual**. Interés total = monto × tasa × meses, repartido en partes iguales en las cuotas |
| **Frecuencias** | Diaria (lunes a sábado, sin feriados), semanal y quincenal. Cuotas por mes: 26 / 4 / 2 (se puede cambiar al crear el crédito) |
| **Moneda** | Solo córdobas |
| **Mora** | No hay cargos por mora ni días de gracia. El sistema solo mide días de atraso |
| **Pagos** | Se aplican a la cuota más antigua: interés y luego capital. Lo que sobra **adelanta cuotas**; el recibo dice cuántas |
| **Clientes** | Nunca se eliminan: se **inactivan** con motivo (solo si no tienen créditos vigentes) |
| **Fiador** | Nombre, cédula, teléfono y dirección en cada crédito |
| **Garantías** | Descripción, valor estimado y **foto** (desde la cámara del celular) |
| **Cédula** | Foto de la cédula del cliente |
| **Ruta de cobro** | Lista diaria del gestor: a quién cobrar, cuánto, botones de **Cobrar**, **Llamar**, **Cómo llegar** (Google Maps) y **Registrar visita** (promesa de pago, no se encontró, sin dinero) |
| **Calendario** | Archivo de agenda (.ics) con las visitas de los próximos 14 días y las promesas de pago |
| **Reportes** | Cobros por período, por usuario, desembolsos y cartera por gestor; todos imprimibles |
| **Estado de cuenta** | PDF con logo, listo para imprimir y entregar al cliente, con espacio para firmas |

---

## 2. Actualizar desde la v0.1 (su computadora)

La estructura de la base de datos cambió, así que hay que crearla de nuevo (solo tenía datos de prueba).

1. Detenga el servidor si está corriendo (**Ctrl + C**).
2. Descomprima el nuevo `erp_cobros.zip` **encima** de la carpeta actual
   `D:\Visual Estudio Programming\ERP\erp_cobros` y acepte reemplazar los archivos.
   Su carpeta `venv` se conserva.
3. En PowerShell:

```powershell
cd "D:\Visual Estudio Programming\ERP\erp_cobros"
venv\Scripts\activate
Remove-Item db.sqlite3
python -m pip install -r requirements.txt
python manage.py migrate
python manage.py demo
```

> Si `Remove-Item` dice que no encuentra el archivo, continúe con el siguiente comando.

---

## 3. Arrancar el sistema (cada vez)

```powershell
cd "D:\Visual Estudio Programming\ERP\erp_cobros"
venv\Scripts\activate
$env:DJANGO_ALLOWED_HOSTS="192.168.1.40,localhost,127.0.0.1"
python manage.py runserver 0.0.0.0:8000
```

- En la computadora: **http://127.0.0.1:8000**
- En el celular (misma Wi-Fi): **http://192.168.1.40:8000**
- Para usarlo como app en Android: Chrome → **⋮** → **Agregar a pantalla principal**.

### Usuarios de prueba (contraseña `demo1234`)

| Usuario | Rol | Ve |
|---|---|---|
| `gerente` | Gerente | Todo; inactiva clientes, declara incobrables, bitácora |
| `cajero` | Cajero | Clientes, créditos, pagos y reportes |
| `gestor1` / `gestor2` | Gestor | Solo su ruta y su cartera (ideal para el celular) |
| `admin` | Administrador | Todo + panel técnico en `/admin` |

### Recorrido sugerido
1. **gerente** en la computadora: revise el Panel y abra un cliente atrasado.
2. **Clientes → + Nuevo cliente** (pruebe subir una foto de cédula) → **+ Nuevo crédito** → *Calcular plan de pagos* → *Confirmar desembolso*.
3. En el crédito: agregue una **garantía con foto** e **imprima el estado de cuenta**.
4. **gestor1** en el celular: abra la **Ruta de cobro**, toque **Cobrar**, use los botones de monto rápido y vea cómo cambia el resultado; confirme e imprima/comparta el recibo.
5. Registre una **visita sin cobro** con promesa de pago para mañana.
6. **gerente**: revise **Reportes** y **Bitácora**.

---

## 4. Ajustes que usted puede cambiar

En `config/settings.py`:

| Ajuste | Para qué |
|---|---|
| `FERIADOS` | Días en que no se cobra a créditos diarios. **Revise y actualice la lista cada año** |
| `COBRAR_DOMINGOS` | Póngalo en `True` si algún día cobran domingos |
| `EMPRESA_NOMBRE` | Nombre que aparece en recibos y estados de cuenta |

El logo está en `cartera/static/kred/logo.png` y los colores en `cartera/static/kred/kred.css` (primeras líneas).

---

## 5. Correo (opcional)

El estado de cuenta está pensado para **imprimir**. Si un cliente tiene correo, también se puede enviar desde el crédito. Para activarlo con Gmail:

1. Active la verificación en 2 pasos en la cuenta de Google.
2. Cree una contraseña de aplicación en https://myaccount.google.com/apppasswords
3. Antes de arrancar el servidor:
```powershell
$env:EMAIL_HOST_USER="sucorreo@gmail.com"
$env:EMAIL_HOST_PASSWORD="xxxx xxxx xxxx xxxx"
```
Sin esto, los correos solo se muestran en la ventana de PowerShell (modo prueba).

---

## 6. Antes de usarlo con datos reales

- [ ] Publicarlo en un servidor (nube o PC dedicada) para que los gestores lo usen fuera de la oficina — se prepara en la siguiente fase.
- [ ] Eliminar los usuarios de prueba y crear los reales con contraseñas fuertes (`python manage.py createsuperuser` y luego `/admin`).
- [ ] No ejecutar `python manage.py demo`.
- [ ] Respaldo diario de la base de datos **y** de la carpeta `media` (fotos de cédulas y garantías).

---

## 7. Estructura

```
erp_cobros/
├── config/settings.py            ← feriados, nombre de la empresa, correo
├── templates/                    ← plantilla base y pantalla de ingreso
└── cartera/
    ├── models.py                 ← REGLAS DE NEGOCIO (interés flat, cuotas, pagos)
    ├── views.py                  ← pantallas y permisos por rol
    ├── servicios.py              ← PDF, correo y agenda .ics
    ├── static/kred/              ← logo, colores, ícono de la app
    └── templates/cartera/        ← pantallas, recibo y estado de cuenta
```
