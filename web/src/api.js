// 화면이 서버와 주고받는 것은 모두 이 파일을 거친다. 주소와 JSON 모양은 web/API.md에 있다.
// '예시로 둘러보기'(또는 주소 끝 ?example)일 때는 서버 대신 example.js의 지어낸 자료를 쓴다.
// 시각은 schema.sql 머리말대로 '…T15:00:00+09:00', 종일 일정은 날짜만('2026-11-13').
import { applyExampleTidy, examplePopup, exampleTidy, makeExample } from './example.js';
import { groupDetail, groupFree, makeTogether, meetView, summary } from './togetherExample.js';
import { CROWDED, dueThisWeek, topThree } from './tasks.js';
import { addDays, dayStartKst, endOrHour, isDateOnly, toKstIso, weekStart } from './time.js';

// 웹은 같은 주소(/api/...)로 부른다. 나중에 Capacitor 앱으로 감쌀 때만 VITE_API_BASE에 서버 주소를 넣는다.
const BASE = import.meta.env?.VITE_API_BASE || '';

let ex = null;

export const SIGNED_OUT = 'tachyon:signed-out';

// 서버 저장소 무료 하루 한도(db_limit)일 때 어디서나 같은 글(사람 11-13 00:06이 고른 문구). 로그인 화면·스낵바·창 모두
export const DB_LIMIT_TEXT = '오늘 서버 사용량을 모두 소진했어요. 오전 9시부터 다시 이용할 수 있어요';

export function startExample(now = new Date()) {
  ex = makeExample(now);
}

export function isExample() {
  return ex !== null;
}

async function call(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    credentials: BASE ? 'include' : 'same-origin',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    // 5xx는 서버가 스스로 오류를 보고한다. 화면은 한 줄 안내만(서버 문장은 4xx일 때만 그대로).
    // 503은 서버가 일부러 보내는 안내라 그 문장을 그대로 쓴다 — 저장소 사정 { error, code: 'db_limit' | 'db_busy' }(11-12),
    // 같이 쓰기·eTL 표 준비 중. code는 error.code로 넘긴다(web/API.md '공통').
    const said = res.status === 503 && (data?.code === 'db_limit' ? DB_LIMIT_TEXT : typeof data?.error === 'string' && data.error);
    const text = said || (res.status >= 500 ? '잠깐 문제가 생겼어요. 잠시 뒤에 다시 해 주세요' : data?.error || (res.status === 401 ? '로그인이 필요해요' : `요청을 처리하지 못했어요 (${res.status})`));
    const error = new Error(text);
    error.status = res.status;
    error.code = data?.code ?? null;
    // 쓰는 도중 로그인이 끝나면(쿠키 30일) 화면 전체가 로그인으로 돌아간다(App.jsx가 듣는다)
    if (res.status === 401 && path !== '/api/login/me') window.dispatchEvent(new CustomEvent(SIGNED_OUT));
    throw error;
  }
  return res.status === 204 ? null : res.json();
}

// 예시 모드: 서버처럼 잠깐 기다렸다가 복사본을 돌려준다
function reply(value, ms = 120) {
  return new Promise((resolve) => setTimeout(() => resolve(value == null ? value : structuredClone(value)), ms));
}

// 종일 일정(날짜만)은 그날 0시~다음 날 0시로 바꿔서 화면이 한 가지 모양만 다루게 한다.
// 끝도 날짜만이면 그날 0시까지(ICS처럼 끝 날짜는 빼고 센다).
export function normalizeEvent(ev) {
  if (!isDateOnly(ev.start)) return ev;
  const start = dayStartKst(ev.start);
  const end = isDateOnly(ev.end) ? dayStartKst(ev.end) : addDays(start, 1);
  return { ...ev, start: toKstIso(start), end: toKstIso(end > start ? end : addDays(start, 1)), all_day: true };
}

// 팝업 칸(날짜·시각) → 일정의 시작·끝. 서버(3_memo_popup.js toStartEnd)와 같은 규칙
export function popupToEvent(f) {
  if (f.time === '?' || !f.time) return { start: f.date, end: null };
  const start = `${f.date}T${f.time}:00+09:00`;
  // 끝을 모르면 1시간(11-13, 서버 AI toStartEnd와 같은 규칙)
  const end = f.end_time && f.end_time !== '?' && f.end_time > f.time ? `${f.date}T${f.end_time}:00+09:00` : endOrHour(start, null);
  return { start, end };
}

/* ── 1_login (서버 세션, worker/1_login.js) ── */

export const LOGIN_URL = `${BASE}/api/login?next=/`;

// 실패해서 돌아오면 주소에 ?login_error=denied|state|google|email|config|db_limit|server
// (뒤 둘은 로그인 중 서버 저장소가 실패한 것 — db_limit = 무료 하루 한도, 한국 09:00에 풀림. 서버 쪽지 11-12 1104)
export function loginErrorText(code) {
  if (!code) return null;
  if (code === 'denied') return '구글 로그인을 그만뒀어요. 다시 해 주세요';
  if (code === 'config') return '로그인 준비가 아직 안 됐어요(서버 설정). 잠시 뒤에 다시 해 주세요';
  if (code === 'db_limit') return DB_LIMIT_TEXT;
  if (code === 'server') return '서버에 잠깐 문제가 있어요. 잠시 뒤에 다시 해 주세요';
  return '로그인하지 못했어요. 다시 해 주세요';
}

// 첫 설정을 건너뛰었는지는 이 기기에만 적어 둔다(서버는 학과·학년이 비면 needsSetup = true)
const skipKey = (id) => `tachyon.setup-skipped.${id}`;
function skipped(id) {
  try {
    return localStorage.getItem(skipKey(id)) === '1';
  } catch {
    return false;
  }
}
export function markSetupSkipped(id) {
  if (ex) {
    ex.user.setup_done = true; // 예시 모드는 기기에 남기지 않는다
    return;
  }
  try {
    localStorage.setItem(skipKey(id), '1');
  } catch {
    /* 저장 못 해도 다음에 첫 설정이 한 번 더 뜰 뿐이다 */
  }
}

// → { id, email, name, dept, year, setup_done }
export async function getMe() {
  if (ex) return reply(ex.user);
  const { user, needsSetup } = await call('GET', '/api/login/me');
  return { ...user, setup_done: !needsSetup || skipped(user.id) };
}

export function logout() {
  if (ex) {
    ex = null;
    return reply(null);
  }
  return call('POST', '/api/login/logout');
}

// 학과·학년 저장(서버는 둘 다 있어야 받는다)
// 계정 지우기(서버 1_login.js): { confirm: true }가 있어야 지운다. 내 자료를 모두 지우고 로그인 쿠키도 지운다.
// 예시 모드는 아무것도 보내지 않고 예시만 끝낸다.
export async function deleteAccount() {
  if (ex) {
    ex = null;
    return { ok: true, example: true };
  }
  return call('DELETE', '/api/login/me', { confirm: true });
}

export async function saveProfile({ dept, year }) {
  if (ex) {
    Object.assign(ex.user, { dept, year, setup_done: true });
    return reply(ex.user);
  }
  const { user } = await call('PUT', '/api/login/me', { dept, year });
  return { ...user, setup_done: true };
}

/* ── 2_collect_ics (서버 세션, worker/2_collect_ics.js): 캘린더 주소 ── */

// → [{ kind, set: false } | { kind, set: true, hint: 'myetl.snu.ac.kr/…a1b2', count, okAt, triedAt, error, stopped }]
// 주소 원문은 돌려받지 않는다. stopped면 주소가 죽어서 수집을 멈춘 것(error에 '다시 붙여 주세요' 문장).
export async function getFeeds() {
  if (ex) return reply(ex.feeds);
  return (await call('GET', '/api/feeds')).feeds;
}

// urls: { etl, google, apple } 가운데 바꿀 것만. 값이 null이면 그 주소를 지운다.
// 서버가 붙이자마자 한 번 받아 보고 칸마다 결과를 돌려준다 → { results, feeds }
//   results[] = { kind, ok, saved, tasks, events, count, error, removed }
//   saved: false면 저장 안 됨(모양이 틀리거나 이미 안 열리는 주소) → error를 칸 아래에 그대로 보인다.
export async function saveFeeds(urls) {
  if (ex) {
    // 예시 모드는 주소를 어디에도 보내거나 남기지 않는다
    ex.feeds = ex.feeds.map((f) => (f.kind in urls ? (urls[f.kind] ? { kind: f.kind, set: true, hint: '예시라 저장 안 함', count: null, error: null } : { kind: f.kind, set: false }) : f));
    const results = Object.keys(urls).map((kind) => (urls[kind] ? { kind, ok: true, saved: true, example: true } : { kind, ok: true, saved: false, removed: true }));
    return reply({ results, feeds: ex.feeds }, 400);
  }
  const { results, feeds } = await call('PUT', '/api/feeds', urls);
  return { results, feeds };
}

// 저장된 주소를 지금 다시 받는다(멈춘 주소도 한 번 더). → { results, feeds }
// 안드로이드 앱이 읽은 폰 캘린더 일정을 통째로 보낸다(native.js). → { count, same }
export const sendDeviceEvents = (events) => call('POST', '/api/feeds/device', { events });

export async function collectFeeds() {
  if (ex) return reply({ results: ex.feeds.filter((f) => f.set).map((f) => ({ kind: f.kind, ok: true, example: true })), feeds: ex.feeds }, 400);
  const { results, feeds } = await call('POST', '/api/feeds/collect');
  return { results, feeds };
}

/* ── 7_items (서버 세션, worker/7_items.js): 할 일·일정 읽기·고치기 ── */

// eTL·구글·애플·폰 캘린더에서 온 것은 그 캘린더가 원본이다.
// 일정: 고치면 서버가 고친 사본(새 id, edited 1)을 넣고 원본을 가린다(Tachyon에서만 바뀜). 지우기는 409.
// 할 일: 제목·마감 고치기와 지우기는 409, done·minutes·ready만 된다.
export const FEED_SOURCES = ['etl', 'google', 'apple', 'naver', 'device']; // device = 앱이 읽은 폰 캘린더, naver = 네이버 캘린더(CalDAV)
export const fromFeed = (item) => FEED_SOURCES.includes(item.source);

// 그 주(월요일 0시부터 7일)의 일정. from·to는 한국 날짜, to는 빼고 센다.
export async function getWeekEvents(start) {
  if (ex) {
    const from = new Date(start);
    const to = addDays(start, 7);
    return reply({ events: ex.events.map(normalizeEvent).filter((e) => new Date(e.start) < to && new Date(e.end || e.start) >= from) });
  }
  const day = (d) => toKstIso(d).slice(0, 10);
  const res = await call('GET', `/api/events?from=${day(start)}&to=${day(addDays(start, 7))}`);
  return { events: res.events.map(normalizeEvent) };
}

// 아무 기간의 일정(from 0시부터 days일, 서버는 한 번에 62일까지). 달력 월 보기·밀도(오늘부터 6주)가 쓴다(11-11 컨셉)
export async function getEvents(from, days) {
  const to = addDays(from, days);
  if (ex) {
    const start = new Date(from);
    return reply({ events: ex.events.map(normalizeEvent).filter((e) => new Date(e.start) < to && new Date(e.end || e.start) >= start) });
  }
  const day = (d) => toKstIso(d).slice(0, 10);
  const res = await call('GET', `/api/events?from=${day(from)}&to=${day(to)}`);
  return { events: res.events.map(normalizeEvent) };
}

// 날마다 몫(AI 4_night planDays, 11-11): 밀도 고리·'고르게' 줄을 서버 셈 하나로 그린다. 예시 모드는 화면 셈(density.js)
// → { ok, awake: { from, minutes }, daily_min, guessed, warning, days: [{ date, event_min, room_min, task_min, extra_min, over_min, cram_min, items: [{ task_id, min }] }] }
// 아침 브리핑 카드(AI 4_night): { briefing: { date, made_at, by, events, top3, postpone, warning, today, new_tasks } }. 예시 모드는 null(화면이 할 일 순서로 만든다)
export function getBriefing() {
  if (ex) return Promise.resolve(null);
  return call('GET', '/api/briefing');
}

export function getDailyPlan(days = 42) {
  if (ex) return Promise.resolve(null);
  return call('GET', `/api/briefing/plan?days=${days}`);
}

export function setTaskDone(id, done) {
  if (ex) {
    const task = ex.tasks.find((t) => t.id === id);
    if (task) task.done = done ? 1 : 0;
    return reply(task);
  }
  return call('PATCH', `/api/tasks/${encodeURIComponent(id)}`, { done: done ? 1 : 0 });
}

// 눌러서 고치기: fields = { title, due, minutes, ready } 가운데 바꾼 것 (캘린더에서 온 할 일은 minutes·ready만)
export function updateTask(id, fields) {
  if (ex) {
    const task = ex.tasks.find((t) => t.id === id);
    Object.assign(task, fields);
    return reply(task);
  }
  return call('PATCH', `/api/tasks/${encodeURIComponent(id)}`, fields);
}

// 눌러서 고치기: fields = { important, title, start, end, place } 가운데 바꾼 것 (시각을 모르면 start는 날짜만, end는 null)
// 캘린더에서 온 일정은 돌아온 event의 id가 새 것이다 → 목록을 다시 부른다
export function updateEvent(id, fields) {
  if (ex) {
    const event = ex.events.find((e) => e.id === id);
    Object.assign(event, fields);
    return reply(event);
  }
  return call('PATCH', `/api/events/${encodeURIComponent(id)}`, fields);
}

// 달력 빈 칸을 눌러 바로 넣기(11-14): { title, start, end?, place? } → { event }. 끝이 없으면 서버가 1시간
export function createEvent(fields) {
  if (ex) {
    const event = { id: Date.now(), place: null, end: null, ...fields, source: 'memo', important: 0 };
    ex.events.push(event);
    return reply({ event });
  }
  return call('POST', '/api/events', fields);
}

// 지우기: 메모·시간표에서 온 것과 고친 사본만 된다(캘린더에서 온 것은 서버가 409)
export function deleteTask(id) {
  if (ex) {
    ex.tasks = ex.tasks.filter((t) => t.id !== id);
    return reply({ ok: true });
  }
  return call('DELETE', `/api/tasks/${encodeURIComponent(id)}`);
}

export function deleteEvent(id) {
  if (ex) {
    ex.events = ex.events.filter((e) => e.id !== id);
    ex.memos = ex.memos.map((m) => (m.event_id === id ? { ...m, event_id: null } : m));
    return reply({ ok: true });
  }
  return call('DELETE', `/api/events/${encodeURIComponent(id)}`);
}

/* ── 8_calendar_feed (서버 세션, worker/8_calendar_feed.js): 폰 달력에서 구독하는 Tachyon 주소 ── */

// → { url: 'https://…/api/calendar/<id>.<서명>.ics', webcal: 'webcal://…' }. 사람마다 다른 비밀 주소라 어디에도 남기지 않는다.
export function getCalendarFeed() {
  if (ex) return reply({ url: 'https://example.com/api/calendar/0.example.ics', webcal: 'webcal://example.com/api/calendar/0.example.ics', example: true });
  return call('GET', '/api/calendar');
}

// 안드로이드 앱이 폰 'Tachyon' 캘린더에 쓸 목록(구독 주소와 같은 줄, ms 시각) → { items: [{ key, title, start, end, allDay, place }] } (native.js)
export function getCalendarItems() {
  if (ex) return reply({ items: [] });
  return call('GET', '/api/calendar/items');
}

// 구글 캘린더 웹에서 '이 캘린더를 추가할까요?'를 바로 띄우는 주소(PC에서 주소 붙여 넣기 대신 한 번 누르기)
export const googleSubscribeLink = (webcal) => `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal)}`;

// 끝나지 않은 할 일 전체를 여유 적은 순(AI 세션 4_night.js의 순서)으로 + 몰린 주 경고 한 줄 → { tasks, warning }
// 대시보드 '할 일 3개'는 앞 3개, 메뉴의 '할 일 전체'와 달력의 마감 줄도 같은 목록을 쓴다.
// 예시 모드는 1단계 규칙(마감 가까운 순, 이번 주 마감 4개부터 경고)으로 흉내 낸다.
export function getTasks(now = new Date()) {
  if (ex) {
    const tasks = topThree(ex.tasks, Infinity);
    const due = dueThisWeek(ex.tasks, weekStart(now));
    return reply({ tasks, warning: due >= CROWDED ? `이번 주 마감 ${due}개 몰림` : null });
  }
  return call('GET', '/api/tasks');
}

// 끝낸 할 일(끝낸 지 얼마 안 된 순). done_at = 끝낸 시각(기록이 없으면 null) → { tasks }
export function getDoneTasks() {
  if (ex) return reply({ tasks: ex.tasks.filter((t) => t.done).map((t) => ({ done_at: null, ...t })) });
  return call('GET', '/api/tasks?done=1&limit=100');
}

/* ── 3_memo_popup (AI 세션, worker/3_memo_popup.js) ── */

// 최근 메모 50개, 오래된 것부터. event_id가 있으면 팝업으로 일정에 넣은 메모
export function listMemos() {
  return ex ? reply({ memos: ex.memos }) : call('GET', '/api/memo?limit=50');
}

// 메모 모두 지우기(11-15 사람) → { ok, deleted }. 메모로 만든 일정·할 일은 남는다
export function clearMemos() {
  if (ex) {
    const deleted = ex.memos.length;
    ex.memos = [];
    return reply({ ok: true, deleted });
  }
  return call('DELETE', '/api/memo', { confirm: true });
}

// 메모 하나를 보내고, 일정처럼 보이면 popup { title, date, time, end_time, place, by },
// 할 일처럼 보이면 popup { kind: 'task', title, date, time, minutes?, also?, by }(마감, 모르면 '?')를 받는다. AI 때문에 2.5초까지 걸릴 수 있다.
export function sendMemo(text) {
  if (ex) {
    const memo = { id: Date.now(), text, created_at: toKstIso(new Date()), handled: 0, event_id: null };
    ex.memos.push(memo);
    return reply({ memo, popup: examplePopup(text) }, 450);
  }
  return call('POST', '/api/memo', { text });
}

// 팝업 저장. fields = { title, date, time, end_time, place }('?' 그대로), suggested = 받았던 popup.
// 할 일 팝업은 fields = { kind: 'task', title, date, time, minutes, also } → { task, tasks }(마감 날짜만 있으면 그날 23:59).
// also = 같은 메모의 나머지 할 일 [{ title, minutes }](11-12), tasks = 넣은 할 일 모두.
// 고쳤는지는 서버가 suggested와 견줘 log에 남긴다(팝업 정확도).
// changeId = 옮길 일정(popup.change.id). 주면 서버가 그 일정을 달력에서 가린다.
// weekly = 매주 되풀이(popup.repeat가 있고 켜 둠). 서버가 학기 끝까지 주마다 넣고 { event(첫 주), repeat: 넣은 횟수 }를 준다.
export function savePopup(memoId, fields, suggested, changeId, weekly) {
  if (ex && fields.kind === 'task') {
    const due = fields.date && fields.date !== '?' ? `${fields.date}T${fields.time && fields.time !== '?' ? fields.time : '23:59'}:00+09:00` : null;
    const tasks = [fields, ...(fields.also ?? [])].map((t, i) => ({ id: Date.now() + i, title: t.title, due, minutes: t.minutes ?? null, ready: 1, done: 0, source: 'memo' }));
    ex.tasks.push(...tasks);
    const memo = ex.memos.find((m) => m.id === memoId);
    if (memo) Object.assign(memo, { handled: 1, task_id: tasks[0].id });
    return reply({ task: tasks[0], tasks });
  }
  if (ex) {
    const event = { id: Date.now(), title: fields.title, ...popupToEvent(fields), place: fields.place === '?' ? null : fields.place, source: 'memo', important: 0 };
    ex.events.push(event);
    const memo = ex.memos.find((m) => m.id === memoId);
    if (memo) Object.assign(memo, { handled: 1, event_id: event.id });
    // 일정 전에 할 일(prep): 마감 = 일정 시작(종일이면 전날 23:59) — 서버 3_memo_popup.js와 같은 셈
    const due = event.start.length > 10 ? event.start : new Date(Date.parse(`${event.start}T23:59:00+09:00`) - 86400000).toISOString();
    const tasks = (fields.prep ?? []).map((t, i) => ({ id: Date.now() + 1 + i, title: t.title, due, minutes: t.minutes ?? null, ready: 1, done: 0, source: 'memo' }));
    ex.tasks.push(...tasks);
    return reply({ event, ...(tasks.length ? { tasks } : {}) });
  }
  return call('POST', `/api/memo/${encodeURIComponent(memoId)}/save`, { ...fields, suggested, change_id: changeId, repeat: weekly || undefined });
}

// 지금 정리(11-13 사람 피드백 10 · 15, AI 0ea4fff): 밤 정리를 기다리지 않고 지금. AI 한 번이라 몇 초~수십 초.
// 정리 보기 → { plan: { memos: [{ id, text, task, title, due, minutes, ready, answered }], tasks: [{ id, title, due, minutes, ready }] }, summary } — 아무것도 안 바뀐다
// 이대로 정리하기(뺀 줄은 안 보냄) → { briefing, applied, summary }. 429 · 502 · 503은 서버 문장 그대로
export function tidyNow() {
  if (ex) return reply(exampleTidy(ex), 700);
  return call('POST', '/api/briefing/now', {});
}
export function tidyApply(plan) {
  if (ex) return reply(applyExampleTidy(ex, plan));
  return call('POST', '/api/briefing/now', { apply: plan });
}

// 팝업 취소: 메모는 메모로 남는다. 일정 팝업이면 밤 정리가 다시 읽고, 할 일 팝업(kind 'task')이면 메모로만 둔다
export function cancelPopup(memoId, kind) {
  if (ex) return reply({ ok: true });
  return call('POST', `/api/memo/${encodeURIComponent(memoId)}/cancel`, kind === 'task' ? { kind } : undefined);
}

/* ── 6_feedback (서버 세션) ── */

// 'Android · 홈 화면 앱 · 412×915' 처럼 짧게. 이름·이메일은 넣지 않는다.
export function deviceLabel() {
  const ua = navigator.userAgent;
  const os = /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : '기타';
  const app = window.Capacitor?.isNativePlatform?.() ? '앱' : window.matchMedia('(display-mode: standalone)').matches ? '홈 화면 앱' : '브라우저';
  return `${os} · ${app} · ${window.innerWidth}×${window.innerHeight}`;
}

// 서버(6_feedback.js)가 시각·기기(User-Agent)를 붙인다. 화면은 홈 화면 앱인지·화면 크기를 화면 이름 뒤에 붙인다.
// kind: 'bug'(버그) · 'pain'(불편) · 'idea'(추가) → { ok, issue, url }
export function sendFeedback({ kind, text, screen }) {
  if (ex) return reply({ ok: true, example: true }, 300);
  return call('POST', '/api/feedback', { kind, text, screen: `${screen} · ${deviceLabel()}` });
}

// 화면 오류 자동 보고 → { ok, issue, duplicate }. 같은 오류는 서버도 이슈 하나로 묶는다.
export function reportError({ message, stack, screen }) {
  if (ex) return Promise.resolve(null);
  return call('POST', '/api/feedback/error', { message, stack, screen: `${screen} · ${deviceLabel()}` });
}

/* ── 9_etl (컨셉 세션, worker/9_etl.js) ── */
// eTL API(학생 개인 액세스 토큰, 선택). 토큰은 서버가 잠가 두고 다시 돌려주지 않는다.
// 상태 { ok, connected, last_ok_at, last_error, dead, counts: { notice, file } }. 서버에 표가 아직 없으면 503(준비 중).
export function getEtl() {
  if (ex) return reply({ ok: true, ...ex.etl.status });
  return call('GET', '/api/etl');
}

// 붙여 넣은 토큰 → eTL이 받으면 저장하고 바로 한 번 받는다 → 상태 + result { courses, tasks, notices, files, calendar, ai }
export function connectEtl(token) {
  if (ex) return Promise.reject(new Error('예시에서는 eTL을 연결하지 않아요'));
  return call('PUT', '/api/etl', { token });
}

export function disconnectEtl() {
  if (ex) {
    ex.etl.status = { connected: false };
    return reply({ ok: true, connected: false });
  }
  return call('DELETE', '/api/etl');
}

// 지금 다시 받기(1분 안에 받았으면 건너뜀) → 상태 + result
export function collectEtl() {
  if (ex) return reply({ ok: true, result: { ok: true, recent: true }, ...ex.etl.status });
  return call('POST', '/api/etl/collect');
}

// 강의자료·공지 목록(새 것 먼저) → { notices: [{ id, course, title, url, posted_at, tag }], files: [...] }
export function getEtlItems() {
  if (ex) return reply({ ok: true, notices: ex.etl.notices, files: ex.etl.files });
  return call('GET', '/api/etl/items');
}

// TT Wizard 시간표 링크(11-11 컨셉, worker/ttwizard.js). 살펴보기 → { sem, title, classes: [{ title, found, custom, times: [{ day, start, end, place }] }], from, until, replaces }
// 넣기 → { saved, classes }. 내보내기 → { link, count, matched }(TT Wizard에서 여는 주소)
export function ttwizardPreview(link) {
  if (ex) return Promise.reject(new Error('예시에서는 시간표를 넣지 않아요. 로그인해서 해 주세요'));
  return call('POST', '/api/etl/ttwizard', { link });
}

export function ttwizardSave(link) {
  if (ex) return Promise.reject(new Error('예시에서는 시간표를 넣지 않아요. 로그인해서 해 주세요'));
  return call('POST', '/api/etl/ttwizard', { link, save: true });
}

export function ttwizardExport() {
  if (ex) return Promise.reject(new Error('예시에서는 TT Wizard로 보내지 않아요. 로그인해서 해 주세요'));
  return call('GET', '/api/etl/ttwizard');
}

// TT Wizard의 'Tachyon으로 보내기'가 여는 주소(…/#ttw=<글>)를 처음 열 때 받아 둔다(로그인으로 나갔다 와도 남게 sessionStorage)
const TTW_KEY = 'tachyon_ttw';
export function catchTtwLink(loc = window.location) {
  const m = /#ttw=([zj][A-Za-z0-9_-]+)/.exec(loc.hash || '');
  if (!m) return;
  try {
    sessionStorage.setItem(TTW_KEY, m[1]);
  } catch {
    /* 저장이 막힌 브라우저면 이번에만 */
  }
  window.history.replaceState(null, '', loc.pathname + loc.search); // 주소창에서 지운다
}
export function takeTtwLink() {
  try {
    const code = sessionStorage.getItem(TTW_KEY);
    sessionStorage.removeItem(TTW_KEY);
    return code ? `#ttw=${code}` : null;
  } catch {
    return null;
  }
}

/* ── 10_together (서버 세션, worker/10_together.js): 친구 · 그룹 · 모임 시간표(when2meet 모양) ──
   남에게는 빈/바쁨만 온다(일정 이름 없음). 친구·그룹은 초대 링크로만 맺는다. 원격에 표가 없으면 503 '같이 쓰기를 준비 중이에요…' */
const exT = (fn, ms = 200) => {
  if (!ex.together) ex.together = makeTogether(new Date());
  try {
    return reply(fn(ex.together), ms);
  } catch (err) {
    return Promise.reject(err);
  }
};
const exLink = () => ({ ok: true, code: 'example', url: `${window.location.origin}/?join=example`, expiresAt: toKstIso(addDays(new Date(), 7)), example: true });

export const getTogether = () => (ex ? exT(summary) : call('GET', '/api/together'));
export const inviteFriend = () => (ex ? exT(exLink) : call('POST', '/api/together/invite'));
export const previewJoin = (code) =>
  ex ? Promise.reject(Object.assign(new Error('예시에서는 초대 링크를 받을 수 없어요'), { status: 400 })) : call('GET', `/api/together/join/${encodeURIComponent(code)}`);
export const acceptJoin = (code) => call('POST', '/api/together/join', { code });
export const removeFriend = (id) =>
  ex ? exT((t) => ((t.friends = t.friends.filter((f) => f.id !== id)), { ok: true })) : call('DELETE', `/api/together/friends/${encodeURIComponent(id)}`);
export const createGroup = (name) =>
  ex
    ? exT((t) => {
        const group = { id: t.nextId++, name, owner: true, members: [1] };
        t.groups.push(group);
        return { ok: true, group: { id: group.id, name, owner: true, members: 1 } };
      })
    : call('POST', '/api/together/groups', { name });
export const getGroup = (id) => (ex ? exT((t) => groupDetail(t, id)) : call('GET', `/api/together/groups/${encodeURIComponent(id)}`));
// 내 달력에 겹쳐 그릴 '다 같이 빈 시간'(11-13, 서버 3830ac1): from = 'YYYY-MM-DD'부터 days일, 08:00~24:00, 30분 칸
// → { group, members, known, slots: [{ start, free }], together: [{ start, end }] } — 사람 수만 온다(이름·일정 없음)
export const getGroupFree = (id, from, days = 7) =>
  ex
    ? exT((t) => groupFree(t, id, { from, days, mine: ex.events }))
    : call('GET', `/api/together/groups/${encodeURIComponent(id)}/free?from=${encodeURIComponent(from)}&days=${days}`);
export const renameGroup = (id, name) =>
  ex ? exT((t) => ((t.groups.find((g) => g.id === id).name = name), { ok: true })) : call('PATCH', `/api/together/groups/${encodeURIComponent(id)}`, { name });
export const inviteToGroup = (id) => (ex ? exT(exLink) : call('POST', `/api/together/groups/${encodeURIComponent(id)}/invite`));
export const addFriendToGroup = (id, friendId) =>
  ex
    ? exT((t) => {
        const g = t.groups.find((x) => x.id === id);
        if (!g.members.includes(friendId)) g.members.push(friendId);
        return { ok: true };
      })
    : call('POST', `/api/together/groups/${encodeURIComponent(id)}/members`, { friendId });
export const leaveGroup = (id) =>
  ex ? exT((t) => ((t.groups = t.groups.filter((g) => g.id !== id)), { ok: true })) : call('DELETE', `/api/together/groups/${encodeURIComponent(id)}/members/me`);
export const removeMember = (id, userId) =>
  ex
    ? exT((t) => {
        const g = t.groups.find((x) => x.id === id);
        g.members = g.members.filter((m) => m !== userId);
        return { ok: true };
      })
    : call('DELETE', `/api/together/groups/${encodeURIComponent(id)}/members/${encodeURIComponent(userId)}`);
// body = { title, from, to, dayStart, dayEnd, slot, length }
export const createMeet = (groupId, body) =>
  ex
    ? exT((t) => {
        const meet = { id: t.nextId++, groupId, createdBy: 1, ...body };
        t.meets.push(meet);
        return { ok: true, meet: { id: meet.id } };
      })
    : call('POST', `/api/together/groups/${encodeURIComponent(groupId)}/meets`, body);
export const getMeet = (id) => (ex ? exT((t) => meetView(t, id)) : call('GET', `/api/together/meets/${encodeURIComponent(id)}`));
// marks = [{ start, state: 'free' | 'busy' | null }] → 새 표 전체
export const markMeet = (id, marks) =>
  ex
    ? exT((t) => {
        for (const m of marks) {
          const key = `${id}|${m.start}`;
          if (m.state) t.marks.set(key, m.state);
          else t.marks.delete(key);
        }
        return meetView(t, id);
      }, 60)
    : call('PUT', `/api/together/meets/${encodeURIComponent(id)}/marks`, { marks });
export const deleteMeet = (id) =>
  ex ? exT((t) => ((t.meets = t.meets.filter((m) => m.id !== id)), { ok: true })) : call('DELETE', `/api/together/meets/${encodeURIComponent(id)}`);

// 초대 링크(…/?join=<code>)는 로그인 전에 받아 두었다가 대시보드에서 연다(TT Wizard 링크와 같은 방식)
const JOIN_KEY = 'tachyon.join';
export function catchJoinLink(loc = window.location) {
  const params = new URLSearchParams(loc.search);
  const code = params.get('join');
  if (!code || !/^[A-Za-z0-9_-]{4,64}$/.test(code)) return;
  try {
    sessionStorage.setItem(JOIN_KEY, code);
  } catch {
    /* 저장이 막힌 브라우저면 이번에만 */
  }
  params.delete('join');
  const rest = params.toString();
  window.history.replaceState(null, '', loc.pathname + (rest ? `?${rest}` : '') + loc.hash);
}
export function takeJoinLink() {
  try {
    const code = sessionStorage.getItem(JOIN_KEY);
    sessionStorage.removeItem(JOIN_KEY);
    return code;
  } catch {
    return null;
  }
}
