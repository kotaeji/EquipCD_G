import { useState } from 'react';
import type { Project } from '../model/types';
import {
  SCENARIO_CURRENT,
  SCENARIO_LOCK,
  addRunScenario,
  commitRunScenario,
  deleteRunScenario,
  missingStepNote,
  renameRunScenario,
  runAllScenarios,
  scenarioMatches,
  scenarioStatusText,
  scenarioTimeText,
  scenariosOf,
  type ScenarioRunRow,
} from '../model/scenarios';
import type { EditFn } from './Inspector';
import { IconLabel } from './Icon';
import { Overlay } from './WorkspacePanels';
import './run-scenarios.css';

/** Head of the run-conditions column: pick, save, rename, delete, and run every scenario. */
export function RunScenarios({ p, locked, edit, speed, setSpeed }: {
  p: Project;
  locked: boolean;
  edit: EditFn;
  speed: number;
  setSpeed: (n: number) => void;
}) {
  const scenarios = scenariosOf(p);
  const selected = scenarios.find((s) => scenarioMatches(p, speed, s)) ?? null;
  const [naming, setNaming] = useState<null | 'save' | 'rename'>(null);
  const [name, setName] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [report, setReport] = useState<ScenarioRunRow[] | null>(null);

  const openName = (mode: 'save' | 'rename') => {
    if (locked) return;
    if (mode === 'rename' && !selected) return;
    setNaming(mode);
    setName(mode === 'rename' && selected ? selected.name : '');
    setNameError(null);
  };

  const commitName = () => {
    if (!naming || locked) return;
    const result = naming === 'save'
      ? addRunScenario(p, speed, name)
      : renameRunScenario(p, selected?.id ?? '', name);
    if (!result.ok) { setNameError(result.reason); return; }
    if (!edit(result, naming === 'save' ? '시나리오 저장' : '시나리오 이름 바꾸기')) return;
    setNaming(null);
    setNotice(null);
  };

  const pick = (id: string) => {
    if (locked || !id) return;
    const scenario = scenarios.find((s) => s.id === id);
    if (!scenario) return;
    const applied = commitRunScenario(p, scenario);
    if (applied.changed && !edit({ ok: true, project: applied.project }, '시나리오 적용')) return;
    if (scenario.speed !== speed) setSpeed(scenario.speed);
    setNotice(applied.dropped > 0 ? missingStepNote(applied.dropped) : null);
  };

  const remove = () => {
    if (locked || !selected) return;
    edit(deleteRunScenario(p, selected.id), '시나리오 삭제');
    setNotice(null);
  };

  return (
    <section className="run-scenarios" aria-label="실행 시나리오">
      <h3>시나리오</h3>
      {locked && <p className="run3d-lock" data-scenario-locked="">{SCENARIO_LOCK}</p>}
      <label className="run-scenario-field">시나리오
        <select aria-label="시나리오" data-scenario-select="" disabled={locked} value={selected?.id ?? ''} onChange={(e) => pick(e.target.value)}>
          <option value="">{SCENARIO_CURRENT}</option>
          {scenarios.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </label>
      <ul className="run-scenario-list" data-scenario-list="" aria-label="저장된 시나리오">
        {scenarios.map((s) => <li key={s.id} data-scenario-id={s.id}>{s.name}</li>)}
      </ul>
      <div className="run-scenario-actions">
        <button type="button" disabled={locked} onClick={() => openName('save')}><IconLabel id="save">저장…</IconLabel></button>
        <button type="button" disabled={locked || !selected} onClick={() => openName('rename')}><IconLabel id="rename">이름 바꾸기</IconLabel></button>
        <button type="button" disabled={locked || !selected} onClick={remove}><IconLabel id="delete">삭제</IconLabel></button>
        <button type="button" data-scenario-run-all="" disabled={scenarios.length === 0} onClick={() => setReport(runAllScenarios(p, scenarios))}><IconLabel id="to-end">시나리오 모두 실행</IconLabel></button>
      </div>
      {notice && <p className="run-scenario-note" data-scenario-notice="">{notice}</p>}
      {naming && (
        <Overlay title={naming === 'save' ? '시나리오 저장' : '시나리오 이름 바꾸기'} onClose={() => setNaming(null)}>
          <label className="run-scenario-field">이름
            <input autoFocus aria-label="시나리오 이름" value={name} onChange={(e) => { setName(e.target.value); setNameError(null); }}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commitName(); } }} />
          </label>
          {nameError && <p className="run-scenario-note" role="alert">{nameError}</p>}
          <div className="row">
            <button type="button" onClick={() => setNaming(null)}>취소</button>
            <button type="button" className="primary" onClick={commitName}>{naming === 'save' ? '저장' : '이름 바꾸기'}</button>
          </div>
        </Overlay>
      )}
      {report && (
        <Overlay title="시나리오 모두 실행" className="run-scenario-report" label="시나리오 모두 실행" onClose={() => setReport(null)}>
          <table data-scenario-report="">
            <thead>
              <tr><th>시나리오</th><th>끝남 / 오류 코드</th><th>총 시간</th><th>간 갈래 요약</th></tr>
            </thead>
            <tbody>
              {report.map((row) => (
                <tr key={row.id} data-scenario-row={row.id}>
                  <td>{row.name}</td>
                  <td>{scenarioStatusText(row)}</td>
                  <td className="mono">{scenarioTimeText(row.totalMs)}</td>
                  <td>{row.branchSummary}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted">열린 실행은 바꾸지 않습니다. 사본에서 끝까지 계산했습니다.</p>
          <button type="button" onClick={() => setReport(null)}>닫기</button>
        </Overlay>
      )}
    </section>
  );
}
