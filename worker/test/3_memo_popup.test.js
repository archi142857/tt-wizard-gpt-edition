// worker/3_memo_popup.js 테스트. 실제 API는 부르지 않는다(가짜 fetch), DB는 schema.sql로 만든 가짜 D1.
// 실행: node --test "worker/test/*.test.js"

import test from "node:test";
import assert from "node:assert/strict";
import { handle, findWhen, mergePopup, suggestEvent, isoKst, nowLabel, looksLikeTodo, withHour, isLongMemo } from "../3_memo_popup.js";
import { CASES, NOW } from "./fixtures/memo_cases.js";
import { fakeD1, addUser, fakeCtx } from "./helpers/d1.js";

// ── 날짜·시각 읽기 ──

test("위험 확인 문장 10개: 정규식이 날짜·시각을 기대값대로 읽는다", () => {
  for (const c of CASES) {
    const w = findWhen(c.text, NOW);
    assert.ok(w, c.text);
    if (c.want.is_schedule) {
      assert.equal(w.date, c.want.date, c.text);
      assert.equal(w.time ?? "?", c.want.time, c.text);
    }
  }
  assert.equal(findWhen("다음주 월요일까지 유기화학 과제 제출", NOW).date, "2026-11-16");
  assert.equal(findWhen("오늘 점심 맛있었다", NOW).time, null);
});

test("여러 모양의 날짜·시각 (지금 = 11/9 월 17:00)", () => {
  const cases = [
    // [메모, 날짜, 시각, 끝 시각]
    ["담주 수욜 저녁 6시 반 회식", "2026-11-18", "18:30", null],
    ["2026-11-20 14:00 발표", "2026-11-20", "14:00", null],
    ["11월 20일(금) 2시~4시 세미나", "2026-11-20", "14:00", "16:00"],
    ["11.13(금) 7시 동아리", "2026-11-13", "19:00", null],
    ["3-5시 실험", "2026-11-10", "15:00", "17:00"],
    ["7시~9시 알바", "2026-11-09", "19:00", "21:00"],
    ["오후 2시부터 4시까지 봉사", "2026-11-10", "14:00", "16:00"],
    ["세 시 반 커피", "2026-11-10", "15:30", null],
    ["정오에 점심 약속", "2026-11-10", "12:00", null],
    ["밤 12시 마감", "2026-11-10", "00:00", null],
    ["오늘 밤 11시 통화", "2026-11-09", "23:00", null],
    ["새벽 2시 야간 실험", "2026-11-10", "02:00", null],
    ["이따 9시 반에 도서관", "2026-11-09", "21:30", null], // 오늘 9시는 지났으니 저녁
    ["06:30 기상", "2026-11-10", "06:30", null],
    ["3일 뒤 발표", "2026-11-12", null, null],
    ["13일 시험", "2026-11-13", null, null],
    ["1/5 신년회", "2027-01-05", null, null], // 한 달 넘게 지난 날은 내년
    ["이번주 일요일 3시 교회", "2026-11-15", "15:00", null],
    ["다다음주 월요일 10시 면접", "2026-11-23", "10:00", null],
    ["토 2시 영화", "2026-11-14", "14:00", null], // '요일' 없이 요일 한 글자 + 시각
    ["수 18:30 배드민턴", "2026-11-11", "18:30", null],
    ["담주 화 3시 팀플", "2026-11-17", "15:00", null],
    ["다음주 금 오전 10시 면접", "2026-11-20", "10:00", null],
    ["내일모레 4시 회의", "2026-11-11", "16:00", null],
    ["15일 7시 동기 모임", "2026-11-15", "19:00", null],
  ];
  for (const [text, date, time, end] of cases) {
    const w = findWhen(text, NOW);
    assert.ok(w, text);
    assert.deepEqual([w.date, w.time, w.end], [date, time, end], text);
  }
});

test("지금부터 얼마 뒤: '3일 뒤에'·'2주 후'·'2시간 뒤'·'30분 있다가' (지금 = 11/9 월 17:00, 시각은 5분 단위로 올림)", () => {
  const cases = [
    // [메모, 날짜, 시각]
    ["3일 뒤에 발표", "2026-11-12", null], // 전엔 '에'가 붙으면 못 읽었다
    ["3일 후에 발표", "2026-11-12", null],
    ["2주 뒤 발표", "2026-11-23", null],
    ["일주일 뒤 시험", "2026-11-16", null],
    ["2시간 뒤에 빨래 걷기", "2026-11-09", "19:00"],
    ["30분 뒤 회의", "2026-11-09", "17:30"],
    ["1시간 반 후 출발", "2026-11-09", "18:30"],
    ["한 시간 뒤에 전화", "2026-11-09", "18:00"],
    ["40분 있다가 출발", "2026-11-09", "17:40"],
    ["오늘 30분 뒤 회의", "2026-11-09", "17:30"],
    ["8시간 후 알람", "2026-11-10", "01:00"], // 자정을 넘으면 다음 날
  ];
  for (const [text, date, time] of cases) {
    const w = findWhen(text, NOW);
    assert.ok(w, text);
    assert.deepEqual([w.date, w.time, w.guessed], [date, time, false], text);
  }
  const odd = findWhen("10분 뒤 출발", new Date("2026-11-09T17:02:30+09:00"));
  assert.equal(odd.time, "17:15"); // 17:12:30 → 17:15
  // 이름에서는 그 말을 뺀다
  assert.equal(mergePopup("30분 뒤 회의", findWhen("30분 뒤 회의", NOW), null, NOW).title, "회의");
  // 시각을 쓴 메모의 '2시간 뒤'는 따로 세지 않는다(시각이 먼저), 날짜가 오늘이 아니어도 그렇다
  assert.deepEqual(pick(findWhen("내일 3시 회의 2시간 뒤 저녁", NOW)), ["2026-11-10", "15:00"]);
  assert.deepEqual(pick(findWhen("내일 2시간 뒤", NOW)), ["2026-11-10", null]);
  for (const text of ["3일 뒤풀이", "30분 전에 출력", "운동 2시간", "2시간 동안 회의"]) assert.equal(findWhen(text, NOW), null, text);
});
const pick = (w) => [w.date, w.time];

test("주말·다음 달 N일 (지금 = 11/9 월 17:00), 12월에 쓴 '5일'은 내년 1월", () => {
  const cases = [
    ["이번 주말 MT", "2026-11-14"], // 토요일
    ["다음 주말 본가", "2026-11-21"],
    ["주말에 빨래", "2026-11-14"],
    ["주말까지 과제", "2026-11-15"], // '까지'는 일요일
    ["다음 달 20일 발표", "2026-12-20"], // 전엔 이번 달 20일로 읽었다
    ["담달 3일 생일파티", "2026-12-03"],
  ];
  for (const [text, date] of cases) assert.equal(findWhen(text, NOW)?.date, date, text);
  const sunday = new Date("2026-11-15T10:00:00+09:00");
  assert.equal(findWhen("주말에 빨래", sunday).date, "2026-11-15"); // 일요일에 쓴 '주말'은 오늘
  assert.equal(findWhen("지난 주말 MT 사진", NOW).past, true);
  assert.equal(findWhen("이번 달 5일 회비", NOW).past, true);
  const december = new Date("2026-12-20T10:00:00+09:00");
  assert.equal(findWhen("5일 시험", december).date, "2027-01-05"); // 전엔 13월이라 못 읽었다
  assert.equal(findWhen("다음 달 3일 개강 준비", december).date, "2027-01-03");
  assert.equal(findWhen("13/5 회의", NOW), null);
});

test("AI 없이: 날짜 + 시간대 말이면 일정(빈 시간 채움), 할 일 끝말이면 할 일. 역 출구, 할 일 이름의 '마감'", async () => {
  const at = new Date("2026-11-11T14:50:00+09:00"); // 예시 시각
  const lunch = await suggestEvent({}, "내일 점심 밥약", at);
  assert.deepEqual([lunch.title, lunch.date, lunch.time, lunch.end_time, lunch.by], ["밥약", "2026-11-12", "12:00", "13:00", "rule"]);
  assert.equal((await suggestEvent({}, "금요일 오전 실험", at)).time, "09:00");
  const errand = await suggestEvent({}, "내일 저녁에 장보기", at);
  assert.deepEqual([errand.kind, errand.title, errand.date], ["task", "장보기", "2026-11-12"]);
  assert.equal((await suggestEvent({}, "오늘 밤 과제 하기", at)).title, "과제 하기");
  assert.equal(await suggestEvent({}, "내일 1교시 휴강", at), null); // 시간대 말이 없으면 그대로 팝업 없음
  const exit = await suggestEvent({}, "토요일 오후 2시 홍대입구역 4번 출구에서 만나기", at);
  assert.equal(exit.place, "홍대입구역 4번 출구");
  const due = await suggestEvent({}, "금요일 23:59 마감 과제 제출", at);
  assert.deepEqual([due.kind, due.title, due.time], ["task", "과제 제출", "23:59"]);
  assert.equal((await suggestEvent({}, "금요일 마감", at)).title, "마감"); // 남는 게 없으면 그대로
});

test("날짜·시각이 아닌 말은 읽지 않는다", () => {
  for (const text of ["3시간 공부", "3.5시간 걸림", "한시적으로 운영", "한 시점에서 보면", "메일 보낼 것", "저녁에 장보기", "과제 아이디어 정리", "다음 주 수업 자료 읽기", "토익 2시간 공부"]) {
    assert.equal(findWhen(text, NOW), null, text);
  }
});

test("'어제'보다 앞으로 올 날을 먼저 고르고, 지난 날만 있으면 past", () => {
  assert.equal(findWhen("어제 못 간 스터디 내일 3시로", NOW).date, "2026-11-10");
  assert.equal(findWhen("어제 3시 회의", NOW).past, true);
  assert.equal(findWhen("지난주 금요일 7시 회식", NOW).past, true);
});

// ── 팝업 후보 합치기 ──

test("AI 없이(규칙만): 이름·장소를 쓴 말 그대로 뽑고, 시각 없는 일정 메모·지난 일은 팝업 없음, 마감은 할 일 팝업", () => {
  for (const c of CASES) {
    const p = mergePopup(c.text, findWhen(c.text, NOW), null);
    if (c.want.kind === "task") {
      assert.deepEqual(p, { kind: "task", title: c.want.title, date: c.want.date, time: c.want.time, by: "rule" }, c.text);
      continue;
    }
    if (!c.want.is_schedule || c.want.time === "?") {
      assert.equal(p, null, c.text);
      continue;
    }
    assert.equal(p.by, "rule");
    assert.deepEqual([p.title, p.place, p.date, p.time, p.end_time], [c.want.title, c.want.place, c.want.date, c.want.time, "?"], c.text);
  }
  assert.equal(mergePopup("오늘 4시", findWhen("오늘 4시", NOW), null).title, "?"); // 이름이 없으면 '?'
  const station = mergePopup("금 7시 회식 강남역", findWhen("금 7시 회식 강남역", NOW), null);
  assert.deepEqual([station.title, station.place], ["회식", "강남역"]);
  // 날짜 뒤 요일 꾸밈 "(금)"은 빼지만, '수업'·'토론'의 첫 글자는 요일로 먹지 않는다
  for (const [text, title] of [["11/13 수업 발표 3시", "수업 발표"], ["13일 토론 2시", "토론"], ["11/13(금) 7시 동아리", "동아리"], ["11월 20일 금요일 2시 세미나", "세미나"]]) {
    assert.equal(mergePopup(text, findWhen(text, NOW), null).title, title, text);
  }
});

test("AI 답과 합치기: 일정 아님 → null, 오전·오후 짐작은 AI, 날짜·끝 시각은 코드", () => {
  const w = (t) => findWhen(t, NOW);
  const ai = (title, time, place = "?") => ({ is_schedule: true, title, time, place }); // 11-10부터 답 칸은 4개
  assert.equal(mergePopup("내일 3시 스터디", w("내일 3시 스터디"), { is_schedule: false }, NOW), null);

  // 날짜를 안 쓴 "9시 영화": 규칙은 내일 09:00, AI가 21:00이라 하면 따르고 날짜는 코드가 다시 센다(지금 17:00 → 오늘)
  const movie = mergePopup("9시 영화", w("9시 영화"), ai("영화", "21:00"), NOW);
  assert.deepEqual([movie.date, movie.time, movie.by], ["2026-11-09", "21:00", "ai"]);
  // 끝 시각도 같이 12시간 옮긴다
  const range = mergePopup("9시~11시 영화", w("9시~11시 영화"), ai("영화", "21:00"), NOW);
  assert.deepEqual([range.date, range.time, range.end_time], ["2026-11-09", "21:00", "23:00"]);
  // 오후로 짐작한 "3시"를 AI가 03:00이라 하면 따르되, 날짜를 안 썼으니 다음에 오는 03:00(내일)
  const early = mergePopup("3시 택배", w("3시 택배"), ai("택배", "03:00"), NOW);
  assert.deepEqual([early.date, early.time], ["2026-11-10", "03:00"]);

  // 쓴 날짜·쓴 오후는 AI가 달리 말해도 정규식대로
  const fixed = mergePopup("다음주 화요일 오후 2시 면담", w("다음주 화요일 오후 2시 면담"), ai("면담", "02:00"), NOW);
  assert.deepEqual([fixed.date, fixed.time], ["2026-11-17", "14:00"]);

  // AI가 '?'로 둔 칸은 규칙으로 채우고, 규칙도 모르면 '?'
  const q = mergePopup("내일 3시 301동 스터디", w("내일 3시 301동 스터디"), ai("?", "?"), NOW);
  assert.deepEqual([q.title, q.place, q.time, q.end_time], ["스터디", "301동", "15:00", "?"]);

  // 시각 없는 날짜 메모는 AI가 일정이라 하면 시각 '?'로 팝업
  const exam = mergePopup("12월 3일 기말 발표", w("12월 3일 기말 발표"), ai("기말 발표", "?"), NOW);
  assert.deepEqual([exam.date, exam.time, exam.title], ["2026-12-03", "?", "기말 발표"]);
});

// ── AI 부르기 ──

function aiReply(input) {
  return new Response(
    JSON.stringify({ model: "claude-haiku-5-5", stop_reason: "tool_use", content: [{ type: "tool_use", name: "answer", input }], usage: { input_tokens: 500, output_tokens: 40 } }),
    { status: 200 },
  );
}

test("날짜·시각 말이 없는 지난 일·짧은 메모는 AI를 부르지 않는다", async () => {
  let calls = 0;
  const fetch = async () => (calls++, aiReply({}));
  assert.equal(await suggestEvent({ ANTHROPIC_API_KEY: "k" }, "점심 맛있었다", NOW, { fetch }), null);
  assert.equal(await suggestEvent({ ANTHROPIC_API_KEY: "k" }, "ㅋ", NOW, { fetch }), null);
  assert.equal(calls, 0);
});

test("할 일 메모(11-10 사람 요청): 날짜가 없어도 AI가 할 일이라 하면 '할 일로 넣을까요?', 그냥 메모면 팝업 없음", async () => {
  const ask = (input) => async () => aiReply(input);
  const todo = await suggestEvent({ ANTHROPIC_API_KEY: "k" }, "과제 아이디어 정리", NOW, {
    fetch: ask({ kind: "task", title: "과제 아이디어 정리", time: "?", place: "?" }),
  });
  assert.deepEqual(todo, { kind: "task", title: "과제 아이디어 정리", date: "?", time: "?", by: "ai" });
  // 마감 날짜는 정규식(AI에게 묻지 않는다), 이름은 AI
  const due = await suggestEvent({ ANTHROPIC_API_KEY: "k" }, "금요일까지 실험 보고서 내기", NOW, {
    fetch: ask({ kind: "task", title: "실험 보고서 내기", time: "?", place: "?" }),
  });
  assert.deepEqual(due, { kind: "task", title: "실험 보고서 내기", date: "2026-11-13", time: "?", by: "ai" });
  const note = await suggestEvent({ ANTHROPIC_API_KEY: "k" }, "앱 아이디어 - 위젯", NOW, {
    fetch: ask({ kind: "note", title: "앱 아이디어 - 위젯", time: "?", place: "?" }),
  });
  assert.equal(note, null);
  // 마감 시각의 오전·오후도 일정처럼 AI를 따른다(쓴 날짜가 없으면 그 시각이 다음에 오는 날)
  const night = await suggestEvent({ ANTHROPIC_API_KEY: "k" }, "9시까지 퀴즈 풀기", NOW, {
    fetch: ask({ kind: "task", title: "퀴즈 풀기", time: "21:00", place: "?" }),
  });
  assert.deepEqual([night.kind, night.date, night.time], ["task", "2026-11-09", "21:00"]);
  // 예전 답 모양(kind 없이 is_schedule만)도 받는다
  const old = await suggestEvent({ ANTHROPIC_API_KEY: "k" }, "내일 3시 스터디", NOW, {
    fetch: ask({ is_schedule: true, title: "스터디", time: "15:00", place: "?" }),
  });
  assert.equal(old.title, "스터디");
});

test("AI 없이 할 일 가리기: '-기'·'할 것'·'해야 함'·끝내는 일 낱말·마감 말", async () => {
  for (const text of ["동아리 회비 걷기 물어보기", "과제 3장까지 풀기", "엄마한테 전화", "토익 신청", "보고서 수정해야 함", "책 반납할 것", "중간고사 복습!"]) {
    assert.equal(looksLikeTodo(text, findWhen(text, NOW)), true, text);
  }
  for (const text of ["앱 아이디어 메모", "오늘 점심 맛있었다", "교수님 연구실 302호", "어제 보고서 제출했음"]) {
    assert.equal(looksLikeTodo(text, findWhen(text, NOW)), false, text);
  }
  // 키가 없으면 규칙으로 할 일 팝업(이름은 쓴 말 그대로)
  assert.deepEqual(await suggestEvent({}, "동아리 회비 걷기 물어보기", NOW), { kind: "task", title: "동아리 회비 걷기 물어보기", date: "?", time: "?", by: "rule" });
  assert.equal(await suggestEvent({}, "앱 아이디어 메모", NOW), null);
});

test("AI에게 지금 시각과 메모를 보내고, 답으로 팝업을 만들고, 사용량을 log에 남긴다", async () => {
  const DB = fakeD1();
  const user = addUser(DB);
  const ctx = fakeCtx();
  let sent;
  const fetch = async (_u, init) => {
    sent = JSON.parse(init.body);
    return aiReply({ is_schedule: true, title: "스터디", time: "15:00", place: "301동" });
  };
  const p = await suggestEvent({ ANTHROPIC_API_KEY: "k", DB }, "내일 3시 301동 스터디", NOW, { ctx, userId: user.id, fetch });
  await ctx.settle();

  assert.equal(sent.messages[0].content, "지금: 2026-11-09 (월) 17:00\n메모: 내일 3시 301동 스터디");
  assert.equal(sent.model, "claude-haiku-5-5");
  assert.deepEqual(p, { title: "스터디", date: "2026-11-10", time: "15:00", end_time: "16:00", place: "301동", by: "ai", guessed: ["end_time"] }); // 끝을 안 썼으면 1시간 = 추천(11-13)
  const log = DB.sqlite.prepare("SELECT action, detail FROM log").all();
  assert.equal(log.length, 1);
  assert.equal(log[0].action, "llm");
  assert.equal(JSON.parse(log[0].detail).use, "memo_popup");
  assert.ok(!log[0].detail.includes("스터디"), "메모 글은 log에 안 남긴다");
});

test("AI가 실패하면 규칙만으로 팝업을 만들고 llm_fail을 남긴다", async () => {
  const DB = fakeD1();
  const user = addUser(DB);
  const ctx = fakeCtx();
  const fetch = async () => new Response("overloaded", { status: 529 });
  const p = await suggestEvent({ ANTHROPIC_API_KEY: "k", DB }, "내일 3시 301동 스터디", NOW, { ctx, userId: user.id, fetch });
  await ctx.settle();
  assert.deepEqual([p.by, p.title, p.time], ["rule", "스터디", "15:00"]);
  assert.equal(DB.sqlite.prepare("SELECT action FROM log").get().action, "llm_fail");
});

// ── 주소 (/api/memo*) ──

const call = (env, user, method, path, body, ctx = fakeCtx()) =>
  handle(new Request(`https://x.test${path}`, { method, body: body && JSON.stringify(body) }), env, ctx, user).then(async (r) => ({
    status: r.status,
    body: await r.json(),
    ctx,
  }));

test("로그인 안 하면 401", async () => {
  const r = await call({ DB: fakeD1() }, null, "GET", "/api/memo");
  assert.equal(r.status, 401);
});

test("추천 칸(guessed): 쓰지 않았는데 채운 칸만 — 시각만 쓴 날짜, 빈 시간·내 일정에서 가져온 칸, 1시간 끝. 쓴 길이·쓴 끝은 정한 것", async () => {
  const at = new Date("2026-11-11T10:00:00+09:00"); // 예시 시각
  assert.equal((await suggestEvent({}, "내일 3시 스터디 301동에서", at)).guessed?.join(), "end_time");
  assert.equal((await suggestEvent({}, "내일 3시~5시 스터디", at)).guessed, undefined); // 다 썼다
  assert.equal((await suggestEvent({}, "내일 3시 스터디 2시간", at)).guessed, undefined); // 쓴 길이로 낸 끝은 정한 것
  assert.equal((await suggestEvent({}, "3시 스터디", at)).guessed?.join(), "date,end_time"); // 날짜 말이 없어 오늘로 짐작
  assert.equal((await suggestEvent({}, "내일 점심 밥약", at)).guessed?.join(), "time,end_time"); // 빈 시간에 넣어 봄
  assert.equal((await suggestEvent({}, "금요일까지 보고서 내기", at)).guessed, undefined); // 할 일 팝업은 그대로
});

test("끝을 안 정한 일정은 1시간(11-13 사람 요청): 팝업 끝 칸을 채우고, 끝 없이 저장해도 시작 + 1시간", async () => {
  const p = { title: "[예시] 스터디", date: "2026-11-20", time: "14:00", end_time: "?", place: "?", by: "ai" };
  assert.equal(withHour(p).end_time, "15:00");
  assert.equal(withHour({ ...p, time: "23:30" }).end_time, "23:59"); // 팝업은 날짜 칸이 하나라 자정 앞에서 멈춘다(useLength와 같게)
  assert.equal(withHour({ ...p, end_time: "16:30" }).end_time, "16:30"); // 쓴 끝·쓴 길이·내 일정의 끝이 먼저
  assert.equal(withHour({ ...p, time: "?" }).end_time, "?"); // 시각이 없으면 종일 그대로
  assert.deepEqual(withHour({ kind: "task", title: "[예시] 보고서", date: "2026-11-20", time: "?" }), { kind: "task", title: "[예시] 보고서", date: "2026-11-20", time: "?" });
  assert.equal(withHour(null), null);

  // 저장: 끝을 안 보내거나 시작보다 이른 끝 → 시작 + 1시간, 자정을 넘으면 다음 날
  const DB = fakeD1();
  const user = addUser(DB);
  const env = { DB };
  const save = async (fields) => {
    const { body } = await call(env, user, "POST", "/api/memo", { text: "[예시] 메모" });
    return (await call(env, user, "POST", `/api/memo/${body.memo.id}/save`, { title: "[예시] 일정", date: "2026-11-20", place: "?", ...fields })).body.event;
  };
  assert.equal((await save({ time: "14:00", end_time: "?" })).end, "2026-11-20T15:00:00+09:00");
  assert.equal((await save({ time: "14:00" })).end, "2026-11-20T15:00:00+09:00");
  assert.equal((await save({ time: "14:00", end_time: "13:00" })).end, "2026-11-20T15:00:00+09:00");
  assert.equal((await save({ time: "23:30", end_time: "?" })).end, "2026-11-21T00:30:00+09:00");
  assert.equal((await save({ time: "14:00", end_time: "16:30" })).end, "2026-11-20T16:30:00+09:00");
  assert.deepEqual(Object.values(await save({ time: "?", end_time: "?" })).slice(2, 4), ["2026-11-20", "2026-11-21"]); // 종일은 그대로
});

test("메모 쓰기 → 목록 → 팝업 저장 → 일정 생김 → 고쳐 저장 → 지우기", async () => {
  const DB = fakeD1();
  const env = { DB }; // 키 없음 → 규칙 팝업 (예시 메모는 날짜·시각을 다 써서 오늘 날짜와 상관없다)
  const user = addUser(DB);

  const added = await call(env, user, "POST", "/api/memo", { text: "2026-11-20 14:00 301동 발표 연습" });
  assert.equal(added.status, 200);
  const { memo, popup } = added.body;
  assert.match(memo.created_at, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\+09:00$/);
  assert.deepEqual(popup, { title: "발표 연습", date: "2026-11-20", time: "14:00", end_time: "15:00", place: "301동", by: "rule", guessed: ["end_time"] });

  await call(env, user, "POST", "/api/memo", { text: "장보기 목록 정리" });
  const list = await call(env, user, "GET", "/api/memo");
  assert.deepEqual(list.body.memos.map((m) => [m.text, m.event_id, m.task_id]), [["2026-11-20 14:00 301동 발표 연습", null, null], ["장보기 목록 정리", null, null]]);

  // 그대로 저장 → popup_save
  const saved = await call(env, user, "POST", `/api/memo/${memo.id}/save`, { ...popup, suggested: popup });
  await saved.ctx.settle();
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.body.event, { id: saved.body.event.id, title: "발표 연습", start: "2026-11-20T14:00:00+09:00", end: "2026-11-20T15:00:00+09:00", place: "301동", source: "memo" });
  assert.equal(DB.sqlite.prepare("SELECT handled FROM memos WHERE id = ?").get(memo.id).handled, 1);
  assert.equal(DB.sqlite.prepare("SELECT ext_id FROM events").get().ext_id, `memo:${memo.id}`);

  // 고쳐서 다시 저장 → 같은 일정이 바뀜(중복 없음), popup_edit
  const edited = await call(env, user, "POST", `/api/memo/${memo.id}/save`, { ...popup, title: "발표 리허설", end_time: "15:30", suggested: popup });
  await edited.ctx.settle();
  assert.equal(edited.body.event.id, saved.body.event.id);
  assert.equal(edited.body.event.end, "2026-11-20T15:30:00+09:00");
  assert.equal(DB.sqlite.prepare("SELECT count(*) AS n FROM events").get().n, 1);
  assert.deepEqual(DB.sqlite.prepare("SELECT action FROM log ORDER BY id").all().map((r) => r.action), ["popup_save", "popup_edit"]);

  // 밤 정리가 이 메모로 할 일을 만들었다면 task_id가 붙는다
  const shopping = list.body.memos[1];
  DB.sqlite.prepare("INSERT INTO tasks (user_id, title, source, ext_id) VALUES (?, '장보기 목록 정리', 'memo', ?)").run(user.id, `memo:${shopping.id}`);
  const list2 = await call(env, user, "GET", "/api/memo?limit=1");
  assert.deepEqual(list2.body.memos.map((m) => m.text), ["장보기 목록 정리"]); // 가장 최근 1개
  assert.ok(list2.body.memos[0].task_id);
  const older = await call(env, user, "GET", `/api/memo?before=${list2.body.memos[0].id}`);
  assert.equal(older.body.memos[0].event_id, saved.body.event.id);

  assert.equal((await call(env, user, "DELETE", `/api/memo/${memo.id}`)).status, 200);
  assert.equal((await call(env, user, "DELETE", `/api/memo/${memo.id}`)).status, 404);
});

test("메모 모두 지우기: confirm 없으면 400, 내 메모만 지우고 메모로 만든 일정은 남는다", async () => {
  const DB = fakeD1();
  const env = { DB };
  const user = addUser(DB, { email: "a@example.com", googleSub: "a" });
  const other = addUser(DB, { email: "b@example.com", googleSub: "b" });
  for (const text of ["장보기", "생각 하나"]) await call(env, user, "POST", "/api/memo", { text });
  await call(env, other, "POST", "/api/memo", { text: "남의 메모" });
  DB.sqlite.prepare("INSERT INTO events (user_id, title, start, source, ext_id) VALUES (?, '예시 일정', '2026-11-20T10:00:00+09:00', 'memo', 'memo:1')").run(user.id);
  assert.equal((await call(env, user, "DELETE", "/api/memo")).status, 400);
  const r = await call(env, user, "DELETE", "/api/memo", { confirm: true });
  assert.deepEqual(r.body, { ok: true, deleted: 2 });
  assert.equal((await call(env, user, "GET", "/api/memo")).body.memos.length, 0);
  assert.equal((await call(env, other, "GET", "/api/memo")).body.memos.length, 1);
  assert.equal(DB.sqlite.prepare("SELECT count(*) AS n FROM events").get().n, 1);
});

test("시각 없이 저장하면 종일 일정(날짜만), 취소는 log만 남기고 메모는 그대로", async () => {
  const DB = fakeD1();
  const env = { DB };
  const user = addUser(DB);
  const { body } = await call(env, user, "POST", "/api/memo", { text: "12월 3일 기말 발표" });
  assert.equal(body.popup, null); // 키 없음 + 시각 없음 → 팝업 없음 (AI가 있으면 시각 '?' 팝업)

  const saved = await call(env, user, "POST", `/api/memo/${body.memo.id}/save`, { title: "기말 발표", date: "2026-12-03", time: "?", end_time: "?", place: "?" });
  assert.deepEqual([saved.body.event.start, saved.body.event.end, saved.body.event.place], ["2026-12-03", "2026-12-04", null]); // 종일 일정 end = 다음 날(schema.sql)

  const other = await call(env, user, "POST", "/api/memo", { text: "내일 3시 스터디" });
  const cancel = await call(env, user, "POST", `/api/memo/${other.body.memo.id}/cancel`);
  await cancel.ctx.settle();
  assert.equal(cancel.status, 200);
  assert.equal(DB.sqlite.prepare("SELECT handled FROM memos WHERE id = ?").get(other.body.memo.id).handled, 0);
  assert.equal(DB.sqlite.prepare("SELECT action FROM log WHERE action = 'popup_cancel'").all().length, 1);
});

test("할 일 팝업 저장 → 할 일 생김(밤 정리와 같은 줄), 다시 저장은 같은 줄, 할 일 팝업 취소는 메모로만", async () => {
  const DB = fakeD1();
  const env = { DB };
  const user = addUser(DB);
  const added = await call(env, user, "POST", "/api/memo", { text: "다음주 월요일까지 유기화학 과제 제출" });
  const { memo, popup } = added.body;
  assert.equal(popup.kind, "task");

  const saved = await call(env, user, "POST", `/api/memo/${memo.id}/save`, { ...popup, suggested: popup });
  await saved.ctx.settle();
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.body.task, { id: saved.body.task.id, title: "유기화학 과제 제출", due: "2026-11-16T23:59:00+09:00", minutes: null, ready: 1, done: 0, source: "memo" });
  assert.equal(DB.sqlite.prepare("SELECT ext_id FROM tasks").get().ext_id, `memo:${memo.id}`);
  assert.equal(DB.sqlite.prepare("SELECT handled FROM memos WHERE id = ?").get(memo.id).handled, 1);

  const again = await call(env, user, "POST", `/api/memo/${memo.id}/save`, { kind: "task", title: "유기화학 과제", date: "2026-11-16", time: "18:00", suggested: popup });
  await again.ctx.settle();
  assert.equal(again.body.task.id, saved.body.task.id);
  assert.equal(again.body.task.due, "2026-11-16T18:00:00+09:00");
  assert.equal(DB.sqlite.prepare("SELECT count(*) AS n FROM tasks").get().n, 1);
  assert.deepEqual(DB.sqlite.prepare("SELECT action FROM log ORDER BY id").all().map((r) => r.action), ["popup_save", "popup_edit"]);
  assert.ok((await call(env, user, "GET", "/api/memo")).body.memos[0].task_id);

  // 마감 없이도 저장된다, 이름은 있어야 한다
  const plain = await call(env, user, "POST", "/api/memo", { text: "토익 신청" });
  const noDue = await call(env, user, "POST", `/api/memo/${plain.body.memo.id}/save`, { kind: "task", title: "토익 신청", date: "?", time: "?" });
  assert.equal(noDue.body.task.due, null);
  assert.equal((await call(env, user, "POST", `/api/memo/${plain.body.memo.id}/save`, { kind: "task", title: "?" })).status, 400);

  const skip = await call(env, user, "POST", "/api/memo", { text: "엄마한테 전화" });
  const cancel = await call(env, user, "POST", `/api/memo/${skip.body.memo.id}/cancel`, { kind: "task" });
  await cancel.ctx.settle();
  assert.equal(DB.sqlite.prepare("SELECT handled FROM memos WHERE id = ?").get(skip.body.memo.id).handled, 1, "밤 정리가 할 일로 다시 만들지 않게");
});

test("한 메모에 할 일 여럿(11-12 사람 요청): AI가 고친 이름 · 나머지(also) · 어림한 분 → 저장하면 할 일이 따로따로", async () => {
  const fetch = async () => aiReply({ kind: "task", title: "도서관 책 반납", time: "?", place: "?", minutes: 22, also: [{ title: "장학금 서류 제출", minutes: 30 }, { title: " ", minutes: 5 }] });
  const popup = await suggestEvent({ ANTHROPIC_API_KEY: "k" }, "도서관 책 반납, 장학금 서류 재출", NOW, { fetch });
  assert.deepEqual(popup, { kind: "task", title: "도서관 책 반납", date: "?", time: "?", minutes: 20, also: [{ title: "장학금 서류 제출", minutes: 30 }], by: "ai" });
  // AI가 없으면 쉼표로만 나눈다(오타는 그대로)
  const rule = await suggestEvent({}, "금요일까지 책 반납, 서류 재출", NOW);
  assert.deepEqual([rule.title, rule.also, rule.date], ["책 반납", [{ title: "서류 재출", minutes: null }], "2026-11-13"]);

  const DB = fakeD1();
  const env = { DB };
  const user = addUser(DB);
  const { memo } = (await call(env, user, "POST", "/api/memo", { text: "도서관 책 반납, 장학금 서류 재출" })).body;
  const saved = await call(env, user, "POST", `/api/memo/${memo.id}/save`, { ...popup, date: "2026-11-13", suggested: popup });
  await saved.ctx.settle();
  assert.deepEqual(saved.body.tasks.map((t) => [t.title, t.minutes, t.due]), [
    ["도서관 책 반납", 20, "2026-11-13T23:59:00+09:00"],
    ["장학금 서류 제출", 30, "2026-11-13T23:59:00+09:00"],
  ]);
  assert.equal(saved.body.task.id, saved.body.tasks[0].id);
  assert.deepEqual(DB.sqlite.prepare("SELECT ext_id FROM tasks ORDER BY id").all().map((r) => r.ext_id), [`memo:${memo.id}`, `memo:${memo.id}:2`]);
});

test("잘못된 요청과 남의 메모", async () => {
  const DB = fakeD1();
  const env = { DB };
  const me = addUser(DB);
  const other = addUser(DB, { email: "other@example.com", googleSub: "sub-other" });
  assert.equal((await call(env, me, "POST", "/api/memo", { text: "   " })).status, 400);
  assert.equal((await call(env, me, "POST", "/api/memo", { text: "가".repeat(1001) })).status, 400);

  const { body } = await call(env, me, "POST", "/api/memo", { text: "내일 3시 스터디" });
  assert.equal((await call(env, me, "POST", `/api/memo/${body.memo.id}/save`, { title: "스터디", date: "?" })).status, 400);
  assert.equal((await call(env, other, "POST", `/api/memo/${body.memo.id}/save`, { title: "x", date: "2026-11-10" })).status, 404);
  assert.equal((await call(env, other, "POST", `/api/memo/${body.memo.id}/cancel`)).status, 404);
  assert.equal((await call(env, other, "DELETE", `/api/memo/${body.memo.id}`)).status, 404);
  assert.equal((await call(env, me, "GET", "/api/memo/abc")).status, 404);
  assert.equal((await call(env, other, "GET", "/api/memo")).body.memos.length, 0);
});

test("시각 글자 모양", () => {
  assert.equal(isoKst(new Date("2026-11-09T08:02:03Z")), "2026-11-09T17:02:03+09:00");
  assert.equal(nowLabel(new Date("2026-11-09T15:30:00Z")), "2026-11-10 (화) 00:30");
});

// ── 아는 일정으로 채우기 (lib/known.js): AI에게는 일정을 안 보낸다 ──

import { abbreviates, likeness, useKnown, suggestFree, lengthOf, useLength } from "../lib/known.js";

// 지어낸 일정: 월·수 09:30 수업, 수요일 시험, 금요일 기말
const weekly = (title, firstDate, n, time, end, place = null) =>
  Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.parse(`${firstDate}T00:00:00Z`) + i * 7 * 86400000).toISOString().slice(0, 10);
    return { title, start: `${d}T${time}:00+09:00`, end: `${d}T${end}:00+09:00`, place };
  });
const KNOWN = [
  ...weekly("공학수학 2", "2026-11-02", 6, "09:30", "10:45", "43-1동 201호"), // 월
  ...weekly("공학수학 2", "2026-11-04", 6, "09:30", "10:45", "43-1동 201호"), // 수
  { title: "공학수학 2 중간 2", start: "2026-11-11T09:30:00+09:00", end: "2026-11-11T10:45:00+09:00", place: null },
  { title: "공학수학 2 기말", start: "2026-12-18T18:00:00+09:00", end: null, place: null },
  { title: "공부방 · 공학수학 중간2 · 모의시험", start: "2026-11-10T20:30:00+09:00", end: null, place: null },
].map((e, i) => ({ id: i + 1, ...e }));
const base = (o) => ({ title: "?", date: "2026-11-16", time: "?", end_time: "?", place: "?", by: "ai", ...o });

test("줄임말: 글자를 순서대로 고른 말, 첫 글자는 같아야 한다", () => {
  assert.ok(abbreviates("공수2", "공학수학2"));
  assert.ok(abbreviates("공수", "공학수학2"));
  assert.ok(!abbreviates("수학", "공학수학2")); // 첫 글자가 다름
  assert.ok(!abbreviates("공", "공학수학2")); // 한 글자는 안 봄
  assert.ok(!abbreviates("데이터", "데이트"));
  assert.equal(likeness(["과제"], "공학수학 2"), null);
});

test("시각을 모르면 내 수업의 그 요일 시각·장소로 채운다 (줄임말도)", () => {
  for (const title of ["공학수학 2 휴강", "공수2 휴강", "공수 휴강"]) {
    const p = useKnown(base({ title }), `${title} 16일`, KNOWN, "2026-11-10");
    assert.deepEqual([p.title, p.time, p.end_time, p.place, p.from], [title, "09:30", "10:45", "43-1동 201호", "공학수학 2"], title);
    assert.equal(p.change, undefined);
  }
  // 수업이 없는 요일(화)이면 그대로 '?'
  assert.equal(useKnown(base({ title: "공수 보강", date: "2026-11-17" }), "공수 보강 17일", KNOWN, "2026-11-10").time, "?");
  // 메모에 시각이 있으면 건드리지 않는다
  const own = useKnown(base({ title: "공수 스터디", time: "19:00" }), "16일 7시 공수 스터디", KNOWN, "2026-11-10");
  assert.deepEqual([own.time, own.place, own.from], ["19:00", "?", undefined]);
  // 닮은 이름이 둘이면(1등이 비김) 채우지 않는다
  const two = [...KNOWN, ...weekly("공학수학 1", "2026-11-02", 6, "13:00", "14:15").map((e, i) => ({ id: 100 + i, ...e }))];
  assert.equal(useKnown(base({ title: "공수 휴강" }), "공수 휴강 16일", two, "2026-11-10").time, "?");
  assert.equal(useKnown(base({ title: "공수2 휴강" }), "공수2 휴강 16일", two, "2026-11-10").time, "09:30");
});

test("일정 변경: 옮길 일정을 찾고, 이름에서 '변경' 말을 뺀다", () => {
  const p = useKnown(base({ title: "공학수학 2 중간고사" }), "공학수학 2 중간고사 11월 16일로 변경", KNOWN, "2026-11-10");
  assert.equal(p.change.title, "공학수학 2 중간 2"); // 기말·공부방 일정이 아니라
  assert.deepEqual([p.title, p.time, p.end_time, p.from], ["공학수학 2 중간고사", "09:30", "10:45", "공학수학 2"]);
  // 수업 없는 날로 옮기면 옛 시각 그대로
  const fri = useKnown(base({ title: "공수2 기말 로 변경", date: "2026-12-19" }), "공수2 기말 12월 19일로 변경", KNOWN, "2026-11-10");
  assert.deepEqual([fri.title, fri.change.title, fri.time, fri.end_time], ["공수2 기말", "공학수학 2 기말", "18:00", "?"]);
  // '변경' 말이 없으면 옮기지 않는다 · 지난 일정은 옮길 것이 아니다
  assert.equal(useKnown(base({ title: "공학수학 2 중간고사" }), "공학수학 2 중간고사 11월 16일", KNOWN, "2026-11-10").change, undefined);
  assert.equal(useKnown(base({ title: "공학수학 2 중간고사" }), "공학수학 2 중간고사 16일로 변경", KNOWN, "2026-11-12").change.title, "공학수학 2 기말");
});

test("메모 → 팝업(내 일정 반영) → 옮겨 저장: 옛 일정은 달력에서 가려지고, 새 일정을 지우면 돌아온다", async () => {
  const DB = fakeD1();
  const user = addUser(DB);
  const other = addUser(DB, { email: "other@example.com", googleSub: "sub-other" });
  const add = DB.sqlite.prepare(`INSERT INTO events (user_id, title, start, "end", place, source, ext_id) VALUES (?, ?, ?, ?, ?, 'google', ?) RETURNING id`);
  const ids = KNOWN.map((e, i) => add.get(user.id, e.title, e.start, e.end, e.place, `g${i}`).id);
  const oldId = ids[KNOWN.findIndex((e) => e.title === "공학수학 2 중간 2")];
  const theirs = add.get(other.id, "공학수학 2 중간 2", "2026-11-11T09:30:00+09:00", null, null, "x").id;

  let sent;
  const fetch = async (_u, init) => {
    sent = init.body;
    return aiReply({ is_schedule: true, title: "공학수학 2 중간고사", date: "2026-11-16", time: "?", end_time: "?", place: "?" });
  };
  const text = "공학수학 2 중간고사 11월 16일로 변경";
  const popup = await suggestEvent({ ANTHROPIC_API_KEY: "k", DB }, text, new Date("2026-11-10T15:42:00+09:00"), { userId: user.id, fetch });
  assert.ok(!sent.includes("43-1동") && !sent.includes("중간 2"), "내 일정은 AI에게 보내지 않는다");
  assert.deepEqual(popup, {
    title: "공학수학 2 중간고사", date: "2026-11-16", time: "09:30", end_time: "10:45", place: "43-1동 201호", by: "ai",
    from: "공학수학 2", change: { id: oldId, title: "공학수학 2 중간 2", start: "2026-11-11T09:30:00+09:00" },
    guessed: ["time", "end_time", "place"], // 메모에 없던 시각·장소를 내 일정에서 가져옴 = 추천
  });

  const memo = DB.sqlite.prepare("INSERT INTO memos (user_id, text) VALUES (?, ?) RETURNING id").get(user.id, text);
  const saved = await call({ DB }, user, "POST", `/api/memo/${memo.id}/save`, { ...popup, suggested: popup, change_id: popup.change.id });
  await saved.ctx.settle();
  assert.equal(saved.body.event.start, "2026-11-16T09:30:00+09:00");
  const movedTo = (id) => DB.sqlite.prepare("SELECT moved_to FROM events WHERE id = ?").get(id).moved_to;
  assert.equal(movedTo(oldId), saved.body.event.id);
  assert.deepEqual(JSON.parse(DB.sqlite.prepare("SELECT detail FROM log WHERE action = 'popup_save'").get().detail), { memo_id: memo.id, by: "ai", known: true, moved: true });

  // 남의 일정 id를 줘도 건드리지 않는다
  const memo2 = DB.sqlite.prepare("INSERT INTO memos (user_id, text) VALUES (?, ?) RETURNING id").get(user.id, "x");
  await call({ DB }, user, "POST", `/api/memo/${memo2.id}/save`, { title: "x", date: "2026-11-20", change_id: theirs });
  assert.equal(movedTo(theirs), null);

  // 달력(7_items)에는 옛 일정이 안 보이고, 새 일정을 지우면 다시 보인다
  const items = await import("../7_items.js");
  const week = async () => (await (await items.handle(new Request("https://x.test/api/events?from=2026-11-09&to=2026-11-18"), { DB }, fakeCtx(), user)).json()).events.map((e) => e.title);
  assert.ok(!(await week()).includes("공학수학 2 중간 2") && (await week()).includes("공학수학 2 중간고사"));
  await items.handle(new Request(`https://x.test/api/events/${saved.body.event.id}`, { method: "DELETE" }), { DB }, fakeCtx(), user);
  assert.ok((await week()).includes("공학수학 2 중간 2") && !(await week()).includes("공학수학 2 중간고사"));
});

test("시간대만 쓴 메모: 그 시간대에서 비어 있는 1시간을 고른다 (없으면 종일 그대로)", () => {
  const at = (a, b) => ({ start: `2026-11-12T${a}:00+09:00`, end: b ? `2026-11-12T${b}:00+09:00` : null });
  const p = base({ title: "조 모임", date: "2026-11-12" });
  const NOW = "2026-11-11T09:00:00+09:00";
  const pick = (text, busy = [], now = NOW, popup = p) => {
    const r = suggestFree(popup, text, busy, now);
    return r.free ? `${r.time}~${r.end_time}` : r.time;
  };
  assert.equal(pick("11월 12일 늦은 밤에 조 모임"), "22:00~23:00");
  assert.equal(suggestFree(p, "11월 12일 늦은 밤에 조 모임", [], NOW).free, "늦은 밤");
  assert.equal(pick("11월 12일 늦은 밤에 조 모임", [at("21:00", "22:30")]), "22:30~23:30");
  assert.equal(pick("11월 12일 늦은 밤에 조 모임", [at("22:00", null)]), "23:00~23:59"); // 끝을 모르는 일정은 1시간으로 본다. 자정은 23:59
  assert.equal(pick("11월 12일 늦은 밤에 조 모임", [at("21:00", "23:30")]), "?"); // 빈 1시간이 없으면 종일
  assert.equal(pick("12일 저녁 약속", [{ start: "2026-11-12", end: "2026-11-13" }]), "18:00~19:00"); // 종일 일정은 안 막는다
  assert.equal(pick("12일 저녁 약속", [{ start: "2026-11-11T23:00:00+09:00", end: "2026-11-12T19:00:00+09:00" }]), "19:00~20:00"); // 전날부터 이어진 일정
  assert.equal(pick("12일 오후에 면담", [], "2026-11-12T14:10:00+09:00"), "14:30~15:30"); // 오늘이면 지금 뒤
  assert.equal(pick("12일 조 모임"), "?"); // 시간대 말이 없으면 그대로
  assert.equal(pick("12일 밤샘 과제"), "?"); // 낱말 속 '밤'은 아님
  assert.equal(pick("12일 밤에 회의", [], NOW, { ...p, time: "19:00" }), "19:00"); // 시각이 이미 있으면 안 건드린다
  assert.equal(suggestFree({ ...p, title: "늦은 밤에 조 모임" }, "11월 12일 늦은 밤에 조 모임", [], NOW).title, "조 모임");
});

test("메모 → 팝업: 시간대만 쓰면 DB의 그날 내 일정을 피해 고른다 (남의 일정·가려진 일정은 안 본다)", async () => {
  const DB = fakeD1();
  const user = addUser(DB);
  const other = addUser(DB, { email: "other@example.com", googleSub: "sub-other" });
  const add = DB.sqlite.prepare(`INSERT INTO events (user_id, title, start, "end", source, ext_id, moved_to) VALUES (?, '동아리', ?, ?, 'google', ?, ?)`);
  add.run(user.id, "2026-11-12T22:00:00+09:00", "2026-11-12T22:30:00+09:00", "a", null);
  add.run(user.id, "2026-11-12T22:30:00+09:00", "2026-11-12T23:30:00+09:00", "b", 1); // 가려진 일정
  add.run(other.id, "2026-11-12T22:30:00+09:00", "2026-11-12T23:30:00+09:00", "c", null);
  const fetch = async () => aiReply({ is_schedule: true, title: "조 모임", date: "2026-11-12", time: "?", end_time: "?", place: "?" });
  const popup = await suggestEvent({ ANTHROPIC_API_KEY: "k", DB }, "11월 12일 늦은 밤에 조 모임", new Date("2026-11-11T09:17:00+09:00"), { userId: user.id, fetch });
  assert.deepEqual(popup, { title: "조 모임", date: "2026-11-12", time: "22:30", end_time: "23:30", place: "?", by: "ai", free: "늦은 밤", guessed: ["time", "end_time"] });
});

test("길이를 쓴 메모: '2시간'을 읽어 빈 시간도 그 길이로 고르고, 시작만 알면 끝을 채운다", () => {
  const minutes = (text) => lengthOf(text)?.minutes ?? null;
  assert.equal(minutes("산책 2시간"), 120);
  assert.equal(minutes("산책 1시간 반"), 90);
  assert.equal(minutes("산책 1.5시간"), 90);
  assert.equal(minutes("산책 1시간 30분"), 90);
  assert.equal(minutes("40분 산책"), 40);
  assert.equal(minutes("2시간 뒤 회의"), null); // 지금부터 2시간 뒤 = 길이가 아님
  assert.equal(minutes("10분 전 도착"), null);
  assert.equal(minutes("3시 30분 회의"), null); // 시각
  assert.equal(minutes("24시간 카페"), null);
  assert.equal(minutes("조 모임"), null);

  const at = (a, b) => ({ start: `2026-11-12T${a}:00+09:00`, end: `2026-11-12T${b}:00+09:00` });
  const p = base({ title: "산책 2시간", date: "2026-11-12" });
  const NOW = "2026-11-11T09:00:00+09:00";
  const pick = (text, busy, m) => {
    const r = suggestFree(p, text, busy, NOW, m);
    return r.free ? `${r.time}~${r.end_time}` : r.time;
  };
  assert.equal(pick("12일 아침에 산책 2시간", [at("08:00", "08:30")], 120), "08:30~10:30"); // 시작 뒤 1시간만 시간대(8~10시) 안이면 된다
  assert.equal(pick("12일 아침에 산책 2시간", [at("08:00", "08:30"), at("10:00", "11:00")], 120), "?"); // 2시간이 통째로 비어야 한다
  assert.equal(pick("12일 아침에 산책", [at("08:00", "08:30")]), "08:30~09:30"); // 길이를 안 쓰면 1시간
  assert.equal(pick("12일 늦은 밤에 산책 2시간", [], 120), "22:00~23:59");
  assert.equal(pick("12일 늦은 밤에 산책 2시간", [at("22:00", "22:30")], 120), "?"); // 자정은 넘지 않는다
  assert.equal(pick("12일 점심에 산책 40분", [at("12:00", "12:30")], 40), "12:30~13:10");

  const len = lengthOf("12일 7시 산책 2시간");
  assert.deepEqual(useLength({ ...p, time: "19:00" }, len), { ...p, title: "산책", time: "19:00", end_time: "21:00" });
  assert.equal(useLength({ ...p, time: "19:00", end_time: "20:00" }, len).end_time, "20:00"); // 끝을 썼으면 그대로
  assert.equal(useLength({ ...p, time: "23:00" }, len).end_time, "23:59");
  assert.equal(useLength(p, len).end_time, "?"); // 시작을 모르면 종일 그대로
  assert.equal(useLength(p, null), p);
});

test("매주 메모 → 팝업에 repeat, 저장하면 학기 끝까지 주마다 한 줄 (끄고 저장하면 하루만)", async () => {
  const DB = fakeD1();
  const user = addUser(DB);
  DB.sqlite
    .prepare(`INSERT INTO events (user_id, title, start, "end", source, ext_id) VALUES (?, '동아리', '2026-11-12T08:00:00+09:00', '2026-11-12T08:30:00+09:00', 'google', 'a')`)
    .run(user.id);
  const fetch = async () => aiReply({ is_schedule: true, title: "산책 2시간", date: "2026-11-12", time: "?", end_time: "?", place: "?" });
  const now = new Date("2026-11-11T09:27:00+09:00"); // 수요일
  const popup = await suggestEvent({ ANTHROPIC_API_KEY: "k", DB }, "매주 목요일마다 아침에 산책 2시간", now, { userId: user.id, fetch });
  assert.deepEqual(popup, { title: "산책", date: "2026-11-12", time: "08:30", end_time: "10:30", place: "?", by: "ai", free: "아침", guessed: ["time", "end_time"], repeat: { until: "2026-12-14" } });

  // AI 없이(규칙): 이름에서 '매주'·'마다'·'2시간'이 빠지고 끝 = 시작 + 2시간
  const rule = await suggestEvent({}, "매주 목요일마다 저녁 7시 산책 2시간", now);
  assert.deepEqual(rule, { title: "산책", date: "2026-11-12", time: "19:00", end_time: "21:00", place: "?", by: "rule", repeat: { until: "2026-12-14" } });
  assert.equal((await suggestEvent({}, "격주 목요일마다 저녁 7시 산책", now)).repeat, undefined);
  assert.equal((await suggestEvent({}, "목요일 저녁 7시 산책", now)).repeat, undefined);

  const env = { DB };
  const memo = (await call(env, user, "POST", "/api/memo", { text: "매주 목요일마다 저녁 7시 산책 2시간" })).body.memo;
  const saved = await call(env, user, "POST", `/api/memo/${memo.id}/save`, { ...rule, suggested: rule, repeat: true });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.repeat, 5);
  assert.equal(saved.body.event.start, "2026-11-12T19:00:00+09:00");
  const rows = DB.sqlite.prepare(`SELECT start, "end", ext_id FROM events WHERE source = 'memo' ORDER BY start`).all();
  assert.deepEqual(rows.map((r) => r.start.slice(0, 16)), ["2026-11-12T19:00", "2026-11-19T19:00", "2026-11-26T19:00", "2026-12-03T19:00", "2026-12-10T19:00"]);
  assert.ok(rows.every((r) => r.end.slice(11, 16) === "21:00"));
  assert.deepEqual(rows.map((r) => r.ext_id), [`memo:${memo.id}`, ...[1, 2, 3, 4].map((n) => `memo:${memo.id}:w${n}`)]);
  // 메모 목록에는 한 줄, 첫 주 일정에 이어진다. 같은 저장을 다시 보내도 줄이 늘지 않는다
  const list = await call(env, user, "GET", "/api/memo");
  assert.deepEqual(list.body.memos.map((m) => m.event_id), [saved.body.event.id]);
  await call(env, user, "POST", `/api/memo/${memo.id}/save`, { ...rule, suggested: rule, repeat: true });
  assert.equal(DB.sqlite.prepare("SELECT count(*) AS n FROM events WHERE source = 'memo'").get().n, 5);

  // 체크를 끄고 저장(repeat 없음) → 하루만. popup을 그대로 펼쳐 보내도(repeat가 객체) 매주로 넣지 않는다
  const once = (await call(env, user, "POST", "/api/memo", { text: "매주 금요일마다 저녁 7시 독서" })).body;
  const one = await call(env, user, "POST", `/api/memo/${once.memo.id}/save`, { ...once.popup, suggested: once.popup });
  assert.equal(one.body.repeat, undefined);
  assert.equal(DB.sqlite.prepare("SELECT count(*) AS n FROM events WHERE title = '독서'").get().n, 1);
});

test("일정 전에 끝낼 할 일(prep, 11-14 '여행 전 항공권·숙박은 여행까지 할 일'): 팝업에 실리고, 저장하면 마감 = 일정 시작(종일이면 전날 밤)", async () => {
  const w = (t) => findWhen(t, NOW);
  const text = "11월 20일 제주 여행, 그 전에 항공권이랑 숙소 예매";
  const ai = { kind: "schedule", title: "제주 여행", time: "?", place: "?", prep: [{ title: "항공권 예매", minutes: 30 }, { title: " ", minutes: 5 }, { title: "숙소 예매", minutes: 30 }] };
  const popup = mergePopup(text, w(text), ai, NOW);
  assert.deepEqual(popup.prep, [{ title: "항공권 예매", minutes: 30 }, { title: "숙소 예매", minutes: 30 }]); // 빈 이름은 버림
  assert.equal(mergePopup("내일 3시 스터디", w("내일 3시 스터디"), { kind: "schedule", title: "스터디", time: "15:00", place: "?" }, NOW).prep, undefined);

  const DB = fakeD1();
  const env = { DB };
  const user = addUser(DB);
  const { body } = await call(env, user, "POST", "/api/memo", { text });
  const allDay = await call(env, user, "POST", `/api/memo/${body.memo.id}/save`, { title: "제주 여행", date: "2026-11-20", time: "?", end_time: "?", place: "?", prep: popup.prep });
  assert.deepEqual(allDay.body.tasks.map((t) => [t.title, t.due, t.source]), [
    ["항공권 예매", "2026-11-19T23:59:00+09:00", "memo"],
    ["숙소 예매", "2026-11-19T23:59:00+09:00", "memo"],
  ]);
  // 시각 있는 일정(합주)은 시작 시각이 마감, 다시 저장해도 같은 줄
  const band = await call(env, user, "POST", "/api/memo", { text: "토요일 2시 합주 전에 2악장 연습" });
  const save = () => call(env, user, "POST", `/api/memo/${band.body.memo.id}/save`, { title: "합주", date: "2026-11-14", time: "14:00", place: "?", prep: [{ title: "2악장 연습", minutes: 60 }] });
  assert.deepEqual((await save()).body.tasks.map((t) => t.due), ["2026-11-14T14:00:00+09:00"]);
  await save();
  assert.equal(DB.sqlite.prepare("SELECT count(*) AS n FROM tasks WHERE title = '2악장 연습'").get().n, 1);
});

test("메모 길이로 모델 고르기(11-14): 짧은 메모는 빠른 모델, 120자 넘거나 세 줄 넘는 메모는 똑똑한 모델", async () => {
  const models = [];
  const fetch = async (_u, init) => {
    const b = JSON.parse(init.body);
    models.push([b.model, b.max_tokens]);
    return aiReply({ kind: "note", title: "?", time: "?", place: "?" });
  };
  const env = { ANTHROPIC_API_KEY: "k", DB: fakeD1() };
  await suggestEvent(env, "내일 3시 스터디", NOW, { ctx: fakeCtx(), fetch });
  await suggestEvent(env, `다음주 할 것 정리: ${"과제 하나씩 끝내기 ".repeat(12)}`, NOW, { ctx: fakeCtx(), fetch });
  await suggestEvent(env, "장보기\n빨래\n방 청소", NOW, { ctx: fakeCtx(), fetch });
  assert.deepEqual(models, [
    ["claude-haiku-5-5", 320],
    ["claude-sonnet-5-5", 640],
    ["claude-sonnet-5-5", 640],
  ]);
  assert.equal(isLongMemo("짧은 메모"), false);
});
