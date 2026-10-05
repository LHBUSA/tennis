// Native /all-access page (owner decision 2026-10-05): a real local page, never a redirect to
// propbetedge.ai. The static prerender ships the anonymous version in the HTML; this mount renders the
// reader's own state from the membership verdict (src/lib/all-access.js renders, nothing decides here).
import { render } from '../lib/dom.js';
import { accountView, allAccessPageHtml } from '../lib/all-access.js';
import { getAccount, wireAccountSurface } from '../lib/membership.js';

export function mount(root) {
  let alive = true;
  render(root, allAccessPageHtml('loading', null));
  const unwire = wireAccountSurface(root);
  getAccount().then((acct) => {
    if (!alive) return;
    render(root, allAccessPageHtml(accountView(acct), acct));
  });
  return () => { alive = false; unwire(); };
}
