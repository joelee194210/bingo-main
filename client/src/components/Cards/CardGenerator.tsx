import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CreditCard, CheckCircle, AlertTriangle, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { getEvent, generateCards, getGenerationProgress, verifyEventCards } from '@/services/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Progress } from '@/components/ui/progress';

export default function CardGenerator() {
  const { eventId } = useParams<{ eventId: string }>();
  const queryClient = useQueryClient();
  const [quantity, setQuantity] = useState(1000);
  const [isGenerating, setIsGenerating] = useState(false);
  const [progress, setProgress] = useState<{ total: number; generated: number; inserted?: number; status: string } | null>(null);
  const [result, setResult] = useState<{ generated: number; duplicatesAvoided: number; generationTime: number } | null>(null);

  const { data: eventData, isLoading: eventLoading } = useQuery({
    queryKey: ['event-basic', eventId],
    queryFn: () => getEvent(Number(eventId)),
    enabled: !!eventId,
  });

  const generateMutation = useMutation({
    mutationFn: () => generateCards(Number(eventId), quantity),
    onSuccess: (data) => {
      setIsGenerating(false);
      if (data.success && data.data) {
        setResult(data.data);
        queryClient.invalidateQueries({ queryKey: ['event', eventId] });
        queryClient.invalidateQueries({ queryKey: ['cards'] });
      }
    },
    onError: (error) => {
      setIsGenerating(false);
      toast.error('Error generando cartones: ' + (error as Error).message);
    },
  });

  const verifyMutation = useMutation({
    mutationFn: () => verifyEventCards(Number(eventId)),
  });

  useEffect(() => {
    if (!isGenerating) return;

    const interval = setInterval(async () => {
      try {
        const response = await getGenerationProgress(Number(eventId));
        if (response.success && response.data) {
          setProgress(response.data);
          if (response.data.status === 'completed') {
            setIsGenerating(false);
          }
        }
      } catch {
        // Ignorar errores de polling
      }
    }, 500);

    return () => clearInterval(interval);
  }, [isGenerating, eventId]);

  const handleGenerate = () => {
    setIsGenerating(true);
    setResult(null);
    setProgress({ total: quantity, generated: 0, inserted: 0, status: 'generating' });
    generateMutation.mutate();
  };

  if (eventLoading) {
    return (
      <div className="space-y-6 max-w-2xl mx-auto">
        <div className="flex items-center gap-4">
          <Skeleton className="h-10 w-10 rounded-lg" />
          <div className="space-y-2">
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-4 w-32" />
          </div>
        </div>
        <Card>
          <CardContent className="pt-6">
            <Skeleton className="h-32 w-full" />
          </CardContent>
        </Card>
      </div>
    );
  }

  const event = eventData?.data;

  if (!event) {
    return (
      <Card className="max-w-2xl mx-auto border-destructive/50">
        <CardContent className="pt-6 text-center text-destructive">
          Evento no encontrado
        </CardContent>
      </Card>
    );
  }

  const progressPercent = progress
    ? progress.status === 'generating'
      ? Math.round((progress.generated / progress.total) * 50)
      : progress.status === 'inserting'
        ? 50 + Math.round(((progress.inserted ?? 0) / progress.total) * 50)
        : 100
    : 0;

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link to={`/events/${eventId}`}>
            <ArrowLeft className="h-5 w-5" />
          </Link>
        </Button>
        <div>
          <h2 className="text-2xl font-bold">Generar Cartones</h2>
          <p className="text-muted-foreground">{event.name}</p>
        </div>
      </div>

      {/* Current Stats */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Estado Actual</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-4 text-center">
            <div>
              <p className="text-3xl font-bold text-blue-600">{event.total_cards.toLocaleString()}</p>
              <p className="text-sm text-muted-foreground">Cartones Existentes</p>
            </div>
            <div>
              <p className="text-3xl font-bold text-green-600">{event.cards_sold.toLocaleString()}</p>
              <p className="text-sm text-muted-foreground">Vendidos</p>
            </div>
            <div>
              <p className="text-3xl font-bold text-purple-600">{(event.total_cards - event.cards_sold).toLocaleString()}</p>
              <p className="text-sm text-muted-foreground">Disponibles</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Generator Form */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Generar Nuevos Cartones</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="quantity">Cantidad a Generar</Label>
            <Input
              id="quantity"
              type="number"
              value={quantity}
              onChange={(e) => setQuantity(Math.max(1, Math.min(1000000, parseInt(e.target.value) || 1)))}
              min={1}
              max={1000000}
              disabled={isGenerating}
            />
            <p className="text-sm text-muted-foreground">
              Máximo: 1,000,000 cartones por generación
            </p>
          </div>

          {/* Quick Select */}
          <div className="flex flex-wrap gap-2">
            {[1000, 5000, 10000, 50000, 100000, 500000, 1000000].map((q) => (
              <Button
                key={q}
                variant={quantity === q ? 'default' : 'outline'}
                size="sm"
                onClick={() => setQuantity(q)}
                disabled={isGenerating}
              >
                {q.toLocaleString()}
              </Button>
            ))}
          </div>

          {/* Progress Bar */}
          {isGenerating && progress && (
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">
                  {progress.status === 'generating'
                    ? 'Generando cartones...'
                    : progress.status === 'inserting'
                      ? 'Guardando en base de datos...'
                      : 'Completado'}
                </span>
                <span className="font-medium">{progressPercent}%</span>
              </div>
              <Progress value={progressPercent} className="h-3" />
              <p className="text-sm text-muted-foreground">
                {progress.status === 'generating'
                  ? `Generados: ${progress.generated.toLocaleString()} / ${progress.total.toLocaleString()}`
                  : `Guardados: ${(progress.inserted ?? 0).toLocaleString()} / ${progress.total.toLocaleString()}`
                }
              </p>
            </div>
          )}

          {/* Result */}
          {result && (
            <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-900 rounded-lg p-4">
              <div className="flex items-start gap-3">
                <CheckCircle className="text-green-600 mt-0.5 h-5 w-5" />
                <div>
                  <p className="font-semibold text-green-800 dark:text-green-400">¡Generación Completada!</p>
                  <ul className="text-sm text-green-700 dark:text-green-500 mt-2 space-y-1">
                    <li>✓ {result.generated.toLocaleString()} cartones generados</li>
                    <li>✓ {result.duplicatesAvoided} duplicados evitados</li>
                    <li>✓ Tiempo: {(result.generationTime / 1000).toFixed(2)}s</li>
                  </ul>
                </div>
              </div>
            </div>
          )}

          <Button
            onClick={handleGenerate}
            disabled={isGenerating || quantity < 1}
            className="w-full"
            variant="success"
            size="lg"
          >
            {isGenerating ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Generando...
              </>
            ) : (
              <>
                <CreditCard className="mr-2 h-4 w-4" />
                Generar {quantity.toLocaleString()} Cartones
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {/* Verification */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Verificación de Unicidad</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Ejecuta una verificación completa para asegurar que no hay cartones duplicados.
          </p>

          {verifyMutation.data?.success && (
            <div className={`p-4 rounded-lg ${
              verifyMutation.data.data?.duplicatesFound === 0
                ? 'bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-900'
                : 'bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-900'
            }`}>
              {verifyMutation.data.data?.duplicatesFound === 0 ? (
                <div className="flex items-center gap-2 text-green-700 dark:text-green-400">
                  <CheckCircle className="h-5 w-5" />
                  <span>✓ {verifyMutation.data.data.totalChecked.toLocaleString()} cartones verificados - Sin duplicados</span>
                </div>
              ) : (
                <div className="flex items-center gap-2 text-red-700 dark:text-red-400">
                  <AlertTriangle className="h-5 w-5" />
                  <span>⚠ {verifyMutation.data.data?.duplicatesFound} duplicados encontrados</span>
                </div>
              )}
            </div>
          )}

          <Button
            variant="outline"
            className="w-full"
            onClick={() => verifyMutation.mutate()}
            disabled={verifyMutation.isPending || event.total_cards === 0}
          >
            {verifyMutation.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Verificando...
              </>
            ) : (
              'Verificar Cartones'
            )}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
