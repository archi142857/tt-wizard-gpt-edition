// 달력 일정 끌기 계산(components/useEventDrag.js): 손 위치 → 칸·분, 놓일 자리(15분 눈금, 맨 위·아래를 넘지 않게)
import { describe, expect, it } from 'vitest';
import { dropTarget, pointAt } from './components/useEventDrag.js';

const box = { left: 0, top: 0, width: 300, height: 600 }; // 3일, 9–19시(10시간) → 한 시간 60px

describe('useEventDrag', () => {
  it('손 위치를 칸 번호와 분으로', () => {
    expect(pointAt(150, 60, box, 3, 9, 19)).toEqual({ day: 1, min: 600 });
    expect(pointAt(-20, 0, box, 3, 9, 19).day).toBe(0); // 바깥은 끝 칸
    expect(pointAt(999, 0, box, 3, 9, 19).day).toBe(2);
  });

  it('옮기기: 길이 그대로, 잡은 곳 기준, 15분 눈금, 범위 안', () => {
    const item = { day: 0, from: 600, to: 660, grab: 10 };
    expect(dropTarget('move', { day: 2, min: 737 }, item, 9, 19)).toEqual({ day: 2, from: 720, to: 780 });
    expect(dropTarget('move', { day: 0, min: 400 }, item, 9, 19)).toEqual({ day: 0, from: 540, to: 600 }); // 9시 위로 못 감
    expect(dropTarget('move', { day: 0, min: 1200 }, item, 9, 19)).toEqual({ day: 0, from: 1080, to: 1140 }); // 19시 아래로 못 감
  });

  it('길이 바꾸기: 시작은 그대로, 적어도 15분, 맨 아래까지', () => {
    const item = { day: 1, from: 600, to: 660, grab: 0 };
    expect(dropTarget('resize', { day: 2, min: 716 }, item, 9, 19)).toEqual({ day: 1, from: 600, to: 720 });
    expect(dropTarget('resize', { day: 1, min: 500 }, item, 9, 19)).toEqual({ day: 1, from: 600, to: 615 });
    expect(dropTarget('resize', { day: 1, min: 9999 }, item, 9, 19)).toEqual({ day: 1, from: 600, to: 1140 });
  });
});

describe('달력 한 시간 높이(11-15)', () => {
  it('짧은 일정에도 글자가 보이게 늘리고, 배율은 하루 한 화면 ~ 160px 안', async () => {
    const { autoHour, clampZoom, calPad } = await import('./components/WeekCalendar.jsx');
    expect(autoHour({ fit: 30, need: 46, shortest: 1 })).toBe(46); // 한 시간 일정 = 두어 줄
    expect(autoHour({ fit: 30, need: 46, shortest: 0.25 })).toBe(92); // 15분짜리도 0.5시간 몫으로
    expect(autoHour({ fit: 60, need: 46, shortest: 1 })).toBe(60); // 화면이 넉넉하면 꽉 채움
    expect(autoHour({ fit: 30, need: 46, shortest: 0.1 })).toBe(92);
    expect(clampZoom(0.01, 46, 30) * 46).toBeCloseTo(30); // 하루 한 화면보다 작게는 안 됨
    expect(clampZoom(10, 46, 30) * 46).toBeCloseTo(160);
    expect(clampZoom(1, 46, 30)).toBe(1);
    expect(calPad(3)).toBe(7);
    expect(calPad(7)).toBe(14);
  });
});
