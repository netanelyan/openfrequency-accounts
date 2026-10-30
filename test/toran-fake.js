import { createServer } from 'node:http';
import { TOKEN } from './site.js';

// A pretend Toran on 127.0.0.1, with the two internal routes /admin uses (Toran's docs/operator.md, section 4):
// GET /internal/ops answers `data` (sampleOps() unless set), and POST /internal/ops/<kind>/<id>/<action> answers
// Toran's line for the action, or what `answers[action]` says. Every request is kept in `calls`.

/** What Toran says after each action (its src/web/pages/ops.ts). */
export const SAID = {
  sent: 'סומן שנשלח. התזכורת האחת תחכה כאן בעוד ארבעה ימים.',
  reminded: 'סומן. זו הייתה ההודעה האחרונה אליהם, אלא אם יכתבו.',
  direct: 'נשלח מהמספר של הדמו, וסומן שנשלח.',
  replied: 'עבר ל"בשיחה". הצעד הבא נקבע למחר, ואפשר לשנות אותו שם.',
  next: 'הצעד הבא נשמר.',
  later: 'יחזור לרשימה בזמן שבחרת.',
  lost: 'סומן שלא מעוניינים. לא נכתוב להם יותר.',
  reopen: 'חזר לרשימה.',
  pilot: 'סומן שהתחילו פיילוט.',
  paid: 'סומן שמשלמים.',
  won: 'סומן כלקוח.',
};

const ago = (at, hours) => new Date(at - hours * 3_600_000).toISOString();

/** A dashboard's worth of leads, in the documented shapes, as of `at` (ms). Fictional stores only. */
export function sampleOps(at = Date.now()) {
  // Toran's links carry the card's message (wa.me's text, mailto's body); with no message, the chat alone.
  const wa = (phone, text) => ({ kind: 'whatsapp', href: `https://wa.me/${phone}${text ? `?text=${encodeURIComponent(text)}` : ''}`, label: 'להעתיק ולפתוח וואטסאפ' });
  const lead = (id) => `https://toran.openfrequency.co.il/lead/${id}`;
  const tried = 'היי, ראינו שניסיתם את הדמו של תורן לנעלי הגליל. איך היה?';
  const asked = 'הדמו של תורן לתבלינים מהשוק מוכן.\nhttps://toran.openfrequency.co.il/p/spice-market';
  const first = 'היי, כאן OpenFrequency. הכנו לקרמיקה בעמק דף שמראה את תורן עונה ללקוחות של החנות.';
  const broken = 'היי, כאן OpenFrequency. ביקשתם באתר דמו של תדר לחנות הכלים, ולא הצלחנו לבנות אותו. אם יש שאלה, אפשר לענות כאן.';
  const wixed ='היי, כאן OpenFrequency. ביקשתם באתר דמו של תורן ל־wix-store. תורן בונה דמו רק לחנויות Shopify, והחנות על Wix, אז לא יכולנו לבנות אותו. אם יש שאלה, אפשר לענות כאן.';
  return {
    teder: { ok: true },
    items: [
      { key: 'toran:12', product: 'toran', id: '12', reason: 'tried_demo', rank: 100, name: 'נעלי הגליל', domain: 'galil-shoes.example', why: 'ניסו את הדמו', message: tried, target: wa('972500000201', tried), direct: false, mark: 'reminded', page: 'https://toran.openfrequency.co.il/p/galil-shoes', at: ago(at, 3), leadUrl: lead(12) },
      { key: 'teder:7', product: 'teder', id: '7', reason: 'next_step', rank: 90, name: 'סטודיו כרמל', domain: 'carmel-studio.example', why: 'הצעד הבא: לשלוח הצעת מחיר', message: null, target: wa('972500000202'), direct: false, mark: 'next', page: 'https://teder.openfrequency.co.il/s/carmel-x1', at: ago(at, 2), leadUrl: null },
      { key: 'toran:15', product: 'toran', id: '15', reason: 'asked_toran', rank: 85, name: 'תבלינים מהשוק', domain: 'spice-market.example', why: 'ביקשו דמו באתר, הדף מוכן', message: asked, target: wa('972500000203', asked), direct: true, mark: 'sent', page: 'https://toran.openfrequency.co.il/p/spice-market', at: ago(at, 5), leadUrl: lead(15) },
      { key: 'toran:21', product: 'toran', id: '21', reason: 'first_send', rank: 47, name: 'קרמיקה בעמק', domain: 'emek-ceramics.example', why: 'מוכן לשליחה, ציון 71', message: first, target: { kind: 'email', href: `mailto:hello@emek-ceramics.example?subject=${encodeURIComponent('תורן לקרמיקה בעמק')}&body=${encodeURIComponent(first)}`, label: 'להעתיק ולפתוח מייל' }, direct: false, mark: 'sent', page: 'https://toran.openfrequency.co.il/p/emek-ceramics', at: ago(at, 26), leadUrl: lead(21) },
    ],
    noContact: [{ id: 31, name: 'צמחים בבית', domain: 'plants-home.example', score: 64, leadUrl: lead(31) }],
    stuck: [{ product: 'toran', domain: 'wix-store.example', phone: '972500000204', at: ago(at, 6), why: 'האתר על Wix, ותורן בונה דמו רק לחנויות Shopify', storeId: 40, message: wixed, target: wa('972500000204', wixed), leadUrl: lead(40) }],
    tederDemos: [
      { id: '14', domain: 'kelim.example', name: 'חנות הכלים', status: 'failed', why: 'לא נבנה', error: 'לא הצלחנו לקרוא את החנות', whatsapp: '972500000208', at: ago(at, 20), message: broken, target: wa('972500000208', broken), leadUrl: 'https://teder.openfrequency.co.il/demos/14' },
      { id: '15', domain: 'new-teder.example', name: 'new-teder.example', status: 'building', why: 'בבנייה', error: null, whatsapp: null, at: ago(at, 1), message: null, target: { kind: null, href: null, label: 'להעתיק' }, leadUrl: 'https://teder.openfrequency.co.il/demos/15' },
    ],
    leads: {
      ok: true,
      waitlist: [
        { id: 31, store: 'soon-shop.example', contact: '972500000209', page: '/toran', at: ago(at, 30) },
        { id: 33, store: null, contact: 'soon@shop.example', page: '/join', at: ago(at, 50) },
      ],
      failed: [{ id: 32, store: 'lost-lead.example', contact: '972500000210', page: '/teder', at: ago(at, 4), product: 'teder', source: 'teder' }],
    },
    conversations: [
      { key: 'toran:9', product: 'toran', id: '9', name: 'מאפיית השכונה', domain: 'bakery.example', replied_at: ago(at, 48), next_step: 'לקבוע שיחה', next_step_at: ago(at, -20), target: wa('972500000205'), page: 'https://toran.openfrequency.co.il/p/bakery', status: 'pilot', leadUrl: lead(9) },
      { key: 'teder:7', product: 'teder', id: '7', name: 'סטודיו כרמל', domain: 'carmel-studio.example', replied_at: ago(at, 72), next_step: 'לשלוח הצעת מחיר', next_step_at: ago(at, 2), target: wa('972500000202'), page: 'https://teder.openfrequency.co.il/s/carmel-x1', status: 'approved', leadUrl: null },
    ],
    funnels: {
      toran: [
        { key: 'found', label: 'נמצאו', all: 40, month: 12 },
        { key: 'qualified', label: 'מתאימות', all: 20, month: 6 },
        { key: 'page', label: 'דף מוכן', all: 16, month: 5 },
        { key: 'sent', label: 'נשלח', all: 10, month: 4 },
        { key: 'opened', label: 'נפתח', all: 6, month: 3 },
        { key: 'demo', label: 'ניסו את הדמו', all: 4, month: 2 },
        { key: 'replied', label: 'ענו', all: 3, month: 2 },
        { key: 'customers', label: 'לקוחות', all: null, month: null },
      ],
      teder: [
        { key: 'asked', label: 'ביקשו באתר', all: 8, month: 4 },
        { key: 'ready', label: 'מצגת מוכנה', all: 6, month: 3 },
        { key: 'sent', label: 'נשלח', all: 5, month: 3 },
        { key: 'opened', label: 'נפתח', all: 4, month: 2 },
        { key: 'replied', label: 'ענו', all: 2, month: 1 },
        { key: 'customers', label: 'לקוחות', all: null, month: null },
      ],
    },
    ourNumber: { number: '972500000999', status: 'active', roles: [{ key: 'demo', he: 'הדמו: מי ששלח קוד מעמוד של חנות, או שהדמו שלו עוד פתוח' }], leadUrl: lead(1) },
    demoLine: { live: true, via: 'meta', number: '972500000999' },
  };
}

export async function startToran({ token = TOKEN, data = sampleOps(), answers = {} } = {}) {
  const calls = [];
  const state = { data, answers, down: false };
  const server = createServer(async (req, res) => {
    let raw = '';
    for await (const c of req) raw += c;
    const call = { method: req.method, path: req.url, auth: req.headers.authorization || null, body: raw ? JSON.parse(raw) : null };
    calls.push(call);
    const send = (status, body) => {
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      res.end(JSON.stringify(body));
    };
    if (state.down) return send(503, { error: 'down' });
    if (call.auth !== `Bearer ${token}`) return send(401, { error: 'bad_token' });
    if (req.method === 'GET' && req.url === '/internal/ops') return send(200, state.data);
    const m = /^\/internal\/ops\/(toran|teder)\/([^/]+)\/([a-z]+)$/.exec(req.url);
    if (req.method === 'POST' && m) {
      const a = state.answers[m[3]];
      if (a) return send(a.status, a.body);
      return send(200, { ok: true, message: SAID[m[3]] || 'סומן.' });
    }
    return send(404, { error: 'not_found' });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    calls,
    state,
    posts: () => calls.filter((c) => c.method === 'POST'),
    close: () => new Promise((r) => server.close(r)),
  };
}
