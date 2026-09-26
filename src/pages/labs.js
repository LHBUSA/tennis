import { html, render } from '../lib/dom.js';
import { MORE_NAV as LABS_NAV } from '../ui/shell.js';

export function mount(root) {
  render(root, html`<div class="page">
    <header class="page-h"><p class="eyebrow">PropBetEdge Tennis</p><h1>More</h1><p class="lede">Schedule, rankings, and how every number is made.</p></header>
    <div class="labs">${LABS_NAV.map((l) => html`<a class="lab" href="${l.href}" id="${l.href.split('#')[1] || ''}"><b>${l.label}</b><span>${l.note}</span></a>`)}</div>
  </div>`);
  return () => {};
}
