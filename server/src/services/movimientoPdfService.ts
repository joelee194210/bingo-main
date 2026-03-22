import PDFDocument from 'pdfkit';
import { existsSync, mkdirSync, createWriteStream } from 'fs';
import { join, resolve } from 'path';

const MOVIMIENTOS_DIR = join(process.cwd(), 'exports', 'movimientos');
const LOGO_CANDIDATES = [
  resolve(process.cwd(), 'client/public/logo.png'),
  resolve(process.cwd(), 'client/dist/logo.png'),
  resolve(process.cwd(), 'logo.png'),
];
function getLogoPath(): string {
  return LOGO_CANDIDATES.find(p => existsSync(p)) || '';
}

if (!existsSync(MOVIMIENTOS_DIR)) {
  mkdirSync(MOVIMIENTOS_DIR, { recursive: true });
}

const ACCION_TITULOS: Record<string, string> = {
  asignar: 'ACTA DE ENTREGA DE CARTONES',
  devolver: 'ACTA DE DEVOLUCION DE CARTONES',
  cancelar: 'ACTA DE CANCELACION DE ASIGNACION',
  carga_inventario: 'COMPROBANTE DE CARGA DE INVENTARIO',
  traslado: 'COMPROBANTE DE TRASLADO DE INVENTARIO',
  consignacion: 'COMPROBANTE DE CONSIGNACION DE INVENTARIO',
  devolucion: 'COMPROBANTE DE DEVOLUCION DE INVENTARIO',
  venta: 'COMPROBANTE DE VENTA',
};

const ACCION_DESCRIPCION: Record<string, string> = {
  asignar: 'Se hace constar que se han entregado los siguientes cartones de bingo para su custodia y/o venta.',
  devolver: 'Se hace constar que se han devuelto los siguientes cartones de bingo previamente asignados.',
  cancelar: 'Se hace constar que se ha cancelado la asignacion de los siguientes cartones de bingo.',
  carga_inventario: 'Se hace constar que se ha recibido el siguiente inventario de cartones de bingo.',
  traslado: 'Se hace constar que se ha realizado el traslado del siguiente inventario de cartones de bingo.',
  consignacion: 'Se hace constar que se ha entregado en consignacion el siguiente inventario de cartones de bingo.',
  devolucion: 'Se hace constar que se ha recibido la devolucion del siguiente inventario de cartones de bingo. Los cartones vendidos han sido desmarcados.',
  venta: 'Se hace constar que se han vendido los siguientes cartones de bingo.',
};

export interface MovimientoPdfData {
  movimientoId: number;
  accion: string;
  fecha: string;
  eventoNombre: string;
  almacenNombre: string;
  referencia: string;
  tipoEntidad: string;
  cantidadCartones: number;
  personaNombre: string;
  personaTelefono?: string;
  asignadoPor: string;
  proposito?: string;
  cartones: { card_code: string; serial: string }[];
  firmaEntrega?: string; // base64 PNG
  firmaRecibe?: string;  // base64 PNG
  nombreEntrega: string;
  nombreRecibe: string;
}

export function generateMovimientoPdf(data: MovimientoPdfData): Promise<string> {
  return new Promise((resolve, reject) => {
    const filename = `MOV-${data.movimientoId}-${data.accion}-${Date.now()}.pdf`;
    const filepath = join(MOVIMIENTOS_DIR, filename);
    const doc = new PDFDocument({ size: 'LETTER', margin: 50 });
    const stream = createWriteStream(filepath);

    doc.pipe(stream);

    const pageWidth = doc.page.width - 100; // margins

    // Logo + Header
    if (getLogoPath()) {
      doc.image(getLogoPath(), doc.page.width / 2 - 40, 30, { width: 80 });
      doc.moveDown(4);
    }
    doc.fontSize(16).font('Helvetica-Bold')
      .text(ACCION_TITULOS[data.accion] || 'ACTA DE MOVIMIENTO DE INVENTARIO', { align: 'center' });

    doc.moveDown(0.3);
    doc.fontSize(10).font('Helvetica')
      .text(`Documento No: MOV-${data.movimientoId.toString().padStart(6, '0')}`, { align: 'center' });

    doc.moveDown(0.5);

    // Horizontal line
    const lineY = doc.y;
    doc.moveTo(50, lineY).lineTo(50 + pageWidth, lineY).stroke('#cccccc');
    doc.moveDown(0.5);

    // Event & date info
    doc.fontSize(10).font('Helvetica-Bold').text('Evento: ', { continued: true });
    doc.font('Helvetica').text(data.eventoNombre);

    doc.font('Helvetica-Bold').text('Fecha: ', { continued: true });
    doc.font('Helvetica').text(new Date(data.fecha).toLocaleString('es-ES', {
      year: 'numeric', month: 'long', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    }));

    doc.font('Helvetica-Bold').text('Almacen: ', { continued: true });
    doc.font('Helvetica').text(data.almacenNombre);

    doc.moveDown(0.5);

    // Description
    doc.fontSize(10).font('Helvetica')
      .text(ACCION_DESCRIPCION[data.accion] || 'Registro de movimiento de inventario.');

    doc.moveDown(0.5);

    // Movement details box
    const boxY = doc.y;
    doc.rect(50, boxY, pageWidth, 80).stroke('#333333');

    doc.fontSize(9).font('Helvetica');
    const col1 = 60;
    const col2 = 60 + pageWidth / 2;

    doc.font('Helvetica-Bold').text('Tipo:', col1, boxY + 10, { continued: true });
    doc.font('Helvetica').text(` ${data.tipoEntidad === 'libreta' ? 'Libreta' : data.tipoEntidad === 'caja' ? 'Caja' : 'Carton'}`);

    doc.font('Helvetica-Bold').text('Referencia:', col2, boxY + 10, { continued: true });
    doc.font('Helvetica').text(` ${data.referencia}`);

    doc.font('Helvetica-Bold').text('Cantidad de Cartones:', col1, boxY + 30, { continued: true });
    doc.font('Helvetica').text(` ${data.cantidadCartones}`);

    if (data.proposito) {
      doc.font('Helvetica-Bold').text('Proposito:', col2, boxY + 30, { continued: true });
      doc.font('Helvetica').text(` ${data.proposito === 'venta' ? 'Venta' : 'Custodia'}`);
    }

    doc.font('Helvetica-Bold').text('Persona:', col1, boxY + 50, { continued: true });
    doc.font('Helvetica').text(` ${data.personaNombre}${data.personaTelefono ? ' - Tel: ' + data.personaTelefono : ''}`);

    doc.y = boxY + 90;

    // Cartones list
    if (data.cartones.length > 0 && data.cartones.length <= 200) {
      doc.moveDown(0.3);
      doc.fontSize(10).font('Helvetica-Bold').text('Detalle de Cartones:');
      doc.moveDown(0.3);

      // Table header
      const tableX = 50;
      const colWidth = pageWidth / 4;
      const headerY = doc.y;

      doc.rect(tableX, headerY, pageWidth, 18).fill('#f3f4f6');
      doc.fontSize(8).font('Helvetica-Bold').fillColor('#333333');
      doc.text('#', tableX + 5, headerY + 4, { width: 30 });
      doc.text('Codigo', tableX + 35, headerY + 4, { width: colWidth });
      doc.text('Serie', tableX + 35 + colWidth, headerY + 4, { width: colWidth });

      doc.y = headerY + 20;

      // Table rows
      doc.font('Helvetica').fontSize(8);
      data.cartones.forEach((c, i) => {
        if (doc.y > doc.page.height - 180) {
          doc.addPage();
        }
        const rowY = doc.y;
        if (i % 2 === 0) {
          doc.rect(tableX, rowY, pageWidth, 14).fill('#fafafa');
          doc.fillColor('#333333');
        }
        doc.text(`${i + 1}`, tableX + 5, rowY + 3, { width: 30 });
        doc.text(c.card_code, tableX + 35, rowY + 3, { width: colWidth });
        doc.text(c.serial, tableX + 35 + colWidth, rowY + 3, { width: colWidth });
        doc.y = rowY + 14;
      });
    } else if (data.cartones.length > 200) {
      doc.moveDown(0.3);
      doc.fontSize(9).font('Helvetica')
        .text(`Total de ${data.cantidadCartones} cartones (listado omitido por volumen). Referencia: ${data.referencia}`);
    }

    // Signatures section
    const firmaBlockH = 90;
    if (doc.y + firmaBlockH + 50 > doc.page.height) doc.addPage();

    doc.moveDown(1);
    doc.moveTo(50, doc.y).lineTo(50 + pageWidth, doc.y).stroke('#cccccc');
    doc.moveDown(0.3);

    const sigWidth = pageWidth / 2 - 20;
    const sigStartY = doc.y;

    // Left signature: ENTREGA
    doc.fontSize(8).font('Helvetica-Bold').text('ENTREGA:', 50, sigStartY);
    doc.font('Helvetica').text(data.nombreEntrega, 105, sigStartY);

    if (data.firmaEntrega) {
      try {
        const imgData = data.firmaEntrega.replace(/^data:image\/\w+;base64,/, '');
        const imgBuffer = Buffer.from(imgData, 'base64');
        doc.image(imgBuffer, 50, sigStartY + 14, { width: sigWidth, height: 45, fit: [sigWidth, 45] });
      } catch {
        doc.fontSize(7).text('[Firma no disponible]', 50, sigStartY + 30);
      }
    } else {
      const lineY2 = sigStartY + 55;
      doc.moveTo(50, lineY2).lineTo(50 + sigWidth, lineY2).stroke('#666666');
      doc.fontSize(7).text('Firma', 50, lineY2 + 3, { width: sigWidth, align: 'center' });
    }

    // Right signature: RECIBE
    const rightX = 50 + pageWidth / 2 + 10;
    doc.fontSize(8).font('Helvetica-Bold').text('RECIBE:', rightX, sigStartY);
    doc.font('Helvetica').text(data.nombreRecibe, rightX + 50, sigStartY);

    if (data.firmaRecibe) {
      try {
        const imgData = data.firmaRecibe.replace(/^data:image\/\w+;base64,/, '');
        const imgBuffer = Buffer.from(imgData, 'base64');
        doc.image(imgBuffer, rightX, sigStartY + 14, { width: sigWidth, height: 45, fit: [sigWidth, 45] });
      } catch {
        doc.fontSize(7).text('[Firma no disponible]', rightX, sigStartY + 30);
      }
    } else {
      const lineY2 = sigStartY + 55;
      doc.moveTo(rightX, lineY2).lineTo(rightX + sigWidth, lineY2).stroke('#666666');
      doc.fontSize(7).text('Firma', rightX, lineY2 + 3, { width: sigWidth, align: 'center' });
    }

    // Footer
    doc.fontSize(7).font('Helvetica').fillColor('#999999')
      .text(
        `Generado automaticamente por MegabingoTV - ${new Date().toISOString()}`,
        50,
        doc.page.height - 40,
        { align: 'center', width: pageWidth }
      );

    doc.end();

    stream.on('finish', () => resolve(filepath));
    stream.on('error', reject);
  });
}

// =====================================================
// PDF para documentos con múltiples items y detalle jerárquico
// =====================================================

export interface LoteDetalle {
  lote_code: string;
  total_cards: number;
  cards_sold: number;
  serial_desde?: string; // primer serial de la libreta (ej: "00001-01")
  serial_hasta?: string; // último serial (ej: "00001-50")
}

export interface DocumentoItemDetalle {
  tipo: string; // caja | libreta | carton
  referencia: string;
  cartones: number;
  // Rangos generales del item
  serial_desde?: string; // primer serial del conjunto
  serial_hasta?: string; // último serial del conjunto
  lotes?: LoteDetalle[];
  cartonesDetalle?: { card_code: string; serial: string; is_sold: boolean; total_cards?: number; cards_sold?: number }[];
}

export interface DocumentoPdfData {
  documentoId: number;
  accion: string;
  fecha: string;
  eventoNombre: string;
  deNombre: string;
  aNombre: string;
  totalItems: number;
  totalCartones: number;
  asignadoPor: string;
  items: DocumentoItemDetalle[];
  firmaEntrega?: string;
  firmaRecibe?: string;
  nombreEntrega: string;
  nombreRecibe: string;
}

export function generateDocumentoPdf(data: DocumentoPdfData): Promise<string> {
  return new Promise((resolve, reject) => {
    const filename = `DOC-${data.documentoId}-${data.accion}-${Date.now()}.pdf`;
    const filepath = join(MOVIMIENTOS_DIR, filename);
    const doc = new PDFDocument({ size: 'LETTER', margin: 50 });
    const stream = createWriteStream(filepath);

    doc.pipe(stream);

    const pageWidth = doc.page.width - 100;
    const margin = 50;

    // ---- HEADER ----
    if (getLogoPath()) {
      doc.image(getLogoPath(), doc.page.width / 2 - 40, 30, { width: 80 });
      doc.moveDown(4);
    }
    doc.fontSize(14).font('Helvetica-Bold')
      .text(ACCION_TITULOS[data.accion] || 'ACTA DE MOVIMIENTO DE INVENTARIO', { align: 'center' });

    doc.moveDown(0.2);
    doc.fontSize(10).font('Helvetica')
      .text(`Documento No: DOC-${data.documentoId.toString().padStart(6, '0')}`, { align: 'center' });

    doc.moveDown(0.4);
    doc.moveTo(margin, doc.y).lineTo(margin + pageWidth, doc.y).stroke('#cccccc');
    doc.moveDown(0.4);

    // ---- INFO GENERAL ----
    const infoCol1 = margin;
    const _infoCol2 = margin + pageWidth / 2;

    doc.fontSize(9).font('Helvetica-Bold').text('Evento: ', infoCol1, doc.y, { continued: true });
    doc.font('Helvetica').text(data.eventoNombre);

    doc.font('Helvetica-Bold').text('Fecha: ', infoCol1, doc.y, { continued: true });
    doc.font('Helvetica').text(new Date(data.fecha).toLocaleString('es-ES', {
      year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit',
    }));

    const infoY = doc.y;
    doc.font('Helvetica-Bold').text('Desde: ', infoCol1, infoY, { continued: true });
    doc.font('Helvetica').text(data.deNombre || 'N/A');
    doc.font('Helvetica-Bold').text('Hacia: ', infoCol1, doc.y, { continued: true });
    doc.font('Helvetica').text(data.aNombre || 'N/A');

    doc.font('Helvetica-Bold').text('Realizado por: ', infoCol1, doc.y, { continued: true });
    doc.font('Helvetica').text(data.asignadoPor);

    doc.moveDown(0.3);

    // ---- DESCRIPCION ----
    doc.fontSize(9).font('Helvetica')
      .text(ACCION_DESCRIPCION[data.accion] || 'Registro de movimiento de inventario.');

    doc.moveDown(0.4);

    // ---- RESUMEN ----
    const summaryY = doc.y;
    doc.rect(margin, summaryY, pageWidth, 30).fill('#f0f4f8');
    doc.fillColor('#333333').fontSize(9).font('Helvetica-Bold');
    doc.text(`Total: ${data.totalItems} items — ${data.totalCartones.toLocaleString()} cartones`, margin + 10, summaryY + 9);
    doc.y = summaryY + 38;

    // Helper para formatear serial legible (quitar ceros iniciales)
    const fmtSerial = (s: string) => {
      if (!s) return '';
      const parts = s.split('-');
      if (parts.length === 2) return `${parseInt(parts[0], 10)}-${parseInt(parts[1], 10).toString().padStart(2, '0')}`;
      return s;
    };

    // ---- DETALLE POR ITEM ----
    for (let idx = 0; idx < data.items.length; idx++) {
      const item = data.items[idx];

      // Check page space
      if (doc.y > doc.page.height - 200) doc.addPage();

      // Item header con rango general
      const itemHeaderY = doc.y;
      const tipoLabel = item.tipo === 'caja' ? 'CAJA' : item.tipo === 'libreta' ? 'LIBRETA' : 'CARTON';
      const headerHeight = 22;
      doc.rect(margin, itemHeaderY, pageWidth, headerHeight).fill('#e8edf2');
      doc.fillColor('#1a1a1a').fontSize(9).font('Helvetica-Bold');
      doc.text(`${idx + 1}. ${tipoLabel}: ${item.referencia}`, margin + 8, itemHeaderY + 6, { continued: true });
      doc.font('Helvetica').text(`  —  ${item.cartones.toLocaleString()} cartones`);
      doc.y = itemHeaderY + headerHeight + 4;

      // Rango general del item (desde - hasta)
      if (item.serial_desde && item.serial_hasta) {
        doc.fontSize(8).font('Helvetica-Bold').fillColor('#333333')
          .text('Rango: ', margin + 12, doc.y, { continued: true });
        doc.font('Helvetica')
          .text(`Serie ${fmtSerial(item.serial_desde)}  →  Serie ${fmtSerial(item.serial_hasta)}`);
        doc.moveDown(0.2);
      }

      // Detalle jerarquico segun tipo
      if (item.tipo === 'caja' && item.lotes && item.lotes.length > 0) {
        // CAJA: tabla de libretas con rangos de seriales
        const loteTableY = doc.y;
        doc.rect(margin + 10, loteTableY, pageWidth - 20, 14).fill('#f5f5f5');
        doc.fillColor('#333333').fontSize(7).font('Helvetica-Bold');
        doc.text('Libreta', margin + 15, loteTableY + 3, { width: 80 });
        doc.text('Desde', margin + 100, loteTableY + 3, { width: 75 });
        doc.text('Hasta', margin + 180, loteTableY + 3, { width: 75 });
        doc.text('Cartones', margin + 260, loteTableY + 3, { width: 50 });
        doc.text('Vendidos', margin + 315, loteTableY + 3, { width: 50 });
        doc.text('Disp.', margin + 370, loteTableY + 3, { width: 50 });
        doc.y = loteTableY + 16;

        doc.font('Helvetica').fontSize(7);
        for (let li = 0; li < item.lotes.length; li++) {
          if (doc.y > doc.page.height - 150) doc.addPage();
          const lote = item.lotes[li];
          const rowY = doc.y;
          if (li % 2 === 0) {
            doc.rect(margin + 10, rowY - 1, pageWidth - 20, 12).fill('#fafafa');
            doc.fillColor('#333333');
          }
          doc.text(lote.lote_code, margin + 15, rowY, { width: 80 });
          doc.text(lote.serial_desde ? fmtSerial(lote.serial_desde) : '-', margin + 100, rowY, { width: 75 });
          doc.text(lote.serial_hasta ? fmtSerial(lote.serial_hasta) : '-', margin + 180, rowY, { width: 75 });
          doc.text(lote.total_cards.toString(), margin + 260, rowY, { width: 50 });
          doc.text(lote.cards_sold.toString(), margin + 315, rowY, { width: 50 });
          doc.text((lote.total_cards - lote.cards_sold).toString(), margin + 370, rowY, { width: 50 });
          doc.y = rowY + 12;
        }
        doc.moveDown(0.3);

      } else if (item.tipo === 'libreta') {
        // LIBRETA: resumen con rango de cartones
        const totalCards = item.cartonesDetalle?.[0]?.total_cards || item.cartones;
        const soldCards = item.cartonesDetalle?.[0]?.cards_sold || 0;
        doc.fontSize(8).font('Helvetica')
          .text(`${totalCards} cartones total — ${soldCards} vendidos — ${totalCards - soldCards} disponibles`, margin + 15);
        doc.moveDown(0.2);

      } else if (item.tipo === 'carton' && item.cartonesDetalle && item.cartonesDetalle.length > 0) {
        // CARTON: serie y estado
        const c = item.cartonesDetalle[0];
        doc.fontSize(8).font('Helvetica')
          .text(`Serie: ${fmtSerial(c.serial)}  |  Estado: ${c.is_sold ? 'Vendido' : 'Disponible'}`, margin + 15);
        doc.moveDown(0.2);
      }

      // Separator between items
      if (idx < data.items.length - 1) {
        doc.moveTo(margin + 20, doc.y).lineTo(margin + pageWidth - 20, doc.y).dash(3, { space: 3 }).stroke('#cccccc').undash();
        doc.moveDown(0.3);
      }
    }

    // ---- FIRMAS ----
    const firmaBlockHeight = 90; // altura total del bloque de firmas
    if (doc.y + firmaBlockHeight + 50 > doc.page.height) doc.addPage();

    doc.moveDown(1);
    doc.moveTo(margin, doc.y).lineTo(margin + pageWidth, doc.y).stroke('#cccccc');
    doc.moveDown(0.3);

    const sigWidth = pageWidth / 2 - 20;
    const sigStartY = doc.y;

    // Firma ENTREGA
    doc.fontSize(8).font('Helvetica-Bold').text('ENTREGA:', margin, sigStartY);
    doc.font('Helvetica').text(data.nombreEntrega, margin + 55, sigStartY);

    if (data.firmaEntrega) {
      try {
        const imgData = data.firmaEntrega.replace(/^data:image\/\w+;base64,/, '');
        const imgBuffer = Buffer.from(imgData, 'base64');
        doc.image(imgBuffer, margin, sigStartY + 14, { width: sigWidth, height: 45, fit: [sigWidth, 45] });
      } catch {
        doc.fontSize(7).text('[Firma no disponible]', margin, sigStartY + 30);
      }
    } else {
      const lineY2 = sigStartY + 55;
      doc.moveTo(margin, lineY2).lineTo(margin + sigWidth, lineY2).stroke('#666666');
      doc.fontSize(7).text('Firma', margin, lineY2 + 3, { width: sigWidth, align: 'center' });
    }

    // Firma RECIBE
    const rightX = margin + pageWidth / 2 + 10;
    doc.fontSize(8).font('Helvetica-Bold').text('RECIBE:', rightX, sigStartY);
    doc.font('Helvetica').text(data.nombreRecibe, rightX + 50, sigStartY);

    if (data.firmaRecibe) {
      try {
        const imgData = data.firmaRecibe.replace(/^data:image\/\w+;base64,/, '');
        const imgBuffer = Buffer.from(imgData, 'base64');
        doc.image(imgBuffer, rightX, sigStartY + 14, { width: sigWidth, height: 45, fit: [sigWidth, 45] });
      } catch {
        doc.fontSize(7).text('[Firma no disponible]', rightX, sigStartY + 30);
      }
    } else {
      const lineY2 = sigStartY + 55;
      doc.moveTo(rightX, lineY2).lineTo(rightX + sigWidth, lineY2).stroke('#666666');
      doc.fontSize(7).text('Firma', rightX, lineY2 + 3, { width: sigWidth, align: 'center' });
    }

    // Footer
    doc.fontSize(7).font('Helvetica').fillColor('#999999')
      .text(
        `Generado automaticamente por MegabingoTV - ${new Date().toISOString()}`,
        margin, doc.page.height - 40,
        { align: 'center', width: pageWidth }
      );

    doc.end();

    stream.on('finish', () => resolve(filepath));
    stream.on('error', reject);
  });
}

export function getMovimientoPdfPath(filename: string): string {
  const sanitized = filename.replace(/[/\\]/g, '').replace(/\.\./g, '');
  const resolved = join(MOVIMIENTOS_DIR, sanitized);
  if (!resolved.startsWith(MOVIMIENTOS_DIR)) {
    throw new Error('Ruta de archivo no permitida');
  }
  return resolved;
}
