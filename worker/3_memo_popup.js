// 3. 메모(나와의 채팅) → 즉시 팝업
//
// 흐름: 메모를 저장한다 → 날짜·시각 말이 있으면(정규식) 빠른 모델에게 '일정인지·이름·장소'를 묻는다
//       → 팝업 후보(이름·날짜·시각·장소, 모르면 '?')를 돌려준다 → 사용자가 저장/고치기/취소 → events.
// 날짜·시각은 코드가 먼저 계산한다(위험 확인 '팝업 1초'의 대처). AI 답이 늦거나 실패하면 규칙만으로 팝업을 만든다.
// 할 일 메모(11-10 사람 "할 일만 딱 적으면 메모가 안 생김")는 '할 일로 넣을까요?' 팝업(popup.kind = 'task', 마감 = 날짜·시각 말).
//   날짜·시각 말이 없는 메모도 AI가 일정·할 일·그냥 메모를 가린다(지난 일은 AI를 부르지 않음). AI가 없거나 실패하면 규칙(looksLikeTodo).
// 그냥 메모(생각·지난 일)와 팝업을 '취소'한 일정 메모는 메모로 남고, 밤 정리(4_night.js)가 읽는다. 할 일 팝업을 취소하면 밤 정리도 할 일로 만들지 않는다.
// 아는 일정으로 채우기(lib/known.js, AI 없이): '공수2 휴강 16일' → 내 '공학수학 2' 수업 시각·장소(popup.from),
//       '12일 늦은 밤에 회의'처럼 시간대만 쓰면 그 시간대의 비어 있는 시간(popup.free), '운동 2시간'처럼 길이를 쓰면 그 길이로(안 쓰면 1시간),
//       '… 16일로 변경' → 옮길 일정(popup.change). 저장 때 change_id를 주면 새 일정을 넣고 옛 일정은 가린다(events.moved_to).
// 매주 되풀이(11-11 사람 "매주 목요일마다 하는 걸로 메모했는데"): '매주 …'·'목요일마다' → popup.repeat = { until: 학기 끝 }.
//       저장 때 repeat: true를 주면 그날부터 학기 끝까지 같은 요일·시각으로 주마다 한 줄씩 넣는다(ext_id 'memo:<id>', 'memo:<id>:w1' …).
//
// 주소 (worker/index.js가 /api/memo* 를 여기로 보낸다. 응답은 모두 JSON)
//   POST   /api/memo              { text }                    → { memo, popup }   popup은 일정·할 일이 아니면 null
//   GET    /api/memo?before=&limit=                           → { memos }         오래된 것부터, event_id·task_id = 이 메모로 만든 일정·할 일
//   POST   /api/memo/:id/save     { title, date, time, end_time, place, suggested, change_id, repeat } → { event, repeat? }
//                                 suggested = 받았던 popup 그대로(고쳤는지 재려고). 모르는 칸은 '?'
//                                 change_id = 옮길 일정(popup.change.id). 주면 그 일정은 달력에서 가려진다
//                                 repeat = true면 매주 넣는다(학기 끝까지). 응답의 repeat = 넣은 횟수, event = 첫 주 일정
//                                 prep = [{ title, minutes }] 일정 전에 끝낼 할 일(11-14) → 마감 = 일정 시작인 할 일로, 응답 tasks
//                                 할 일: { kind: 'task', title, date, time, minutes, also, suggested } → { task, tasks }  (마감 날짜만 있으면 그날 23:59, 없으면 마감 없음)
//                                 also = [{ title, minutes }] 같은 메모의 나머지 할 일(마감은 같게, ext_id 'memo:<id>:2' …), tasks = 넣은 할 일 모두
//   POST   /api/memo/:id/cancel   { kind? }                   → { ok }            일정 팝업 취소: 메모는 남아서 밤 정리가 읽는다. 할 일 팝업 취소: 메모로만(handled = 1)
//   DELETE /api/memo/:id                                      → { ok }
//   DELETE /api/memo           { confirm: true }           → { ok, deleted }   메모 모두 지우기(11-15 사람). 메모로 만든 일정·할 일은 그대로
//
// 할 일 popup 모양: { kind: "task", title, date: 마감 날짜 또는 "?", time: 마감 시각 또는 "?", minutes?: 어림한 분, also?: [{ title, minutes }], by }
//   (11-12 사람 "여러 개 한 메모에 적으면 분리해서 넣게") 이름 오타는 AI가 고친다. AI가 없으면 쉼표로만 나눈다
// 일정 popup 모양: { title, date: "2026-11-10", time: "15:00", end_time: "?", place: "301동", by: "ai" | "rule",
//               from: "공학수학 2"(시각·장소를 가져온 내 일정, 없으면 없음), free: "늦은 밤"(이 시간대의 빈 시간을 골랐음, 없으면 없음), change: { id, title, start }(옮길 일정, 없으면 없음),
//               repeat: { until: "2026-12-14" }(매주 되풀이 메모, 없으면 없음) }
// 표: memos(쓰기·읽기), events·tasks(source='memo', ext_id='memo:<메모 id>' — 밤 정리와 같은 이름), log(popup_save·popup_edit·popup_cancel·llm·llm_fail)

import { askJson, usageDetail } from "./llm.js";
import { SYSTEM, SCHEMA, userMessage } from "./prompts/memo_popup.js";
import { useKnown, suggestFree, lengthOf, useLength } from "./lib/known.js";

export async function handle(request, env, ctx, user) {
  if (!user) return json({ error: "로그인이 필요하다" }, 401);
  const url = new URL(request.url);
  const [, , idPart, action] = url.pathname.split("/").filter(Boolean); // api / memo / :id / :action
  const id = idPart ? Number(idPart) : null;
  if (idPart && !Number.isInteger(id)) return json({ error: "없는 주소" }, 404);

  if (!id && request.method === "POST") return addMemo(request, env, ctx, user);
  if (!id && request.method === "GET") return listMemos(url, env, user);
  if (id && action === "save" && request.method === "POST") return savePopup(request, env, ctx, user, id);
  if (id && action === "cancel" && request.method === "POST") return cancelPopup(request, env, ctx, user, id);
  if (id && !action && request.method === "DELETE") return deleteMemo(env, user, id);
  if (!id && request.method === "DELETE") return deleteAllMemos(request, env, user);
  return json({ error: "없는 주소" }, 404);
}

// ── 주소별 처리 ──────────────────────────────────────────────

async function addMemo(request, env, ctx, user) {
  const body = await request.json().catch(() => ({}));
  const text = String(body.text ?? "").trim();
  if (!text) return json({ error: "메모가 비었다" }, 400);
  if (text.length > 1000) return json({ error: "메모는 1000자까지" }, 400);

  const now = new Date();
  // 저장과 팝업 만들기를 함께 돌려서 기다리는 시간을 줄인다.
  const [memo, popup] = await Promise.all([
    env.DB.prepare("INSERT INTO memos (user_id, text, created_at) VALUES (?, ?, ?) RETURNING id, text, created_at, handled")
      .bind(user.id, text, isoKst(now))
      .first(),
    suggestEvent(env, text, now, { ctx, userId: user.id }),
  ]);
  return json({ memo, popup });
}

async function listMemos(url, env, user) {
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 50, 1), 200);
  const before = Number(url.searchParams.get("before")) || null;
  const { results } = await env.DB.prepare(
    `SELECT m.id, m.text, m.created_at, m.handled, e.id AS event_id, t.id AS task_id
       FROM memos m
       LEFT JOIN events e ON e.user_id = m.user_id AND e.source = 'memo' AND e.ext_id = 'memo:' || m.id
       LEFT JOIN tasks t ON t.user_id = m.user_id AND t.source = 'memo' AND t.ext_id = 'memo:' || m.id
      WHERE m.user_id = ? AND (? IS NULL OR m.id < ?)
      ORDER BY m.id DESC LIMIT ?`,
  )
    .bind(user.id, before, before, limit)
    .all();
  return json({ memos: results.reverse() }); // 채팅처럼 아래가 최신
}

async function savePopup(request, env, ctx, user, memoId) {
  const body = await request.json().catch(() => ({}));
  if (body.kind === "task") return saveTask(body, env, ctx, user, memoId);
  const f = popupFields(body);
  if (!f.title || !f.date) return json({ error: "이름과 날짜는 있어야 한다" }, 400);

  const memo = await env.DB.prepare("SELECT id FROM memos WHERE id = ? AND user_id = ?").bind(memoId, user.id).first();
  if (!memo) return json({ error: "없는 메모" }, 404);

  const changeId = Number.isInteger(body.change_id) ? body.change_id : null;
  // 매주 되풀이(body.repeat): 첫 주는 'memo:<id>'(메모 목록·밤 정리가 찾는 줄), 다음 주부터 'memo:<id>:w1', ':w2' … 학기 끝까지
  // ponytail: 줄을 주마다 따로 만든다(되풀이 규칙 칸 없음) → 묶음 지우기·고치기는 하나씩. 빈 시간 확인은 첫 주만. 불편해지면 events에 묶음 칸을 둔다
  const weeks = body.repeat === true ? weeksAfter(f.date) : [];
  const insert = (date, extId) => {
    const { start, end } = toStartEnd({ ...f, date });
    return env.DB.prepare(
      `INSERT INTO events (user_id, title, start, "end", place, source, ext_id) VALUES (?, ?, ?, ?, ?, 'memo', ?)
       ON CONFLICT (user_id, source, ext_id) DO UPDATE
         SET title = excluded.title, start = excluded.start, "end" = excluded."end", place = excluded.place
       RETURNING id, title, start, "end", place, source`,
    ).bind(user.id, f.title, start, end, f.place, extId);
  };
  // 일정 전에 끝낼 할 일(body.prep, 11-14 "여행 전 항공권·숙박은 여행까지 할 일"): 마감 = 일정 시작, ext_id 'memo:<id>:p1' …
  const prep = alsoOf(body.prep);
  const prepDue = f.time ? toStartEnd(f).start : `${addDays(f.date, -1)}T23:59:00+09:00`; // 하루 종일 일정이면 전날 밤까지
  const prepInsert = (t, i) =>
    env.DB.prepare(
      `INSERT INTO tasks (user_id, title, due, minutes, source, ext_id) VALUES (?, ?, ?, ?, 'memo', ?)
       ON CONFLICT (user_id, source, ext_id) DO UPDATE SET title = excluded.title, due = excluded.due, minutes = coalesce(excluded.minutes, tasks.minutes)
       RETURNING id, title, due, minutes, ready, done, source`,
    ).bind(user.id, t.title, prepDue, t.minutes, `memo:${memoId}:p${i + 1}`);
  const [saved, ...rest] = await env.DB.batch([
    insert(f.date, `memo:${memoId}`),
    ...prep.map(prepInsert),
    ...weeks.map((date, i) => insert(date, `memo:${memoId}:w${i + 1}`)),
    env.DB.prepare("UPDATE memos SET handled = 1 WHERE id = ? AND user_id = ?").bind(memoId, user.id),
    // 일정 변경: 옛 일정은 지우지 않고 가린다(캘린더에서 온 것은 못 고친다). 새 일정을 지우면 다시 보인다(7_items.js)
    ...(changeId
      ? [
          env.DB.prepare(
            `UPDATE events SET moved_to = (SELECT id FROM events WHERE user_id = ?1 AND source = 'memo' AND ext_id = ?2)
              WHERE id = ?3 AND user_id = ?1 AND (source != 'memo' OR ext_id != ?2)`,
          ).bind(user.id, `memo:${memoId}`, changeId),
        ]
      : []),
  ]);

  // 측정: 고치지 않고 저장한 비율 = AI(또는 규칙) 정확도
  const edited = body.suggested ? !sameFields(f, popupFields(body.suggested)) : Boolean(body.edited);
  const detail = JSON.stringify({ memo_id: memoId, by: body.suggested?.by ?? null, known: Boolean(body.suggested?.from), moved: Boolean(changeId) });
  background(ctx, writeLog(env, user.id, edited ? "popup_edit" : "popup_save", detail));
  const tasks = rest.slice(0, prep.length).map((r) => r.results[0]);
  return json({ event: saved.results[0], ...(weeks.length ? { repeat: weeks.length + 1 } : {}), ...(tasks.length ? { tasks } : {}) }); // repeat = 넣은 횟수, tasks = 일정 전 할 일
}

/** 할 일 팝업 저장 → tasks(source 'memo', ext_id 'memo:<id>' — 밤 정리가 만드는 것과 같은 줄이라 두 번 생기지 않는다).
 *  같은 메모의 나머지 할 일(also)은 'memo:<id>:2', ':3' …. 걸리는 시간은 팝업의 어림, 없으면 밤 정리가 채운다 */
async function saveTask(body, env, ctx, user, memoId) {
  const f = taskFields(body);
  if (!f.title) return json({ error: "이름은 있어야 한다" }, 400);
  const memo = await env.DB.prepare("SELECT id FROM memos WHERE id = ? AND user_id = ?").bind(memoId, user.id).first();
  if (!memo) return json({ error: "없는 메모" }, 404);
  const due = f.date ? `${f.date}T${f.time ?? "23:59"}:00+09:00` : null;
  const list = [{ title: f.title, minutes: minutesOf(body.minutes) }, ...alsoOf(body.also)];
  const saved = await env.DB.batch([
    ...list.map((t, i) =>
      env.DB.prepare(
        `INSERT INTO tasks (user_id, title, due, minutes, source, ext_id) VALUES (?, ?, ?, ?, 'memo', ?)
         ON CONFLICT (user_id, source, ext_id) DO UPDATE SET title = excluded.title, due = excluded.due, minutes = coalesce(excluded.minutes, tasks.minutes)
         RETURNING id, title, due, minutes, ready, done, source`,
      ).bind(user.id, t.title, due, t.minutes, i ? `memo:${memoId}:${i + 1}` : `memo:${memoId}`),
    ),
    env.DB.prepare("UPDATE memos SET handled = 1 WHERE id = ? AND user_id = ?").bind(memoId, user.id),
  ]);
  const tasks = saved.slice(0, list.length).map((r) => r.results[0]);
  const edited = body.suggested ? !sameTask(f, taskFields(body.suggested)) : Boolean(body.edited);
  const detail = JSON.stringify({ memo_id: memoId, kind: "task", by: body.suggested?.by ?? null, n: tasks.length });
  background(ctx, writeLog(env, user.id, edited ? "popup_edit" : "popup_save", detail));
  return json({ task: tasks[0], tasks });
}

/** 걸리는 분: 5분 단위, 5~480(밤 정리 minutesOf와 같은 모양). 모르면 null */
function minutesOf(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.min(Math.max(Math.round(n / 5) * 5, 5), 480) : null;
}

/** 같은 메모의 나머지 할 일: [{ title, minutes }] 이름 있는 것만, 9개까지 */
function alsoOf(v) {
  if (!Array.isArray(v)) return [];
  return v.map((t) => ({ title: clean(t?.title), minutes: minutesOf(t?.minutes) })).filter((t) => t.title).slice(0, 9);
}

async function cancelPopup(request, env, ctx, user, memoId) {
  const body = await request.json().catch(() => ({}));
  const memo = await env.DB.prepare("SELECT id FROM memos WHERE id = ? AND user_id = ?").bind(memoId, user.id).first();
  if (!memo) return json({ error: "없는 메모" }, 404);
  // 할 일로 넣지 않겠다고 했으니 밤 정리도 할 일로 만들지 않는다(메모로만 남음)
  if (body.kind === "task") await env.DB.prepare("UPDATE memos SET handled = 1 WHERE id = ? AND user_id = ?").bind(memoId, user.id).run();
  background(ctx, writeLog(env, user.id, "popup_cancel", JSON.stringify({ memo_id: memoId, kind: body.kind === "task" ? "task" : "event" })));
  return json({ ok: true });
}

async function deleteMemo(env, user, memoId) {
  const r = await env.DB.prepare("DELETE FROM memos WHERE id = ? AND user_id = ?").bind(memoId, user.id).run();
  return r.meta.changes ? json({ ok: true }) : json({ error: "없는 메모" }, 404);
}

async function deleteAllMemos(request, env, user) {
  const body = await request.json().catch(() => null);
  if (!body || body.confirm !== true) return json({ error: "정말 지우려면 confirm: true를 보내 주세요" }, 400);
  const r = await env.DB.prepare("DELETE FROM memos WHERE user_id = ?").bind(user.id).run();
  return json({ ok: true, deleted: r.meta.changes });
}

// ── 팝업 후보 만들기 ─────────────────────────────────────────

/**
 * 메모 한 줄 → 팝업 후보(일정 또는 할 일) 또는 null(그냥 메모).
 * 날짜·시각 말이 없어도 할 일일 수 있어 AI에게 묻는다. 다만 지난 일(~했다)·너무 짧은 메모는 묻지 않는다(비용 0).
 */
export async function suggestEvent(env, text, now = new Date(), { ctx, userId, fetch } = {}) {
  const when = findWhen(text, now);
  if (!when && !worthAsking(text)) return null;

  const askAi = async () => {
    if (!env.ANTHROPIC_API_KEY) return null;
    try {
      const long = isLongMemo(text);
      const r = await askPopupAi(env, text, now, { fetch, long, timeoutMs: long ? Number(env.POPUP_AI_LONG_MS) || 8000 : Number(env.POPUP_AI_MS) || 2500 });
      background(ctx, writeLog(env, userId, "llm", usageDetail("memo_popup", r)));
      return r.data;
    } catch (e) {
      background(ctx, writeLog(env, userId, "llm_fail", JSON.stringify({ use: "memo_popup", error: e.message.slice(0, 160) })));
      return null;
    }
  };
  // AI에게 묻는 동안 내 일정을 읽는다(기다리는 시간이 안 늘고, AI에게는 일정을 안 보낸다 = 토큰 그대로)
  const [ai, known, busy] = await Promise.all([
    askAi(),
    when ? loadKnown(env, userId, text, now) : [],
    when && !when.time ? loadDay(env, userId, when.date) : [], // 시각을 안 썼을 때만: 빈 시간 고르기에 쓴다
  ]);
  const popup = mergePopup(text, when, ai, now);
  if (!popup || popup.kind === "task") return popup;
  const len = lengthOf(text); // '2시간'이라고 썼으면 그 길이로
  const filled = markGuessed(popup, withHour(useLength(suggestFree(useKnown(popup, text, known, isoKst(now).slice(0, 10)), text, busy, isoKst(now), len?.minutes), len)), when, len);
  if (!WEEKLY.test(text) || NOT_WEEKLY.test(text)) return filled;
  // 매주 되풀이: 저장할 때 { repeat: true }를 보내면 학기 끝까지 같은 요일·시각으로 넣는다(savePopup). 화면에서 끌 수 있다
  const title = filled.title.replace(/매주|(?<![가-힣])마다(?![가-힣])/g, " ").replace(/\s+/g, " ").trim() || filled.title;
  return { ...filled, title, repeat: { until: semesterEnd(filled.date) } };
}

/**
 * 사람이 쓰지 않았는데 앱이 채운 칸 → popup.guessed = ['date', 'time', 'end_time', 'place'] 중 그런 것(없으면 칸 없음).
 * 화면은 이 칸을 '추천'처럼(점선·연하게) 보이고, 쓴 칸은 '정한 것'처럼 보인다(11-13 사람 피드백 5 '추천/고르기 명확하게').
 * - date: 날짜 말 없이 시각만 써서 오늘·내일로 짐작했을 때
 * - time·end_time·place: 메모(규칙·AI가 읽은 것)에는 없었는데 내 일정에서 가져왔거나(useKnown, popup.from) 빈 시간을 골랐거나
 *   (suggestFree, popup.free) 끝을 1시간으로 잡았을 때(withHour). 단 쓴 길이('2시간')로 낸 끝은 시작이 쓴 시각이면 정한 것
 */
function markGuessed(read, popup, when, len) {
  const guessed = [];
  if (when && !when.dateExplicit) guessed.push("date");
  if (read.time === "?" && popup.time !== "?") guessed.push("time");
  if (read.end_time === "?" && popup.end_time !== "?" && !(len && !guessed.includes("time"))) guessed.push("end_time");
  if (read.place === "?" && popup.place !== "?") guessed.push("place");
  return guessed.length ? { ...popup, guessed } : popup;
}

/**
 * 끝을 안 정했으면 1시간(11-13 사람 요청 "일정이나 메모는 끝나는 시간을 따로 정하지 않았으면 1시간을 기본으로").
 * 쓴 끝·쓴 길이('2시간', useLength)·내 일정에서 찾은 끝(useKnown)·빈 1시간(suggestFree)이 먼저고, 그래도 '?'일 때만.
 * 시작을 모르면(종일) 그대로. 자정을 넘으면 23:59(useLength와 같게 — 팝업은 날짜 칸이 하나라서)
 */
export function withHour(popup) {
  if (!popup || popup.kind === "task" || !popup.time || popup.time === "?" || (popup.end_time && popup.end_time !== "?")) return popup;
  return { ...popup, end_time: hhmm(Math.min(toMin(popup.time) + 60, 24 * 60 - 1)) };
}

// ponytail: 매주만 읽는다('매주', '목요일마다'). 격주·'2주마다'·매일·매달은 한 번짜리로 남는다 → 필요해지면 되풀이 종류를 늘린다
const WEEKLY = /매주|[월화수목금토일]\s*(?:요일|욜)\s*마다/;
const NOT_WEEKLY = /격주|\d\s*주/;

/** 매주 되풀이: 첫 날 다음 주부터 학기 끝까지의 같은 요일 날짜들 */
function weeksAfter(date) {
  const out = [];
  for (let d = addDays(date, 7), until = semesterEnd(date); d <= until; d = addDays(d, 7)) out.push(d);
  return out;
}

/** 날짜·시각 말이 없는 메모를 AI에게 물을 만한가: 글자가 있고(2자 이상), 지난 일(~했다·~었음)이 아니면 */
function worthAsking(text) {
  const t = text.trim();
  return t.length >= 2 && /[가-힣A-Za-z]/.test(t) && !PAST.test(t);
}

/** 메모의 낱말과 첫 글자가 같은 내 일정(2주 전 ~ 6달 뒤, 옮긴 것 빼고). 줄임말은 첫 글자가 같다(lib/known.js) */
async function loadKnown(env, userId, text, now) {
  if (!env.DB || !userId) return [];
  const today = isoKst(now).slice(0, 10);
  const firsts = [...new Set(text.split(/\s+/).filter(Boolean).map((w) => w[0]))];
  return env.DB.prepare(
    `SELECT id, title, start, "end", place FROM events
      WHERE user_id = ? AND moved_to IS NULL AND start >= ? AND start < ?
        AND substr(title, 1, 1) IN (SELECT value FROM json_each(?))
      ORDER BY start LIMIT 400`,
  )
    .bind(userId, addDays(today, -14), addDays(today, 180), JSON.stringify(firsts))
    .all()
    .then((r) => r.results)
    .catch(() => []); // 일정을 못 읽어도 팝업은 뜬다
}

/** 그날에 걸친 내 일정의 시작·끝(옮긴 것 빼고) */
async function loadDay(env, userId, date) {
  if (!env.DB || !userId) return [];
  return env.DB.prepare(
    `SELECT start, "end" FROM events WHERE user_id = ?1 AND moved_to IS NULL AND start < ?2 AND (start >= ?3 OR "end" > ?3)`,
  )
    .bind(userId, addDays(date, 1), date)
    .all()
    .then((r) => r.results)
    .catch(() => []);
}

// 메모 길이로 모델 고르기(11-14 피드백 "메모 길이에 따라 작은 모델 / 긴 메모만 서버 큰 모델"):
// 짧은 메모(대부분)는 빠른 모델 그대로 — 팝업이 바로 떠야 해서. 긴 메모(여러 줄·여러 일)는 똑똑한 모델이 더 잘 가르고, 기다리는 시간도 조금 더 준다.
// ponytail: 글자 수 하나로만 가른다. 기기 안 작은 모델(SLM)은 웹앱에서 못 돌려 아직 없음 — 정식 앱이 생기면 그때
export const LONG_MEMO = 120;
export const isLongMemo = (text) => text.trim().length >= LONG_MEMO || text.trim().split(/\n/).length >= 3;

/** 메모 팝업 AI 묻기 (위험 확인 스크립트 worker/check/haiku_latency.js도 이걸 쓴다). long = 긴 메모 → 똑똑한 모델 */
export function askPopupAi(env, text, now, { fetch, timeoutMs = 2500, long = false } = {}) {
  return askJson(env, {
    model: long ? "smart" : "fast",
    system: SYSTEM,
    content: userMessage(text, nowLabel(now)),
    schema: SCHEMA,
    maxTokens: long ? 640 : 320, // 11-12: 할 일 여러 개(also)·minutes 칸이 늘어서 200 → 320, 긴 메모는 할 일이 더 많을 수 있어 두 배
    timeoutMs,
    fetch,
  });
}

/**
 * 정규식 결과(when)와 AI 답(ai, 없으면 null)을 합친다.
 * - 일정인지·이름·장소는 AI가 먼저, 없으면 규칙.
 * - 날짜·시각은 정규식이 먼저. 오전·오후를 짐작한 경우에만 AI의 같은 시각(3시 ↔ 15시)을 따른다.
 */
export function mergePopup(text, when, ai, now = new Date()) {
  const kind = ai ? aiKind(ai) : when && looksLikeSchedule(text, when) ? "schedule" : looksLikeTodo(text, when) ? "task" : "note";
  if (kind === "task") return taskPopup(text, when, ai, now);
  if (kind !== "schedule" || !when) return null; // 날짜·시각 말이 없는 일정은 팝업에 날짜를 못 채운다 → 메모로(밤 정리)

  const { date, time, end } = clockOf(when, ai, now);
  const guess = guessTitlePlace(text, when);
  return {
    title: clean(ai?.title) ?? guess.title,
    date,
    time: time ?? "?",
    end_time: end ?? "?",
    place: clean(ai?.place) ?? guess.place ?? "?",
    ...(alsoOf(ai?.prep).length ? { prep: alsoOf(ai?.prep) } : {}), // 일정 전에 끝낼 할 일(11-14) — 저장하면 마감 = 일정 시작
    by: ai ? "ai" : "rule",
  };
}

/** AI 없이 판단할 때: 시각이 있고, 마감·지난 일이 아니면 일정 ("2시부터 4시까지"의 까지는 시각 말이라 뺀다) */
function looksLikeSchedule(text, when) {
  if (when.past) return false;
  const rest = cutSpans(text, when.spans);
  // 시각이 없으면 시간대 말이 있고 할 일 끝말이 아닐 때만: '내일 점심 밥약'은 일정(빈 시간은 lib/known.js), '내일 저녁에 장보기'는 할 일
  if (!when.time && (!PART_OF_DAY.test(rest) || TODO_END.test(tidy(rest)))) return false;
  if (/까지|마감|제출/.test(rest)) return false;
  if (PAST.test(rest)) return false;
  return true;
}

const PAST = /(었|았|였|했)(다|음|어)/;
// 시각 없이 시간대만 쓴 말(낱말로 떨어져 있을 때만, '아침밥'은 아님). 그 시간대의 빈 시간은 lib/known.js suggestFree가 고른다
const PART_OF_DAY = /(?<![가-힣])(?:늦은\s*밤|밤\s*늦게|심야|한밤중?|아침|오전|점심|낮|오후|저녁|밤)(?=에|쯤|\s|$)/;
const LEADING_PART = /^\s*(?:늦은\s*밤|밤\s*늦게|심야|한밤중?|아침|오전|점심|낮|오후|저녁|밤)(?:에|쯤에?)?\s+/;
// 할 일 끝말: '풀기'·'물어보기'처럼 -기, '할 것'·'해야 함', 또는 끝내면 되는 일 낱말(제출·신청·예약·연락·전화…)
const TODO_END = /(?:기|할\s*것|할것|해야\s*(?:함|됨|돼|해|지|할\s*듯)?|하자|제출|신청|예약|연락|전화|구매|결제|준비|정리|확인|복습|예습|공부|등록|납부|반납|수정|출력|인쇄)$/;

/** AI 없이 할 일인지: 지난 일이 아니고, 마감 말(까지·마감·제출)이 있거나 끝말이 할 일 모양 */
export function looksLikeTodo(text, when) {
  const rest = when ? cutSpans(text, when.spans) : text;
  if (when?.past || PAST.test(rest)) return false;
  if (when && /까지|마감|제출|내기/.test(rest)) return true;
  return TODO_END.test(rest.trim().replace(/[\s.!~,;:]+$/, ""));
}

/** AI 답의 종류: 새 칸 kind가 먼저, 없으면 예전 칸 is_schedule */
function aiKind(ai) {
  if (["schedule", "task", "note"].includes(ai.kind)) return ai.kind;
  return ai.is_schedule === true ? "schedule" : "note";
}

/** 할 일 팝업: 이름은 날짜·시각 말과 그 조사('~까지')를 뺀 나머지 그대로(AI가 있으면 AI).
 *  마감은 정규식이 읽은 날짜·시각(오전·오후만 AI, 일정과 같은 규칙). 날짜·시각 말이 없으면 마감 없음 */
function taskPopup(text, when, ai, now) {
  const left = tidy(when ? cutSpans(text, when.spans) : text);
  // '금요일 23:59 마감 과제 제출' → '과제 제출'(마감은 날짜 칸에), '오늘 밤 과제 하기' → '과제 하기'(날짜 말에 붙은 시간대)
  const rest = tidy(left.replace(/(?:^|\s)마감(?=\s|$)/g, " ").replace(LEADING_PART, "")) || left;
  const due = when ? clockOf(when, ai, now) : {};
  // AI가 없으면 쉼표로만 나눈다(이름 오타는 못 고침)
  const parts = ai ? [] : rest.split(/\s*[,，、]\s*/).filter((x) => x.length >= 2);
  const [first, ...also] = parts.length > 1 ? parts.map((title) => ({ title, minutes: null })) : [{ title: clean(ai?.title) ?? (rest || "?"), minutes: minutesOf(ai?.minutes) }, ...alsoOf(ai?.also)];
  return { kind: "task", title: first.title, date: due.date ?? "?", time: due.time ?? "?", ...(first.minutes ? { minutes: first.minutes } : {}), ...(also.length ? { also } : {}), by: ai ? "ai" : "rule" };
}

/** 날짜·시각은 정규식이 먼저. 오전·오후를 짐작한 시각만 AI의 같은 시각(3시 ↔ 15시)을 따른다 */
function clockOf(when, ai, now) {
  let date = when.date;
  let time = when.time;
  let end = when.end;
  const aiTime = cleanTime(ai?.time);
  if (time && when.guessed && aiTime && aiTime !== time && sameClock(aiTime, time)) {
    // 오전·오후를 짐작한 시각은 AI를 따른다(3시 ↔ 15시). 끝 시각도 같이 12시간 옮긴다
    const shift = toMin(aiTime) - toMin(time);
    time = aiTime;
    if (end) end = hhmm((toMin(end) + shift + 1440) % 1440);
    if (!when.dateExplicit) date = nextDayAt(aiTime, now); // "9시 영화"처럼 날짜를 안 썼으면 그 시각이 다음에 오는 날
  }
  if (!time && aiTime) time = aiTime;
  return { date, time, end };
}

// ── 날짜·시각 읽기 (정규식) ──────────────────────────────────

const PERIOD = "(오전|오후|아침|점심|저녁|밤|새벽|낮)?\\s*";
const KO_HOUR = { 한: 1, 두: 2, 세: 3, 네: 4, 다섯: 5, 여섯: 6, 일곱: 7, 여덟: 8, 아홉: 9, 열: 10, 열한: 11, 열두: 12 };
const WEEKDAY = { 일: 0, 월: 1, 화: 2, 수: 3, 목: 4, 금: 5, 토: 6 };
const WEEK_OFFSET = { 이번: 0, 금: 0, 다음: 1, 담: 1, 차: 1, 다다음: 2, 저번: -1, 지난: -1 };
const REL_DAYS = { 오늘: 0, 금일: 0, 이따: 0, 이따가: 0, 내일: 1, 낼: 1, 명일: 1, 내일모레: 2, 모레: 2, 글피: 3, 어제: -1, 그제: -2, 그저께: -2 };

// 날짜: 위에 있는 것이 먼저다.
const DATE_RULES = [
  { kind: "ymd", re: /(?<!\d)(\d{4})\s*[-./년]\s*(\d{1,2})\s*[-./월]\s*(\d{1,2})\s*일?/g }, // 2026-11-13, 2026년 11월 13일
  { kind: "md", re: /(?<!\d)(\d{1,2})\s*월\s*(\d{1,2})\s*일/g }, // 11월 13일
  { kind: "md", re: /(?<![\d./])(\d{1,2})\s*[/.]\s*(\d{1,2})(?![\d./%]|\s*(?:시|배|점|퍼))/g }, // 11/13, 11.13 (3.5시간 아님)
  { kind: "rel", re: /(?<![가-힣])(오늘|금일|이따가?|내일모레|내일|낼|명일|모레|글피|어제|그저께|그제)/g }, // '보낼'의 낼은 아님
  { kind: "month", re: /(다음\s*달|담달|이번\s*달|이달)\s*(\d{1,2})\s*일/g }, // 다음 달 20일 (그냥 '20일'은 지났으면 다음 달)
  { kind: "later", re: /(?<![\d.])(?:(\d{1,2})\s*(일|주일|주)|(일주일))\s*(?:뒤|후)(?=에|쯤|$|[^가-힣])/g }, // 3일 뒤, 2주 후에, 일주일 뒤 ('뒤풀이'는 아님)
  { kind: "weekend", re: /(?:(다다음|이번|다음|저번|지난|담)\s*)?주말(?=에|엔|쯤|까지|$|[^가-힣])/g }, // (다음) 주말 = 토요일, '주말까지'는 일요일
  { kind: "wd", re: /(?:(다다음|이번|다음|저번|지난|금|담|차)\s*주\s*)?([월화수목금토일])\s*(?:요일|욜)/g }, // (다음주) 금요일
  { kind: "wd", re: /(다다음|이번|다음|저번|지난|금|담|차)\s*주\s*([월화수목금토일])(?![가-힣])/g }, // 담주 화 3시 ('다음 주 수업'은 아님)
  { kind: "wd", re: /(?<![가-힣\d])()([월화수목금토일])(?=\s*(?:\d{1,2}\s*시|\d{1,2}:\d{2}|오전|오후|아침|점심|저녁|밤|새벽))/g }, // 금 7시, 수 18:30
  { kind: "day", re: /(?<!\d)(\d{1,2})\s*일(?!\s*(?:간|동안|째|차|정도|마다|뒤|후|전|에\s*한))/g }, // 13일 (3일간 아님)
];
const AFTER_DATE_WEEKDAY = /^\s*\(?\s*[월화수목금토일](?:요일|욜)?(?![가-힣])\s*\)?/; // 11/13(금) 의 (금). '11/13 수업'의 수는 아님

const HOUR_RANGE = new RegExp(PERIOD + "(?<!\\d)(\\d{1,2})\\s*[~\\-–]\\s*(\\d{1,2})\\s*시(?![간작험])", "g"); // 3~5시
const TIME_RULES = [
  new RegExp(PERIOD + "(?<!\\d)(\\d{1,2}):(\\d{2})", "g"), // 18:30
  new RegExp(PERIOD + "(?<!\\d)(\\d{1,2})\\s*시(?![간작험])(?:\\s*(반|\\d{1,2}\\s*분))?", "g"), // 3시, 3시 반, 3시 20분 (3시간·시험 아님)
  // 세 시 반, 네시에 ('한시적', '한 시점', '세 시간'은 아님: 시 뒤에 다른 글자가 붙으면 버린다)
  new RegExp(PERIOD + "(?<![가-힣])(열두|열한|열|한|두|세|네|다섯|여섯|일곱|여덟|아홉)\\s*시(?=$|[^가-힣]|반|에|까지|부터|쯤|경|정각|전|후)(?:\\s*(반|\\d{1,2}\\s*분))?", "g"),
  new RegExp(PERIOD + "(정오|자정)", "g"),
];
const RANGE_GLUE = /^\s*(?:~|-|–|부터)\s*/;
// 지금부터 얼마 뒤: 2시간 뒤, 1시간 반 후에, 한 시간 뒤, 30분 있다가 ('2시간 동안'·'30분 전'은 아님 — 길이는 lib/known.js lengthOf)
const LATER_TIME =
  /(?<![\d.])(?:(\d{1,2})(\.5)?\s*시간(?:\s*(반|\d{1,2}\s*분))?|(한|두|세|네|다섯|여섯)\s*시간(?:\s*(반))?|(\d{1,3})\s*분)\s*(?:뒤|후|있다가)(?=에|쯤|$|[^가-힣])/;

/**
 * 메모에서 날짜·시각을 읽는다. 둘 다 없으면 null.
 * @returns {{date: string, time: string|null, end: string|null, guessed: boolean, dateExplicit: boolean, past: boolean, spans: number[][]}|null}
 *   guessed = 오전·오후를 짐작함, dateExplicit = 날짜를 썼음(아니면 시각만 보고 오늘·내일로 정함), spans = 읽은 글자 범위(이름을 뽑을 때 뺀다)
 */
export function findWhen(text, now = new Date()) {
  const k = kst(now);
  const today = ymd(k.y, k.m, k.d);
  const nowMin = k.hh * 60 + k.mi;
  const spans = [];

  const d = findDate(text, k, today);
  if (d) spans.push(d.span);
  const t = findTime(text);
  if (t) spans.push(...t.spans);
  if (!t && (!d || d.date === today)) {
    // '2시간 뒤 빨래 걷기'·'오늘 30분 뒤 회의': 지금(메모를 쓴 때)부터 센 시각. 5분 단위로 올린다
    const later = findLaterTime(text, now);
    if (later) return { date: later.date, time: later.time, end: null, guessed: false, dateExplicit: true, past: false, spans: [...spans, later.span] };
  }
  if (!d && !t) return null;

  let date = d?.date ?? null;
  let time = null;
  let end = null;
  let guessed = false;
  if (t) {
    const isToday = date === today;
    const s = to24(t.start, isToday ? nowMin : null);
    if (!date) {
      // 날짜 없이 시각만: 아직 안 지났으면 오늘, 지났으면 내일
      date = s.min + s.addDays * 1440 > nowMin ? today : addDays(today, 1);
    }
    if (s.addDays) date = addDays(date, s.addDays);
    time = hhmm(s.min);
    guessed = s.guessed;
    if (t.end) {
      const e = to24({ ...t.end, period: t.end.period ?? t.start.period }, null);
      let endMin = e.min;
      if (e.guessed && endMin <= s.min && endMin + 720 > s.min && endMin + 720 < 1440) endMin += 720; // 11시~1시
      if (endMin > s.min) end = hhmm(endMin);
    }
  }
  return { date, time, end, guessed, dateExplicit: Boolean(d), past: Boolean(d?.past), spans };
}

/** '2시간 뒤' → 지금 + 2시간의 { date, time, span } (1분 ~ 72시간만) */
function findLaterTime(text, now) {
  const m = LATER_TIME.exec(text);
  if (!m) return null;
  const minutes = m[1]
    ? +m[1] * 60 + (m[2] ? 30 : 0) + (m[3] === "반" ? 30 : m[3] ? parseInt(m[3]) : 0)
    : m[4]
      ? KO_HOUR[m[4]] * 60 + (m[5] ? 30 : 0)
      : +m[6];
  if (minutes < 1 || minutes > 72 * 60) return null;
  const at = kst(new Date(Math.ceil((now.getTime() + minutes * 60000) / 300000) * 300000));
  return { date: ymd(at.y, at.m, at.d), time: hhmm(at.hh * 60 + at.mi), span: [m.index, m.index + m[0].length] };
}

function findDate(text, k, today) {
  for (const rule of DATE_RULES) {
    let pastHit = null;
    for (const m of text.matchAll(rule.re)) {
      const r = readDate(rule.kind, m, k, today);
      if (!r) continue;
      let endAt = m.index + m[0].length;
      if (rule.kind === "ymd" || rule.kind === "md" || rule.kind === "day") {
        const wd = text.slice(endAt).match(AFTER_DATE_WEEKDAY);
        if (wd) endAt += wd[0].length;
      }
      const hit = { ...r, span: [m.index, endAt] };
      if (!hit.past) return hit; // 지난 날("어제")보다 앞으로 올 날을 먼저 고른다
      pastHit ??= hit;
    }
    if (pastHit) return pastHit;
  }
  return null;
}

function readDate(kind, m, k, today) {
  if (kind === "ymd") return validDate(+m[1], +m[2], +m[3]);
  if (kind === "md") {
    // 한 달 넘게 지난 날이면 내년으로 본다 (12월에 쓴 "1/5")
    const r = validDate(k.y, +m[1], +m[2]);
    if (r && r.date < addDays(today, -30)) return validDate(k.y + 1, +m[1], +m[2]);
    return r;
  }
  if (kind === "day") {
    const day = +m[1];
    if (day < 1 || day > 31) return null;
    return day >= k.d ? validDate(k.y, k.m, day) : nextMonthDate(k, day);
  }
  if (kind === "rel") {
    const n = REL_DAYS[m[1]];
    return { date: addDays(today, n), past: n < 0 };
  }
  if (kind === "later") return { date: addDays(today, m[3] ? 7 : +m[1] * (m[2] === "일" ? 1 : 7)), past: false };
  if (kind === "month") {
    if (!/^(?:이번|이달)/.test(m[1])) return nextMonthDate(k, +m[2]);
    const r = validDate(k.y, k.m, +m[2]);
    return r && { ...r, past: r.date < today };
  }
  if (kind === "weekend") {
    const offset = m[1] ? WEEK_OFFSET[m[1]] : 0;
    const saturday = addDays(today, -((k.wd + 6) % 7) + offset * 7 + 5);
    const byEnd = m.input.slice(m.index + m[0].length).startsWith("까지");
    const date = byEnd ? addDays(saturday, 1) : offset === 0 && saturday < today ? today : saturday; // 일요일에 쓴 '주말'은 오늘
    return { date, past: offset < 0 };
  }
  if (kind === "wd") {
    const target = WEEKDAY[m[2]];
    if (!m[1]) {
      return { date: addDays(today, (target - k.wd + 7) % 7), past: false }; // 오늘을 포함해 가장 가까운 그 요일
    }
    const offset = WEEK_OFFSET[m[1]];
    const monday = addDays(today, -((k.wd + 6) % 7));
    const date = addDays(monday, offset * 7 + ((target + 6) % 7));
    return { date, past: offset < 0 };
  }
  return null;
}

/** 다음 달의 그날 (12월이면 내년 1월) — 12월에 쓴 '5일'·'다음 달 5일' */
function nextMonthDate(k, d) {
  return k.m === 12 ? validDate(k.y + 1, 1, d) : validDate(k.y, k.m + 1, d);
}

function validDate(y, mo, d) {
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const date = ymd(y, mo, d);
  return date.endsWith(`-${pad(d)}`) ? { date, past: false } : null; // 2월 30일 같은 날 거르기
}

function findTime(text) {
  let best = null;
  for (const m of text.matchAll(HOUR_RANGE)) {
    best = {
      start: { period: m[1], h: +m[2], min: 0 },
      end: { period: undefined, h: +m[3], min: 0 },
      spans: [[m.index, m.index + m[0].length]],
    };
    break;
  }
  for (const rule of TIME_RULES) {
    for (const m of text.matchAll(rule)) {
      if (best && best.spans[0][0] <= m.index) break;
      const t = readTime(m);
      if (!t) continue;
      const startSpan = [m.index, m.index + m[0].length];
      best = { start: t, end: null, spans: [startSpan] };
      // 범위: "2시부터 4시까지", "14:00~16:00"
      const rest = text.slice(startSpan[1]);
      const glue = rest.match(RANGE_GLUE);
      if (glue) {
        const after = startSpan[1] + glue[0].length;
        for (const r2 of TIME_RULES) {
          const m2 = new RegExp(r2.source, "y");
          m2.lastIndex = after;
          const hit = m2.exec(text);
          const t2 = hit && readTime(hit);
          if (t2) {
            best.end = t2;
            let endAt = after + hit[0].length;
            if (text.slice(endAt).startsWith("까지")) endAt += 2;
            best.spans = [[startSpan[0], endAt]];
            break;
          }
        }
      }
      break;
    }
  }
  return best;
}

function readTime(m) {
  const period = m[1];
  if (m[2] === "정오") return { period: undefined, h: 12, min: 0, fixed: true };
  if (m[2] === "자정") return { period: "자정", h: 0, min: 0, fixed: true };
  const h = KO_HOUR[m[2]] ?? Number(m[2]);
  let min = 0;
  if (m[3] === "반") min = 30;
  else if (m[3]) min = Number(m[3].replace(/\D/g, ""));
  if (!(h >= 0 && h <= 24 && min >= 0 && min < 60)) return null;
  // "06:30", "10:30"처럼 두 자리 시는 24시간제로 본다. "6:30"은 짐작한다.
  return { period, h, min, fixed: m[0].includes(":") && /\d{2}:/.test(m[0]) };
}

/**
 * 시·분 → 0시부터 분. 오전·오후가 없으면 짐작한다(guessed):
 * 1~8시는 오후, 9~11시는 오전, 12시는 낮 12시. 오늘인데 짐작한 시각이 지났고 반대쪽이 남았으면 반대쪽.
 */
function to24({ period, h, min, fixed }, nowMinIfToday) {
  let hh = h;
  let addDays = 0;
  let guessed = false;
  if (period === "자정") return { min: 0, addDays: 1, guessed: false };
  if (h === 0 || h >= 13) hh = h % 24;
  else if (!period && fixed) hh = h;
  else if (period === "오전" || period === "아침" || period === "새벽") hh = h === 12 ? 0 : h;
  else if (period === "오후") hh = h === 12 ? 12 : h + 12;
  else if (period === "낮") hh = h === 12 || h >= 7 ? h : h + 12;
  else if (period === "점심") hh = h >= 10 ? h : h + 12;
  else if (period === "저녁") {
    if (h === 12) [hh, addDays] = [0, 1];
    else hh = h + 12;
  } else if (period === "밤") {
    if (h === 12 || h <= 4) [hh, addDays] = [h % 12, 1]; // 밤 12시·밤 1시 = 다음 날 새벽
    else hh = h + 12;
  } else {
    guessed = true;
    hh = h === 12 ? 12 : h <= 8 ? h + 12 : h;
    if (nowMinIfToday != null && h !== 12) {
      const other = hh >= 12 ? hh - 12 : hh + 12;
      if (hh * 60 + min <= nowMinIfToday && other * 60 + min > nowMinIfToday) hh = other;
    }
  }
  return { min: hh * 60 + min, addDays, guessed };
}

// ── AI 없이 이름·장소 짐작 ───────────────────────────────────

const PLACE_RULES = [
  /(\S+역\s*\d{1,2}\s*번\s*출구|\S+(?:\s+(?:앞|뒤|옆|안|입구|\d+층))?)\s*에서(?=\s|$)/, // 학관에서, 자하연 앞에서, 낙성대역 4번 출구에서
  /((?<!\d)\d{2,3}(?:-\d)?\s*동(?:\s*\d{1,4}\s*호)?(?:\s*\d+층)?)/, // 301동, 220동 302호
  /((?<![\d:])\d{2,3}-\d{3,4}(?:호)?)(?![\d:]|\s*시)/, // 301-118
  /((?:학관|학생회관|중도|중앙도서관|관정도서관|도서관|자하연|버들골|체육관|기숙사|관악사|행정관|아크로|동방|과방|강의실|실험실|카페)(?:\s+(?:앞|뒤|옆|입구|\d+층))?)/,
  /(\S+\s+(?:입구|앞|정문|후문))(?=\s|$)/, // 관악산 입구
  /(\S+역(?:\s*\d{1,2}\s*번\s*출구)?)(?=\s|$)/, // 강남역, 낙성대역, 홍대입구역 4번 출구
];
const PARTICLE = "(?:에서|에는|에|까지|부터|쯤|경|으로|로)";

/** 이름 = 메모에서 날짜·시각·장소 말을 뺀 나머지 그대로. 남는 게 없으면 장소, 그것도 없으면 '?' */
export function guessTitlePlace(text, when) {
  let rest = cutSpans(text, when.spans);
  let place = null;
  for (const re of PLACE_RULES) {
    const m = rest.match(re);
    if (m) {
      place = m[1].trim();
      rest = rest.slice(0, m.index) + " " + rest.slice(m.index + m[0].length);
      break;
    }
  }
  return { title: tidy(rest) || place || "?", place };
}

/** 읽은 글자 범위를 빈칸으로 바꾼다 (자리는 그대로 둬서 다른 범위가 안 흐트러지게) */
function cutSpans(text, spans) {
  let rest = text;
  for (const [s, e] of [...spans].sort((a, b) => b[0] - a[0])) rest = rest.slice(0, s) + " ".repeat(e - s) + rest.slice(e);
  return rest;
}

function tidy(s) {
  return s
    .replace(/\s+/g, " ")
    .trim()
    .replace(new RegExp(`^(?:${PARTICLE}|[,.:~\\-])(?=\\s|$)\\s*`), "")
    .replace(new RegExp(`(?:^|\\s)${PARTICLE}$`), "")
    .replace(/[\s,.:~\-]+$/, "")
    .trim();
}

// ── 작은 도구들 ──────────────────────────────────────────────

const KST_MS = 9 * 60 * 60 * 1000;
const WEEKDAY_NAMES = "일월화수목금토";
const pad = (n) => String(n).padStart(2, "0");

/** Date → 한국 시각의 년·월·일·시·분·요일(0=일) */
export function kst(date) {
  const t = new Date(date.getTime() + KST_MS);
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate(), hh: t.getUTCHours(), mi: t.getUTCMinutes(), wd: t.getUTCDay() };
}
/** 년·월·일 → "YYYY-MM-DD" (넘치는 날은 다음 달로) */
export function ymd(y, m, d) {
  const t = new Date(Date.UTC(y, m - 1, d));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}
export function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return ymd(y, m, d + n);
}
/**
 * 학기 끝 기본값: 정규 수업 마지막 날(종강)까지 매주 펼친다(시간표 5번 파일, 매주 메모). 보강기간은 매주 수업이 아니라 넣지 않는다.
 * 서울대 2026학년도 학사일정: 2학기 종강 12/14(월, 보강 12/15~21), 1학기 종강 6/15(월).
 * 다른 해도 같은 날을 기본값으로 둔다(시간표는 화면에서 고칠 수 있다). 그 밖(계절학기·방학)은 6주 뒤.
 */
export function semesterEnd(from) {
  const [y, m] = from.split("-").map(Number);
  if (m >= 8 && m <= 12) return `${y}-12-14`;
  if (m >= 2 && m <= 6) return `${y}-06-15`;
  return addDays(from, 42);
}
/** Date → "2026-11-09T17:02:33+09:00" (schema.sql의 시각 모양) */
export function isoKst(date) {
  const t = new Date(date.getTime() + KST_MS);
  return t.toISOString().slice(0, 19) + "+09:00";
}
/** Date → "2026-11-09 (월) 17:02" (AI에게 지금 시각을 알려 줄 때) */
export function nowLabel(date) {
  const k = kst(date);
  return `${ymd(k.y, k.m, k.d)} (${WEEKDAY_NAMES[k.wd]}) ${pad(k.hh)}:${pad(k.mi)}`;
}
const hhmm = (min) => `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;
const toMin = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
/** 그 시각이 아직 안 지났으면 오늘, 지났으면 내일 (한국 날짜) */
function nextDayAt(time, now) {
  const k = kst(now);
  const today = ymd(k.y, k.m, k.d);
  return toMin(time) > k.hh * 60 + k.mi ? today : addDays(today, 1);
}

const clean = (v) => {
  const s = typeof v === "string" ? v.trim() : "";
  return s && s !== "?" ? s : null;
};
const cleanTime = (v) => (/^([01]\d|2[0-3]):[0-5]\d$/.test(clean(v) ?? "") ? v.trim() : null);
const cleanDate = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(clean(v) ?? "") ? v.trim() : null);
const sameClock = (a, b) => Number(a.slice(0, 2)) % 12 === Number(b.slice(0, 2)) % 12 && a.slice(3) === b.slice(3);

/** 팝업 칸 정리: '?'·빈칸 → null */
function popupFields(o = {}) {
  return {
    title: clean(o.title),
    date: cleanDate(o.date),
    time: cleanTime(o.time),
    end_time: cleanTime(o.end_time),
    place: clean(o.place),
  };
}
const sameFields = (a, b) => ["title", "date", "time", "end_time", "place"].every((key) => a[key] === b[key]);
/** 할 일 팝업 칸 정리: 이름·마감 날짜·마감 시각('?'·빈칸 → null) */
const taskFields = (o = {}) => ({ title: clean(o.title), date: cleanDate(o.date), time: cleanTime(o.time) });
const sameTask = (a, b) => ["title", "date", "time"].every((key) => a[key] === b[key]);

/** 팝업 칸 → events.start/end. 시각이 없으면 종일 일정: schema.sql대로 start = 그날, end = 다음 날(ICS 방식) */
function toStartEnd(f) {
  if (!f.time) return { start: f.date, end: addDays(f.date, 1) };
  const start = `${f.date}T${f.time}:00+09:00`;
  // 끝을 안 정했거나(시작보다 이르면 잘못 쓴 것으로 본다) → 시작 + 1시간(11-13 사람 요청, 자정을 넘으면 다음 날)
  const end = f.end_time && f.end_time > f.time ? `${f.date}T${f.end_time}:00+09:00` : isoKst(new Date(Date.parse(start) + 3600000));
  return { start, end };
}

function writeLog(env, userId, action, detail) {
  if (!env.DB) return Promise.resolve();
  return env.DB.prepare("INSERT INTO log (user_id, action, detail) VALUES (?, ?, ?)")
    .bind(userId ?? null, action, detail ?? null)
    .run()
    .catch(() => {}); // 기록 실패가 사용자 요청을 막지 않게
}

/** 응답을 보낸 뒤에 마저 할 일 (Cloudflare ctx.waitUntil) */
function background(ctx, promise) {
  if (ctx?.waitUntil) ctx.waitUntil(promise);
}

function json(data, status = 200) {
  return Response.json(data, { status });
}
