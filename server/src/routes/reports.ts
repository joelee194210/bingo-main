import { Router } from 'express';
import type { Request, Response } from 'express';
import { existsSync } from 'fs';
import { resolve } from 'path';
import { getPool } from '../database/init.js';

const LOGO_CANDIDATES = [
  resolve(process.cwd(), 'client/public/logo.png'),
  resolve(process.cwd(), 'client/dist/logo.png'),
  resolve(process.cwd(), 'logo.png'),
  resolve(process.cwd(), '../client/public/logo.png'),
  resolve(process.cwd(), '../client/dist/logo.png'),
  resolve(process.cwd(), '../logo.png'),
];
function getLogoPath(): string {
  return LOGO_CANDIDATES.find(p => existsSync(p)) || '';
}
import {
  generateGameReport,
  generateReportPDF,
  getGameWinners,
  getBallHistory,
  getCardWins,
} from '../services/reportService.js';
import { requirePermission } from '../middleware/auth.js';
import { hasPermission as checkPerm } from '../services/permissionService.js';

const router = Router();

// GET /api/reports/game/:gameId - Obtener reporte de un juego
router.get('/game/:gameId', requirePermission('reports:read'), async (req: Request, res: Response) => {
  try {
    const gameId = parseInt(req.params.gameId as string, 10);
    const pool = getPool();

    const report = await generateGameReport(pool, gameId);

    if (!report) {
      return res.status(404).json({ success: false, error: 'Juego no encontrado' });
    }

    res.json({ success: true, data: report });
  } catch (error) {
    console.error('Error obteniendo reporte:', error);
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

// GET /api/reports/game/:gameId/pdf - Descargar PDF del reporte
router.get('/game/:gameId/pdf', requirePermission('reports:read'), async (req: Request, res: Response) => {
  try {
    const gameId = parseInt(req.params.gameId as string, 10);
    const pool = getPool();

    const report = await generateGameReport(pool, gameId);

    if (!report) {
      return res.status(404).json({ success: false, error: 'Juego no encontrado' });
    }

    const filepath = await generateReportPDF(report);

    res.download(filepath, `reporte_juego_${gameId}.pdf`);
  } catch (error) {
    console.error('Error generando PDF:', error);
    res.status(500).json({ success: false, error: 'Error generando PDF' });
  }
});

// GET /api/reports/game/:gameId/winners - Obtener ganadores de un juego
router.get('/game/:gameId/winners', requirePermission('reports:read'), async (req: Request, res: Response) => {
  try {
    const gameId = parseInt(req.params.gameId as string, 10);
    const pool = getPool();

    const winners = await getGameWinners(pool, gameId);

    res.json({ success: true, data: winners });
  } catch (error) {
    console.error('Error obteniendo ganadores:', error);
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

// GET /api/reports/game/:gameId/balls - Obtener historial de balotas
router.get('/game/:gameId/balls', requirePermission('reports:read'), async (req: Request, res: Response) => {
  try {
    const gameId = parseInt(req.params.gameId as string, 10);
    const pool = getPool();

    const balls = await getBallHistory(pool, gameId);

    res.json({ success: true, data: balls });
  } catch (error) {
    console.error('Error obteniendo historial:', error);
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

// GET /api/reports/card/:cardId/wins - Obtener juegos donde un cartón ganó
router.get('/card/:cardId/wins', requirePermission('reports:read'), async (req: Request, res: Response) => {
  try {
    const cardId = parseInt(req.params.cardId as string, 10);
    const pool = getPool();

    const wins = await getCardWins(pool, cardId);

    res.json({ success: true, data: wins });
  } catch (error) {
    console.error('Error obteniendo victorias:', error);
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

// GET /api/reports/event/:eventId/winners - Todos los ganadores de un evento
router.get('/event/:eventId/winners', requirePermission('reports:read'), async (req: Request, res: Response) => {
  try {
    const eventId = parseInt(req.params.eventId as string, 10);
    const pool = getPool();

    const { rows: winners } = await pool.query(`
      SELECT gw.*, g.name as game_name, g.game_type
      FROM game_winners gw
      JOIN games g ON gw.game_id = g.id
      WHERE g.event_id = $1
      ORDER BY gw.won_at DESC
    `, [eventId]);

    res.json({ success: true, data: winners });
  } catch (error) {
    console.error('Error obteniendo ganadores del evento:', error);
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

// GET /api/reports/recent-winners - Ganadores recientes
router.get('/recent-winners', requirePermission('reports:read'), async (req: Request, res: Response) => {
  try {
    const limit = Math.min(50, parseInt(req.query.limit as string, 10) || 10);
    const pool = getPool();

    const { rows: winners } = await pool.query(`
      SELECT gw.*, g.name as game_name, g.game_type, e.name as event_name
      FROM game_winners gw
      JOIN games g ON gw.game_id = g.id
      JOIN events e ON g.event_id = e.id
      ORDER BY gw.won_at DESC
      LIMIT $1
    `, [limit]);

    res.json({ success: true, data: winners });
  } catch (error) {
    console.error('Error obteniendo ganadores recientes:', error);
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

// =====================================================
// REPORTE DE VENTAS POR ALMACEN / VENDEDOR / RANGO
// =====================================================

router.get('/sales/:eventId', async (req: Request, res: Response) => {
  try {
    const eventId = parseInt(req.params.eventId as string, 10);
    const pool = getPool();
    const desde = req.query.desde as string | undefined;
    const hasta = req.query.hasta as string | undefined;
    const almacen_id = req.query.almacen_id as string | undefined;
    const vendedor_id = req.query.vendedor_id as string | undefined;
    const soloAgencias = req.query.solo_agencias === 'true';
    // tipo: 'todos' (venta+consignacion), 'venta', 'consignacion'. Default 'todos'.
    const tipoQ = (req.query.tipo as string | undefined) || 'todos';
    const accionesIncluidas = tipoQ === 'venta' ? ['venta']
      : tipoQ === 'consignacion' ? ['consignacion']
      : ['venta', 'consignacion'];

    // Verificar permiso según tipo de reporte
    const user = (req as any).user;
    const requiredPerm = soloAgencias ? 'reports:sales_agencias' : 'reports:sales';
    if (!checkPerm(user.role, requiredPerm)) {
      return res.status(403).json({ success: false, error: 'No tienes permisos para ver este reporte' });
    }

    if (!desde || !hasta) {
      return res.status(400).json({ success: false, error: 'Se requiere desde y hasta (YYYY-MM-DD)' });
    }

    let almacenFilter = almacen_id ? parseInt(almacen_id as string, 10) : null;
    let vendedorFilter = vendedor_id ? parseInt(vendedor_id as string, 10) : null;

    // Admin, moderator y loteria ven todo; otros solo sus almacenes y ventas
    const canSeeAllReports = ['admin', 'moderator', 'loteria'].includes(user.role);
    if (!canSeeAllReports) {
      const { rows: misAlm } = await pool.query(
        'SELECT almacen_id FROM almacen_usuarios WHERE user_id = $1 AND is_active = true',
        [user.id]
      );
      const misAlmIds = misAlm.map((a: any) => a.almacen_id);
      if (misAlmIds.length === 0) {
        return res.json({ success: true, data: { resumen: [], detalle: [], totales: { cartones: 0, documentos: 0 } } });
      }
      if (almacenFilter && !misAlmIds.includes(almacenFilter)) {
        return res.status(403).json({ success: false, error: 'No tienes acceso a este almacen' });
      }
      // Forzar solo sus propias ventas (ignorar vendedor_id del query string)
      vendedorFilter = user.id;
    }

    // Filtro para agencias de lotería
    const agenciaFilter = soloAgencias ? 'AND a.es_agencia_loteria = true' : '';

    // 1. Resumen por día y almacen
    const resumenQuery = `
      SELECT
        DATE(c.sold_at) as fecha,
        a.id as almacen_id, a.name as almacen_nombre,
        u.id as vendedor_id, u.full_name as vendedor_nombre,
        COUNT(c.id)::int as cartones_vendidos
      FROM cards c
      JOIN almacenes a ON c.almacen_id = a.id
      LEFT JOIN users u ON c.sold_by = u.id
      WHERE c.event_id = $1
        AND c.is_sold = true
        AND DATE(c.sold_at) BETWEEN $2 AND $3
        ${agenciaFilter}
        ${almacenFilter ? 'AND c.almacen_id = $4' : ''}
        ${vendedorFilter ? `AND c.sold_by = $${almacenFilter ? 5 : 4}` : ''}
      GROUP BY DATE(c.sold_at), a.id, a.name, u.id, u.full_name
      ORDER BY fecha DESC, almacen_nombre, vendedor_nombre
    `;
    const resumenParams: any[] = [eventId, desde, hasta];
    if (almacenFilter) resumenParams.push(almacenFilter);
    if (vendedorFilter) resumenParams.push(vendedorFilter);

    const { rows: resumen } = await pool.query(resumenQuery, resumenParams);

    // 2. Detalle de documentos de venta y/o consignación en el rango
    const detalleQuery = `
      SELECT
        d.id as documento_id, d.created_at as fecha, d.accion as tipo,
        a.id as almacen_id, a.name as almacen_nombre,
        d.a_nombre as comprador, d.a_cedula as cedula, d.a_libreta as libreta,
        d.total_items, d.total_cartones,
        u.id as vendedor_id, u.full_name as vendedor_nombre,
        d.pdf_path,
        json_agg(json_build_object(
          'tipo', m.tipo_entidad,
          'referencia', m.referencia,
          'cantidad', m.cantidad_cartones
        ) ORDER BY m.id) as items
      FROM inv_documentos d
      JOIN inv_movimientos m ON m.documento_id = d.id
      LEFT JOIN almacenes a ON d.de_almacen_id = a.id
      LEFT JOIN users u ON d.realizado_por = u.id
      WHERE d.event_id = $1
        AND d.accion = ANY($${almacenFilter && vendedorFilter ? 6 : almacenFilter || vendedorFilter ? 5 : 4})
        AND DATE(d.created_at) BETWEEN $2 AND $3
        ${soloAgencias ? 'AND a.es_agencia_loteria = true' : ''}
        ${almacenFilter ? 'AND d.de_almacen_id = $4' : ''}
        ${vendedorFilter ? `AND d.realizado_por = $${almacenFilter ? 5 : 4}` : ''}
      GROUP BY d.id, a.id, a.name, u.id, u.full_name
      ORDER BY d.created_at DESC
    `;
    const detalleParams = [...resumenParams, accionesIncluidas];
    const { rows: detalle } = await pool.query(detalleQuery, detalleParams);

    // 3. Devoluciones en el rango (para restar de totales)
    const devolucionesQuery = `
      SELECT COALESCE(SUM(m.cantidad_cartones), 0)::int as cartones_devueltos,
             COUNT(DISTINCT d.id)::int as documentos_devolucion
      FROM inv_documentos d
      JOIN inv_movimientos m ON m.documento_id = d.id
      LEFT JOIN almacenes a ON d.a_almacen_id = a.id
      WHERE d.event_id = $1
        AND d.accion = 'devolucion'
        AND DATE(d.created_at) BETWEEN $2 AND $3
        ${soloAgencias ? 'AND a.es_agencia_loteria = true' : ''}
        ${almacenFilter ? 'AND d.a_almacen_id = $4' : ''}
        ${vendedorFilter ? `AND d.realizado_por = $${almacenFilter ? 5 : 4}` : ''}
    `;
    const { rows: devRows } = await pool.query(devolucionesQuery, resumenParams);
    const devoluciones = devRows[0] || { cartones_devueltos: 0, documentos_devolucion: 0 };

    // 4. Totales — el resumen ya cuenta is_sold=true al momento de la consulta,
    // por lo que devoluciones procesadas dentro del rango ya están descontadas
    // implícitamente (esos cards ya no tienen is_sold=true). Reportamos aparte
    // para visibilidad.
    const totalCartones = resumen.reduce((sum: number, r: any) => sum + r.cartones_vendidos, 0);

    res.json({
      success: true,
      data: {
        resumen,
        detalle,
        devoluciones,
        totales: {
          cartones: totalCartones,
          documentos: detalle.length,
        },
      },
    });
  } catch (error) {
    console.error('Error generando reporte de ventas:', error);
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

// GET /api/reports/sales/:eventId/pdf — Generar PDF del reporte de ventas
router.get('/sales/:eventId/pdf', async (req: Request, res: Response) => {
  try {
    const eventId = parseInt(req.params.eventId as string, 10);
    const pool = getPool();
    const desde = req.query.desde as string | undefined;
    const hasta = req.query.hasta as string | undefined;
    const almacen_id = req.query.almacen_id as string | undefined;
    const vendedor_id = req.query.vendedor_id as string | undefined;
    const soloAgencias = req.query.solo_agencias === 'true';

    // Verificar permiso según tipo de reporte
    const user = (req as any).user;
    const requiredPerm = soloAgencias ? 'reports:sales_agencias' : 'reports:sales';
    if (!checkPerm(user.role, requiredPerm)) {
      return res.status(403).json({ success: false, error: 'No tienes permisos para ver este reporte' });
    }

    if (!desde || !hasta) {
      return res.status(400).json({ success: false, error: 'Se requiere desde y hasta' });
    }

    let almacenFilter = almacen_id ? parseInt(almacen_id as string, 10) : null;
    let vendedorFilter = vendedor_id ? parseInt(vendedor_id as string, 10) : null;

    const canSeeAllPdf = ['admin', 'moderator', 'loteria'].includes(user.role);
    if (!canSeeAllPdf) {
      const { rows: misAlm } = await pool.query(
        'SELECT almacen_id FROM almacen_usuarios WHERE user_id = $1 AND is_active = true', [user.id]
      );
      const misAlmIds = misAlm.map((a: any) => a.almacen_id);
      if (misAlmIds.length === 0) {
        return res.status(403).json({ success: false, error: 'Sin almacenes asignados' });
      }
      if (almacenFilter && !misAlmIds.includes(almacenFilter)) {
        return res.status(403).json({ success: false, error: 'No tienes acceso a este almacen' });
      }
      vendedorFilter = user.id;
    }

    const agenciaFilter = soloAgencias ? 'AND a.es_agencia_loteria = true' : '';

    // Obtener evento
    const { rows: [evento] } = await pool.query('SELECT name FROM events WHERE id = $1', [eventId]);
    if (!evento) return res.status(404).json({ success: false, error: 'Evento no encontrado' });

    // Datos para el PDF
    const resumenParams: any[] = [eventId, desde, hasta];
    if (almacenFilter) resumenParams.push(almacenFilter);
    if (vendedorFilter) resumenParams.push(vendedorFilter);

    const { rows: resumen } = await pool.query(`
      SELECT
        DATE(c.sold_at) as fecha,
        a.name as almacen_nombre,
        u.full_name as vendedor_nombre,
        COUNT(c.id)::int as cartones_vendidos
      FROM cards c
      JOIN almacenes a ON c.almacen_id = a.id
      LEFT JOIN users u ON c.sold_by = u.id
      WHERE c.event_id = $1 AND c.is_sold = true AND DATE(c.sold_at) BETWEEN $2 AND $3
        ${agenciaFilter}
        ${almacenFilter ? 'AND c.almacen_id = $4' : ''}
        ${vendedorFilter ? `AND c.sold_by = $${almacenFilter ? 5 : 4}` : ''}
      GROUP BY DATE(c.sold_at), a.name, u.full_name
      ORDER BY fecha DESC, almacen_nombre
    `, resumenParams);

    const { rows: docRows } = await pool.query(`
      SELECT d.created_at as fecha, a.name as almacen_nombre,
        d.a_nombre as comprador, d.a_cedula as cedula,
        d.total_items, d.total_cartones,
        u.full_name as vendedor_nombre
      FROM inv_documentos d
      LEFT JOIN almacenes a ON d.de_almacen_id = a.id
      LEFT JOIN users u ON d.realizado_por = u.id
      WHERE d.event_id = $1 AND d.accion = 'venta' AND DATE(d.created_at) BETWEEN $2 AND $3
        ${soloAgencias ? 'AND a.es_agencia_loteria = true' : ''}
        ${almacenFilter ? 'AND d.de_almacen_id = $4' : ''}
        ${vendedorFilter ? `AND d.realizado_por = $${almacenFilter ? 5 : 4}` : ''}
      ORDER BY d.created_at DESC
    `, resumenParams);

    const totalCartones = resumen.reduce((sum: number, r: any) => sum + r.cartones_vendidos, 0);

    // Generar PDF
    const PDFDocument = (await import('pdfkit')).default;
    const doc = new PDFDocument({ size: 'LETTER', margin: 50 });

    const filename = `reporte_ventas_${(desde as string).replace(/-/g, '')}_${(hasta as string).replace(/-/g, '')}.pdf`;
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/pdf');
    doc.pipe(res);

    const pageWidth = doc.page.width - 100;
    const margin = 50;

    // Header
    const salesLogoFile = getLogoPath();
    if (salesLogoFile) {
      try { doc.image(salesLogoFile, doc.page.width / 2 - 40, 30, { width: 80 }); } catch {}
      doc.moveDown(4);
    }
    doc.fontSize(14).font('Helvetica-Bold').text(soloAgencias ? 'REPORTE DE VENTAS - AGENCIAS LOTERIA' : 'REPORTE DE VENTAS', { align: 'center' });
    doc.moveDown(0.3);
    doc.fontSize(10).font('Helvetica').text(evento.name, { align: 'center' });
    doc.moveDown(0.2);
    doc.fontSize(9).text(`Periodo: ${desde} al ${hasta}`, { align: 'center' });
    doc.moveDown(0.5);
    doc.moveTo(margin, doc.y).lineTo(margin + pageWidth, doc.y).stroke('#cccccc');
    doc.moveDown(0.5);

    // Totales
    const totY = doc.y;
    doc.rect(margin, totY, pageWidth, 30).fill('#f0f4f8');
    doc.fillColor('#333').fontSize(10).font('Helvetica-Bold');
    doc.text(`Total Cartones Vendidos: ${totalCartones.toLocaleString()}`, margin + 10, totY + 5);
    doc.text(`Total Documentos: ${docRows.length}`, margin + 10, totY + 17);
    doc.y = totY + 38;

    // Tabla resumen por día
    doc.fontSize(11).font('Helvetica-Bold').text('Resumen por Dia');
    doc.moveDown(0.3);

    const rHeaderY = doc.y;
    doc.rect(margin, rHeaderY, pageWidth, 16).fill('#e8edf2');
    doc.fillColor('#333').fontSize(8).font('Helvetica-Bold');
    doc.text('Fecha', margin + 5, rHeaderY + 4, { width: 90 });
    doc.text('Almacen', margin + 100, rHeaderY + 4, { width: 140 });
    doc.text('Vendedor', margin + 245, rHeaderY + 4, { width: 140 });
    doc.text('Cartones', margin + 390, rHeaderY + 4, { width: 70, align: 'right' });
    doc.y = rHeaderY + 18;

    doc.font('Helvetica').fontSize(8);
    for (let i = 0; i < resumen.length; i++) {
      if (doc.y > doc.page.height - 120) doc.addPage();
      const r = resumen[i];
      const rowY = doc.y;
      if (i % 2 === 0) { doc.rect(margin, rowY - 1, pageWidth, 13).fill('#fafafa'); doc.fillColor('#333'); }
      const fechaStr = new Date(r.fecha).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' });
      doc.text(fechaStr, margin + 5, rowY + 1, { width: 90 });
      doc.text(r.almacen_nombre || '-', margin + 100, rowY + 1, { width: 140 });
      doc.text(r.vendedor_nombre || '-', margin + 245, rowY + 1, { width: 140 });
      doc.text(r.cartones_vendidos.toLocaleString(), margin + 390, rowY + 1, { width: 70, align: 'right' });
      doc.y = rowY + 13;
    }

    // Fila de totales del resumen por día
    if (resumen.length > 0) {
      if (doc.y > doc.page.height - 80) doc.addPage();
      const rTotY = doc.y + 2;
      doc.rect(margin, rTotY - 1, pageWidth, 14).fill('#e8edf2');
      doc.fillColor('#333').fontSize(8).font('Helvetica-Bold');
      doc.text('TOTAL', margin + 5, rTotY + 2, { width: 200 });
      doc.text(totalCartones.toLocaleString(), margin + 390, rTotY + 2, { width: 70, align: 'right' });
      doc.y = rTotY + 16;
      doc.font('Helvetica').fontSize(8);
    }

    // Detalle de documentos
    doc.moveDown(1);
    if (doc.y > doc.page.height - 180) doc.addPage();
    doc.fontSize(11).font('Helvetica-Bold').fillColor('#333').text('Detalle de Documentos de Venta');
    doc.moveDown(0.3);

    const drawDetalleHeader = () => {
      const hY = doc.y;
      doc.rect(margin, hY, pageWidth, 16).fill('#e8edf2');
      doc.fillColor('#333').fontSize(7).font('Helvetica-Bold');
      doc.text('Fecha', margin + 5, hY + 4, { width: 70 });
      doc.text('Almacen', margin + 80, hY + 4, { width: 90 });
      doc.text('Comprador', margin + 175, hY + 4, { width: 110 });
      doc.text('Cedula', margin + 290, hY + 4, { width: 65 });
      doc.text('Items', margin + 360, hY + 4, { width: 40, align: 'right' });
      doc.text('Cartones', margin + 405, hY + 4, { width: 55, align: 'right' });
      doc.y = hY + 18;
      doc.font('Helvetica').fontSize(7);
    };

    drawDetalleHeader();
    let totalCartonesDetalle = 0;
    for (let i = 0; i < docRows.length; i++) {
      if (doc.y > doc.page.height - 80) { doc.addPage(); drawDetalleHeader(); }
      const d = docRows[i];
      const rowY = doc.y;
      if (i % 2 === 0) { doc.rect(margin, rowY - 1, pageWidth, 12).fill('#fafafa'); doc.fillColor('#333'); }
      const fechaStr = new Date(d.fecha).toLocaleString('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
      const comprador = (d.comprador || '-').length > 22 ? (d.comprador || '-').substring(0, 22) + '...' : (d.comprador || '-');
      doc.text(fechaStr, margin + 5, rowY + 1, { width: 70 });
      doc.text((d.almacen_nombre || '-').substring(0, 18), margin + 80, rowY + 1, { width: 90 });
      doc.text(comprador, margin + 175, rowY + 1, { width: 110 });
      doc.text(d.cedula || '-', margin + 290, rowY + 1, { width: 65 });
      doc.text((d.total_items || 0).toString(), margin + 360, rowY + 1, { width: 40, align: 'right' });
      doc.text((d.total_cartones || 0).toLocaleString(), margin + 405, rowY + 1, { width: 55, align: 'right' });
      totalCartonesDetalle += d.total_cartones || 0;
      doc.y = rowY + 12;
    }

    // Fila de totales al final de la tabla de documentos
    if (docRows.length > 0) {
      if (doc.y > doc.page.height - 80) doc.addPage();
      const totRowY = doc.y + 2;
      doc.rect(margin, totRowY - 1, pageWidth, 14).fill('#e8edf2');
      doc.fillColor('#333').fontSize(7).font('Helvetica-Bold');
      doc.text('TOTALES', margin + 5, totRowY + 2, { width: 200 });
      doc.text(`${docRows.length}`, margin + 360, totRowY + 2, { width: 40, align: 'right' });
      doc.text(totalCartonesDetalle.toLocaleString(), margin + 405, totRowY + 2, { width: 55, align: 'right' });
      doc.y = totRowY + 16;
    }

    // Footer con fecha y hora legible
    const ahora = new Date();
    const fechaReporte = ahora.toLocaleDateString('es-ES', { day: '2-digit', month: 'long', year: 'numeric' });
    const horaReporte = ahora.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    doc.fontSize(7).font('Helvetica').fillColor('#999')
      .text(`Generado por MegabingoTV — ${fechaReporte} a las ${horaReporte}`, margin, doc.page.height - 40, { align: 'center', width: pageWidth });

    doc.end();
  } catch (error) {
    console.error('Error generando PDF de ventas:', error);
    if (!res.headersSent) {
      res.status(500).json({ success: false, error: (error as Error).message });
    }
  }
});

export default router;
