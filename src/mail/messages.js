import { MAIL, when } from '../web/copy.js';
import { esc } from '../web/html.js';

// The two emails, as plain text and as simple right-to-left HTML that reads
// the same in Gmail, Outlook and a phone. The link is also written out in full,
// for a mail program that hides buttons.

function build(subject, lines, button) {
  const link = lines.find((l) => typeof l === 'object')?.link;
  const text = [...lines.map((l) => (typeof l === 'object' ? l.link : l)), '', MAIL.signature].join('\n\n').replace(/\n\n\n\n/g, '\n\n');
  const body = lines
    .map((l) =>
      typeof l === 'object'
        ? `<p style="margin:24px 0"><a href="${esc(l.link)}" style="background:#0071e3;color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:10px;display:inline-block;font-weight:600">${esc(button)}</a></p>
<p style="margin:0 0 16px;font-size:13px;color:#56565b;direction:ltr;text-align:right;word-break:break-all">${esc(l.link)}</p>`
        : `<p style="margin:0 0 16px">${esc(l)}</p>`
    )
    .join('\n');
  const html = `<!doctype html>
<html lang="he" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${esc(subject)}</title></head>
<body style="margin:0;background:#eeeff2;font-family:-apple-system,'Segoe UI',Arial,sans-serif;color:#1d1d1f">
<div dir="rtl" style="max-width:520px;margin:0 auto;padding:32px 16px">
<div style="background:#ffffff;border-radius:16px;padding:28px 24px;font-size:16px;line-height:1.6;text-align:right">
${body}
<p style="margin:24px 0 0;color:#56565b">${esc(MAIL.signature)}</p>
</div></div></body></html>`;
  return { subject, text, html, link };
}

export const magicLinkMail = (to, link) => ({ to, ...build(MAIL.magicSubject, MAIL.magicLines(link), MAIL.magicButton) });

export const inviteMail = (to, workspaceName, link, expiresAt) => ({
  to,
  ...build(MAIL.inviteSubject(workspaceName), MAIL.inviteLines(workspaceName, link, when(expiresAt)), MAIL.inviteButton),
});
