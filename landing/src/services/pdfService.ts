import PDFDocument from 'pdfkit';
import { createWriteStream, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

const EXPORTS_DIR = join(process.cwd(), 'exports');
if (!existsSync(EXPORTS_DIR)) {
  mkdirSync(EXPORTS_DIR, { recursive: true });
}

const COLUMN_COLORS: Record<string, string> = {
  B: '#ef4444', I: '#f97316', N: '#eab308', G: '#22c55e', O: '#3b82f6',
};
const COLUMNS = ['B', 'I', 'N', 'G', 'O'] as const;

interface CardNumbers { B: number[]; I: number[]; N: number[]; G: number[]; O: number[]; }

export interface CardData {
  cardNumber: number;
  cardCode: string;
  validationCode: string;
  numbers: CardNumbers;
  useFreeCenter?: boolean;
}

export async function generateCardsPDF(
  cards: CardData[],
  options: { cardsPerPage?: number; pageSize?: 'letter' | 'a4' } = {}
): Promise<string> {
  const { cardsPerPage = 4, pageSize = 'letter' } = options;
  const filename = `cartones_${Date.now()}.pdf`;
  const filepath = join(EXPORTS_DIR, filename);

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: pageSize.toUpperCase() as 'LETTER' | 'A4', margin: 30 });
    const stream = createWriteStream(filepath);
    doc.pipe(stream);

    const pageWidth = doc.page.width - 60;
    const pageHeight = doc.page.height - 60;
    const cols = cardsPerPage === 1 ? 1 : 2;
    const rows = Math.ceil(cardsPerPage / cols);
    const cardWidth = (pageWidth - 20) / cols;
    const cardHeight = (pageHeight - 20) / rows;

    cards.forEach((card, index) => {
      const positionOnPage = index % cardsPerPage;
      if (positionOnPage === 0 && index > 0) doc.addPage();

      const col = positionOnPage % cols;
      const row = Math.floor(positionOnPage / cols);
      const x = 30 + col * (cardWidth + 10);
      const y = 30 + row * (cardHeight + 10);

      drawCard(doc, card, x, y, cardWidth, cardHeight);
    });

    doc.end();
    stream.on('finish', () => resolve(filepath));
    stream.on('error', reject);
  });
}

function drawCard(
  doc: PDFKit.PDFDocument, card: CardData,
  x: number, y: number, width: number, height: number
) {
  const cellSize = Math.min((width - 10) / 5, (height - 60) / 6);
  const gridWidth = cellSize * 5;
  const startX = x + (width - gridWidth) / 2;
  const startY = y + 30;

  doc.rect(x, y, width, height).stroke('#e5e7eb');
  doc.fontSize(12).fillColor('#1f2937')
    .text(`Cartón #${card.cardNumber}`, x, y + 8, { width, align: 'center' });

  COLUMNS.forEach((col, i) => {
    const cellX = startX + i * cellSize;
    doc.rect(cellX, startY, cellSize, cellSize).fill(COLUMN_COLORS[col]);
    doc.fontSize(16).fillColor(col === 'N' ? '#1f2937' : '#ffffff')
      .text(col, cellX, startY + cellSize / 3, { width: cellSize, align: 'center' });
  });

  for (let row = 0; row < 5; row++) {
    for (let col = 0; col < 5; col++) {
      const cellX = startX + col * cellSize;
      const cellY = startY + cellSize + row * cellSize;
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

  const footerY = startY + cellSize * 6 + 5;
  doc.fontSize(8).fillColor('#6b7280')
    .text(`Código: ${card.cardCode} | Validación: ${card.validationCode}`, x, footerY, { width, align: 'center' });
}
