// Kalshi PERPETUALS partner offer (contract kalshi-partner/2) — ONE footer module per page.
// A commercial partner block in the network footer only: never in matchup, PBEcast, picks, live or
// Kalshi market components, and never a model input. Copy, economics and the link all come from the
// vendored canonical client; config is read through the same-origin rewrite /go/kalshi-perps/config
// (vercel.json). Disabled / failed config renders nothing (fail closed). The footer is rendered once by
// shellHtml() and persists across SPA navigation, so this mounts once per page load.
import { loadPartnerConfig, partnerOffer } from '../vendor/kalshi/kalshi-partner.js';
import '../styles/kalshi-partner.css';

export const PARTNER_CONFIG_URL = '/go/kalshi-perps/config';
export const PARTNER_CTX = Object.freeze({ placement: 'sport_footer', product: 'tennis', sport: 'tennis' });

export function mountKalshiPartnerFooter(doc = document) {
  const slot = doc.querySelector('#tennis-kxo');
  if (!slot || slot.dataset.kxoMounted) return Promise.resolve(false);
  slot.dataset.kxoMounted = '1';
  return loadPartnerConfig(PARTNER_CONFIG_URL)
    .then((cfg) => {
      if (doc.querySelector('.kxo')) return false; // exactly one offer per page
      const markup = partnerOffer(cfg, PARTNER_CTX, { variant: 'footer' });
      if (!markup) return false;
      slot.innerHTML = markup;
      slot.hidden = false;
      return true;
    })
    .catch(() => false);
}
