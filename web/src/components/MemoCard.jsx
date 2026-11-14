// 메모(왼쪽 아래, 나와의 채팅처럼 쌓인다). 팝업으로 일정에 넣은 메모(event_id)·밤 정리로 할 일이 된 메모(task_id) 아래에는 한 줄을 붙인다.
import { useEffect, useRef } from 'react';
import { dayLabel, hhmm } from '../time.js';

// widget = 넓은 화면 '오늘' 쪽 위젯 칸(WidgetGrid의 widget('memo')): { slot, lifted, grip }
// onTidy = '지금 정리' 창 열기(11-13 사람 피드백 10 · 15). 없으면 단추도 없다
// onClear = 메모 모두 지우기(11-15 사람). 묻고 나서 부른다. 메모가 없으면 단추도 없다
export default function MemoCard({ memos, now, activeId, waiting, widget = {}, onTidy, onClear }) {
  const logRef = useRef(null);

  useEffect(() => {
    const log = logRef.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, [memos.length, waiting, activeId]);

  let lastDay = null;
  return (
    <section className={`card memo-card${widget.lifted ? ' lifted' : ''}`} data-slot={widget.slot} data-widget={widget.slot && 'memo'} aria-label="메모">
      {widget.grip}
      <div className="tasks-head">
        <h2 className="card-title">메모</h2>
        <span className="grow" />
        {onClear && memos.length > 0 && (
          <button type="button" className="btn-text" onClick={() => window.confirm('메모를 모두 지울까요? 되돌릴 수 없어요. 메모로 넣은 일정·할 일은 그대로 남아요.') && onClear()}>
            모두 지우기
          </button>
        )}
        {onTidy && (
          <button type="button" className="btn-text" onClick={onTidy}>
            지금 정리
          </button>
        )}
      </div>
      <div className="memo-log" ref={logRef} aria-live="polite">
        {memos.length === 0 && <p className="empty">아래 칸에 적으면 여기에 쌓여요</p>}
        {memos.map((memo) => {
          const day = dayLabel(memo.created_at, now);
          const showDay = day !== lastDay;
          lastDay = day;
          return (
            <div key={memo.id} style={{ display: 'contents' }}>
              {showDay && <p className="memo-day">{day}</p>}
              <div className="bubble-row">
                <time className="num" dateTime={memo.created_at}>
                  {hhmm(memo.created_at)}
                </time>
                <span className={memo.id === activeId ? 'bubble on' : 'bubble'}>{memo.text}</span>
              </div>
              {memo.event_id && <p className="memo-saved">달력에 넣었어요</p>}
              {!memo.event_id && memo.task_id && <p className="memo-saved">할 일에 넣었어요</p>}
            </div>
          );
        })}
        {waiting && <p className="memo-wait">살펴보는 중…</p>}
      </div>
    </section>
  );
}
