// The operator's dashboard on /admin (src/web/dashboard.js). Everything on it works without this file: each button is
// a form that posts and comes back, and "copy and open" is a link to the chat. With it (ported from Toran's app.js):
//   - [data-copy] copies the message in its card first (the link then opens the chat as usual)
//   - forms marked data-ajax post in the background; Toran's line shows at the bottom, and the card goes away
//     ("remove") or the page reloads ("reload")
// Words come from the page (data-done, data-fail) or from the toast's own data-*, so every Hebrew line stays in copy.js.

(() => {
  document.documentElement.classList.add('js');
  const toast = document.getElementById('toast');
  let timer = null;
  const say = (msg, bad = false) => {
    if (!toast || !msg) return;
    toast.textContent = msg;
    toast.classList.toggle('bad', bad);
    toast.classList.add('show');
    clearTimeout(timer);
    timer = setTimeout(() => toast.classList.remove('show'), 3600);
  };

  // The copy runs inside the click, where browsers allow it; execCommand first because it works on more phones.
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-copy]');
    if (!b) return;
    const src = document.querySelector(b.dataset.copy);
    const text = src ? ('value' in src ? src.value : src.textContent) : '';
    let ok = false;
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.className = 'sr';
      document.body.appendChild(ta);
      ta.select();
      ok = document.execCommand('copy');
      ta.remove();
    } catch {
      ok = false;
    }
    if (!ok && navigator.clipboard) {
      navigator.clipboard.writeText(text).then(
        () => say(b.dataset.done),
        () => say(b.dataset.fail, true)
      );
      return;
    }
    say(ok ? b.dataset.done : b.dataset.fail, !ok);
  });

  // "Not interested": opening one closes the others, and focuses its reasons.
  document.addEventListener('toggle', (e) => {
    const d = e.target;
    if (!(d instanceof HTMLDetailsElement) || !d.classList.contains('lost') || !d.open) return;
    for (const o of document.querySelectorAll('details.lost[open]')) if (o !== d) o.open = false;
    d.querySelector('select')?.focus();
  }, true);

  document.addEventListener('submit', async (e) => {
    const form = e.target.closest('form[data-ajax]');
    if (!form || !window.fetch) return;
    e.preventDefault();
    const submit = form.querySelector('button');
    if (submit?.getAttribute('aria-busy') === 'true') return;
    submit?.setAttribute('aria-busy', 'true');
    try {
      const res = await fetch(form.action, {
        method: 'POST',
        headers: { 'x-of-ajax': '1', 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(new FormData(form)),
        credentials: 'same-origin',
      });
      const out = await res.json().catch(() => ({ ok: false, message: toast?.dataset.unexpected }));
      say(out.message, !out.ok);
      if (!out.ok) return;
      if (form.dataset.ajax === 'remove') {
        const card = form.closest('[data-item]');
        if (card) {
          card.style.maxHeight = `${card.scrollHeight}px`;
          card.classList.add('leaving');
          setTimeout(() => card.classList.add('gone'), 220);
          setTimeout(() => card.remove(), 600);
        }
      } else setTimeout(() => location.reload(), 500);
    } catch {
      say(toast?.dataset.offline, true);
    } finally {
      submit?.removeAttribute('aria-busy');
    }
  });

  // A link to a section opens its <details>.
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[href^="#"]');
    const to = a && a.getAttribute('href').length > 1 ? document.querySelector(a.getAttribute('href')) : null;
    if (to?.tagName === 'DETAILS') to.open = true;
  });
})();
