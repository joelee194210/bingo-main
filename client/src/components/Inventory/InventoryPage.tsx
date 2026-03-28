import { useState, useMemo, useEffect } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Warehouse, Plus, Search, Loader2, ChevronRight, Package, Upload,
  ClipboardList, Users, ScanLine, Building2, FileDown, Check,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  getAlmacenTree,
  createAlmacen,
  updateAlmacen,
  getCajas,
  getCajasDisponibles,
  cargarInventario,
  cargarPorReferencia,
  crearInventarioInicial,
  getResumenInventario,
  getDocumentos,
  getDocumento,
  getDocumentoPdf,
  getMovimientos,
  getMovimientoPdf,
  escanearCodigo,
  getEvents,
  getMisAlmacenes,
} from '@/services/api';
import { useAuth } from '@/contexts/AuthContext';
import {
  ESTADO_LABELS,
  PROPOSITO_LABELS,
  type Almacen,
  type AsignacionEstado,
  type AsignacionProposito,
} from '@/types';
import MovimientoDialog from './MovimientoDialog';
import { DataExportMenu } from '@/components/ui/data-export-menu';
import { SortableHeader } from '@/components/ui/sortable-header';
import { getStatusColor } from '@/lib/badge-variants';

// ============================================================
// Almacen Tree Node
// ============================================================
function AlmacenNode({
  almacen,
  level,
  onEdit,
  canEdit = true,
}: {
  almacen: Almacen;
  level: number;
  onEdit: (a: Almacen) => void;
  canEdit?: boolean;
}) {
  const [expanded, setExpanded] = useState(level === 0);
  const hasChildren = almacen.children && almacen.children.length > 0;

  return (
    <div>
      <div
        className="py-2 px-3 rounded-md hover:bg-muted/50 cursor-pointer"
        style={{ paddingLeft: `${level * 24 + 12}px` }}
        onClick={() => hasChildren && setExpanded(!expanded)}
      >
        <div className="flex items-center gap-2">
          {hasChildren ? (
            <ChevronRight className={`h-4 w-4 shrink-0 transition-transform ${expanded ? 'rotate-90' : ''}`} />
          ) : (
            <div className="w-4 shrink-0" />
          )}
          <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
          <span className="font-medium truncate">{almacen.name}</span>
          <span className="text-xs text-muted-foreground font-mono shrink-0">{almacen.code}</span>
          {!almacen.is_active && (
            <Badge variant="outline" className="text-xs shrink-0">Inactivo</Badge>
          )}
          {almacen.es_agencia_loteria && (
            <Badge variant="info" className="text-[10px] shrink-0">Agencia</Badge>
          )}
          {canEdit && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs ml-auto shrink-0"
              onClick={(e) => {
                e.stopPropagation();
                onEdit(almacen);
              }}
            >
              Editar
            </Button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2 mt-1" style={{ marginLeft: `${20 + 16 + 8}px` }}>
          {(almacen.inv_cajas ?? 0) > 0 && (
            <Badge variant="outline" className="text-xs gap-1">
              <Package className="h-3 w-3" />
              {almacen.inv_cajas} cajas
            </Badge>
          )}
          {(almacen.inv_libretas ?? 0) > 0 && (
            <Badge variant="outline" className="text-xs gap-1">
              <ClipboardList className="h-3 w-3" />
              {almacen.inv_libretas} lotes
            </Badge>
          )}
          {(almacen.inv_cartones ?? 0) > 0 && (
            <Badge variant="secondary" className="text-xs">
              {almacen.inv_vendidos ?? 0}/{almacen.inv_cartones} vendidos
            </Badge>
          )}
          {(almacen.inv_cajas ?? 0) === 0 && (almacen.inv_libretas ?? 0) === 0 && (almacen.inv_cartones ?? 0) === 0 && (
            <span className="text-xs text-muted-foreground">Sin inventario</span>
          )}
        </div>
      </div>
      {expanded && hasChildren && (
        <div>
          {almacen.children!.map((child) => (
            <AlmacenNode key={child.id} almacen={child} level={level + 1} onEdit={onEdit} canEdit={canEdit} />
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================
// Main Component
// ============================================================
export default function InventoryPage() {
  const { eventId: eventIdParam } = useParams<{ eventId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user, hasPermission } = useAuth();
  const isAdmin = user?.role === 'admin';
  // Admin, moderator y loteria ven todo; inventory/seller solo su almacén
  const canSeeAll = user?.role === 'admin' || user?.role === 'moderator' || user?.role === 'loteria';
  const [searchParams, setSearchParams] = useSearchParams();
  const [selectedEventId, setSelectedEventId] = useState<number | undefined>(
    eventIdParam ? Number(eventIdParam) : undefined
  );

  const { data: eventsData } = useQuery({
    queryKey: ['events'],
    queryFn: getEvents,
  });
  const eventsList = useMemo(() => eventsData?.data || [], [eventsData?.data]);

  const eventId = selectedEventId || (eventIdParam ? Number(eventIdParam) : 0);

  // Auto-select first event if none selected and no URL param
  useEffect(() => {
    if (!eventId && eventsList.length > 0 && !selectedEventId) {
      setSelectedEventId(eventsList[0].id);
    }
  }, [eventId, eventsList, selectedEventId]);

  const defaultTab = searchParams.get('tab') || 'almacenes';

  // Almacen dialog state
  const [showAlmacenDialog, setShowAlmacenDialog] = useState(false);
  const [editingAlmacen, setEditingAlmacen] = useState<Almacen | null>(null);
  const [almacenForm, setAlmacenForm] = useState({
    name: '',
    code: '',
    parent_id: '__none__',
    address: '',
    contact_name: '',
    contact_phone: '',
    es_agencia_loteria: false,
  });

  // Asignacion dialog
  // Movimiento unificado dialog
  const [showMovimientoDialog, setShowMovimientoDialog] = useState(false);

  // Filters
  const [asignacionAlmacenFilter, setAsignacionAlmacenFilter] = useState<string>('__all__');

  // Scan
  const [scanInput, setScanInput] = useState('');
  const [scanResult, setScanResult] = useState<any>(null);
  const [scanning, setScanning] = useState(false);

  // Cargar inventario
  const [showCargarDialog, setShowCargarDialog] = useState(false);
  const [cargarAlmacenId, setCargarAlmacenId] = useState<string>('');
  const [selectedCajaIds, setSelectedCajaIds] = useState<number[]>([]);
  const [cargarTipo, setCargarTipo] = useState<'caja' | 'libreta' | 'carton'>('caja');
  const [cargarReferencia, setCargarReferencia] = useState('');

  // Cajas/Lotes search & sort
  const [invSearch, setInvSearch] = useState('');
  const [cajasSort, setCajasSort] = useState<{ column: string | null; direction: 'asc' | 'desc' | null }>({ column: null, direction: null });
  const [lotesSort, setLotesSort] = useState<{ column: string | null; direction: 'asc' | 'desc' | null }>({ column: null, direction: null });
  // Movimientos search & filters
  const [movSearch, setMovSearch] = useState('');
  const [movAccionFilter, setMovAccionFilter] = useState('__all__');
  const [movFechaDesde, setMovFechaDesde] = useState('');
  const [movFechaHasta, setMovFechaHasta] = useState('');

  // ---- Queries ----

  // Para no-admin: obtener almacén asignado
  const { data: misAlmacenesData } = useQuery({
    queryKey: ['mis-almacenes'],
    queryFn: getMisAlmacenes,
    enabled: !canSeeAll,
  });

  // Auto-seleccionar evento del operador si no tiene uno
  useEffect(() => {
    if (!canSeeAll && !selectedEventId && misAlmacenesData?.data?.length) {
      setSelectedEventId(misAlmacenesData.data[0].event_id);
    }
  }, [canSeeAll, selectedEventId, misAlmacenesData]);

  const miAlmacen = misAlmacenesData?.data?.find(a => a.event_id === eventId);
  const miAlmacenId = canSeeAll ? undefined : miAlmacen?.almacen_id;

  const { data: treeData, isLoading: treeLoading } = useQuery({
    queryKey: ['almacen-tree', eventId],
    queryFn: () => getAlmacenTree(eventId),
    enabled: !!eventId,
  });

  // B4: almacenes flat list derivada del tree (elimina query duplicada)

  const { data: resumenData, isLoading: resumenLoading } = useQuery({
    queryKey: ['resumen-inventario', eventId, miAlmacenId],
    queryFn: () => getResumenInventario(eventId, miAlmacenId),
    enabled: !!eventId,
  });

  const { data: cajasData, isLoading: cajasLoading } = useQuery({
    queryKey: ['cajas', eventId, miAlmacenId],
    queryFn: () => getCajas(eventId, miAlmacenId),
    enabled: !!eventId,
  });

  const { data: cajasDispData } = useQuery({
    queryKey: ['cajas-disponibles', eventId],
    queryFn: () => getCajasDisponibles(eventId),
    enabled: showCargarDialog,
  });


  const movimientoParams: Record<string, any> = { limit: 100 };
  if (asignacionAlmacenFilter && asignacionAlmacenFilter !== '__all__') movimientoParams.almacen_id = Number(asignacionAlmacenFilter);
  else if (miAlmacenId) movimientoParams.almacen_id = miAlmacenId;

  const { data: movimientosData, isLoading: movimientosLoading } = useQuery({
    queryKey: ['movimientos', eventId, movimientoParams],
    queryFn: () => getMovimientos(eventId, movimientoParams),
    enabled: !!eventId,
  });

  const { data: documentosData, isLoading: documentosLoading } = useQuery({
    queryKey: ['documentos', eventId, movimientoParams],
    queryFn: () => getDocumentos(eventId, movimientoParams),
    enabled: !!eventId,
  });

  const [selectedDocumentoId, setSelectedDocumentoId] = useState<number | null>(null);
  const [selectedLegacyGroup, setSelectedLegacyGroup] = useState<typeof movimientosAgrupados[0] | null>(null);
  const { data: documentoDetalle } = useQuery({
    queryKey: ['documento-detalle', selectedDocumentoId],
    queryFn: () => getDocumento(selectedDocumentoId!),
    enabled: !!selectedDocumentoId,
  });

  const fullTree = useMemo(() => treeData?.data ?? [], [treeData?.data]);
  // Filtrar árbol: operadores solo ven su almacén (búsqueda recursiva)
  const tree = useMemo(() => {
    if (canSeeAll || !miAlmacenId) return fullTree;
    const findNode = (nodes: typeof fullTree): typeof fullTree => {
      for (const n of nodes) {
        if (n.id === miAlmacenId) return [{ ...n, children: n.children || [] }];
        if (n.children?.length) {
          const found = findNode(n.children as typeof fullTree);
          if (found.length > 0) return found;
        }
      }
      return [];
    };
    return findNode(fullTree);
  }, [fullTree, canSeeAll, miAlmacenId]);
  // B4: derivar lista plana del tree en lugar de query separada
  const almacenes = useMemo(() => {
    const flat: typeof tree = [];
    const walk = (nodes: typeof tree) => {
      for (const n of nodes) {
        flat.push(n);
        if ((n as any).children?.length) walk((n as any).children);
      }
    };
    walk(tree);
    return flat;
  }, [tree]);
  const resumen = resumenData?.data;
  const cajas = useMemo(() => cajasData?.data ?? [], [cajasData?.data]);
  const movimientos = useMemo(() => movimientosData?.data ?? [], [movimientosData?.data]);
  const documentos = useMemo(() => documentosData?.data ?? [], [documentosData?.data]);

  const toggleCajasSort = (column: string) => {
    setCajasSort(prev => {
      if (prev.column !== column) return { column, direction: 'asc' };
      if (prev.direction === 'asc') return { column, direction: 'desc' };
      return { column: null, direction: null };
    });
  };

  const toggleLotesSort = (column: string) => {
    setLotesSort(prev => {
      if (prev.column !== column) return { column, direction: 'asc' };
      if (prev.direction === 'asc') return { column, direction: 'desc' };
      return { column: null, direction: null };
    });
  };

  const filteredCajas = useMemo(() => {
    let result = cajas;
    if (invSearch.trim()) {
      const q = invSearch.toLowerCase();
      result = result.filter((c: any) =>
        c.caja_code?.toLowerCase().includes(q) ||
        c.status?.toLowerCase().includes(q)
      );
    }
    if (cajasSort.column && cajasSort.direction) {
      const col = cajasSort.column;
      const dir = cajasSort.direction === 'asc' ? 1 : -1;
      result = [...result].sort((a: any, b: any) => {
        const aVal = a[col]; const bVal = b[col];
        if (aVal === bVal) return 0;
        if (aVal == null) return 1; if (bVal == null) return -1;
        if (typeof aVal === 'number' && typeof bVal === 'number') return (aVal - bVal) * dir;
        return String(aVal).localeCompare(String(bVal)) * dir;
      });
    }
    return result;
  }, [cajas, invSearch, cajasSort]);

  const allLotes = useMemo(() => cajas.flatMap((c: any) => c.lotes.map((l: any) => ({ ...l, caja_code: c.caja_code }))), [cajas]);

  const filteredLotes = useMemo(() => {
    let result = allLotes;
    if (invSearch.trim()) {
      const q = invSearch.toLowerCase();
      result = result.filter((l: any) =>
        l.lote_code?.toLowerCase().includes(q) ||
        l.caja_code?.toLowerCase().includes(q) ||
        l.series_number?.toString().includes(q) ||
        l.status?.toLowerCase().includes(q)
      );
    }
    if (lotesSort.column && lotesSort.direction) {
      const col = lotesSort.column;
      const dir = lotesSort.direction === 'asc' ? 1 : -1;
      result = [...result].sort((a: any, b: any) => {
        const aVal = a[col]; const bVal = b[col];
        if (aVal === bVal) return 0;
        if (aVal == null) return 1; if (bVal == null) return -1;
        if (typeof aVal === 'number' && typeof bVal === 'number') return (aVal - bVal) * dir;
        return String(aVal).localeCompare(String(bVal)) * dir;
      });
    }
    return result;
  }, [allLotes, invSearch, lotesSort]);

  const filteredDocumentos = useMemo(() => {
    let result = documentos as any[];
    if (movAccionFilter !== '__all__') {
      result = result.filter((d: any) => d.accion === movAccionFilter);
    }
    if (movFechaDesde) {
      const desde = new Date(movFechaDesde);
      result = result.filter((d: any) => new Date(d.created_at) >= desde);
    }
    if (movFechaHasta) {
      const hasta = new Date(movFechaHasta + 'T23:59:59');
      result = result.filter((d: any) => new Date(d.created_at) <= hasta);
    }
    if (movSearch.trim()) {
      const q = movSearch.toLowerCase();
      result = result.filter((d: any) =>
        d.accion?.toLowerCase().includes(q) ||
        d.de_nombre?.toLowerCase().includes(q) ||
        d.a_nombre?.toLowerCase().includes(q) ||
        d.realizado_por_nombre?.toLowerCase().includes(q) ||
        `DOC-${d.id.toString().padStart(6, '0')}`.toLowerCase().includes(q)
      );
    }
    return result;
  }, [documentos, movSearch, movAccionFilter, movFechaDesde, movFechaHasta]);

  const CAJAS_EXPORT_COLUMNS = [
    { key: 'caja_code', label: 'Caja' },
    { key: 'total_lotes', label: 'Lotes' },
    { key: 'total_cartones', label: 'Cartones' },
    { key: 'asignados', label: 'Vendidos' },
    { key: 'status', label: 'Estado' },
  ];

  const LOTES_EXPORT_COLUMNS = [
    { key: 'lote_code', label: 'Lote' },
    { key: 'caja_code', label: 'Caja' },
    { key: 'series_number', label: 'Serie' },
    { key: 'total_cards', label: 'Cartones' },
    { key: 'cards_sold', label: 'Vendidos' },
    { key: 'status', label: 'Estado' },
  ];

  const MOVIMIENTOS_EXPORT_COLUMNS = [
    { key: 'id', label: 'No. Doc' },
    { key: 'created_at', label: 'Fecha' },
    { key: 'accion', label: 'Accion' },
    { key: 'de_nombre', label: 'De' },
    { key: 'a_nombre', label: 'A' },
    { key: 'total_items', label: 'Items' },
    { key: 'total_cartones', label: 'Cartones' },
    { key: 'realizado_por_nombre', label: 'Realizado por' },
  ];

  // Agrupar movimientos legacy (sin documento) por timestamp+accion+almacen
  const movimientosAgrupados = useMemo(() => {
    const sinDoc = movimientos.filter((m: any) => !m.documento_id);
    const groups: Record<string, typeof sinDoc> = {};
    for (const m of sinDoc) {
      const key = `${new Date(m.created_at).toISOString().slice(0, 19)}_${m.accion}_${m.a_persona || ''}`;
      if (!groups[key]) groups[key] = [];
      groups[key].push(m);
    }
    return Object.values(groups).map(items => ({
      id: items[0].id,
      items,
      created_at: items[0].created_at,
      accion: items[0].accion,
      de_persona: items[0].de_persona,
      a_persona: items[0].a_persona,
      total_items: items.length,
      total_cartones: items.reduce((sum, m) => sum + (m.cantidad_cartones || 0), 0),
      realizado_por_nombre: items[0].realizado_por_nombre,
      has_pdf: items.some(m => m.pdf_path),
      pdf_mov_id: items.find(m => m.pdf_path)?.id,
    }));
  }, [movimientos]);

  const filteredMovAgrupados = useMemo(() => {
    let result = movimientosAgrupados;
    if (movAccionFilter !== '__all__') {
      result = result.filter((g: any) => g.accion === movAccionFilter);
    }
    if (movFechaDesde) {
      const desde = new Date(movFechaDesde);
      result = result.filter((g: any) => new Date(g.created_at) >= desde);
    }
    if (movFechaHasta) {
      const hasta = new Date(movFechaHasta + 'T23:59:59');
      result = result.filter((g: any) => new Date(g.created_at) <= hasta);
    }
    if (movSearch.trim()) {
      const q = movSearch.toLowerCase();
      result = result.filter((g: any) =>
        g.accion?.toLowerCase().includes(q) ||
        g.de_persona?.toLowerCase().includes(q) ||
        g.a_persona?.toLowerCase().includes(q) ||
        g.realizado_por_nombre?.toLowerCase().includes(q)
      );
    }
    return result;
  }, [movimientosAgrupados, movSearch, movAccionFilter, movFechaDesde, movFechaHasta]);

  const handleDownloadDocPdf = async (docId: number) => {
    try {
      const blob = await getDocumentoPdf(docId);
      if (blob.size < 100 || blob.type === 'application/json') {
        toast.error('PDF no disponible para este documento');
        return;
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `MOV-${docId.toString().padStart(6, '0')}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error('PDF no disponible');
    }
  };

  const handleDownloadMovPdf = async (movId: number) => {
    try {
      const blob = await getMovimientoPdf(movId);
      if (blob.size < 100 || blob.type === 'application/json') {
        toast.error('PDF no disponible para este movimiento');
        return;
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `MOV-${movId.toString().padStart(6, '0')}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error('PDF no disponible');
    }
  };

  // ---- Mutations ----

  const createAlmacenMutation = useMutation({
    mutationFn: () =>
      createAlmacen({
        event_id: eventId,
        name: almacenForm.name,
        code: almacenForm.code || undefined,
        parent_id: almacenForm.parent_id && almacenForm.parent_id !== '__none__' ? Number(almacenForm.parent_id) : undefined,
        address: almacenForm.address || undefined,
        contact_name: almacenForm.contact_name || undefined,
        contact_phone: almacenForm.contact_phone || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['almacen-tree'] });

      toast.success('Almacen creado exitosamente');
      setShowAlmacenDialog(false);
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.error ?? 'Error al crear almacen');
    },
  });

  const updateAlmacenMutation = useMutation({
    mutationFn: () =>
      updateAlmacen(editingAlmacen!.id, {
        name: almacenForm.name || undefined,
        parent_id: almacenForm.parent_id && almacenForm.parent_id !== '__none__' ? Number(almacenForm.parent_id) : null,
        address: almacenForm.address || undefined,
        contact_name: almacenForm.contact_name || undefined,
        contact_phone: almacenForm.contact_phone || undefined,
        es_agencia_loteria: almacenForm.es_agencia_loteria,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['almacen-tree'] });

      toast.success('Almacen actualizado');
      setShowAlmacenDialog(false);
      setEditingAlmacen(null);
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.error ?? 'Error al actualizar almacen');
    },
  });

  const invalidateInventario = () => {
    queryClient.invalidateQueries({ queryKey: ['almacen-tree'] });
    queryClient.invalidateQueries({ queryKey: ['resumen-inventario'] });
    queryClient.invalidateQueries({ queryKey: ['cajas-disponibles'] });
    queryClient.invalidateQueries({ queryKey: ['libretas-sueltas'] });
    queryClient.invalidateQueries({ queryKey: ['cartones-sueltos'] });
    queryClient.invalidateQueries({ queryKey: ['cajas'] });
    queryClient.invalidateQueries({ queryKey: ['movimientos'] });
    queryClient.invalidateQueries({ queryKey: ['documentos'] });
  };

  const cargarMutation = useMutation({
    mutationFn: () =>
      cargarInventario({
        event_id: eventId,
        almacen_id: Number(cargarAlmacenId),
        caja_ids: selectedCajaIds,
      }),
    onSuccess: (res) => {
      invalidateInventario();
      toast.success(`${res.data?.cargadas ?? 0} cajas cargadas al almacen`);
      setShowCargarDialog(false);
      setCargarAlmacenId('');
      setSelectedCajaIds([]);
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.error ?? 'Error al cargar inventario');
    },
  });

  const cargarRefMutation = useMutation({
    mutationFn: () =>
      cargarPorReferencia({
        event_id: eventId,
        almacen_id: Number(cargarAlmacenId),
        tipo_entidad: cargarTipo,
        referencia: cargarReferencia.trim(),
      }),
    onSuccess: (res) => {
      invalidateInventario();
      const d = res.data;
      toast.success(`${d?.tipo} "${d?.referencia}" cargada (${d?.cartones} cartones)`);
      setCargarReferencia('');
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.error ?? 'Error al cargar');
    },
  });

  const inventarioInicialMutation = useMutation({
    mutationFn: () => crearInventarioInicial(eventId),
    onSuccess: (res) => {
      invalidateInventario();
      const d = res.data;
      if (d?.cajasAsignadas === 0) {
        toast.info(d.message || 'Todas las cajas ya estan en el almacen raiz');
      } else {
        toast.success(`${d?.cajasAsignadas} cajas asignadas al almacen "${d?.almacen}"`);
      }
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.error ?? 'Error al crear inventario inicial');
    },
  });

  // ---- Handlers ----

  const openCreateAlmacen = () => {
    setEditingAlmacen(null);
    setAlmacenForm({ name: '', code: '', parent_id: '__none__', address: '', contact_name: '', contact_phone: '', es_agencia_loteria: false });
    setShowAlmacenDialog(true);
  };

  const openEditAlmacen = (a: Almacen) => {
    setEditingAlmacen(a);
    setAlmacenForm({
      name: a.name,
      code: a.code,
      parent_id: a.parent_id?.toString() ?? '__none__',
      address: a.address ?? '',
      contact_name: a.contact_name ?? '',
      contact_phone: a.contact_phone ?? '',
      es_agencia_loteria: !!a.es_agencia_loteria,
    });
    setShowAlmacenDialog(true);
  };

  const handleScan = async () => {
    if (!scanInput.trim()) return;
    setScanning(true);
    setScanResult(null);
    try {
      const res = await escanearCodigo(eventId, scanInput.trim());
      setScanResult(res.data);
    } catch (err: any) {
      toast.error(err.response?.data?.error ?? 'Codigo no encontrado');
      setScanResult(null);
    } finally {
      setScanning(false);
    }
  };

  const handleTabChange = (tab: string) => {
    setSearchParams({ tab });
  };

  return (
    <div className="space-y-6">
      {/* Header with event selector */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Inventario</h1>
        </div>
        <div className="flex items-center gap-3 w-full sm:w-auto">
          <Label className="text-sm font-medium whitespace-nowrap">Evento / Bingo:</Label>
          <Select
            value={eventId ? String(eventId) : ''}
            onValueChange={(val) => setSelectedEventId(Number(val))}
          >
            <SelectTrigger className="w-full sm:w-[280px]">
              <SelectValue placeholder="Seleccionar evento..." />
            </SelectTrigger>
            <SelectContent>
              {eventsList.map((ev) => (
                <SelectItem key={ev.id} value={String(ev.id)}>
                  {ev.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {!eventId && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Warehouse className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-lg font-medium text-muted-foreground">Selecciona un evento para ver el inventario</p>
          </CardContent>
        </Card>
      )}

      {!!eventId && <>
      {/* Summary Cards */}
      <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 md:grid-cols-5">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Cajas</CardTitle>
            <Package className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {resumenLoading ? <Skeleton className="h-8 w-20" /> : (
              <div className="text-2xl font-bold">{resumen?.totalCajas ?? 0}</div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Lotes</CardTitle>
            <ClipboardList className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {resumenLoading ? <Skeleton className="h-8 w-20" /> : (
              <div className="text-2xl font-bold">{resumen?.totalLibretas ?? 0}</div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Cartones</CardTitle>
            <Package className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {resumenLoading ? <Skeleton className="h-8 w-20" /> : (
              <div className="text-2xl font-bold">{resumen?.totalCartones ?? 0}</div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Vendidos</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {resumenLoading ? <Skeleton className="h-8 w-20" /> : (
              <div className="text-2xl font-bold text-blue-600">{resumen?.cartonesAsignados ?? 0}</div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Disponibles</CardTitle>
            <Package className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {resumenLoading ? <Skeleton className="h-8 w-20" /> : (
              <div className="text-2xl font-bold text-green-600">{resumen?.cartonesDisponibles ?? 0}</div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs value={defaultTab} onValueChange={handleTabChange}>
        <TabsList className="grid w-full grid-cols-2 sm:grid-cols-4">
          <TabsTrigger value="almacenes">
            <Warehouse className="mr-2 h-4 w-4" />
            Almacenes
          </TabsTrigger>
          <TabsTrigger value="inventario">
            <Package className="mr-2 h-4 w-4" />
            Inventario
          </TabsTrigger>
          <TabsTrigger value="movimientos">
            <ClipboardList className="mr-2 h-4 w-4" />
            Movimientos
          </TabsTrigger>
          <TabsTrigger value="escanear">
            <ScanLine className="mr-2 h-4 w-4" />
            Escanear
          </TabsTrigger>
        </TabsList>

        {/* ============ ALMACENES TAB ============ */}
        <TabsContent value="almacenes" className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <h2 className="text-lg font-semibold">Almacenes</h2>
            <div className="flex flex-wrap gap-2">
              {isAdmin && (resumen?.cajasSinAlmacen ?? 0) > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => inventarioInicialMutation.mutate()}
                  disabled={inventarioInicialMutation.isPending}
                >
                  {inventarioInicialMutation.isPending ? (
                    <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                  ) : (
                    <Package className="mr-1 h-4 w-4" />
                  )}
                  <span className="hidden sm:inline">Crear </span>Inventario
                </Button>
              )}
              {hasPermission('inventory:move') && (
                <Button variant="outline" size="sm" onClick={() => setShowMovimientoDialog(true)}>
                  <Upload className="mr-1 h-4 w-4" />
                  Movimiento
                </Button>
              )}
              {canSeeAll && (
                <Button size="sm" onClick={openCreateAlmacen}>
                  <Plus className="mr-1 h-4 w-4" />
                  Almacen
                </Button>
              )}
            </div>
          </div>

          <Card>
            <CardContent className="pt-4">
              {treeLoading ? (
                <div className="space-y-2">
                  <Skeleton className="h-8 w-full" />
                  <Skeleton className="h-8 w-full" />
                  <Skeleton className="h-8 w-full" />
                </div>
              ) : tree.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">
                  No hay almacenes registrados. Crea el primero.
                </p>
              ) : (
                <div className="divide-y">
                  {tree.map((a) => (
                    <AlmacenNode key={a.id} almacen={a} level={0} onEdit={openEditAlmacen} canEdit={canSeeAll} />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ============ INVENTARIO TAB ============ */}
        <TabsContent value="inventario" className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <h2 className="text-lg font-semibold">Cajas y Lotes</h2>
            <div className="flex items-center gap-2 w-full sm:w-auto">
              <div className="relative flex-1 sm:flex-none sm:w-64">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground h-4 w-4" />
                <Input className="pl-9 h-9" placeholder="Buscar caja, lote, serie..." value={invSearch} onChange={(e) => setInvSearch(e.target.value)} />
              </div>
              <DataExportMenu data={filteredCajas as unknown as Record<string, unknown>[]} columns={CAJAS_EXPORT_COLUMNS} filename="cajas" />
            </div>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Cajas</CardTitle>
            </CardHeader>
            <CardContent>
              {cajasLoading ? (
                <Skeleton className="h-32 w-full" />
              ) : cajas.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">
                  No hay cajas registradas. Genera cartones para crear cajas automaticamente.
                </p>
              ) : (
                <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead><SortableHeader label="Caja" column="caja_code" sort={cajasSort} onSort={toggleCajasSort} /></TableHead>
                      <TableHead><SortableHeader label="Lotes" column="total_lotes" sort={cajasSort} onSort={toggleCajasSort} /></TableHead>
                      <TableHead><SortableHeader label="Cartones" column="total_cartones" sort={cajasSort} onSort={toggleCajasSort} /></TableHead>
                      <TableHead><SortableHeader label="Vendidos" column="asignados" sort={cajasSort} onSort={toggleCajasSort} /></TableHead>
                      <TableHead>Disponibles</TableHead>
                      <TableHead><SortableHeader label="Estado" column="status" sort={cajasSort} onSort={toggleCajasSort} /></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredCajas.map((c: any) => (
                      <TableRow key={c.id}>
                        <TableCell className="font-mono font-medium">{c.caja_code}</TableCell>
                        <TableCell>{c.total_lotes} lotes</TableCell>
                        <TableCell>{c.total_cartones}</TableCell>
                        <TableCell>{c.asignados}</TableCell>
                        <TableCell className="text-green-600 font-medium">
                          {c.total_cartones - c.asignados}
                        </TableCell>
                        <TableCell>
                          <Badge className={getStatusColor(c.status) + ' text-xs'}>{c.status}</Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Lotes dentro de cada caja */}
          {cajas.length > 0 && (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between w-full">
                  <CardTitle className="text-base">Lotes</CardTitle>
                  <DataExportMenu data={filteredLotes as unknown as Record<string, unknown>[]} columns={LOTES_EXPORT_COLUMNS} filename="lotes" />
                </div>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead><SortableHeader label="Lote" column="lote_code" sort={lotesSort} onSort={toggleLotesSort} /></TableHead>
                      <TableHead><SortableHeader label="Caja" column="caja_code" sort={lotesSort} onSort={toggleLotesSort} /></TableHead>
                      <TableHead><SortableHeader label="Serie" column="series_number" sort={lotesSort} onSort={toggleLotesSort} /></TableHead>
                      <TableHead><SortableHeader label="Cartones" column="total_cards" sort={lotesSort} onSort={toggleLotesSort} /></TableHead>
                      <TableHead><SortableHeader label="Vendidos" column="cards_sold" sort={lotesSort} onSort={toggleLotesSort} /></TableHead>
                      <TableHead><SortableHeader label="Estado" column="status" sort={lotesSort} onSort={toggleLotesSort} /></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredLotes.map((l: any) => (
                        <TableRow key={l.id}>
                          <TableCell className="font-mono font-medium">{l.lote_code}</TableCell>
                          <TableCell className="font-mono text-sm">{l.caja_code}</TableCell>
                          <TableCell className="font-mono text-sm">{l.series_number}</TableCell>
                          <TableCell>{l.total_cards}</TableCell>
                          <TableCell>{l.cards_sold}</TableCell>
                          <TableCell>
                            <Badge className={getStatusColor(l.status) + ' text-xs'}>{l.status.replace('_', ' ')}</Badge>
                          </TableCell>
                        </TableRow>
                    ))}
                  </TableBody>
                </Table>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ============ MOVIMIENTOS TAB ============ */}
        <TabsContent value="movimientos" className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <h2 className="text-lg font-semibold">Movimientos</h2>
            <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
              <div className="relative flex-1 sm:flex-none sm:w-64">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground h-4 w-4" />
                <Input className="pl-9 h-9" placeholder="Buscar movimiento..." value={movSearch} onChange={(e) => setMovSearch(e.target.value)} />
              </div>
              <DataExportMenu data={documentos as unknown as Record<string, unknown>[]} columns={MOVIMIENTOS_EXPORT_COLUMNS} filename="movimientos" />
              {hasPermission('inventory:move') && (
                <Button size="sm" onClick={() => setShowMovimientoDialog(true)}>
                  <Plus className="mr-1 h-4 w-4" />
                  <span className="hidden sm:inline">Nuevo </span>Movimiento
                </Button>
              )}
            </div>
          </div>

          {/* Filters */}
          <div className="flex flex-wrap gap-3">
            <div className="w-full sm:w-48">
              <Select value={asignacionAlmacenFilter} onValueChange={setAsignacionAlmacenFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="Todos los almacenes" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">Todos</SelectItem>
                  {almacenes.map((a) => (
                    <SelectItem key={a.id} value={a.id.toString()}>
                      {a.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="w-full sm:w-48">
              <Select value={movAccionFilter} onValueChange={setMovAccionFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="Tipo de movimiento" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">Todos los tipos</SelectItem>
                  <SelectItem value="venta">Venta</SelectItem>
                  <SelectItem value="traslado">Traslado</SelectItem>
                  <SelectItem value="carga_inventario">Carga inventario</SelectItem>
                  <SelectItem value="consignacion">Consignacion</SelectItem>
                  <SelectItem value="devolucion">Devolucion</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <Input
                type="date"
                className="h-9 w-36"
                value={movFechaDesde}
                onChange={(e) => setMovFechaDesde(e.target.value)}
                placeholder="Desde"
              />
              <span className="text-sm text-muted-foreground">a</span>
              <Input
                type="date"
                className="h-9 w-36"
                value={movFechaHasta}
                onChange={(e) => setMovFechaHasta(e.target.value)}
                placeholder="Hasta"
              />
              {(movFechaDesde || movFechaHasta) && (
                <Button variant="ghost" size="sm" onClick={() => { setMovFechaDesde(''); setMovFechaHasta(''); }}>
                  Limpiar
                </Button>
              )}
            </div>
          </div>

          <Card>
            <CardContent className="pt-4">
              {(documentosLoading || movimientosLoading) ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : (filteredDocumentos.length === 0 && filteredMovAgrupados.length === 0) ? (
                <p className="text-sm text-muted-foreground text-center py-8">
                  No hay movimientos registrados
                </p>
              ) : (
                <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>No. Doc</TableHead>
                      <TableHead className="hidden sm:table-cell">Fecha</TableHead>
                      <TableHead>Accion</TableHead>
                      <TableHead className="hidden md:table-cell">De</TableHead>
                      <TableHead className="hidden md:table-cell">A</TableHead>
                      <TableHead className="hidden sm:table-cell">Items</TableHead>
                      <TableHead>Cartones</TableHead>
                      <TableHead className="hidden lg:table-cell">Realizado por</TableHead>
                      <TableHead>Acta</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {/* Documentos nuevos (agrupados) */}
                    {filteredDocumentos.map((d: any) => (
                      <TableRow
                        key={`doc-${d.id}`}
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() => setSelectedDocumentoId(d.id)}
                      >
                        <TableCell className="font-mono text-xs font-semibold text-primary">
                          DOC-{d.id.toString().padStart(6, '0')}
                        </TableCell>
                        <TableCell className="hidden sm:table-cell text-sm text-muted-foreground whitespace-nowrap">
                          {new Date(d.created_at).toLocaleString()}
                        </TableCell>
                        <TableCell>
                          <Badge className={getStatusColor(d.accion) + ' text-xs capitalize'}>{(d.accion || '').replace(/_/g, ' ')}</Badge>
                        </TableCell>
                        <TableCell className="hidden md:table-cell text-sm">{d.de_nombre || '-'}</TableCell>
                        <TableCell className="hidden md:table-cell text-sm">
                          {d.a_nombre || '-'}
                          {(d.a_libreta || d.a_cedula) && (
                            <div className="text-xs text-muted-foreground mt-0.5">
                              {d.a_libreta && <span>No. Bil: {d.a_libreta}</span>}
                              {d.a_libreta && d.a_cedula && <span> · </span>}
                              {d.a_cedula && <span>CI: {d.a_cedula}</span>}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="hidden sm:table-cell text-sm">{d.total_items}</TableCell>
                        <TableCell>{d.total_cartones?.toLocaleString()}</TableCell>
                        <TableCell className="hidden lg:table-cell text-sm">{d.realizado_por_nombre}</TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-label="Descargar PDF"
                            onClick={(e) => { e.stopPropagation(); handleDownloadDocPdf(d.id); }}
                          >
                            <FileDown className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                    {/* Movimientos legacy agrupados */}
                    {filteredMovAgrupados.map((g: any) => (
                      <TableRow
                        key={`grp-${g.id}`}
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() => setSelectedLegacyGroup(g)}
                      >
                        <TableCell className="font-mono text-xs text-muted-foreground">
                          MOV-{g.id.toString().padStart(6, '0')}
                        </TableCell>
                        <TableCell className="hidden sm:table-cell text-sm text-muted-foreground whitespace-nowrap">
                          {new Date(g.created_at).toLocaleString()}
                        </TableCell>
                        <TableCell>
                          <Badge className={getStatusColor(g.accion) + ' text-xs capitalize'}>{g.accion.replace(/_/g, ' ')}</Badge>
                        </TableCell>
                        <TableCell className="hidden md:table-cell text-sm">{g.de_persona || '-'}</TableCell>
                        <TableCell className="hidden md:table-cell text-sm">{g.a_persona || '-'}</TableCell>
                        <TableCell className="hidden sm:table-cell text-sm">{g.total_items}</TableCell>
                        <TableCell>{g.total_cartones.toLocaleString()}</TableCell>
                        <TableCell className="hidden lg:table-cell text-sm">{g.realizado_por_nombre}</TableCell>
                        <TableCell>
                          {g.has_pdf && g.pdf_mov_id ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              aria-label="Descargar PDF"
                              onClick={(e) => { e.stopPropagation(); handleDownloadMovPdf(g.pdf_mov_id!); }}
                            >
                              <FileDown className="h-4 w-4" />
                            </Button>
                          ) : (
                            <span className="text-xs text-muted-foreground">-</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Detalle del documento */}
          <Dialog open={!!selectedDocumentoId} onOpenChange={(v) => { if (!v) setSelectedDocumentoId(null); }}>
            <DialogContent className="sm:max-w-2xl max-h-[80vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>
                  Documento MOV-{selectedDocumentoId?.toString().padStart(6, '0')}
                </DialogTitle>
                <DialogDescription>
                  {documentoDetalle?.data?.documento && (
                    <>
                      {(documentoDetalle.data.documento.accion || '').replace(/_/g, ' ')} — {' '}
                      {documentoDetalle.data.documento.de_nombre || '-'} → {documentoDetalle.data.documento.a_nombre || '-'}
                      {(documentoDetalle.data.documento.a_libreta || documentoDetalle.data.documento.a_cedula) && (
                        <span className="ml-1 text-xs">
                          ({documentoDetalle.data.documento.a_libreta && `No. Bil: ${documentoDetalle.data.documento.a_libreta}`}
                          {documentoDetalle.data.documento.a_libreta && documentoDetalle.data.documento.a_cedula && ' · '}
                          {documentoDetalle.data.documento.a_cedula && `CI: ${documentoDetalle.data.documento.a_cedula}`})
                        </span>
                      )}
                    </>
                  )}
                </DialogDescription>
              </DialogHeader>

              {documentoDetalle?.data?.documento && (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <span className="font-medium">Fecha: </span>
                      {new Date(documentoDetalle.data.documento.created_at).toLocaleString()}
                    </div>
                    <div>
                      <span className="font-medium">Realizado por: </span>
                      {documentoDetalle.data.documento.realizado_por_nombre}
                    </div>
                    <div>
                      <span className="font-medium">Total items: </span>
                      {documentoDetalle.data.documento.total_items}
                    </div>
                    <div>
                      <span className="font-medium">Total cartones: </span>
                      {documentoDetalle.data.documento.total_cartones?.toLocaleString()}
                    </div>
                    {documentoDetalle.data.documento.a_libreta && (
                      <div>
                        <span className="font-medium">No. Billetero: </span>
                        {documentoDetalle.data.documento.a_libreta}
                      </div>
                    )}
                    {documentoDetalle.data.documento.a_cedula && (
                      <div>
                        <span className="font-medium">Cedula: </span>
                        {documentoDetalle.data.documento.a_cedula}
                      </div>
                    )}
                  </div>

                  <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Tipo</TableHead>
                        <TableHead>Referencia</TableHead>
                        <TableHead>De</TableHead>
                        <TableHead>A</TableHead>
                        <TableHead>Cartones</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(documentoDetalle.data.movimientos || []).map((m: any) => (
                        <TableRow key={m.id}>
                          <TableCell>
                            <Badge variant="outline" className="text-xs capitalize">{m.tipo_entidad}</Badge>
                          </TableCell>
                          <TableCell className="font-mono font-medium">{m.referencia}</TableCell>
                          <TableCell className="text-sm">{m.de_persona || '-'}</TableCell>
                          <TableCell className="text-sm">{m.a_persona || '-'}</TableCell>
                          <TableCell>{m.cantidad_cartones}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  </div>

                  <DialogFooter>
                    <Button variant="outline" onClick={() => setSelectedDocumentoId(null)}>
                      Cerrar
                    </Button>
                    <Button onClick={() => handleDownloadDocPdf(selectedDocumentoId!)}>
                      <FileDown className="mr-2 h-4 w-4" />
                      Descargar PDF
                    </Button>
                  </DialogFooter>
                </div>
              )}
            </DialogContent>
          </Dialog>

          {/* Detalle de movimiento legacy agrupado */}
          <Dialog open={!!selectedLegacyGroup} onOpenChange={(v) => { if (!v) setSelectedLegacyGroup(null); }}>
            <DialogContent className="sm:max-w-2xl max-h-[80vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>
                  Movimiento MOV-{selectedLegacyGroup?.id.toString().padStart(6, '0')}
                </DialogTitle>
                <DialogDescription>
                  {selectedLegacyGroup && (
                    <>
                      {selectedLegacyGroup.accion.replace(/_/g, ' ')} — {selectedLegacyGroup.de_persona || '-'} → {selectedLegacyGroup.a_persona || '-'}
                    </>
                  )}
                </DialogDescription>
              </DialogHeader>

              {selectedLegacyGroup && (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <span className="font-medium">Fecha: </span>
                      {new Date(selectedLegacyGroup.created_at).toLocaleString()}
                    </div>
                    <div>
                      <span className="font-medium">Realizado por: </span>
                      {selectedLegacyGroup.realizado_por_nombre}
                    </div>
                    <div>
                      <span className="font-medium">Total items: </span>
                      {selectedLegacyGroup.total_items}
                    </div>
                    <div>
                      <span className="font-medium">Total cartones: </span>
                      {selectedLegacyGroup.total_cartones.toLocaleString()}
                    </div>
                  </div>

                  <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Tipo</TableHead>
                        <TableHead>Referencia</TableHead>
                        <TableHead>De</TableHead>
                        <TableHead>A</TableHead>
                        <TableHead>Cartones</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {selectedLegacyGroup.items.map((m) => (
                        <TableRow key={m.id}>
                          <TableCell>
                            <Badge variant="outline" className="text-xs capitalize">{m.tipo_entidad}</Badge>
                          </TableCell>
                          <TableCell className="font-mono font-medium">{m.referencia}</TableCell>
                          <TableCell className="text-sm">{m.de_persona || '-'}</TableCell>
                          <TableCell className="text-sm">{m.a_persona || '-'}</TableCell>
                          <TableCell>{m.cantidad_cartones}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  </div>

                  <DialogFooter>
                    <Button variant="outline" onClick={() => setSelectedLegacyGroup(null)}>
                      Cerrar
                    </Button>
                    {selectedLegacyGroup.has_pdf && selectedLegacyGroup.pdf_mov_id && (
                      <Button onClick={() => handleDownloadMovPdf(selectedLegacyGroup.pdf_mov_id!)}>
                        <FileDown className="mr-2 h-4 w-4" />
                        Descargar PDF
                      </Button>
                    )}
                  </DialogFooter>
                </div>
              )}
            </DialogContent>
          </Dialog>
        </TabsContent>

        {/* ============ ESCANEAR TAB ============ */}
        <TabsContent value="escanear" className="space-y-4">
          <h2 className="text-lg font-semibold">Escanear Codigo</h2>

          <Card>
            <CardContent className="pt-6">
              <div className="flex flex-col sm:flex-row gap-3 max-w-lg w-full">
                <Input
                  placeholder="Ingrese codigo (ej: C001, L00001 o codigo de carton)"
                  value={scanInput}
                  onChange={(e) => setScanInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleScan()}
                />
                <Button onClick={handleScan} disabled={scanning || !scanInput.trim()}>
                  {scanning ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Search className="mr-2 h-4 w-4" />
                  )}
                  Buscar
                </Button>
              </div>
            </CardContent>
          </Card>

          {scanResult && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Resultado</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex gap-2 items-center">
                  <span className="text-sm text-muted-foreground">Tipo:</span>
                  <Badge variant="outline" className="capitalize">{scanResult.tipo}</Badge>
                </div>
                {scanResult.entidad && (
                  <div className="bg-muted p-4 rounded-md space-y-1">
                    {Object.entries(scanResult.entidad as Record<string, unknown>)
                      .filter(([, v]) => v !== null && v !== undefined && v !== '')
                      .map(([k, v]) => (
                        <p key={k} className="text-sm">
                          <span className="text-muted-foreground capitalize">{k.replace(/_/g, ' ')}:</span>{' '}
                          <span className="font-medium">{String(v)}</span>
                        </p>
                      ))}
                  </div>
                )}
                {scanResult.asignacion && (
                  <div className="space-y-2">
                    <h4 className="font-medium text-sm">Asignacion Actual</h4>
                    <div className="bg-muted p-4 rounded-md space-y-1">
                      <p className="text-sm">
                        <span className="text-muted-foreground">Persona:</span>{' '}
                        {scanResult.asignacion.persona_nombre}
                      </p>
                      <p className="text-sm">
                        <span className="text-muted-foreground">Estado:</span>{' '}
                        <Badge className={getStatusColor(scanResult.asignacion.estado)}>
                          {ESTADO_LABELS[scanResult.asignacion.estado as AsignacionEstado]}
                        </Badge>
                      </p>
                      <p className="text-sm">
                        <span className="text-muted-foreground">Proposito:</span>{' '}
                        {PROPOSITO_LABELS[scanResult.asignacion.proposito as AsignacionProposito]}
                      </p>
                      <Button
                        size="sm"
                        variant="outline"
                        className="mt-2"
                        onClick={() => navigate(`/inventory/${eventId}/asignacion/${scanResult.asignacion.id}`)}
                      >
                        Ver Detalle
                      </Button>
                    </div>
                  </div>
                )}
                {!scanResult.asignacion && (
                  <p className="text-sm text-muted-foreground">
                    Este elemento no tiene asignacion activa.
                  </p>
                )}
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      {/* ============ ALMACEN DIALOG ============ */}
      <Dialog open={showAlmacenDialog} onOpenChange={setShowAlmacenDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editingAlmacen ? 'Editar Almacen' : 'Nuevo Almacen'}</DialogTitle>
            <DialogDescription>
              {editingAlmacen
                ? 'Modifica los datos del almacen.'
                : 'Crea un nuevo almacen para gestionar inventario.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Nombre</Label>
              <Input
                value={almacenForm.name}
                onChange={(e) => setAlmacenForm({ ...almacenForm, name: e.target.value })}
                placeholder="Nombre del almacen"
              />
            </div>
            {!editingAlmacen && (
              <div className="space-y-2">
                <Label>Codigo (opcional, se genera automaticamente)</Label>
                <Input
                  value={almacenForm.code}
                  onChange={(e) => setAlmacenForm({ ...almacenForm, code: e.target.value })}
                  placeholder="ALM-001"
                />
              </div>
            )}
            <div className="space-y-2">
              <Label>Almacen Padre (opcional)</Label>
              <Select
                value={almacenForm.parent_id}
                onValueChange={(v) => setAlmacenForm({ ...almacenForm, parent_id: v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Ninguno (raiz)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Ninguno (raiz)</SelectItem>
                  {almacenes.filter((a) => a.id !== editingAlmacen?.id).map((a) => (
                    <SelectItem key={a.id} value={a.id.toString()}>
                      {a.name} ({a.code})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Direccion (opcional)</Label>
              <Input
                value={almacenForm.address}
                onChange={(e) => setAlmacenForm({ ...almacenForm, address: e.target.value })}
                placeholder="Direccion"
              />
            </div>
            <div className="space-y-2">
              <Label>Contacto (opcional)</Label>
              <Input
                value={almacenForm.contact_name}
                onChange={(e) => setAlmacenForm({ ...almacenForm, contact_name: e.target.value })}
                placeholder="Nombre del contacto"
              />
            </div>
            <div className="space-y-2">
              <Label>Telefono contacto (opcional)</Label>
              <Input
                value={almacenForm.contact_phone}
                onChange={(e) => setAlmacenForm({ ...almacenForm, contact_phone: e.target.value })}
                placeholder="Telefono"
              />
            </div>
            <div className="flex items-center gap-3 pt-2">
              <input
                type="checkbox"
                id="es_agencia_loteria"
                checked={almacenForm.es_agencia_loteria}
                onChange={(e) => setAlmacenForm({ ...almacenForm, es_agencia_loteria: e.target.checked })}
                className="h-4 w-4 rounded border-input accent-primary"
              />
              <Label htmlFor="es_agencia_loteria" className="cursor-pointer">
                Agencia de Loteria (aparece en Dashboard Loteria)
              </Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAlmacenDialog(false)}>
              Cancelar
            </Button>
            <Button
              onClick={() => editingAlmacen ? updateAlmacenMutation.mutate() : createAlmacenMutation.mutate()}
              disabled={!almacenForm.name || createAlmacenMutation.isPending || updateAlmacenMutation.isPending}
            >
              {(createAlmacenMutation.isPending || updateAlmacenMutation.isPending) && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              {editingAlmacen ? 'Guardar' : 'Crear'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Movimiento Unificado Dialog */}
      <MovimientoDialog
        eventId={eventId}
        open={showMovimientoDialog}
        onOpenChange={setShowMovimientoDialog}
      />

      {/* Cargar Inventario Dialog (legacy) */}
      <Dialog open={showCargarDialog} onOpenChange={setShowCargarDialog}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Cargar Inventario al Almacen</DialogTitle>
            <DialogDescription>
              Selecciona que tipo de entidad cargar y el almacen destino.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* Almacen destino */}
            <div className="space-y-2">
              <Label>Almacen destino</Label>
              <Select value={cargarAlmacenId} onValueChange={setCargarAlmacenId}>
                <SelectTrigger>
                  <SelectValue placeholder="Seleccionar almacen..." />
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

            {/* Tipo de entidad */}
            <div className="space-y-2">
              <Label>Tipo de entidad</Label>
              <Select value={cargarTipo} onValueChange={(v) => setCargarTipo(v as 'caja' | 'libreta' | 'carton')}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="caja">Caja</SelectItem>
                  <SelectItem value="libreta">Lote</SelectItem>
                  <SelectItem value="carton">Carton</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Por Referencia (lote/carton) */}
            {(cargarTipo === 'libreta' || cargarTipo === 'carton') && (
              <div className="space-y-2">
                <Label>
                  {cargarTipo === 'libreta' ? 'Codigo de lote (ej: L00001)' : 'Codigo de carton'}
                </Label>
                <div className="flex gap-2">
                  <Input
                    value={cargarReferencia}
                    onChange={(e) => setCargarReferencia(e.target.value)}
                    placeholder={cargarTipo === 'libreta' ? 'L00001' : 'Codigo del carton'}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && cargarReferencia.trim() && cargarAlmacenId) {
                        cargarRefMutation.mutate();
                      }
                    }}
                  />
                  <Button
                    onClick={() => cargarRefMutation.mutate()}
                    disabled={!cargarAlmacenId || !cargarReferencia.trim() || cargarRefMutation.isPending}
                  >
                    {cargarRefMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                  </Button>
                </div>
              </div>
            )}

            {/* Seleccion de cajas (solo tipo caja) */}
            {cargarTipo === 'caja' && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Cajas disponibles</Label>
                  {cajasDispData?.data && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => {
                        const sinAlmacen = (cajasDispData.data ?? []).filter(c => !c.almacen_id).map(c => c.id);
                        setSelectedCajaIds(sinAlmacen.length === selectedCajaIds.length ? [] : sinAlmacen);
                      }}
                    >
                      {selectedCajaIds.length > 0 ? 'Deseleccionar todo' : 'Seleccionar sin asignar'}
                    </Button>
                  )}
                </div>
                <div className="border rounded-lg max-h-60 overflow-auto">
                  {(cajasDispData?.data ?? []).length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-4">
                      No hay cajas generadas. Genera cartones primero.
                    </p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-10"></TableHead>
                          <TableHead>Caja</TableHead>
                          <TableHead>Lotes</TableHead>
                          <TableHead>Cartones</TableHead>
                          <TableHead>Almacen</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {(cajasDispData?.data ?? []).map((c) => {
                          const isSelected = selectedCajaIds.includes(c.id);
                          const isInOtherAlmacen = c.almacen_id && c.almacen_id.toString() !== cargarAlmacenId;
                          return (
                            <TableRow
                              key={c.id}
                              className={`cursor-pointer ${isSelected ? 'bg-primary/5' : ''} ${isInOtherAlmacen ? 'opacity-50' : ''}`}
                              onClick={() => {
                                if (isInOtherAlmacen) return;
                                setSelectedCajaIds(isSelected
                                  ? selectedCajaIds.filter(id => id !== c.id)
                                  : [...selectedCajaIds, c.id]
                                );
                              }}
                            >
                              <TableCell>
                                {isSelected ? (
                                  <Check className="h-4 w-4 text-primary" />
                                ) : (
                                  <div className="h-4 w-4 border rounded" />
                                )}
                              </TableCell>
                              <TableCell className="font-mono font-bold text-sm">{c.caja_code}</TableCell>
                              <TableCell className="text-sm">{c.total_lotes}</TableCell>
                              <TableCell className="text-sm">{c.total_cartones}</TableCell>
                              <TableCell className="text-xs text-muted-foreground">
                                {c.almacen_name || <span className="text-muted-foreground">Sin asignar</span>}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  )}
                </div>
                {selectedCajaIds.length > 0 && (
                  <p className="text-sm text-primary font-medium">
                    {selectedCajaIds.length} cajas seleccionadas
                  </p>
                )}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCargarDialog(false)}>
              Cancelar
            </Button>
            {cargarTipo === 'caja' && (
              <Button
                onClick={() => cargarMutation.mutate()}
                disabled={!cargarAlmacenId || selectedCajaIds.length === 0 || cargarMutation.isPending}
              >
                {cargarMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Cargar {selectedCajaIds.length} Cajas
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
      </>}
    </div>
  );
}
