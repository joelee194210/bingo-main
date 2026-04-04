import PDFDocument from 'pdfkit';
import { createWriteStream, existsSync, mkdirSync, readFileSync } from 'fs';
import { join, resolve } from 'path';
import bwipjs from 'bwip-js';
import QRCode from 'qrcode';

const EXPORTS_DIR = join(process.cwd(), 'exports');
if (!existsSync(EXPORTS_DIR)) {
  mkdirSync(EXPORTS_DIR, { recursive: true });
}

function findAsset(name: string): string {
  const candidates = [
    resolve(__dirname, '..', 'assets', name),
    resolve(__dirname, 'assets', name),
    resolve(process.cwd(), 'src', 'assets', name),
    resolve(process.cwd(), 'assets', name),
    resolve(process.cwd(), 'server', 'src', 'assets', name),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  throw new Error(`Asset ${name} no encontrado en: ${candidates.join(', ')}`);
}

interface CardNumbers { B: number[]; I: number[]; N: number[]; G: number[]; O: number[]; }

export interface DigitalCardData {
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

// Coordenadas exactas en la plantilla 480x816
const COL_X = [74, 149, 225, 300, 376];
const COL_W = [75, 76, 75, 76, 74];
const ROW_Y = [285, 361, 436, 512, 588];
const ROW_H = [75, 75, 76, 76, 63];

const T = {
  serial: { x: 15, y: 5 },
  raspadito: { x: 12, y: 750, w: 161, h: 30 },
  qr: { x: 9, y: 633, size: 58 },
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

export async function generateDigitalPDF(cards: DigitalCardData[]): Promise<string> {
  const filename = `carton_digital_${Date.now()}.pdf`;
  const filepath = join(EXPORTS_DIR, filename);

  const templateBuf = readFileSync(findAsset('carton_template.png'));
  const instruccionesBuf = readFileSync(findAsset('carton_instrucciones.png'));

  const pageW = 960;
  const pageH = 816;
  const imgW = 480;
  const imgH = 816;

  return new Promise((resolvePromise, reject) => {
    const doc = new PDFDocument({ size: [pageW, pageH], margin: 0 });
    const stream = createWriteStream(filepath);
    doc.pipe(stream);

    let isFirst = true;

    (async () => {
      for (const card of cards) {
        if (!isFirst) doc.addPage({ size: [pageW, pageH], margin: 0 });
        isFirst = false;

        // === LADO IZQUIERDO: Cartón ===
        doc.image(templateBuf, 0, 0, { width: imgW, height: imgH });

        // Serial + barcode arriba izquierda
        doc.fontSize(14).fillColor('#1a1a1a').font('Helvetica-Bold')
          .text(card.serial, 19, 8, { width: 83, align: 'center' });

        try {
          const bc = await generateBarcode(card.serial);
          doc.image(bc, 26, 24, { width: 70, height: 14 });
        } catch { /* barcode optional */ }

        // Números del grid
        for (let col = 0; col < 5; col++) {
          const column = COLUMNS[col];
          const nums = card.numbers[column];

          for (let row = 0; row < 5; row++) {
            const useFree = card.useFreeCenter !== false;
            if (useFree && col === 2 && row === 2) continue;

            const numIndex = (useFree && col === 2) ? (row < 2 ? row : row - 1) : row;
            const num = nums[numIndex];
            if (num === undefined) continue;

            const cx = COL_X[col] + COL_W[col] / 2;
            const cy = ROW_Y[row] + ROW_H[row] / 2 - 9;

            doc.fontSize(26).fillColor('#1a1a1a').font('Helvetica-Bold')
              .text(String(num), cx - 30, cy - 2, { width: 60, align: 'center' });
          }
        }

        // Raspadito
        if (card.prizeName) {
          doc.fontSize(11).fillColor('#222222').font('Helvetica-Bold')
            .text(card.prizeName, T.raspadito.x, T.raspadito.y + 14, {
              width: T.raspadito.w, align: 'center',
            });
        }

        // QR verificación
        try {
          const qrUrl = `${VERIFY_BASE_URL}/${card.cardCode}`;
          const qrBuf = await generateQR(qrUrl);
          doc.image(qrBuf, T.qr.x, T.qr.y, { width: T.qr.size, height: T.qr.size });
        } catch { /* qr optional */ }

        // Serial abajo derecha
        doc.rect(T.serialBottom.x, T.serialBottom.y + 1, T.serialBottom.w, 18).fill('#ffffff');
        doc.fontSize(13).fillColor('#1a1a1a').font('Helvetica-Bold')
          .text(card.serial, T.serialBottom.x, T.serialBottom.y + 3, { width: T.serialBottom.w, align: 'center' });

        // === LADO DERECHO: Instrucciones ===
        doc.image(instruccionesBuf, imgW, 0, { width: imgW, height: imgH });
      }

      doc.end();
    })().catch(reject);

    stream.on('finish', () => resolvePromise(filepath));
    stream.on('error', reject);
  });
}
