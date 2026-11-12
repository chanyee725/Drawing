// Server-Sent Events hub shared by all modules: hub.broadcast(event, data).

export function createHub() {
  const clients = new Set();

  function attach(req, res) {
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store',
      connection: 'keep-alive',
    });
    res.write(': connected\n\n');
    clients.add(res);
    const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
    req.on('close', () => {
      clearInterval(ping);
      clients.delete(res);
    });
  }

  function broadcast(event, data) {
    const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of clients) res.write(msg);
  }

  function closeAll() {
    for (const res of clients) res.end();
    clients.clear();
  }

  return { attach, broadcast, closeAll, get size() { return clients.size; } };
}
