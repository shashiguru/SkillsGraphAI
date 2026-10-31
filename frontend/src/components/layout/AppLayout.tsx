import { NavLink, Outlet } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { useActiveProfileId } from '@/lib/activeProfile';
import { ProfileSwitcher } from './ProfileSwitcher';
import { NAV_ITEMS, Sidebar } from './Sidebar';

export function AppLayout() {
  const activeProfileId = useActiveProfileId();
  return (
    <div className="flex h-full">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="border-b border-border bg-white p-2 md:hidden">
          <ProfileSwitcher />
        </div>
        <nav className="flex gap-1 overflow-x-auto border-b border-border bg-white p-2 md:hidden">
          {NAV_ITEMS.map(({ to, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                cn('whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-medium', isActive ? 'bg-brand-soft text-brand' : 'text-slate-600')
              }
            >
              {label}
            </NavLink>
          ))}
        </nav>
        <main className="flex-1 overflow-y-auto">
          <div key={activeProfileId} className="mx-auto w-full max-w-7xl p-4 md:p-8">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
