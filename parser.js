// Maroko — محلل الأوامر بالدارجة المغربية (يخدم بلا إنترنت)
// "ذكرني نشري الخبز غدا العشية" -> { title: "نشري الخبز", date: غدا 18:00 }

const L = '\\u0621-\\u064A';
const W = (p) => new RegExp(`(?<![${L}])(?:${p})(?![${L}])`);
const toLatin = (s) => s.replace(/[٠-٩]/g, (c) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(c)));

const HOUR_WORDS = {
  'واحدة': 1, 'وحدة': 1, 'جوج': 2, 'تلاتة': 3, 'ثلاثة': 3, 'ربعة': 4, 'اربعة': 4, 'أربعة': 4,
  'خمسة': 5, 'ستة': 6, 'سبعة': 7, 'تمنية': 8, 'ثمانية': 8, 'تسعود': 9, 'تسعة': 9,
  'عشرة': 10, 'حداش': 11, 'تناش': 12,
};
const HW = Object.keys(HOUR_WORDS).join('|');

const PREFIX = /^\s*(?:ذكرني|فكرني|ذكّرني|فكّرني|ذكرنا|سجل(?:\s+لي)?|زيد(?:\s+لي)?|دير(?:\s+لي)?|ضيف(?:\s+لي)?|عافاك|عفاك|لو\s+سمحت)\s*/;

const AFTER_TOM = W('بعد\\s*غد[اةه]?|بعد\\s*غدوة');
const TOM = W('غد[اةه]?|غدوة');
const TODAY = W('اليوم|نهار\\s+اليوم');
const WEEKDAYS = [
  [0, 'ال[أا]حد|الحد'],
  [1, 'ال[اإأ]ثنين|التنين|الاتنين'],
  [2, 'الثلاثاء|التلات|التلاتاء|الثلاثا'],
  [3, 'ال[أا]ربعاء|لربعاء|الاربعا|لاربعا'],
  [4, 'الخميس|لخميس'],
  [5, 'الجمعة|الجمعه|لجمعة|لجمعه'],
  [6, 'السبت|لسبت'],
].map(([wd, p]) => [wd, W(`(?:(?:نهار|يوم)\\s+)?(?:${p})`)]);

const REL = new RegExp(
  `(?<![${L}])(?:من\\s+)?بعد\\s+(نص\\s+ساع[هة]|ساع[هة]|ساعتين|دقيقتين|\\d+)\\s*(ساعات|ساع[هة]|دقيق[هة]|دقائق|دقايق|ايام|أيام|يوم)?(?![${L}])`
);

const TIME_PREP = new RegExp(
  `(?<![${L}])(?:فالساعه|فالساعة|الساعه|الساعة|ساعه|ساعة|على|عل|في|ف|عند)\\s*(\\d{1,2}|${HW})(?::(\\d{2}))?(?![${L}\\d])(?:\\s*(و\\s*نص[ف]?|و\\s*ربع|[اإ]لا\\s*ربع|و\\s*\\d{1,2}(?!\\d)))?`
);
const TIME_COLON = /(?<!\d)(\d{1,2}):(\d{2})(?!\d)/;

const PERIOD = W(
  '(?:ديال\\s+)?[فب]?(?:صباحا|صباح|الصباح|الصبح|صبح|الفجر|فجرا|الظهر|ظهرا|العصر|العشيه|العشية|عشيه|عشية|المغرب|العشاء|الليل|ليلا|الليله|الليلة|مساء|مساءا)'
);

const hourVal = (t) => (/^\d+$/.test(t) ? Number(t) : HOUR_WORDS[t]);

function cleanTitle(s) {
  let t = s.replace(/\s+/g, ' ').trim();
  let prev;
  do {
    prev = t;
    t = t.replace(/\s*(?:^|\s)(?:على|عل|في|ف|عند|نهار|يوم|ديال|د|ب|ل|و)$/, '').trim();
  } while (t !== prev);
  return t;
}

export function parseCommand(input, now = new Date()) {
  let s = toLatin(String(input || '')).replace(/[،,؟?!.؛]/g, ' ');
  for (let i = 0; i < 2; i++) s = s.replace(PREFIX, '');
  const cut = (re) => {
    const r = s.match(re);
    if (r) s = s.replace(r[0], ' ');
    return r;
  };

  // 1) "من بعد ساعة / 30 دقيقة / ساعتين"
  const rel = cut(REL);
  if (rel) {
    const q = rel[1];
    const unit = rel[2] || '';
    let mins;
    if (/نص/.test(q)) mins = 30;
    else if (/^ساع[هة]$/.test(q)) mins = 60;
    else if (q === 'ساعتين') mins = 120;
    else if (q === 'دقيقتين') mins = 2;
    else {
      const n = Number(q);
      if (/ساع/.test(unit)) mins = n * 60;
      else if (/يوم|ايام|أيام/.test(unit)) mins = n * 1440;
      else mins = n;
    }
    const date = new Date(now.getTime() + mins * 60000);
    date.setSeconds(0, 0);
    return { title: cleanTitle(s) || 'تذكير', date };
  }

  // 2) النهار
  let dayOffset = null;
  let weekday = null;
  if (cut(AFTER_TOM)) dayOffset = 2;
  else if (cut(TOM)) dayOffset = 1;
  else if (cut(TODAY)) dayOffset = 0;
  else {
    for (const [wd, re] of WEEKDAYS) {
      if (cut(re)) { weekday = wd; break; }
    }
  }

  // 3) الساعة
  let hour = null;
  let minute = 0;
  let tm = cut(TIME_PREP);
  if (tm) {
    hour = hourVal(tm[1]);
    if (tm[2]) minute = Number(tm[2]);
    const mod = tm[3];
    if (mod) {
      if (/نص/.test(mod)) minute = 30;
      else if (/[اإ]لا/.test(mod)) { hour -= 1; if (hour < 1) hour = 12; minute = 45; }
      else if (/ربع/.test(mod)) minute = 15;
      else minute = Number(mod.replace(/\D/g, ''));
    }
  } else {
    tm = cut(TIME_COLON);
    if (tm) { hour = Number(tm[1]); minute = Number(tm[2]); }
  }

  // 4) وقت النهار: الصباح / العشية / الليل ...
  const pm = cut(PERIOD);
  let kind = null;
  if (pm) {
    const p = pm[0];
    kind = /فجر/.test(p) ? 'fajr'
      : /صبا|صبح/.test(p) ? 'am'
      : /ظهر/.test(p) ? 'noon'
      : /عصر/.test(p) ? 'asr'
      : /عش[يى]|مساء/.test(p) ? 'eve'
      : /مغرب/.test(p) ? 'maghrib'
      : 'night';
  }

  const hasDay = dayOffset !== null || weekday !== null;
  if (hour === null && kind === null && !hasDay) {
    return { title: cleanTitle(s), date: null };
  }

  if (hour !== null) {
    if (kind === 'am' || kind === 'fajr') { if (hour === 12) hour = 0; }
    else if (kind === 'noon') { if (hour <= 5) hour += 12; }
    else if (kind === 'night') { if (hour === 12) hour = 0; else if (hour < 12) hour += 12; }
    else if (kind) { if (hour < 12) hour += 12; }
    else if (hour >= 1 && hour <= 6) hour += 12; // "على 5" = 17:00 غالبا
  } else if (kind) {
    hour = { fajr: 5, am: 8, noon: 13, asr: 16, eve: 18, maghrib: 19, night: 21 }[kind];
    minute = 0;
  } else {
    hour = 9;
    minute = 0;
  }
  if (hour > 23 || minute > 59) return { title: cleanTitle(s), date: null };

  const d = new Date(now);
  d.setSeconds(0, 0);
  if (dayOffset !== null) d.setDate(d.getDate() + dayOffset);
  else if (weekday !== null) d.setDate(d.getDate() + ((weekday - d.getDay() + 7) % 7));
  d.setHours(hour, minute);
  if (d <= now) {
    d.setDate(d.getDate() + (weekday !== null && dayOffset === null ? 7 : 1));
  }
  return { title: cleanTitle(s) || 'تذكير', date: d };
}
