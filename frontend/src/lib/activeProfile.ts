import { useSyncExternalStore } from 'react';

/** The backend's original single profile. Used when the user never picked another one. */
export const DEFAULT_PROFILE_ID = 'default-user';

const KEY = 'skillgraph.activeProfileId';
const listeners = new Set<() => void>();

function read(): string {
  try {
    return window.localStorage.getItem(KEY) || DEFAULT_PROFILE_ID;
  } catch {
    return DEFAULT_PROFILE_ID;
  }
}

export const getActiveProfileId = (): string => read();

export function setActiveProfileId(id: string): void {
  try {
    window.localStorage.setItem(KEY, id);
  } catch {
    /* storage unavailable: the choice then only lasts until reload */
  }
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener('storage', listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', listener);
  };
}

export function useActiveProfileId(): string {
  return useSyncExternalStore(subscribe, read, () => DEFAULT_PROFILE_ID);
}
