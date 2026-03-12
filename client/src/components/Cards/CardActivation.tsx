import { useState, useRef, useEffect } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  ScanLine,
  Search,
  CheckCircle2,
  XCircle,
  Loader2,
  ShieldCheck,
  User,
  Phone,
  CreditCard,
  Tag,
  Hash,
  AlertTriangle,
} from 'lucide-react';
import { toast } from 'sonner';
import { searchCard, sellCard } from '@/services/api';
import type { BingoCard, CardNumbers } from '@/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';

type SearchMode = 'code' | 'security';

export default function CardActivation() {
  const [mode, setMode] = useState<SearchMode>('code');
  const [searchValue, setSearchValue] = useState('');
  const [card, setCard] = useState<BingoCard | null>(null);
  const [error, setError] = useState('');
  const [buyerName, setBuyerName] = useState('');
  const [buyerPhone, setBuyerPhone] = useState('');
  const [sold, setSold] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-focus input on mount and mode change
  useEffect(() => {
    inputRef.current?.focus();
  }, [mode]);

  const searchMutation = useMutation({
    mutationFn: () => searchCard(searchValue.trim()),
    onSuccess: (data) => {
      if (data.success && data.data) {
        setCard(data.data);
        setError('');
        setSold(false);
        setBuyerName(data.data.buyer_name || '');
        setBuyerPhone(data.data.buyer_phone || '');
      }
    },
    onError: () => {
      setCard(null);
      setError('Carton no encontrado. Verifica el codigo e intenta de nuevo.');
    },
  });

  const sellMutation = useMutation({
    mutationFn: () => {
      if (!card) throw new Error('No card');
      return sellCard(card.id, { buyer_name: buyerName.trim() || undefined, buyer_phone: buyerPhone.trim() || undefined });
    },
    onSuccess: (data) => {
      if (data.success && data.data) {
        setCard(data.data);
        setSold(true);
        toast.success(`Carton #${data.data.card_number} activado exitosamente`);
      }
    },
    onError: (err: Error & { response?: { data?: { error?: string } } }) => {
      toast.error(err.response?.data?.error || 'Error al activar el carton');
    },
  });

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchValue.trim().length < 3) return;
    setCard(null);
    setError('');
    setSold(false);
    searchMutation.mutate();
  };

  const handleActivate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!card) return;
    if (!buyerName.trim()) {
      toast.error('El nombre del comprador es obligatorio');
      return;
    }
    sellMutation.mutate();
  };

  const handleReset = () => {
    setSearchValue('');
    setCard(null);
    setError('');
    setSold(false);
    setBuyerName('');
    setBuyerPhone('');
    inputRef.current?.focus();
  };

  // Handle QR scanner input (rapid keystrokes ending with Enter)
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && searchValue.trim().length >= 3) {
      e.preventDefault();
      setCard(null);
      setError('');
      setSold(false);
      searchMutation.mutate();
    }
  };

  const isLoading = searchMutation.isPending;

  const renderBingoCard = (numbers: CardNumbers) => {
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
        <div className="grid grid-cols-5 gap-1 mb-1">
          {columns.map((col) => (
            <div key={col.letter} className={`bingo-cell-header ${col.colorClass}`}>
              {col.letter}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-5 gap-1">
          {[0, 1, 2, 3, 4].map((row) =>
            columns.map((col, colIdx) => {
              const isCenter = useFreeCenter && colIdx === 2 && row === 2;
              const numIdx = useFreeCenter && colIdx === 2 ? (row < 2 ? row : row - 1) : row;
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
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      {/* Header */}
      <div className="page-header">
        <h2 className="text-2xl font-bold tracking-tight">Activar Carton</h2>
        <p className="text-muted-foreground text-sm mt-1">
          Escanea el QR o ingresa el codigo para vender un carton
        </p>
      </div>

      {/* Search Section */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex gap-2">
            <Button
              variant={mode === 'code' ? 'default' : 'outline'}
              size="sm"
              onClick={() => { setMode('code'); handleReset(); }}
            >
              <ScanLine className="mr-2 h-4 w-4" />
              Codigo / QR
            </Button>
            <Button
              variant={mode === 'security' ? 'default' : 'outline'}
              size="sm"
              onClick={() => { setMode('security'); handleReset(); }}
            >
              <ShieldCheck className="mr-2 h-4 w-4" />
              Codigo de Seguridad
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSearch} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="search-input">
                {mode === 'code'
                  ? 'Codigo del Carton (escanea QR o escribe)'
                  : 'Codigo de Seguridad / Validacion'}
              </Label>
              <div className="relative">
                <Input
                  id="search-input"
                  ref={inputRef}
                  className="font-mono uppercase text-lg h-12 pr-12"
                  value={searchValue}
                  onChange={(e) => setSearchValue(e.target.value.toUpperCase())}
                  onKeyDown={handleKeyDown}
                  placeholder={mode === 'code' ? 'Escanea o escribe el codigo...' : 'Ingresa codigo de seguridad...'}
                  autoComplete="off"
                  autoFocus
                />
                {isLoading && (
                  <Loader2 className="absolute right-4 top-3.5 h-5 w-5 animate-spin text-muted-foreground" />
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                {mode === 'code'
                  ? 'Usa el lector de QR o escribe el codigo impreso en el carton'
                  : 'Ingresa el codigo de seguridad oculto del carton'}
              </p>
            </div>

            <Button
              type="submit"
              disabled={searchValue.trim().length < 3 || isLoading}
              className="w-full"
              size="lg"
            >
              <Search className="mr-2 h-4 w-4" />
              Buscar Carton
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Error */}
      {error && (
        <Card className="border-destructive/50 bg-destructive/10">
          <CardContent className="pt-6 flex items-center gap-3">
            <XCircle className="text-destructive h-6 w-6 shrink-0" />
            <p className="text-destructive font-medium">{error}</p>
          </CardContent>
        </Card>
      )}

      {/* Card Found - Info + Activation Form */}
      {card && (
        <Card className={sold ? 'border-emerald-500/50 shadow-emerald-500/10 shadow-lg' : ''}>
          <CardContent className="pt-6 space-y-6">
            {/* Status banner */}
            {sold ? (
              <div className="flex items-center gap-3 bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-4">
                <CheckCircle2 className="text-emerald-500 h-8 w-8 shrink-0" />
                <div>
                  <p className="font-bold text-emerald-600 dark:text-emerald-400 text-lg">Carton Activado</p>
                  <p className="text-sm text-emerald-600/80 dark:text-emerald-400/80">
                    Venta registrada exitosamente
                  </p>
                </div>
              </div>
            ) : card.is_sold ? (
              <div className="flex items-center gap-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4">
                <AlertTriangle className="text-yellow-500 h-6 w-6 shrink-0" />
                <div>
                  <p className="font-semibold text-yellow-600 dark:text-yellow-400">Este carton ya fue vendido</p>
                  <p className="text-sm text-yellow-600/80 dark:text-yellow-400/80">
                    Comprador: {card.buyer_name || 'Sin nombre'} {card.buyer_phone ? `| Tel: ${card.buyer_phone}` : ''}
                  </p>
                </div>
              </div>
            ) : null}

            {/* Card details */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              <div className="flex items-start gap-2">
                <Hash className="h-4 w-4 text-muted-foreground mt-0.5" />
                <div>
                  <p className="text-xs text-muted-foreground">Numero</p>
                  <p className="font-bold text-xl">#{card.card_number}</p>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <Tag className="h-4 w-4 text-muted-foreground mt-0.5" />
                <div>
                  <p className="text-xs text-muted-foreground">Serie</p>
                  <p className="font-mono font-bold text-lg">{card.serial}</p>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <CreditCard className="h-4 w-4 text-muted-foreground mt-0.5" />
                <div>
                  <p className="text-xs text-muted-foreground">Codigo</p>
                  <p className="font-mono font-bold text-lg text-primary">{card.card_code}</p>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <Badge variant={card.is_sold || sold ? 'success' : 'secondary'} className="text-sm px-3 py-1">
                {card.is_sold || sold ? 'Vendido' : 'Disponible'}
              </Badge>
            </div>

            {/* Visual card */}
            {card.numbers && (
              <div className="flex justify-center py-2">
                {renderBingoCard(card.numbers)}
              </div>
            )}

            <Separator />

            {/* Activation form - only show if not already sold */}
            {!card.is_sold && !sold && (
              <form onSubmit={handleActivate} className="space-y-4">
                <CardTitle className="text-base">Datos del Comprador</CardTitle>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="buyer-name" className="flex items-center gap-2">
                      <User className="h-3.5 w-3.5" />
                      Nombre *
                    </Label>
                    <Input
                      id="buyer-name"
                      value={buyerName}
                      onChange={(e) => setBuyerName(e.target.value)}
                      placeholder="Nombre del comprador"
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="buyer-phone" className="flex items-center gap-2">
                      <Phone className="h-3.5 w-3.5" />
                      Telefono
                    </Label>
                    <Input
                      id="buyer-phone"
                      value={buyerPhone}
                      onChange={(e) => setBuyerPhone(e.target.value)}
                      placeholder="Numero de telefono"
                      type="tel"
                    />
                  </div>
                </div>

                <Button
                  type="submit"
                  variant="success"
                  size="lg"
                  className="w-full"
                  disabled={sellMutation.isPending || !buyerName.trim()}
                >
                  {sellMutation.isPending ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Activando...
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="mr-2 h-5 w-5" />
                      Activar Carton
                    </>
                  )}
                </Button>
              </form>
            )}

            {/* New sale button after successful activation */}
            {sold && (
              <Button
                onClick={handleReset}
                size="lg"
                className="w-full"
              >
                <ScanLine className="mr-2 h-5 w-5" />
                Activar Otro Carton
              </Button>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
