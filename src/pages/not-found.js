import { html, render } from '../lib/dom.js';

export function mount(root) {
  render(root, html`<div class="page"><header class="page-h"><p class="eyebrow">404</p><h1>Page not found</h1><p class="lede">That address does not exist on PropBetEdge Tennis.</p><p><a class="btn" href="/">Back to Today</a></p></header></div>`);
  return () => {};
}
