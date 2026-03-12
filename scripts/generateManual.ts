import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';

const OUTPUT_PATH = path.join(__dirname, '..', 'MANUAL_BINGO_PRO.pdf');

// =====================================================
// COLORS & STYLES
// =====================================================
const COLORS = {
  primary: '#1e3a5f',
  secondary: '#2563eb',
  accent: '#059669',
  text: '#1f2937',
  muted: '#6b7280',
  light: '#f3f4f6',
  white: '#ffffff',
  tableBorder: '#d1d5db',
  tableHeader: '#1e3a5f',
  tableStripe: '#f9fafb',
  success: '#059669',
  warning: '#d97706',
  danger: '#dc2626',
};

const MARGIN = 55;
const PAGE_WIDTH = 612; // Letter
const PAGE_HEIGHT = 792;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

let currentPage = 1;
const tocEntries: { title: string; page: number; level: number }[] = [];

function addPageNumber(doc: PDFKit.PDFDocument) {
  doc.save();
  doc.fontSize(8).fillColor(COLORS.muted).font('Helvetica');
  doc.text(`Bingo Pro — Manual de Usuario`, MARGIN, PAGE_HEIGHT - 35, { width: CONTENT_WIDTH / 2, align: 'left' });
  doc.text(`Pagina ${currentPage}`, MARGIN + CONTENT_WIDTH / 2, PAGE_HEIGHT - 35, { width: CONTENT_WIDTH / 2, align: 'right' });
  // Line above footer
  doc.moveTo(MARGIN, PAGE_HEIGHT - 45).lineTo(PAGE_WIDTH - MARGIN, PAGE_HEIGHT - 45).strokeColor(COLORS.tableBorder).lineWidth(0.5).stroke();
  doc.restore();
}

function ensureSpace(doc: PDFKit.PDFDocument, needed: number) {
  if (doc.y + needed > PAGE_HEIGHT - 60) {
    doc.addPage();
    currentPage++;
    addPageNumber(doc);
  }
}

function drawSectionHeader(doc: PDFKit.PDFDocument, number: string, title: string, level: number = 1) {
  if (level === 1) {
    doc.addPage();
    currentPage++;
    addPageNumber(doc);

    // Section banner
    doc.save();
    doc.rect(0, 0, PAGE_WIDTH, 100).fill(COLORS.primary);
    doc.fontSize(14).fillColor('#ffffff80').font('Helvetica');
    doc.text(`SECCION ${number}`, MARGIN, 30);
    doc.fontSize(26).fillColor(COLORS.white).font('Helvetica-Bold');
    doc.text(title, MARGIN, 52);
    doc.restore();

    doc.y = 125;
    tocEntries.push({ title: `${number}. ${title}`, page: currentPage, level: 1 });
  } else {
    ensureSpace(doc, 45);
    doc.moveDown(0.8);

    // Accent line
    doc.save();
    doc.moveTo(MARGIN, doc.y).lineTo(MARGIN + 3, doc.y).lineTo(MARGIN + 3, doc.y + 22).lineTo(MARGIN, doc.y + 22).fill(COLORS.secondary);
    doc.restore();

    doc.fontSize(level === 2 ? 15 : 13)
      .fillColor(COLORS.primary)
      .font('Helvetica-Bold')
      .text(title, MARGIN + 10, doc.y + 3);
    doc.moveDown(0.5);
    tocEntries.push({ title: `  ${number} ${title}`, page: currentPage, level });
  }
}

function drawParagraph(doc: PDFKit.PDFDocument, text: string) {
  ensureSpace(doc, 30);
  doc.fontSize(10).fillColor(COLORS.text).font('Helvetica').text(text, MARGIN, doc.y, {
    width: CONTENT_WIDTH,
    lineGap: 4,
    align: 'justify',
  });
  doc.moveDown(0.5);
}

function drawBullet(doc: PDFKit.PDFDocument, text: string, indent: number = 0) {
  ensureSpace(doc, 20);
  const x = MARGIN + 15 + indent;
  doc.fontSize(10).fillColor(COLORS.secondary).font('Helvetica').text('•', MARGIN + 5 + indent, doc.y);
  doc.moveUp();
  doc.fillColor(COLORS.text).text(text, x + 5, doc.y, { width: CONTENT_WIDTH - 20 - indent, lineGap: 3 });
  doc.moveDown(0.2);
}

function drawTable(doc: PDFKit.PDFDocument, headers: string[], rows: string[][], colWidths?: number[]) {
  const numCols = headers.length;
  const widths = colWidths || headers.map(() => CONTENT_WIDTH / numCols);
  const rowHeight = 24;
  const headerHeight = 28;
  const totalHeight = headerHeight + rows.length * rowHeight + 10;

  ensureSpace(doc, Math.min(totalHeight, 200));
  doc.moveDown(0.3);

  let x = MARGIN;
  let y = doc.y;

  // Header
  doc.save();
  doc.rect(x, y, CONTENT_WIDTH, headerHeight).fill(COLORS.tableHeader);
  doc.fontSize(9).fillColor(COLORS.white).font('Helvetica-Bold');
  for (let i = 0; i < numCols; i++) {
    doc.text(headers[i], x + 6, y + 8, { width: widths[i] - 12 });
    x += widths[i];
  }
  doc.restore();
  y += headerHeight;

  // Rows
  for (let r = 0; r < rows.length; r++) {
    if (y + rowHeight > PAGE_HEIGHT - 60) {
      doc.addPage();
      currentPage++;
      addPageNumber(doc);
      y = MARGIN;
      // Re-draw header
      x = MARGIN;
      doc.save();
      doc.rect(x, y, CONTENT_WIDTH, headerHeight).fill(COLORS.tableHeader);
      doc.fontSize(9).fillColor(COLORS.white).font('Helvetica-Bold');
      for (let i = 0; i < numCols; i++) {
        doc.text(headers[i], x + 6, y + 8, { width: widths[i] - 12 });
        x += widths[i];
      }
      doc.restore();
      y += headerHeight;
    }

    x = MARGIN;
    const bgColor = r % 2 === 0 ? COLORS.white : COLORS.tableStripe;

    doc.save();
    doc.rect(x, y, CONTENT_WIDTH, rowHeight).fill(bgColor);
    // Border
    doc.rect(x, y, CONTENT_WIDTH, rowHeight).strokeColor(COLORS.tableBorder).lineWidth(0.3).stroke();
    doc.restore();

    doc.fontSize(9).fillColor(COLORS.text).font('Helvetica');
    for (let i = 0; i < numCols; i++) {
      doc.text(rows[r][i] || '', x + 6, y + 7, { width: widths[i] - 12 });
      x += widths[i];
    }
    y += rowHeight;
  }

  doc.y = y + 8;
}

function drawInfoBox(doc: PDFKit.PDFDocument, title: string, text: string, color: string = COLORS.secondary) {
  ensureSpace(doc, 60);
  doc.moveDown(0.3);
  const boxY = doc.y;

  doc.save();
  doc.rect(MARGIN, boxY, CONTENT_WIDTH, 3).fill(color);
  doc.rect(MARGIN, boxY + 3, CONTENT_WIDTH, 50).fill(COLORS.light);
  doc.restore();

  doc.fontSize(10).fillColor(color).font('Helvetica-Bold').text(title, MARGIN + 10, boxY + 10);
  doc.fontSize(9).fillColor(COLORS.text).font('Helvetica').text(text, MARGIN + 10, boxY + 26, { width: CONTENT_WIDTH - 20, lineGap: 3 });

  doc.y = boxY + 60;
  doc.moveDown(0.3);
}

function drawCodeBlock(doc: PDFKit.PDFDocument, text: string) {
  ensureSpace(doc, 80);
  doc.moveDown(0.3);
  const lines = text.split('\n');
  const blockHeight = lines.length * 14 + 20;
  const boxY = doc.y;

  doc.save();
  doc.roundedRect(MARGIN, boxY, CONTENT_WIDTH, blockHeight, 4).fill('#1e293b');
  doc.restore();

  doc.fontSize(9).fillColor('#e2e8f0').font('Courier');
  let lineY = boxY + 10;
  for (const line of lines) {
    doc.text(line, MARGIN + 12, lineY, { width: CONTENT_WIDTH - 24 });
    lineY += 14;
  }

  doc.y = boxY + blockHeight + 5;
}

function drawCheckmark(doc: PDFKit.PDFDocument, text: string) {
  ensureSpace(doc, 20);
  doc.fontSize(10).fillColor(COLORS.success).font('Helvetica').text('✓', MARGIN + 5, doc.y);
  doc.moveUp();
  doc.fillColor(COLORS.text).text(text, MARGIN + 20, doc.y, { width: CONTENT_WIDTH - 25, lineGap: 3 });
  doc.moveDown(0.2);
}

function drawNumberedStep(doc: PDFKit.PDFDocument, num: number, text: string) {
  ensureSpace(doc, 25);
  const y = doc.y;

  doc.save();
  doc.circle(MARGIN + 10, y + 7, 9).fill(COLORS.secondary);
  doc.fontSize(8).fillColor(COLORS.white).font('Helvetica-Bold').text(num.toString(), MARGIN + 4, y + 3, { width: 12, align: 'center' });
  doc.restore();

  doc.fontSize(10).fillColor(COLORS.text).font('Helvetica').text(text, MARGIN + 25, y + 1, { width: CONTENT_WIDTH - 30, lineGap: 3 });
  doc.moveDown(0.3);
}

// =====================================================
// BUILD PDF
// =====================================================

function buildManual() {
  const doc = new PDFDocument({
    size: 'LETTER',
    bufferPages: true,
    margins: { top: MARGIN, bottom: 50, left: MARGIN, right: MARGIN },
    info: {
      Title: 'Bingo Pro - Manual de Usuario',
      Author: 'Bingo Pro',
      Subject: 'Manual completo de la plataforma de administracion de Bingo Americano',
    },
  });

  const stream = fs.createWriteStream(OUTPUT_PATH);
  doc.pipe(stream);

  // ===================================================
  // COVER PAGE
  // ===================================================
  doc.save();
  doc.rect(0, 0, PAGE_WIDTH, PAGE_HEIGHT).fill(COLORS.primary);

  // Decorative elements
  doc.save();
  doc.circle(PAGE_WIDTH - 80, 120, 200).fillOpacity(0.05).fill(COLORS.white);
  doc.circle(80, PAGE_HEIGHT - 100, 150).fillOpacity(0.03).fill(COLORS.white);
  doc.restore();

  // Top line accent
  doc.rect(MARGIN, 180, 60, 4).fill(COLORS.secondary);

  // Title
  doc.fontSize(42).fillColor(COLORS.white).font('Helvetica-Bold');
  doc.text('BINGO PRO', MARGIN, 200);
  doc.fontSize(18).fillColor('#ffffffcc').font('Helvetica');
  doc.text('Manual de Usuario', MARGIN, 252);

  // Divider
  doc.rect(MARGIN, 290, CONTENT_WIDTH, 1).fillOpacity(0.2).fill(COLORS.white);

  // Description
  doc.fillOpacity(1);
  doc.fontSize(12).fillColor('#ffffffaa').font('Helvetica');
  doc.text('Plataforma de Administracion de', MARGIN, 320);
  doc.text('Juegos de Bingo Americano (75 Numeros)', MARGIN, 338);

  // Feature highlights
  const features = [
    'Generacion masiva de cartones (hasta 1,000,000)',
    'Juegos en tiempo real con deteccion automatica de ganadores',
    'Sistema de inventario jerarquico multinivel',
    'Reportes y exportacion en PDF, PNG y CSV',
    'Control de acceso basado en roles',
  ];

  let fy = 400;
  doc.fontSize(10).font('Helvetica');
  for (const feat of features) {
    doc.fillColor(COLORS.secondary).text('■', MARGIN + 10, fy);
    doc.moveUp();
    doc.fillColor('#ffffffcc').text(feat, MARGIN + 28, fy);
    fy += 22;
  }

  // Footer
  doc.fontSize(9).fillColor('#ffffff66').font('Helvetica');
  doc.text('Version 1.0  |  Marzo 2026', MARGIN, PAGE_HEIGHT - 60);

  doc.restore();

  // ===================================================
  // TABLE OF CONTENTS (placeholder - we'll come back)
  // ===================================================
  doc.addPage();
  currentPage++;
  const tocPageStart = currentPage;
  addPageNumber(doc);

  doc.fontSize(24).fillColor(COLORS.primary).font('Helvetica-Bold').text('Tabla de Contenidos', MARGIN, MARGIN + 10);
  doc.moveDown(1.5);

  // We'll store Y position and fill TOC later
  const tocYStart = doc.y;

  // ===================================================
  // SECTION 1: ACCESO AL SISTEMA
  // ===================================================
  drawSectionHeader(doc, '1', 'Acceso al Sistema');

  drawSectionHeader(doc, '1.1', 'Inicio de Sesion', 2);
  drawParagraph(doc, 'Para acceder a la plataforma, ingrese su nombre de usuario y contrasena en la pantalla de inicio de sesion. Una vez autenticado, el sistema generara un token de sesion con una duracion de 24 horas.');
  drawParagraph(doc, 'Si su cuenta esta desactivada, no podra iniciar sesion. Contacte al administrador del sistema para reactivarla.');

  drawInfoBox(doc, 'Seguridad', 'Las contrasenas se almacenan cifradas con bcrypt. El token de sesion se transmite como Bearer Token en cada peticion.', COLORS.secondary);

  drawSectionHeader(doc, '1.2', 'Cambio de Contrasena', 2);
  drawParagraph(doc, 'Todos los usuarios pueden cambiar su propia contrasena desde su perfil. Para ello:');
  drawNumberedStep(doc, 1, 'Acceda a su perfil de usuario');
  drawNumberedStep(doc, 2, 'Ingrese su contrasena actual');
  drawNumberedStep(doc, 3, 'Ingrese la nueva contrasena y confirmela');
  drawNumberedStep(doc, 4, 'Presione "Cambiar Contrasena"');

  // ===================================================
  // SECTION 2: DASHBOARD
  // ===================================================
  drawSectionHeader(doc, '2', 'Dashboard');

  drawParagraph(doc, 'La pantalla principal ofrece una vista general del estado de la plataforma con indicadores clave, graficas de actividad y accesos directos a las funciones mas utilizadas.');

  drawSectionHeader(doc, '2.1', 'Indicadores Principales', 2);
  drawTable(doc, ['Indicador', 'Descripcion'], [
    ['Total Eventos', 'Cantidad de eventos creados con indicador de activos'],
    ['Total Cartones', 'Cartones generados en la plataforma y cuantos vendidos'],
    ['Juegos Realizados', 'Partidas completadas exitosamente'],
  ], [160, CONTENT_WIDTH - 160]);

  drawSectionHeader(doc, '2.2', 'Acciones Rapidas', 2);
  drawParagraph(doc, 'El dashboard incluye botones de acceso rapido a las operaciones mas frecuentes:');
  drawBullet(doc, 'Crear un nuevo evento');
  drawBullet(doc, 'Ver listado de cartones');
  drawBullet(doc, 'Iniciar una partida');
  drawBullet(doc, 'Validar un carton');

  drawSectionHeader(doc, '2.3', 'Graficas', 2);
  drawParagraph(doc, 'Se muestran graficas interactivas con datos de los ultimos 7, 14 o 30 dias:');
  drawBullet(doc, 'Cartones generados por dia');
  drawBullet(doc, 'Juegos creados por dia');
  drawBullet(doc, 'Distribucion por tipo de juego');

  // ===================================================
  // SECTION 3: GESTION DE EVENTOS
  // ===================================================
  drawSectionHeader(doc, '3', 'Gestion de Eventos');

  drawParagraph(doc, 'Un evento es el contenedor principal de la plataforma. Agrupa cartones y partidas bajo una misma unidad organizativa. Cada evento puede configurar si los cartones tendran centro FREE o no.');

  drawSectionHeader(doc, '3.1', 'Crear Evento', 2);
  drawNumberedStep(doc, 1, 'Navegue a Eventos y presione "Crear Evento"');
  drawNumberedStep(doc, 2, 'Complete el nombre del evento y descripcion opcional');
  drawNumberedStep(doc, 3, 'Active o desactive la opcion "Centro FREE"');
  drawNumberedStep(doc, 4, 'El evento se crea en estado Borrador');

  drawSectionHeader(doc, '3.2', 'Estados del Evento', 2);
  drawTable(doc, ['Estado', 'Descripcion'], [
    ['Borrador', 'Recien creado. Se pueden generar cartones y configurar.'],
    ['Activo', 'En curso. Se crean partidas y se venden cartones.'],
    ['Completado', 'Finalizado. Solo lectura y consulta de reportes.'],
    ['Cancelado', 'Cancelado. Solo lectura.'],
  ], [120, CONTENT_WIDTH - 120]);

  drawSectionHeader(doc, '3.3', 'Estadisticas del Evento', 2);
  drawParagraph(doc, 'En la pagina de detalle de cada evento se muestran estadisticas en tiempo real: total de cartones generados, cartones vendidos, juegos creados con su estado, y un resumen de actividad.');

  // ===================================================
  // SECTION 4: CARTONES
  // ===================================================
  drawSectionHeader(doc, '4', 'Cartones');

  drawSectionHeader(doc, '4.1', 'Estructura del Carton', 2);
  drawParagraph(doc, 'Cada carton sigue el formato de Bingo Americano con una cuadricula de 5x5:');

  drawTable(doc, ['B (1-15)', 'I (16-30)', 'N (31-45)', 'G (46-60)', 'O (61-75)'], [
    ['5 numeros', '5 numeros', '4 nums + FREE', '5 numeros', '5 numeros'],
  ]);

  drawParagraph(doc, 'Cada carton posee los siguientes identificadores unicos:');
  drawBullet(doc, 'Codigo del carton (card_code): 5 caracteres alfanumericos');
  drawBullet(doc, 'Codigo de validacion (validation_code): 5 caracteres');
  drawBullet(doc, 'Serial: formato XXXXX-XX (serie-secuencia, 50 cartones por serie)');
  drawBullet(doc, 'Hash de numeros: garantiza que no existan cartones duplicados');

  drawSectionHeader(doc, '4.2', 'Generar Cartones', 2);
  drawParagraph(doc, 'La generacion de cartones solo esta disponible para administradores.');
  drawNumberedStep(doc, 1, 'Seleccione un evento desde la seccion de Cartones');
  drawNumberedStep(doc, 2, 'Presione "Generar" e indique la cantidad (1 a 1,000,000)');
  drawNumberedStep(doc, 3, 'El sistema genera los cartones con numeros aleatorios unicos por columna');
  drawNumberedStep(doc, 4, 'Se verifica que no existan duplicados mediante hash');
  drawNumberedStep(doc, 5, 'Una barra de progreso muestra el avance en tiempo real');

  drawInfoBox(doc, 'Nota importante', 'La opcion de Centro FREE se configura a nivel del evento y no se puede cambiar despues de generar cartones.', COLORS.warning);

  drawSectionHeader(doc, '4.3', 'Buscar Cartones', 2);
  drawParagraph(doc, 'El sistema permite buscar cartones por multiples criterios:');
  drawBullet(doc, 'Codigo del carton (card_code)');
  drawBullet(doc, 'Codigo de validacion (validation_code)');
  drawBullet(doc, 'Numero de serial');
  drawBullet(doc, 'Numero de carton');
  drawParagraph(doc, 'Ademas se pueden filtrar por evento y estado de venta, con paginacion completa.');

  drawSectionHeader(doc, '4.4', 'Validar Carton', 2);
  drawParagraph(doc, 'La validacion esta disponible para todos los roles y permite verificar la autenticidad de un carton:');
  drawNumberedStep(doc, 1, 'Navegue a Cartones > Validar');
  drawNumberedStep(doc, 2, 'Ingrese el codigo del carton y el codigo de validacion');
  drawNumberedStep(doc, 3, 'Si los codigos coinciden, se muestra la cuadricula completa del carton');

  drawSectionHeader(doc, '4.5', 'Activar / Vender Carton (Punto de Venta)', 2);
  drawParagraph(doc, 'La pantalla de activacion funciona como punto de venta para registrar ventas de cartones:');
  drawNumberedStep(doc, 1, 'Busque el carton por codigo o serial (compatible con lector QR)');
  drawNumberedStep(doc, 2, 'Registre los datos del comprador (nombre y telefono)');
  drawNumberedStep(doc, 3, 'Confirme la venta');
  drawParagraph(doc, 'Requiere el permiso cards:sell (disponible para admin, moderador y vendedor).');

  // ===================================================
  // SECTION 5: PARTIDAS / JUEGOS
  // ===================================================
  drawSectionHeader(doc, '5', 'Partidas / Juegos');

  drawSectionHeader(doc, '5.1', 'Tipos de Juego', 2);
  drawTable(doc, ['Tipo', 'Descripcion', 'Celdas'], [
    ['Linea Horizontal', 'Cualquier fila completa', '5'],
    ['Linea Vertical', 'Cualquier columna completa', '5'],
    ['Diagonal', 'Cualquiera de las dos diagonales', '5'],
    ['Blackout', 'Todas las celdas del carton', '24'],
    ['Cuatro Esquinas', 'Las 4 esquinas del carton', '4'],
    ['Patron X', 'Ambas diagonales formando X', '9'],
    ['Personalizado', 'Patron disenado manualmente', 'Variable'],
  ], [140, CONTENT_WIDTH - 190, 50]);

  drawSectionHeader(doc, '5.2', 'Crear Partida', 2);
  drawNumberedStep(doc, 1, 'Vaya al detalle del evento y presione "Crear Juego"');
  drawNumberedStep(doc, 2, 'Asigne un nombre a la partida');
  drawNumberedStep(doc, 3, 'Seleccione el tipo de juego');
  drawNumberedStep(doc, 4, 'Elija el modo: Practica (todos los cartones) o Real (solo vendidos)');
  drawNumberedStep(doc, 5, 'Opcionalmente agregue descripcion del premio');
  drawParagraph(doc, 'Si selecciona tipo "Personalizado", podra disenar el patron en una grilla interactiva de 5x5 con presets disponibles (L, T, Marco, Cruz).');

  drawSectionHeader(doc, '5.3', 'Ciclo de Vida del Juego', 2);
  drawCodeBlock(doc, 'Pendiente --> En Progreso --> Pausado <--> Reanudado --> Completado\n                                                       --> Cancelado');

  drawTable(doc, ['Accion', 'Descripcion'], [
    ['Iniciar', 'Comienza la partida y habilita el llamado de balotas'],
    ['Pausar', 'Detiene temporalmente la partida (se puede reanudar)'],
    ['Reanudar', 'Continua desde donde se pauso'],
    ['Reiniciar', 'Limpia todas las balotas y vuelve a empezar'],
    ['Finalizar', 'Termina la partida y genera reporte automatico'],
    ['Cancelar', 'Termina la partida sin generar reporte'],
  ], [120, CONTENT_WIDTH - 120]);

  drawSectionHeader(doc, '5.4', 'Pantalla de Juego en Tiempo Real', 2);
  drawParagraph(doc, 'La interfaz de juego ofrece las siguientes funcionalidades:');
  drawBullet(doc, 'Panel de balotas: grilla visual B-I-N-G-O con balotas marcadas');
  drawBullet(doc, 'Boton de llamado aleatorio: selecciona una balota al azar');
  drawBullet(doc, 'Llamado manual: permite elegir una balota especifica');
  drawBullet(doc, 'Contador de balotas llamadas vs disponibles');
  drawBullet(doc, 'Deteccion automatica de ganadores despues de cada balota');
  drawBullet(doc, 'Toggle de sonido: efectos de audio por cada balota');
  drawBullet(doc, 'Comunicacion en tiempo real via Socket.IO');

  drawInfoBox(doc, 'Tiempo Real', 'Multiples operadores pueden ver la misma partida simultaneamente. Todas las balotas y deteccion de ganadores se sincronizan al instante.', COLORS.accent);

  drawSectionHeader(doc, '5.5', 'Deteccion de Ganadores', 2);
  drawParagraph(doc, 'Cuando se detecta un ganador automaticamente, el sistema muestra:');
  drawBullet(doc, 'Numero y codigo del carton ganador');
  drawBullet(doc, 'Nombre del comprador (si el carton fue vendido)');
  drawBullet(doc, 'Cantidad de balotas necesarias para ganar');
  drawBullet(doc, 'El patron ganador que se completo');

  // ===================================================
  // SECTION 6: INVENTARIO JERARQUICO
  // ===================================================
  drawSectionHeader(doc, '6', 'Inventario Jerarquico');

  drawParagraph(doc, 'El sistema de inventario permite rastrear la distribucion fisica de cartones desde puntos centrales hasta los vendedores finales, usando una estructura de arbol con hasta 5 niveles de profundidad.');

  drawSectionHeader(doc, '6.1', 'Concepto de Arbol de Distribucion', 2);
  drawParagraph(doc, 'La distribucion se organiza como un arbol jerarquico donde cada nodo representa un punto de distribucion. Se pueden crear multiples nodos raiz por evento, permitiendo canales de distribucion independientes:');

  drawCodeBlock(doc,
    'Loteria Principal (Nivel 1 - Raiz)\n' +
    '├── Agencia Norte (Nivel 2)\n' +
    '│   ├── Vendedor Juan (Nivel 3)\n' +
    '│   └── Vendedor Maria (Nivel 3)\n' +
    '├── Agencia Sur (Nivel 2)\n' +
    '│   └── Vendedor Pedro (Nivel 3)\n' +
    '└── Agencia Centro (Nivel 2)\n' +
    '\n' +
    'Supermercado XYZ (Nivel 1 - Raiz)\n' +
    '├── Sucursal Centro (Nivel 2)\n' +
    '│   └── Cajera Ana (Nivel 3)\n' +
    '└── Sucursal Este (Nivel 2)'
  );

  drawSectionHeader(doc, '6.2', 'Configurar Niveles', 2);
  drawNumberedStep(doc, 1, 'Seleccione un evento en la seccion de Inventario');
  drawNumberedStep(doc, 2, 'Presione "Configurar Niveles"');
  drawNumberedStep(doc, 3, 'Defina los nombres de cada nivel (ej: Loteria, Agencia, Vendedor)');
  drawNumberedStep(doc, 4, 'Puede definir de 1 a 5 niveles');

  drawInfoBox(doc, 'Restriccion', 'No se pueden reducir niveles si existen nodos activos en niveles superiores al nuevo maximo.', COLORS.warning);

  drawSectionHeader(doc, '6.3', 'Crear Nodos', 2);
  drawParagraph(doc, 'Los nodos se crean de dos formas:');
  drawBullet(doc, 'Nodo Raiz: boton "Nodo Raiz" para crear un punto de distribucion principal');
  drawBullet(doc, 'Nodo Hijo: boton "+" en cualquier nodo existente para agregar un hijo');
  drawParagraph(doc, 'Cada nodo puede incluir: nombre (obligatorio), codigo identificador, nombre de contacto y telefono.');

  drawSectionHeader(doc, '6.4', 'Operaciones con Cartones', 2);
  drawTable(doc, ['Operacion', 'Descripcion'], [
    ['Carga Inicial', 'Carga cartones sin asignar al nodo raiz (solo nivel 1)'],
    ['Asignar a Hijo', 'Distribuye cartones del nodo actual a un hijo directo'],
    ['Devolver al Padre', 'Retorna cartones al nodo padre'],
    ['Marcar Venta', 'Registra cartones como vendidos (estado final)'],
  ], [140, CONTENT_WIDTH - 140]);

  drawSectionHeader(doc, '6.5', 'Seleccion de Cartones', 2);
  drawParagraph(doc, 'Para cada operacion se pueden seleccionar cartones de dos formas:');
  drawBullet(doc, 'Rango de series: desde serie X hasta serie Y (cada serie = 50 cartones)');
  drawBullet(doc, 'Rango de numeros: desde carton # hasta carton #');

  drawSectionHeader(doc, '6.6', 'Contadores por Nodo', 2);
  drawTable(doc, ['Contador', 'Significado'], [
    ['Asignados', 'Total de cartones que han llegado al nodo'],
    ['Distribuidos', 'Cartones enviados a nodos hijos'],
    ['Vendidos', 'Cartones marcados como vendidos'],
    ['En Mano', 'Disponibles = Asignados - Distribuidos - Vendidos'],
  ], [120, CONTENT_WIDTH - 120]);

  drawSectionHeader(doc, '6.7', 'Historial de Movimientos', 2);
  drawParagraph(doc, 'Cada movimiento de cartones queda registrado con: carton afectado, tipo de operacion, nodo origen, nodo destino, usuario que ejecuto, identificador de lote (batch) y notas opcionales.');
  drawParagraph(doc, 'Se puede filtrar el historial por nodo, tipo de movimiento y rango de fechas.');

  // ===================================================
  // SECTION 7: REPORTES Y EXPORTACION
  // ===================================================
  drawSectionHeader(doc, '7', 'Reportes y Exportacion');

  drawSectionHeader(doc, '7.1', 'Reporte de Partida', 2);
  drawParagraph(doc, 'Al finalizar una partida se genera automaticamente un reporte completo que incluye:');
  drawBullet(doc, 'Informacion del juego: evento, tipo, modo (practica/real)');
  drawBullet(doc, 'Historial completo de balotas llamadas con orden y hora');
  drawBullet(doc, 'Detalle de ganadores con carton y patron');
  drawBullet(doc, 'Duracion total de la partida');
  drawParagraph(doc, 'El reporte se puede descargar en formato PDF.');

  drawSectionHeader(doc, '7.2', 'Consultas Disponibles', 2);
  drawBullet(doc, 'Ganadores por juego');
  drawBullet(doc, 'Ganadores por evento');
  drawBullet(doc, 'Historial de balotas por juego');
  drawBullet(doc, 'Victorias de un carton especifico');
  drawBullet(doc, 'Ultimos ganadores del sistema');

  drawSectionHeader(doc, '7.3', 'Exportacion de Cartones', 2);
  drawTable(doc, ['Formato', 'Descripcion'], [
    ['PDF', 'Cartones con grilla visual, codigo y validacion (4 por pagina)'],
    ['PNG', 'Imagenes individuales de cada carton'],
    ['CSV', 'Datos en formato tabla para impresion masiva'],
  ], [80, CONTENT_WIDTH - 80]);

  // ===================================================
  // SECTION 8: GESTION DE USUARIOS
  // ===================================================
  drawSectionHeader(doc, '8', 'Gestion de Usuarios');

  drawParagraph(doc, 'La gestion de usuarios esta disponible exclusivamente para administradores.');

  drawSectionHeader(doc, '8.1', 'Crear Usuario', 2);
  drawNumberedStep(doc, 1, 'Navegue a Usuarios > Crear Usuario');
  drawNumberedStep(doc, 2, 'Complete: nombre de usuario, email, nombre completo, contrasena');
  drawNumberedStep(doc, 3, 'Asigne un rol: Admin, Moderador, Vendedor o Visor');

  drawSectionHeader(doc, '8.2', 'Administrar Usuarios', 2);
  drawParagraph(doc, 'Operaciones disponibles sobre usuarios existentes:');
  drawBullet(doc, 'Editar datos personales y rol');
  drawBullet(doc, 'Activar o desactivar cuentas');
  drawBullet(doc, 'Eliminar usuarios (no se permite eliminarse a si mismo)');
  drawBullet(doc, 'Restablecer contrasena');

  // ===================================================
  // SECTION 9: ROLES Y PERMISOS
  // ===================================================
  drawSectionHeader(doc, '9', 'Roles y Permisos');

  drawParagraph(doc, 'La plataforma define cuatro roles con diferentes niveles de acceso. La siguiente tabla muestra la matriz completa de permisos:');

  drawTable(doc,
    ['Funcionalidad', 'Admin', 'Moderador', 'Vendedor', 'Visor'],
    [
      ['Dashboard', 'Si', 'Si', 'Si', 'Si'],
      ['Ver eventos', 'Si', 'Si', 'Si', 'Si'],
      ['Crear/editar eventos', 'Si', '—', '—', '—'],
      ['Ver cartones', 'Si', 'Si', 'Si', 'Si'],
      ['Generar cartones', 'Si', '—', '—', '—'],
      ['Vender cartones', 'Si', 'Si', 'Si', '—'],
      ['Exportar cartones', 'Si', '—', '—', '—'],
      ['Ver juegos', 'Si', 'Si', 'Si', 'Si'],
      ['Crear juegos', 'Si', 'Si', '—', '—'],
      ['Jugar partidas', 'Si', 'Si', '—', '—'],
      ['Finalizar partidas', 'Si', 'Si', '—', '—'],
      ['Ver reportes', 'Si', 'Si', '—', 'Si'],
      ['Exportar reportes', 'Si', '—', '—', '—'],
      ['Inventario: ver', 'Si', 'Si', 'Si', 'Si'],
      ['Inventario: gestionar', 'Si', '—', '—', '—'],
      ['Inventario: asignar', 'Si', 'Si', '—', '—'],
      ['Inventario: vender', 'Si', 'Si', 'Si', '—'],
      ['Gestionar usuarios', 'Si', '—', '—', '—'],
    ],
    [160, (CONTENT_WIDTH - 160) / 4, (CONTENT_WIDTH - 160) / 4, (CONTENT_WIDTH - 160) / 4, (CONTENT_WIDTH - 160) / 4]
  );

  drawSectionHeader(doc, '9.1', 'Descripcion de Roles', 2);

  drawParagraph(doc, 'Admin: Acceso completo a todas las funcionalidades del sistema. Puede crear eventos, generar cartones, gestionar usuarios y configurar el inventario.');
  drawParagraph(doc, 'Moderador: Puede operar eventos existentes, crear y dirigir partidas, asignar cartones en inventario y vender.');
  drawParagraph(doc, 'Vendedor: Enfocado en ventas. Puede ver eventos y cartones, registrar ventas y operar en inventario como punto de venta.');
  drawParagraph(doc, 'Visor: Acceso de solo lectura. Puede consultar eventos, cartones, juegos y reportes sin modificar nada.');

  // ===================================================
  // GLOSSARY
  // ===================================================
  drawSectionHeader(doc, '10', 'Glosario');

  drawTable(doc, ['Termino', 'Definicion'], [
    ['Evento', 'Contenedor principal que agrupa cartones y partidas de bingo'],
    ['Carton', 'Tabla de 5x5 con numeros aleatorios para jugar bingo'],
    ['Partida / Juego', 'Sesion de bingo con un patron especifico a completar'],
    ['Balota', 'Numero del 1 al 75 que se llama durante la partida'],
    ['Serie', 'Grupo de 50 cartones consecutivos'],
    ['Serial', 'Identificador formato XXXXX-XX (serie-secuencia)'],
    ['Card Code', 'Codigo unico de 5 caracteres para identificar un carton'],
    ['Validation Code', 'Codigo de 5 caracteres para verificar autenticidad'],
    ['FREE', 'Celda central marcada automaticamente'],
    ['Blackout', 'Tipo de juego donde se completan todas las celdas'],
    ['Nodo', 'Punto en el arbol de distribucion de inventario'],
    ['Batch', 'Lote que agrupa movimientos de cartones'],
    ['Socket.IO', 'Tecnologia de comunicacion en tiempo real'],
  ], [130, CONTENT_WIDTH - 130]);

  // ===================================================
  // BACK TO TOC - Fill it in
  // ===================================================
  // Go to TOC page and fill entries
  const pages = doc.bufferedPageRange();
  // We need to switch to page 1 (TOC)
  doc.switchToPage(1);
  let tocY = tocYStart;
  doc.fontSize(11).font('Helvetica');
  for (const entry of tocEntries) {
    if (entry.level === 1) {
      doc.fillColor(COLORS.primary).font('Helvetica-Bold').fontSize(11);
      doc.text(entry.title, MARGIN, tocY, { continued: true, width: CONTENT_WIDTH - 40 });
      doc.text(entry.page.toString(), { align: 'right', width: 40 });
      tocY = doc.y + 4;
    } else {
      doc.fillColor(COLORS.muted).font('Helvetica').fontSize(10);
      doc.text(entry.title, MARGIN + 15, tocY, { continued: true, width: CONTENT_WIDTH - 55 });
      doc.text(entry.page.toString(), { align: 'right', width: 40 });
      tocY = doc.y + 2;
    }
  }

  // Finalize
  doc.end();

  stream.on('finish', () => {
    console.log(`\n✅ Manual generado exitosamente: ${OUTPUT_PATH}`);
    console.log(`   Paginas: ${currentPage}`);
    console.log(`   Secciones: ${tocEntries.filter(e => e.level === 1).length}`);
  });
}

buildManual();
