import { useMemo, useState } from 'react';
import type { UserTemplate } from '../model/userTemplates';
import {
  buildStarter,
  bundleTemplates,
  formatVirtualTime,
  sampleCards,
  STARTER_MAX_UNITS,
  STARTER_MIN_UNITS,
  starterPreview,
  type SampleKind,
  type StarterFill,
  type StarterSpec,
} from '../model/starter';
import { IconLabel } from './Icon';
import './starter-home.css';

const BUNDLES = bundleTemplates();

function fillOf(value: string, templates: UserTemplate[]): StarterFill {
  if (value.startsWith('bundle:')) return { kind: 'bundle', assetKind: value.slice('bundle:'.length) };
  if (value.startsWith('user:')) {
    const template = templates.find((t) => t.id === value.slice('user:'.length));
    if (template) return { kind: 'user', template };
  }
  return { kind: 'empty' };
}

function freshNames(count: number): string[] {
  return Array.from({ length: count }, (_, i) => `S${i + 1}`);
}

export function StarterHome({ templates, onBlank, onOpenSample, onCreate }: {
  templates: UserTemplate[];
  onBlank: () => void;
  onOpenSample: (kind: SampleKind) => void;
  /** Return false when the project was not opened, so the answers stay on screen. */
  onCreate: (spec: StarterSpec) => boolean;
}) {
  const cards = sampleCards();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [name, setName] = useState('새 프로젝트');
  const [count, setCount] = useState(3);
  const [names, setNames] = useState(() => freshNames(3));
  const [fills, setFills] = useState(() => Array.from({ length: 3 }, () => 'empty'));
  const [link, setLink] = useState(true);

  const reset = () => {
    setOpen(false);
    setStep(1);
    setName('새 프로젝트');
    setCount(3);
    setNames(freshNames(3));
    setFills(Array.from({ length: 3 }, () => 'empty'));
    setLink(true);
  };
  const changeCount = (n: number) => {
    const next = Math.min(STARTER_MAX_UNITS, Math.max(STARTER_MIN_UNITS, n));
    setCount(next);
    setNames((prev) => {
      const copy = prev.slice(0, next);
      while (copy.length < next) copy.push(`S${copy.length + 1}`);
      return copy;
    });
    setFills((prev) => {
      const copy = prev.slice(0, next);
      while (copy.length < next) copy.push('empty');
      return copy;
    });
  };
  const spec = useMemo<StarterSpec>(() => ({
    name,
    linkFlow: link,
    units: names.slice(0, count).map((unitName, i) => ({ name: unitName, fill: fillOf(fills[i] ?? 'empty', templates) })),
  }), [name, link, names, count, fills, templates]);
  const built = useMemo(() => (step === 3 ? buildStarter(spec) : null), [step, spec]);
  const namesOk = name.trim().length > 0 && spec.units.every((u) => u.name.trim().length > 0);

  return <div className="starter-home" data-starter-home="">
    {!open && <>
      <section className="starter-new">
        <div>
          <h2>새 프로젝트</h2>
          <p>빈 프로젝트로 바로 열거나, Unit 과 연결만 있는 뼈대부터 시작합니다.</p>
        </div>
        <div className="starter-actions">
          <button type="button" className="btn-main primary" onClick={onBlank}><IconLabel id="new-project">빈 프로젝트 만들기</IconLabel></button>
          <button type="button" className="btn-main secondary" onClick={() => setOpen(true)}><IconLabel id="starter">뼈대부터</IconLabel></button>
        </div>
      </section>
      <h2 className="starter-gallery-title">예제 갤러리</h2>
      <div className="starter-gallery" data-sample-gallery="">
        {cards.map((card) => <article key={card.kind} className="starter-card" data-sample-card={card.kind}>
          <h3>{card.name}</h3>
          <p>{card.summary}</p>
          <p className="starter-shows" data-sample-shows="">{card.shows}</p>
          <p data-sample-counts="">Unit {card.units} · Device {card.devices} · 단계 {card.steps}</p>
          <p data-sample-time="">{`가상 시간 ${formatVirtualTime(card.virtualMs)}`}</p>
          <button type="button" className="btn-main secondary" data-sample-open={card.kind} aria-label={card.openLabel} onClick={() => onOpenSample(card.kind)}>
            <IconLabel id={card.icon}>열기</IconLabel>
          </button>
        </article>)}
      </div>
    </>}
    {open && <section className="starter-wizard" data-starter-wizard="" data-starter-step={step} aria-label="시작 마법사">
      <p className="starter-step">{`걸음 ${step} / 3`}</p>
      {step === 1 && <>
        <h2>이름과 Unit</h2>
        <div className="starter-fields">
          <label>프로젝트 이름
            <input aria-label="프로젝트 이름" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label>Unit 수
            <select aria-label="Unit 수" value={count} onChange={(e) => changeCount(Number(e.target.value))}>
              {Array.from({ length: STARTER_MAX_UNITS }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          {names.slice(0, count).map((unitName, i) => <label key={i}>{`Unit ${i + 1}`}
            <input aria-label={`Unit ${i + 1} 이름`} value={unitName} onChange={(e) => setNames((prev) => prev.map((v, j) => j === i ? e.target.value : v))} />
          </label>)}
        </div>
      </>}
      {step === 2 && <>
        <h2>Unit 마다 내용</h2>
        <div className="starter-fields">
          {spec.units.map((unit, i) => <label key={i}>{unit.name || `Unit ${i + 1}`}
            <select aria-label={`${unit.name || `Unit ${i + 1}`} 내용`} value={fills[i] ?? 'empty'} onChange={(e) => setFills((prev) => prev.map((v, j) => j === i ? e.target.value : v))}>
              <option value="empty">빈 Unit</option>
              <optgroup label="번들 유닛 템플릿">
                {BUNDLES.map((d) => <option key={d.kind} value={`bundle:${d.kind}`}>{d.name}</option>)}
              </optgroup>
              {templates.length > 0 && <optgroup label="내 템플릿">
                {templates.map((t) => <option key={t.id} value={`user:${t.id}`}>{t.name}</option>)}
              </optgroup>}
            </select>
          </label>)}
        </div>
      </>}
      {step === 3 && <>
        <h2>물류 연결</h2>
        <div className="starter-choice">
          <label><input type="radio" name="starter-link" checked={link} onChange={() => setLink(true)} /> 물류 연결 켜기</label>
          <label><input type="radio" name="starter-link" checked={!link} onChange={() => setLink(false)} /> 물류 연결 끄기</label>
        </div>
        <p>순서대로 Unit 을 잇습니다. 시퀀스와 자재는 만들지 않습니다.</p>
        {built?.ok
          ? <p className="starter-preview" data-starter-preview="">{`Unit ${starterPreview(built.project).units} · Device ${starterPreview(built.project).devices} · 연결 ${starterPreview(built.project).connections}`}</p>
          : <p className="starter-preview" data-starter-preview="">{built?.reason ?? ''}</p>}
      </>}
      <div className="starter-actions">
        <button type="button" className="btn-main secondary" onClick={reset}>취소</button>
        {step > 1 && <button type="button" className="btn-main secondary" onClick={() => setStep((s) => (s === 1 ? 1 : (s - 1) as 1 | 2 | 3))}>뒤로</button>}
        {step < 3 && <button type="button" className="btn-main primary" disabled={!namesOk} onClick={() => setStep((s) => (s === 3 ? 3 : (s + 1) as 1 | 2 | 3))}>다음</button>}
        {step === 3 && <button type="button" className="btn-main primary" disabled={!built?.ok} onClick={() => { if (onCreate(spec)) reset(); }}>만들기</button>}
      </div>
    </section>}
  </div>;
}
