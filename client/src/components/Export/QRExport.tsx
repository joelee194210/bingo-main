import { useState, useEffect } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import {
  QrCode,
  Download,
  Loader2,
  CheckCircle,
  Info,
} from 'lucide-react';
import { toast } from 'sonner';
import { getEvents, generateQRCodes, getQRProgress, downloadQRZip } from '@/services/api';
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

const VARIABLES = [
  { key: '{card_code}', label: 'Codigo del carton', example: 'ADMX32' },
  { key: '{validation_code}', label: 'Codigo de validacion', example: 'KN7P5' },
  { key: '{serial}', label: 'Serial', example: '00001-01' },
  { key: '{card_number}', label: 'Numero de carton', example: '1' },
];

export default function QRExport() {
  const [selectedEventId, setSelectedEventId] = useState<number | null>(null);
  const [urlTemplate, setUrlTemplate] = useState('https://www.verify.com/{card_code}');
  const [qrSize, setQrSize] = useState(300);
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
    qr_size: string;
    url_template: string;
    zip_size_mb: string;
    sample_url: string;
  } | null>(null);

  const { data: eventsData } = useQuery({ queryKey: ['events'], queryFn: getEvents });
  const events = eventsData?.data || [];

  // Polling del progreso — unica fuente de verdad para el contador
  useEffect(() => {
    if (!isGenerating || !selectedEventId) return;
    let stopped = false;
    let maxSeen = 0;

    const poll = async () => {
      while (!stopped) {
        await new Promise(r => setTimeout(r, 10000));
        if (stopped) break;
        try {
          const response = await getQRProgress(selectedEventId);
          if (stopped) break;
          if (response.success && response.data) {
            if (response.data.generated >= maxSeen) {
              maxSeen = response.data.generated;
              setProgress(response.data);
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
      const payload: Parameters<typeof generateQRCodes>[0] = {
        event_id: selectedEventId!,
        base_url: urlTemplate,
        size: qrSize,
      };
      if (rangeType === 'cards') {
        payload.from_card = fromCard;
        payload.to_card = toCard;
      } else if (rangeType === 'series') {
        payload.from_series = fromSeries;
        payload.to_series = toSeries;
      }
      return generateQRCodes(payload);
    },
    onSuccess: (data) => {
      // El POST termina cuando todo esta listo (QRs + ZIP)
      // Ahora si marcamos completado
      if (data.data) {
        setResult(data.data);
        setProgress({ total: data.data.cards_processed, generated: data.data.cards_processed, status: 'completed' });
        toast.success(`${data.data.cards_processed.toLocaleString()} QR codes generados`);
      }
      setIsGenerating(false);
    },
    onError: (e: { response?: { data?: { error?: string } } }) => {
      setIsGenerating(false);
      setProgress(null);
      toast.error(e.response?.data?.error || 'Error generando QR codes');
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
      const blob = await downloadQRZip(selectedEventId);
      const url = window.URL.createObjectURL(new Blob([blob]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `QR_${result?.event_name || 'export'}.zip`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch {
      toast.error('Error descargando archivo ZIP');
    }
  };

  const insertVariable = (variable: string) => {
    setUrlTemplate((prev) => prev + variable);
  };

  // Preview de la URL con datos de ejemplo
  const previewUrl = urlTemplate
    .replace(/\{card_code\}/g, 'ADMX32')
    .replace(/\{validation_code\}/g, 'KN7P5')
    .replace(/\{serial\}/g, '00001-01')
    .replace(/\{card_number\}/g, '1');

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
          <QrCode className="h-6 w-6" />
          Exportar QR Codes
        </h2>
        <p className="text-muted-foreground text-sm mt-1">
          Genera codigos QR como imagenes PNG para los cartones de un evento
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

          {/* URL Template */}
          <div className="space-y-3">
            <Label>URL del QR</Label>
            <Input
              value={urlTemplate}
              onChange={(e) => setUrlTemplate(e.target.value)}
              placeholder="https://www.verify.com/{card_code}"
              className="font-mono text-sm"
              disabled={isGenerating}
            />

            {/* Variables disponibles */}
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <Info className="h-3 w-3" />
                Variables disponibles (click para insertar):
              </p>
              <div className="flex flex-wrap gap-2">
                {VARIABLES.map((v) => (
                  <button
                    key={v.key}
                    onClick={() => insertVariable(v.key)}
                    disabled={isGenerating}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-muted hover:bg-muted/80 border border-border transition-colors cursor-pointer disabled:opacity-50"
                  >
                    <code className="text-xs font-semibold text-primary">{v.key}</code>
                    <span className="text-[10px] text-muted-foreground">{v.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Preview */}
            <div className="bg-muted/50 rounded-lg px-3 py-2 border">
              <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider mb-1">Vista previa</p>
              <p className="text-sm font-mono break-all">{previewUrl}</p>
            </div>
          </div>

          {/* Tamano */}
          <div className="space-y-2">
            <Label>Tamano del QR (px)</Label>
            <div className="flex items-center gap-3">
              <Input
                type="number"
                value={qrSize}
                onChange={(e) => setQrSize(Math.max(50, Math.min(2000, parseInt(e.target.value) || 300)))}
                min={50}
                max={2000}
                className="w-28"
                disabled={isGenerating}
              />
              <div className="flex gap-2 flex-wrap">
                {[150, 165, 300, 500, 800, 1000].map((s) => (
                  <Button
                    key={s}
                    variant={qrSize === s ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setQrSize(s)}
                    className="text-xs"
                    disabled={isGenerating}
                  >
                    {s}px
                  </Button>
                ))}
              </div>
            </div>
            <p className="text-xs text-muted-foreground">165px = ~1.4cm en impresion a 300 DPI</p>
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
                    ? 'Generando QR codes...'
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
            disabled={isGenerating || !selectedEventId || !urlTemplate.trim()}
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
                <QrCode className="mr-2 h-4 w-4" />
                Generar QR Codes
              </>
            )}
          </Button>

          {result && (
            <p className="text-xs text-muted-foreground text-center">
              Si genera de nuevo, los QR anteriores se reemplazan automaticamente.
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
                <p className="font-semibold text-green-800 dark:text-green-400">QR Codes Generados</p>
                <div className="grid grid-cols-2 gap-x-6 gap-y-1 mt-2 text-sm">
                  <span className="text-muted-foreground">Evento:</span>
                  <span className="font-medium">{result.event_name}</span>
                  <span className="text-muted-foreground">Cartones:</span>
                  <span className="font-medium">{result.cards_processed.toLocaleString()}</span>
                  <span className="text-muted-foreground">Tamano:</span>
                  <span className="font-medium">{result.qr_size}</span>
                  <span className="text-muted-foreground">ZIP:</span>
                  <span className="font-medium">{result.zip_size_mb} MB</span>
                  <span className="text-muted-foreground">Archivo QR:</span>
                  <span className="font-mono text-xs">00001-01.png</span>
                  <span className="text-muted-foreground">URL ejemplo:</span>
                  <span className="font-mono text-xs break-all">{result.sample_url}</span>
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
              Descargar ZIP ({result.zip_size_mb} MB)
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
