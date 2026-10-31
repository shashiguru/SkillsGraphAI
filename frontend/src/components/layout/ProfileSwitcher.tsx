import { useNavigate } from 'react-router-dom';
import { UserRound } from 'lucide-react';
import { useActiveProfileId } from '@/lib/activeProfile';
import { useProfiles, useSwitchProfile } from '@/services/api';

const NEW_PROFILE = '__new__';

/** Chooses which profile every page and analysis acts on. */
export function ProfileSwitcher({ className = '' }: { className?: string }) {
  const profiles = useProfiles();
  const activeId = useActiveProfileId();
  const switchProfile = useSwitchProfile();
  const navigate = useNavigate();
  const list = profiles.data ?? [];
  const activeKnown = list.some((p) => p.userId === activeId);

  return (
    <label className={`block ${className}`}>
      <span className="mb-1 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted">
        <UserRound className="size-3" /> Profile
      </span>
      <select
        aria-label="Active profile"
        value={activeKnown ? activeId : ''}
        onChange={(e) => {
          if (e.target.value === NEW_PROFILE) navigate('/profile?new=1');
          else if (e.target.value) {
            switchProfile(e.target.value);
            navigate('/');
          }
        }}
        className="h-9 w-full rounded-lg border border-border bg-white px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30"
      >
        {!activeKnown && <option value="">{profiles.isPending ? 'Loading...' : 'No saved profile yet'}</option>}
        {list.map((p) => (
          <option key={p.userId} value={p.userId}>
            {p.name} - {p.currentRole}
          </option>
        ))}
        <option value={NEW_PROFILE}>+ New profile...</option>
      </select>
    </label>
  );
}
