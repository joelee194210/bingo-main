import { useState, useRef, useEffect } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  ScanLine,
  Search,
  CheckCircle2,
  XCircle,
  Loader2,
  CreditCard,
  Tag,
  Hash,
  AlertTriangle,
} from 'lucide-react';
import { toast } from 'sonner';
import { searchCard, sellCard, unsellCard } from '@/services/api';
import type { BingoCard, CardNumbers } from '@/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

export default function CardActivation() {
  const [searchValue, setSearchValue] = useState('');
  const [card, setCard] = useState<BingoCard | null>(null);
  const [error, setError] = useState('');
  const [sold, setSold] = useState(false);
  const [unsold, setUnsold] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [showUnsellConfirm, setShowUnsellConfirm] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const searchMutation = useMutation({
    mutationFn: () => searchCard(searchValue.trim()),
    onSuccess: (data) => {
      if (data.success && data.data) {
        setCard(data.data);
        setError('');
        setSold(false);
      }
    },
    onError: () => {
      setCard(null);
      setError('Carton no encontrado. Verifica el numero de serie e intenta de nuevo.');
    },
  });

  const sellMutation = useMutation({
    mutationFn: () => {
      if (!card) throw new Error('No card');
      return sellCard(card.id, {});
    },
    onSuccess: (data) => {
      if (data.success && data.data) {
        setCard(data.data);
        setSold(true);
        toast.success(`Carton #${data.data.card_number} (${data.data.serial}) activado como vendido`);
      }
    },
    onError: (err: Error & { response?: { data?: { error?: string } } }) => {
      toast.error(err.response?.data?.error || 'Error al activar el carton');
    },
  });

  const unsellMutation = useMutation({
    mutationFn: () => {
      if (!card) throw new Error('No card');
      return unsellCard(card.id);
    },
    onSuccess: (data) => {
      if (data.success && data.data) {
        setCard(data.data);
        setUnsold(true);
        toast.success(`Carton #${data.data.card_number} (${data.data.serial}) desactivado`);
      }
    },
    onError: (err: Error & { response?: { data?: { error?: string } } }) => {
      toast.error(err.response?.data?.error || 'Error al desactivar el carton');
    },
  });

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchValue.trim().length < 3) return;
    setCard(null);
    setError('');
    setSold(false);
    setUnsold(false);
    searchMutation.mutate();
  };

  const handleConfirmActivate = () => {
    setShowConfirm(false);
    sellMutation.mutate();
  };

  const handleConfirmUnsell = () => {
    setShowUnsellConfirm(false);
    unsellMutation.mutate();
  };

  const handleReset = () => {
    setSearchValue('');
    setCard(null);
    setError('');
    setSold(false);
    inputRef.current?.focus();
  };

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
          Ingresa el numero de serie del carton para activarlo como vendido
        </p>
      </div>

      {/* Search Section */}
      <Card>
        <CardContent className="pt-6">
          <form onSubmit={handleSearch} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="search-input">Numero de Serie</Label>
              <div className="relative">
                <Input
                  id="search-input"
                  ref={inputRef}
                  className="font-mono uppercase text-lg h-12 pr-12"
                  value={searchValue}
                  onChange={(e) => setSearchValue(e.target.value.toUpperCase())}
                  onKeyDown={handleKeyDown}
                  placeholder="Ej: 00001-01"
                  autoComplete="off"
                  autoFocus
                />
                {isLoading && (
                  <Loader2 className="absolute right-4 top-3.5 h-5 w-5 animate-spin text-muted-foreground" />
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                Escribe el numero de serie impreso en el carton o escanea el QR
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

      {/* Card Found */}
      {card && (
        <Card className={sold ? 'border-emerald-500/50 shadow-emerald-500/10 shadow-lg' : unsold ? 'border-orange-500/50 shadow-orange-500/10 shadow-lg' : ''}>
          <CardContent className="pt-6 space-y-6">
            {/* Status banner */}
            {sold ? (
              <div className="flex items-center gap-3 bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-4">
                <CheckCircle2 className="text-emerald-500 h-8 w-8 shrink-0" />
                <div>
                  <p className="font-bold text-emerald-600 dark:text-emerald-400 text-lg">Carton Activado</p>
                  <p className="text-sm text-emerald-600/80 dark:text-emerald-400/80">
                    Marcado como vendido exitosamente
                  </p>
                </div>
              </div>
            ) : unsold ? (
              <div className="flex items-center gap-3 bg-orange-500/10 border border-orange-500/30 rounded-lg p-4">
                <XCircle className="text-orange-500 h-8 w-8 shrink-0" />
                <div>
                  <p className="font-bold text-orange-600 dark:text-orange-400 text-lg">Carton Desactivado</p>
                  <p className="text-sm text-orange-600/80 dark:text-orange-400/80">
                    Marcado como disponible exitosamente
                  </p>
                </div>
              </div>
            ) : card.is_sold ? (
              <div className="flex items-center gap-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4">
                <AlertTriangle className="text-yellow-500 h-6 w-6 shrink-0" />
                <div>
                  <p className="font-semibold text-yellow-600 dark:text-yellow-400">Este carton ya fue vendido</p>
                  {card.buyer_name && (
                    <p className="text-sm text-yellow-600/80 dark:text-yellow-400/80">
                      Comprador: {card.buyer_name} {card.buyer_phone ? `| Tel: ${card.buyer_phone}` : ''}
                    </p>
                  )}
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
            {card.numbers && typeof card.numbers === 'object' && card.numbers.N && (
              <div className="flex justify-center py-2">
                {renderBingoCard(card.numbers)}
              </div>
            )}

            <Separator />

            {/* Deactivate button - if already sold */}
            {card.is_sold && !unsold && (
              <Button
                variant="destructive"
                size="lg"
                className="w-full"
                onClick={() => setShowUnsellConfirm(true)}
                disabled={unsellMutation.isPending}
              >
                {unsellMutation.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Desactivando...
                  </>
                ) : (
                  <>
                    <XCircle className="mr-2 h-5 w-5" />
                    Desactivar (Marcar como Disponible)
                  </>
                )}
              </Button>
            )}

            {/* Activate button - only if not already sold */}
            {!card.is_sold && !sold && (
              <Button
                variant="success"
                size="lg"
                className="w-full"
                onClick={() => setShowConfirm(true)}
                disabled={sellMutation.isPending}
              >
                {sellMutation.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Activando...
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="mr-2 h-5 w-5" />
                    Activar como Vendido
                  </>
                )}
              </Button>
            )}

            {/* New search after success */}
            {(sold || unsold) && (
              <Button onClick={handleReset} size="lg" className="w-full">
                <ScanLine className="mr-2 h-5 w-5" />
                Buscar Otro Carton
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {/* Confirmation Dialog */}
      <AlertDialog open={showConfirm} onOpenChange={setShowConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Activar carton como vendido</AlertDialogTitle>
            <AlertDialogDescription>
              {card && (
                <>
                  ¿Estas seguro que quieres activar el carton <strong className="text-foreground">#{card.card_number}</strong> (Serie: <strong className="text-foreground">{card.serial}</strong>) como vendido?
                  <br /><br />
                  Esta accion marcara el carton como vendido en el sistema.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmActivate}>
              Si, Activar como Vendido
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Unsell Confirmation Dialog */}
      <AlertDialog open={showUnsellConfirm} onOpenChange={setShowUnsellConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Desactivar carton</AlertDialogTitle>
            <AlertDialogDescription>
              {card && (
                <>
                  ¿Estas seguro que quieres desactivar el carton <strong className="text-foreground">#{card.card_number}</strong> (Serie: <strong className="text-foreground">{card.serial}</strong>)?
                  <br /><br />
                  Esta accion lo marcara como disponible y eliminara los datos del comprador.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmUnsell} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Si, Desactivar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
