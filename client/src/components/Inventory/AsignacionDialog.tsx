import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { createAsignacion, getAlmacenes } from '@/services/api';
import { PROPOSITO_LABELS, type TipoEntidad, type AsignacionProposito } from '@/types';
import SignaturePad from './SignaturePad';

interface AsignacionDialogProps {
  eventId: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const TIPO_ENTIDAD_LABELS: Record<TipoEntidad, string> = {
  caja: 'Caja',
  libreta: 'Libreta',
  carton: 'Carton',
};

export default function AsignacionDialog({ eventId, open, onOpenChange }: AsignacionDialogProps) {
  const queryClient = useQueryClient();
  const [almacenId, setAlmacenId] = useState<string>('');
  const [tipoEntidad, setTipoEntidad] = useState<TipoEntidad>('libreta');
  const [referencia, setReferencia] = useState('');
  const [personaNombre, setPersonaNombre] = useState('');
  const [personaTelefono, setPersonaTelefono] = useState('');
  const [proposito, setProposito] = useState<AsignacionProposito>('venta');
  const [firmaEntrega, setFirmaEntrega] = useState<string | null>(null);
  const [firmaRecibe, setFirmaRecibe] = useState<string | null>(null);

  const { data: almacenesData } = useQuery({
    queryKey: ['almacenes', eventId],
    queryFn: () => getAlmacenes(eventId),
    enabled: open,
  });

  const almacenes = almacenesData?.data ?? [];

  const mutation = useMutation({
    mutationFn: () =>
      createAsignacion({
        event_id: eventId,
        almacen_id: Number(almacenId),
        tipo_entidad: tipoEntidad,
        referencia,
        persona_nombre: personaNombre,
        persona_telefono: personaTelefono || undefined,
        proposito,
        firma_entrega: firmaEntrega || undefined,
        firma_recibe: firmaRecibe || undefined,
        nombre_entrega: 'Entrega',
        nombre_recibe: personaNombre,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['asignaciones', eventId] });
      queryClient.invalidateQueries({ queryKey: ['asignaciones-recientes', eventId] });
      queryClient.invalidateQueries({ queryKey: ['resumen-inventario', eventId] });
      queryClient.invalidateQueries({ queryKey: ['movimientos'] });
      toast.success('Asignacion creada exitosamente');
      resetForm();
      onOpenChange(false);
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.error ?? 'Error al crear asignacion');
    },
  });

  const resetForm = () => {
    setAlmacenId('');
    setTipoEntidad('libreta');
    setReferencia('');
    setPersonaNombre('');
    setPersonaTelefono('');
    setProposito('venta');
    setFirmaEntrega(null);
    setFirmaRecibe(null);
  };

  const canSubmit = almacenId && referencia && personaNombre;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) resetForm(); onOpenChange(v); }}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Nueva Asignacion</DialogTitle>
          <DialogDescription>
            Asignar cartones a una persona para custodia o venta.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="almacen">Almacen</Label>
            <Select value={almacenId} onValueChange={setAlmacenId}>
              <SelectTrigger>
                <SelectValue placeholder="Seleccionar almacen" />
              </SelectTrigger>
              <SelectContent>
                {almacenes.map((a) => (
                  <SelectItem key={a.id} value={a.id.toString()}>
                    {a.name} ({a.code})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="tipoEntidad">Tipo de Entidad</Label>
            <Select value={tipoEntidad} onValueChange={(v) => setTipoEntidad(v as TipoEntidad)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(TIPO_ENTIDAD_LABELS) as TipoEntidad[]).map((t) => (
                  <SelectItem key={t} value={t}>
                    {TIPO_ENTIDAD_LABELS[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="referencia">Referencia (codigo o serie)</Label>
            <Input
              id="referencia"
              value={referencia}
              onChange={(e) => setReferencia(e.target.value)}
              placeholder="Ej: C001 (caja), L00001 (lote) o codigo de carton"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="personaNombre">Nombre de la Persona</Label>
            <Input
              id="personaNombre"
              value={personaNombre}
              onChange={(e) => setPersonaNombre(e.target.value)}
              placeholder="Nombre completo"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="personaTelefono">Telefono (opcional)</Label>
            <Input
              id="personaTelefono"
              value={personaTelefono}
              onChange={(e) => setPersonaTelefono(e.target.value)}
              placeholder="Telefono de contacto"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="proposito">Proposito</Label>
            <Select value={proposito} onValueChange={(v) => setProposito(v as AsignacionProposito)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(PROPOSITO_LABELS) as AsignacionProposito[]).map((p) => (
                  <SelectItem key={p} value={p}>
                    {PROPOSITO_LABELS[p]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {/* Firmas */}
          <div className="border-t pt-4 space-y-3">
            <p className="text-sm font-medium text-muted-foreground">Firmas del acta de entrega</p>
            <div className="grid grid-cols-1 gap-4">
              <SignaturePad label="Firma de quien entrega" onSignatureChange={setFirmaEntrega} />
              <SignaturePad label={`Firma de quien recibe${personaNombre ? ': ' + personaNombre : ''}`} onSignatureChange={setFirmaRecibe} />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={!canSubmit || mutation.isPending || !firmaEntrega}
          >
            {mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Crear Asignacion
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
