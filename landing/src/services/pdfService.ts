import PDFDocument from 'pdfkit';
import { createWriteStream, existsSync, mkdirSync, readFileSync } from 'fs';
import { join, resolve } from 'path';
import bwipjs from 'bwip-js';
import QRCode from 'qrcode';

const EXPORTS_DIR = process.env.EXPORTS_DIR
  ?? (process.env.NODE_ENV === 'production' ? '/app/exports' : join(process.cwd(), 'exports'));
if (!existsSync(EXPORTS_DIR)) {
  mkdirSync(EXPORTS_DIR, { recursive: true });
}

function findAsset(name: string): string {
  const thisDir = import.meta.dirname || __dirname;
  const candidates = [
    resolve(thisDir, '..', 'assets', name),
    resolve(thisDir, 'assets', name),
    resolve(process.cwd(), 'src', 'assets', name),
    resolve(process.cwd(), 'assets', name),
    resolve(process.cwd(), 'landing', 'src', 'assets', name),
    resolve(process.cwd(), name),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  throw new Error(`Asset ${name} no encontrado en: ${candidates.join(', ')}`);
}

interface CardNumbers { B: number[]; I: number[]; N: number[]; G: number[]; O: number[]; }

export interface CardData {
  cardNumber: number;
  cardCode: string;
  validationCode: string;
  serial: string;
  numbers: CardNumbers;
  useFreeCenter?: boolean;
  prizeName?: string;
}

const COLUMNS = ['B', 'I', 'N', 'G', 'O'] as const;
const VERIFY_BASE_URL = process.env.VERIFY_URL || 'https://verificatubingo.com/verificar';

// Coordenadas exactas en la plantilla 480x816 (detectadas por análisis de píxeles)
const COL_X = [74, 149, 225, 300, 376]; // inicio x de cada columna
const COL_W = [75, 76, 75, 76, 74];      // ancho de cada columna
const ROW_Y = [285, 361, 436, 512, 588]; // inicio y de cada fila
const ROW_H = [75, 75, 76, 76, 63];      // alto de cada fila

const T = {
  // Serial + barcode arriba izquierda
  serial: { x: 15, y: 5 },
  // Raspadito (recuadro gris: x=12-173, y=750-779, 161x30)
  raspadito: { x: 12, y: 750, w: 161, h: 30 },
  // QR — cuadro blanco inferior izquierdo (x=10-68, y=638-695 = 58x57)
  qr: { x: 9, y: 633, size: 58 },
  // Serial abajo derecha — el PDF dibuja un rect blanco de 20px sobre el cuadro original
  serialBottom: { x: 327, y: 723, w: 142 },
};

async function generateBarcode(text: string): Promise<Buffer> {
  return bwipjs.toBuffer({
    bcid: 'code128',
    text,
    scale: 2,
    height: 8,
    includetext: false,
  });
}

async function generateQR(url: string): Promise<Buffer> {
  return QRCode.toBuffer(url, {
    width: 200,
    margin: 0,
    errorCorrectionLevel: 'M',
  });
}

export async function generateCardsPDF(
  cards: CardData[],
  _options: { cardsPerPage?: number } = {}
): Promise<string> {
  const filename = `cartones_${Date.now()}.pdf`;
  const filepath = join(EXPORTS_DIR, filename);

  const templateBuf = readFileSync(findAsset('carton_template.png'));
  const instruccionesBuf = readFileSync(findAsset('carton_instrucciones.png'));

  // Carta apaisado: 792x612 pts (8.5"x11" landscape)
  const pageW = 792;
  const pageH = 612;
  // Escalar plantilla 480x816 para caber en mitad de página (altura = 612)
  const scale = pageH / 816; // 0.75
  const imgW = Math.round(480 * scale); // 360
  const imgH = pageH; // 612
  const marginLeft = Math.round((pageW - imgW * 2) / 2); // centrar horizontalmente

  return new Promise((resolvePromise, reject) => {
    const doc = new PDFDocument({ size: [pageW, pageH], margin: 0 });
    const stream = createWriteStream(filepath);
    doc.pipe(stream);

    let isFirst = true;

    (async () => {
      for (const card of cards) {
        if (!isFirst) doc.addPage({ size: [pageW, pageH], margin: 0 });
        isFirst = false;

        // Helper: escalar coordenada + offset del margen izquierdo
        const sx = (v: number) => marginLeft + Math.round(v * scale);
        const sy = (v: number) => Math.round(v * scale);
        const ss = (v: number) => Math.round(v * scale);

        // === LADO IZQUIERDO: Cartón ===
        doc.image(templateBuf, marginLeft, 0, { width: imgW, height: imgH });

        // Serial + barcode arriba izquierda
        doc.fontSize(ss(14)).fillColor('#1a1a1a').font('Helvetica-Bold')
          .text(card.serial, sx(19), sy(8), { width: ss(83), align: 'center' });

        try {
          const bc = await generateBarcode(card.serial);
          doc.image(bc, sx(26), sy(24), { width: ss(70), height: ss(14) });
        } catch { /* barcode optional */ }

        // Números del grid (coordenadas escaladas)
        for (let col = 0; col < 5; col++) {
          const column = COLUMNS[col];
          const nums = card.numbers[column];

          for (let row = 0; row < 5; row++) {
            const useFree = card.useFreeCenter !== false;
            if (useFree && col === 2 && row === 2) continue; // FREE center

            const numIndex = (useFree && col === 2) ? (row < 2 ? row : row - 1) : row;
            const num = nums[numIndex];
            if (num === undefined) continue;

            const cx = sx(COL_X[col] + COL_W[col] / 2);
            const cy = sy(ROW_Y[row] + ROW_H[row] / 2 - 9);

            doc.fontSize(ss(26)).fillColor('#1a1a1a').font('Helvetica-Bold')
              .text(String(num), cx - ss(30), cy - ss(2), { width: ss(60), align: 'center' });
          }
        }

        // Raspadito
        if (card.prizeName) {
          doc.fontSize(ss(11)).fillColor('#222222').font('Helvetica-Bold')
            .text(card.prizeName, sx(T.raspadito.x), sy(T.raspadito.y + 14), {
              width: ss(T.raspadito.w), align: 'center',
            });
        }

        // QR verificación
        try {
          const qrUrl = `${VERIFY_BASE_URL}/${card.cardCode}`;
          const qrBuf = await generateQR(qrUrl);
          doc.image(qrBuf, sx(T.qr.x), sy(T.qr.y), { width: ss(T.qr.size), height: ss(T.qr.size) });
        } catch { /* qr optional */ }

        // Serial abajo derecha
        doc.rect(sx(T.serialBottom.x), sy(T.serialBottom.y + 1), ss(T.serialBottom.w), ss(18)).fill('#ffffff');
        doc.fontSize(ss(13)).fillColor('#1a1a1a').font('Helvetica-Bold')
          .text(card.serial, sx(T.serialBottom.x), sy(T.serialBottom.y + 3), { width: ss(T.serialBottom.w), align: 'center' });

        // === LADO DERECHO: Instrucciones ===
        doc.image(instruccionesBuf, marginLeft + imgW, 0, { width: imgW, height: imgH });
      }

      doc.end();
    })().catch(reject);

    stream.on('finish', () => resolvePromise(filepath));
    stream.on('error', reject);
  });
}
