import PDFDocument from 'pdfkit';
import { createCanvas } from 'canvas';
import { createWriteStream, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import type { CardNumbers } from '../types/index.js';

const EXPORTS_DIR = join(process.cwd(), 'exports');

// Asegurar que existe el directorio de exports
if (!existsSync(EXPORTS_DIR)) {
  mkdirSync(EXPORTS_DIR, { recursive: true });
}

const COLUMN_COLORS = {
  B: '#ef4444',
  I: '#f97316',
  N: '#eab308',
  G: '#22c55e',
  O: '#3b82f6',
};

const COLUMNS = ['B', 'I', 'N', 'G', 'O'] as const;

interface CardData {
  cardNumber: number;
  cardCode: string;
  validationCode: string;
  numbers: CardNumbers;
  useFreeCenter?: boolean;
}

/**
 * Genera una imagen PNG de un cartón de bingo
 */
export async function generateCardImage(card: CardData): Promise<Buffer> {
  const cellSize = 60;
  const padding = 20;
  const headerHeight = 40;
  const footerHeight = 50;
  const width = cellSize * 5 + padding * 2;
  const height = cellSize * 6 + headerHeight + footerHeight + padding * 2;

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  // Background
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);

  // Border
  ctx.strokeStyle = '#e5e7eb';
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, width - 2, height - 2);

  // Title
  ctx.fillStyle = '#1f2937';
  ctx.font = 'bold 16px Arial';
  ctx.textAlign = 'center';
  ctx.fillText(`Cartón #${card.cardNumber}`, width / 2, padding + 15);

  const startY = padding + headerHeight;

  // Column headers (B-I-N-G-O)
  COLUMNS.forEach((col, i) => {
    const x = padding + i * cellSize;
    const y = startY;

    ctx.fillStyle = COLUMN_COLORS[col];
    ctx.fillRect(x, y, cellSize, cellSize);

    ctx.fillStyle = col === 'N' ? '#1f2937' : '#ffffff';
    ctx.font = 'bold 28px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(col, x + cellSize / 2, y + cellSize / 2);
  });

  // Numbers
  for (let row = 0; row < 5; row++) {
    for (let col = 0; col < 5; col++) {
      const x = padding + col * cellSize;
      const y = startY + cellSize + row * cellSize;

      // Cell background
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(x, y, cellSize, cellSize);

      // Cell border
      ctx.strokeStyle = '#d1d5db';
      ctx.lineWidth = 1;
      ctx.strokeRect(x, y, cellSize, cellSize);

      // Get number
      const useFree = card.useFreeCenter !== false;
      let text: string;
      if (useFree && col === 2 && row === 2) {
        // FREE space
        ctx.fillStyle = '#fef08a';
        ctx.fillRect(x + 1, y + 1, cellSize - 2, cellSize - 2);
        text = 'FREE';
        ctx.fillStyle = '#1f2937';
        ctx.font = 'bold 14px Arial';
      } else {
        const column = COLUMNS[col];
        const numIndex = (useFree && col === 2) ? (row < 2 ? row : row - 1) : row;
        text = card.numbers[column][numIndex].toString();
        ctx.fillStyle = '#1f2937';
        ctx.font = 'bold 20px Arial';
      }

      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, x + cellSize / 2, y + cellSize / 2);
    }
  }

  // Footer with codes
  const footerY = startY + cellSize * 6 + 10;
  ctx.fillStyle = '#6b7280';
  ctx.font = '12px Arial';
  ctx.textAlign = 'center';
  ctx.fillText(`Código: ${card.cardCode}  |  Validación: ${card.validationCode}`, width / 2, footerY + 15);

  return canvas.toBuffer('image/png');
}

/**
 * Genera un PDF con múltiples cartones
 */
export async function generateCardsPDF(
  cards: CardData[],
  options: {
    cardsPerPage?: number;
    pageSize?: 'letter' | 'a4';
    includeValidationCode?: boolean;
  } = {}
): Promise<string> {
  const {
    cardsPerPage = 4,
    pageSize = 'letter',
    includeValidationCode = true,
  } = options;

  const filename = `cartones_${Date.now()}.pdf`;
  const filepath = join(EXPORTS_DIR, filename);

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: pageSize.toUpperCase() as 'LETTER' | 'A4',
      margin: 30,
    });

    const stream = createWriteStream(filepath);
    doc.pipe(stream);

    const pageWidth = doc.page.width - 60;
    const pageHeight = doc.page.height - 60;

    // Calcular dimensiones de cartón según cardsPerPage
    const cols = cardsPerPage === 1 ? 1 : 2;
    const rows = Math.ceil(cardsPerPage / cols);
    const cardWidth = (pageWidth - 20) / cols;
    const cardHeight = (pageHeight - 20) / rows;

    cards.forEach((card, index) => {
      const pageIndex = Math.floor(index / cardsPerPage);
      const positionOnPage = index % cardsPerPage;

      // Nueva página si es necesario
      if (positionOnPage === 0 && index > 0) {
        doc.addPage();
      }

      const col = positionOnPage % cols;
      const row = Math.floor(positionOnPage / cols);
      const x = 30 + col * (cardWidth + 10);
      const y = 30 + row * (cardHeight + 10);

      drawCardOnPDF(doc, card, x, y, cardWidth, cardHeight, includeValidationCode);
    });

    doc.end();

    stream.on('finish', () => resolve(filepath));
    stream.on('error', reject);
  });
}

function drawCardOnPDF(
  doc: PDFKit.PDFDocument,
  card: CardData,
  x: number,
  y: number,
  width: number,
  height: number,
  includeValidationCode: boolean
) {
  const cellSize = Math.min((width - 10) / 5, (height - 60) / 6);
  const gridWidth = cellSize * 5;
  const startX = x + (width - gridWidth) / 2;
  const startY = y + 30;

  // Card border
  doc.rect(x, y, width, height).stroke('#e5e7eb');

  // Title
  doc.fontSize(12)
    .fillColor('#1f2937')
    .text(`Cartón #${card.cardNumber}`, x, y + 8, { width, align: 'center' });

  // Column headers
  COLUMNS.forEach((col, i) => {
    const cellX = startX + i * cellSize;
    doc.rect(cellX, startY, cellSize, cellSize).fill(COLUMN_COLORS[col]);
    doc.fontSize(16)
      .fillColor(col === 'N' ? '#1f2937' : '#ffffff')
      .text(col, cellX, startY + cellSize / 3, { width: cellSize, align: 'center' });
  });

  // Numbers
  for (let row = 0; row < 5; row++) {
    for (let col = 0; col < 5; col++) {
      const cellX = startX + col * cellSize;
      const cellY = startY + cellSize + row * cellSize;

      // Cell border
      doc.rect(cellX, cellY, cellSize, cellSize).stroke('#d1d5db');

      const useFree = card.useFreeCenter !== false;
      let text: string;
      if (useFree && col === 2 && row === 2) {
        doc.rect(cellX + 1, cellY + 1, cellSize - 2, cellSize - 2).fill('#fef08a');
        text = 'FREE';
        doc.fontSize(8);
      } else {
        const column = COLUMNS[col];
        const numIndex = (useFree && col === 2) ? (row < 2 ? row : row - 1) : row;
        text = card.numbers[column][numIndex].toString();
        doc.fontSize(12);
      }

      doc.fillColor('#1f2937')
        .text(text, cellX, cellY + cellSize / 3, { width: cellSize, align: 'center' });
    }
  }

  // Footer
  const footerY = startY + cellSize * 6 + 5;
  doc.fontSize(8)
    .fillColor('#6b7280')
    .text(
      includeValidationCode
        ? `Código: ${card.cardCode} | Validación: ${card.validationCode}`
        : `Código: ${card.cardCode}`,
      x,
      footerY,
      { width, align: 'center' }
    );
}

/**
 * Exporta cartones como imágenes individuales
 */
export async function exportCardsAsImages(cards: CardData[]): Promise<string[]> {
  const files: string[] = [];

  for (const card of cards) {
    const buffer = await generateCardImage(card);
    const filename = `carton_${card.cardNumber}_${card.cardCode}.png`;
    const filepath = join(EXPORTS_DIR, filename);

    const fs = await import('fs/promises');
    await fs.writeFile(filepath, buffer);
    files.push(filepath);
  }

  return files;
}
