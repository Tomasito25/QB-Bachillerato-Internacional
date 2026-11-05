import { useSyncExternalStore } from 'react';

/** Estado global mínimo sobre `useSyncExternalStore`, para no añadir una dependencia. */
export interface Store<T> {
  get(): T;
  set(next: T | ((current: T) => T)): void;
  subscribe(listener: () => void): () => void;
  use(): T;
}

export function createStore<T>(initial: T): Store<T> {
  let state = initial;
  const listeners = new Set<() => void>();
  const store: Store<T> = {
    get: () => state,
    set(next) {
      state = typeof next === 'function' ? (next as (current: T) => T)(state) : next;
      for (const listener of listeners) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    use() {
      return useSyncExternalStore(store.subscribe, store.get);
    },
  };
  return store;
}
