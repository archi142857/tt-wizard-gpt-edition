// 대시보드 틀(11-11 사람 피드백 → 컨셉): 모든 기기에서 화면을 꽉 채우고, 전체 화면은 스크롤하지 않고 칸 안에서만 스크롤한다.
// 넓은 화면(900px부터) = 왼쪽 메뉴(오늘 · 달력 · 할 일 · 메모) + 오른쪽 내용, 폰 = 위 막대 + 작은 탭 + 한 번에 한 칸(덜 복잡하게).
// 모양은 dhsrua555 시연 9판(100dvh 앱 틀). 색은 테마(바우하우스 · 입자 밤 · 입자 낮). 메모 칸은 늘 맨 아래.
// 일정처럼 보이는 메모를 보내면 메모 칸 바로 위에 '이대로 저장할까요?' 팝업이 뜬다. 설정은 햄버거 메뉴.
import { useCallback, useEffect, useMemo, useState } from 'react';
import * as api from '../api.js';
import { dayLegs, loadCampus } from '../campus.js';
import CalendarSheet from '../components/CalendarSheet.jsx';
import Composer from '../components/Composer.jsx';
import DeleteAccount from '../components/DeleteAccount.jsx';
import DoneSheet from '../components/DoneSheet.jsx';
import { EventEditSheet, EventInfoSheet, TaskEditSheet } from '../components/EditSheets.jsx';
import EtlSheet from '../components/EtlSheet.jsx';
import FeedbackSheet from '../components/FeedbackSheet.jsx';
import InboxSheet from '../components/InboxSheet.jsx';
import GuideSheet, { guideSeen } from '../components/GuideSheet.jsx';
import Icon from '../components/Icon.jsx';
import InstallSheet from '../components/InstallSheet.jsx';
import JoinSheet from '../components/JoinSheet.jsx';
import Logo from '../components/Logo.jsx';
import MemoCard from '../components/MemoCard.jsx';
import MeSheet from '../components/MeSheet.jsx';
import MemoPopup from '../components/MemoPopup.jsx';
import TaskActSheet from '../components/TaskActSheet.jsx';
import { planMorning } from '../native.js';
import { askedPrefs, readPrefs } from '../prefs.js';
import { addFocus, arrange, fixTask, fixedOn, pinTask, snoozeTask } from '../taskLocal.js';
import MonthCalendar from '../components/MonthCalendar.jsx';
import { ThemeBackdrop } from '../components/art/Backdrop.jsx'; // 그림 테마의 화면 뒤 그림(11-13 02:47)
import Sheet from '../components/Sheet.jsx';
import Snackbar from '../components/Snackbar.jsx';
import TaskList from '../components/TaskList.jsx';
import ThemeSheet from '../components/ThemeSheet.jsx';
import TogetherPage from '../components/TogetherPage.jsx';
import TidySheet from '../components/TidySheet.jsx';
import TodayView from '../components/TodayView.jsx';
import WidgetGrid from '../components/WidgetGrid.jsx';
import { DEFAULT_ORDER, FIRST, LAYOUTS, readLayout, swapOrder, writeLayout } from '../todayLayout.js';
import TtwSheet from '../components/TtwSheet.jsx';
import WeekCalendar, { calPad } from '../components/WeekCalendar.jsx';
import { useThemeName } from '../themeName.js';
import { PARTICLE, applyTheme } from '../themes.js';
import { PLAN_DAYS, dateKey, eventOnlyDay, fromServerPlan, planDensity } from '../density.js';
import { WEEKDAYS, addDays, dayStart, hhmm, kst, monthGrid, sameDay, shiftMonth, shortDate, toKstIso } from '../time.js';

// 넓은 화면(900px부터)인가 — 오늘 쪽 위젯 칸은 넓은 화면에서만(폰은 지금 탭)
const WIDE = '(min-width: 900px)';
function useWide() {
  const [wide, setWide] = useState(() => window.matchMedia?.(WIDE).matches ?? true);
  useEffect(() => {
    const m = window.matchMedia?.(WIDE);
    if (!m) return undefined;
    const on = () => setWide(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return wide;
}

function useNow() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60 * 1000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

// 열린 창을 가리키는 짧은 이름(알림 막대가 그 창 안으로 옮겨 갈 때 쓴다)
const sheetKey = (sheet) => (!sheet ? '' : typeof sheet === 'string' ? sheet : sheet.event ? `event-${sheet.event.id}` : sheet.act ? `act-${sheet.act.id}` : `task-${sheet.task?.id}`);

// 이미 홈 화면 앱이거나 Capacitor 앱이면 '홈 화면에 추가'를 숨긴다
const standalone = () => window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true || !!window.Capacitor?.isNativePlatform?.();

// 겹쳐 보기 고른 그룹 · 켜짐(이 기기, 11-13). 계정에 두려면 표를 바꿔야 해서 나중에
const OVERLAY_KEY = 'tachyon_together_overlay';
function readOverlay() {
  try {
    const v = JSON.parse(localStorage.getItem(OVERLAY_KEY) || 'null');
    if (v && typeof v === 'object') return { groupId: Number.isInteger(v.groupId) ? v.groupId : null, on: v.on === true };
  } catch {
    /* 저장이 막혔거나 깨진 값 */
  }
  return { groupId: null, on: false };
}

// 달력 보기(11-14 피드백 '달력도 하루 3일 (지정 가능)', '모바일 달력이 빡빡함'): 하루 · 3일 · 주 · 월. 고른 것은 이 기기에, 처음엔 폰 3일 · 넓은 화면 주
const CAL_KEY = 'tachyon_cal_mode';
const CAL_DAYS = { day: 1, three: 3, week: 7 };
const gridMode = (wide) => (wide ? 'week' : 'three');
function readCalMode(wide) {
  try {
    const v = localStorage.getItem(CAL_KEY);
    if (v === 'month' || CAL_DAYS[v]) return v;
  } catch {
    /* 저장이 막힌 브라우저 */
  }
  return gridMode(wide);
}

const PAGES = [
  ['today', '오늘'],
  ['cal', '달력'],
  ['tasks', '할 일'],
  ['memo', '메모'],
  ['together', '같이'],
];
const PANES = [
  ['ring', '하루'],
  ['day', '일정'],
  ['tasks', '할 일'],
];

// 두 목록을 id로 합친다(같은 일정이 오늘부터 6주 목록과 보이는 달력 목록에 같이 있을 수 있다)
function mergeEvents(a, b) {
  const seen = new Map();
  for (const ev of [...a, ...b]) seen.set(ev.id, ev);
  return [...seen.values()];
}

// 집중 타이머 막대(9판 '집중 N분'): 머리 밑 한 줄. 1초마다 남은 시간, 끝나면 onEnd, '그만'은 지난 분만 적는다
function FocusBar({ focus, onStop, onEnd }) {
  const [left, setLeft] = useState(() => focus.end - Date.now());
  useEffect(() => {
    const id = setInterval(() => {
      const ms = focus.end - Date.now();
      if (ms <= 0) {
        clearInterval(id);
        onEnd();
      } else setLeft(ms);
    }, 1000);
    return () => clearInterval(id);
  }, [focus]); // eslint-disable-line react-hooks/exhaustive-deps
  const s = Math.max(0, Math.ceil(left / 1000));
  return (
    <div className="focus-bar" role="timer" aria-live="off">
      <span className="focus-dot" aria-hidden="true" />
      <span className="focus-title">집중 · {focus.task.title}</span>
      <strong className="num">
        {Math.floor(s / 60)}:{String(s % 60).padStart(2, '0')}
      </strong>
      <button type="button" className="btn-text quiet" onClick={() => onStop(Math.floor((focus.min * 60 - s) / 60))}>
        그만
      </button>
    </div>
  );
}

function Segmented({ label, items, value, onChange }) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {items.map(([key, text]) => (
        <button key={key} type="button" aria-pressed={value === key} onClick={() => onChange(key)}>
          {text}
        </button>
      ))}
    </div>
  );
}

export default function Dashboard({ example, installPrompt, ttwLink, joinCode, onOpenSetup, onLogout, onDeleted }) {
  const now = useNow();
  const today = dayStart(now).toISOString(); // 자정이 지나면 저절로 하루 밀린다
  const [page, setPage] = useState(() => readPrefs().first); // 시작 질문 '첫 화면'
  const [guide, setGuide] = useState(() => !guideSeen()); // 처음 길잡이(이 기기에서 한 번)
  const [pane, setPane] = useState('ring'); // 폰의 오늘 쪽에서 보이는 한 칸
  const [join, setJoin] = useState(() => (joinCode && !example ? joinCode : null)); // 초대 링크(?join=)로 들어왔으면 받기 창
  const [togetherKey, setTogetherKey] = useState(0); // 받은 뒤 '같이' 쪽을 새로 불러오게
  const [togetherStart, setTogetherStart] = useState(false); // 달력 '같이 보기'로 들어옴 → 그룹이 없으면 만들기 칸을 연다
  const doneTogetherStart = useCallback(() => setTogetherStart(false), []);
  // 다 같이 빈 시간 겹쳐 보기(11-13 사람 "다 같이 되는 시간은 내 시간표에 오버레이해서 다른 색으로"): 고른 그룹 · 켜짐은 이 기기에
  const [overlay, setOverlayState] = useState(readOverlay); // { groupId, on }
  const setOverlay = useCallback((next) => {
    setOverlayState(next);
    try {
      localStorage.setItem(OVERLAY_KEY, JSON.stringify(next));
    } catch {
      /* 저장이 막힌 브라우저면 이번에만 */
    }
  }, []);
  const [groups, setGroups] = useState(null); // 내 그룹(달력 쪽에서 받는다. null = 아직 · 못 받음)
  const [free, setFree] = useState(null); // { key, data } 고른 그룹의 그 주 '다 같이 빈' 구간
  // 오늘 쪽 위젯 배치(11-13, 디자인 넷째 묶음 ②): 고른 배치 · 차례는 이 기기에, '배치 바꾸기'를 눌렀을 때만 옮긴다
  const wide = useWide();
  const [todayLayout, setTodayLayout] = useState(readLayout); // { layout, order }
  const [arranging, setArranging] = useState(false);
  const saveLayout = useCallback((next) => {
    setTodayLayout(next);
    writeLayout(next);
  }, []);
  const swapWidgets = useCallback(
    (i, j) =>
      setTodayLayout((prev) => {
        const next = { ...prev, order: swapOrder(prev.order, i, j) };
        writeLayout(next);
        return next;
      }),
    [],
  );
  useEffect(() => {
    if (page !== 'today' || !wide) setArranging(false);
  }, [page, wide]);
  const [calMode, setCalModeState] = useState(() => readCalMode(wide));
  const setCalMode = useCallback((m) => {
    setCalModeState(m);
    try {
      localStorage.setItem(CAL_KEY, m);
    } catch {
      /* 이번에만 */
    }
  }, []);
  const calDays = CAL_DAYS[calMode] || 0; // 0 = 월
  const [weekFrom, setWeekFrom] = useState(today); // 주간 달력 첫 칸(처음엔 오늘)
  const [month, setMonth] = useState(() => ({ y: kst(now).y, m: kst(now).m }));

  const [planEvents, setPlanEvents] = useState([]); // 오늘부터 6주: 오늘 화면 · 밀도
  const [calEvents, setCalEvents] = useState([]); // 달력에 보이는 기간
  const [rank, setRank] = useState({ tasks: [], warning: null });
  const [memos, setMemos] = useState([]);
  const [popup, setPopup] = useState(null); // { memoId, popup }
  const [waiting, setWaiting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sheet, setSheet] = useState(null); // 'menu' | 'done' | 'feedback' | 'install' | 'calendar' | 'etl' | 'theme' | 'delete' | { event } | { task }
  const [snack, setSnack] = useState(null);
  const [focus, setFocus] = useState(null); // 집중 타이머 { task, min, end }
  const [seed, setSeed] = useState(null); // 달력 '+ 일정' · '+ 할 일' · 날짜 누르기 → 메모 칸에 날짜를 미리 적는다
  const [localTick, setLocalTick] = useState(0); // 이 기기에 적은 할 일 차례(taskLocal.js)가 바뀌면 다시 셈
  // TT Wizard의 'Tachyon으로 보내기'로 들어왔으면(App.jsx가 받아 둔 #ttw=…) 그 시간표 창을 바로 연다(11-11 컨셉)
  const [ttwFrom] = useState(ttwLink || null);
  useEffect(() => {
    if (ttwLink) setSheet('ttw');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 전체 화면이 스크롤되지 않게(칸 안에서만). 로그인·첫 설정 화면은 그대로 스크롤된다
  useEffect(() => {
    document.documentElement.classList.add('locked');
    return () => document.documentElement.classList.remove('locked');
  }, []);

  // 자정이 지나 오늘이 바뀌면 주간 달력이 오늘에 있던 경우 함께 민다
  const [lastToday, setLastToday] = useState(today);
  if (lastToday !== today) {
    setLastToday(today);
    if (weekFrom === lastToday) setWeekFrom(today);
  }

  // 주간 달력은 보이는 날 앞뒤로 calPad일씩 더 불러 둔다(좌우로 굴려 볼 몫, 11-15)
  const calRange = useMemo(
    () => (calDays ? [addDays(weekFrom, -calPad(calDays)).toISOString(), calDays + 2 * calPad(calDays)] : [monthGrid(month.y, month.m)[0].toISOString(), 42]),
    [calMode, weekFrom, month], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const loadPlan = useCallback(
    () =>
      api
        .getEvents(today, PLAN_DAYS)
        .then((r) => setPlanEvents(r.events))
        .catch(() => setSnack({ text: '일정을 불러오지 못했어요' })),
    [today],
  );
  const loadCal = useCallback(
    () =>
      api
        .getEvents(calRange[0], calRange[1])
        .then((r) => setCalEvents(r.events))
        .catch(() => setSnack({ text: '달력을 불러오지 못했어요' })),
    [calRange],
  );
  const loadEvents = useCallback(() => {
    loadPlan();
    loadCal();
  }, [loadPlan, loadCal]);
  const loadRank = useCallback(
    () =>
      api
        .getTasks()
        .then(setRank)
        .catch(() => setSnack({ text: '할 일을 불러오지 못했어요' })),
    [],
  );
  useEffect(() => {
    loadPlan();
  }, [loadPlan]);
  useEffect(() => {
    loadCal();
  }, [loadCal]);
  useEffect(() => {
    loadRank();
  }, [loadRank]);
  useEffect(() => {
    api
      .listMemos()
      .then((r) => setMemos(r.memos))
      .catch(() => setSnack({ text: '메모를 불러오지 못했어요' }));
  }, []);

  const allEvents = useMemo(() => mergeEvents(planEvents, calEvents), [planEvents, calEvents]);

  // 달력 쪽에 들어오면 내 그룹을 받는다(겹쳐 보기 칩). '같이' 쪽에서 그룹을 만들거나 나간 뒤에도 달력으로 오면 다시
  useEffect(() => {
    if (page !== 'cal') return undefined;
    let live = true;
    api.getTogether().then(
      (r) => live && setGroups(r.groups),
      () => live && setGroups(null),
    );
    return () => {
      live = false;
    };
  }, [page, togetherKey]);
  const overlayGroup = groups?.find((g) => g.id === overlay.groupId) || groups?.[0] || null; // 고른 그룹이 없어졌으면 첫 그룹(꺼진 채)
  const overlayOn = Boolean(overlay.on && overlayGroup && overlayGroup.id === overlay.groupId);
  const showOverlay = overlayOn && page === 'cal' && calDays > 0;
  // 그 주 다 같이 빈 시간: 내 일정이 다시 오면(옮기기·고치기 뒤 포함) 다시 받는다. 서버는 읽기만
  useEffect(() => {
    if (!showOverlay) return undefined;
    const from = toKstIso(weekFrom).slice(0, 10);
    const key = `${overlayGroup.id}|${from}`;
    let live = true;
    api.getGroupFree(overlayGroup.id, from, 7).then(
      (data) => live && setFree({ key, data }),
      (err) => {
        if (!live) return;
        setFree(null);
        if (err.status === 404) {
          setOverlay({ groupId: null, on: false }); // 나간 그룹
          setGroups((list) => list?.filter((g) => g.id !== overlayGroup.id) ?? null);
        }
        setSnack({ text: err.message || '다 같이 빈 시간을 불러오지 못했어요' });
      },
    );
    return () => {
      live = false;
    };
    // weekFrom이 바뀌면 calEvents도 다시 오니 calEvents 하나로 센다(두 번 받지 않게)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showOverlay, overlayGroup?.id, calEvents]);
  const freeNow = showOverlay && free && free.key === `${overlayGroup.id}|${toKstIso(weekFrom).slice(0, 10)}` ? free.data : null;

  // 켜고 끄기(달력 머리 칩 · '같이' 쪽 그룹 줄 칩). 다른 그룹을 켜면 그 그룹으로 바뀐다. → 켰으면 true
  function toggleOverlay(groupId) {
    const on = !(overlay.on && overlay.groupId === groupId && groups?.some((g) => g.id === groupId));
    setOverlay({ groupId, on });
    if (on && !calDays) setCalMode(gridMode(wide));
    return on;
  }

  // 수업 사이 동선(TT Wizard 걷는 시간): 장소가 있는 일정이 보이면 캠퍼스 표를 한 번 받아 둔다
  const [campus, setCampus] = useState(null);
  const hasPlace = allEvents.some((e) => e.place);
  useEffect(() => {
    if (!campus && hasPlace) loadCampus().then(setCampus, () => {});
  }, [campus, hasPlace]);
  const legs = useMemo(() => dayLegs(allEvents, campus), [allEvents, campus]);

  const openTasks = useMemo(() => rank.tasks.filter((t) => !t.done), [rank.tasks]);
  const todayKey = dateKey(now);
  // 오늘 목록: 미룬 것 빼고 당긴 것 먼저(taskLocal.js). 폰은 2~3개만(사람 결정 '오늘 화면 · 폰': "할 일은 2-3개 정도만 띄우고")
  const todayTasks = useMemo(() => arrange(openTasks, todayKey), [openTasks, todayKey, localTick]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    planMorning(todayTasks.map((t) => t.title)).catch(() => null); // 아침 알림(켠 폰만): 첫 아침에 맨 위 할 일 3개
  }, [todayTasks]);
  const fixedToday = useMemo(() => fixedOn(todayKey), [todayKey, localTick]); // eslint-disable-line react-hooks/exhaustive-deps
  const subjects = useMemo(() => [...new Set(allEvents.filter((e) => e.source === 'timetable').map((e) => e.title))], [allEvents]);

  // 날마다 밀도(오늘부터 6주). 서버 셈(AI 4_night planDays — 할 일 순서·경고와 같은 셈)을 그리고, 예시 모드나 못 받았을 때만 화면 셈.
  // 할 일·일정이 바뀌면 다시 받는다. 지난날·6주 밖은 일정만
  const [daily, setDaily] = useState(null);
  useEffect(() => {
    let live = true;
    api
      .getDailyPlan(PLAN_DAYS)
      .then((res) => live && setDaily(res))
      .catch(() => live && setDaily(null));
    return () => {
      live = false;
    };
  }, [rank.tasks, planEvents]);
  const plan = useMemo(
    () => (daily?.days?.length ? fromServerPlan(daily, openTasks) : planDensity({ events: planEvents, tasks: openTasks, now })),
    [daily, planEvents, openTasks, now],
  );
  const densityOf = useMemo(() => {
    const byKey = new Map(plan.map((d) => [d.key, d]));
    const start = dayStart(now).getTime();
    return (date) => byKey.get(dateKey(date)) || eventOnlyDay(allEvents, date, new Date(date).getTime() < start);
  }, [plan, allEvents, now]);

  const closeSnack = useCallback(() => setSnack(null), []);

  /* 메모 → 즉시 팝업 */
  async function sendMemo(text) {
    const temp = { id: `tmp-${Date.now()}`, text, created_at: new Date().toISOString(), handled: 0, event_id: null };
    setMemos((m) => [...m, temp]);
    setWaiting(true);
    try {
      const { memo, popup: found } = await api.sendMemo(text);
      setMemos((m) => m.map((x) => (x.id === temp.id ? memo : x)));
      setPopup(found ? { memoId: memo.id, popup: found } : null);
    } catch {
      setMemos((m) => m.filter((x) => x.id !== temp.id));
      setSnack({ text: '메모를 보내지 못했어요. 다시 해 주세요' });
    } finally {
      setWaiting(false);
    }
  }

  // 띠를 누르면 '이 시간으로 모임 잡기'(11-13): 메모 하나를 남기고, 팝업은 고른 시각 그대로(서버가 읽은 것은 suggested로만 — 팝업 정확도)
  const planTogether = (span) => planAt(`${overlayGroup.name} 모임`, span, { together: overlayGroup.name });

  // 추천 자리 → '이 시간에 넣기'(할 일 바로 다루기): 같은 길로 일정 팝업을 띄우고, 저장되면 그 할 일을 오늘 '정함'으로 적는다
  function placeTask(task, slot) {
    const d = new Date(today).getTime();
    setSheet(null);
    planAt(task.title, { start: new Date(d + slot[0] * 60000).toISOString(), end: new Date(d + slot[1] * 60000).toISOString() }, {}, { id: task.id, from: slot[0], to: slot[1] });
  }

  async function planAt(title, span, extra = {}, fix = null) {
    const text = `${shortDate(span.start)} ${hhmm(span.start)}–${hhmm(span.end)} ${title}`;
    const temp = { id: `tmp-${Date.now()}`, text, created_at: new Date().toISOString(), handled: 0, event_id: null };
    setMemos((m) => [...m, temp]);
    setWaiting(true);
    try {
      const { memo, popup: found } = await api.sendMemo(text);
      setMemos((m) => m.map((x) => (x.id === temp.id ? memo : x)));
      const date = toKstIso(span.start).slice(0, 10);
      setPopup({ memoId: memo.id, suggested: found ?? null, fix, popup: { title, date, time: hhmm(span.start), end_time: hhmm(span.end), place: '?', ...extra } });
    } catch {
      setMemos((m) => m.filter((x) => x.id !== temp.id));
      setSnack({ text: '일정을 띄우지 못했어요. 다시 해 주세요' });
    } finally {
      setWaiting(false);
    }
  }

  function showWeekOf(date) {
    setPage('cal');
    if (!calDays) setCalMode(gridMode(wide)); // 하루 · 3일 · 주 가운데 고른 것은 그대로
    setWeekFrom(dayStart(date).toISOString());
  }

  async function savePopup(fields, changeId, weekly) {
    setBusy(true);
    try {
      if (fields.kind === 'task') {
        // 할 일 팝업 → 할 일 목록에 바로(걸리는 시간은 팝업의 어림, 없으면 밤 정리가 채운다). 한 메모에 여럿이면 tasks
        const { task, tasks = [task] } = await api.savePopup(popup.memoId, fields, 'suggested' in popup ? popup.suggested : popup.popup);
        setMemos((m) => m.map((x) => (x.id === popup.memoId ? { ...x, handled: 1, task_id: task.id } : x)));
        setPopup(null);
        loadRank();
        setSnack({ text: tasks.length > 1 ? `할 일 ${tasks.length}개를 넣었어요` : `‘${task.title}’ 할 일에 넣었어요` });
        return;
      }
      const { event, repeat, tasks: prepTasks = [] } = await api.savePopup(popup.memoId, fields, 'suggested' in popup ? popup.suggested : popup.popup, changeId, weekly);
      if (prepTasks.length) loadRank(); // 일정 전에 할 일(prep)도 넣었으면 할 일 목록을 다시
      setMemos((m) => m.map((x) => (x.id === popup.memoId ? { ...x, handled: 1, event_id: event.id } : x)));
      if (popup.fix) {
        fixTask(popup.fix.id, todayKey, popup.fix.from, popup.fix.to);
        setLocalTick((n) => n + 1);
      }
      setPopup(null);
      const shown = api.normalizeEvent(event);
      if (changeId) {
        setPlanEvents((list) => list.filter((e) => e.id !== changeId)); // 옮긴 옛 일정은 바로 빠진다
        setCalEvents((list) => list.filter((e) => e.id !== changeId));
      }
      if (sameDay(shown.start, now)) setPlanEvents((list) => [...list.filter((e) => e.id !== shown.id), shown]); // 바로 보이고, 서버 목록으로 다시 맞춘다
      loadEvents();
      const prepText = prepTasks.length ? ` · 그 전에 할 일 ${prepTasks.length}개도` : '';
      if (repeat) setSnack({ text: `매주 같은 요일로 ${repeat}번 넣었어요${prepText}` });
      else if (!sameDay(shown.start, now)) setSnack({ text: `${shortDate(shown.start)}에 넣었어요${prepText}`, actionLabel: '달력에서 보기', onAction: () => showWeekOf(shown.start) });
      else if (prepTasks.length) setSnack({ text: `일정과 그 전에 할 일 ${prepTasks.length}개를 넣었어요` });
    } catch {
      setSnack({ text: '저장하지 못했어요. 다시 해 주세요' });
    } finally {
      setBusy(false);
    }
  }

  function cancelPopup() {
    api.cancelPopup(popup.memoId, popup.popup.kind).catch(() => {});
    if (popup.popup.kind === 'task') setMemos((m) => m.map((x) => (x.id === popup.memoId ? { ...x, handled: 1 } : x)));
    setPopup(null);
  }

  useEffect(() => {
    if (!popup) return undefined;
    const onKey = (e) => e.key === 'Escape' && !sheet && cancelPopup();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  /* 할 일 체크 → 되돌리기 */
  async function doneTask(task) {
    setRank((r) => ({ ...r, tasks: r.tasks.filter((t) => t.id !== task.id) }));
    try {
      await api.setTaskDone(task.id, true);
      loadRank(); // 체크하면 여유 순서가 바뀐다
      setSnack({
        text: `‘${task.title}’ 끝`,
        actionLabel: '되돌리기',
        onAction: () => api.setTaskDone(task.id, false).then(loadRank),
      });
    } catch {
      loadRank();
      setSnack({ text: '체크하지 못했어요. 다시 해 주세요' });
    }
  }

  // 고치기·지우기: 실패하면 오류를 던져서 고치는 창 안에 보이게 한다(창이 맨 위라 스낵바는 가려진다)
  async function saveEvent(id, fields) {
    await api.updateEvent(id, fields);
    setSheet(null);
    loadEvents();
  }

  // 달력 빈 칸 → 일정 넣기 창 → 저장(11-14). 메모를 거치지 않는다
  async function addEvent(fields) {
    const { event } = await api.createEvent(fields);
    setSheet(null);
    loadEvents();
    setSnack({ text: `‘${event.title}’ 넣었어요` });
  }

  // 일정 끌어 옮기기 · 길이 바꾸기(11-14): 바로 옮겨 보이고, 실패하면 되돌린다. '되돌리기'는 옛 시각으로 다시 보낸다
  async function dropEvent(ev, to) {
    const back = { start: ev.start, end: ev.end };
    const put = (list) => list.map((e) => (e.id === ev.id ? { ...e, ...to } : e));
    setCalEvents(put);
    setPlanEvents(put);
    try {
      const { event } = await api.updateEvent(ev.id, to);
      loadEvents();
      setSnack({ text: `‘${ev.title}’ ${hhmm(to.start)}–${hhmm(to.end)}에 놓았어요`, actionLabel: '되돌리기', onAction: () => api.updateEvent(event.id, back).then(loadEvents) });
    } catch (err) {
      loadEvents();
      setSnack({ text: err.message || '옮기지 못했어요. 다시 해 주세요' });
    }
  }

  async function saveTask(id, fields) {
    await api.updateTask(id, fields);
    setSheet(null);
    loadRank();
  }

  /* 지우기(메모·시간표에서 온 것만) */
  async function deleteEvent(event) {
    await api.deleteEvent(event.id);
    setSheet(null);
    setPlanEvents((list) => list.filter((e) => e.id !== event.id));
    setCalEvents((list) => list.filter((e) => e.id !== event.id));
    setMemos((m) => m.map((x) => (x.event_id === event.id ? { ...x, event_id: null } : x)));
    loadEvents();
    setSnack({ text: `‘${event.title}’ 지웠어요` });
  }

  async function deleteTask(task) {
    await api.deleteTask(task.id);
    setSheet(null);
    setRank((r) => ({ ...r, tasks: r.tasks.filter((t) => t.id !== task.id) }));
    setMemos((m) => m.map((x) => (x.task_id === task.id ? { ...x, task_id: null } : x)));
    loadRank();
    setSnack({ text: `‘${task.title}’ 지웠어요` });
  }

  const themeName = useThemeName();
  const date = kst(now);
  const dateText = `${date.m}월 ${date.d}일 ${WEEKDAYS[date.wd]}요일`;
  // 아직 정리 안 된 메모(밤 정리 후보와 같은 기준, example.js) → 하루 고리 바깥 점(적은 시각)
  const looseMin = memos.filter((m) => !m.handled && !m.event_id && !m.task_id).map((m) => {
    const p = kst(new Date(m.created_at));
    return p.h * 60 + p.min;
  });
  const clearMemos = () =>
    api
      .clearMemos()
      .then(({ deleted }) => {
        setMemos([]);
        setSnack({ text: `메모 ${deleted}개를 지웠어요` });
      })
      .catch(() => setSnack({ text: '메모를 지우지 못했어요' }));
  const memoCard = <MemoCard memos={memos} now={now} activeId={popup?.memoId} waiting={waiting} onTidy={() => setSheet('tidy')} onClear={clearMemos} />;

  // 메모 칸에 'M/D '(일정) 또는 'M/D까지 '(할 일)를 적어 두고 초점 — 나머지는 사람이 적고 보내면 메모 → 팝업 → 저장
  const calDay = calDays && weekFrom !== today ? weekFrom : today;
  const seedDay = (day, tail) => {
    const p = kst(new Date(day));
    setSeed({ text: `${p.m}/${p.d}${tail || ' '}` });
  };

  // 쪽마다 머리 줄에 붙는 고르기
  const controls =
    page === 'today' ? (
      <span className="only-narrow">
        <Segmented label="오늘 보기" items={PANES} value={pane} onChange={setPane} />
      </span>
    ) : page === 'cal' ? (
      <span className="cal-controls">
        {overlayGroup ? (
          // 범례 겸 켜고 끄기(디자인 넷째 묶음 ① .together-key): 고른 그룹의 다 같이 빈 시간을 주 달력에 띠로
          <button
            type="button"
            className="together-key"
            aria-pressed={overlayOn}
            title={freeNow && freeNow.known < freeNow.members ? `달력을 연결한 ${freeNow.known}명 기준(${freeNow.members}명 중)` : undefined}
            onClick={() => toggleOverlay(overlayGroup.id)}
          >
            <span className="only-wide">다 같이 빈 시간 ·</span>
            <span className="only-narrow">다 같이 ·</span>
            <span className="tk-name">{overlayGroup.name}</span>
            {freeNow && freeNow.known < freeNow.members && <span className="num">{`${freeNow.known}/${freeNow.members}명`}</span>}
          </button>
        ) : (
          // 그룹이 없으면 '같이'로 들어가는 길(11-13 컨셉 쪽지: 그룹 만들기를 눈에 띄게) — 만들기 칸이 열린 채로 간다
          <button
            type="button"
            className="chip-btn"
            onClick={() => {
              setTogetherStart(true);
              setPage('together');
            }}
          >
            같이 보기
          </button>
        )}
        <button type="button" className="chip-btn cal-add" onClick={() => seedDay(calDay, '')}>
          + 일정
        </button>
        <button type="button" className="chip-btn cal-add" onClick={() => seedDay(calDay, '까지 ')}>
          + 할 일
        </button>
        <Segmented
          label="달력 보기"
          items={[
            ['day', '하루'],
            ['three', '3일'],
            ['week', '주'],
            ['month', '월'],
          ]}
          value={calMode}
          onChange={setCalMode}
        />
      </span>
    ) : null;


  return (
    <div className="shell">
      <ThemeBackdrop />
      <aside className="side">
        <div className="side-brand">
          <h1 className="wordmark">
            <Logo height={26} />
          </h1>
          {example && <span className="tag">예시 자료</span>}
        </div>
        <nav className="side-nav" aria-label="쪽">
          {PAGES.map(([key, label]) => (
            <button key={key} type="button" aria-current={page === key ? 'page' : undefined} onClick={() => setPage(key)}>
              {label}
              {key === 'tasks' && openTasks.length > 0 && <span className="count num">{openTasks.length}</span>}
            </button>
          ))}
        </nav>
      </aside>

      <div className="main">
        <header className="topbar">
          <h1 className="wordmark only-narrow">
            <Logo height={24} />
          </h1>
          {example && <span className="tag only-narrow">예시 자료</span>}
          <span className="date only-wide num">{dateText}</span>
          <span className="only-wide">{controls}</span>
          <span className="grow" />
          {page === 'today' &&
            (arranging ? (
              <span className="layout-tools only-wide">
                <span className="layout-pick only-1200" role="group" aria-label="배치">
                  {LAYOUTS.map(([k, label]) => (
                    <button key={k} type="button" className={k} aria-pressed={todayLayout.layout === k} aria-label={label} title={label} onClick={() => saveLayout({ layout: k, order: DEFAULT_ORDER[k] })}>
                      <i />
                      <i />
                      <i />
                      <i />
                    </button>
                  ))}
                </span>
                <button type="button" className="btn-text quiet" onClick={() => saveLayout(FIRST)}>
                  처음대로
                </button>
                <button type="button" className="btn-text" onClick={() => setArranging(false)}>
                  다 됨
                </button>
              </span>
            ) : (
              <button type="button" className="btn-text only-wide" onClick={() => setArranging(true)}>
                배치 바꾸기
              </button>
            ))}
          {(themeName === PARTICLE.night || themeName === PARTICLE.day) && (
            // 입자 테마의 밤 ↔ 낮(9판 스위치: 달이 미끄러져 해가 된다). 색이 천천히 넘어간다
            <button type="button" className="sw" aria-label={themeName === PARTICLE.night ? '낮으로' : '밤으로'} title={themeName === PARTICLE.night ? '낮으로' : '밤으로'} onClick={() => applyTheme(themeName === PARTICLE.night ? PARTICLE.day : PARTICLE.night)}>
              <i />
            </button>
          )}
          <button type="button" className="icon-btn" aria-label="받은함" title="받은함 · 아침 브리핑" onClick={() => setSheet('inbox')}>
            <Icon name="inbox" />
          </button>
          <button type="button" className="btn-text only-wide" onClick={() => setSheet('feedback')}>
            의견
          </button>
          <button type="button" className="btn-text" onClick={() => setSheet('me')}>
            나
          </button>
          <button type="button" className="icon-btn" aria-label="메뉴(설정)" onClick={() => setSheet('menu')}>
            <Icon name="menu" />
          </button>
        </header>
        <nav className="tabs only-narrow" aria-label="쪽">
          {PAGES.map(([key, label]) => (
            <button key={key} type="button" aria-current={page === key ? 'page' : undefined} onClick={() => setPage(key)}>
              {label}
            </button>
          ))}
        </nav>
        {(page === 'today' || page === 'cal') && (
          <section className="subbar only-narrow" aria-label="보기 고르기">
            <span className="date num">{page === 'today' ? dateText : ''}</span>
            <span className="grow" />
            {controls}
          </section>
        )}

        {focus && (
          <FocusBar
            focus={focus}
            onStop={(spent) => {
              if (spent > 0) addFocus(spent, todayKey);
              setFocus(null);
            }}
            onEnd={() => {
              addFocus(focus.min, todayKey);
              const task = focus.task;
              setFocus(null);
              setSnack({ text: `집중 ${focus.min}분 끝 · ‘${task.title}’`, actionLabel: '끝냈어요', onAction: () => doneTask(task) });
            }}
          />
        )}
        <main key={page} className={`page page-${page}`} data-pane={pane}>
          {page === 'today' && (
            <WidgetGrid wide={wide} layout={todayLayout.layout} order={todayLayout.order} editing={arranging} onSwap={swapWidgets}>
              {(widget) => (
                <>
              <TodayView
                today={today}
                events={planEvents}
                tasks={todayTasks.slice(0, wide ? 6 : 3)}
                total={openTasks.length}
                fixed={fixedToday}
                now={now}
                onDone={doneTask}
                onEvent={(event) => setSheet({ event })}
                onTask={(task, slot) => setSheet({ act: task, slot })}
                onAll={() => setPage('tasks')}
                onWeek={() => showWeekOf(today)}
                loose={looseMin}
                onTidy={() => setSheet('tidy')}
                widget={widget}
                editing={arranging}
                layoutKey={todayLayout.layout}
              />
              <MemoCard memos={memos} now={now} activeId={popup?.memoId} waiting={waiting} widget={widget('memo')} onTidy={() => setSheet('tidy')} onClear={clearMemos} />
                </>
              )}
            </WidgetGrid>
          )}
          {page === 'cal' &&
            (calDays ? (
              <WeekCalendar
                start={weekFrom}
                n={calDays}
                events={calEvents}
                tasks={openTasks}
                now={now}
                density={densityOf}
                isCurrent={weekFrom === today}
                onMove={(k) => setWeekFrom((w) => addDays(w, k).toISOString())}
                onToday={() => setWeekFrom(today)}
                onEvent={(event) => setSheet({ event })}
                onTask={(task) => setSheet({ task })}
                onDay={(day) => seedDay(day, '')}
                onAdd={(day, min) => setSheet({ newEvent: { title: '', start: toKstIso(new Date(day.getTime() + min * 60000)), end: toKstIso(new Date(day.getTime() + (min + 60) * 60000)) } })}
                onDrop={dropEvent}
                legs={legs}
                together={freeNow ? { name: overlayGroup.name, spans: freeNow.together } : null}
                onTogether={planTogether}
              />
            ) : (
              <MonthCalendar
                anchor={month}
                events={calEvents}
                tasks={openTasks}
                now={now}
                density={densityOf}
                onPrev={() => setMonth((m) => shiftMonth(m, -1))}
                onNext={() => setMonth((m) => shiftMonth(m, 1))}
                onToday={() => setMonth({ y: date.y, m: date.m })}
                onDay={(day) => showWeekOf(day)}
              />
            ))}
          {page === 'tasks' && (
            <div className="tasks-grid">
              <TaskList tasks={openTasks} now={now} plan={plan} subjects={subjects} onDone={doneTask} onEdit={(task) => setSheet({ task })} onDoneList={() => setSheet('done')} />
            </div>
          )}
          {page === 'memo' && <div className="memo-page">{memoCard}</div>}
          {page === 'together' && <TogetherPage key={togetherKey} example={example} now={now} onSnack={(text) => setSnack({ text })} startCreate={togetherStart} onStartUsed={doneTogetherStart} overlay={overlay.on ? overlay.groupId : null} onOverlay={(groupId) => {
                if (toggleOverlay(groupId)) setSnack({ text: '주 달력에 다 같이 빈 시간을 겹쳐 보여요', actionLabel: '달력 보기', onAction: () => setPage('cal') });
              }} />}
        </main>

        {/* 정면 창(디자인 ⑤): 뒤를 막고 흐린다. 막을 누르면 '취소'와 같음 */}
        {popup && <div className="popup-scrim" aria-hidden="true" onClick={cancelPopup} />}
        {popup && <MemoPopup key={popup.memoId} popup={popup.popup} plan={{ events: planEvents, tasks: openTasks, today, now }} busy={busy} onSave={savePopup} onCancel={cancelPopup} />}
        <Composer onSend={sendMemo} seed={seed} memoCount={memos.length} onMemos={() => setPage('memo')} />
      </div>

      {guide && !join && (
        <GuideSheet
          onClose={() => {
            setGuide(false);
            if (!askedPrefs()) setSheet('start'); // 처음이면 길잡이 뒤에 시작 질문 셋
          }}
        />
      )}
      {sheet === 'inbox' && (
        <InboxSheet
          tasks={openTasks}
          warning={rank.warning}
          onClose={() => setSheet(null)}
          onTask={(task) => setSheet({ act: task })}
          onSnooze={(task) => {
            snoozeTask(task.id, dateKey(addDays(today, 1)));
            setLocalTick((n) => n + 1);
            setSnack({ text: `‘${task.title}’ 내일로 미뤘어요` });
          }}
          onChanged={loadRank}
        />
      )}
      {(sheet === 'me' || sheet === 'start') && <MeSheet start={sheet === 'start'} onClose={() => (setSheet(null), setLocalTick((n) => n + 1))} onDoneList={() => setSheet('done')} onSetup={onOpenSetup} />}
      {sheet?.act && (
        <TaskActSheet
          task={sheet.act}
          slot={sheet.slot}
          fixed={fixedToday[sheet.act.id]}
          now={now}
          focusMin={readPrefs().focus}
          onClose={() => setSheet(null)}
          onPlace={(slot) => placeTask(sheet.act, slot)}
          onFocus={() => {
            const min = readPrefs().focus;
            setFocus({ task: sheet.act, min, end: Date.now() + min * 60000 });
            setSheet(null);
          }}
          onPin={() => {
            pinTask(sheet.act.id);
            setLocalTick((n) => n + 1);
            setSheet(null);
            setSnack({ text: `‘${sheet.act.title}’ 맨 앞으로 당겼어요` });
          }}
          onSnooze={() => {
            const task = sheet.act;
            const n = snoozeTask(task.id, dateKey(addDays(today, 1)));
            setLocalTick((k) => k + 1);
            setSheet(null);
            setSnack({ text: n >= 3 ? `‘${task.title}’ 세 번째 미뤘어요. 안 해도 되면 지워도 돼요` : `‘${task.title}’ 내일로 미뤘어요` });
          }}
          onEdit={() => setSheet({ task: sheet.act })}
          onDone={() => {
            const task = sheet.act;
            setSheet(null);
            doneTask(task);
          }}
        />
      )}
      {join && (
        <JoinSheet
          code={join}
          onClose={() => setJoin(null)}
          onJoined={(text) => {
            setJoin(null);
            setTogetherKey((k) => k + 1);
            setPage('together');
            setSnack({ text });
          }}
        />
      )}
      {sheet === 'menu' && (
        <Sheet title="메뉴 · 설정" onClose={() => setSheet(null)}>
          <div className="menu-list">
            <button type="button" onClick={onOpenSetup}>
              캘린더 연결·학과
            </button>
            <button type="button" onClick={() => setSheet('etl')}>
              eTL 연결·강의자료
            </button>
            <button type="button" onClick={() => setSheet('ttw')}>
              TT Wizard 시간표
            </button>
            <button type="button" onClick={() => setSheet('calendar')}>
              폰 달력에서 보기
            </button>
            {!standalone() && (
              <button type="button" onClick={() => setSheet('install')}>
                홈 화면에 추가
              </button>
            )}
            <button type="button" onClick={() => setSheet('theme')}>
              테마
            </button>
            <button
              type="button"
              onClick={() => {
                setSheet(null);
                setGuide(true);
              }}
            >
              길잡이 다시 보기
            </button>
            <button type="button" onClick={() => setSheet('feedback')}>
              의견 보내기
            </button>
            <button type="button" onClick={onLogout}>
              {example ? '예시 끝내기' : '로그아웃'}
            </button>
            <button type="button" className="danger" onClick={() => setSheet('delete')}>
              계정 지우기
            </button>
          </div>
        </Sheet>
      )}
      {sheet === 'done' && (
        <DoneSheet
          now={now}
          onClose={() => setSheet(null)}
          onUndone={(task) => {
            loadRank();
            setSnack({ text: `‘${task.title}’ 할 일로 되돌렸어요` });
          }}
        />
      )}
      {sheet === 'feedback' && <FeedbackSheet screen={`대시보드 · ${PAGES.find(([k]) => k === page)[1]}`} onClose={() => setSheet(null)} onSent={(text) => setSnack({ text })} />}
      {sheet === 'install' && <InstallSheet prompt={installPrompt} onClose={() => setSheet(null)} />}
      {sheet === 'calendar' && <CalendarSheet onClose={() => setSheet(null)} />}
      {sheet === 'ttw' && (
        <TtwSheet
          initialLink={ttwFrom}
          onClose={() => setSheet(null)}
          onSaved={(r) => {
            setSheet(null);
            loadEvents();
            setSnack({ text: `TT Wizard 시간표에서 수업 ${r.classes}개를 넣었어요(일정 ${r.saved}칸)` });
          }}
        />
      )}
      {sheet === 'theme' && <ThemeSheet onClose={() => setSheet(null)} />}
      {sheet === 'tidy' && (
        <TidySheet
          onClose={() => setSheet(null)}
          onDone={(text) => {
            setSheet(null);
            setSnack({ text });
            api.listMemos().then((r) => setMemos(r.memos), () => {});
            loadRank();
          }}
        />
      )}
      {sheet === 'delete' && (
        <Sheet title="계정 지우기" onClose={() => setSheet(null)}>
          <DeleteAccount example={example} onDeleted={onDeleted} />
        </Sheet>
      )}
      {sheet === 'etl' && (
        <EtlSheet
          onClose={() => setSheet(null)}
          onChanged={() => {
            loadEvents();
            loadRank();
          }}
        />
      )}
      {/* 일정을 누르면 정보 창부터, '고치기'로 고치는 창(sheet.edit) */}
      {sheet?.event && !sheet.edit && (
        <EventInfoSheet
          event={sheet.event}
          leg={legs.get(sheet.event.id)}
          campus={campus}
          events={allEvents}
          onClose={() => setSheet(null)}
          onEdit={() => setSheet({ event: sheet.event, edit: true })}
        />
      )}
      {sheet?.event && sheet.edit && (
        <EventEditSheet
          event={sheet.event}
          leg={legs.get(sheet.event.id)}
          campus={campus}
          events={allEvents}
          onClose={() => setSheet(null)}
          onSave={(fields) => saveEvent(sheet.event.id, fields)}
          onDelete={() => deleteEvent(sheet.event)}
        />
      )}
      {sheet?.newEvent && <EventEditSheet event={sheet.newEvent} events={allEvents} onClose={() => setSheet(null)} onSave={addEvent} />}
      {sheet?.task && <TaskEditSheet task={sheet.task} onClose={() => setSheet(null)} onSave={(fields) => saveTask(sheet.task.id, fields)} onDelete={() => deleteTask(sheet.task)} />}
      {snack && <Snackbar {...snack} layer={sheetKey(sheet)} onDone={closeSnack} />}
    </div>
  );
}
