// 달력 일정 끌기(11-14 피드백 '일정을 손으로 조작해서 위치, 길이 조절', 모양은 request1113.css ③ 그림자 칸).
// 몸통을 끌면 옮기기(길이 그대로, 다른 날 칸으로도), 아래 끝 손잡이를 끌면 길이 바꾸기. 15분 눈금.
// 고른 일정에서만 부른다(WeekCalendar: 한 번 누르면 고르기, 11-15). 4px 넘게 움직이면 끌기(마우스·손가락 같음).
// 놓으면 onDrop(ev, { day, from, to }) — day = 보이는 날 칸 번호, from·to = 그날 0시부터 분.
import { useEffect, useRef, useState } from 'react';

export const SNAP = 15;

// 손 위치 → 칸 번호와 분(눈금 맞추기 전). box = 날 칸들 전체의 화면 자리, first·last = 맨 위·맨 아래 시각(시)
export function pointAt(x, y, box, n, first, last) {
  const day = Math.min(n - 1, Math.max(0, Math.floor(((x - box.left) / box.width) * n)));
  const min = first * 60 + ((y - box.top) / box.height) * (last - first) * 60;
  return { day, min };
}

// 끄는 중 놓일 자리. grab = 처음 잡은 곳이 일정 시작에서 몇 분 아래였나
export function dropTarget(mode, at, item, first, last) {
  const snap = (m) => Math.round(m / SNAP) * SNAP;
  if (mode === 'resize') {
    const to = Math.min(last * 60, Math.max(item.from + SNAP, snap(at.min)));
    return { day: item.day, from: item.from, to };
  }
  const len = item.to - item.from;
  const from = Math.min(last * 60 - Math.min(len, (last - first) * 60), Math.max(first * 60, snap(at.min - item.grab)));
  return { day: at.day, from, to: from + len };
}

// cols() = 날 칸 요소 목록(왼쪽부터). → { ghost, start(e, item, mode), takeClick() }
// item = { ev, day, from, to } 지금 자리. ghost = { id, day, from, to } 끄는 동안만
export default function useEventDrag({ cols, n, first, last, onDrop }) {
  const [ghost, setGhost] = useState(null);
  const st = useRef(null);
  const ate = useRef(false); // 끌고 난 뒤 따라오는 click 하나는 먹는다(고치기 창이 뜨지 않게)

  const stop = () => {
    const s = st.current;
    if (!s) return;
    window.removeEventListener('pointermove', s.move);
    window.removeEventListener('pointerup', s.up);
    window.removeEventListener('pointercancel', s.cancel);
    window.removeEventListener('touchmove', s.block);
    st.current = null;
    setGhost(null);
  };
  useEffect(() => stop, []);

  function start(e, item, mode) {
    if (e.button > 0 || !onDrop) return;
    const list = cols();
    if (!list.length) return;
    const a = list[0].getBoundingClientRect();
    const b = list[list.length - 1].getBoundingClientRect();
    const box = { left: a.left, top: a.top, width: b.right - a.left, height: a.height };
    const at0 = pointAt(e.clientX, e.clientY, box, n, first, last);
    const s = { item: { ...item, grab: at0.min - item.from }, mode, box, x0: e.clientX, y0: e.clientY, on: false, last: null };
    const activate = () => {
      s.on = true;
      navigator.vibrate?.(8);
      setGhost({ id: item.ev.id, day: item.day, from: item.from, to: item.to });
    };
    s.move = (m) => {
      const far = Math.hypot(m.clientX - s.x0, m.clientY - s.y0);
      if (!s.on) {
        if (far < 4) return;
        activate();
      }
      s.last = dropTarget(mode, pointAt(m.clientX, m.clientY, s.box, n, first, last), s.item, first, last);
      setGhost({ id: item.ev.id, ...s.last });
    };
    s.up = () => {
      const { on, last: to } = s;
      stop();
      if (!on) return;
      ate.current = true;
      setTimeout(() => (ate.current = false), 50);
      if (to && (to.day !== item.day || to.from !== item.from || to.to !== item.to)) onDrop(item.ev, to);
    };
    s.cancel = () => stop();
    s.block = (t) => s.on && t.cancelable && t.preventDefault(); // 끄는 동안 칸이 같이 굴지 않게
    window.addEventListener('pointermove', s.move);
    window.addEventListener('pointerup', s.up);
    window.addEventListener('pointercancel', s.cancel);
    window.addEventListener('touchmove', s.block, { passive: false });
    st.current = s;
  }

  return { ghost, start, takeClick: () => ate.current };
}
