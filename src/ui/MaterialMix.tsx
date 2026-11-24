// Several material definitions and the repeating feed order (TURN-080).
import { useState } from 'react';
import * as C from '../model/commands';
import { materialDeleteDetail } from '../model/deleteImpact';
import {
  countsOfCycle, feedCycle, feedMarks, materialMark, MAX_MATERIAL_DEFS, parsePatternText, patternText,
} from '../model/materialMix';
import type { Project } from '../model/types';
import type { ConfirmDelete, EditFn } from './Inspector';
import { TextInput } from './widgets';
import './MaterialMix.css';

export function MaterialMix({ p, locked, edit, confirmDelete }: {
  p: Project;
  locked: boolean;
  edit: EditFn;
  confirmDelete?: ConfirmDelete;
}) {
  const [pattern, setPattern] = useState<string | null>(null);
  if (p.materials.length === 0) return null;
  const atMax = p.materials.length >= MAX_MATERIAL_DEFS;
  const several = p.materials.length > 1;
  const cycle = feedCycle(p);
  const counts = countsOfCycle(p);
  const shownPattern = pattern ?? patternText(p);
  const commitPattern = () => {
    const parsed = parsePatternText(p, shownPattern);
    setPattern(null);
    if (!parsed.ok) return;
    if (parsed.ids.join(',') !== cycle.join(',')) edit(C.setFeedPattern(p, parsed.ids), '투입 순서');
  };
  const move = (index: number, dir: number) => {
    const next = [...cycle];
    const j = index + dir;
    if (j < 0 || j >= next.length) return;
    [next[index], next[j]] = [next[j], next[index]];
    edit(C.setFeedPattern(p, next), '투입 순서');
  };
  const removeDef = (id: string) => {
    const detail = materialDeleteDetail(p, id);
    const run = () => edit(C.removeMaterial(p, id), '자재 정의 삭제');
    const name = p.materials.find((m) => m.id === id)?.name ?? id;
    if (detail && confirmDelete) confirmDelete(`${materialMark(p, id)} ${name} 삭제`, detail, run);
    else run();
  };
  return (
    <section className="material-mix" data-material-mix="" aria-label="자재 종류">
      <h3>자재 종류</h3>
      <p className="mix-note">정의는 4개까지입니다. 투입 개수만큼 아래 순서를 되풀이하고, 간격은 모든 종류가 같습니다. 캐리어에 싣는 것은 없습니다.</p>
      <ul className="mix-defs">
        {p.materials.map((m) => {
          const letter = materialMark(p, m.id);
          return (
            <li key={m.id} className="mix-def" data-material-def={m.id} data-material-mark={letter}>
              <span className="mix-letter" aria-hidden="true">{letter}</span>
              <label>이름 <TextInput value={m.name} disabled={locked} width={140} onCommit={(v) => edit(C.renameObject(p, m.id, v), '자재 이름')} /></label>
              <label>표식 <input aria-label={`${letter} 표식`} className="num" disabled={locked} defaultValue={m.mark ?? ''} key={`${m.id}:${m.mark ?? ''}`}
                onBlur={(e) => { const v = e.target.value.trim(); if (v !== (m.mark ?? '')) edit(C.setMaterialMark(p, m.id, v), '자재 표식'); }} /></label>
              <label>상태 <TextInput value={m.states.join(', ')} disabled={locked} width={180} onCommit={(v) => edit(C.updateMaterial(p, m.id, { states: v.split(',').map((x) => x.trim()).filter(Boolean) }), '상태집합')} /></label>
              <label>처음 상태 <select aria-label={`${letter} 처음 상태`} disabled={locked} value={m.initialState ?? ''} onChange={(e) => edit(C.updateMaterial(p, m.id, { initialState: e.target.value || null }), '초기 상태')}>
                <option value="">(미정)</option>
                {m.states.map((s) => <option key={s}>{s}</option>)}
              </select></label>
              <label>처음 위치 <select aria-label={`${letter} 처음 위치`} disabled={locked} value={m.initialLocation ?? ''} onChange={(e) => edit(C.updateMaterial(p, m.id, { initialLocation: e.target.value || null }), '초기 위치')}>
                <option value="">(미정)</option>
                {p.units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select></label>
              {several && <button type="button" className="small danger" disabled={locked} aria-label={`${letter} 정의 삭제`} onClick={() => removeDef(m.id)}>삭제</button>}
            </li>
          );
        })}
      </ul>
      <div className="mix-slot">
        <button type="button" disabled={locked || atMax} aria-label="자재 정의 추가" data-material-add="" onClick={() => edit(C.addMaterial(p), '자재 정의 추가')}>정의 추가</button>
        {atMax && <span className="mix-note" data-material-cap="">자재 정의는 4개까지입니다. 다섯 번째는 더할 수 없습니다.</span>}
      </div>
      {several && <>
        <label>투입 순서 <input aria-label="투입 순서" value={shownPattern} disabled={locked} onChange={(e) => setPattern(e.target.value)} onBlur={commitPattern}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} /></label>
        <ol className="mix-pattern" data-feed-pattern="">
          {cycle.map((id, i) => (
            <li key={`${id}:${i}`} className="mix-slot" data-feed-slot={materialMark(p, id)}>
              <span>{materialMark(p, id)}</span>
              <button type="button" className="small" disabled={locked || i === 0} aria-label={`순서 ${i + 1} 위로`} onClick={() => move(i, -1)}>위로</button>
              <button type="button" className="small" disabled={locked || i === cycle.length - 1} aria-label={`순서 ${i + 1} 아래로`} onClick={() => move(i, 1)}>아래로</button>
              <button type="button" className="small" disabled={locked || cycle.length < 2} aria-label={`순서 ${i + 1} 빼기`} onClick={() => { const next = cycle.filter((_, j) => j !== i); if (next.length) edit(C.setFeedPattern(p, next), '투입 순서'); }}>빼기</button>
            </li>
          ))}
        </ol>
        <div className="mix-slot">
          <span className="mix-note">종류별 개수 (한 차례)</span>
          {p.materials.map((m) => {
            const letter = materialMark(p, m.id);
            return (
              <label key={m.id}>{letter} <input aria-label={`${letter} 종류별 개수`} className="num" type="number" min={0} step={1} disabled={locked}
                key={`${m.id}:${counts[m.id] ?? 0}`} defaultValue={counts[m.id] ?? 0}
                onBlur={(e) => {
                  const n = Number(e.target.value);
                  if (!Number.isInteger(n) || n < 0 || n === (counts[m.id] ?? 0)) { e.target.value = String(counts[m.id] ?? 0); return; }
                  edit(C.setFeedCounts(p, { ...counts, [m.id]: n }), '종류별 개수');
                }} /></label>
            );
          })}
        </div>
        <p className="mix-preview" data-feed-preview="">투입 {feedMarks(p).join(' ')}</p>
      </>}
    </section>
  );
}
