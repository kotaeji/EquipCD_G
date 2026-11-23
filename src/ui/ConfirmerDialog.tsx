import { useState } from 'react';
import { CONFIRMER_NAME_MAX, normalizeConfirmerName } from '../model/confirmationLog';
import './confirmation-log.css';
import { StaticModalFrame } from './WorkspacePanels';

/** Asks for a confirmer name the first time this browser confirms something. */
export function ConfirmerDialog({ onSubmit, onCancel }: { onSubmit: (name: string) => void; onCancel: () => void }) {
  const [v, setV] = useState('');
  const name = normalizeConfirmerName(v);
  const submit = () => { if (name) onSubmit(name); };
  return (
    <StaticModalFrame title="확인자 이름" onCancel={onCancel}>
      <div className="confirm-ask" data-confirmer-dialog>
        <p>로그인이나 인증은 없습니다. 적은 글자를 그대로 남깁니다.</p>
        <p>이 이름은 프로젝트 파일의 확인 이력에 들어갑니다. 60자까지입니다.</p>
        <label className="confirm-field">확인자 이름
          <input data-confirmer-input autoFocus maxLength={CONFIRMER_NAME_MAX} value={v} aria-label="확인자 이름"
            onChange={(e) => setV(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } }} />
        </label>
        <div className="row" style={{ justifyContent: 'flex-end', marginTop: 'var(--sp-3)' }}>
          <button type="button" onClick={onCancel}>취소</button>
          <button type="button" className="primary" disabled={!name} onClick={submit}>이 이름으로 확인</button>
        </div>
      </div>
    </StaticModalFrame>
  );
}
