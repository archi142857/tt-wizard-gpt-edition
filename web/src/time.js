// 시각 도우미. 서버는 '2026-11-13T15:00:00+09:00'(종일은 날짜만)을 주고, 화면은 한국 시간(UTC+9, 서머타임 없음)으로 보인다.
const KST = 9 * 60 * 60 * 1000;
const DAY = 24 * 60 * 60 * 1000;
export const WEEKDAYS = ['월', '화', '수', '목', '금', '토', '일'];

// 한국 시간으로 본 연·월·일·요일(0=월 … 6=일)·시·분
export function kst(dateOrIso) {
  const d = new Date(new Date(dateOrIso).getTime() + KST);
  return {
    y: d.getUTCFullYear(),
    m: d.getUTCMonth() + 1,
    d: d.getUTCDate(),
    wd: (d.getUTCDay() + 6) % 7,
    h: d.getUTCHours(),
    min: d.getUTCMinutes(),
  };
}

// 한국 시간 '연-월-일 시:분' → 그 순간(Date)
export function fromKst(y, m, d, h = 0, min = 0) {
  return new Date(Date.UTC(y, m - 1, d, h, min) - KST);
}

// 그 주 월요일 0시(한국 시간)
export function weekStart(dateOrIso) {
  const p = kst(dateOrIso);
  return fromKst(p.y, p.m, p.d - p.wd);
}

// 그날 0시(한국 시간). 주간 달력은 오늘 0시부터 7일을 보인다
export function dayStart(dateOrIso) {
  const p = kst(dateOrIso);
  return fromKst(p.y, p.m, p.d);
}

export function addDays(date, n) {
  return new Date(new Date(date).getTime() + n * DAY);
}

// 주의 시작(weekStart)부터 며칠째인지. 그 주(n일, 기본 7) 밖이면 -1
export function dayIndex(start, dateOrIso, n = 7) {
  const i = Math.floor((new Date(dateOrIso) - new Date(start)) / DAY);
  return i >= 0 && i < n ? i : -1;
}

// 끝을 정하지 않은 일정·메모는 1시간으로 본다(11-13 사람 "끝나는 시간을 따로 정하지 않았으면 1시간을 기본으로").
// 서버(AI toStartEnd)도 같은 규칙. 예전에 끝 없이 들어간 일정도 그릴 때·보일 때 1시간이다.
export const DEFAULT_EVENT_MIN = 60;
export function endOrHour(startIso, endIso) {
  return endIso || toKstIso(new Date(Date.parse(startIso) + DEFAULT_EVENT_MIN * 60000));
}
// 'HH:MM' + 1시간. 자정을 넘으면 null(입력칸 하나로는 다음 날을 못 적는다), wrap이면 '00:30'처럼 돌려 보인다
export function plusHourText(time, wrap = false) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(time || '');
  if (!m) return null;
  const h = Number(m[1]) + 1;
  if (h >= 24 && !wrap) return null;
  return `${String(h % 24).padStart(2, '0')}:${m[2]}`;
}

// 9:30, 15:00
export function hhmm(dateOrIso) {
  const p = kst(dateOrIso);
  return `${p.h}:${String(p.min).padStart(2, '0')}`;
}

// 하루 안에서 몇 분째인지(한국 시간)
export function minuteOfDay(dateOrIso) {
  const p = kst(dateOrIso);
  return p.h * 60 + p.min;
}

// 주 제목: '11월 9일 – 15일', 달이 바뀌면 '11월 30일 – 12월 6일'
export function weekTitle(start, n = 7) {
  const a = kst(start);
  if (n === 1) return `${a.m}월 ${a.d}일 ${WEEKDAYS[a.wd]}요일`;
  const b = kst(addDays(start, n - 1));
  return a.m === b.m ? `${a.m}월 ${a.d}일 – ${b.d}일` : `${a.m}월 ${a.d}일 – ${b.m}월 ${b.d}일`;
}

// 마감 글: 일주일 안이면 '수 23:59', 지났으면 '마감 지남', 더 멀면 '11월 20일', 모르면 '마감 ?'
export function dueLabel(dueIso, now = new Date()) {
  if (!dueIso) return '마감 ?';
  const due = new Date(dueIso);
  if (due < new Date(now)) return '마감 지남';
  const p = kst(due);
  if (due - new Date(now) < 7 * DAY) return `${WEEKDAYS[p.wd]} ${hhmm(due)}`;
  return `${p.m}월 ${p.d}일`;
}

// 팝업·정보 창의 시간 칸: '11월 10일 (화) 15:00 ~ 17:00'. 끝이 없으면 1시간(11-13)
export function popupTime(startIso, endIso) {
  if (!startIso) return '?';
  const p = kst(startIso);
  return `${p.m}월 ${p.d}일 (${WEEKDAYS[p.wd]}) ${hhmm(startIso)} ~ ${hhmm(endOrHour(startIso, endIso))}`;
}

// 서버에 보내는 시각 글자: schema.sql 머리말대로 '2026-11-13T15:00:00+09:00'
export function toKstIso(dateOrIso) {
  const p = kst(dateOrIso);
  const two = (n) => String(n).padStart(2, '0');
  return `${p.y}-${two(p.m)}-${two(p.d)}T${two(p.h)}:${two(p.min)}:00+09:00`;
}

// 종일 일정은 서버가 날짜만('2026-11-13') 준다 → 그날 0시(한국 시간)로 읽는다
export function isDateOnly(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function dayStartKst(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  return fromKst(y, m, d);
}

// <input type="date">·<input type="time"> 값과 ISO 사이 바꾸기(한국 시간 기준)
export function dateInput(dateOrIso) {
  const p = kst(dateOrIso);
  return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
}

export function timeInput(dateOrIso) {
  const p = kst(dateOrIso);
  return `${String(p.h).padStart(2, '0')}:${String(p.min).padStart(2, '0')}`;
}

// ('2026-11-10', '15:00') → '2026-11-10T15:00:00+09:00'. 날짜나 시각이 비면 null
export function isoFromInputs(date, time) {
  if (!date || !time) return null;
  return `${date}T${time}:00+09:00`;
}

// 채팅의 날짜 줄: '오늘', '어제', '11월 7일 (토)'
export function dayLabel(dateOrIso, now = new Date()) {
  const a = kst(dateOrIso);
  const t = kst(now);
  const y = kst(addDays(now, -1));
  if (a.y === t.y && a.m === t.m && a.d === t.d) return '오늘';
  if (a.y === y.y && a.m === y.m && a.d === y.d) return '어제';
  return `${a.m}월 ${a.d}일 (${WEEKDAYS[a.wd]})`;
}

// ── 마감 글(11-11 사람 "마감 시간 같은 게 안 보이니까 불편함") ──
// 날짜·시각을 늘 함께 보인다: '마감 오늘 23:59 · 3시간 남음', '마감 내일 11/12(목) 23:59', '마감 11/14(토) 18:00 · D-3',
// 지났으면 '마감 지남 · 11/9(월) 23:59', 모르면 '마감 ?'
export function daysUntil(dateOrIso, now = new Date()) {
  return Math.round((dayStart(dateOrIso) - dayStart(now)) / DAY);
}

export function shortDate(dateOrIso) {
  const p = kst(dateOrIso);
  return `${p.m}/${p.d}(${WEEKDAYS[p.wd]})`;
}

export function deadlineLabel(dueIso, now = new Date()) {
  if (!dueIso) return '마감 ?';
  const due = new Date(dueIso);
  const at = `${shortDate(due)} ${hhmm(due)}`;
  if (due < new Date(now)) return `마감 지남 · ${at}`;
  const d = daysUntil(due, now);
  if (d === 0) {
    const left = Math.max(0, Math.round((due - new Date(now)) / 60000));
    const h = Math.floor(left / 60);
    const rest = h ? `${h}시간${left % 60 ? ` ${left % 60}분` : ''}` : `${left}분`;
    return `마감 오늘 ${hhmm(due)} · ${rest} 남음`;
  }
  if (d === 1) return `마감 내일 ${at}`;
  return `마감 ${at} · D-${d}`;
}

// 좁은 칩에 넣는 짧은 마감 글: 오늘 '23:59', 일주일 안 '목 23:59', 더 멀면 '11/20 23:59', 지났으면 '지남'
export function deadlineShort(dueIso, now = new Date()) {
  if (!dueIso) return '?';
  const due = new Date(dueIso);
  if (due < new Date(now)) return '지남';
  const d = daysUntil(due, now);
  const p = kst(due);
  if (d === 0) return hhmm(due);
  if (d < 7) return `${WEEKDAYS[p.wd]} ${hhmm(due)}`;
  return `${p.m}/${p.d} ${hhmm(due)}`;
}

// ── 월 달력 ──
// 그 달 1일이 든 주의 월요일부터 6주(42칸). 칸마다 그날 0시(한국 시간)
export function monthGrid(y, m) {
  const first = weekStart(fromKst(y, m, 1));
  return Array.from({ length: 42 }, (_, i) => addDays(first, i));
}

// 달을 n개 옮긴다: ({y: 2026, m: 12}, 1) → {y: 2027, m: 1}
export function shiftMonth({ y, m }, n) {
  const k = y * 12 + (m - 1) + n;
  return { y: Math.floor(k / 12), m: (k % 12) + 1 };
}

export const sameDay = (a, b) => dayStart(a).getTime() === dayStart(b).getTime();
