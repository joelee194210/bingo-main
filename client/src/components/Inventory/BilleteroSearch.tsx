import { useState, useMemo, useRef, useEffect } from 'react';
import { Search, User, CreditCard, X, BookOpen } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import billeteros from '@/data/billeteros.json';

interface Billetero {
  n: string;   // numero libreta
  c: string;   // cedula
  nm: string;  // nombre
}

interface BilleteroSearchProps {
  onSelect: (billetero: { libreta: string; cedula: string; nombre: string }) => void;
  selectedNombre?: string;
  selectedCedula?: string;
  selectedLibreta?: string;
}

const data = billeteros as Billetero[];

export default function BilleteroSearch({ onSelect, selectedNombre, selectedCedula, selectedLibreta }: BilleteroSearchProps) {
  const [query, setQuery] = useState('');
  const [showResults, setShowResults] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const isNumeric = /^\d+$/.test(q);
    if (!isNumeric && q.length < 2) return [];
    if (isNumeric) {
      const exact = data.filter(b => b.n === q);
      if (exact.length > 0) return exact.slice(0, 15);
      return data
        .filter(b => b.n.startsWith(q) || b.c.includes(q))
        .slice(0, 15);
    }
    return data
      .filter(b =>
        b.c.toLowerCase().includes(q) ||
        b.nm.toLowerCase().includes(q)
      )
      .slice(0, 15);
  }, [query]);

  const handleSelect = (b: Billetero) => {
    onSelect({ libreta: b.n, cedula: b.c, nombre: b.nm });
    setQuery('');
    setShowResults(false);
  };

  const handleClear = () => {
    onSelect({ libreta: '', cedula: '', nombre: '' });
    setQuery('');
  };

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowResults(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const isSelected = !!selectedNombre;

  return (
    <div className="space-y-3">
      <Label className="flex items-center gap-2">
        <User className="h-4 w-4" />
        Billetero
      </Label>

      {isSelected && (
        <div className="flex items-center gap-3 p-3 rounded-lg border bg-primary/5 border-primary/20">
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-sm truncate">{selectedNombre}</p>
            <div className="flex flex-wrap gap-2 mt-1">
              {selectedLibreta && (
                <Badge variant="outline" className="text-xs gap-1">
                  <BookOpen className="h-3 w-3" />
                  Libreta: {selectedLibreta}
                </Badge>
              )}
              <Badge variant="outline" className="text-xs gap-1">
                <CreditCard className="h-3 w-3" />
                {selectedCedula}
              </Badge>
            </div>
          </div>
          <button
            onClick={handleClear}
            className="shrink-0 p-1 rounded hover:bg-muted transition-colors"
          >
            <X className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>
      )}

      <div ref={containerRef} className="relative">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => { setQuery(e.target.value); setShowResults(true); }}
            onFocus={() => setShowResults(true)}
            placeholder="Buscar por cedula, nombre o numero de libreta..."
            className="pl-9"
          />
        </div>

        {showResults && results.length > 0 && (
          <div className="absolute z-50 w-full mt-1 bg-popover border rounded-lg shadow-lg max-h-60 overflow-y-auto">
            {results.map((b) => (
              <button
                key={`${b.n}-${b.c}`}
                onClick={() => handleSelect(b)}
                className="w-full text-left px-3 py-2 hover:bg-muted/60 transition-colors border-b last:border-b-0"
              >
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm truncate flex-1">{b.nm}</span>
                  <Badge variant="secondary" className="text-[10px] shrink-0 gap-1">
                    <BookOpen className="h-2.5 w-2.5" />Lib: {b.n}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Cedula: {b.c}
                </p>
              </button>
            ))}
          </div>
        )}

        {showResults && query.length >= 1 && results.length === 0 && (
          <div className="absolute z-50 w-full mt-1 bg-popover border rounded-lg shadow-lg p-4 text-center">
            <p className="text-sm text-muted-foreground">No se encontro billetero</p>
          </div>
        )}
      </div>
    </div>
  );
}
