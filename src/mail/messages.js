import { MAIL, NOTIFY, PRODUCT_NAMES, dayHe, when } from '../web/copy.js';
import { esc } from '../web/html.js';

// The emails (a sign-in link, an invite, a sign-up to confirm), as plain text and as simple right-to-left HTML that reads
// the same in Gmail, Outlook and a phone. The link is also written out in full,
// for a mail program that hides buttons.

// `footer`, when there is one: { text, href, label }, a small line under the card (where to turn the email off).
function build(subject, lines, button, footer = null) {
  const link = lines.find((l) => typeof l === 'object')?.link;
  const text = [...lines.map((l) => (typeof l === 'object' ? l.link : l)), '', MAIL.signature, ...(footer ? [`${footer.text}\n${footer.href}`] : [])]
    .join('\n\n')
    .replace(/\n\n\n\n/g, '\n\n');
  const body = lines
    .map((l) =>
      typeof l === 'object'
        ? `<p style="margin:24px 0"><a href="${esc(l.link)}" style="background:#0071e3;color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:10px;display:inline-block;font-weight:600">${esc(button)}</a></p>
<p style="margin:0 0 16px;font-size:13px;color:#56565b;direction:ltr;text-align:right;word-break:break-all">${esc(l.link)}</p>`
        : `<p style="margin:0 0 16px">${esc(l).replace(/\n/g, '<br>')}</p>`
    )
    .join('\n');
  const html = `<!doctype html>
<html lang="he" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${esc(subject)}</title></head>
<body style="margin:0;background:#eeeff2;font-family:-apple-system,'Segoe UI',Arial,sans-serif;color:#1d1d1f">
<div dir="rtl" style="max-width:520px;margin:0 auto;padding:32px 16px">
<div style="background:#ffffff;border-radius:16px;padding:28px 24px;font-size:16px;line-height:1.6;text-align:right">
${body}
<p style="margin:24px 0 0;color:#56565b">${esc(MAIL.signature)}</p>
</div>${
    footer
      ? `
<p style="margin:16px 8px 0;font-size:13px;color:#56565b;text-align:right">${esc(footer.text)} <a href="${esc(footer.href)}" style="color:#56565b">${esc(footer.label)}</a></p>`
      : ''
  }</div></body></html>`;
  return { subject, text, html, link };
}

export const magicLinkMail = (to, link) => ({ to, ...build(MAIL.magicSubject, MAIL.magicLines(link), MAIL.magicButton) });

export const inviteMail = (to, workspaceName, link, expiresAt) => ({
  to,
  ...build(MAIL.inviteSubject(workspaceName), MAIL.inviteLines(workspaceName, link, when(expiresAt)), MAIL.inviteButton),
});

/**
 * Public sign-up: the link that confirms the address and opens the account (src/accounts/signup.js). Nothing the form
 * was given is in it: anyone can type any address into the form, so the email carries no words of theirs. The business's
 * name shows on the page the link opens.
 */
export const signupMail = (to, link) => ({ to, ...build(MAIL.signupSubject, MAIL.signupLines(link), MAIL.signupButton) });

/** Public sign-up, for an address that already has an account: a sign-in link to it instead of a second one. */
export const existingAccountMail = (to, link) => ({ to, ...build(MAIL.existingSubject, MAIL.existingLines(link), MAIL.magicButton) });

// What a customer typed, on one line: no control characters or bidi overrides (a subject header stays one line, and
// nothing reorders the words around it), at most `max` characters. The HTML part escapes it as well.
const plain = (v, max = 120) =>
  String(v ?? '')
    .replace(/[\u0000-\u001f\u007f‎‏‪-‮⁦-⁩]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);

/**
 * To the owner (OF_SIGNUP_NOTIFY), once a sign-up is confirmed: who, which business, which products, each one's plan and
 * price (`prices`, lines already written), when, what to do next by the payment mode (`payment`: in manual, email the
 * customer the payment details), and a link to the workspace on /admin. `products` and `names` are names already
 * (תורן, תדר); `many` when there is more than one.
 */
export const signupNoticeMail = (to, { name, email, business, products, prices = [], payment = 'manual', names = products, many = false, at, method, link }) => {
  const b = plain(business, 80);
  const address = plain(email, 254);
  return {
    to,
    ...build(
      MAIL.noticeSubject(b),
      MAIL.noticeLines(plain(name, 80), address, b, plain(products), when(at), method, link, prices, MAIL.noticePay(payment, address, plain(names), many)),
      MAIL.noticeButton
    ),
  };
};

/**
 * Right after a sign-up is confirmed: the account is open, what happens next (pay, then set up), and /setup. `payment`
 * is how customers pay (OF_PAYMENT) and `opens` when the products open (opensAfter()). In manual mode, `payHow` is how
 * they pay (OF_PAYMENT_METHOD), said when it is set, and questions go to a reply or to our WhatsApp (`wa`, digits).
 */
export const welcomeMail = (to, { business, link, payment = 'manual', opens = '', prices = [], payHow = '', wa = null }) => {
  const b = plain(business, 80);
  const how = plain(payHow, 200);
  const manual = payment !== 'provider' ? [...(how ? [MAIL.welcomePayHow(how)] : []), MAIL.payAsk(wa)] : [];
  return { to, ...build(MAIL.welcomeSubject(b), MAIL.welcomeLines(b, link, payment, opens, [...[].concat(prices), ...manual]), MAIL.welcomeButton) };
};

/** To each owner, when a month's payment is recorded on /admin: until when it is paid. */
export const paidMail = (to, { business, product, until, link }) => ({
  to,
  ...build(MAIL.paidSubject(PRODUCT_NAMES[product]), MAIL.paidLines(plain(business, 80), PRODUCT_NAMES[product], dayHe(until), link), MAIL.paidButton),
});

/**
 * The billing emails to each owner (src/web/daily.js): `kind` soon7 or soon1 (before the payment falls due), due (the
 * day it does, which starts the grace), stopped (the grace is over). `pay` says how to pay (a line, or lines); `amount`
 * is said as written. The button of soon and due goes to `payLink` with `payButton` when there is one (the provider's
 * payment page, "לתשלום"); else, like stopped's, to `link`, the account.
 */
export const billingMail = (to, { kind, business, product, dueOn, graceUntil = null, amount, pay, link, payLink = null, payButton = MAIL.payButton }) => {
  const b = plain(business, 80);
  const p = PRODUCT_NAMES[product];
  const go = payLink || link;
  const label = payLink ? payButton : MAIL.payButton;
  if (kind === 'due') return { to, ...build(MAIL.dueSubject(p), MAIL.dueLines(b, p, dayHe(dueOn), dayHe(graceUntil), amount, pay, go), label) };
  if (kind === 'stopped') return { to, ...build(MAIL.stoppedSubject(p), MAIL.stoppedLines(b, p, link), MAIL.payButton) };
  return { to, ...build(MAIL.soonSubject(p, dayHe(dueOn)), MAIL.soonLines(b, p, dayHe(dueOn), amount, pay, go), label) };
};

/** To the owner (OF_SIGNUP_NOTIFY): a customer's payment fell due (`kind` due), or its grace ended (stopped). */
export const billingNoticeMail = (to, { kind, business, product, dueOn, graceUntil = null, link }) => {
  const b = plain(business, 80);
  const p = PRODUCT_NAMES[product];
  return kind === 'stopped'
    ? { to, ...build(MAIL.stoppedNoticeSubject(b, p), MAIL.stoppedNoticeLines(b, p, link), MAIL.noticeButton) }
    : { to, ...build(MAIL.dueNoticeSubject(b, p), MAIL.dueNoticeLines(b, p, dayHe(dueOn), dayHe(graceUntil), link), MAIL.noticeButton) };
};

/** To each owner of a workspace nobody used and nothing was paid for, 14 days before it is deleted (src/web/daily.js). */
export const idleMail = (to, { business, deleteOn, link }) => {
  const b = plain(business, 80);
  return { to, ...build(MAIL.idleSubject(b), MAIL.idleLines(b, dayHe(deleteOn), link), MAIL.idleButton) };
};

/** To the owner (OF_SIGNUP_NOTIFY): the workspaces deleted today for nobody using them. */
export const idleNoticeMail = (to, { names }) => {
  const list = names.map((n) => plain(n, 80) || '-');
  return { to, ...build(MAIL.idleNoticeSubject(list.length), MAIL.idleNoticeLines(list), '') };
};

/** To each owner, when a product's subscription is cancelled online: until when it works, and how to take it back. */
export const cancelMail = (to, { business, product, lastDay, paid, link }) => ({
  to,
  ...build(MAIL.cancelSubject(PRODUCT_NAMES[product]), MAIL.cancelLines(plain(business, 80), PRODUCT_NAMES[product], paid ? dayHe(lastDay) : null, link), MAIL.cancelButton),
});

/** To the owner (OF_SIGNUP_NOTIFY): a customer cancelled online, or took it back (`resumed`). */
export const cancelNoticeMail = (to, { business, product, who, lastDay = null, paid = false, resumed = false, link }) => {
  const b = plain(business, 80);
  const p = PRODUCT_NAMES[product];
  return resumed
    ? { to, ...build(MAIL.resumeNoticeSubject(b, p), MAIL.resumeNoticeLines(b, p, plain(who, 254), link), MAIL.noticeButton) }
    : { to, ...build(MAIL.cancelNoticeSubject(b, p), MAIL.cancelNoticeLines(b, p, plain(who, 254), paid ? dayHe(lastDay) : null, link), MAIL.noticeButton) };
};

/** To the owner (OF_SIGNUP_NOTIFY): a workspace was deleted, by whom, what each product answered, the invoices kept. */
export const deleteNoticeMail = (to, { business, who, at, byAdmin = false, results = {}, invoicesKept = 0 }) => {
  const b = plain(business, 80);
  const lines = Object.entries(results).map(([p, r]) => `${PRODUCT_NAMES[p]}: ${MAIL.deleteResults[r] || r}`);
  return { to, ...build(MAIL.deleteNoticeSubject(b), MAIL.deleteNoticeLines(b, plain(who, 254), when(at), byAdmin, lines, invoicesKept), MAIL.noticeButton) };
};

/**
 * A product's notification (POST /internal/notify), already checked and made plain (src/accounts/notify.js): its
 * subject, its text with a paragraph for each empty line, a button to its link, and a footer that leads to the page
 * where it is turned off.
 */
export const productNoticeMail = (to, { product, kind, subject, text, link, manage }) => {
  const name = PRODUCT_NAMES[product];
  const lines = [...text.split(/\n{2,}/), { link }];
  return { to, ...build(subject, lines, NOTIFY.mailButton(name), { text: NOTIFY.mailFooter(NOTIFY.kinds[kind], name), href: manage, label: NOTIFY.mailFooterLink }) };
};
