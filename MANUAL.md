# Manual de Usuario — Bingo Pro

Plataforma de administracion de juegos de Bingo Americano (75 numeros).

---

## Tabla de Contenidos

1. [Acceso al Sistema](#1-acceso-al-sistema)
2. [Dashboard](#2-dashboard)
3. [Gestion de Eventos](#3-gestion-de-eventos)
4. [Cartones](#4-cartones)
5. [Partidas / Juegos](#5-partidas--juegos)
6. [Inventario Jerarquico](#6-inventario-jerarquico)
7. [Reportes y Exportacion](#7-reportes-y-exportacion)
8. [Gestion de Usuarios](#8-gestion-de-usuarios)
9. [Roles y Permisos](#9-roles-y-permisos)

---

## 1. Acceso al Sistema

### Inicio de Sesion

Ingrese a la plataforma con su **usuario** y **contrasena**. El token de sesion tiene una duracion de **24 horas**.

### Cambio de Contrasena

Desde su perfil puede cambiar su contrasena en cualquier momento.

---

## 2. Dashboard

La pantalla principal muestra un resumen general:

| Indicador | Descripcion |
|-----------|-------------|
| Total Eventos | Cantidad de eventos creados, con indicador de activos |
| Total Cartones | Cartones generados en toda la plataforma y cuantos se han vendido |
| Juegos Realizados | Partidas completadas |

### Acciones Rapidas

- Crear evento
- Ver cartones
- Iniciar juego
- Validar carton

### Graficas

Visualizacion de datos de los ultimos 7, 14 o 30 dias:

- Cartones generados por dia
- Juegos creados por dia
- Distribucion por tipo de juego

### Actividad Reciente

- 5 eventos mas recientes con conteo de cartones
- 5 juegos mas recientes con estado y tipo

---

## 3. Gestion de Eventos

Un **evento** es el contenedor principal que agrupa cartones y partidas.

### Crear Evento

1. Ir a **Eventos** > **Crear Evento**
2. Completar:
   - **Nombre** del evento
   - **Descripcion** (opcional)
   - **Centro FREE**: activar si el centro del carton sera libre (comportamiento estandar del Bingo)
3. El evento se crea en estado **Borrador**

### Estados del Evento

| Estado | Descripcion |
|--------|-------------|
| `Borrador` | Recien creado, se puede configurar y generar cartones |
| `Activo` | En curso, se pueden crear partidas y vender cartones |
| `Completado` | Finalizado, solo lectura |
| `Cancelado` | Cancelado, solo lectura |

### Estadisticas del Evento

En la pagina de detalle del evento se visualiza:

- Total de cartones generados
- Cartones vendidos
- Juegos creados y su estado
- Resumen de actividad

---

## 4. Cartones

### Estructura del Carton

Cada carton sigue el formato **Bingo Americano** (5x5):

| B (1-15) | I (16-30) | N (31-45) | G (46-60) | O (61-75) |
|----------|-----------|-----------|-----------|-----------|
| 5 nums | 5 nums | 4 nums + FREE | 5 nums | 5 nums |

- El centro puede ser **FREE** o contener un numero (configurado por evento)
- Cada carton tiene un **codigo unico** de 5 caracteres alfanumericos
- Cada carton tiene un **codigo de validacion** de 5 caracteres
- **Serial** con formato `XXXXX-XX` (serie-secuencia, 50 cartones por serie)

### Generar Cartones

1. Ir a **Cartones** > seleccionar evento > **Generar**
2. Indicar la **cantidad** (de 1 a 1,000,000)
3. El sistema genera los cartones con:
   - Numeros aleatorios unicos por columna
   - Verificacion de duplicados por hash
   - Barra de progreso en tiempo real
4. Solo usuarios con rol **admin** pueden generar

### Buscar Cartones

Se puede buscar cartones por:

- Codigo del carton (`card_code`)
- Codigo de validacion (`validation_code`)
- Numero de serial
- Numero de carton

Filtros disponibles: por evento, estado de venta, con paginacion.

### Validar Carton

1. Ir a **Cartones** > **Validar**
2. Ingresar el **codigo del carton** y el **codigo de validacion**
3. El sistema muestra la cuadricula completa si los codigos coinciden
4. Disponible para **todos los roles**

### Activar / Vender Carton (Punto de Venta)

1. Ir a **Cartones** > **Activar**
2. Buscar el carton por codigo o serial (compatible con lector QR)
3. Registrar datos del comprador (nombre, telefono)
4. Confirmar la venta
5. Requiere permiso `cards:sell`

---

## 5. Partidas / Juegos

### Tipos de Juego

| Tipo | Descripcion | Celdas para ganar |
|------|-------------|-------------------|
| `Linea Horizontal` | Cualquier fila completa | 5 celdas |
| `Linea Vertical` | Cualquier columna completa | 5 celdas |
| `Diagonal` | Cualquiera de las dos diagonales | 5 celdas |
| `Blackout` | Todas las celdas del carton | 24 celdas (sin FREE) |
| `Cuatro Esquinas` | Las 4 esquinas del carton | 4 celdas |
| `Patron X` | Ambas diagonales formando una X | 9 celdas |
| `Personalizado` | Patron disenado manualmente en grilla 5x5 | Variable |

### Crear Partida

1. Ir al detalle del evento > **Crear Juego**
2. Configurar:
   - **Nombre** de la partida
   - **Tipo de juego**
   - **Modo**: Practica (todos los cartones) o Real (solo vendidos)
   - **Descripcion del premio** (opcional)
   - Si es tipo personalizado: disenar el patron en la grilla interactiva

### Ciclo de Vida del Juego

```
Pendiente → En Progreso → (Pausado ↔ Reanudado) → Completado
                                                  → Cancelado
```

| Accion | Descripcion |
|--------|-------------|
| **Iniciar** | Comienza la partida, habilita llamado de balotas |
| **Pausar** | Detiene temporalmente (se puede reanudar) |
| **Reanudar** | Continua desde donde se pauso |
| **Reiniciar** | Limpia todas las balotas llamadas y vuelve a empezar |
| **Finalizar** | Termina la partida y genera el reporte automatico |
| **Cancelar** | Termina sin generar reporte |

### Pantalla de Juego

La interfaz de juego en tiempo real incluye:

- **Panel de balotas**: grilla visual B-I-N-G-O con las balotas llamadas marcadas
- **Boton de llamado aleatorio**: selecciona una balota al azar de las disponibles
- **Llamado manual**: permite seleccionar una balota especifica
- **Contador**: balotas llamadas vs disponibles
- **Deteccion de ganadores**: automatica despues de cada balota
- **Sonido**: toggle de efectos de audio por balota
- **Tiempo real**: los cambios se transmiten via Socket.IO a todos los conectados

### Ganadores

Cuando se detecta un ganador:

- Se muestra el numero y codigo del carton ganador
- Nombre del comprador (si fue vendido)
- Cantidad de balotas necesarias para ganar
- El patron ganador aplicado

---

## 6. Inventario Jerarquico

Sistema de distribucion de cartones en estructura de arbol con hasta **5 niveles** de profundidad.

### Concepto

El inventario permite rastrear la distribucion fisica de cartones desde un punto central hasta los vendedores finales:

```
Loteria Principal (Nivel 1 - Raiz)
├── Agencia Norte (Nivel 2)
│   ├── Vendedor Juan (Nivel 3)
│   └── Vendedor Maria (Nivel 3)
├── Agencia Sur (Nivel 2)
│   └── Vendedor Pedro (Nivel 3)
└── Agencia Centro (Nivel 2)

Supermercado XYZ (Nivel 1 - Raiz)
├── Sucursal Centro (Nivel 2)
│   └── Cajera Ana (Nivel 3)
└── Sucursal Este (Nivel 2)
```

Se pueden crear **multiples nodos raiz** por evento (ej: una loteria y un supermercado como canales de distribucion independientes).

### Configurar Niveles

1. Ir a **Inventario** > seleccionar evento
2. Click en **Configurar Niveles**
3. Definir los nombres de cada nivel (ej: Loteria → Agencia → Vendedor)
4. Puede tener de 1 a 5 niveles
5. No se pueden reducir niveles si existen nodos activos en niveles superiores

### Crear Nodos

- **Nodo Raiz**: click en "Nodo Raiz" para crear un punto de distribucion principal
- **Nodo Hijo**: click en el boton "+" de cualquier nodo para agregar un hijo
- Cada nodo puede tener:
  - Nombre (obligatorio)
  - Codigo identificador (opcional, ej: AG-01)
  - Nombre de contacto
  - Telefono de contacto

### Operaciones con Cartones

| Operacion | Icono | Descripcion |
|-----------|-------|-------------|
| **Carga Inicial** | ↓ | Carga cartones sin asignar al nodo raiz |
| **Asignar a Hijo** | ↓ (azul) | Distribuye cartones del nodo actual a un hijo directo |
| **Devolver al Padre** | ↑ (naranja) | Retorna cartones al nodo padre |
| **Marcar Venta** | $ (verde) | Registra cartones como vendidos |

### Seleccion de Cartones

Para cada operacion se pueden seleccionar cartones por:

- **Rango de series**: desde serie X hasta serie Y (cada serie = 50 cartones)
- **Rango de numeros**: desde carton # hasta carton #

### Contadores por Nodo

Cada nodo muestra en tiempo real:

| Contador | Significado |
|----------|-------------|
| **Asignados** | Total de cartones que han llegado al nodo |
| **Distribuidos** | Cartones enviados a nodos hijos |
| **Vendidos** | Cartones marcados como vendidos |
| **En Mano** | Cartones disponibles (asignados - distribuidos - vendidos) |

### Historial de Movimientos

Accesible desde el enlace "Ver historial de movimientos" al final de la pagina.

Filtros disponibles:

- Por nodo
- Por tipo de movimiento
- Por rango de fechas
- Paginado

Cada movimiento registra: carton, tipo de operacion, nodo origen, nodo destino, usuario que ejecuto, lote (batch) y notas.

---

## 7. Reportes y Exportacion

### Reporte de Partida

Al finalizar una partida se genera automaticamente un reporte con:

- Informacion del juego (evento, tipo, modo)
- Historial completo de balotas llamadas (orden y hora)
- Ganadores con detalle de carton y patron
- Duracion total de la partida

Se puede descargar en **PDF**.

### Consultas de Reportes

- Ganadores por juego
- Ganadores por evento
- Historial de balotas por juego
- Victorias de un carton especifico
- Ultimos ganadores del sistema

### Exportacion de Cartones

| Formato | Descripcion |
|---------|-------------|
| **PDF** | Cartones impresos con grilla visual, codigo y validacion (4 por pagina) |
| **PNG** | Imagenes individuales de cada carton |
| **CSV** | Datos en formato tabla para impresion masiva |

---

## 8. Gestion de Usuarios

Disponible solo para **administradores**.

### Crear Usuario

1. Ir a **Usuarios** > **Crear Usuario**
2. Completar: nombre de usuario, email, nombre completo, contrasena
3. Asignar un **rol** (admin, moderador, vendedor, visor)

### Administrar Usuarios

- Editar datos y rol
- Activar/desactivar cuentas
- Eliminar usuarios (no se puede eliminar a si mismo)
- Restablecer contrasena

---

## 9. Roles y Permisos

### Matriz de Permisos

| Funcionalidad | Admin | Moderador | Vendedor | Visor |
|---------------|:-----:|:---------:|:--------:|:-----:|
| Dashboard | ✓ | ✓ | ✓ | ✓ |
| Ver eventos | ✓ | ✓ | ✓ | ✓ |
| Crear/editar eventos | ✓ | — | — | — |
| Ver cartones | ✓ | ✓ | ✓ | ✓ |
| Generar cartones | ✓ | — | — | — |
| Vender cartones | ✓ | ✓ | ✓ | — |
| Exportar cartones | ✓ | — | — | — |
| Ver juegos | ✓ | ✓ | ✓ | ✓ |
| Crear juegos | ✓ | ✓ | — | — |
| Jugar partidas | ✓ | ✓ | — | — |
| Finalizar partidas | ✓ | ✓ | — | — |
| Ver reportes | ✓ | ✓ | — | ✓ |
| Exportar reportes | ✓ | — | — | — |
| Inventario: ver | ✓ | ✓ | ✓ | ✓ |
| Inventario: gestionar | ✓ | — | — | — |
| Inventario: asignar | ✓ | ✓ | — | — |
| Inventario: vender | ✓ | ✓ | ✓ | — |
| Gestionar usuarios | ✓ | — | — | — |

---

## Tiempo Real (Socket.IO)

La plataforma utiliza comunicacion en tiempo real para las partidas:

- Al entrar a una partida, se conecta automaticamente a la sala del juego
- Las balotas llamadas se transmiten al instante a todos los conectados
- La deteccion de ganadores se notifica en tiempo real
- Los cambios de estado del juego (pausar, reanudar, etc.) se sincronizan

Esto permite que multiples operadores vean la misma partida en simultaneo.

---

## Glosario

| Termino | Definicion |
|---------|------------|
| **Evento** | Contenedor principal que agrupa cartones y partidas de bingo |
| **Carton** | Tabla de 5x5 con numeros aleatorios para jugar bingo |
| **Partida / Juego** | Una sesion de bingo con un patron especifico a completar |
| **Balota** | Numero del 1 al 75 que se llama durante la partida |
| **Serie** | Grupo de 50 cartones consecutivos |
| **Serial** | Identificador formato XXXXX-XX (serie-secuencia) |
| **Card Code** | Codigo unico de 5 caracteres para identificar un carton |
| **Validation Code** | Codigo de 5 caracteres para verificar autenticidad |
| **FREE** | Celda central del carton que se considera marcada automaticamente |
| **Blackout** | Tipo de juego donde se deben completar todas las celdas |
| **Nodo** | Punto en el arbol de distribucion de inventario |
| **Batch** | Lote de operacion que agrupa movimientos de cartones |
