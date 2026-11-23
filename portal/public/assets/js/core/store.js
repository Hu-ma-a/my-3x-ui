const listeners = new Set();

function emit() {
  for (const listener of listeners) {
    try {
      listener(store);
    } catch (err) {
      console.warn('store listener failed', err);
    }
  }
}

export const store = {
  user: null,
  config: null,
  status: null,
  setUser(user) {
    store.user = user || null;
    emit();
  },
  setStatus(status) {
    store.status = status || null;
    if (status?.user) store.user = status.user;
    emit();
  },
  setConfig(config) {
    store.config = config || null;
    emit();
  },
  clear() {
    store.user = null;
    store.status = null;
    emit();
  },
  subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};
