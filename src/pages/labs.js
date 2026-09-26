import { html, render } from '../lib/dom.js';
import { LABS_NAV } from '../ui/shell.js';

export function mount(root) {
  render(root, html`<div class="page">
    <header class="page-h"><p class="eyebrow">More</p><h1>Labs</h1><p class="lede">Deep tools that open as the data graph behind them is populated.</p></header>
    <div class="labs">${LABS_NAV.map((l) => html`<a class="lab" href="${l.href}" id="${l.href.split('#')[1] || ''}"><b>${l.label}</b><span>${l.note}</span></a>`)}</div>
  </div>`);
  return () => {};
}
