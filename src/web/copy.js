import { TEAM_LIMIT } from '../accounts/team.js';

// Every Hebrew word the site and its emails say, in one place.
//
// OpenFrequency speaks as "we" (אנחנו); the reader is addressed in the plural
// (אתם), which fits a website and does not guess anyone's gender. Plain words,
// no exclamation marks: this is about getting into an account, so the serious
// register (see the hebrew-voice skill).

export const PRODUCT_NAMES = { teder: 'תדר', toran: 'תורן' };
export const ROLE_NAMES = { client_owner: 'בעלים', client_member: 'צוות', superadmin: 'מנהל' };
/** Teder's plans (src/accounts/subscriptions.js PLANS), as the site and the emails name them. */
export const PLAN_NAMES = { full: 'החבילה המלאה', small: 'החבילה הקטנה' };
/** What a plan gives in a month, after its name. */
export const planGives = (slideshows, redos) => `${slideshows} מצגות בחודש, ו-${redos} החלפות למצגות שדחיתם`;
/**
 * When a product opens, by the payment mode (OF_PAYMENT, src/accounts/billing.js): manual, once the payment reaches us;
 * provider, once it is confirmed (the operator still records it on /admin, so never "at once"). `names` are the
 * products' names, joined ("תדר", "תדר ותורן", "המוצרים"); `many` when there is more than one.
 */
export const opensAfter = (mode, names, many) => `${names} ${many ? 'נפתחים' : 'נפתח'} ${mode === 'provider' ? 'אחרי שהתשלום מאושר' : 'אחרי שהתשלום מגיע אלינו'}.`;

const minutes = (seconds) => Math.max(1, Math.ceil(seconds / 60));

export const T = {
  brand: 'OpenFrequency',
  accessibility: 'הצהרת נגישות',

  // ---- sign in with an emailed link
  loginTitle: 'כניסה',
  loginHeading: 'כניסה',
  loginLead: 'כתבו את כתובת המייל שלכם ונשלח אליה קישור כניסה. הקישור עובד פעם אחת, במשך 15 דקות.',
  emailLabel: 'כתובת מייל',
  loginButton: 'שלחו לי קישור',
  loginNoAccount: 'עוד אין לכם חשבון? אנחנו פותחים אותו ושולחים לכם הזמנה במייל.',
  loginNoAccountOpen: 'עוד אין לכם חשבון?',
  loginSignup: 'להרשמה',
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

  // ---- sign in with Google
  googleButton: 'כניסה עם Google',
  googleJoinButton: 'הצטרפות עם Google',
  googleOrEmail: 'או בקישור למייל',
  googleOrInvite: 'או בלי Google',
  googleInviteHint: (email) => `צריך לבחור ב-Google את החשבון של ${email}, הכתובת שאליה נשלחה ההזמנה.`,
  googleTitle: 'כניסה עם Google',
  googleAgain: 'לנסות שוב',
  googleCancelled: 'הכניסה עם Google בוטלה. אפשר לנסות שוב, או לקבל קישור כניסה למייל.',
  googleStale: 'הכניסה עם Google לא הושלמה',
  googleStaleLead: 'עברו יותר מ-10 דקות מאז שהתחלתם, או שהיא התחילה בדפדפן אחר. נסו שוב מכאן.',
  googleNoAccount: (email) => `לא מצאנו אצלנו חשבון פתוח עם ${email}`,
  googleNoAccountLead: 'אנחנו פותחים כל חשבון בעצמנו ושולחים הזמנה במייל. קיבלתם הזמנה? הצטרפו מהקישור שבה. יש לכם אצלנו חשבון עם כתובת אחרת? בחרו אותה ב-Google, או בקשו קישור כניסה למייל.',
  googleNoAccountLeadOpen: 'אפשר להירשם ולפתוח חשבון חדש, או לבחור ב-Google את החשבון עם הכתובת שרשומה אצלנו. קיבלתם הזמנה? הצטרפו מהקישור שבה.',
  googleWrongInvite: (invited) => `ההזמנה נשלחה אל ${invited}`,
  googleWrongInviteLead: (invited, got) => `נכנסתם ל-Google בתור ${got}. כדי להצטרף, בחרו ב-Google את החשבון של ${invited}, או הצטרפו בלי Google מהדף של ההזמנה.`,
  googleErrors: {
    unreachable: ['Google לא ענה לנו', 'נסו שוב בעוד דקה, או בקשו קישור כניסה למייל.'],
    refused: ['Google לא אישר את הכניסה', 'נסו שוב, או בקשו קישור כניסה למייל.'],
    bad_token: ['Google לא אישר את הכניסה', 'נסו שוב, או בקשו קישור כניסה למייל.'],
    unverified: ['Google עוד לא אימת את כתובת המייל בחשבון הזה', 'אפשר לבקש קישור כניסה למייל במקום.'],
  },

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
  subStatus: { active: 'פעיל', open: 'עוד לא שולם', due: 'מחכה לתשלום', ending: 'מסתיים', ended: 'הסתיים', comp: 'ללא תשלום', cancelled: 'בוטל' },
  subPrice: (amount, vat) => `${amount} לחודש, ${vat}`,
  vatIncluded: 'כולל מע״מ',
  vatExcluded: 'לא כולל מע״מ',
  subSince: (d) => `מנוי מאז ${d}`,
  subPaidUntil: (d) => `שולם עד ${d}`,
  subLeft: (n) => (n === 1 ? 'זה היום האחרון בחודש ששולם' : `נשארו ${n} ימים בחודש ששולם`),
  subDay: (day, days) => `יום ${day} מתוך ${days}`,
  subBarLabel: (from, to) => `החודש ששולם, מ-${from} עד ${to}`,
  subNext: (d, amount, plusVat) => `התשלום הבא: ${amount}${plusVat ? ' ועוד מע״מ' : ''}, ב-${d}`,
  subDue: (d, until) => `התשלום לחודש שהתחיל ב-${d} עוד לא הגיע אלינו. המנוי ממשיך לעבוד עד ${until}, ואם התשלום לא יגיע עד אז הוא ייעצר עד שישולם.`,
  subDueStopped: (d) => `התשלום לחודש שהתחיל ב-${d} לא הגיע, אז המנוי נעצר. הוא ייפתח שוב כשהתשלום יגיע.`,
  subPlan: (name, gives) => `${name}: ${gives}`,
  subEnding: (d, n) => `המנוי מסתיים ב-${d}. ${n === 1 ? 'זה היום האחרון שלו.' : `נשארו ${n} ימים.`}`,
  subEnded: (d) => `המנוי הסתיים ב-${d}.`,
  subOpen: (product) => `${product} נפתח אחרי התשלום על המנוי.`,
  subSetup: (amount) => `דמי הקמה: ${amount}, פעם אחת`,
  subComp: 'המנוי הזה אצלנו ללא תשלום.',
  subCancelled: (d) => `ביטלתם את המנוי. הוא עובד עד ${d} ואז נעצר, ולא נחייב אתכם יותר.`,
  subCancelledNow: 'ביטלתם את המנוי, ולא נחייב אתכם עליו.',
  subPay: 'להסדיר תשלום',
  subCancel: 'לבטל את המנוי',
  subCancelLabel: (product) => `לבטל את המנוי ל${product}`,
  subResume: 'להמשיך את המנוי',
  subResumeLabel: (product) => `להמשיך את המנוי ל${product}`,
  dashInvoices: 'חשבוניות',
  invNone: 'עוד אין כאן חשבוניות. כל חשבונית שנוציא לכם תופיע כאן, עם המסמך עצמו להורדה.',
  invTitle: (product, number) => `${product}, חשבונית ${number}`,
  invPeriod: (from, to) => `על ${from} עד ${to}`,
  invVat: (amount, vat) => `${amount} ועוד מע״מ ${vat}`,
  invNoVat: 'בלי מע״מ',
  invOpen: 'לחשבונית',
  invOpenLabel: (number) => `חשבונית ${number}, קובץ PDF`,
  dashMore: 'עוד מאיתנו',
  dashMoreWhat: { teder: 'מצגות בעברית לטיקטוק, לאינסטגרם ולפייסבוק', toran: 'עונה ללקוחות שלכם בוואטסאפ' },
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
  supportWrite: 'כתבו לנו בוואטסאפ',
  supportTeamText: (name, max) => `היי, כותבים מ״${name}״. רוצים להוסיף לחשבון יותר מ-${max} אנשים.`,
  flashTeamInvited: (email) => `שלחנו הזמנה ל-${email}. היא עובדת 72 שעות.`,
  flashTeamRemoved: (who) => `${who} כבר לא בחשבון.`,
  dashAccount: 'הפרטים שלכם',
  dashEmail: 'מייל',
  dashBusiness: 'עסק',
  dashHelp: 'שאלה על המנוי או על החיוב? ענו לאחד המיילים שקיבלתם מאיתנו.',
  dashHelpAsk: 'שאלה על המנוי או על החיוב?',
  dashSignOutAll: 'יציאה מכל המכשירים',
  dashNotifications: 'התראות במייל',
  dashDelete: 'מחיקת החשבון',

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
  accessNames: { paid: 'שולם', comp: 'ללא תשלום', due: 'מחכה לתשלום, בתקופת החסד', unpaid: 'לא שולם', cancelled: 'בוטל', off: 'כבוי' },
  subPlanLabel: 'חבילה',
  accessLine: (name, open, until) => `גישה: ${name}, ${open ? 'פתוח' : 'סגור'}${until ? `, עד ${until}` : ''}`,
  compOn: 'לסמן ללא תשלום',
  compOff: 'לבטל את הפטור מתשלום',
  flashCompOn: (p, name) => `${p} ב-${name} מסומן ללא תשלום.`,
  flashCompOff: (p, name) => `${p} ב-${name} כבר לא ללא תשלום. מעכשיו הוא פתוח רק כשיש תשלום.`,
  wsDelete: 'מחיקת החשבון',
  wsDeleteHint: 'מוחקים את החשבון ואת הנתונים שלו, גם בתדר ובתורן. החשבוניות נשמרות. אי אפשר לבטל את זה.',
  wsDeleteLabel: 'שם העסק, לאישור',
  wsDeleteButton: 'למחוק לצמיתות',
  flashDeleted: (name) => `${name} נמחק, עם הנתונים שלו בתדר ובתורן. החשבוניות נשמרו.`,
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
    product_off: 'המוצר הזה לא פעיל בחשבון.',
    name_mismatch: 'השם לא תואם את שם העסק, אז לא מחקנו כלום.',
    bad_plan: 'החבילה הזאת לא קיימת.',
    already_paid: 'התשלום הזה כבר נרשם (הכפתור נלחץ פעמיים, או שהדף היה פתוח מקודם). בדקו את התאריך ב"שולם עד" לפני שרושמים עוד חודש.',
  },
};

// What each audit entry means, for the console. The log itself keeps the codes.
export const AUDIT_NAMES = {
  sign_in: 'כניסה',
  sign_out: 'יציאה',
  sign_out_all: 'יציאה מכל המכשירים',
  magic_link_requested: 'בקשה לקישור כניסה',
  google_refused: 'כניסה עם Google בלי חשבון פתוח',
  google_failed: 'כניסה עם Google נכשלה',
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
  phone_link_created: 'קוד לחיבור וואטסאפ',
  phone_linked: 'וואטסאפ חובר',
  phone_removed: 'וואטסאפ הוסר',
  phone_opt_in: 'עדכונים בוואטסאפ הופעלו',
  phone_opt_out: 'עדכונים בוואטסאפ כובו',
  ops_action: 'פעולה מהלוח של היום',
  signup_requested: 'בקשה להרשמה מהאתר',
  signup_refused: 'הרשמה לכתובת שכבר יש לה חשבון',
  signed_up: 'נרשמו מהאתר',
  comp_set: 'סומן ללא תשלום',
  comp_cleared: 'הפטור מתשלום בוטל',
  subscription_cancelled: 'מנוי בוטל מהאתר',
  subscription_resumed: 'מנוי שבוטל ממשיך',
  workspace_deleted: 'חשבון נמחק',
  workspace_delete_failed: 'מחיקה שלא הושלמה',
  notify_sent: 'התראה נשלחה במייל',
  notify_prefs_saved: 'הגדרות התראות נשמרו',
  billing_soon7: 'תזכורת תשלום, שבוע לפני',
  billing_soon1: 'תזכורת תשלום, יום לפני',
  billing_due: 'תשלום לא הגיע, תקופת החסד התחילה',
  billing_stopped: 'נעצר אחרי תקופת החסד',
  idle_warned: 'נשלחה הודעה על מחיקה של חשבון בלי שימוש',
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

  signupSubject: 'אישור החשבון שלכם ב-OpenFrequency',
  signupLines: (link) => [
    'שלום,',
    'ביקשתם לפתוח חשבון ב-OpenFrequency. כדי לאשר, לחצו על הקישור:',
    { link },
    'הוא עובד פעם אחת, במשך 15 דקות.',
    'לא ביקשתם? אפשר להתעלם מהמייל הזה. בלי הקישור לא נפתח שום חשבון.',
  ],
  signupButton: 'לאישור החשבון',

  // To the owner (OF_SIGNUP_NOTIFY), on each confirmed sign-up.
  noticeSubject: (business) => `הרשמה חדשה: ${business}`,
  noticeLines: (name, email, business, products, at, method, link, prices = [], pay = '') => [
    'נפתח חשבון חדש מההרשמה באתר.',
    `שם: ${name}`,
    `מייל: ${email}`,
    `עסק: ${business}`,
    `מוצרים: ${products}`,
    ...[].concat(prices),
    `מתי: ${at}`,
    `אישור: ${method === 'google' ? 'Google' : 'קישור במייל'}`,
    ...(pay ? [pay] : []),
    { link },
  ],
  /** A product's plan and price, as its subscription has them: "תדר, החבילה הקטנה: 490 ₪ לחודש + 990 ₪ דמי הקמה, לא כולל מע״מ". */
  noticePrice: (product, monthly, setup, vat) => `${product}: ${monthly} לחודש${setup ? ` + ${setup} דמי הקמה` : ''}, ${vat}`,
  /** What the owner does next, by the payment mode: in manual, email the customer the payment details; either way, record the payment. */
  // `sent`: the payment details went out in the customer's welcome email (OF_PAYMENT_METHOD), so there is nothing to send.
  noticePay: (mode, email, names, many, sent = false) =>
    `${mode === 'provider' ? 'הלקוח משלם בכרטיס אשראי בדף התשלום. כשהתשלום עובר' : sent ? `פרטי התשלום כבר אצל ${email}, במייל הפתיחה. כשהתשלום מגיע` : `צריך לשלוח ל-${email} במייל את פרטי התשלום. כשהתשלום מגיע`}, רושמים אותו בקונסולה ("התקבל תשלום לחודש"), ורק אז ${names} ${many ? 'נפתחים' : 'נפתח'} ללקוח.`,
  noticeButton: 'לחשבון בקונסולה',

  existingSubject: 'כבר יש לכם חשבון ב-OpenFrequency',
  existingLines: (link) => [
    'שלום,',
    'ביקשו לפתוח חשבון חדש עם הכתובת הזאת, אבל כבר יש לכם חשבון אצלנו, אז לא פתחנו עוד אחד. כדי להיכנס לחשבון הקיים, לחצו על הקישור:',
    { link },
    'הוא עובד פעם אחת, במשך 15 דקות.',
    'לא ביקשתם? אפשר להתעלם מהמייל הזה. בלי הקישור אף אחד לא נכנס לחשבון שלכם.',
  ],
  // Right after a sign-up is confirmed. `mode` is how payment works (OF_PAYMENT), `opens` when the products open
  // (opensAfter()), and `prices` the price lines, then (manual) how to pay and whom to ask.
  welcomeSubject: (business) => `החשבון של ${business} נפתח`,
  // `details`: the owner's payment details are in the email (OF_PAYMENT_METHOD), below the price, so it points to them
  // instead of promising to send them.
  welcomeLines: (business, link, mode, opens, prices, details = false) => [
    'שלום,',
    `החשבון של ${business} ב-OpenFrequency פתוח. נשארו שני דברים.`,
    mode === 'provider'
      ? `קודם התשלום על המנוי. משלמים בכרטיס אשראי בדף ההגדרה, בכפתור "לתשלום". ${opens}`
      : details
        ? `קודם התשלום על המנוי, לפי פרטי התשלום שכאן למטה. ${opens}`
        : `קודם התשלום על המנוי. את פרטי התשלום נשלח לכם במייל, לכתובת הזאת. ${opens}`,
    ...[].concat(prices),
    'אחר כך ההגדרה. בדף ההגדרה יש רשימה של מה שנשאר, וכל צעד מוביל למקום שבו עושים אותו.',
    { link },
    'אין סיסמה לזכור. נכנסים עם קישור שנשלח למייל, או עם Google.',
  ],
  welcomeButton: 'לדף ההגדרה',
  // `noRefund`: Teder's setup fee, which its terms say is not refunded (Toran's terms say it otherwise).
  welcomePrice: (product, monthly, setup, noRefund = false) => `${product}: ${monthly} לחודש ועוד מע״מ, ודמי הקמה של ${setup} פעם אחת.${noRefund ? ' דמי ההקמה לא מוחזרים.' : ''}`,
  welcomePayHow: (how) => `איך משלמים: ${how}`,
  /** Whom to ask about paying, in an email: a reply, or our WhatsApp (OF_SUPPORT_WA, international digits) when it is set. */
  payAsk: (wa) => (wa ? `יש שאלה על התשלום? ענו למייל הזה, או כתבו לנו בוואטסאפ ל-${phoneHe(wa)}.` : 'יש שאלה על התשלום? ענו למייל הזה.'),

  // To each owner, when a payment is recorded (/admin).
  paidSubject: (product) => `קיבלנו את התשלום על ${product}`,
  paidLines: (business, product, until, link) => [
    'שלום,',
    `קיבלנו את התשלום על ${product} בחשבון של ${business}. המנוי שולם עד ${until}.`,
    'כשהחשבונית מוכנה, היא תופיע בדף הראשי של החשבון, ואפשר יהיה להוריד אותה משם.',
    { link },
  ],
  paidButton: 'לדף הראשי',

  // To each owner, before and when a payment falls due (src/web/daily.js). `pay` is how to pay (a line, or lines).
  soonSubject: (product, d) => `התשלום הבא על ${product}: ${d}`,
  soonLines: (business, product, d, amount, pay, link) => [
    'שלום,',
    `החודש הבא של ${product} בחשבון של ${business} מתחיל ב-${d}. הסכום: ${amount}.`,
    ...[].concat(pay),
    { link },
    'כבר שילמתם? אפשר להתעלם מהמייל הזה. ביטלתם, או רוצים לבטל? אפשר לעשות את זה מהדף הראשי.',
  ],
  dueSubject: (product) => `התשלום על ${product} עוד לא הגיע`,
  dueLines: (business, product, d, until, amount, pay, link) => [
    'שלום,',
    `החודש של ${product} בחשבון של ${business} התחיל ב-${d}, והתשלום עליו (${amount}) עוד לא הגיע אלינו.`,
    `${product} ממשיך לעבוד עד ${until}. אם התשלום לא יגיע עד אז, ${product} ייעצר עד שישולם. שום דבר לא נמחק.`,
    ...[].concat(pay),
    { link },
  ],
  stoppedSubject: (product) => `${product} נעצר עד שהתשלום יגיע`,
  stoppedLines: (business, product, link) => [
    'שלום,',
    `התשלום על ${product} בחשבון של ${business} לא הגיע עד סוף תקופת החסד, אז ${product} נעצר. הנתונים נשמרים, ו${product} ייפתח שוב כשהתשלום יגיע.`,
    { link },
  ],
  payButton: 'לחשבון',
  amount: (sum, plusVat) => (plusVat ? `${sum} ועוד מע״מ` : sum),
  // With a provider, the email's button is its payment page (OF_PAYMENT_URL), "לתשלום"; in manual mode, the account.
  payByProvider: 'משלמים בכרטיס אשראי, בדף התשלום:',
  payOnlineButton: 'לתשלום',
  payByUs: 'משלמים לפי פרטי התשלום ששלחנו לכם במייל.',

  // To the owner (OF_SIGNUP_NOTIFY): a payment fell due, or a grace ended.
  dueNoticeSubject: (business, product) => `תשלום לא הגיע: ${business}, ${product}`,
  dueNoticeLines: (business, product, d, until, link) => [
    `התשלום של ${business} על ${product} היה צריך להגיע ב-${d}. שלחנו לבעלים מייל, והמנוי ממשיך לעבוד עד ${until}.`,
    'כשהתשלום מגיע, רושמים אותו בקונסולה ("התקבל תשלום לחודש").',
    { link },
  ],
  stoppedNoticeSubject: (business, product) => `נעצר על תשלום: ${business}, ${product}`,
  stoppedNoticeLines: (business, product, link) => [`תקופת החסד של ${business} ב${product} נגמרה בלי תשלום, אז ${product} נעצר אצלם. שלחנו להם מייל.`, { link }],

  // To each owner of a workspace nobody used and nothing was ever paid for, 14 days before it is deleted.
  idleSubject: (business) => `החשבון של ${business} יימחק ב-14 הימים הקרובים`,
  idleLines: (business, d, link) => [
    'שלום,',
    `החשבון של ${business} ב-OpenFrequency נפתח, אבל אף אחד לא נכנס אליו כבר חצי שנה, ולא שולם בו מנוי. לפי מדיניות הפרטיות שלנו, ב-${d} נמחק אותו ואת המידע שבו.`,
    'רוצים לשמור אותו? מספיק להיכנס לחשבון לפני התאריך הזה:',
    { link },
  ],
  idleButton: 'כניסה לחשבון',
  idleNoticeSubject: (n) => (n === 1 ? 'חשבון אחד נמחק כי לא היה בו שימוש' : `${n} חשבונות נמחקו כי לא היה בהם שימוש`),
  idleNoticeLines: (names) => ['החשבונות האלה נמחקו היום, אחרי חצי שנה בלי כניסה ובלי תשלום, ו-14 יום אחרי שהבעלים קיבלו מייל:', ...names],

  // To each owner, when a subscription is cancelled online.
  cancelSubject: (product) => `ביטלתם את המנוי ל${product}`,
  cancelLines: (business, product, until, link) => [
    'שלום,',
    until
      ? `ביטלתם את המנוי ל${product} בחשבון של ${business}. ${product} ימשיך לעבוד עד ${until}, ואז ייעצר. לא נחייב אתכם יותר.`
      : `ביטלתם את המנוי ל${product} בחשבון של ${business}. לא נחייב אתכם עליו.`,
    until ? `התחרטתם? עד ${until} אפשר להמשיך את המנוי מהדף הראשי:` : 'הנתונים נשארים בחשבון. כדי למחוק אותם, יש בדף הראשי מחיקה של החשבון:',
    { link },
    'לא אתם ביטלתם? ענו למייל הזה ונבדוק.',
  ],
  cancelButton: 'לדף הראשי',

  // To the owner (OF_SIGNUP_NOTIFY): a cancellation, its undo, a deleted account.
  cancelNoticeSubject: (business, product) => `ביטול מנוי: ${business}, ${product}`,
  cancelNoticeLines: (business, product, who, until, link) => [
    'לקוח ביטל מנוי מהדף שלו.',
    `עסק: ${business}`,
    `מוצר: ${product}`,
    `מי ביטל: ${who}`,
    until ? `עובד עד: ${until}` : 'לא היה תשלום על היום, אז הביטול חל מהיום.',
    { link },
  ],
  resumeNoticeSubject: (business, product) => `מנוי ממשיך: ${business}, ${product}`,
  resumeNoticeLines: (business, product, who, link) => ['לקוח שביטל מנוי חזר בו, והמנוי ממשיך.', `עסק: ${business}`, `מוצר: ${product}`, `מי: ${who}`, { link }],
  deleteNoticeSubject: (business) => `חשבון נמחק: ${business}`,
  deleteNoticeLines: (business, who, at, byAdmin, lines, invoices) => [
    byAdmin ? `החשבון של ${business} נמחק מהקונסולה.` : `הלקוח מחק את החשבון של ${business} מהדף שלו.`,
    `מי מחק: ${who}`,
    `מתי: ${at}`,
    ...[].concat(lines),
    `חשבוניות שנשמרו: ${invoices}`,
  ],
  deleteResults: { deleted: 'הנתונים נמחקו' },

  signature: 'OpenFrequency',
};

// ---- public sign-up, /signup (src/accounts/signup.js)

export const SIGNUP = {
  title: 'הרשמה',
  heading: 'פותחים חשבון',
  lead: 'כמה פרטים, ונשלח לכם מייל עם קישור לאישור. אחרי האישור החשבון נפתח, ואפשר להתחיל להגדיר.',
  nameLabel: 'השם המלא שלכם',
  businessLabel: 'שם העסק',
  businessHint: 'כמו שהלקוחות שלכם מכירים אותו. עד 80 תווים.',
  emailLabel: 'כתובת מייל',
  productsLegend: 'מה מתאים לכם',
  productsHint: 'אפשר לבחור את שניהם.',
  productWhat: { toran: 'עונה ללקוחות שלכם בוואטסאפ', teder: 'מצגות בעברית לטיקטוק, לאינסטגרם ולפייסבוק' },
  soon: 'בקרוב',
  productSoon: 'ההרשמה אליו תיפתח בקרוב.',
  price: (monthly, setup) => `${monthly} לחודש ועוד מע״מ, ודמי הקמה של ${setup} פעם אחת`,
  planLegend: 'איזו חבילה של תדר',
  // Teder's setup fee is not refunded (its terms: "דמי ההקמה לא מוחזרים"). Toran's terms say it otherwise, and this note
  // is Teder's only.
  planHint: 'חל רק כשבוחרים בתדר. אפשר לעבור חבילה אחר כך, בכתיבה אלינו. דמי ההקמה לא מוחזרים, ומשלמים אותם פעם אחת, עם החודש הראשון.',
  /** How paying works, by the payment mode (OF_PAYMENT), and cancelling. */
  pricesNote: (mode) =>
    `${mode === 'provider' ? 'אחרי שהחשבון נפתח, משלמים בו בכרטיס אשראי' : 'אחרי שהחשבון נפתח, נשלח לכם במייל את פרטי התשלום'}, ו${opensAfter(mode, 'המוצרים', true)} אפשר לבטל את המנוי מהדף הראשי, והוא עובד עד סוף התקופה ששולמה.`,
  termsPre: 'מסכימים ל',
  termsLink: 'תנאי השימוש',
  termsMid: ' ול',
  privacyLink: 'מדיניות הפרטיות',
  honeypot: 'לא למלא את השדה הזה',
  submit: 'שלחו לי קישור לאישור',
  or: 'או',
  googleButton: 'המשך עם Google',
  googleHint: 'עם Google לא מחכים למייל. החשבון ייפתח עם הכתובת של חשבון ה-Google שתבחרו.',
  haveAccount: 'כבר יש לכם חשבון?',
  toLogin: 'לכניסה',

  errors: {
    bad_name: 'צריך את השם המלא שלכם, בין 2 ל-80 תווים.',
    bad_business: 'צריך את שם העסק, בין 2 ל-80 תווים.',
    bad_email: 'הכתובת הזאת לא נראית כמו כתובת מייל. בדקו אותה ונסו שוב.',
    no_products: 'צריך לבחור לפחות מוצר אחד.',
    product_closed: 'ההרשמה לאחד המוצרים שבחרתם עוד לא נפתחה. אפשר להירשם עכשיו למוצרים שפתוחים.',
    no_terms: 'כדי לפתוח חשבון צריך להסכים לתנאי השימוש ולמדיניות הפרטיות.',
    bad_plan: 'צריך לבחור אחת מהחבילות של תדר.',
  },
  busy: 'היום נשלחו מכאן הרבה מיילים של הרשמה, אז עצרנו אותם עד מחר. אפשר לנסות שוב מחר, או לכתוב לנו.',
  tooMany: (seconds) => `נשלחו מכאן הרבה בקשות בזמן קצר. נסו שוב בעוד ${minutes(seconds)} דקות.`,

  closedTitle: 'ההרשמה תיפתח בקרוב',
  closedLead: 'בינתיים אנחנו פותחים כל חשבון בעצמנו. אפשר להשאיר לנו פרטים באתר, ונחזור אליכם.',
  closedLink: 'להשארת פרטים',

  sentTitle: 'בדקו את המייל',
  sentLead: (email) => `תוך דקה יגיע ל-${email} מייל עם קישור להמשך. הקישור עובד פעם אחת, במשך 15 דקות.`,
  sentSpam: 'לא הגיע? בדקו בתיקיית הספאם, או נסו להירשם שוב.',

  confirmTitle: 'אישור החשבון',
  confirmLead: (business, email) => `לחצו כדי לפתוח את החשבון של ${business}, עם הכתובת ${email}.`,
  confirmProducts: (names) => `המוצרים שבחרתם: ${names}.`,
  /** What comes after the button, by the payment mode (OF_PAYMENT). `opens` is opensAfter(). */
  confirmPay: (mode, opens) => `${mode === 'provider' ? 'אחרי שהחשבון נפתח, משלמים בו בכרטיס אשראי.' : 'אחרי שהחשבון נפתח, נשלח לכם במייל את פרטי התשלום.'} ${opens}`,
  confirmButton: 'לפתוח את החשבון',
  and: ' ו',

  deadTitle: 'הקישור הזה כבר לא עובד',
  deadLead: 'קישור לאישור עובד פעם אחת, במשך 15 דקות. אפשר להירשם שוב, זה לוקח דקה.',
  again: 'להרשמה',

  existsTitle: 'כבר יש לכם חשבון עם הכתובת הזאת',
  existsLead: 'לא פתחנו חשבון נוסף. אפשר להיכנס לחשבון הקיים עם קישור למייל.',

  signedInTitle: (email) => `אתם כבר מחוברים בתור ${email}`,
  signedInLead: 'כדי לפתוח חשבון חדש עם כתובת אחרת, צאו קודם מהחשבון הזה.',
  home: 'לדף הראשי',
  signOut: 'יציאה',

  googleExisting: (email) => `כבר יש לכם חשבון עם ${email}, אז נכנסתם אליו. לא פתחנו חשבון נוסף.`,
  googleTaken: 'אי אפשר לפתוח חשבון עם הכתובת הזאת',
  googleTakenLead: 'בחרו ב-Google חשבון אחר, או הירשמו עם כתובת מייל.',
};

// ---- the setup page, /setup (src/web/setup.js, docs/setup.md)

export const SETUP = {
  title: 'הגדרה',
  heading: 'מגדירים את החשבון',
  lead: 'מה שנשאר לעשות כדי שהמוצרים שלכם יעבדו. כל צעד מוביל למקום שבו עושים אותו.',
  progress: (done, total) => `${done} מתוך ${total} צעדים`,
  progressLabel: 'כמה צעדים כבר עשיתם',
  allDone: 'כל הצעדים הושלמו.',
  unknown: 'חלק מהמוצרים לא ענו לנו עכשיו, אז ייתכן שחסרים כאן צעדים.',
  ready: 'מוכן',
  notReady: 'עוד לא מוכן',
  optional: 'אפשר גם',
  status: { done: '✓ בוצע', working: 'בתהליך', attention: 'צריך תשומת לב', soon: 'בקרוב', todo: 'עוד לא' },
  required: 'חובה',
  start: 'להתחיל',
  open: 'לפתוח',
  actionLabel: (verb, title) => `${verb}, ${title}`,
  failed: 'לא הצלחנו לבדוק כרגע.',
  failedLink: (product) => `לפתוח את ${product}`,
  noSteps: 'אין כאן צעדים כרגע.',
  billingTitle: 'תשלום',
  billingStep: 'התשלום על המנוי',
  // How paying works, by the payment mode (OF_PAYMENT). `opens` is opensAfter() for the products still closed, or ''.
  // `how`: the owner's payment details (OF_PAYMENT_METHOD), shown under it in the card (billingHow).
  billingManual: (opens, how = '') => `${how ? 'משלמים לפי פרטי התשלום שכאן למטה.' : 'את פרטי התשלום אנחנו שולחים לכם במייל.'}${opens ? ` ${opens}` : ''}`,
  billingTodo: (opens) => `משלמים בכרטיס אשראי בדף התשלום.${opens ? ` ${opens}` : ''}`,
  billingDone: 'המנוי שולם.',
  billingComp: 'החשבון הזה אצלנו ללא תשלום.',
  billingPay: 'לתשלום',
  billingWrite: 'כתבו לנו בוואטסאפ',
  billingContact: 'ליצירת קשר',
  billingAsk: (wa) => (wa ? 'יש שאלה על התשלום? כתבו לנו בוואטסאפ, או ענו לאחד המיילים שקיבלתם מאיתנו.' : 'יש שאלה על התשלום? ענו לאחד המיילים שקיבלתם מאיתנו.'),
  billingPrice: (product, monthly, vat, setup) => `${product}: ${monthly} לחודש, ${vat}${setup ? `, ודמי הקמה של ${setup} פעם אחת` : ''}`,
  billingPaidUntil: (product, d) => `${product}: שולם עד ${d}`,
  billingDue: (product, d) => `${product}: התשלום על החודש הנוכחי עוד לא הגיע. המנוי עובד עד ${d}, ואחרי זה נעצר עד שישולם.`,
  billingHow: (how) => `איך משלמים: ${how}`,
  billingSupportText: (business) => `היי, כותבים מ״${business}״. יש לנו שאלה על התשלום.`,
  locked: 'נפתח אחרי התשלום',
  lockedChip: 'אחרי התשלום',
  lockedLead: (product) => `הצעדים של ${product} נפתחים אחרי התשלום.`,
  noProducts: 'עוד אין מוצר פעיל בחשבון הזה, אז אין מה להגדיר.',
  back: 'לדף הראשי',

  // On the home page, while setup is not finished
  cardTitle: 'הגדרת החשבון',
  cardLead: (done, total) => (total ? `${done} מתוך ${total} צעדים הושלמו.` : 'נשארו כמה צעדים עד שהכול יעבוד.'),
  cardButton: 'להמשך ההגדרה',
  nav: 'הגדרה',
  navLabel: 'החשבון',
};

// ---- cancelling a subscription online, /subscription/<product>/cancel

export const CANCEL = {
  title: 'ביטול מנוי',
  heading: (product) => `ביטול המנוי ל${product}`,
  leadPaid: (product, d) => `אם תבטלו, ${product} ימשיך לעבוד עד ${d}, היום האחרון ששילמתם עליו. אחרי זה הוא נעצר, ולא נחייב אתכם יותר.`,
  leadUnpaid: (product) => `עוד לא שילמתם על ${product}, אז הביטול חל מהיום, ולא נחייב אתכם עליו.`,
  undo: (d) => `עד ${d} אפשר לחזור בכם מהדף הראשי, בכפתור "להמשיך את המנוי".`,
  keepsData: 'הביטול לא מוחק נתונים. כדי למחוק את החשבון ואת כל מה שבו, יש לזה כפתור נפרד בדף הראשי.',
  confirm: 'לבטל את המנוי',
  back: 'לא, חזרה לדף הראשי',
  flashCancelled: (product, d) => `ביטלנו את המנוי ל${product}. הוא עובד עד ${d}, ושלחנו לכם אישור במייל.`,
  flashCancelledNow: (product) => `ביטלנו את המנוי ל${product}, ושלחנו לכם אישור במייל.`,
  flashResumed: (product) => `המנוי ל${product} ממשיך כרגיל.`,
  readOnly: 'בצפייה כלקוח אי אפשר לשנות כלום.',
  errors: {
    not_owner: 'רק בעלי החשבון יכולים לבטל את המנוי.',
    comp: 'המנוי הזה ללא תשלום, אז אין מה לבטל. כדי לסגור אותו, כתבו לנו.',
    already: 'המנוי הזה כבר בוטל.',
    ended: 'המנוי כבר הסתיים. כדי לחדש אותו, כתבו לנו.',
    not_cancelled: 'המנוי הזה לא בוטל.',
    product_off: 'המוצר הזה לא פעיל בחשבון.',
  },
};

// ---- deleting the account and its data, /account/delete

export const ERASE = {
  title: 'מחיקת החשבון',
  lead: (business) => `כאן מוחקים את החשבון של ${business} ואת הנתונים שלו. אי אפשר לבטל את זה אחרי שזה קורה.`,
  goneTitle: 'מה נמחק',
  gone: [
    'כל מה שתדר ותורן שמרו עבור העסק.',
    'האנשים בחשבון וההזמנות. מי שרשום רק בחשבון הזה נמחק אצלנו לגמרי, עם המייל והשם שלו.',
    'מספרי הוואטסאפ והגדרות ההתראות.',
    'המנויים. הם נעצרים מיד, ולא נחייב אתכם יותר.',
  ],
  keptTitle: 'מה נשאר',
  kept: 'החשבוניות. החוק מחייב אותנו לשמור אותן, אז עותק שלהן נשאר אצלנו, עם שם העסק, מחוץ לחשבון. נשאר גם יומן הפעולות שלנו, שבו רשום מה קרה ומתי.',
  cancelInstead: 'רוצים רק להפסיק לשלם ולשמור את הנתונים? אפשר לבטל את המנוי מהדף הראשי.',
  confirmLabel: (business) => `כדי לאשר, כתבו את שם העסק: ${business}`,
  button: 'למחוק את החשבון לצמיתות',
  back: 'לא, חזרה לדף הראשי',
  mismatch: 'השם לא תואם. כתבו את שם העסק בדיוק כמו שהוא מופיע למעלה.',
  failed: (names, many) => `לא הצלחנו לסיים את המחיקה, כי ${names} ${many ? 'לא ענו' : 'לא ענה'} לנו. החשבון עדיין קיים. נסו שוב בעוד כמה דקות, ואם זה חוזר, כתבו לנו.`,
  ownersOnly: 'רק בעלי החשבון יכולים למחוק אותו.',
  readOnly: 'בצפייה כלקוח אי אפשר למחוק כלום. מוחקים חשבון מהקונסולה.',
  doneTitle: 'החשבון נמחק',
  doneLead: (business) => `מחקנו את החשבון של ${business} ואת הנתונים שלו, ויצאתם מהחשבון. עותק של החשבוניות נשמר אצלנו, כמו שהחוק מחייב.`,
  doneLink: 'לאתר של OpenFrequency',
  and: ' ו',
};

// ---- product emails, /notifications (src/accounts/notify.js)

export const NOTIFY = {
  title: 'התראות במייל',
  lead: 'כאן בוחרים על מה נשלח לכם מייל, בכל מוצר בנפרד. ההגדרה שלכם בלבד, ולא משנה מה אחרים בחשבון מקבלים.',
  defaults: 'בהתחלה בעלי החשבון מקבלים הכול, ושאר הצוות לא מקבל כלום.',
  kinds: {
    posts_waiting: 'פוסטים שמחכים לאישור',
    weekly: 'סיכום שבועי',
    monthly: 'סיכום חודשי',
    connect_needed: 'חשבון שצריך לחבר מחדש',
    publish_failed: 'פרסום שלא הצליח',
  },
  save: 'שמירה',
  flashSaved: 'שמרנו. מעכשיו נשלח לכם רק את מה שסימנתם.',
  noProducts: 'עוד אין מוצר פעיל בחשבון, אז אין על מה לשלוח.',
  back: 'לדף הראשי',
  readOnly: 'בצפייה כלקוח אי אפשר לשנות כלום.',
  mailButton: (product) => `לפתוח את ${product}`,
  mailFooter: (kind, product) => `קיבלתם את המייל הזה כי ההתראות על ${kind} ב${product} פועלות אצלכם.`,
  mailFooterLink: 'לשנות את ההתראות',
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

/** Shekels, as the site writes them: "1,490 ₪", or "1,762.82 ₪" when there are agorot. */
export const ils = (n) => `${Number(n).toLocaleString('he-IL', Number.isInteger(Number(n)) ? {} : { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₪`;

// ---- the operator's dashboard, /admin (Toran's docs/operator.md, section 4)
//
// Most of these lines are Toran's own, from the dashboard it used to show (its src/web/pages/ops.ts), in the
// console's voice: we, and the operator addressed as אתם. Every message to a store, the reason a card is there and
// what Toran says after an action come from Toran as they are.

export const OPS = {
  title: 'היום',
  tabs: 'הלוח',
  tabToday: 'היום',
  tabAccounts: 'חשבונות',
  tabToran: 'תורן',
  pageTitle: 'מה עושים היום',

  kpiContact: 'לפנות היום',
  kpiContactSub: (n) => (n ? 'ההודעה מוכנה בכל כרטיס. מעתיקים, שולחים ומסמנים' : 'אין למי לכתוב עכשיו'),
  kpiTalking: 'בשיחה',
  kpiMrr: 'הכנסה חודשית',
  kpiLate: 'באיחור',
  kpiReplied: 'ענו ב-30 יום',
  unknown: '?',

  toranDown: 'תורן לא ענה עכשיו',
  toranDownLead: (base) => `החלק הזה מגיע מתורן, מ-GET /internal/ops ב-${base}. שאר הדף עובד בלעדיו.`,
  toranNotConfigured: 'OF_INTERNAL_TOKEN לא מוגדר כאן, או שהוא קצר מ-32 תווים, אז לא פנינו לתורן. שאר הדף עובד בלעדיו.',
  tederStale: 'את המצגות של תדר תורן לא הצליח לקרוא עכשיו (GET /internal/demos). מה שמופיע מהן כאן הוא מהקריאה הקודמת.',
  // Our number, at the top: Toran's demoLine (live, and through what).
  numberLive: (via) => (via ? `המספר שלנו מחובר דרך ${via}.` : 'המספר שלנו מחובר.'),
  numberSim: 'הדמו כאן על הסימולטור: מה שנשלח ממנו לא יוצא לאף אחד.',
  numberOff: 'המספר שלנו עוד לא מחובר, אז שליחה ממנו והלינקים לדמואים שיוצאים לבד מחכים עד שיתחבר.',

  contactTitle: 'לפנות היום',
  contactOrder: 'קודם מי שניסו את הדמו, אחריהם מי שביקשו באתר, התזכורות, ובסוף דפים חדשים לפי הציון',
  contactMore: (n) => `ועוד ${n}. הם יופיעו כאן כשהרשימה תתקצר.`,
  contactEmpty: 'אין כרגע למי לכתוב',
  contactEmptyLead: 'כאן יופיעו דפים מוכנים, תזכורות שהגיע זמנן, ומי שביקשו דמו באתר.',
  message: 'ההודעה',
  openChat: 'לפתוח שיחה',
  copyOpen: 'להעתיק ולפתוח',
  copy: 'להעתיק',
  copied: 'ההודעה הועתקה',
  copyFailed: 'לא הצלחנו להעתיק. אפשר לסמן את ההודעה ולהעתיק ידנית.',
  direct: 'לשלוח עכשיו מהמספר של הדמו',
  sent: 'שלחתי',
  replied: 'ענו לי',
  tomorrow: 'מחר',
  inAWeek: 'בעוד שבוע',
  lost: 'לא מעוניינים',
  lostWhy: 'למה',
  lostSave: 'סימון',
  lostReasons: {
    not_interested: 'לא מעוניינים',
    price: 'יקר להם',
    has_solution: 'יש להם פתרון אחר',
    no_answer: 'לא עונים',
    not_fit: 'לא מתאים לחנות',
    other: 'אחר',
  },
  nextLabel: 'הצעד הבא',
  nextPlaceholder: 'הצעד הבא, למשל: לשלוח הצעת מחיר',
  nextWhen: 'מתי',
  nextDays: { 1: 'מחר', 3: 'בעוד 3 ימים', 7: 'בעוד שבוע', 14: 'בעוד שבועיים' },
  nextSave: 'שמירה',

  noContact: (n) => (n === 1 ? 'דף אחד מוכן, ואין לנו איך לפנות לחנות' : `${n} דפים מוכנים, ואין לנו איך לפנות לחנויות`),
  noContactHint: 'אין באתר שלהן וואטסאפ או מייל. אפשר לחפש איש קשר באינסטגרם או בפייסבוק, ולהוסיף אותו בעמוד של הליד בתורן.',
  score: (n) => `ציון ${n}`,

  stuckTitle: 'ביקשו דמו באתר, ועוד אין מה לשלוח',
  stuckAsked: (ago) => `ביקשו ${ago}`,
  stuckHint: 'הם כתבו לנו מהמספר שלהם ומחכים לדמו. כשאין דף לשלוח, כדאי לענות להם בעצמכם: בכל כרטיס יש הודעה לפי הסיבה.',

  tederDemosTitle: 'הדמואים של תדר שעוד לא עלו',
  tederDemosHint: 'מי שביקשו באתר דמו של תדר, והעמוד שלו עוד לא באוויר. כל שם פותח את הדמו בתדר.',

  talkingTitle: 'בשיחה',
  talkingEmpty: 'אף אחד עוד לא בשיחה',
  talkingEmptyLead: 'מי שעונים לכם עוברים לכאן כשמסמנים "ענו לי".',
  repliedAgo: (ago) => `ענו ${ago}`,
  nextAt: (at, what) => (what ? `הצעד הבא: ${what}, ${at}` : `הצעד הבא ${at}`),
  inPilot: 'בפיילוט',
  pilot: 'התחילו פיילוט',
  paid: 'משלמים',
  won: 'לקוח',

  funnelTitle: 'המשפך',
  funnelStage: 'שלב',
  funnelAll: 'מתחילת הדרך',
  funnelMonth: 'ב-30 הימים האחרונים',
  funnelNote: 'האחוז ליד כל שלב הוא מתוך השלב שלפניו. הלקוחות נספרים מהמנויים כאן: מנוי ששולם, או שמסתיים.',

  moneyTitle: 'לקוחות וכסף',
  mrr: 'הכנסה חודשית, לפני מע״מ',
  mrrSub: 'ממנויים ששולמו לחודש הזה',
  paying: 'לקוחות משלמים',
  payingSub: (toran, teder) => `תורן ${toran} · תדר ${teder}`,
  late: 'באיחור',
  lateSub: 'התקופה ששולמה נגמרה',
  lateTitle: 'באיחור בתשלום',
  lateNone: 'אין אף אחד באיחור.',
  lateLine: (name, product, amount, since) => `${name} · ${product} · ${amount} לחודש${since ? ` · מ-${since}` : ''}`,
  waitingTitle: 'מחכים לתשלום הראשון',
  waitingNone: 'אין מנויים שמחכים לתשלום ראשון.',
  waitingLine: (name, product, amount, setup) => `${name} · ${product} · ${amount} לחודש${setup ? `, ודמי הקמה ${setup}` : ''}`,
  renewTitle: 'מתחדשים ב-7 הימים הקרובים',
  renewNone: 'אין חידושים בשבוע הקרוב.',
  renewLine: (on, name, product, amount) => `${on} · ${name} · ${product} · ${amount}`,
  moneyNote: 'ההכנסה החודשית בלי מע״מ. ליד כל לקוח מופיע הסכום כמו שנרשם במנוי שלו.',
  moneyManage: 'לניהול הלקוחות והחשבוניות',

  // /admin/toran, when Toran is not up or does not answer in 30 seconds.
  toranNoAnswerTitle: 'תורן לא ענה כרגע',
  toranNoAnswerLead: 'הדפים האלה מגיעים מתורן, ותוך 30 שניות לא הגיעה ממנו תשובה, או שהוא לא רץ עכשיו. כדאי לרענן בעוד רגע. הלוח של היום והחשבונות עובדים כרגיל.',
  toranNoAnswerBack: 'חזרה ללוח',

  // After an action, when the line is ours and not Toran's
  toranNoAnswer: 'תורן לא ענה, אז שום דבר לא נרשם. כדאי לנסות שוב בעוד רגע.',
  toranFailed: (status) => `תורן החזיר שגיאה (${status}), אז שום דבר לא נרשם.`,
  directToranOnly: 'אפשר לשלוח מהמספר של הדמו רק את תורן',
  pilotToranOnly: 'פיילוט ותשלום נרשמים כאן רק לתורן',
  wonTederOnly: 'לקוח נרשם כאן רק לתדר',
  badAction: 'אין פעולה כזו',
  badReason: 'צריך לבחור למה',
  viewAsClosed: 'בזמן צפייה כלקוח הלוח סגור. מסיימים את הצפייה וחוזרים אליו.',
  // The page's script
  offline: 'אין חיבור. כדאי לנסות שוב.',
  unexpected: 'תשובה לא צפויה מהשרת',
};

const SHORT = new Intl.DateTimeFormat('he-IL', { timeZone: 'Asia/Jerusalem', day: 'numeric', month: 'short' });
/** A moment as "12 בנוב׳ ב-14:00", Israel time, for the next step. */
export const stampHe = (iso) => (iso && !Number.isNaN(Date.parse(iso)) ? `${SHORT.format(new Date(iso))} ב-${HOUR_HE.format(new Date(iso))}` : '');

/** "לפני 3 שעות", for the dashboard's lists (Toran's ago()). */
export function agoHe(iso, at) {
  if (!iso || Number.isNaN(Date.parse(iso))) return '';
  const s = Math.max(0, (at - Date.parse(iso)) / 1000);
  if (s < 90) return 'עכשיו';
  if (s < 3600) return `לפני ${Math.round(s / 60)} דק׳`;
  if (s < 86400) return Math.round(s / 3600) === 1 ? 'לפני שעה' : `לפני ${Math.round(s / 3600)} שעות`;
  const days = Math.round(s / 86400);
  return days === 1 ? 'אתמול' : days < 14 ? `לפני ${days} ימים` : SHORT.format(new Date(iso));
}
