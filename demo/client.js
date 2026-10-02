const controllers = new WeakMap();
for (const card of document.querySelectorAll('.card')) {
  const code = document.createElement('p'); code.className = 'code';
  const status = document.createElement('p'); status.className = 'status'; status.setAttribute('role', 'status');
  const output = document.createElement('pre'); output.textContent = 'Click a button to inspect its result.'; output.tabIndex = 0;
  const links = document.createElement('div'); links.className = 'links';
  card.append(code, status, output, links);
  card.querySelector('[data-cancel]')?.addEventListener('click', () => controllers.get(card)?.abort());
  for (const form of card.querySelectorAll('form')) form.addEventListener('submit', event => event.preventDefault());
  card.querySelector('input[type=file]')?.addEventListener('change', event => { const file = event.target.files[0]; if (file) card.querySelector('input[name=name]').value = file.name; });
  for (const button of card.querySelectorAll('[data-op], [data-upload], [data-download]')) button.addEventListener('click', async () => {
    const form = button.closest('form');
    if (!form.reportValidity() || (button.dataset.confirm && !window.confirm(button.dataset.confirm))) return;
    const p = {};
    for (const [name, value] of new FormData(form)) if (typeof value === 'string') p[name] = ['since', 'before'].includes(name) && value ? new Date(value).toISOString() : value;
    code.textContent = button.dataset.code;
    if (button.hasAttribute('data-download')) {
      const a = document.createElement('a'); a.href = '/download?name=' + encodeURIComponent(p.name); a.download = p.name || 'hello.txt'; a.click();
      status.textContent = 'Requested binary download.'; return;
    }
    const controller = new AbortController(); controllers.set(card, controller);
    const buttons = [...card.querySelectorAll('button')]; buttons.forEach(item => { item.disabled = !item.hasAttribute('data-cancel'); });
    card.setAttribute('aria-busy', 'true'); status.className = 'status'; status.textContent = 'Running…'; output.textContent = ''; links.replaceChildren();
    try {
      let response;
      if (button.hasAttribute('data-upload')) {
        const file = form.querySelector('input[type=file]').files[0];
        if (!file) throw new Error('Choose a file first.');
        if (file.size > 16 * 1024 * 1024) throw new Error('Files must be at most 16 MiB.');
        response = await fetch('/upload?name=' + encodeURIComponent(p.name), { method: 'POST', headers: { 'content-type': file.type || 'application/octet-stream' }, body: file, signal: controller.signal });
      } else response = await fetch('/api', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...p, op: button.dataset.op }), signal: controller.signal });
      if (!response.ok) { const error = await response.json(); output.textContent = JSON.stringify(error, null, 2); throw new Error(`HTTP ${response.status}: ${error.message || 'Request failed'}`); }
      if (response.headers.get('content-type')?.includes('ndjson')) {
        const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = ''; let failed = false;
        const frame = line => { if (!line.trim()) return; const value = JSON.parse(line); output.textContent += JSON.stringify(value, null, 2) + '\n'; failed ||= value.type === 'error'; };
        try {
          while (true) { const { value, done } = await reader.read(); if (done) break; buffer += decoder.decode(value, { stream: true }); let index; while ((index = buffer.indexOf('\n')) >= 0) { frame(buffer.slice(0, index)); buffer = buffer.slice(index + 1); } }
          frame(buffer + decoder.decode());
        } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
        status.textContent = failed ? 'Stream reported an error.' : 'Done (NDJSON frames).'; status.className = failed ? 'status error' : 'status';
      } else {
        const value = await response.json(); output.textContent = JSON.stringify(value, null, 2);
        for (const item of [value, ...(Array.isArray(value?.items) ? value.items : [])]) if (item?.url) {
          const url = new URL(item.url); if (!['http:', 'https:'].includes(url.protocol)) continue;
          const a = document.createElement('a'); a.href = url.href; a.textContent = 'Open signed download'; a.className = 'download'; a.target = '_blank'; a.rel = 'noopener noreferrer'; links.append(a);
        }
        status.textContent = 'Done.';
      }
    } catch (error) { status.textContent = controller.signal.aborted ? 'Request cancelled.' : error.message; status.className = 'status error'; }
    finally { buttons.forEach(item => { item.disabled = item.hasAttribute('data-cancel'); }); card.removeAttribute('aria-busy'); controllers.delete(card); }
  });
}
async function call(op) {
  const response = await fetch('/api', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ op }) });
  if (!response.ok) throw new Error('Backend unavailable');
  return response.json();
}
try { const state = await call('context'); await call('users'); document.querySelector('#connection').textContent = 'Connected · ' + new URL(state.backend).host; }
catch { document.querySelector('#connection').textContent = 'Backend offline: check the other terminal'; }
