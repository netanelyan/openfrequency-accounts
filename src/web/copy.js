import { TEAM_LIMIT } from '../accounts/team.js';

// Every Hebrew word the site and its emails say, in one place.
//
// OpenFrequency speaks as "we" (אנחנו); the reader is addressed in the plural
// (אתם), which fits a website and does not guess anyone's gender. Plain words,
// no exclamation marks: this is about getting into an account, so the serious
// register (see the hebrew-voice skill).

export const PRODUCT_NAMES = { teder: 'תדר', toran: 'תורן' };
export const ROLE_NAMES = { client_owner: 'בעלים', client_member: 'צוות', superadmin: 'מנהל' };

const minutes = (seconds) => Math.max(1, Math.ceil(seconds / 60));

export const T = {
  brand: 'OpenFrequency',

  // ---- sign in with an emailed link
  loginTitle: 'כניסה',
  loginHeading: 'כניסה',
  loginLead: 'כתבו את כתובת המייל שלכם ונשלח אליה קישור כניסה. הקישור עובד פעם אחת, במשך 15 דקות.',
  emailLabel: 'כתובת מייל',
  loginButton: 'שלחו לי קישור',
  loginNoAccount: 'עוד אין לכם חשבון? אנחנו פותחים אותו ושולחים לכם הזמנה במייל.',
  badEmail: 'הכתובת הזאת לא נראית כמו כתובת מייל. בדקו אותה ונסו שוב.',
  tooMany: (seconds) => `ביקשתם הרבה קישורים בזמן קצר. נסו שוב בעוד ${minutes(seconds)} דקות.`,
  signedOut: 'יצאתם. כדי לחזור, בקשו קישור כניסה חדש.',
  signedOutAll: (n) => `יצאתם מכל המכשירים (${n}). כדי לחזור, בקשו קישור כניסה חדש.`,

  sentTitle: 'בדקו את המייל',
  sentLead: (email) => `אם הכתובת ${email} רשומה אצלנו, שלחנו אליה קישור כניסה. הוא עובד פעם אחת, במשך 15 דקות.`,
  sentSpam: 'לא הגיע תוך כמה דקות? בדקו בתיקיית הספאם, או בקשו קישור חדש.',
  sentAgain: 'לקישור חדש',

  linkTitle: 'כניסה',
  linkLead: (email) => `לחצו כדי להיכנס בתור ${email}.`,
  linkButton: 'כניסה',
  linkDeadTitle: 'הקישור הזה כבר לא עובד',
  linkDeadLead: 'קישור כניסה עובד פעם אחת, במשך 15 דקות. אפשר לבקש קישור חדש.',

  // ---- invites
  inviteTitle: (ws) => `הוזמנתם ל-${ws}`,
  inviteLead: (email) => `ההזמנה נשלחה אל ${email}. לחצו כדי להצטרף ולהיכנס.`,
  inviteNameLabel: 'השם שלכם (לא חובה)',
  inviteButton: 'הצטרפות',
  inviteDeadTitle: 'ההזמנה הזאת כבר לא בתוקף',
  inviteDeadLead: 'הזמנה עובדת פעם אחת, במשך 72 שעות. ענו למייל ההזמנה ונשלח לכם חדשה.',

  // ---- signed in
  homeHello: (name) => `שלום ${name}`,
  homeWho: (email, ws) => `אתם מחוברים בתור ${email}, בחשבון של ${ws}.`,
  homeOpen: (product) => `כניסה ל${product}`,
  homeNoProducts: 'עוד לא הפעלנו מוצר בחשבון הזה. נעדכן אתכם במייל כשזה יקרה.',
  homeSwitch: 'החלפת חשבון',
  homeSignOut: 'יציאה',
  homeClosed: (ws) => `החשבון של ${ws} סגור כרגע. אם זו טעות, ענו לאחד המיילים שקיבלתם מאיתנו.`,
  homeNoWorkspace: 'עוד לא חיברנו אתכם לאף עסק. ענו למייל ההזמנה ונבדוק מה קרה.',

  pickTitle: 'לאיזה חשבון נכנסים?',
  pickLead: 'אתם רשומים בכמה חשבונות. אפשר להחליף אחר כך מהדף הראשי.',

  // ---- the customer's dashboard
  dashProducts: 'המוצרים שלכם',
  subStatus: { active: 'פעיל', open: 'פעיל', due: 'מחכה לתשלום', ending: 'מסתיים', ended: 'הסתיים' },
  subPrice: (amount, vat) => `${amount} לחודש, ${vat}`,
  vatIncluded: 'כולל מע״מ',
  vatExcluded: 'לא כולל מע״מ',
  subSince: (d) => `מנוי מאז ${d}`,
  subPaidUntil: (d) => `שולם עד ${d}`,
  subLeft: (n) => (n === 1 ? 'זה היום האחרון בחודש ששולם' : `נשארו ${n} ימים בחודש ששולם`),
  subDay: (day, days) => `יום ${day} מתוך ${days}`,
  subBarLabel: (from, to) => `החודש ששולם, מ-${from} עד ${to}`,
  subNext: (d, amount, plusVat) => `החיוב הבא: ${amount}${plusVat ? ' ועוד מע״מ' : ''}, ב-${d}`,
  subDue: (d) => `התשלום לחודש שהתחיל ב-${d} עוד לא הגיע אלינו. כשיגיע, נעדכן כאן.`,
  subEnding: (d, n) => `המנוי מסתיים ב-${d}. ${n === 1 ? 'זה היום האחרון שלו.' : `נשארו ${n} ימים.`}`,
  subEnded: (d) => `המנוי הסתיים ב-${d}.`,
  subOpen: 'התשלום הראשון יופיע כאן כשנרשום אותו.',
  subSetup: (amount) => `דמי הקמה: ${amount}, פעם אחת`,
  dashInvoices: 'חשבוניות',
  invNone: 'עוד אין כאן חשבוניות. כל חשבונית שנוציא לכם תופיע כאן, עם המסמך עצמו להורדה.',
  invTitle: (product, number) => `${product}, חשבונית ${number}`,
  invPeriod: (from, to) => `על ${from} עד ${to}`,
  invVat: (amount, vat) => `${amount} ועוד מע״מ ${vat}`,
  invNoVat: 'בלי מע״מ',
  invOpen: 'לחשבונית',
  invOpenLabel: (number) => `חשבונית ${number}, קובץ PDF`,
  dashMore: 'עוד מאיתנו',
  dashMoreWhat: { teder: 'מצגות בעברית לטיקטוק ולאינסטגרם', toran: 'עונה ללקוחות שלכם בוואטסאפ' },
  dashMoreLink: 'לפרטים',
  dashTeam: 'מי בחשבון',
  dashYou: '(אתם)',
  teamCount: (n, max) => (n > max ? `${n} אנשים` : `${n} מתוך ${max}`),
  teamWaiting: (until) => `הזמנה נשלחה, מחכה עד ${until}`,
  teamEmail: 'המייל של מי שמצטרף',
  teamRole: 'תפקיד',
  teamInvite: 'שליחת הזמנה',
  teamRoom: (left, max) => `${left === 1 ? 'נשאר מקום לעוד אדם אחד' : `נשאר מקום לעוד ${left} אנשים`}. בחשבון יש מקום ל-${max} אנשים, כולל אתכם וכולל הזמנות שעוד לא התקבלו. ההזמנה עובדת 72 שעות.`,
  teamFull: (max) => `בחשבון יש כבר ${max} אנשים, כולל הזמנות שעוד לא התקבלו. כדי להוסיף עוד, דברו איתנו.`,
  teamFullReply: (max) => `בחשבון יש כבר ${max} אנשים, כולל הזמנות שעוד לא התקבלו. כדי להוסיף עוד, ענו לאחד המיילים שקיבלתם מאיתנו.`,
  teamOwnersOnly: 'רק בעלי החשבון מוסיפים ומסירים אנשים.',
  teamRemove: 'הסרה',
  teamCancel: 'ביטול',
  teamRemoveLabel: (who) => `הסרה של ${who} מהחשבון`,
  teamCancelLabel: (email) => `ביטול ההזמנה ל-${email}`,
  teamReadOnly: 'את האנשים בחשבון של לקוח משנים מהקונסולה. מכאן אי אפשר לשנות כלום.',
  supportWrite: 'כתבו לנו',
  flashTeamInvited: (email) => `שלחנו הזמנה ל-${email}. היא עובדת 72 שעות.`,
  flashTeamRemoved: (who) => `${who} כבר לא בחשבון.`,
  dashAccount: 'הפרטים שלכם',
  dashEmail: 'מייל',
  dashBusiness: 'עסק',
  dashHelp: 'שאלה על המנוי או על החיוב? ענו לאחד המיילים שקיבלתם מאיתנו.',
  dashHelpAsk: 'שאלה על המנוי או על החיוב?',
  dashSignOutAll: 'יציאה מכל המכשירים',

  logoutTitle: 'יציאה',
  logoutLead: (email) => `אפשר לצאת רק מהדפדפן הזה, או מכל מקום שבו נכנסתם עם ${email}. היציאה חלה על כל המוצרים של OpenFrequency.`,
  logoutHere: 'יציאה מהדפדפן הזה',
  logoutAll: 'יציאה מכל המכשירים',
  logoutBack: 'חזרה לדף הראשי',

  // ---- errors
  staleForm: 'הדף הזה ישן מדי. רעננו אותו ונסו שוב.',
  crossSite: 'חסמנו את הבקשה כי היא הגיעה מאתר אחר.',
  notFound: 'הדף הזה לא קיים.',
  notFoundBack: 'לדף הכניסה',
  serverError: 'משהו אצלנו נשבר. נסו שוב בעוד רגע.',
  httpsOnly: 'האתר הזה עובד רק ב-HTTPS.',

  // ---- superadmin sign-in
  adminLoginTitle: 'כניסת מנהל',
  adminEmail: 'מייל',
  adminPassword: 'סיסמה',
  adminCode: 'קוד מאפליקציית האימות',
  adminCodeHint: 'אין לכם את הטלפון? אפשר להזין במקום אחד מקודי הגיבוי.',
  adminLoginButton: 'כניסה',
  adminLoginFailed: 'אחד הפרטים לא נכון. נסו שוב.',
  adminTooMany: (seconds) => `יותר מדי ניסיונות. נסו שוב בעוד ${minutes(seconds)} דקות.`,
  adminRecoveryUsed: (left) => `נכנסתם עם קוד גיבוי. נשארו ${left} קודים. כדי ליצור חדשים, הריצו npm run admin:create.`,

  // ---- superadmin console
  adminTitle: 'חשבונות',
  adminSignOut: 'יציאה',
  newWorkspace: 'פתיחת חשבון',
  wsName: 'שם העסק',
  wsSlug: 'מזהה באנגלית',
  wsSlugHint: 'אותיות קטנות באנגלית, ספרות ומקפים. לדוגמה:',
  wsOwner: 'מייל של בעל החשבון',
  wsProducts: 'מוצרים',
  wsCreate: 'פתיחה ושליחת הזמנה',
  colWorkspace: 'עסק',
  colProducts: 'מוצרים',
  colMembers: 'אנשים',
  colStatus: 'מצב',
  statusActive: 'פעיל',
  statusDisabled: 'מושבת',
  noWorkspaces: 'עוד אין חשבונות. אפשר לפתוח את הראשון למעלה.',
  workspacesTitle: 'כל החשבונות',
  workspacesCount: (n) => (n === 1 ? 'חשבון אחד' : `${n} חשבונות`),
  productOn: 'פועל',
  productOff: 'כבוי',
  inviteEmailPlaceholder: 'כתובת מייל להזמנה',
  noMembers: 'עוד אף אחד לא הצטרף.',
  pendingInvite: (email, until) => `הזמנה ל-${email} מחכה, עד ${until}`,
  revokeInvite: 'ביטול',
  inviteMore: 'הזמנה',
  inviteRole: 'תפקיד',
  turnOn: (p) => `הפעלת ${p}`,
  turnOff: (p) => `כיבוי ${p}`,
  disableWs: 'השבתת החשבון',
  enableWs: 'הפעלה מחדש',
  viewAs: 'צפייה כלקוח',
  viewIn: 'ב',
  auditTitle: 'מה קרה לאחרונה',
  lastLogin: (when) => `כניסה אחרונה: ${when}`,
  neverLoggedIn: 'אין כניסות עדיין',

  viewAsBanner: (ws) => `אתם צופים ב-${ws} כמו שהלקוח רואה אותו. זו צפייה בלבד, ושום שינוי לא נשמר.`,
  viewAsStop: 'סיום צפייה',

  flashCreated: (name, email) => `פתחנו את ${name} ושלחנו הזמנה ל-${email}.`,
  flashInvited: (email) => `שלחנו הזמנה ל-${email}.`,
  flashInviteRevoked: (email) => `ביטלנו את ההזמנה ל-${email}.`,
  flashProductOn: (p, name) => `${p} פועל עכשיו ב-${name}.`,
  flashProductOff: (p, name) => `${p} כבוי עכשיו ב-${name}. מי שבתוכו יוצא ממנו בבקשה הבאה.`,
  flashDisabled: (name) => `${name} מושבת. מי שבתוכו יוצא בבקשה הבאה.`,
  flashEnabled: (name) => `${name} פעיל שוב.`,
  flashViewStopped: 'סיימתם לצפות.',
  subTitle: 'מנוי',
  subMonthly: 'לחודש, ב-₪',
  subSetupLabel: 'הקמה, ב-₪',
  subVat: 'מע״מ',
  subStarted: 'התחלה',
  subPaid: 'שולם עד',
  subEnds: 'יום אחרון',
  subSave: 'שמירה',
  subPayMonth: 'התקבל תשלום לחודש',
  subNone: 'אין מנוי',
  flashSubSaved: (p, name) => `המנוי של ${name} ל${p} נשמר.`,
  flashSubPaid: (p, name, d) => `${name}: ${p} שולם עד ${d}.`,
  invAdd: 'הוספת חשבונית',
  invHint: 'החשבונית יוצאת משירות החשבוניות, עם המספר והתאריך שלו. כאן שומרים עותק שלה, כדי שהלקוח ימצא אותה בדף שלו.',
  invNumber: 'מספר',
  invIssuedOn: 'תאריך',
  invFrom: 'על התקופה מ-',
  invTo: 'עד',
  invAmount: 'לפני מע״מ, ב-₪',
  invVatAmount: 'מע״מ, ב-₪',
  invPdf: 'החשבונית, PDF',
  invSave: 'שמירה',
  invRemove: 'הסרה',
  invAdminLine: (number, d, total) => `חשבונית ${number}, ${d}, ${total}`,
  flashInvoiceAdded: (number, name) => `חשבונית ${number} נוספה ל-${name}.`,
  flashInvoiceRemoved: (number) => `חשבונית ${number} הוסרה מהחשבון. בשירות החשבוניות היא נשארת כמו שהיא.`,

  // What the home page's team form refuses. The rest are in errors, below.
  teamErrors: {
    team_full: `בחשבון יש כבר ${TEAM_LIMIT} אנשים, כולל הזמנות שעוד לא התקבלו. כדי להוסיף עוד, דברו איתנו.`,
    already_member: 'הכתובת הזאת כבר בחשבון.',
    not_owner: 'רק בעלי החשבון מוסיפים ומסירים אנשים.',
    not_self: 'אי אפשר להסיר את עצמכם מהחשבון.',
    last_owner: 'בחשבון צריך להישאר לפחות בעלים אחד.',
    superadmin_email: 'אי אפשר להזמין את הכתובת הזאת.',
  },

  errors: {
    bad_name: 'צריך שם לעסק, עד 80 תווים.',
    bad_slug: 'המזהה יכול להכיל רק אותיות קטנות באנגלית, ספרות ומקפים, עד 40 תווים.',
    slug_taken: 'המזהה הזה כבר תפוס. בחרו אחר.',
    bad_email: 'המייל הזה לא נראה תקין.',
    bad_role: 'צריך לבחור תפקיד.',
    superadmin_email: 'זה המייל של המנהל. אי אפשר להזמין אותו כלקוח.',
    workspace_disabled: 'החשבון הזה מושבת. הפעילו אותו מחדש לפני שמזמינים אליו.',
    no_workspace: 'החשבון הזה לא קיים.',
    bad_product: 'המוצר הזה לא קיים.',
    bad_price: 'המחיר צריך להיות מספר.',
    bad_date: 'אחד התאריכים לא תקין.',
    bad_dates: 'היום האחרון לפני יום ההתחלה.',
    bad_number: 'צריך את מספר החשבונית, כמו שהוא מופיע עליה, עד 40 תווים.',
    bad_period: 'לתקופה צריך גם יום ראשון וגם יום אחרון, והאחרון לא לפני הראשון.',
    bad_amount: 'צריך סכום לפני מע״מ ואת המע״מ, במספרים. אם אין מע״מ, כתבו 0.',
    bad_pdf: 'צריך לצרף את החשבונית כקובץ PDF.',
    pdf_too_large: 'הקובץ גדול מ-5MB. חשבונית רגילה קטנה בהרבה, אז כדאי לבדוק שזה הקובץ הנכון.',
  },
};

// What each audit entry means, for the console. The log itself keeps the codes.
export const AUDIT_NAMES = {
  sign_in: 'כניסה',
  sign_out: 'יציאה',
  sign_out_all: 'יציאה מכל המכשירים',
  magic_link_requested: 'בקשה לקישור כניסה',
  admin_login_failed: 'כניסת מנהל שנכשלה',
  invite_sent: 'הזמנה נשלחה',
  invite_accepted: 'הזמנה התקבלה',
  invite_revoked: 'הזמנה בוטלה',
  workspace_created: 'חשבון נפתח',
  workspace_disabled: 'חשבון הושבת',
  workspace_enabled: 'חשבון הופעל מחדש',
  product_enabled: 'מוצר הופעל',
  product_disabled: 'מוצר כובה',
  view_as_start: 'תחילת צפייה כלקוח',
  view_as_stop: 'סיום צפייה כלקוח',
  superadmin_created: 'המנהל נוצר',
  superadmin_reset: 'המנהל הוגדר מחדש',
  subscription_saved: 'מנוי עודכן',
  subscription_paid: 'תשלום נרשם',
  member_removed: 'הוסר מהחשבון',
  invoice_added: 'חשבונית נוספה',
  invoice_removed: 'חשבונית הוסרה',
};

// ---- emails

export const MAIL = {
  magicSubject: 'קישור הכניסה שלכם ל-OpenFrequency',
  magicLines: (link) => [
    'שלום,',
    'ביקשתם להיכנס ל-OpenFrequency. זה הקישור:',
    { link },
    'הוא עובד פעם אחת, במשך 15 דקות.',
    'לא ביקשתם? אפשר להתעלם מהמייל הזה. בלי הקישור אף אחד לא נכנס לחשבון שלכם.',
  ],
  magicButton: 'כניסה',

  inviteSubject: (ws) => `הזמנה ל-${ws} ב-OpenFrequency`,
  inviteLines: (ws, link, until) => [
    'שלום,',
    `פתחנו לכם חשבון ב-OpenFrequency עבור ${ws}. כדי להיכנס בפעם הראשונה, לחצו על הקישור:`,
    { link },
    `ההזמנה עובדת פעם אחת, עד ${until}.`,
    'אין סיסמה לזכור. בכל כניסה נשלח לכם קישור חדש לכתובת הזאת.',
    'אם עבר הזמן, ענו למייל הזה ונשלח הזמנה חדשה.',
  ],
  inviteButton: 'הצטרפות',
  signature: 'OpenFrequency',
};

const DATE = new Intl.DateTimeFormat('he-IL', { timeZone: 'Asia/Jerusalem', day: 'numeric', month: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
/** An Israel-time date and hour, like "25.10.2026, 13:00". */
export const when = (iso) => DATE.format(new Date(iso)).replace(/\s*,\s*/, ', ');

/** A calendar day, YYYY-MM-DD, as Israel writes it: "25.10.2026". */
export const dayHe = (d) => (d ? `${+d.slice(8, 10)}.${+d.slice(5, 7)}.${d.slice(0, 4)}` : '');
/** Shekels, as the site writes them: "1,490 ₪", or "1,762.82 ₪" when there are agorot. */
export const ils = (n) => `${Number(n).toLocaleString('he-IL', Number.isInteger(Number(n)) ? {} : { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₪`;
