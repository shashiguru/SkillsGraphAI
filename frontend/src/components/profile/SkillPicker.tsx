import { useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { useSkills } from '@/services/api';
import type { SkillListItem } from '@/types/api';
import { errorMessage } from '@/components/shared/states';

function useDebounced<T>(value: T, ms = 200) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** Autocomplete over the real skills in the Neo4j graph. Only graph skills can be selected. */
export function SkillPicker({ selectedNames, onPick }: { selectedNames: string[]; onPick: (skill: SkillListItem) => void }) {
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const q = useDebounced(text.trim());
  const skills = useSkills(q, '');
  const taken = new Set(selectedNames.map((n) => n.toLowerCase()));
  const options = (skills.data?.skills ?? []).filter((s) => !taken.has(s.name.toLowerCase())).slice(0, 8);

  return (
    <div className="relative">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-slate-400" />
        <Input
          role="combobox"
          aria-expanded={open}
          aria-controls="skill-options"
          aria-label="Search skills"
          placeholder="Search the skill graph (e.g. Python, Docker)"
          className="pl-9"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
        />
      </div>
      {open && (
        <ul
          id="skill-options"
          role="listbox"
          className="absolute z-10 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-border bg-white py-1 shadow-lg"
        >
          {skills.isPending && <li className="px-3 py-2 text-sm text-muted">Searching...</li>}
          {skills.isError && <li className="px-3 py-2 text-sm text-red-700">{errorMessage(skills.error)}</li>}
          {skills.isSuccess && !options.length && <li className="px-3 py-2 text-sm text-muted">No matching skills in the graph</li>}
          {options.map((s) => (
            <li key={s.id} role="option" aria-selected={false}>
              <button
                type="button"
                className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-slate-50"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onPick(s);
                  setText('');
                }}
              >
                <span>{s.name}</span>
                <span className="text-xs text-muted">
                  {s.category} · {s.level}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
