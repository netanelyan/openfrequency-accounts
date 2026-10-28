// The loading state, the one script on every page (Teder's and Toran's do the same; /admin adds admin.js). Nothing
// works differently without it: it only shows that a tap was heard.
(() => {
  // A tap never sits still. ~120ms after a link or a form is used (and not handled above), a bar runs along
  // the top; a link also turns the page under the header into the skeleton of the page that is coming, and a form's
  // button spins, until the next page paints. A quick page never shows any of it. Downloads, new tabs, other sites,
  // in-page anchors and the background forms (data-ajax) are left alone; Back to a page kept in memory gets it as it was.
  const root = document.documentElement;
  const main = document.querySelector('main');
  const base = root.dataset.base || '';
  const SHAPES = [
    [/^\/(setup)?$/, 'home'],
    [/^\/admin$/, 'admin'],
    [/^\/admin\/(?!toran)/, 'list'],
    [/^\/admin\/toran/, 'wide'],
  ];
  // An invoice opens as a PDF, not a page; Google's sign-in is another site and goes as it is.
  const DOWNLOAD = /\.(csv|json|pdf|zip|png|jpe?g|webp|gif|svg)$|\/invoices\/\d+$/i;
  const shapeOf = (path) => {
    const p = base && path.startsWith(base) ? path.slice(base.length) || '/' : path;
    return (SHAPES.find(([re]) => re.test(p)) || [null, 'page'])[1];
  };
  const div = (cls, ...kids) => {
    const d = document.createElement('div');
    d.className = cls;
    d.append(...kids);
    return d;
  };
  const W = [78, 52, 88, 40, 66, 82, 46, 70];
  const line = (i, cls = '') => {
    const s = div(`sk ${cls}`);
    s.style.width = `${W[i % W.length]}%`;
    return s;
  };
  const lines = (n, from = 0) => div('sk-lines', ...Array.from({ length: n }, (_, i) => line(from + i)));
  const row = (i) => div('sk-row', div('sk dot'), div('sk-lines', line(i), line(i + 3, 'sub')), div('sk pill'));
  const rows = (n) => div('card', ...Array.from({ length: n }, (_, i) => row(i)));
  const card = (n, from = 0) => div('card', lines(n, from), div('sk-acts', div('sk btn')));
  const tabs = () => div('sk-tabs', div('sk'), div('sk'), div('sk'));
  const BUILD = {
    home: () => [card(3), card(2, 3)],
    admin: () => [tabs(), div('kpis top-kpis', ...[1, 3, 5, 0, 2].map((i) => div('kpi', line(i), line(i + 2, 'big')))), div('sk-ops', card(3), card(3, 2), card(3, 4), card(3, 1))],
    list: () => [tabs(), rows(6)],
    wide: () => [tabs(), card(5), card(3, 3)],
    page: () => [card(4)],
  };
  const skeleton = (shape) => {
    const page = div('sk-page', div('sk-head', line(0, 'h1'), line(5, 'sub')), ...BUILD[shape]());
    page.setAttribute('role', 'status');
    page.prepend(Object.assign(document.createElement('span'), { className: 'sk-say', textContent: 'טוען…' }));
    return page;
  };

  let bar = null;
  let timer = 0;
  let busy = null;
  let navWas = null;
  let scrolled = null;
  const stop = () => {
    clearTimeout(timer);
    root.classList.remove('is-loading', 'sk-on');
    main?.querySelector(':scope > .sk-page')?.remove();
    main?.removeAttribute('aria-busy');
    busy?.removeAttribute('aria-busy');
    busy = null;
    if (navWas) for (const [a, cur] of navWas) cur ? a.setAttribute('aria-current', cur) : a.removeAttribute('aria-current');
    navWas = null;
    if (scrolled != null) window.scrollTo(0, scrolled);
    scrolled = null;
  };
  const start = (shape, button) => {
    stop();
    if (button) setTimeout(() => button.setAttribute('aria-busy', 'true')); // after the submit, so its name still goes
    busy = button;
    timer = setTimeout(() => {
      bar ??= document.body.appendChild(div('loadbar'));
      root.classList.add('is-loading');
      if (!shape || !main) return;
      main.prepend(skeleton(shape));
      main.setAttribute('aria-busy', 'true');
      root.classList.add('sk-on');
      scrolled = window.scrollY;
      window.scrollTo(0, 0);
    }, 120);
  };
  const leaves = (url) => url.origin === location.origin && !DOWNLOAD.test(url.pathname) && !(url.pathname === location.pathname && url.search === location.search && url.hash);

  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[href]');
    if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if ((a.target && a.target !== '_self') || a.hasAttribute('download') || a.hasAttribute('data-no-wait')) return;
    const url = new URL(a.href, location.href);
    if (!leaves(url)) return;
    // The tab you tapped lights up now, not when its page arrives.
    const nav = a.closest('nav.tabs');
    if (nav) {
      navWas = [...document.querySelectorAll('nav.tabs a')].map((x) => [x, x.getAttribute('aria-current')]);
      const keep = navWas;
      start(shapeOf(url.pathname));
      navWas = keep;
      for (const [x] of navWas) x.toggleAttribute('aria-current', x.getAttribute('href') === a.getAttribute('href'));
      for (const [x] of navWas) if (x.hasAttribute('aria-current')) x.setAttribute('aria-current', 'page');
    } else start(shapeOf(url.pathname));
  });
  document.addEventListener('submit', (e) => {
    const form = e.target;
    if (e.defaultPrevented || (form.target && form.target !== '_self') || form.hasAttribute('data-no-wait')) return;
    const url = new URL(form.getAttribute('action') || location.href, location.href);
    if (url.origin !== location.origin || DOWNLOAD.test(url.pathname)) return;
    if ((form.getAttribute('method') || 'get').toLowerCase() === 'get') start(shapeOf(url.pathname));
    else start(null, e.submitter || form.querySelector('[type=submit], button:not([type])'));
  });
  window.addEventListener('pageshow', (e) => e.persisted && stop());
  document.addEventListener('keydown', (e) => e.key === 'Escape' && root.classList.contains('is-loading') && stop());

})();
