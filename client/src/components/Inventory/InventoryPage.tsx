import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  Network,
  Plus,
  Package,
  ChevronRight,
  ChevronDown,
  Loader2,
  Settings,
  ArrowDownToLine,
  ArrowUpFromLine,
  DollarSign,
  Boxes,
  AlertCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  getEvents,
  getEventInventoryOverview,
  setInventoryLevels,
  createInventoryNode,
  loadCardsToNode,
  assignCardsToChild,
  returnCardsToParent,
  sellCardsAtNode,
} from '@/services/api';
import type {
  InventoryNode,
  InventoryLevel,
  CardSelection,
  BingoEvent,
} from '@/types';
import { MOVEMENT_TYPE_LABELS } from '@/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';

// =====================================================
// TREE NODE COMPONENT
// =====================================================

function TreeNodeItem({
  node,
  levels,
  onAction,
  depth = 0,
}: {
  node: InventoryNode;
  levels: InventoryLevel[];
  onAction: (action: string, node: InventoryNode) => void;
  depth?: number;
}) {
  const [expanded, setExpanded] = useState(depth < 2);
  const children = node.children || [];
  const hasChildren = children.length > 0;
  const available = node.total_assigned - node.total_distributed - node.total_sold;
  const levelName = levels.find(l => l.level === node.level)?.name || `Nivel ${node.level}`;

  return (
    <div>
      <div
        className={`flex items-center gap-2 py-2.5 px-3 rounded-lg hover:bg-muted/60 transition-colors group ${depth === 0 ? 'bg-muted/30' : ''}`}
        style={{ paddingLeft: `${depth * 24 + 12}px` }}
      >
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-5 h-5 flex items-center justify-center text-muted-foreground"
        >
          {hasChildren ? (
            expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />
          ) : (
            <span className="w-4 h-4 rounded-full bg-muted" />
          )}
        </button>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm truncate">{node.name}</span>
            <Badge variant="secondary" className="text-[10px] h-5">{levelName}</Badge>
            {node.code && <span className="text-xs text-muted-foreground font-mono">{node.code}</span>}
          </div>
        </div>

        {/* Counters */}
        <div className="hidden md:flex items-center gap-3 text-xs">
          <div className="text-center min-w-[50px]">
            <p className="font-bold">{node.total_assigned}</p>
            <p className="text-muted-foreground">Asignados</p>
          </div>
          <div className="text-center min-w-[50px]">
            <p className="font-bold text-blue-600">{node.total_distributed}</p>
            <p className="text-muted-foreground">Distribuid.</p>
          </div>
          <div className="text-center min-w-[50px]">
            <p className="font-bold text-emerald-600">{node.total_sold}</p>
            <p className="text-muted-foreground">Vendidos</p>
          </div>
          <div className="text-center min-w-[50px]">
            <p className={`font-bold ${available > 0 ? 'text-amber-600' : 'text-muted-foreground'}`}>{available}</p>
            <p className="text-muted-foreground">En Mano</p>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          {node.level === 1 && (
            <Button variant="ghost" size="icon" className="h-7 w-7" title="Cargar cartones" onClick={() => onAction('load', node)}>
              <ArrowDownToLine className="h-3.5 w-3.5" />
            </Button>
          )}
          {available > 0 && hasChildren && (
            <Button variant="ghost" size="icon" className="h-7 w-7" title="Asignar a hijo" onClick={() => onAction('assign', node)}>
              <ArrowDownToLine className="h-3.5 w-3.5 text-blue-500" />
            </Button>
          )}
          {available > 0 && node.parent_id && (
            <Button variant="ghost" size="icon" className="h-7 w-7" title="Devolver al padre" onClick={() => onAction('return', node)}>
              <ArrowUpFromLine className="h-3.5 w-3.5 text-orange-500" />
            </Button>
          )}
          {available > 0 && (
            <Button variant="ghost" size="icon" className="h-7 w-7" title="Marcar venta" onClick={() => onAction('sell', node)}>
              <DollarSign className="h-3.5 w-3.5 text-emerald-500" />
            </Button>
          )}
          <Button variant="ghost" size="icon" className="h-7 w-7" title="Agregar hijo" onClick={() => onAction('add_child', node)}>
            <Plus className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {expanded && hasChildren && (
        <div>
          {children.map(child => (
            <TreeNodeItem key={child.id} node={child} levels={levels} onAction={onAction} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

// =====================================================
// CARD SELECTION FORM
// =====================================================

function CardSelectionForm({
  value,
  onChange,
}: {
  value: CardSelection;
  onChange: (s: CardSelection) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>Tipo de seleccion</Label>
        <Select value={value.type} onValueChange={(t) => onChange({ ...value, type: t as CardSelection['type'] })}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="series_range">Por rango de series</SelectItem>
            <SelectItem value="card_range">Por rango de numeros</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {value.type === 'series_range' && (
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Desde serie</Label>
            <Input
              className="font-mono"
              placeholder="00001"
              value={value.from_series || ''}
              onChange={(e) => onChange({ ...value, from_series: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label>Hasta serie</Label>
            <Input
              className="font-mono"
              placeholder="00010"
              value={value.to_series || ''}
              onChange={(e) => onChange({ ...value, to_series: e.target.value })}
            />
          </div>
          <p className="col-span-2 text-xs text-muted-foreground">
            Cada serie contiene 50 cartones
          </p>
        </div>
      )}

      {value.type === 'card_range' && (
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Desde carton #</Label>
            <Input
              type="number"
              placeholder="1"
              value={value.from_card || ''}
              onChange={(e) => onChange({ ...value, from_card: parseInt(e.target.value) || undefined })}
            />
          </div>
          <div className="space-y-2">
            <Label>Hasta carton #</Label>
            <Input
              type="number"
              placeholder="500"
              value={value.to_card || ''}
              onChange={(e) => onChange({ ...value, to_card: parseInt(e.target.value) || undefined })}
            />
          </div>
        </div>
      )}
    </div>
  );
}

// =====================================================
// MAIN INVENTORY PAGE
// =====================================================

export default function InventoryPage() {
  const queryClient = useQueryClient();
  const [selectedEventId, setSelectedEventId] = useState<number | null>(null);

  // Modals state
  const [showLevelsModal, setShowLevelsModal] = useState(false);
  const [showNodeModal, setShowNodeModal] = useState(false);
  const [showCardModal, setShowCardModal] = useState(false);

  // Modal data
  const [levelsConfig, setLevelsConfig] = useState<{ level: number; name: string }[]>([]);
  const [nodeForm, setNodeForm] = useState({ parent_id: 0, name: '', code: '', contact_name: '', contact_phone: '' });
  const [cardAction, setCardAction] = useState<{ type: string; node: InventoryNode; targetNodeId?: number } | null>(null);
  const [cardSelection, setCardSelection] = useState<CardSelection>({ type: 'series_range' });
  const [buyerName, setBuyerName] = useState('');
  const [buyerPhone, setBuyerPhone] = useState('');

  // Queries
  const { data: eventsData } = useQuery({ queryKey: ['events'], queryFn: getEvents });
  const events = eventsData?.data || [];

  const { data: overviewData, isLoading: overviewLoading } = useQuery({
    queryKey: ['inventory-overview', selectedEventId],
    queryFn: () => getEventInventoryOverview(selectedEventId!),
    enabled: !!selectedEventId,
  });

  const overview = overviewData?.data;

  // Mutations
  const saveLevelsMutation = useMutation({
    mutationFn: () => setInventoryLevels(selectedEventId!, levelsConfig),
    onSuccess: () => {
      toast.success('Niveles configurados');
      setShowLevelsModal(false);
      queryClient.invalidateQueries({ queryKey: ['inventory-overview', selectedEventId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const createNodeMutation = useMutation({
    mutationFn: () => createInventoryNode(selectedEventId!, {
      parent_id: nodeForm.parent_id || undefined,
      name: nodeForm.name,
      code: nodeForm.code || undefined,
      contact_name: nodeForm.contact_name || undefined,
      contact_phone: nodeForm.contact_phone || undefined,
    }),
    onSuccess: () => {
      toast.success('Nodo creado');
      setShowNodeModal(false);
      queryClient.invalidateQueries({ queryKey: ['inventory-overview', selectedEventId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const cardOperationMutation = useMutation({
    mutationFn: async () => {
      if (!cardAction) throw new Error('Sin accion');
      const { type, node, targetNodeId } = cardAction;
      switch (type) {
        case 'load':
          return loadCardsToNode(node.id, cardSelection);
        case 'assign':
          if (!targetNodeId) throw new Error('Seleccione nodo destino');
          return assignCardsToChild(node.id, targetNodeId, cardSelection);
        case 'return':
          return returnCardsToParent(node.id, cardSelection);
        case 'sell':
          return sellCardsAtNode(node.id, cardSelection, buyerName || undefined, buyerPhone || undefined);
        default:
          throw new Error('Accion desconocida');
      }
    },
    onSuccess: (data) => {
      const result = data?.data;
      toast.success(`Operacion completada: ${result?.cards_affected || 0} cartones afectados`);
      setShowCardModal(false);
      setCardAction(null);
      queryClient.invalidateQueries({ queryKey: ['inventory-overview', selectedEventId] });
    },
    onError: (e: { response?: { data?: { error?: string } } }) => {
      toast.error(e.response?.data?.error || (e as Error).message || 'Error en operacion');
    },
  });

  // Handlers
  const handleAction = (action: string, node: InventoryNode) => {
    if (action === 'add_child') {
      setNodeForm({ parent_id: node.id, name: '', code: '', contact_name: '', contact_phone: '' });
      setShowNodeModal(true);
    } else {
      setCardAction({ type: action, node });
      setCardSelection({ type: 'series_range' });
      setBuyerName('');
      setBuyerPhone('');
      setShowCardModal(true);
    }
  };

  const openLevelsConfig = () => {
    if (overview?.levels && overview.levels.length > 0) {
      setLevelsConfig(overview.levels.map(l => ({ level: l.level, name: l.name })));
    } else {
      setLevelsConfig([
        { level: 1, name: 'Loteria' },
        { level: 2, name: 'Agencia' },
        { level: 3, name: 'Vendedor' },
      ]);
    }
    setShowLevelsModal(true);
  };

  const addLevel = () => {
    if (levelsConfig.length >= 5) return;
    setLevelsConfig([...levelsConfig, { level: levelsConfig.length + 1, name: '' }]);
  };

  const removeLevel = () => {
    if (levelsConfig.length <= 1) return;
    setLevelsConfig(levelsConfig.slice(0, -1));
  };

  const getActionLabel = (type: string) => MOVEMENT_TYPE_LABELS[type === 'load' ? 'initial_load' : type === 'assign' ? 'assign_down' : type === 'return' ? 'return_up' : 'mark_sold'] || type;

  const childrenOfNode = (node: InventoryNode): InventoryNode[] => {
    const flattenChildren = (n: InventoryNode): InventoryNode[] => {
      const result: InventoryNode[] = [];
      for (const child of (n.children || [])) {
        if (child.parent_id === node.id) result.push(child);
      }
      return result;
    };
    return flattenChildren(node);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="page-header flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Inventario</h2>
          <p className="text-muted-foreground text-sm mt-1">Control de distribucion de cartones</p>
        </div>
        <div className="flex items-center gap-3">
          <Select
            value={selectedEventId?.toString() || ''}
            onValueChange={(v) => setSelectedEventId(Number(v))}
          >
            <SelectTrigger className="w-[250px]">
              <SelectValue placeholder="Seleccionar evento..." />
            </SelectTrigger>
            <SelectContent>
              {events.map((event: BingoEvent) => (
                <SelectItem key={event.id} value={event.id.toString()}>
                  {event.name} ({event.total_cards.toLocaleString()})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {!selectedEventId && (
        <Card className="text-center py-12">
          <CardContent>
            <Network className="h-12 w-12 text-muted-foreground/30 mx-auto mb-4" />
            <h3 className="text-lg font-semibold mb-2">Seleccione un Evento</h3>
            <p className="text-muted-foreground text-sm">Escoja un evento para ver y gestionar su inventario</p>
          </CardContent>
        </Card>
      )}

      {selectedEventId && overviewLoading && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
          </div>
          <Skeleton className="h-64 rounded-xl" />
        </div>
      )}

      {selectedEventId && overview && (
        <>
          {/* Stats */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="stat-card stat-card-amber p-5">
              <div className="flex items-center gap-4">
                <div className="stat-icon-amber p-3 rounded-xl">
                  <Boxes className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground font-medium">Total Cartones</p>
                  <p className="text-2xl font-bold tracking-tight">{overview.total_event_cards.toLocaleString()}</p>
                </div>
              </div>
            </div>
            <div className="stat-card stat-card-emerald p-5">
              <div className="flex items-center gap-4">
                <div className="stat-icon-emerald p-3 rounded-xl">
                  <Package className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground font-medium">En Inventario</p>
                  <p className="text-2xl font-bold tracking-tight">{overview.cards_in_inventory.toLocaleString()}</p>
                </div>
              </div>
            </div>
            <div className="stat-card stat-card-violet p-5">
              <div className="flex items-center gap-4">
                <div className="stat-icon-violet p-3 rounded-xl">
                  <AlertCircle className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground font-medium">Sin Asignar</p>
                  <p className="text-2xl font-bold tracking-tight">{overview.cards_unassigned.toLocaleString()}</p>
                </div>
              </div>
            </div>
          </div>

          {/* Levels config or Tree */}
          {overview.levels.length === 0 ? (
            <Card className="text-center py-12">
              <CardContent>
                <Settings className="h-12 w-12 text-muted-foreground/30 mx-auto mb-4" />
                <h3 className="text-lg font-semibold mb-2">Configure la Jerarquia</h3>
                <p className="text-muted-foreground text-sm mb-4">Defina los niveles de distribucion para este evento</p>
                <Button onClick={openLevelsConfig}>
                  <Settings className="mr-2 h-4 w-4" /> Configurar Niveles
                </Button>
              </CardContent>
            </Card>
          ) : (
            <Card className="glow-card">
              <CardHeader className="flex flex-row items-center justify-between pb-3">
                <div className="flex items-center gap-2">
                  <Network className="h-4 w-4 text-muted-foreground" />
                  <CardTitle className="text-sm font-semibold">
                    Arbol de Distribucion
                    <span className="text-muted-foreground font-normal ml-2">
                      ({overview.levels.map(l => l.name).join(' → ')})
                    </span>
                  </CardTitle>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" className="h-7 text-xs" onClick={openLevelsConfig}>
                    <Settings className="mr-1 h-3 w-3" /> Niveles
                  </Button>
                  {overview.tree.length === 0 && (
                    <Button size="sm" className="h-7 text-xs" onClick={() => {
                      setNodeForm({ parent_id: 0, name: '', code: '', contact_name: '', contact_phone: '' });
                      setShowNodeModal(true);
                    }}>
                      <Plus className="mr-1 h-3 w-3" /> Nodo Raiz
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                {overview.tree.length === 0 ? (
                  <div className="text-center py-8">
                    <p className="text-muted-foreground text-sm">No hay nodos aun. Cree el nodo raiz para empezar.</p>
                  </div>
                ) : (
                  <div className="space-y-0.5">
                    {overview.tree.map(node => (
                      <TreeNodeItem key={node.id} node={node} levels={overview.levels} onAction={handleAction} />
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Link to movements */}
          <div className="flex justify-end">
            <Link
              to={`/inventory/movements/${selectedEventId}`}
              className="text-sm text-primary hover:underline"
            >
              Ver historial de movimientos →
            </Link>
          </div>
        </>
      )}

      {/* ======= LEVELS MODAL ======= */}
      <Dialog open={showLevelsModal} onOpenChange={setShowLevelsModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Configurar Niveles de Jerarquia</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {levelsConfig.map((lvl, idx) => (
              <div key={idx} className="flex items-center gap-3">
                <Badge variant="secondary" className="w-8 h-8 flex items-center justify-center rounded-full text-xs">
                  {lvl.level}
                </Badge>
                <Input
                  value={lvl.name}
                  onChange={(e) => {
                    const updated = [...levelsConfig];
                    updated[idx] = { ...updated[idx], name: e.target.value };
                    setLevelsConfig(updated);
                  }}
                  placeholder={`Nombre del nivel ${lvl.level}`}
                />
              </div>
            ))}
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={addLevel} disabled={levelsConfig.length >= 5}>
                <Plus className="mr-1 h-3 w-3" /> Agregar Nivel
              </Button>
              <Button variant="outline" size="sm" onClick={removeLevel} disabled={levelsConfig.length <= 1}>
                Quitar Ultimo
              </Button>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowLevelsModal(false)}>Cancelar</Button>
            <Button
              onClick={() => saveLevelsMutation.mutate()}
              disabled={saveLevelsMutation.isPending || levelsConfig.some(l => !l.name.trim())}
            >
              {saveLevelsMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Guardar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ======= CREATE NODE MODAL ======= */}
      <Dialog open={showNodeModal} onOpenChange={setShowNodeModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {nodeForm.parent_id ? 'Agregar Nodo Hijo' : 'Crear Nodo Raiz'}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Nombre *</Label>
              <Input
                value={nodeForm.name}
                onChange={(e) => setNodeForm({ ...nodeForm, name: e.target.value })}
                placeholder="Ej: Agencia Norte"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Codigo (opcional)</Label>
                <Input
                  value={nodeForm.code}
                  onChange={(e) => setNodeForm({ ...nodeForm, code: e.target.value })}
                  placeholder="Ej: AG-01"
                  className="font-mono"
                />
              </div>
              <div className="space-y-2">
                <Label>Contacto</Label>
                <Input
                  value={nodeForm.contact_name}
                  onChange={(e) => setNodeForm({ ...nodeForm, contact_name: e.target.value })}
                  placeholder="Nombre"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Telefono</Label>
              <Input
                value={nodeForm.contact_phone}
                onChange={(e) => setNodeForm({ ...nodeForm, contact_phone: e.target.value })}
                placeholder="Telefono de contacto"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowNodeModal(false)}>Cancelar</Button>
            <Button
              onClick={() => createNodeMutation.mutate()}
              disabled={createNodeMutation.isPending || !nodeForm.name.trim()}
            >
              {createNodeMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Crear
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ======= CARD OPERATION MODAL ======= */}
      <Dialog open={showCardModal} onOpenChange={(open) => { if (!open) { setShowCardModal(false); setCardAction(null); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {cardAction ? getActionLabel(cardAction.type) : 'Operacion'}
              {cardAction && <span className="text-muted-foreground font-normal"> — {cardAction.node.name}</span>}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            {/* Target node selector for assign */}
            {cardAction?.type === 'assign' && (
              <div className="space-y-2">
                <Label>Nodo destino (hijo)</Label>
                <Select
                  value={cardAction.targetNodeId?.toString() || ''}
                  onValueChange={(v) => setCardAction({ ...cardAction, targetNodeId: Number(v) })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Seleccionar hijo..." />
                  </SelectTrigger>
                  <SelectContent>
                    {childrenOfNode(cardAction.node).map(child => (
                      <SelectItem key={child.id} value={child.id.toString()}>
                        {child.name} {child.code ? `(${child.code})` : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <CardSelectionForm value={cardSelection} onChange={setCardSelection} />

            {/* Buyer info for sell */}
            {cardAction?.type === 'sell' && (
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Comprador</Label>
                  <Input value={buyerName} onChange={(e) => setBuyerName(e.target.value)} placeholder="Nombre" />
                </div>
                <div className="space-y-2">
                  <Label>Telefono</Label>
                  <Input value={buyerPhone} onChange={(e) => setBuyerPhone(e.target.value)} placeholder="Telefono" />
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowCardModal(false); setCardAction(null); }}>
              Cancelar
            </Button>
            <Button
              onClick={() => cardOperationMutation.mutate()}
              disabled={cardOperationMutation.isPending}
              variant={cardAction?.type === 'sell' ? 'success' : cardAction?.type === 'return' ? 'warning' : 'default'}
            >
              {cardOperationMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {cardAction?.type === 'load' && 'Cargar Cartones'}
              {cardAction?.type === 'assign' && 'Asignar'}
              {cardAction?.type === 'return' && 'Devolver'}
              {cardAction?.type === 'sell' && 'Registrar Venta'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
