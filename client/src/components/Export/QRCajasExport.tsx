import { useState, useEffect } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import {
  QrCode,
  Download,
  Loader2,
  CheckCircle,
  Package,
} from 'lucide-react';
import { toast } from 'sonner';
import { getEvents, generateQRCajas, getQRCajasProgress, downloadQRCajasZip } from '@/services/api';
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

export default function QRCajasExport() {
  const [selectedEventId, setSelectedEventId] = useState<number | null>(null);
  const [qrSize, setQrSize] = useState(300);
  const [isGenerating, setIsGenerating] = useState(false);
  const [progress, setProgress] = useState<{ total: number; generated: number; status: string } | null>(null);
  const [result, setResult] = useState<{
    event_name: string;
    cajas_processed: number;
    qr_size: string;
    zip_size_mb: string;
  } | null>(null);

  const { data: eventsData } = useQuery({
    queryKey: ['events'],
    queryFn: () => getEvents(),
  });
  const events = (eventsData?.data || []) as BingoEvent[];

  // Polling de progreso
  useEffect(() => {
    if (!isGenerating || !selectedEventId) return;
    const interval = setInterval(async () => {
      try {
        const res = await getQRCajasProgress(selectedEventId);
        if (res.data) {
          setProgress(res.data);
          if (res.data.status === 'completed' || res.data.status === 'error') {
            setIsGenerating(false);
          }
        }
      } catch { /* ignore */ }
    }, 2000);
    return () => clearInterval(interval);
  }, [isGenerating, selectedEventId]);

  const generateMutation = useMutation({
    mutationFn: () => generateQRCajas({ event_id: selectedEventId!, size: qrSize }),
    onSuccess: (data) => {
      setResult(data.data as typeof result);
      setIsGenerating(false);
      toast.success(`${data.data?.cajas_processed} etiquetas QR de cajas generadas`);
    },
    onError: (err: any) => {
      setIsGenerating(false);
      toast.error(err?.response?.data?.error || 'Error generando QR de cajas');
    },
  });

  const handleGenerate = () => {
    if (!selectedEventId) return;
    setIsGenerating(true);
    setProgress(null);
    setResult(null);
    generateMutation.mutate();
  };

  const handleDownload = async () => {
    if (!selectedEventId) return;
    try {
      const blob = await downloadQRCajasZip(selectedEventId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `QR_Cajas_${result?.event_name || 'evento'}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      toast.error('Error descargando ZIP');
    }
  };

  const pct = progress && progress.total > 0
    ? Math.round((progress.generated / progress.total) * 100)
    : 0;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">QR de Cajas</h2>
        <p className="text-muted-foreground">
          Genera etiquetas QR para cada caja con su codigo y rango de lotes
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Package className="h-5 w-5" />
            Configuracion
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Seleccionar evento */}
          <div className="space-y-2">
            <Label>Evento</Label>
            <Select
              value={selectedEventId?.toString() || ''}
              onValueChange={(v) => {
                setSelectedEventId(parseInt(v, 10));
                setResult(null);
                setProgress(null);
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Seleccione un evento" />
              </SelectTrigger>
              <SelectContent>
                {events.map((e) => (
                  <SelectItem key={e.id} value={e.id.toString()}>
                    {e.name} — {e.total_cards.toLocaleString()} cartones
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Tamano del QR */}
          <div className="space-y-2">
            <Label>Tamano del QR (px)</Label>
            <div className="flex items-center gap-3">
              <Input
                type="number"
                min={100}
                max={2000}
                value={qrSize}
                onChange={(e) => setQrSize(parseInt(e.target.value, 10) || 300)}
                className="w-32"
              />
              <div className="flex flex-wrap gap-1">
                {[150, 300, 500, 800, 1000, 1400, 1800, 2000].map((s) => (
                  <Button
                    key={s}
                    variant={qrSize === s ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setQrSize(s)}
                  >
                    {s}
                  </Button>
                ))}
              </div>
            </div>
          </div>

          {/* Boton generar */}
          <Button
            onClick={handleGenerate}
            disabled={!selectedEventId || isGenerating}
            size="lg"
            className="w-full"
          >
            {isGenerating ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Generando...
              </>
            ) : (
              <>
                <QrCode className="mr-2 h-4 w-4" />
                Generar QR de Cajas
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {/* Progreso */}
      {progress && isGenerating && (
        <Card>
          <CardContent className="pt-6 space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">
                {progress.status === 'zipping' ? 'Comprimiendo ZIP...' : `Generando etiquetas...`}
              </span>
              <span className="font-medium">{progress.generated} / {progress.total}</span>
            </div>
            <Progress value={pct} />
          </CardContent>
        </Card>
      )}

      {/* Resultado */}
      {result && (
        <Card className="border-green-500/30 bg-green-500/5">
          <CardContent className="pt-6">
            <div className="flex items-start gap-3">
              <CheckCircle className="h-5 w-5 text-green-500 mt-0.5" />
              <div className="flex-1 space-y-2">
                <p className="font-medium">QR de cajas generados exitosamente</p>
                <div className="grid grid-cols-2 gap-2 text-sm text-muted-foreground">
                  <span>Evento:</span><span className="font-medium text-foreground">{result.event_name}</span>
                  <span>Cajas procesadas:</span><span className="font-medium text-foreground">{result.cajas_processed}</span>
                  <span>Tamano QR:</span><span className="font-medium text-foreground">{result.qr_size}</span>
                  <span>ZIP:</span><span className="font-medium text-foreground">{result.zip_size_mb} MB</span>
                </div>
                <Button onClick={handleDownload} className="mt-3">
                  <Download className="mr-2 h-4 w-4" />
                  Descargar ZIP
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
