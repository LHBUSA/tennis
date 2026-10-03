// WATCH — official match video (tennis-api /v1/matches/:id/videos, linked by the ingest video lane). Poster first; the
// youtube-nocookie player loads only on click; "Watch on YouTube" is always offered (embedding can be region-blocked).
// The label is the video's real type: a full replay is never claimed for highlights. Nothing hosted by PropBetEdge.

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ID = /^[\w-]{11}$/;
const CHIP = { full_match: 'FULL MATCH REPLAY', extended_highlights: 'EXTENDED HIGHLIGHTS', match_highlights: 'MATCH HIGHLIGHTS', interview: 'INTERVIEW' };
const when = (iso) => { const t = Date.parse(iso || ''); return Number.isFinite(t) ? new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : ''; };

/** videos: API rows (best first). '' when there is nothing official to show. */
export function watchPanel(videos, { context = '' } = {}) {
  const vs = (videos || []).filter((v) => ID.test(v?.video_id || '') && CHIP[v.video_type]);
  if (!vs.length) return '';
  const [lead, ...more] = vs;
  const yt = (v) => `https://www.youtube.com/watch?v=${v.video_id}`;
  return `<div class="wv" data-wv>
    <figure class="wv-lead">
      <button type="button" class="wv-poster" data-wv-play="${esc(lead.video_id)}" data-wv-title="${esc(lead.title)}" aria-label="Play: ${esc(lead.title)}">
        <img src="https://i.ytimg.com/vi/${esc(lead.video_id)}/hqdefault.jpg" alt="" loading="lazy" width="480" height="360">
        <span class="wv-btn" aria-hidden="true">▶</span>
      </button>
      <figcaption>
        <span class="wv-chip wv-chip-${esc(lead.video_type)}">${CHIP[lead.video_type]}</span>
        <b class="wv-title">${esc(lead.title)}</b>
        ${context ? `<small class="wv-ctx">${esc(context)}</small>` : ''}
        <small class="wv-src">Official · ${esc(lead.channel)} · ${esc(when(lead.published_at))}</small>
        <span class="wv-actions"><button type="button" class="wv-go" data-wv-play="${esc(lead.video_id)}" data-wv-title="${esc(lead.title)}">Watch →</button><a class="wv-yt" href="${esc(yt(lead))}" target="_blank" rel="noopener noreferrer">Watch on YouTube ↗</a></span>
      </figcaption>
    </figure>
    ${more.length ? `<ul class="wv-more">${more.map((v) => `<li><a href="${esc(yt(v))}" target="_blank" rel="noopener noreferrer"><img src="https://i.ytimg.com/vi/${esc(v.video_id)}/mqdefault.jpg" alt="" loading="lazy" width="160" height="90"><span><span class="wv-chip wv-chip-${esc(v.video_type)}">${CHIP[v.video_type]}</span><b>${esc(v.title)}</b><small>Official · ${esc(v.channel)}</small></span></a></li>`).join('')}</ul>` : ''}
    <p class="wv-note">Official video · embedded from YouTube · not hosted by PropBetEdge</p>
  </div>`;
}

/** Click a poster / Watch: swap in the youtube-nocookie player (only now does YouTube load). */
export function wireWatch(root, signal) {
  root.addEventListener('click', (e) => {
    const b = e.target.closest?.('[data-wv-play]');
    if (!b) return;
    const id = b.dataset.wvPlay;
    if (!ID.test(id)) return;
    const fig = b.closest('.wv-lead');
    const poster = fig?.querySelector('.wv-poster');
    if (!poster) return;
    const f = document.createElement('iframe');
    f.src = `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0`;
    f.title = b.dataset.wvTitle || 'Official match video';
    f.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
    f.allowFullscreen = true;
    f.className = 'wv-frame';
    poster.replaceWith(f);
    fig.querySelector('.wv-go')?.remove();
  }, { signal });
}
