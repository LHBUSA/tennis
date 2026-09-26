// Generic data page: header + modules, each backed by one tennis-api endpoint.

import { html, render } from '../lib/dom.js';
import { api } from '../data/api.js';
import { emptyModule, moduleCard, freshnessBadge } from '../ui/state.js';
import { PAGE_SPECS } from './specs.js';

function hasData(d) {
  if (d === null || d === undefined) return false;
  if (Array.isArray(d)) return d.length > 0;
  if (typeof d === 'object') return Object.keys(d).length > 0;
  return true;
}

export function mount(root, { id, params, route }) {
  const spec = PAGE_SPECS[id](params, route);
  const ctl = new AbortController();
  render(root, html`
    <div class="page">
      <header class="page-h">
        <p class="eyebrow">${spec.eyebrow}</p>
        <h1>${spec.heading}</h1>
        <p class="lede">${spec.lede}</p>
        ${spec.links ? html`<nav class="chips" aria-label="${spec.heading}">${spec.links.map(([href, label]) => html`<a class="chip" href="${href}">${label}</a>`)}</nav>` : ''}
      </header>
      <div class="mods">${spec.modules.map((m) => moduleCard({ title: m.title, id: `m-${m.key}`, body: html`<p class="loading">Checking source…</p>` }))}</div>
    </div>`);
  spec.modules.forEach(async (m) => {
    let res;
    try { res = await api(m.endpoint, { signal: ctl.signal }); } catch { return; }
    const body = root.querySelector(`#m-${m.key} .mod-b`);
    if (!body) return;
    if (!hasData(res.data)) { render(body, emptyModule(res.meta, m.note)); return; }
    const n = Array.isArray(res.data) ? res.data.length : Object.keys(res.data).length;
    render(body, html`<p>${freshnessBadge(res.meta)} ${n} record${n === 1 ? '' : 's'} received; the renderer for this module ships with its data milestone.</p>`);
  });
  return () => ctl.abort();
}
