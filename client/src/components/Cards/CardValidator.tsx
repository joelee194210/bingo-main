import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { Search, CheckCircle, XCircle, Loader2, Gift, PartyPopper } from 'lucide-react';
import { validateCard, searchCard } from '@/services/api';
import type { BingoCard, CardNumbers } from '@/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

function ScratchReveal({ text }: { text: string }) {
  const [revealed, setRevealed] = useState(false);
  // Determinar si es un premio real o "sin premio"
  const noPrizeKeywords = ['gracias', 'participar', 'suerte', 'intenta'];
  const isWinner = !noPrizeKeywords.some(kw => text.toLowerCase().includes(kw));

  return (
    <div className={`rounded-xl border-2 p-5 text-center space-y-3 transition-all ${
      revealed
        ? isWinner
          ? 'border-blue-400 bg-gradient-to-br from-blue-50 to-sky-50 dark:from-blue-950/40 dark:to-sky-950/30'
          : 'border-border bg-muted/30'
        : 'border-dashed border-muted-foreground/30 bg-muted/20'
    }`}>
      <div className="flex items-center justify-center gap-2">
        <Gift className="h-5 w-5 text-primary" />
        <span className="font-semibold text-sm">Raspadito</span>
      </div>

      {!revealed ? (
        <Button
          variant="outline"
          size="lg"
          onClick={() => setRevealed(true)}
          className="w-full border-dashed"
        >
          <Gift className="mr-2 h-4 w-4" />
          Revelar Raspadito
        </Button>
      ) : (
        <div className="animate-fade-in-up">
          {isWinner ? (
            <>
              <PartyPopper className="h-10 w-10 text-blue-500 mx-auto mb-2" />
              <p className="text-2xl font-black text-blue-600 dark:text-blue-400">{text}</p>
              <Badge variant="success" className="mt-2">GANADOR</Badge>
            </>
          ) : (
            <p className="text-lg font-medium text-muted-foreground">{text}</p>
          )}
        </div>
      )}
    </div>
  );
}

export default function CardValidator() {
  const [searchParams] = useSearchParams();
  const initialCode = searchParams.get('code') || '';

  const [cardCode, setCardCode] = useState(initialCode);
  const [validationCode, setValidationCode] = useState('');
  const [card, setCard] = useState<BingoCard | null>(null);
  const [error, setError] = useState('');

  const searchMutation = useMutation({
    mutationFn: () => searchCard(cardCode),
    onSuccess: (data) => {
      if (data.success && data.data) {
        setCard(data.data);
        setError('');
      }
    },
    onError: () => {
      setCard(null);
      setError('Cartón no encontrado');
    },
  });

  const validateMutation = useMutation({
    mutationFn: () => validateCard(cardCode, validationCode),
    onSuccess: (data) => {
      if (data.success && data.data) {
        setCard({ ...data.data, numbers: data.data.numbers as unknown as CardNumbers } as BingoCard);
        setError('');
      }
    },
    onError: () => {
      setError('Código de validación incorrecto');
    },
  });

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (cardCode.length >= 5) {
      if (validationCode.length >= 5) {
        validateMutation.mutate();
      } else {
        searchMutation.mutate();
      }
    }
  };

  const renderBingoCard = (numbers: CardNumbers) => {
    // Detectar si usa FREE center basado en la cantidad de números en N
    const useFreeCenter = numbers.N.length === 4;

    const columns: Array<{ letter: string; colorClass: string; nums: number[] }> = [
      { letter: 'B', colorClass: 'bingo-ball-B', nums: numbers.B },
      { letter: 'I', colorClass: 'bingo-ball-I', nums: numbers.I },
      { letter: 'N', colorClass: 'bingo-ball-N', nums: numbers.N },
      { letter: 'G', colorClass: 'bingo-ball-G', nums: numbers.G },
      { letter: 'O', colorClass: 'bingo-ball-O', nums: numbers.O },
    ];

    return (
      <div className="inline-block">
        {/* Header */}
        <div className="grid grid-cols-5 gap-1 mb-1">
          {columns.map((col) => (
            <div
              key={col.letter}
              className={`bingo-cell-header ${col.colorClass}`}
            >
              {col.letter}
            </div>
          ))}
        </div>

        {/* Numbers */}
        <div className="grid grid-cols-5 gap-1">
          {[0, 1, 2, 3, 4].map((row) => (
            columns.map((col, colIdx) => {
              const isCenter = useFreeCenter && colIdx === 2 && row === 2;
              const numIdx = (useFreeCenter && colIdx === 2) ? (row < 2 ? row : row - 1) : row;
              const num = isCenter ? 'FREE' : col.nums[numIdx];

              return (
                <div
                  key={`${col.letter}-${row}`}
                  className={`bingo-cell ${isCenter ? 'bingo-cell-free' : ''}`}
                >
                  {num}
                </div>
              );
            })
          ))}
        </div>
      </div>
    );
  };

  const isLoading = searchMutation.isPending || validateMutation.isPending;

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      <div className="page-header">
        <h2 className="text-2xl font-bold tracking-tight">Validar Carton</h2>
        <p className="text-muted-foreground text-sm mt-1">Busca y valida cartones de bingo</p>
      </div>

      {/* Search Form */}
      <Card>
        <CardContent className="pt-6">
          <form onSubmit={handleSearch} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="card-code">Código del Cartón *</Label>
                <Input
                  id="card-code"
                  className="font-mono uppercase"
                  value={cardCode}
                  onChange={(e) => setCardCode(e.target.value.toUpperCase())}
                  placeholder="XXXXX"
                  maxLength={10}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="validation-code">Código de Validación</Label>
                <Input
                  id="validation-code"
                  className="font-mono uppercase"
                  value={validationCode}
                  onChange={(e) => setValidationCode(e.target.value.toUpperCase())}
                  placeholder="XXXXX (opcional)"
                  maxLength={10}
                />
              </div>
            </div>

            <Button
              type="submit"
              disabled={cardCode.length < 5 || isLoading}
              className="w-full"
              size="lg"
            >
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Buscando...
                </>
              ) : (
                <>
                  <Search className="mr-2 h-4 w-4" />
                  Buscar Cartón
                </>
              )}
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Error */}
      {error && (
        <Card className="border-destructive/50 bg-destructive/10">
          <CardContent className="pt-6 flex items-center gap-3">
            <XCircle className="text-destructive h-6 w-6" />
            <p className="text-destructive font-medium">{error}</p>
          </CardContent>
        </Card>
      )}

      {/* Card Result */}
      {card && (
        <Card>
          <CardContent className="pt-6 space-y-6">
            {/* Status */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <CheckCircle className="text-green-600 h-6 w-6" />
                <span className="font-semibold text-green-700 dark:text-green-500">Cartón Válido</span>
              </div>
              <Badge variant={card.is_sold ? 'success' : 'secondary'}>
                {card.is_sold ? '✓ Vendido' : 'Disponible'}
              </Badge>
            </div>

            {/* Card Info */}
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-muted-foreground">Número de Cartón</p>
                <p className="font-bold text-2xl">#{card.card_number}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Serie</p>
                <p className="font-mono font-bold text-2xl text-primary">{card.serial}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Código</p>
                <p className="font-mono font-bold text-2xl text-primary">{card.card_code}</p>
              </div>
              {card.buyer_name && (
                <div>
                  <p className="text-muted-foreground">Comprador</p>
                  <p className="font-medium">{card.buyer_name}</p>
                </div>
              )}
              {card.buyer_phone && (
                <div>
                  <p className="text-muted-foreground">Teléfono</p>
                  <p className="font-medium">{card.buyer_phone}</p>
                </div>
              )}
            </div>

            {/* Visual Card */}
            {card.numbers && (
              <div className="flex justify-center py-4">
                {renderBingoCard(card.numbers)}
              </div>
            )}

            {/* Numbers as Text */}
            <div className="bg-muted rounded-lg p-4">
              <p className="text-sm text-muted-foreground mb-2">Números (B-I-N-G-O)</p>
              <p className="font-mono text-sm break-all">
                {card.numbers && [
                  ...card.numbers.B,
                  ...card.numbers.I,
                  ...card.numbers.N,
                  ...card.numbers.G,
                  ...card.numbers.O,
                ].join(', ')}
              </p>
            </div>

            {/* Raspadito / Promo */}
            {card.promo_text && (
              <ScratchReveal text={card.promo_text} />
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
