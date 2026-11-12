import { MAIL, NOTIFY, PAY, PRODUCT_NAMES, dayHe, ils, phoneHe, weekdayHe, when } from '../web/copy.js';
import { esc } from '../web/html.js';

// The emails (a sign-in link, an invite, a sign-up to confirm, billing, a product's notice), as plain text and as
// right-to-left HTML in the website's look: the silver ground, one white card, the mark and the name above it, one
// button. It is built of tables with inline styles, so Gmail, Outlook and a phone read it the same; a mail program that
// knows dark mode (Apple Mail, Outlook on a Mac) gets the site's dark colours from the <style> block, and one that
// strips it keeps the light ones. The link is also written out in full, for a mail program that hides buttons.

// The marks are the website's PNGs (openfrequency-web assets/brand/png, built to /mail): a mail program shows no SVG.
// A product's notice wears its product's mark and colour; everything else, OpenFrequency's.
export const MAIL_IMAGES = 'https://openfrequency.co.il/mail';
const BRAND = {
  openfrequency: { name: 'OpenFrequency', image: 'openfrequency', color: '#2747d6', dark: '#8fa2ff', button: '#0071e3' },
  teder: { name: PRODUCT_NAMES.teder, image: 'teder', color: '#5b33c2', dark: '#b9a2ff', button: '#6a3fd6' },
  toran: { name: PRODUCT_NAMES.toran, image: 'toran', color: '#0c6b49', dark: '#5fd6a6', button: '#0f7a54' },
};
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif";

// A number written with separators (a phone, 055-253-6259; a date, 1.12.2026; a time, 09:12; an amount, 3,610.80) is
// kept whole and left to right inside a Hebrew line: without it a narrow screen breaks it at a dash, and the bidi order
// moves the pieces. The thousands comma is one of them (the audit of 2026-11-11: "3,610.80 ₪" came out "610.80,3 ₪",
// the span holding only "610.80"); a digit must follow it, so "10.11.2026, והתשלום" keeps its comma outside.
export const ltrNumbers = (html) => html.replace(/\d+(?:[-.:/,]\d+)+/g, (n) => `<span dir="ltr" style="white-space:nowrap">${n}</span>`);

// A WhatsApp link with its message written (paying over WhatsApp, src/web/pay.js): its button is enough, and the
// address is not printed under it in the HTML, where it would show the message's words encoded. The text part keeps
// it, as it keeps every link.
const WA_TEXT = /^https:\/\/wa\.me\/\d+\?text=/;

// `footer`, when there is one: { text, href, label }, a small line under the card (where to turn the email off).
// `brand`: openfrequency, teder or toran. A line { link } is a button labelled `button`; { link, label } has its own,
// for an email with two (the welcome email's payment and setup); { link, label, plain: true } is a plain link, not a
// button, so an email keeps one main action (the audit of 2026-11-11); { small } is a quieter line, under a button
// (the details for paying without WhatsApp).
function build(subject, lines, button, footer = null, brand = 'openfrequency') {
  const b = BRAND[brand] || BRAND.openfrequency;
  const link = lines.find((l) => typeof l === 'object' && l.link)?.link;
  const text = [...lines.map((l) => (typeof l !== 'object' ? l : l.small != null ? l.small : l.plain ? `${l.label}:\n${l.link}` : l.link)), '', MAIL.signature, ...(footer ? [`${footer.text}\n${footer.href}`] : [])]
    .join('\n\n')
    .replace(/\n\n\n\n/g, '\n\n');
  // The line an inbox shows beside the subject: the first one that says something, not the greeting, and not the
  // subject said again (the paid email's "תדר פתוח. אפשר להתחיל.").
  const preview = lines.find((l) => typeof l === 'string' && l !== 'שלום,' && l !== `${subject}.`) || '';
  const body = lines
    .map((l) =>
      typeof l !== 'object'
        ? `<p class="of-ink" style="margin:0 0 16px;color:#1d1d1f">${ltrNumbers(esc(l)).replace(/\n/g, '<br>')}</p>`
        : l.small != null
          ? `<p class="of-muted" style="margin:0 0 14px;font-size:14px;line-height:1.6;color:#636368">${ltrNumbers(esc(l.small)).replace(/\n/g, '<br>')}</p>`
          : l.plain
            ? `<p style="margin:0 0 16px"><a class="of-link" href="${esc(l.link)}" style="color:${b.button};font-weight:600;text-decoration:underline">${esc(l.label)}</a></p>`
            : `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:26px 0 12px"><tr><td bgcolor="${b.button}" style="background:${b.button};border-radius:12px"><a href="${esc(l.link)}" style="display:inline-block;padding:13px 30px;font:600 16px/1.25 ${FONT};color:#ffffff;text-decoration:none;border-radius:12px">${esc(l.label || button)}</a></td></tr></table>
${WA_TEXT.test(l.link) ? '' : `<p class="of-muted" style="margin:0 0 22px;font-size:13px;line-height:1.5;color:#636368;direction:ltr;text-align:right;word-break:break-all">${esc(l.link)}</p>`}`
    )
    .join('\n');
  const html = `<!doctype html>
<html lang="he" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark"><title>${esc(subject)}</title>
<style>
@media (prefers-color-scheme: dark) {
  .of-bg { background:#111113 !important; }
  .of-card { background:#1c1c1e !important; border-color:#2c2c2e !important; }
  .of-ink { color:#f5f5f7 !important; }
  .of-muted, .of-muted a { color:#a1a1a6 !important; }
  .of-name, .of-link { color:${b.dark} !important; }
  .of-rule { border-color:#2c2c2e !important; }
}
@media (max-width: 600px) { .of-pad { padding:26px 20px !important; } }
</style></head>
<body class="of-bg" style="margin:0;padding:0;background:#eeeff2">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all">${esc(preview)}</div>
<table role="presentation" class="of-bg" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#eeeff2" style="background:#eeeff2"><tr><td align="center" style="padding:28px 12px 36px">
<table role="presentation" dir="rtl" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px">
<tr><td align="right" style="padding:0 6px 16px"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td style="padding-left:10px"><img src="${MAIL_IMAGES}/${b.image}.png" width="36" height="36" alt="" style="display:block;border:0;width:36px;height:36px"></td><td class="of-name" style="font:700 20px/1 ${FONT};color:${b.color}">${esc(b.name)}</td></tr></table></td></tr>
<tr><td class="of-card of-pad" bgcolor="#ffffff" style="background:#ffffff;border:1px solid #e3e4e8;border-radius:18px;padding:32px 30px;font:16px/1.65 ${FONT};color:#1d1d1f;text-align:right">
${body}
<p class="of-muted of-rule" style="margin:26px 0 0;padding-top:18px;border-top:1px solid #ececf0;color:#636368">${esc(MAIL.signature)}</p>
</td></tr>${
    footer
      ? `
<tr><td class="of-muted" style="padding:16px 8px 0;font:13px/1.5 ${FONT};color:#636368;text-align:right">${esc(footer.text)} <a href="${esc(footer.href)}" style="color:#636368">${esc(footer.label)}</a></td></tr>`
      : ''
  }
<tr><td class="of-muted" style="padding:20px 8px 0;font:12px/1.5 ${FONT};color:#636368;text-align:right">OpenFrequency™ · <a href="https://openfrequency.co.il" style="color:#636368;text-decoration:none">openfrequency.co.il</a></td></tr>
</table></td></tr></table></body></html>`;
  return { subject, text, html, link };
}

export const magicLinkMail = (to, link) => ({ to, ...build(MAIL.magicSubject, MAIL.magicLines(link), MAIL.magicButton) });

/**
 * An invite to a workspace. `from` is who sent it from the home page's team form (an owner's name, else their
 * address), named in it so the invite is theirs; without one, the console's (the operator opened the account).
 */
export const inviteMail = (to, workspaceName, link, expiresAt, from = null) => {
  const ws = plain(workspaceName, 80);
  const who = plain(from, 120);
  return {
    to,
    ...build(MAIL.inviteSubject(ws), who ? MAIL.inviteFromLines(who, ws, link, when(expiresAt)) : MAIL.inviteLines(ws, link, when(expiresAt)), MAIL.inviteButton),
  };
};

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
 * (תורן, תדר); `many` when there is more than one. `founders`, the line of the founders' spot when it took or holds one
 * (MAIL.noticeFounders). `added`: a customer added this product to an account it had (the same notice, about it).
 * `detailsSent`: the customer's email has the payment details (OF_PAYMENT_METHOD); `wa`, beside the button to pay
 * over WhatsApp.
 */
export const signupNoticeMail = (to, { name, email, business, products, prices = [], payment = 'manual', names = products, many = false, at, method, link, detailsSent = false, wa = false, founders = '', added = false }) => {
  const b = plain(business, 80);
  const address = plain(email, 254);
  return {
    to,
    ...build(
      added ? MAIL.noticeAddedSubject(b, plain(products)) : MAIL.noticeSubject(b),
      MAIL.noticeLines(plain(name, 80), address, b, plain(products), when(at), method, link, prices, MAIL.noticePay(payment, address, plain(names), many, { sent: detailsSent, wa, added }), { added, founders }),
      MAIL.noticeButton
    ),
  };
};

/**
 * Right after a sign-up is confirmed: the account is open, what happens next (pay, then set up), and /setup. `payment`
 * is how customers pay (OF_PAYMENT) and `opens` when the products open (opensAfter()). In manual mode, `payHow` is how
 * they pay (OF_PAYMENT_METHOD), said when it is set, and questions go to a reply or to our WhatsApp (`wa`, digits).
 */
// What the first payment comes to (`total`, its lines), in either mode; in manual mode then how to pay, the receipt
// (אסמכתא) to us once the owner's payment details are in it, and whom to ask. With `payLink` (paying over WhatsApp,
// src/web/pay.js), its button `payButton` is the email's one: under it, quieter, the details for a transfer without
// WhatsApp and the receipt by a reply (the owner, 2026-11-11: the bank details always there, never only on WhatsApp),
// and the setup page is a plain link. `founders`: the founders' offer waived the setup fee, said once after the prices
// (MAIL.welcomeFounders). `added`: a product added to an account that was open already, by its name: the same email,
// about it (app.js /subscription/<product>/add).
export const welcomeMail = (to, { business, link, payment = 'manual', opens = '', prices = [], total = [], payHow = '', wa = null, payLink = null, payButton = PAY.button, founders = false, added = '' }) => {
  const b = plain(business, 80);
  const how = plain(payHow, 200);
  const overWa = Boolean(payment !== 'provider' && how && payLink);
  const pay = overWa ? [{ link: payLink, label: payButton }, { small: MAIL.payDirect(how) }, { small: MAIL.receipt(null) }] : how ? [MAIL.welcomePayHow(how), MAIL.receipt(wa)] : [];
  const manual = [...[].concat(total), ...(payment !== 'provider' ? [...pay, MAIL.payAsk(wa)] : [])];
  const details = payment === 'provider' ? false : overWa ? 'wa' : Boolean(how);
  const lines = [...[].concat(prices), ...(founders ? [MAIL.welcomeFounders] : []), ...manual];
  return { to, ...build(added ? MAIL.addedSubject(added, b) : MAIL.welcomeSubject(b), MAIL.welcomeLines(b, link, payment, opens, lines, details, { added, plainLink: overWa }), MAIL.welcomeButton) };
};

/**
 * What a recorded payment did to the product, for the first line of its email (paidMail): 'first', it opened it and
 * nothing had been paid before; 'again', it opened it after it stopped (its grace over); 'on', it was open already and
 * goes on (paid ahead, in its grace, or complimentary); null, it is not open even now (cancelled, turned off, the
 * workspace disabled), and the email says only what was paid. `before` and `after` are entitlement.js accessFor() (or
 * accessOf()) just before and just after the payment. A cancelled product gets null either way: a month paid does not
 * move its last day, so nothing here says it goes on.
 */
export function paidOpening(before, after) {
  if (!after?.allowed || after.access === 'cancelled') return null;
  if (before?.allowed) return 'on';
  return before?.paidUntil ? 'again' : 'first';
}

/**
 * To each owner, when a month's payment is recorded on /admin: what was paid and until when, and the invoice's line.
 * With `opening` (paidOpening()) and `productLink` (TEDER_URL, TORAN_URL), it opens with what the payment did ("תדר
 * פתוח. אפשר להתחיל"), and its one button leads into the product; otherwise to `link`, the account, as before.
 */
export const paidMail = (to, { business, product, until, link, productLink = null, opening = null }) => {
  const p = PRODUCT_NAMES[product];
  const go = productLink && opening ? opening : null;
  return { to, ...build(MAIL.paidSubject(p, go), MAIL.paidLines(plain(business, 80), p, dayHe(until), go ? productLink : link, go), go ? MAIL.paidGo(p) : MAIL.paidButton) };
};

/**
 * The billing emails to each owner (src/web/daily.js): `kind` soon7 or soon1 (before the payment falls due), due (the
 * first day after the paid month, `paidUntil`, which starts the 72 hours), last (`graceUntil`, the last of them),
 * stopped (the grace is over). `pay` says how to pay (a line, or lines), before the button; `after`, lines under it
 * (paying over WhatsApp: { small } lines with the details for a transfer without it); `amount` is said as written. due
 * and last name the day it stops with its weekday ("יום שלישי, 24.11.2026"). The button goes to `payLink` with
 * `payButton` when there is one (the provider's payment page, "לתשלום", or our WhatsApp); else to `link`, the account,
 * "לחשבון", and stopped's "לתשלום" (the audit of 2026-11-11: it had no way to pay).
 */
export const billingMail = (to, { kind, business, product, paidUntil = null, dueOn, graceUntil = null, amount, pay, after = [], link, payLink = null, payButton = MAIL.payButton }) => {
  const b = plain(business, 80);
  const p = PRODUCT_NAMES[product];
  const go = payLink || link;
  const label = payLink ? payButton : MAIL.payButton;
  if (kind === 'due') return { to, ...build(MAIL.dueSubject(p), MAIL.dueLines(b, p, dayHe(paidUntil), weekdayHe(graceUntil), amount, pay, go, after), label) };
  if (kind === 'last') return { to, ...build(MAIL.lastSubject(p), MAIL.lastLines(b, p, weekdayHe(graceUntil), amount, pay, go, after), label) };
  if (kind === 'stopped') return { to, ...build(MAIL.stoppedSubject(p), MAIL.stoppedLines(b, p, go, amount, pay, after), payLink ? payButton : MAIL.payOnlineButton) };
  return { to, ...build(MAIL.soonSubject(p, dayHe(dueOn)), MAIL.soonLines(b, p, dayHe(dueOn), amount, pay, go, after, kind === 'soon1'), label) };
};

/**
 * To each owner of a workspace on the terms from before 2026-11-03, once (src/web/daily.js termsNotices): from
 * `changeOn` a new month's payment has 72 hours, until then nothing changes, a reminder before each month ends, and one
 * button to the terms (`link`). The billing emails' look.
 */
export const termsNoticeMail = (to, { business, changeOn, link }) => ({ to, ...build(MAIL.termsSubject(dayHe(changeOn)), MAIL.termsLines(plain(business, 80), dayHe(changeOn), link), MAIL.termsButton) });

/** To the owner (OF_SIGNUP_NOTIFY): a customer's payment fell due (`kind` due), or its grace ended (stopped). */
export const billingNoticeMail = (to, { kind, business, product, dueOn, graceUntil = null, link }) => {
  const b = plain(business, 80);
  const p = PRODUCT_NAMES[product];
  return kind === 'stopped'
    ? { to, ...build(MAIL.stoppedNoticeSubject(b, p), MAIL.stoppedNoticeLines(b, p, link), MAIL.noticeButton) }
    : { to, ...build(MAIL.dueNoticeSubject(b, p), MAIL.dueNoticeLines(b, p, dayHe(dueOn), dayHe(graceUntil), link), MAIL.noticeButton) };
};

/**
 * To the operator (OF_SIGNUP_NOTIFY): a customer sent Toran a picture of a transfer (POST /internal/pay/receipt). The
 * business, what was owed when it came (with VAT), the number it came from, when, what Toran read on the picture
 * (`check`, src/accounts/pay.js checkOf(): its words are the picture's, made plain here and escaped by build()), that the
 * bank is what counts, and one button to its page on /admin, where the payment is recorded or not. Nothing of the
 * file is in the email.
 */
export const receiptNoticeMail = (to, { business, total, phone, at, link, check = null }) => {
  const b = plain(business, 80);
  const read = PAY.checkLines(check, total).map((l) => plain(l, 200));
  return { to, ...build(PAY.noticeSubject(b), PAY.noticeLines(b, total ? PAY.noticeAmount(ils(total)) : PAY.noticeNothing, phoneHe(phone), when(at), link, read), PAY.noticeButton) };
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
  return { to, ...build(subject, lines, NOTIFY.mailButton(name), { text: NOTIFY.mailFooter(NOTIFY.kindLabel(product, kind), name), href: manage, label: NOTIFY.mailFooterLink }, product) };
};
