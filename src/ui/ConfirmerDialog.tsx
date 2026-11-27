import { useState } from 'react';
import { CONFIRMER_NAME_MAX, normalizeConfirmerName } from '../model/confirmationLog';
import { IconLabel } from './Icon';
import { formatLocalClock } from './localClock';
import './confirmation-log.css';
import { StaticModalFrame } from './WorkspacePanels';

/** Asks for a confirmer name the first time this browser confirms something. */
export function ConfirmerDialog({ onSubmit, onCancel }: { onSubmit: (name: string) => void; onCancel: () => void }) {
  const [v, setV] = useState('');
  const [stamp] = useState(() => new Date());
  const name = normalizeConfirmerName(v);
  const iso = stamp.toISOString();
  const submit = () => { if (name) onSubmit(name); };
  return (
    <StaticModalFrame title="확인자 이름" onCancel={onCancel}>
      <div className="confirm-ask" data-confirmer-dialog>
        <p>로그인이나 인증은 없습니다. 적은 글자를 그대로 남깁니다.</p>
        <p>이 이름은 프로젝트 파일의 확인 이력에 들어갑니다. 60자까지입니다.</p>
        <p data-confirm-clock>기록 시각 <time dateTime={iso} title={iso}>{formatLocalClock(stamp)}</time></p>
        <label className="confirm-field">확인자 이름
          <input data-confirmer-input autoFocus maxLength={CONFIRMER_NAME_MAX} value={v} aria-label="확인자 이름"
            onChange={(e) => setV(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } }} />
        </label>
        <div className="row" style={{ justifyContent: 'flex-end', marginTop: 'var(--sp-3)' }}>
          <button type="button" onClick={onCancel}><IconLabel id="close">취소</IconLabel></button>
          <button type="button" className="primary" disabled={!name} onClick={submit}><IconLabel id="confirm">이 이름으로 확인</IconLabel></button>
        </div>
      </div>
    </StaticModalFrame>
  );
}
