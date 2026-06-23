'use client';

import { useState, useTransition, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Search } from 'lucide-react';
import { copy } from '@/lib/copy';
import { Card } from '@/components/ui/Card';
import { searchEmployees } from './actions';
import type { EmployeeSearchResult } from './actions';

export function AdminEmployeeSelector() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<EmployeeSearchResult[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [searchError, setSearchError] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  function handleChange(value: string) {
    setQuery(value);
    setSearchError('');
    if (value.trim().length < 2) {
      setResults([]);
      setShowDropdown(false);
      return;
    }
    startTransition(async () => {
      try {
        const r = await searchEmployees(value);
        setResults(r);
        setShowDropdown(true);
      } catch {
        setSearchError(copy.errors.generic);
        setResults([]);
        setShowDropdown(false);
      }
    });
  }

  function handleSelect(id: string) {
    setShowDropdown(false);
    setQuery('');
    setResults([]);
    router.push(`/admin/empleado/${id}`);
  }

  return (
    <Card>
      <h3 className="text-base font-semibold text-secondary mb-3">
        {copy.adminEmpleado.selectorTitle}
      </h3>
      <div ref={containerRef} className="relative">
        <div className="relative">
          <Search
            size={15}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral pointer-events-none"
          />
          <input
            type="text"
            value={query}
            onChange={(e) => handleChange(e.target.value)}
            placeholder={copy.adminEmpleado.selectorPlaceholder}
            className="w-full pl-9 pr-4 py-2 text-sm border border-color-border rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary text-secondary placeholder:text-neutral"
          />
          {isPending && (
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-neutral">
              {copy.general.loading}
            </span>
          )}
        </div>

        <p className="text-xs text-neutral mt-1">{copy.adminEmpleado.selectorHint}</p>

        {searchError && (
          <p className="text-xs text-error mt-1">{searchError}</p>
        )}

        {showDropdown && (
          <ul className="absolute z-10 mt-1 w-full bg-white border border-color-border rounded-lg shadow-md overflow-hidden">
            {results.length === 0 ? (
              <li className="px-4 py-3 text-sm text-neutral">{copy.adminEmpleado.noResults}</li>
            ) : (
              results.map((emp) => (
                <li key={emp.id}>
                  <button
                    type="button"
                    onClick={() => handleSelect(emp.id)}
                    className="w-full text-left px-4 py-3 text-sm hover:bg-surface transition-colors"
                  >
                    <span className="font-medium text-secondary">
                      {emp.full_name || emp.email}
                    </span>
                    <span className="text-neutral ml-2">{emp.email}</span>
                  </button>
                </li>
              ))
            )}
          </ul>
        )}
      </div>
    </Card>
  );
}
