import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Search, Check } from 'lucide-react';
import { COUNTRIES, getCountry, type Country } from '@/lib/countries';
import { cn } from '@/lib/utils';

interface Props {
  value: string;                   // ISO2
  onChange: (code: string) => void;
  disabled?: boolean;
  /** "full" = flag + name + dial code; "dial" = compact flag + dial only */
  variant?: 'full' | 'dial';
  placeholder?: string;
  className?: string;
  ariaLabel?: string;
}

export function CountryCombobox({
  value,
  onChange,
  disabled,
  variant = 'full',
  placeholder = 'Select country…',
  className,
  ariaLabel,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = getCountry(value);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    const t = setTimeout(() => inputRef.current?.focus(), 30);
    return () => { document.removeEventListener('mousedown', onDocClick); clearTimeout(t); };
  }, [open]);

  const list = useMemo<Country[]>(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [...COUNTRIES];
    return COUNTRIES.filter(c =>
      c.name.toLowerCase().includes(q) ||
      c.code.toLowerCase().includes(q) ||
      c.dial.replace('+', '').includes(q.replace('+', ''))
    );
  }, [query]);

  return (
    <div ref={wrapRef} className={cn('relative', className)}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(o => !o)}
        aria-label={ariaLabel || placeholder}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={cn(
          'flex h-11 w-full items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 text-sm focus:outline-none focus:border-primary/50 disabled:opacity-60 disabled:cursor-not-allowed',
          variant === 'dial' ? 'min-w-[92px] justify-between' : 'justify-between'
        )}
      >
        {selected ? (
          <span className="flex items-center gap-2 truncate">
            <span className="text-base leading-none">{selected.flag}</span>
            {variant === 'full' ? (
              <span className="truncate">{selected.name}</span>
            ) : (
              <span className="tabular-nums text-muted-foreground">{selected.dial}</span>
            )}
          </span>
        ) : (
          <span className="text-muted-foreground truncate">
            {variant === 'dial' ? '+—' : placeholder}
          </span>
        )}
        <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute z-50 mt-1.5 w-[min(92vw,340px)] max-w-[92vw] rounded-xl border border-white/10 bg-background/95 backdrop-blur-xl shadow-2xl overflow-hidden"
          style={{ left: variant === 'dial' ? 0 : undefined }}
        >
          <div className="flex items-center gap-2 px-3 py-2 border-b border-white/10">
            <Search className="w-4 h-4 text-muted-foreground shrink-0" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search country or +code…"
              className="flex-1 h-8 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>
          <div className="max-h-72 overflow-y-auto overscroll-contain">
            {list.length === 0 ? (
              <div className="px-3 py-6 text-center text-xs text-muted-foreground">No matches</div>
            ) : (
              list.map(c => {
                const isSel = c.code === value;
                return (
                  <button
                    key={c.code}
                    type="button"
                    role="option"
                    aria-selected={isSel}
                    onClick={() => { onChange(c.code); setOpen(false); setQuery(''); }}
                    className={cn(
                      'flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm hover:bg-white/[0.06] active:bg-white/[0.1]',
                      isSel && 'bg-white/[0.04]'
                    )}
                  >
                    <span className="text-base leading-none w-6 text-center">{c.flag}</span>
                    <span className="flex-1 truncate">{c.name}</span>
                    <span className="text-xs tabular-nums text-muted-foreground">{c.dial}</span>
                    {isSel && <Check className="w-4 h-4 text-primary" />}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
