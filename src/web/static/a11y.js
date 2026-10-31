// The accessibility panel, as on openfrequency.co.il (its site.js): the round button at the bottom corner opens four
// switches, each a class on <html> (a-big, a-contrast, a-links, a-still), kept in this browser under the website's own
// key, of-a11y, and a reset; the statement is the website's. It closes on Escape (focus back on the button) or a click
// outside. This file is in the head without defer, so the saved switches are on <html> before the page paints (the
// website does that with an inline script, which this site's CSP does not run); the panel is wired once the page is
// read. Without script the button stays hidden and the page is the same page.
(() => {
  const root = document.documentElement;
  const KEY = 'of-a11y';
  let on = {};
  try { on = JSON.parse(localStorage.getItem(KEY)) || {}; } catch { on = {}; }
  if (typeof on !== 'object' || Array.isArray(on)) on = {};
  let box = null;
  const apply = () => {
    for (const k of ['big', 'contrast', 'links', 'still']) root.classList.toggle(`a-${k}`, on[k] === true);
    if (box) for (const b of box.querySelectorAll('[data-a]')) b.setAttribute('aria-pressed', String(on[b.dataset.a] === true));
  };
  apply();

  const wire = () => {
    box = document.querySelector('[data-a11y]');
    if (!box) return;
    const btn = box.querySelector('.a11y-btn');
    const panel = box.querySelector('.a11y-p');
    const save = () => { try { localStorage.setItem(KEY, JSON.stringify(on)); } catch {} };
    const show = (open) => { panel.hidden = !open; btn.setAttribute('aria-expanded', String(open)); };
    apply();
    box.hidden = false;
    btn.addEventListener('click', () => show(panel.hidden));
    box.addEventListener('click', (e) => {
      const b = e.target.closest('[data-a]');
      if (b) { on[b.dataset.a] = on[b.dataset.a] !== true; apply(); save(); }
      if (e.target.closest('[data-a11y-reset]')) { on = {}; apply(); save(); }
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !panel.hidden) { show(false); btn.focus(); } });
    document.addEventListener('click', (e) => { if (!panel.hidden && !box.contains(e.target)) show(false); });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire);
  else wire();
})();
