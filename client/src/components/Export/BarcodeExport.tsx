import { useState, useEffect } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import {
  Barcode,
  Download,
  Loader2,
  CheckCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { getEvents, generateBarcodes, getBarcodeProgress, downloadBarcodeZip } from '@/services/api';
import type { BingoEvent } from '@/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export default function BarcodeExport() {
  const [selectedEventId, setSelectedEventId] = useState<number | null>(null);
  const [rangeType, setRangeType] = useState<'all' | 'cards' | 'series'>('all');
  const [fromCard, setFromCard] = useState<number>(1);
  const [toCard, setToCard] = useState<number>(500);
  const [fromSeries, setFromSeries] = useState<number>(1);
  const [toSeries, setToSeries] = useState<number>(10);
  const [isGenerating, setIsGenerating] = useState(false);
  const [progress, setProgress] = useState<{ total: number; generated: number; status: string } | null>(null);
  const [result, setResult] = useState<{
    event_name: string;
    cards_processed: number;
    zip_size_mb?: string;
    sample_serial: string;
  } | null>(null);

  const { data: eventsData } = useQuery({ queryKey: ['events'], queryFn: getEvents });
  const events = eventsData?.data || [];

  // Polling del progreso
  useEffect(() => {
    if (!isGenerating || !selectedEventId) return;
    let stopped = false;
    let maxSeen = 0;

    const poll = async () => {
      while (!stopped) {
        await new Promise(r => setTimeout(r, 3000));
        if (stopped) break;
        try {
          const response = await getBarcodeProgress(selectedEventId);
          if (stopped) break;
          if (response.success && response.data) {
            if (response.data.generated >= maxSeen) {
              maxSeen = response.data.generated;
              setProgress(response.data);
            }
            if (response.data.status === 'completed') {
              setIsGenerating(false);
              setResult(prev => prev ? { ...prev, cards_processed: response.data!.total } : prev);
              toast.success(`${response.data.total.toLocaleString()} codigos de barra generados`);
              break;
            }
            if (response.data.status === 'error') {
              setIsGenerating(false);
              toast.error('Error generando codigos de barra en el servidor');
              break;
            }
          }
        } catch {
          // Ignorar errores de polling
        }
      }
    };

    poll();
    return () => { stopped = true; };
  }, [isGenerating, selectedEventId]);

  const generateMutation = useMutation({
    mutationFn: () => {
      const payload: Parameters<typeof generateBarcodes>[0] = {
        event_id: selectedEventId!,
      };
      if (rangeType === 'cards') {
        payload.from_card = fromCard;
        payload.to_card = toCard;
      } else if (rangeType === 'series') {
        payload.from_series = fromSeries;
        payload.to_series = toSeries;
      }
      return generateBarcodes(payload);
    },
    onSuccess: (data) => {
      // POST responde inmediato — la generación corre en background
      // El polling detectará cuando termine
      if (data.data) {
        setResult({
          event_name: data.data.event_name || '',
          cards_processed: data.data.cards_total || 0,
          sample_serial: data.data.sample_serial || '',
        });
        setProgress({ total: data.data.cards_total || 0, generated: 0, status: 'generating' });
      }
    },
    onError: (e: { response?: { data?: { error?: string } } }) => {
      setIsGenerating(false);
      setProgress(null);
      toast.error(e.response?.data?.error || 'Error generando codigos de barra');
    },
  });

  const handleGenerate = () => {
    setIsGenerating(true);
    setResult(null);
    setProgress({ total: 0, generated: 0, status: 'generating' });
    generateMutation.mutate();
  };

  const handleDownload = async () => {
    if (!selectedEventId) return;
    try {
      const blob = await downloadBarcodeZip(selectedEventId);
      const url = window.URL.createObjectURL(new Blob([blob]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `Barcode_${result?.event_name || 'export'}.zip`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch {
      toast.error('Error descargando archivo ZIP');
    }
  };

  const progressPercent = progress && progress.total > 0
    ? progress.status === 'generating'
      ? Math.round((progress.generated / progress.total) * 90)
      : progress.status === 'zipping'
        ? 95
        : 100
    : 0;

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      {/* Header */}
      <div className="page-header">
        <h2 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Barcode className="h-6 w-6" />
          Exportar Codigos de Barra
        </h2>
        <p className="text-muted-foreground text-sm mt-1">
          Genera etiquetas con codigo de barras Code 128 para los cartones (~1.9cm x 0.9cm)
        </p>
      </div>

      {/* Config */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Configuracion</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* Evento */}
          <div className="space-y-2">
            <Label>Evento</Label>
            <Select
              value={selectedEventId?.toString() || ''}
              onValueChange={(v) => { setSelectedEventId(Number(v)); setResult(null); }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Seleccionar evento..." />
              </SelectTrigger>
              <SelectContent>
                {events.map((event: BingoEvent) => (
                  <SelectItem key={event.id} value={event.id.toString()}>
                    {event.name} ({event.total_cards.toLocaleString()} cartones)
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Info de formato */}
          <div className="bg-muted/50 rounded-lg px-3 py-2 border space-y-1">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Formato de etiqueta</p>
            <p className="text-sm">Code 128 — Serial: <span className="font-mono font-bold">00001-01</span></p>
            <p className="text-xs text-muted-foreground">Texto arriba del codigo de barras. Compatible con iOS y Android.</p>
          </div>

          {/* Rango */}
          <div className="space-y-3">
            <Label>Rango de cartones</Label>
            <Select value={rangeType} onValueChange={(v) => setRangeType(v as typeof rangeType)} disabled={isGenerating}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos los cartones del evento</SelectItem>
                <SelectItem value="cards">Por rango de numeros</SelectItem>
                <SelectItem value="series">Por rango de series</SelectItem>
              </SelectContent>
            </Select>

            {rangeType === 'cards' && (
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label className="text-xs">Desde carton #</Label>
                  <Input type="number" value={fromCard} onChange={(e) => setFromCard(parseInt(e.target.value) || 1)} min={1} disabled={isGenerating} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Hasta carton #</Label>
                  <Input type="number" value={toCard} onChange={(e) => setToCard(parseInt(e.target.value) || 500)} min={1} disabled={isGenerating} />
                </div>
              </div>
            )}

            {rangeType === 'series' && (
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label className="text-xs">Desde serie</Label>
                  <Input type="number" value={fromSeries} onChange={(e) => setFromSeries(parseInt(e.target.value) || 1)} min={1} disabled={isGenerating} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Hasta serie</Label>
                  <Input type="number" value={toSeries} onChange={(e) => setToSeries(parseInt(e.target.value) || 10)} min={1} disabled={isGenerating} />
                </div>
                <p className="col-span-2 text-xs text-muted-foreground">Cada serie = 50 cartones</p>
              </div>
            )}
          </div>

          {/* Progress Bar */}
          {isGenerating && progress && (
            <div className="space-y-2 bg-muted/30 rounded-lg p-4 border">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">
                  {progress.status === 'generating'
                    ? 'Generando codigos de barra...'
                    : progress.status === 'zipping'
                      ? 'Comprimiendo ZIP...'
                      : 'Completado'}
                </span>
                <span className="font-bold tabular-nums">
                  {progress.generated.toLocaleString()} / {progress.total.toLocaleString()}
                </span>
              </div>
              <Progress value={progressPercent} className="h-3" />
              <p className="text-xs text-muted-foreground text-center">
                {progressPercent}%
              </p>
            </div>
          )}

          {/* Generate Button */}
          <Button
            onClick={handleGenerate}
            disabled={isGenerating || !selectedEventId}
            className="w-full"
            size="lg"
          >
            {isGenerating ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Generando...
              </>
            ) : (
              <>
                <Barcode className="mr-2 h-4 w-4" />
                Generar Codigos de Barra
              </>
            )}
          </Button>

          {result && (
            <p className="text-xs text-muted-foreground text-center">
              Si genera de nuevo, los barcodes anteriores se reemplazan automaticamente.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Result + Download */}
      {result && !isGenerating && (
        <Card className="border-green-200 dark:border-green-900">
          <CardContent className="pt-6 space-y-4">
            <div className="flex items-start gap-3">
              <CheckCircle className="text-green-600 mt-0.5 h-5 w-5 shrink-0" />
              <div className="flex-1">
                <p className="font-semibold text-green-800 dark:text-green-400">Codigos de Barra Generados</p>
                <div className="grid grid-cols-2 gap-x-6 gap-y-1 mt-2 text-sm">
                  <span className="text-muted-foreground">Evento:</span>
                  <span className="font-medium">{result.event_name}</span>
                  <span className="text-muted-foreground">Cartones:</span>
                  <span className="font-medium">{result.cards_processed.toLocaleString()}</span>
                  <span className="text-muted-foreground">Formato:</span>
                  <span className="font-medium">Code 128</span>
                  {result.zip_size_mb && <>
                    <span className="text-muted-foreground">ZIP:</span>
                    <span className="font-medium">{result.zip_size_mb} MB</span>
                  </>}
                  <span className="text-muted-foreground">Archivo ejemplo:</span>
                  <span className="font-mono text-xs">{result.sample_serial}.png</span>
                </div>
              </div>
            </div>

            <Button
              onClick={handleDownload}
              variant="success"
              className="w-full"
              size="lg"
            >
              <Download className="mr-2 h-4 w-4" />
              Descargar ZIP{result.zip_size_mb ? ` (${result.zip_size_mb} MB)` : ''}
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
