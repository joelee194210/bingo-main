# Sistema de Inventario de Cartones de Bingo Americano
## Documento de Requerimientos de Software (SRS)

**Versión:** 1.0
**Fecha:** 2026-03-11
**Autor:** Joe Lee / Versatec Inc.
**Tecnología:** PHP 8.2+ / MySQL 8+ / Laravel 11

---

## 1. Introducción

### 1.1 Propósito

Sistema de control de inventario para cartones de Bingo Americano (75 números) que permite rastrear el flujo completo de mercancía desde el suplidor principal (Bingos Nacionales) a través de toda la cadena de distribución hasta el despacho final al comprador.

### 1.2 Alcance

El sistema gestiona el inventario de cartones empacados en:

- **Cartón individual**: Unidad mínima, con código QR único, grilla 5x5 (B-I-N-G-O)
- **Lote/Libreta**: Paquete de **50 cartones** consecutivos, con QR de lote
- **Caja**: Contiene hasta **60 lotes** (3,000 cartones máx.), con QR de caja

### 1.3 Cadena de Distribución

```
Bingos Nacionales (Suplidor Principal / Bodega Central)
    │
    ├── Lotería Nacional (Revendedor)
    │       ├── Agencia Centro
    │       │       ├── Billetero Juan
    │       │       └── Billetero María
    │       ├── Agencia Norte
    │       │       └── Billetero Pedro
    │       └── Agencia Sur (traslados ↔ otras agencias)
    │
    ├── Lotería XYZ (Otro Revendedor)
    │       └── ...
    │
    └── Otros Suplidores / Revendedores
```

### 1.4 Integración con Sistema Existente

El sistema actual de generación de cartones (Node.js/TypeScript) produce cartones con esta estructura:

- **card_code**: Código alfanumérico de 5 caracteres (único global)
- **validation_code**: Código de validación de 5 caracteres (único global)
- **serial**: Formato `XXXXX-YY` donde XXXXX = serie (lote), YY = posición (01-50)
- **numbers**: JSON con columnas B(1-15), I(16-30), N(31-45), G(46-60), O(61-75)
- **numbers_hash**: SHA256 truncado a 32 chars para verificación de integridad
- **QR Template**: URL configurable con variables `{card_code}`, `{validation_code}`, `{serial}`, `{card_number}`

El sistema PHP de inventario consumirá los datos ya generados vía API REST o importación de base de datos SQLite.

---

## 2. Actores del Sistema

### 2.1 Roles y Permisos

| Rol | Descripción | Visibilidad | Acciones Permitidas |
|-----|-------------|-------------|---------------------|
| **super_admin** | Administrador global (Bingos Nacionales) | Todo el sistema | CRUD completo, configuración, reportes globales |
| **suplidor** | Encargado de bodega del suplidor | Su organización y sus clientes directos | Despachos a revendedores, recepción de devoluciones, traslados internos |
| **revendedor_admin** | Admin de revendedor (ej: Gerente Lotería) | Solo su organización y sub-entidades | Recepción, despachos a agencias, traslados entre agencias, devoluciones al suplidor |
| **agencia** | Encargado de agencia | Solo su agencia y billeteros asignados | Recepción, despachos a billeteros, devoluciones a revendedor |
| **billetero** | Vendedor final en calle | Solo su inventario asignado | Recepción, venta al público, devolución a agencia |
| **auditor** | Solo lectura | Todo el sistema (solo lectura) | Consultas, reportes, auditoría |

### 2.2 Regla de Visibilidad (Multi-Tenancy)

**Cada usuario solo ve la información de su organización/cliente.** Ejemplo: un usuario de "Lotería Nacional" puede ver y mover inventario solo dentro de la estructura de Lotería Nacional (sus agencias, sus billeteros). No puede ver inventario de otros revendedores.

---

## 3. Modelo de Datos

### 3.1 Entidades Principales

#### 3.1.1 Organizaciones (`organizaciones`)

```sql
CREATE TABLE organizaciones (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    parent_id BIGINT UNSIGNED NULL,          -- NULL = raíz (Bingos Nacionales)
    tipo ENUM('suplidor', 'revendedor', 'agencia') NOT NULL,
    nombre VARCHAR(200) NOT NULL,
    codigo VARCHAR(20) NOT NULL UNIQUE,       -- Código corto identificador
    rnc VARCHAR(20),                          -- RNC o documento fiscal
    direccion TEXT,
    telefono VARCHAR(20),
    email VARCHAR(100),
    contacto_nombre VARCHAR(100),
    is_active TINYINT(1) DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (parent_id) REFERENCES organizaciones(id)
);
-- Jerarquía: Suplidor → Revendedor → Agencia
```

#### 3.1.2 Bodegas (`bodegas`)

```sql
CREATE TABLE bodegas (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    organizacion_id BIGINT UNSIGNED NOT NULL,
    nombre VARCHAR(100) NOT NULL,
    codigo VARCHAR(20) NOT NULL UNIQUE,
    tipo ENUM('principal', 'secundaria', 'transito') NOT NULL,
    direccion TEXT,
    responsable_id BIGINT UNSIGNED NULL,
    is_active TINYINT(1) DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (organizacion_id) REFERENCES organizaciones(id),
    FOREIGN KEY (responsable_id) REFERENCES usuarios(id)
);
```

#### 3.1.3 Billeteros (`billeteros`)

```sql
CREATE TABLE billeteros (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    agencia_id BIGINT UNSIGNED NOT NULL,     -- Referencia a organizacion tipo 'agencia'
    usuario_id BIGINT UNSIGNED NULL,
    nombre VARCHAR(100) NOT NULL,
    cedula VARCHAR(20) UNIQUE,
    telefono VARCHAR(20),
    email VARCHAR(100),
    zona_asignada VARCHAR(100),
    is_active TINYINT(1) DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (agencia_id) REFERENCES organizaciones(id),
    FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
);
```

#### 3.1.4 Usuarios (`usuarios`)

```sql
CREATE TABLE usuarios (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    organizacion_id BIGINT UNSIGNED NOT NULL,
    billetero_id BIGINT UNSIGNED NULL,        -- Si es billetero
    username VARCHAR(50) NOT NULL UNIQUE,
    email VARCHAR(100) UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    nombre_completo VARCHAR(100) NOT NULL,
    rol ENUM('super_admin','suplidor','revendedor_admin','agencia','billetero','auditor') NOT NULL,
    is_active TINYINT(1) DEFAULT 1,
    last_login DATETIME NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (organizacion_id) REFERENCES organizaciones(id),
    FOREIGN KEY (billetero_id) REFERENCES billeteros(id)
);
```

### 3.2 Entidades de Inventario

#### 3.2.1 Cajas (`cajas`)

```sql
CREATE TABLE cajas (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    event_id INT NOT NULL,                    -- Referencia al evento de bingo (sistema existente)
    codigo_caja VARCHAR(30) NOT NULL UNIQUE,  -- Código QR de la caja
    qr_data TEXT NOT NULL,                    -- Datos codificados en el QR
    total_lotes INT NOT NULL DEFAULT 60,
    lotes_actuales INT NOT NULL DEFAULT 60,
    serial_desde VARCHAR(20) NOT NULL,        -- Primer serial del primer lote
    serial_hasta VARCHAR(20) NOT NULL,        -- Último serial del último lote
    card_number_desde INT NOT NULL,           -- Primer card_number
    card_number_hasta INT NOT NULL,           -- Último card_number
    estado ENUM('disponible','parcial','despachada','devuelta','anulada') DEFAULT 'disponible',
    bodega_actual_id BIGINT UNSIGNED NULL,
    billetero_actual_id BIGINT UNSIGNED NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (bodega_actual_id) REFERENCES bodegas(id),
    FOREIGN KEY (billetero_actual_id) REFERENCES billeteros(id)
);
CREATE INDEX idx_cajas_bodega ON cajas(bodega_actual_id, estado);
CREATE INDEX idx_cajas_evento ON cajas(event_id);
```

#### 3.2.2 Lotes/Libretas (`lotes`)

```sql
CREATE TABLE lotes (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    caja_id BIGINT UNSIGNED NOT NULL,
    event_id INT NOT NULL,
    codigo_lote VARCHAR(30) NOT NULL UNIQUE,  -- Código QR del lote
    qr_data TEXT NOT NULL,
    numero_lote INT NOT NULL,                 -- Posición dentro de la caja (1-60)
    total_cartones INT NOT NULL DEFAULT 50,
    cartones_actuales INT NOT NULL DEFAULT 50,
    serial_desde VARCHAR(20) NOT NULL,        -- Primer serial (ej: 00001-01)
    serial_hasta VARCHAR(20) NOT NULL,        -- Último serial (ej: 00001-50)
    card_number_desde INT NOT NULL,
    card_number_hasta INT NOT NULL,
    estado ENUM('disponible','parcial','despachado','devuelto','anulado') DEFAULT 'disponible',
    bodega_actual_id BIGINT UNSIGNED NULL,
    billetero_actual_id BIGINT UNSIGNED NULL,
    is_prepago TINYINT(1) DEFAULT 0,          -- Libreta prepaga
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (caja_id) REFERENCES cajas(id),
    FOREIGN KEY (bodega_actual_id) REFERENCES bodegas(id),
    FOREIGN KEY (billetero_actual_id) REFERENCES billeteros(id)
);
CREATE INDEX idx_lotes_caja ON lotes(caja_id);
CREATE INDEX idx_lotes_bodega ON lotes(bodega_actual_id, estado);
```

#### 3.2.3 Cartones en Inventario (`inventario_cartones`)

Vista lógica que vincula los cartones del sistema existente con el inventario.

```sql
CREATE TABLE inventario_cartones (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    card_id INT NOT NULL,                     -- FK al sistema existente (cards.id)
    lote_id BIGINT UNSIGNED NOT NULL,
    card_code VARCHAR(10) NOT NULL,           -- Copia del card_code para búsquedas rápidas
    validation_code VARCHAR(10) NOT NULL,
    serial VARCHAR(20) NOT NULL,
    card_number INT NOT NULL,
    numbers_hash VARCHAR(64) NOT NULL,
    estado ENUM('disponible','despachado','vendido','devuelto','anulado') DEFAULT 'disponible',
    ubicacion_tipo ENUM('bodega','billetero','vendido','transito') DEFAULT 'bodega',
    bodega_actual_id BIGINT UNSIGNED NULL,
    billetero_actual_id BIGINT UNSIGNED NULL,
    comprador_nombre VARCHAR(100) NULL,
    comprador_telefono VARCHAR(20) NULL,
    vendido_at DATETIME NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (lote_id) REFERENCES lotes(id),
    FOREIGN KEY (bodega_actual_id) REFERENCES bodegas(id),
    FOREIGN KEY (billetero_actual_id) REFERENCES billeteros(id)
);
CREATE UNIQUE INDEX idx_inv_card_code ON inventario_cartones(card_code);
CREATE INDEX idx_inv_lote ON inventario_cartones(lote_id);
CREATE INDEX idx_inv_bodega ON inventario_cartones(bodega_actual_id, estado);
CREATE INDEX idx_inv_billetero ON inventario_cartones(billetero_actual_id, estado);
CREATE INDEX idx_inv_serial ON inventario_cartones(serial);
```

### 3.3 Entidades de Movimiento

#### 3.3.1 Movimientos (`movimientos`)

```sql
CREATE TABLE movimientos (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    tipo ENUM(
        'despacho',          -- Salida hacia nivel inferior
        'recepcion',         -- Entrada desde nivel superior
        'traslado',          -- Movimiento lateral (entre bodegas del mismo nivel)
        'devolucion',        -- Retorno hacia nivel superior
        'venta',             -- Venta al público (billetero → comprador)
        'ajuste_entrada',    -- Ajuste positivo de inventario
        'ajuste_salida'      -- Ajuste negativo de inventario
    ) NOT NULL,
    numero_movimiento VARCHAR(30) NOT NULL UNIQUE,  -- Autoincremental formateado: MOV-2026-000001

    -- Origen
    origen_bodega_id BIGINT UNSIGNED NULL,
    origen_billetero_id BIGINT UNSIGNED NULL,
    origen_organizacion_id BIGINT UNSIGNED NOT NULL,

    -- Destino
    destino_bodega_id BIGINT UNSIGNED NULL,
    destino_billetero_id BIGINT UNSIGNED NULL,
    destino_organizacion_id BIGINT UNSIGNED NOT NULL,

    -- Totales
    total_cajas INT DEFAULT 0,
    total_lotes INT DEFAULT 0,
    total_cartones INT DEFAULT 0,

    -- Estado
    estado ENUM('borrador','pendiente','en_transito','recibido','rechazado','cancelado') DEFAULT 'borrador',

    -- Notas y observaciones
    observaciones TEXT,
    motivo_rechazo TEXT,

    -- Auditoría
    creado_por BIGINT UNSIGNED NOT NULL,
    recibido_por BIGINT UNSIGNED NULL,
    fecha_despacho DATETIME NULL,
    fecha_recepcion DATETIME NULL,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    FOREIGN KEY (origen_bodega_id) REFERENCES bodegas(id),
    FOREIGN KEY (origen_billetero_id) REFERENCES billeteros(id),
    FOREIGN KEY (origen_organizacion_id) REFERENCES organizaciones(id),
    FOREIGN KEY (destino_bodega_id) REFERENCES bodegas(id),
    FOREIGN KEY (destino_billetero_id) REFERENCES billeteros(id),
    FOREIGN KEY (destino_organizacion_id) REFERENCES organizaciones(id),
    FOREIGN KEY (creado_por) REFERENCES usuarios(id),
    FOREIGN KEY (recibido_por) REFERENCES usuarios(id)
);
CREATE INDEX idx_mov_tipo_estado ON movimientos(tipo, estado);
CREATE INDEX idx_mov_origen ON movimientos(origen_organizacion_id, created_at);
CREATE INDEX idx_mov_destino ON movimientos(destino_organizacion_id, created_at);
CREATE INDEX idx_mov_fecha ON movimientos(created_at);
```

#### 3.3.2 Detalle de Movimientos (`movimiento_detalle`)

Grilla de cada transacción: registra exactamente qué cajas, lotes y/o cartones individuales se movieron.

```sql
CREATE TABLE movimiento_detalle (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    movimiento_id BIGINT UNSIGNED NOT NULL,

    -- Tipo de unidad movida
    tipo_unidad ENUM('caja', 'lote', 'carton') NOT NULL,

    -- Referencias (según tipo_unidad)
    caja_id BIGINT UNSIGNED NULL,
    lote_id BIGINT UNSIGNED NULL,
    carton_id BIGINT UNSIGNED NULL,            -- inventario_cartones.id

    -- Información desnormalizada para la grilla de transacción
    codigo VARCHAR(30) NOT NULL,               -- codigo_caja, codigo_lote o card_code
    serial_desde VARCHAR(20) NULL,
    serial_hasta VARCHAR(20) NULL,
    cantidad_cartones INT NOT NULL,             -- 3000 para caja, 50 para lote, 1 para cartón

    -- Estado de este ítem específico
    estado ENUM('incluido','recibido','rechazado','faltante') DEFAULT 'incluido',
    observacion TEXT,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (movimiento_id) REFERENCES movimientos(id) ON DELETE CASCADE,
    FOREIGN KEY (caja_id) REFERENCES cajas(id),
    FOREIGN KEY (lote_id) REFERENCES lotes(id),
    FOREIGN KEY (carton_id) REFERENCES inventario_cartones(id)
);
CREATE INDEX idx_detalle_mov ON movimiento_detalle(movimiento_id);
CREATE INDEX idx_detalle_caja ON movimiento_detalle(caja_id);
CREATE INDEX idx_detalle_lote ON movimiento_detalle(lote_id);
```

#### 3.3.3 Log de Auditoría (`auditoria`)

```sql
CREATE TABLE auditoria (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    tabla VARCHAR(50) NOT NULL,
    registro_id BIGINT UNSIGNED NOT NULL,
    accion ENUM('crear','modificar','eliminar','despachar','recibir','devolver','trasladar','vender','anular') NOT NULL,
    datos_anteriores JSON NULL,
    datos_nuevos JSON NULL,
    usuario_id BIGINT UNSIGNED NOT NULL,
    ip_address VARCHAR(45),
    user_agent TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
);
CREATE INDEX idx_audit_tabla ON auditoria(tabla, registro_id);
CREATE INDEX idx_audit_usuario ON auditoria(usuario_id, created_at);
CREATE INDEX idx_audit_fecha ON auditoria(created_at);
```

---

## 4. Requerimientos Funcionales

### 4.1 Módulo de Empaque e Ingreso (RF-001 a RF-010)

**RF-001**: El sistema debe permitir importar cartones generados desde el sistema existente (SQLite) agrupándolos automáticamente en lotes de 50 cartones consecutivos por serial.

**RF-002**: El sistema debe crear cajas agrupando hasta 60 lotes (3,000 cartones). El operador define cuántos lotes por caja al empacar.

**RF-003**: Al crear una caja, el sistema debe generar automáticamente un código QR único que contenga: `codigo_caja`, `event_id`, `serial_desde`, `serial_hasta`, `total_lotes`.

**RF-004**: Al crear un lote, el sistema debe generar automáticamente un código QR único que contenga: `codigo_lote`, `caja_id`, `serial_desde`, `serial_hasta`, `total_cartones`.

**RF-005**: El cartón individual ya tiene QR del sistema existente con `card_code` y `validation_code`. El sistema de inventario debe poder resolver ese QR y vincular el cartón a su lote y caja.

**RF-006**: El empaque debe validar que los seriales sean consecutivos dentro de un lote y que los lotes sean consecutivos dentro de una caja.

**RF-007**: Al ingresar inventario inicial, todo queda asignado a la bodega principal de Bingos Nacionales.

**RF-008**: El sistema debe mostrar resumen de empaque: total cajas, lotes, cartones por evento.

**RF-009**: Se debe poder re-empacar un lote parcial (si le faltan cartones por devolución o daño) marcando los cartones faltantes como anulados.

**RF-010**: Debe existir un proceso de importación masiva para cargar eventos completos (1M+ cartones) con barra de progreso.

### 4.2 Módulo de Despacho (RF-011 a RF-020)

**RF-011**: El sistema debe permitir crear documentos de despacho seleccionando cajas completas y/o lotes individuales desde una bodega de origen hacia un destino (otra bodega u otro nivel de la cadena).

**RF-012**: El despacho puede hacerse escaneando QR de caja (agrega todos los lotes de esa caja) o QR de lote (agrega solo ese lote).

**RF-013**: Al confirmar un despacho, el inventario debe actualizarse atómicamente: la ubicación de cada caja/lote/cartón cambia de la bodega origen a estado "en_transito".

**RF-014**: Cada despacho genera un número de movimiento único (formato `MOV-YYYY-NNNNNN`).

**RF-015**: El documento de despacho debe mostrar la grilla detallada: por cada caja, listar los lotes que contiene; por cada lote, los rangos de seriales.

**RF-016**: El sistema debe generar un PDF del comprobante de despacho con la grilla, firmable digitalmente.

**RF-017**: Solo se pueden despachar cajas/lotes con estado "disponible" en la bodega de origen.

**RF-018**: Los despachos desde Bingos Nacionales pueden ser a cualquier revendedor. Los despachos desde un revendedor solo pueden ser a sus agencias. Los despachos desde agencias solo a sus billeteros.

**RF-019**: Se debe poder despachar libretas prepagas a billeteros (lotes marcados como `is_prepago = 1`).

**RF-020**: El sistema debe permitir despacho parcial de caja (enviar solo algunos lotes de una caja), actualizando el estado de la caja a "parcial".

### 4.3 Módulo de Recepción (RF-021 a RF-030)

**RF-021**: Al recibir un despacho, el receptor debe confirmar cada caja/lote escaneando el QR.

**RF-022**: El sistema debe comparar lo despachado vs lo recibido y marcar diferencias (faltantes, sobrantes, rechazos).

**RF-023**: Si todo coincide, el movimiento pasa a estado "recibido" y el inventario se asigna a la bodega destino.

**RF-024**: Si hay discrepancias, el receptor puede aceptar parcialmente, rechazar ítems específicos con motivo.

**RF-025**: Los ítems rechazados quedan en estado "rechazado" y pueden ser devueltos al origen.

**RF-026**: La recepción debe registrar quién recibió y la fecha/hora exacta.

**RF-027**: Se genera un comprobante de recepción con la grilla de lo recibido vs lo despachado.

**RF-028**: Un despacho no recibido en X días genera una alerta automática.

**RF-029**: El receptor puede agregar observaciones por cada caja/lote recibido.

**RF-030**: La recepción debe validar que los QR escaneados correspondan al movimiento seleccionado.

### 4.4 Módulo de Traslados (RF-031 a RF-040)

**RF-031**: Se deben permitir traslados horizontales entre bodegas de la misma organización. Ejemplo: Lotería traslada de Agencia Centro a Agencia Norte.

**RF-032**: Los traslados siguen el mismo flujo que despacho-recepción pero dentro de una misma organización.

**RF-033**: Solo revendedor_admin y superiores pueden autorizar traslados entre agencias.

**RF-034**: Los traslados pueden ser de cajas completas o de lotes individuales.

**RF-035**: El sistema debe mantener trazabilidad completa: un lote que pasó por 3 agencias debe tener historial de cada movimiento.

**RF-036**: Los traslados entre bodegas del suplidor los autoriza el rol suplidor.

**RF-037**: Debe existir una vista de "mercancía en tránsito" que muestre todo lo que está entre bodegas.

**RF-038**: Los traslados deben generar documentación igual que los despachos.

**RF-039**: Se permite traslado bidireccional (Agencia A → Agencia B y viceversa).

**RF-040**: El sistema debe calcular automáticamente los niveles de stock por bodega y alertar cuando esté bajo el mínimo configurado.

### 4.5 Módulo de Devoluciones (RF-041 a RF-050)

**RF-041**: Los billeteros pueden devolver lotes/cartones no vendidos a su agencia.

**RF-042**: Las agencias pueden devolver al revendedor. Los revendedores pueden devolver al suplidor.

**RF-043**: La devolución requiere motivo: no vendido, dañado, vencido, error de despacho, otros.

**RF-044**: Al confirmar la devolución, el inventario regresa a la bodega de origen.

**RF-045**: Si el cartón está dañado, se marca como "anulado" y no puede volver a despacharse.

**RF-046**: La devolución debe especificar cada unidad: por caja (devuelve todos los lotes), por lote, o por cartón individual.

**RF-047**: Se genera comprobante de devolución con la grilla detallada.

**RF-048**: El sistema debe calcular métricas de devolución: porcentaje devuelto por billetero, por agencia, por revendedor.

**RF-049**: Las libretas prepagas devueltas deben pasar por un proceso de verificación (que no se hayan vendido cartones individuales).

**RF-050**: La devolución puede ser rechazada por la bodega receptora con motivo.

### 4.6 Módulo de Venta al Público (RF-051 a RF-055)

**RF-051**: El billetero puede registrar la venta de cartones individuales escaneando el QR del cartón o ingresando el `card_code`.

**RF-052**: Al vender, se registra: comprador (nombre, teléfono opcionales), fecha/hora, billetero, ubicación.

**RF-053**: La venta actualiza el estado del cartón a "vendido" tanto en el sistema de inventario como en el sistema existente (`is_sold`).

**RF-054**: El billetero puede ver su inventario actual: cuántas libretas tiene, cuántos cartones vendidos vs disponibles.

**RF-055**: Se debe generar resumen de ventas diarias por billetero.

### 4.7 Módulo de Escaneo QR (RF-061 a RF-070)

**RF-061**: El sistema debe tener una interfaz de escaneo QR que funcione con la cámara del dispositivo (móvil o desktop con webcam).

**RF-062**: Al escanear un QR de **caja**, el sistema muestra: código, evento, rango de seriales, cantidad de lotes, ubicación actual (bodega), estado, historial de movimientos.

**RF-063**: Al escanear un QR de **lote**, el sistema muestra: código, caja a la que pertenece, rango de seriales, cantidad de cartones, ubicación actual, estado, si es prepago.

**RF-064**: Al escanear un QR de **cartón** (card_code), el sistema muestra: serial, lote, caja, grilla de números (5x5 B-I-N-G-O), estado (disponible/despachado/vendido), ubicación actual, comprador si vendido.

**RF-065**: El escaneo QR debe funcionar en modo batch: escanear múltiples códigos seguidos para agregarlos a un movimiento.

**RF-066**: El sistema debe distinguir automáticamente si el QR escaneado es de caja, lote o cartón.

**RF-067**: Si se escanea un código que no existe en el sistema, mostrar error claro.

**RF-068**: El escaneo debe funcionar offline almacenando en caché local y sincronizando cuando haya conexión (para billeteros en campo).

**RF-069**: Se debe soportar lectura de QR mediante dispositivos externos (pistolas de barras USB/Bluetooth).

**RF-070**: El escaneo debe emitir sonido/vibración de confirmación o error.

### 4.8 Módulo de Reportes (RF-071 a RF-085)

**RF-071**: **Inventario por bodega**: Stock actual de cajas, lotes y cartones por cada bodega, filtrable por evento y estado.

**RF-072**: **Inventario por billetero**: Cartones asignados vs vendidos vs devueltos por cada billetero.

**RF-073**: **Trazabilidad de caja/lote/cartón**: Historial completo de movimientos desde el empaque hasta la venta.

**RF-074**: **Movimientos por período**: Listado de todos los despachos, recepciones, traslados y devoluciones en un rango de fechas.

**RF-075**: **Cuadre de inventario**: Comparación entre inventario teórico (según movimientos) vs inventario físico (escaneo).

**RF-076**: **Rendimiento de billeteros**: Ranking de ventas, devoluciones, tiempo promedio de venta.

**RF-077**: **Estado de despachos**: Despachos pendientes de recepción, en tránsito, vencidos.

**RF-078**: **Merma y anulaciones**: Cartones anulados por daño, pérdida o vencimiento.

**RF-079**: **Resumen ejecutivo**: Dashboard con KPIs: cartones generados, despachados, en tránsito, vendidos, devueltos, anulados.

**RF-080**: **Reporte por evento**: Ciclo de vida completo de todos los cartones de un evento específico.

**RF-081**: Todos los reportes exportables a **PDF, Excel y CSV**.

**RF-082**: Los reportes respetan la regla de visibilidad: cada usuario solo ve datos de su organización.

**RF-083**: **Grilla de transacción**: Para cada movimiento, un reporte detallado que muestra línea por línea cada caja con sus lotes, o cada lote con sus seriales.

**RF-084**: **Constancia de transacción**: Documento formal imprimible con: número de movimiento, origen, destino, fecha, detalle por caja/lote/cartón, firmas de entregó/recibió.

**RF-085**: **Listado por movimiento**: Lista completa y descargable de todos los ítems (cajas, lotes, cartones) de un movimiento específico.

---

## 5. Requerimientos No Funcionales

### 5.1 Rendimiento

- **RNF-001**: El escaneo de QR y resolución debe responder en menos de 500ms.
- **RNF-002**: La importación de 1M+ cartones debe completarse en menos de 5 minutos con barra de progreso.
- **RNF-003**: Los reportes deben generarse en menos de 10 segundos para 100K registros.
- **RNF-004**: Soporte para 100+ usuarios concurrentes.

### 5.2 Seguridad

- **RNF-005**: Autenticación JWT con refresh tokens.
- **RNF-006**: Todas las contraseñas hasheadas con bcrypt (cost 12+).
- **RNF-007**: RBAC (Role-Based Access Control) con middleware de autorización en cada endpoint.
- **RNF-008**: Multi-tenancy: queries filtradas por `organizacion_id` del usuario autenticado a nivel de Eloquent global scopes.
- **RNF-009**: Toda operación de escritura registrada en tabla de auditoría con IP y user-agent.
- **RNF-010**: Rate limiting en API (60 req/min por usuario).
- **RNF-011**: CSRF protection en formularios web.
- **RNF-012**: SQL injection prevention vía Eloquent ORM / prepared statements.
- **RNF-013**: XSS prevention con sanitización de inputs y output encoding.

### 5.3 Disponibilidad y Resiliencia

- **RNF-014**: El módulo de escaneo debe funcionar offline con sincronización posterior.
- **RNF-015**: Las transacciones de inventario deben ser atómicas (todo o nada).
- **RNF-016**: Backup automático de base de datos diario.

### 5.4 Usabilidad

- **RNF-017**: Interfaz responsiva (mobile-first para billeteros).
- **RNF-018**: Soporte de escaneo QR por cámara y pistola de barras.
- **RNF-019**: Retroalimentación visual y sonora en operaciones de escaneo.
- **RNF-020**: Interfaz en español.

---

## 6. API REST - Endpoints Principales

### 6.1 Autenticación

```
POST   /api/auth/login
POST   /api/auth/refresh
POST   /api/auth/logout
GET    /api/auth/me
```

### 6.2 Organizaciones

```
GET    /api/organizaciones                    -- Listar (filtradas por tenancy)
POST   /api/organizaciones                    -- Crear (super_admin, suplidor)
GET    /api/organizaciones/{id}               -- Detalle
PUT    /api/organizaciones/{id}               -- Editar
GET    /api/organizaciones/{id}/jerarquia     -- Árbol jerárquico completo
```

### 6.3 Bodegas

```
GET    /api/bodegas                           -- Listar bodegas de mi organización
POST   /api/bodegas                           -- Crear
GET    /api/bodegas/{id}                      -- Detalle con stock
PUT    /api/bodegas/{id}                      -- Editar
GET    /api/bodegas/{id}/inventario           -- Inventario detallado
```

### 6.4 Billeteros

```
GET    /api/billeteros                        -- Listar de mi agencia/organización
POST   /api/billeteros                        -- Crear
GET    /api/billeteros/{id}                   -- Detalle con inventario asignado
PUT    /api/billeteros/{id}                   -- Editar
GET    /api/billeteros/{id}/inventario        -- Su inventario actual
GET    /api/billeteros/{id}/ventas            -- Resumen de ventas
```

### 6.5 Inventario - Empaque

```
POST   /api/inventario/importar               -- Importar cartones desde sistema existente
GET    /api/inventario/importar/progreso/{id} -- Progreso de importación
POST   /api/inventario/empacar/lotes          -- Crear lotes (agrupar cartones de 50)
POST   /api/inventario/empacar/cajas          -- Crear cajas (agrupar lotes)
GET    /api/inventario/resumen/{eventId}       -- Resumen de empaque por evento
```

### 6.6 Movimientos

```
GET    /api/movimientos                       -- Listar movimientos (filtros: tipo, estado, fecha, org)
POST   /api/movimientos                       -- Crear movimiento (borrador)
GET    /api/movimientos/{id}                  -- Detalle con grilla
PUT    /api/movimientos/{id}                  -- Editar borrador
DELETE /api/movimientos/{id}                  -- Cancelar borrador

POST   /api/movimientos/{id}/agregar-items    -- Agregar cajas/lotes al movimiento
DELETE /api/movimientos/{id}/items/{itemId}    -- Quitar ítem

POST   /api/movimientos/{id}/despachar        -- Confirmar despacho (cambia estado de inventario)
POST   /api/movimientos/{id}/recibir          -- Confirmar recepción
POST   /api/movimientos/{id}/rechazar         -- Rechazar (parcial o total)

GET    /api/movimientos/{id}/grilla           -- Grilla detallada de la transacción
GET    /api/movimientos/{id}/constancia       -- PDF de constancia
GET    /api/movimientos/{id}/listado          -- Listado completo descargable
```

### 6.7 Traslados

```
POST   /api/traslados                         -- Crear traslado entre bodegas
GET    /api/traslados/en-transito             -- Mercancía en tránsito
```

### 6.8 Devoluciones

```
POST   /api/devoluciones                      -- Crear devolución
POST   /api/devoluciones/{id}/confirmar       -- Confirmar devolución
POST   /api/devoluciones/{id}/rechazar        -- Rechazar devolución
```

### 6.9 Ventas

```
POST   /api/ventas                            -- Registrar venta de cartón
GET    /api/ventas/resumen-diario             -- Resumen del día
GET    /api/ventas/mi-inventario              -- Inventario del billetero logueado
```

### 6.10 Escaneo QR

```
POST   /api/scan                              -- Escanear código (auto-detecta caja/lote/cartón)
POST   /api/scan/batch                        -- Escaneo batch (múltiples códigos)
GET    /api/scan/resolver/{codigo}            -- Resolver un código QR
```

### 6.11 Reportes

```
GET    /api/reportes/inventario-bodega         -- Por bodega
GET    /api/reportes/inventario-billetero      -- Por billetero
GET    /api/reportes/trazabilidad/{tipo}/{id}  -- Historial de caja/lote/cartón
GET    /api/reportes/movimientos               -- Por período
GET    /api/reportes/cuadre                    -- Cuadre de inventario
GET    /api/reportes/rendimiento-billeteros    -- Ranking
GET    /api/reportes/dashboard                 -- KPIs ejecutivos
GET    /api/reportes/evento/{eventId}          -- Por evento

GET    /api/reportes/exportar/{tipo}           -- Exportar (formato: pdf, xlsx, csv)
```

---

## 7. Flujos de Trabajo Principales

### 7.1 Flujo de Empaque

```
1. Importar cartones desde sistema existente (evento específico)
2. Sistema agrupa automáticamente en lotes de 50 (por serial consecutivo)
3. Operador selecciona lotes para formar cajas (hasta 60 lotes por caja)
4. Sistema genera QR para cada caja y lote
5. Todo el inventario queda en bodega principal de Bingos Nacionales
```

### 7.2 Flujo de Despacho

```
1. Operador crea documento de despacho (selecciona destino)
2. Escanea QR de cajas/lotes a despachar (o selecciona manualmente)
3. Sistema muestra grilla con detalle de lo seleccionado
4. Operador confirma → estado "pendiente"
5. Supervisor autoriza → estado "en_transito"
6. Inventario se actualiza: ubicación → "transito"
7. Se genera comprobante PDF con número de movimiento
```

### 7.3 Flujo de Recepción

```
1. Receptor ve despachos pendientes para su bodega
2. Selecciona un despacho y comienza recepción
3. Escanea cada caja/lote recibido
4. Sistema compara despachado vs recibido (marca coincidencias y faltantes)
5. Receptor confirma o rechaza ítems individualmente
6. Al finalizar → estado "recibido" (o "parcial" si hay rechazos)
7. Inventario se actualiza: ubicación → bodega destino
8. Se genera comprobante de recepción
```

### 7.4 Flujo de Traslado

```
1. Admin de revendedor selecciona bodega origen y destino (ambas de su organización)
2. Selecciona cajas/lotes a trasladar
3. Sistema valida que ambas bodegas pertenecen a la misma organización
4. Sigue el flujo despacho → recepción pero marcado como tipo "traslado"
```

### 7.5 Flujo de Devolución

```
1. Billetero/agencia inicia devolución
2. Escanea lotes/cartones a devolver
3. Selecciona motivo para cada ítem
4. Envía solicitud de devolución
5. Bodega receptora revisa y acepta/rechaza
6. Al aceptar → inventario regresa a bodega origen
7. Cartones dañados → estado "anulado"
```

---

## 8. Reglas de Negocio

**RN-001**: Un cartón no puede estar en dos ubicaciones al mismo tiempo.

**RN-002**: Un cartón vendido no puede ser despachado ni trasladado.

**RN-003**: Un cartón anulado no puede participar en ningún movimiento.

**RN-004**: Los seriales dentro de un lote deben ser consecutivos.

**RN-005**: Los movimientos son inmutables una vez confirmados; solo se pueden crear contra-movimientos (devoluciones).

**RN-006**: Un billetero solo puede vender cartones que estén asignados a él.

**RN-007**: Cada nivel de la cadena solo puede despachar al nivel inmediatamente inferior:
- Suplidor → Revendedor
- Revendedor → Agencia
- Agencia → Billetero

**RN-008**: Las devoluciones solo pueden ir al nivel inmediatamente superior (camino inverso).

**RN-009**: Los traslados solo pueden ser entre bodegas del mismo nivel/organización.

**RN-010**: Todo movimiento genera un registro en la tabla de auditoría con el usuario, IP y timestamp.

**RN-011**: La grilla de transacción debe reflejar el detalle hasta el nivel más fino: si se despacha una caja, la grilla muestra la caja con sus 60 lotes; si se despacha un lote, la grilla muestra el lote con sus 50 cartones.

**RN-012**: El stock se calcula en tiempo real basado en la ubicación actual de cada unidad (no se mantienen contadores separados que puedan desincronizarse).

---

## 9. Estructura del Proyecto PHP (Laravel 11)

```
bingo-inventario/
├── app/
│   ├── Http/
│   │   ├── Controllers/Api/
│   │   │   ├── AuthController.php
│   │   │   ├── OrganizacionController.php
│   │   │   ├── BodegaController.php
│   │   │   ├── BilleteroController.php
│   │   │   ├── InventarioController.php
│   │   │   ├── MovimientoController.php
│   │   │   ├── TrasladoController.php
│   │   │   ├── DevolucionController.php
│   │   │   ├── VentaController.php
│   │   │   ├── ScanController.php
│   │   │   └── ReporteController.php
│   │   ├── Middleware/
│   │   │   ├── TenancyScope.php           -- Filtra queries por organización
│   │   │   └── CheckPermission.php
│   │   └── Requests/                       -- Form Requests (validación)
│   ├── Models/
│   │   ├── Usuario.php
│   │   ├── Organizacion.php
│   │   ├── Bodega.php
│   │   ├── Billetero.php
│   │   ├── Caja.php
│   │   ├── Lote.php
│   │   ├── InventarioCarton.php
│   │   ├── Movimiento.php
│   │   ├── MovimientoDetalle.php
│   │   └── Auditoria.php
│   ├── Services/
│   │   ├── ImportacionService.php          -- Importar desde sistema existente
│   │   ├── EmpaqueService.php              -- Crear lotes y cajas
│   │   ├── MovimientoService.php           -- Lógica de despacho/recepción
│   │   ├── TrasladoService.php
│   │   ├── DevolucionService.php
│   │   ├── VentaService.php
│   │   ├── ScanService.php                 -- Resolver QR
│   │   ├── QrGeneratorService.php          -- Generar QR para cajas/lotes
│   │   ├── ReporteService.php
│   │   ├── ExportService.php               -- PDF/Excel/CSV
│   │   └── AuditoriaService.php
│   ├── Policies/                           -- Autorización granular
│   ├── Scopes/
│   │   └── TenancyScope.php               -- Global scope por organización
│   ├── Observers/
│   │   └── MovimientoObserver.php          -- Auditoría automática
│   └── Enums/
│       ├── TipoMovimiento.php
│       ├── EstadoMovimiento.php
│       ├── EstadoCaja.php
│       ├── EstadoLote.php
│       ├── EstadoCarton.php
│       ├── RolUsuario.php
│       └── TipoOrganizacion.php
├── database/
│   ├── migrations/
│   └── seeders/
├── routes/
│   └── api.php
├── config/
│   └── inventario.php                      -- Configuraciones del sistema
└── tests/
    ├── Feature/
    └── Unit/
```

---

## 10. Formato de Datos QR

### 10.1 QR de Caja

```json
{
    "t": "CAJA",
    "c": "CJ-2026-000001",
    "e": 15,
    "sd": "00001-01",
    "sh": "00060-50",
    "l": 60
}
```

### 10.2 QR de Lote

```json
{
    "t": "LOTE",
    "c": "LT-2026-000001",
    "cj": "CJ-2026-000001",
    "sd": "00001-01",
    "sh": "00001-50",
    "n": 50
}
```

### 10.3 QR de Cartón (existente)

URL con parámetros: `https://bingo.com/validar?code={card_code}&val={validation_code}`

### 10.4 Resolución Automática

El sistema detecta el tipo de QR analizando:

1. Si es URL con parámetros `code` y `val` → Cartón
2. Si es JSON con `"t": "CAJA"` → Caja
3. Si es JSON con `"t": "LOTE"` → Lote
4. Si es texto plano de 5 caracteres → buscar en `card_code`

---

## 11. Consideraciones de Implementación

### 11.1 Multi-Tenancy

Usar Eloquent Global Scopes para filtrar automáticamente todas las consultas por la organización del usuario autenticado. El middleware `TenancyScope` extrae el `organizacion_id` del JWT y lo aplica como scope global a todos los modelos que implementen el trait `BelongsToOrganizacion`.

### 11.2 Transacciones Atómicas

Todo movimiento de inventario debe ejecutarse dentro de `DB::transaction()`. Si falla la actualización de cualquier caja/lote/cartón, se revierte todo el movimiento.

### 11.3 Colas para Operaciones Pesadas

Usar Laravel Queues para: importación masiva, generación de QR en batch, exportación de reportes grandes, generación de PDFs.

### 11.4 Caché

Redis para: sesiones, rate limiting, contadores de stock en tiempo real, caché de QR resueltos.

### 11.5 WebSockets

Laravel Echo + Pusher/Socket.io para: notificaciones de despachos recibidos, alertas de stock bajo, progreso de importación/exportación en tiempo real.

---

## 12. Priorización de Desarrollo (Sprints Sugeridos)

**Sprint 1 (2 semanas)**: Auth, Organizaciones, Bodegas, Billeteros, Multi-tenancy base.

**Sprint 2 (2 semanas)**: Importación de cartones, Empaque (lotes y cajas), Generación QR.

**Sprint 3 (2 semanas)**: Módulo de Movimientos (despacho y recepción), Grilla de transacciones.

**Sprint 4 (2 semanas)**: Traslados, Devoluciones, Constancias PDF.

**Sprint 5 (1 semana)**: Ventas al público, Módulo billetero.

**Sprint 6 (2 semanas)**: Escaneo QR (cámara + pistola), Modo batch.

**Sprint 7 (2 semanas)**: Reportes completos, Exportaciones, Dashboard.

**Sprint 8 (1 semana)**: Modo offline, Sincronización, Optimización de rendimiento.

---

## 13. Stack Tecnológico

| Componente | Tecnología |
|---|---|
| Backend | PHP 8.2+ / Laravel 11 |
| Base de Datos | MySQL 8.0+ (InnoDB, transacciones ACID) |
| Autenticación | Laravel Sanctum o JWT (tymon/jwt-auth) |
| Colas | Laravel Queues + Redis |
| Caché | Redis |
| QR Generation | bacon/bacon-qr-code + imagick |
| PDF Export | barryvdh/laravel-dompdf o tecnickcom/tcpdf |
| Excel Export | maatwebsite/excel (PhpSpreadsheet) |
| WebSockets | Laravel Echo + Pusher |
| Frontend (sugerido) | Vue.js 3 + Inertia.js o Livewire |
| Scanner QR Frontend | html5-qrcode.js o instascan.js |
| Testing | PHPUnit + Pest |
