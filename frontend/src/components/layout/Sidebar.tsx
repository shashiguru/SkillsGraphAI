import { NavLink } from 'react-router-dom';
import {
  Activity,
  GitFork,
  LayoutDashboard,
  Map,
  Network,
  Route as RouteIcon,
  Telescope,
  User,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useHealth } from '@/hooks/useHealth';
import { ProfileSwitcher } from './ProfileSwitcher';

export const NAV_ITEMS = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/profile', label: 'My Profile', icon: User },
  { to: '/explorer', label: 'Career Explorer', icon: Telescope },
  { to: '/skill-gap', label: 'Skill Gap Analysis', icon: GitFork },
  { to: '/graph', label: 'Knowledge Graph', icon: Network },
  { to: '/roadmap', label: 'Learning Roadmap', icon: RouteIcon },
  { to: '/integrations', label: 'Integration Monitor', icon: Activity },
] as const;

export function Sidebar() {
  const health = useHealth();
  return (
    <aside className="hidden w-64 shrink-0 flex-col border-r border-border bg-white md:flex">
      <div className="flex h-16 items-center gap-2 border-b border-border px-5">
        <div className="flex size-8 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-600 to-violet-600 text-white">
          <Map className="size-4" />
        </div>
        <div>
          <p className="text-sm font-semibold leading-none">SkillGraph AI</p>
          <p className="mt-1 text-[11px] text-muted">Career navigation</p>
        </div>
      </div>
      <div className="border-b border-border p-3">
        <ProfileSwitcher />
      </div>
      <nav className="flex-1 space-y-1 p-3">
        {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                isActive ? 'bg-brand-soft text-brand' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900',
              )
            }
          >
            <Icon className="size-4" />
            {label}
          </NavLink>
        ))}
      </nav>
      <div className="border-t border-border p-4 text-xs text-muted">
        <span
          className={cn(
            'mr-2 inline-block size-2 rounded-full',
            health.isSuccess ? 'bg-emerald-500' : health.isError ? 'bg-red-500' : 'bg-slate-300',
          )}
        />
        {health.isSuccess ? 'Backend online' : health.isError ? 'Backend unreachable' : 'Checking backend...'}
      </div>
    </aside>
  );
}
