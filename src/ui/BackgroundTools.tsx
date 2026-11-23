import { useEffect, useRef, useState } from 'react';

function readFileBytes(file: Blob): Promise<Uint8Array> {
  const withBuffer = file as Blob & { arrayBuffer?: () => Promise<ArrayBuffer> };
  if (typeof withBuffer.arrayBuffer === 'function') return withBuffer.arrayBuffer().then((buf) => new Uint8Array(buf));
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error ?? new Error('파일을 읽지 못했습니다'));
    reader.readAsArrayBuffer(file);
  });
}

import { assessBackground, normalizeImageMime, pixelDistance, type AssessedImage, type BackgroundReject } from '../model/background';
import type { DiagramBackground } from '../model/types';
import { Problem } from './Problem';
import { backgroundRejectProblem, type ProblemCopy } from './problemCopy';
import './background-tools.css';

interface Props {
  bg: DiagramBackground | null;
  disabled: boolean;
  picking: boolean;
  points: { x: number; y: number }[];
  onTogglePick: () => void;
  onPlace: (image: AssessedImage, replace: boolean) => void;
  onReject: (problem: ProblemCopy) => void;
  onClear: () => void;
  onOpacity: (opacity: number) => void;
  onPosition: (x: number, y: number) => void;
  onScale: (scale: number) => void;
  onLocked: (locked: boolean) => void;
  onApplyDistance: (mm: number) => void;
}

/** Stage-2 toolbar for the one background drawing. */
export function BackgroundTools(props: Props) {
  const { bg, disabled } = props;
  const [open, setOpen] = useState(false);
  const [reject, setReject] = useState<ProblemCopy | null>(null);
  const [opacity, setOpacity] = useState(bg?.opacity ?? 100);
  const [mm, setMm] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const replaceRef = useRef(false);
  const opacityCommitted = useRef(bg?.opacity ?? 100);
  useEffect(() => {
    setOpacity(bg?.opacity ?? 100);
    opacityCommitted.current = bg?.opacity ?? 100;
  }, [bg?.opacity, bg?.dataUrl]);

  const fail = (reason: BackgroundReject) => {
    const problem = backgroundRejectProblem(reason);
    setReject(problem);
    props.onReject(problem);
  };
  const take = async (file: File | undefined) => {
    if (!file || disabled) return;
    let bytes: Uint8Array;
    try { bytes = await readFileBytes(file); } catch { fail({ code: 'not-image' }); return; }
    const mime = normalizeImageMime(file.type, file.name);
    const assessed = assessBackground(bytes, mime);
    if (!assessed.ok) { fail(assessed.reason); return; }
    setReject(null);
    props.onPlace(assessed.image, replaceRef.current);
  };
  const pickFile = (replace: boolean) => {
    replaceRef.current = replace;
    fileRef.current?.click();
  };
  const commitOpacity = (value: number) => {
    if (!bg || value === opacityCommitted.current) return;
    opacityCommitted.current = value;
    props.onOpacity(value);
  };
  const span = props.points.length === 2 ? pixelDistance(props.points[0], props.points[1]) : 0;
  const pickLabel = props.points.length === 0 ? '그림에서 첫 점을 누르세요' : props.points.length === 1 ? '그림에서 둘째 점을 누르세요' : `두 점 거리 ${span.toFixed(1)} px`;

  return (
    <div className="bg-tools">
      <button type="button" className={open ? 'on' : ''} aria-expanded={open} aria-controls="bg-panel" onClick={() => setOpen((v) => !v)}>배경 도면</button>
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,.png,.jpg,.jpeg"
        data-background-file=""
        hidden
        onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ''; void take(file); }}
      />
      {open && (
        <div id="bg-panel" className="bg-panel" role="dialog" aria-label="배경 도면">
          {!bg && <p className="bg-hint">PNG · JPEG 한 장. 2MB 이하, 긴 변 4096px 이하.</p>}
          {!bg && <button type="button" disabled={disabled} onClick={() => pickFile(false)}>그림 넣기</button>}
          {bg && (
            <>
              <label className="bg-check"><input type="checkbox" checked={bg.locked} disabled={disabled} onChange={(e) => props.onLocked(e.target.checked)} /> 배경 잠금</label>
              <label>불투명도 {opacity}%
                <input type="range" min={10} max={100} aria-label="배경 불투명도" value={opacity} disabled={disabled}
                  onChange={(e) => setOpacity(Number(e.target.value))}
                  onPointerUp={(e) => commitOpacity(Number((e.target as HTMLInputElement).value))}
                  onKeyUp={(e) => commitOpacity(Number((e.target as HTMLInputElement).value))}
                  onBlur={(e) => commitOpacity(Number(e.target.value))} />
              </label>
              <label>X <input type="number" aria-label="배경 X" defaultValue={bg.x} key={`x-${bg.x}`} disabled={disabled || bg.locked}
                onBlur={(e) => { const x = Number(e.target.value); if (x !== bg.x) props.onPosition(x, bg.y); }} /></label>
              <label>Y <input type="number" aria-label="배경 Y" defaultValue={bg.y} key={`y-${bg.y}`} disabled={disabled || bg.locked}
                onBlur={(e) => { const y = Number(e.target.value); if (y !== bg.y) props.onPosition(bg.x, y); }} /></label>
              <label>배율 mm/px <input type="number" aria-label="배경 배율" min={0.001} step="0.1" defaultValue={bg.scale} key={`s-${bg.scale}`} disabled={disabled || bg.locked}
                onBlur={(e) => { const scale = Number(e.target.value); if (scale !== bg.scale) props.onScale(scale); }} /></label>
              <button type="button" disabled={disabled || bg.locked} aria-pressed={props.picking} title={bg.locked ? '배경 잠금을 푼 뒤 점을 찍으세요' : '그림 위 두 점과 실제 거리'} onClick={props.onTogglePick}>두 점 축척 맞춤</button>
              {props.picking && <p className="bg-hint" data-bg-pick="">{pickLabel}</p>}
              {props.picking && props.points.length === 2 && (
                <label>실제 거리 mm
                  <input type="number" aria-label="실제 거리" min={0.001} step="1" value={mm} disabled={disabled} onChange={(e) => setMm(e.target.value)} />
                  <button type="button" disabled={disabled || !(Number(mm) > 0)} onClick={() => props.onApplyDistance(Number(mm))}>배율 적용</button>
                </label>
              )}
              <button type="button" disabled={disabled} onClick={() => pickFile(true)}>배경 바꾸기</button>
              <button type="button" className="danger" disabled={disabled} onClick={props.onClear}>배경 지우기</button>
            </>
          )}
          {reject && <div data-background-reject=""><Problem copy={reject} /></div>}
        </div>
      )}
    </div>
  );
}
