// Server-Sent Events hub shared by all modules: hub.broadcast(event, data).
// Each client states its options in the query string when it connects (only `activity=1` today).
// `data` may be a function of those options, so a module can leave fields out for clients
// that did not ask for them.

/** Client options from the /api/events query string. */
export function clientOptions(url) {
  return { activity: url?.searchParams?.get('activity') === '1' };
}

export function createHub() {
  const clients = new Map(); // res -> options

  function attach(req, res, url) {
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store',
      connection: 'keep-alive',
    });
    res.write(': connected\n\n');
    clients.set(res, clientOptions(url));
    const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
    req.on('close', () => {
      clearInterval(ping);
      clients.delete(res);
    });
  }

  function broadcast(event, data) {
    if (typeof data !== 'function') {
      const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
      for (const res of clients.keys()) res.write(msg);
      return;
    }
    const cache = new Map(); // options key -> message
    for (const [res, opts] of clients) {
      const key = JSON.stringify(opts);
      if (!cache.has(key)) cache.set(key, `event: ${event}\ndata: ${JSON.stringify(data(opts))}\n\n`);
      res.write(cache.get(key));
    }
  }

  function closeAll() {
    for (const res of clients.keys()) res.end();
    clients.clear();
  }

  return { attach, broadcast, closeAll, get size() { return clients.size; } };
}
