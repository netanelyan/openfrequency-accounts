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
  subNext: (d, amount, plusVat) => `החיוב הבא: ${amount}${plusVat ? ' ועוד מע״מ' : ''}, ב-${d}`,
  subDue: (d) => `התשלום לחודש שהתחיל ב-${d} עוד לא הגיע אלינו. כשיגיע, נעדכן כאן.`,
  subEnding: (d, n) => `המנוי מסתיים ב-${d}. ${n === 1 ? 'זה היום האחרון שלו.' : `נשארו ${n} ימים.`}`,
  subEnded: (d) => `המנוי הסתיים ב-${d}.`,
  subOpen: 'התשלום הראשון יופיע כאן כשנרשום אותו.',
  subSetup: (amount) => `דמי הקמה: ${amount}, פעם אחת`,
  dashMore: 'עוד מאיתנו',
  dashMoreWhat: { teder: 'מצגות בעברית לטיקטוק ולאינסטגרם', toran: 'עונה ללקוחות שלכם בוואטסאפ' },
  dashMoreLink: 'לפרטים',
  dashTeam: 'מי בחשבון',
  dashTeamAdd: 'כדי להוסיף מישהו לחשבון, ענו לאחד המיילים שקיבלתם מאיתנו ונשלח לו הזמנה.',
  dashYou: '(אתם)',
  dashAccount: 'הפרטים שלכם',
  dashEmail: 'מייל',
  dashBusiness: 'עסק',
  dashHelp: 'שאלה על המנוי או על החיוב? ענו לאחד המיילים שקיבלתם מאיתנו.',
  dashSignOutAll: 'יציאה מכל המכשירים',

  // ---- WhatsApp: the owner line (docs/internal-owner-phone.md)
  waTitle: 'וואטסאפ',
  waLead: 'כשהמספר שלכם מחובר, אפשר לכתוב לתורן ולתדר בוואטסאפ ולשאול על החשבון, בלי להיכנס לאתר.',
  waNone: 'עוד לא חיברתם מספר.',
  waOf: (name) => `של ${name}`,
  waOn: 'עם עדכונים',
  waOff: 'בלי עדכונים',
  waTurnOn: 'הפעלת עדכונים',
  waTurnOff: 'כיבוי עדכונים',
  waRemove: 'הסרה',
  waConnect: 'לחבר את הוואטסאפ',
  waAgain: 'קוד חדש',
  waOptIn: 'לשלוח לי עדכונים מתדר ומתורן בוואטסאפ',
  waOptInHint: 'למשל כשיש פוסטים שמחכים לאישור, וסיכום פעם בשבוע. כדי להפסיק, כותבים שם "הפסק" או מכבים כאן.',
  waCodeTitle: 'הקוד שלכם',
  waCodeLead: (until) => `שולחים את הקוד בוואטסאפ למספר שלנו, מהטלפון שרוצים לחבר. הוא עובד פעם אחת, במשך 30 דקות (עד ${until}).`,
  waCodeUpdates: (on) => (on ? 'ביקשתם לקבל עדכונים בוואטסאפ.' : 'בלי עדכונים בוואטסאפ. אפשר להפעיל אותם אחר כך כאן.'),
  waSend: 'פתיחת וואטסאפ עם הקוד',
  waNoNumber: 'עוד לא הגדרנו כאן את המספר שלנו בוואטסאפ, אז כרגע אין לאן לשלוח את הקוד.',
  waReadOnly: 'בצפייה כלקוח אי אפשר לשנות כלום.',
  flashWaRemoved: (phone) => `הסרנו את ${phone}. כדי לחבר אותו שוב צריך קוד חדש.`,
  flashWaOn: (phone) => `העדכונים בוואטסאפ ל-${phone} פועלים.`,
  flashWaOff: (phone) => `כיבינו את העדכונים בוואטסאפ ל-${phone}. המספר עדיין מחובר.`,

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
  phone_link_created: 'קוד לחיבור וואטסאפ',
  phone_linked: 'וואטסאפ חובר',
  phone_removed: 'וואטסאפ הוסר',
  phone_opt_in: 'עדכונים בוואטסאפ הופעלו',
  phone_opt_out: 'עדכונים בוואטסאפ כובו',
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
const HOUR_HE = new Intl.DateTimeFormat('he-IL', { timeZone: 'Asia/Jerusalem', hour: '2-digit', minute: '2-digit' });
/** An Israel-time hour, like "13:00". */
export const hourHe = (iso) => HOUR_HE.format(new Date(iso));

/** A number as its owner writes it: "050-000-0123" for an Israeli mobile, "+44..." for any other. */
export const phoneHe = (digits) => {
  const m = /^972(5\d)(\d{3})(\d{4})$/.exec(String(digits));
  return m ? `0${m[1]}-${m[2]}-${m[3]}` : `+${digits}`;
};

/** Shekels, as the site writes them: "1,490 ₪". */
export const ils = (n) => `${Number(n).toLocaleString('he-IL')} ₪`;
