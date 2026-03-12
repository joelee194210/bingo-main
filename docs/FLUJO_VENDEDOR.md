# Flujo del Vendedor - Activacion y Venta de Cartones

## Resumen

Este documento describe los pasos que sigue un **vendedor** para activar, vender y devolver cartones de bingo en la plataforma Bingo Pro, cubriendo dos modalidades:

- **Consignacion**: El vendedor recibe cartones y los activa a medida que los vende.
- **Prepagados**: Los cartones ya vienen activados desde la asignacion.

---

## 1. Modalidad Consignacion (Venta en Campo)

En esta modalidad, el administrador asigna cartones al vendedor. El vendedor los lleva fisicamente y los activa uno por uno cuando los vende al comprador final.

### Paso 1 - Recibir cartones asignados

1. El administrador configura la jerarquia de inventario (Menu: **Inventario**)
2. El administrador asigna un lote de cartones al vendedor (ej: Serie 00001 a 00010 = 500 cartones)
3. El vendedor recibe los cartones fisicos impresos

> Los cartones en este punto estan en estado **"Asignado"** pero **NO activados** (`is_sold = 0`).
> No participan en juegos de modo real hasta que sean activados.

### Paso 2 - Activar/Vender un carton

1. El vendedor ingresa a la plataforma: **Menu → Venta**
2. Escanea o escribe el **codigo del carton** (ej: `SK3WS`) que aparece impreso
3. El sistema muestra los datos del carton: numero, serie, estado
4. El vendedor completa:
   - **Nombre del comprador** (obligatorio)
   - **Telefono** (opcional)
5. Presiona **"Activar Carton"**
6. El carton queda marcado como **vendido/activo** y ahora participa en los juegos

### Paso 3 - Verificar ventas

- En **Menu → Inventario**, el vendedor puede ver su resumen:
  - Cartones en mano (sin vender)
  - Cartones vendidos
  - Total asignados

### Paso 4 - Devolucion de cartones no vendidos

Cuando termina el periodo de venta, el vendedor devuelve los cartones que no vendio:

1. El administrador ingresa a **Inventario** y selecciona el nodo del vendedor
2. Selecciona los cartones a devolver (por rango de serie o numeros)
3. Ejecuta la **devolucion** (opcion "Devolver al padre")
4. Los cartones regresan al nodo padre y quedan disponibles para reasignar

> **Fecha limite de devolucion**: El administrador debe coordinar una fecha especifica de corte para devoluciones. Despues de esa fecha, los cartones no devueltos se consideran responsabilidad del vendedor.

---

## 2. Modalidad Prepagados (Cartones Pre-activados)

En esta modalidad, los cartones se venden por adelantado (ej: paquetes en punto de venta). Llegan al comprador ya activados.

### Paso 1 - Preparar cartones prepagados

1. El administrador va a **Inventario** y asigna un lote al punto de venta
2. Desde el inventario, ejecuta **"Venta"** en bloque para todo el lote:
   - Selecciona rango de series o numeros
   - Opcionalmente agrega nombre del punto de venta como comprador
3. Todos los cartones del lote quedan como **vendidos/activos** inmediatamente

> Los cartones prepagados ya participan en los juegos desde el momento de la activacion en bloque.

### Paso 2 - Entrega al comprador

- Los cartones fisicos se entregan al comprador ya activados
- No requieren activacion individual en la plataforma

### Paso 3 - Devolucion de prepagados

Si se devuelve un paquete de cartones prepagados (por cancelacion, devolucion, etc.):

1. El administrador ingresa a **Inventario**
2. Selecciona el nodo donde estan asignados los cartones
3. Ejecuta la devolucion al nodo padre
4. **Los cartones deben desactivarse manualmente**: el administrador cambia su estado de vuelta a "no vendido"

> **Importante**: La devolucion de prepagados debe hacerse antes de la **fecha de corte** acordada. Despues de esa fecha, los cartones activados no se pueden devolver.

---

## 3. Tabla Comparativa

| Aspecto | Consignacion | Prepagado |
|---------|-------------|-----------|
| **Estado inicial del carton** | Asignado, NO activo | Asignado y ACTIVO |
| **Quien activa** | El vendedor al vender | El administrador en bloque |
| **Activacion** | Individual (1 por 1) | Masiva (lote completo) |
| **Participa en juegos** | Solo despues de activar | Inmediatamente |
| **Devolucion** | Devolver cartones no vendidos | Devolver + desactivar |
| **Fecha de corte** | Si, para cierre de cuentas | Si, para cancelaciones |

---

## 4. Pasos Rapidos para el Vendedor

### Vender un carton (dia a dia)

```
1. Abrir Menu → Venta
2. Escribir o escanear el codigo del carton
3. Escribir nombre del comprador
4. Presionar "Activar Carton"
5. Listo - el carton esta activo
```

### Consultar mi inventario

```
1. Abrir Menu → Inventario
2. Seleccionar el evento
3. Buscar mi nodo en el arbol
4. Ver: En mano / Vendidos / Total
```

### Validar un carton (para el comprador)

```
1. Abrir Menu → Validar
2. Escribir el codigo del carton
3. Ver datos del carton y numeros
4. Si tiene raspadito: presionar "Revelar Raspadito"
```

---

## 5. Consideraciones de Fecha de Corte

Para ambas modalidades se recomienda establecer una **fecha limite de devolucion**:

| Momento | Accion |
|---------|--------|
| **Antes del corte** | Vendedor puede devolver cartones no vendidos sin problema |
| **En la fecha de corte** | El administrador recoge cartones fisicos y procesa devoluciones en sistema |
| **Despues del corte** | No se aceptan devoluciones. Cartones no devueltos = responsabilidad del vendedor |

> **Nota**: Actualmente la plataforma no tiene un campo de "fecha de corte" automatizado. El control de fechas se maneja administrativamente. Se puede agregar esta funcionalidad en una version futura para bloquear devoluciones automaticamente despues de la fecha establecida.

---

## 6. Flujo Visual

```
CONSIGNACION:
Admin crea cartones → Asigna a vendedor → Vendedor activa 1x1 al vender
                                        → Vendedor devuelve sobrantes

PREPAGADO:
Admin crea cartones → Activa lote completo → Entrega al punto de venta
                                           → Devolucion + desactivacion si aplica
```
