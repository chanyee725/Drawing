// One shared /api/events connection. It opens when the first subscriber arrives and closes when the last one leaves.
// Reconnecting after a drop is the browser's own EventSource behaviour; nothing here retries.

type Source = {
  addEventListener(type: string, fn: (e: Event) => void): void;
  close(): void;
  onopen: ((e: Event) => void) | null;
  onerror: ((e: Event) => void) | null;
};

export interface EventsClient {
  /** Calls `fn` with the raw `data` of each event of `type`. Returns the unsubscribe function. */
  subscribe(type: string, fn: (data: string) => void): () => void;
  /** Like `subscribe`, but parses the JSON data; an event that does not parse is skipped. */
  subscribeJson<T>(type: string, fn: (event: T) => void): () => void;
  /**
   * Calls `fn(true)` whenever the stream is open (also right away when it already is, and after every
   * reconnect) and `fn(false)` on an error. Counts as a subscriber while registered.
   */
  onConnection(fn: (online: boolean) => void): () => void;
}

export function createEventsClient(open: () => Source | null): EventsClient {
  let es: Source | null = null;
  let isOpen = false;
  const handlers = new Map<string, Set<(data: string) => void>>();
  const watchers = new Set<(online: boolean) => void>();
  const wired = new Set<string>();

  const count = () => watchers.size + [...handlers.values()].reduce((n, s) => n + s.size, 0);

  const wire = (type: string) => {
    if (!es || wired.has(type)) return;
    wired.add(type);
    es.addEventListener(type, (e) => {
      const data = (e as MessageEvent<string>).data;
      for (const fn of [...(handlers.get(type) ?? [])]) fn(data);
    });
  };

  const ensure = () => {
    if (es) return;
    es = open();
    if (!es) return;
    es.onopen = () => {
      isOpen = true;
      for (const fn of [...watchers]) fn(true);
    };
    es.onerror = () => {
      isOpen = false;
      for (const fn of [...watchers]) fn(false);
    };
    for (const type of handlers.keys()) wire(type);
  };

  const release = () => {
    if (count() > 0 || !es) return;
    es.close();
    es = null;
    isOpen = false;
    wired.clear();
  };

  const subscribe = (type: string, fn: (data: string) => void) => {
    let set = handlers.get(type);
    if (!set) handlers.set(type, (set = new Set()));
    set.add(fn);
    ensure();
    wire(type);
    return () => {
      set.delete(fn);
      if (set.size === 0 && handlers.get(type) === set) handlers.delete(type);
      release();
    };
  };

  return {
    subscribe,
    subscribeJson: <T>(type: string, fn: (event: T) => void) =>
      subscribe(type, (data) => {
        let e: T;
        try {
          e = JSON.parse(data) as T;
        } catch {
          return;
        }
        fn(e);
      }),
    onConnection(fn) {
      watchers.add(fn);
      ensure();
      if (isOpen) fn(true);
      return () => {
        watchers.delete(fn);
        release();
      };
    },
  };
}

/** The app's one client. Without EventSource (old runtime, tests) subscribing does nothing. */
export const events: EventsClient = createEventsClient(() =>
  typeof EventSource === 'undefined' ? null : (new EventSource('/api/events') as unknown as Source),
);
