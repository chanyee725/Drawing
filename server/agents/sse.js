// Minimal incremental Server-Sent Events parser.
// feed(chunk) calls onEvent(eventName, dataString) for each complete event.
export function createSseParser(onEvent) {
  let buf = '';
  let event = 'message';
  let data = [];

  function line(l) {
    if (l === '') {
      if (data.length) onEvent(event, data.join('\n'));
      event = 'message';
      data = [];
      return;
    }
    if (l.startsWith(':')) return;
    const i = l.indexOf(':');
    const field = i === -1 ? l : l.slice(0, i);
    let value = i === -1 ? '' : l.slice(i + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'event') event = value || 'message';
    else if (field === 'data') data.push(value);
  }

  return {
    feed(chunk) {
      buf += chunk;
      let nl;
      while ((nl = buf.search(/\r\n|\n|\r/)) !== -1) {
        const sepLen = buf[nl] === '\r' && buf[nl + 1] === '\n' ? 2 : 1;
        // A lone trailing \r may be the first half of \r\n; wait for more input.
        if (buf[nl] === '\r' && nl === buf.length - 1) break;
        line(buf.slice(0, nl));
        buf = buf.slice(nl + sepLen);
      }
    },
  };
}
