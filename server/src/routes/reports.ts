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

const router = Router();

// GET /api/reports/game/:gameId - Obtener reporte de un juego
router.get('/game/:gameId', async (req: Request, res: Response) => {
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
router.get('/game/:gameId/pdf', async (req: Request, res: Response) => {
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
router.get('/game/:gameId/winners', async (req: Request, res: Response) => {
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
router.get('/game/:gameId/balls', async (req: Request, res: Response) => {
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
router.get('/card/:cardId/wins', async (req: Request, res: Response) => {
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
router.get('/event/:eventId/winners', async (req: Request, res: Response) => {
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
router.get('/recent-winners', async (req: Request, res: Response) => {
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

    if (!desde || !hasta) {
      return res.status(400).json({ success: false, error: 'Se requiere desde y hasta (YYYY-MM-DD)' });
    }

    // Verificar permisos: si no es admin/moderator, solo ve sus almacenes
    const user = (req as any).user;
    let almacenFilter = almacen_id ? parseInt(almacen_id as string, 10) : null;
    let vendedorFilter = vendedor_id ? parseInt(vendedor_id as string, 10) : null;

    // Si es seller/loteria/inventory sin admin, restringir a sus almacenes
    if (!['admin', 'moderator'].includes(user.role)) {
      const { rows: misAlm } = await pool.query(
        'SELECT almacen_id FROM almacen_usuarios WHERE user_id = $1 AND is_active = true',
        [user.id]
      );
      const misAlmIds = misAlm.map((a: any) => a.almacen_id);
      if (misAlmIds.length === 0) {
        return res.json({ success: true, data: { resumen: [], detalle: [], totales: { cartones: 0, documentos: 0 } } });
      }
      // Si pide un almacen, validar que sea suyo
      if (almacenFilter && !misAlmIds.includes(almacenFilter)) {
        return res.status(403).json({ success: false, error: 'No tienes acceso a este almacen' });
      }
      // Si no es admin, solo ve sus propias ventas
      if (!vendedorFilter) vendedorFilter = user.id;
    }

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
        ${almacenFilter ? 'AND c.almacen_id = $4' : ''}
        ${vendedorFilter ? `AND c.sold_by = $${almacenFilter ? 5 : 4}` : ''}
      GROUP BY DATE(c.sold_at), a.id, a.name, u.id, u.full_name
      ORDER BY fecha DESC, almacen_nombre, vendedor_nombre
    `;
    const resumenParams: any[] = [eventId, desde, hasta];
    if (almacenFilter) resumenParams.push(almacenFilter);
    if (vendedorFilter) resumenParams.push(vendedorFilter);

    const { rows: resumen } = await pool.query(resumenQuery, resumenParams);

    // 2. Detalle de documentos de venta en el rango
    const detalleQuery = `
      SELECT
        d.id as documento_id, d.created_at as fecha,
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
        AND d.accion = 'venta'
        AND DATE(d.created_at) BETWEEN $2 AND $3
        ${almacenFilter ? 'AND d.de_almacen_id = $4' : ''}
        ${vendedorFilter ? `AND d.realizado_por = $${almacenFilter ? 5 : 4}` : ''}
      GROUP BY d.id, a.id, a.name, u.id, u.full_name
      ORDER BY d.created_at DESC
    `;
    const { rows: detalle } = await pool.query(detalleQuery, resumenParams);

    // 3. Totales
    const totalCartones = resumen.reduce((sum: number, r: any) => sum + r.cartones_vendidos, 0);

    res.json({
      success: true,
      data: {
        resumen,
        detalle,
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

    if (!desde || !hasta) {
      return res.status(400).json({ success: false, error: 'Se requiere desde y hasta' });
    }

    const user = (req as any).user;
    let almacenFilter = almacen_id ? parseInt(almacen_id as string, 10) : null;
    let vendedorFilter = vendedor_id ? parseInt(vendedor_id as string, 10) : null;

    if (!['admin', 'moderator'].includes(user.role)) {
      const { rows: misAlm } = await pool.query(
        'SELECT almacen_id FROM almacen_usuarios WHERE user_id = $1 AND is_active = true', [user.id]
      );
      const misAlmIds = misAlm.map((a: any) => a.almacen_id);
      if (almacenFilter && !misAlmIds.includes(almacenFilter)) {
        return res.status(403).json({ success: false, error: 'No tienes acceso a este almacen' });
      }
      if (!vendedorFilter) vendedorFilter = user.id;
    }

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
    doc.fontSize(14).font('Helvetica-Bold').text('REPORTE DE VENTAS', { align: 'center' });
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

    // Detalle de documentos
    doc.moveDown(1);
    if (doc.y > doc.page.height - 180) doc.addPage();
    doc.fontSize(11).font('Helvetica-Bold').fillColor('#333').text('Detalle de Documentos de Venta');
    doc.moveDown(0.3);

    const dHeaderY = doc.y;
    doc.rect(margin, dHeaderY, pageWidth, 16).fill('#e8edf2');
    doc.fillColor('#333').fontSize(7).font('Helvetica-Bold');
    doc.text('Fecha', margin + 5, dHeaderY + 4, { width: 70 });
    doc.text('Almacen', margin + 80, dHeaderY + 4, { width: 100 });
    doc.text('Comprador', margin + 185, dHeaderY + 4, { width: 100 });
    doc.text('Cedula', margin + 290, dHeaderY + 4, { width: 65 });
    doc.text('Items', margin + 360, dHeaderY + 4, { width: 40, align: 'right' });
    doc.text('Cartones', margin + 405, dHeaderY + 4, { width: 55, align: 'right' });
    doc.y = dHeaderY + 18;

    doc.font('Helvetica').fontSize(7);
    for (let i = 0; i < docRows.length; i++) {
      if (doc.y > doc.page.height - 80) doc.addPage();
      const d = docRows[i];
      const rowY = doc.y;
      if (i % 2 === 0) { doc.rect(margin, rowY - 1, pageWidth, 12).fill('#fafafa'); doc.fillColor('#333'); }
      const fechaStr = new Date(d.fecha).toLocaleString('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
      doc.text(fechaStr, margin + 5, rowY + 1, { width: 70 });
      doc.text(d.almacen_nombre || '-', margin + 80, rowY + 1, { width: 100 });
      doc.text(d.comprador || '-', margin + 185, rowY + 1, { width: 100 });
      doc.text(d.cedula || '-', margin + 290, rowY + 1, { width: 65 });
      doc.text((d.total_items || 0).toString(), margin + 360, rowY + 1, { width: 40, align: 'right' });
      doc.text((d.total_cartones || 0).toLocaleString(), margin + 405, rowY + 1, { width: 55, align: 'right' });
      doc.y = rowY + 12;
    }

    // Footer
    doc.fontSize(7).font('Helvetica').fillColor('#999')
      .text(`Generado por MegabingoTV - ${new Date().toISOString()}`, margin, doc.page.height - 40, { align: 'center', width: pageWidth });

    doc.end();
  } catch (error) {
    console.error('Error generando PDF de ventas:', error);
    if (!res.headersSent) {
      res.status(500).json({ success: false, error: (error as Error).message });
    }
  }
});

export default router;
