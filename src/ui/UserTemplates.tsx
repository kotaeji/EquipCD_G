// TURN-057. Palette group, library management, and the save-name dialog.
import { useMemo, useState } from 'react';
import { PaletteIcon } from './Symbols';
import { NameDialog, Overlay, StaticModalFrame } from './WorkspacePanels';
import {
  normalizeTemplateName,
  suggestTemplateName,
  templateDragToken,
  templateNameKey,
  STORAGE_UNAVAILABLE,
  type UserTemplate,
} from '../model/userTemplates';
import { deleteTemplate, readTemplates, renameTemplate, saveTemplate } from '../storage/userTemplates';
import type { KV } from '../storage/localStore';
import { parseTemplateFile } from '../model/userTemplates';
import type { CapturedTemplate } from '../model/userTemplates';
import './user-templates.css';

export function PaletteTemplateGroup({ templates }: { templates: UserTemplate[] }) {
  if (!templates.length) return null;
  return (
    <div className="palette-mine" data-template-group="mine">
      <div className="palette-mine-label">내 템플릿</div>
      {templates.map((t) => (
        <div
          key={t.id}
          className="pi"
          data-template-id={t.id}
          draggable
          title={`내 템플릿 ${t.name}`}
          onDragStart={(e) => e.dataTransfer.setData('application/x-ecd-asset', templateDragToken(t.id))}
        >
          <PaletteIcon kind="unit" />
          <span className="mine-mark">내 템플릿</span>
          {t.name}
        </div>
      ))}
    </div>
  );
}

export function SaveTemplateDialog({ initial, notice, onSubmit, onCancel }: {
  initial: string;
  notice: string;
  onSubmit: (name: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  const name = normalizeTemplateName(value);
  const err = !name ? '이름을 입력하세요 (공백만은 안 됩니다)' : name.length > 60 ? '이름은 60자 이하로 입력하세요' : null;
  const submit = () => { if (!err) onSubmit(name); };
  return (
    <Overlay title="내 템플릿으로 저장" onClose={onCancel} label="내 템플릿으로 저장">
      <p className="muted" style={{ marginTop: 0 }}>이 브라우저에 저장합니다. 프로젝트의 rev 와 Undo 는 바뀌지 않습니다.</p>
      {notice && <p className="notice" data-template-omission>{notice}</p>}
      <label className="namefield">이름
        <input autoFocus aria-label="템플릿 이름" value={value} onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } }} />
      </label>
      {err && <div className="name-note err-text" role="alert">{err}</div>}
      <div className="row" style={{ justifyContent: 'flex-end', marginTop: 12, gap: 6 }}>
        <button type="button" onClick={onCancel}>취소</button>
        <button type="button" className="primary" disabled={!!err} onClick={submit}>저장</button>
      </div>
    </Overlay>
  );
}

async function readFileText(file: File): Promise<string> {
  if (typeof file.text === 'function') return file.text();
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('읽기 실패'));
    reader.readAsText(file);
  });
}

function downloadText(name: string, text: string) {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

interface LibraryProps {
  kv: KV | null;
  locked: boolean;
  onPlace: (id: string) => void;
  onChanged: () => void;
  onMessage: (message: string, err?: boolean) => void;
}

/** Stage-1 group. Rename, delete, detail, and file in/out stay here. */
export function MyTemplateLibrary({ kv, locked, onPlace, onChanged, onMessage }: LibraryProps) {
  const [rev, setRev] = useState(0);
  const stored = useMemo(() => readTemplates(kv), [kv, rev]);
  const [sel, setSel] = useState<string | null>(null);
  const [rename, setRename] = useState<UserTemplate | null>(null);
  const [remove, setRemove] = useState<UserTemplate | null>(null);
  const [clash, setClash] = useState<{ template: UserTemplate; name: string } | null>(null);
  const bump = () => { setRev((n) => n + 1); onChanged(); };
  const current = stored.templates.find((t) => t.id === sel) ?? null;
  const reason = kv ? undefined : STORAGE_UNAVAILABLE;

  const takeFile = async (file: File) => {
    if (!kv) { onMessage(STORAGE_UNAVAILABLE, true); return; }
    let text = '';
    try { text = await readFileText(file); } catch {
      onMessage('템플릿 파일을 읽지 못했습니다', true);
      return;
    }
    const parsed = parseTemplateFile(text);
    if (!parsed.ok) { onMessage(parsed.reason, true); return; }
    const hit = stored.templates.find((t) => templateNameKey(t.name) === templateNameKey(parsed.template.name));
    if (hit) { setClash({ template: parsed.template, name: parsed.template.name }); return; }
    const captured = capturedOf(parsed.template);
    const when = new Date(parsed.template.savedAt);
    const id = stored.templates.some((t) => t.id === parsed.template.id) ? undefined : parsed.template.id;
    const saved = saveTemplate(kv, captured, parsed.template.name, { id, now: Number.isNaN(when.getTime()) ? new Date() : when });
    if (!saved.ok) { onMessage(saved.reason, true); return; }
    setSel(saved.template.id);
    bump();
    onMessage(`「${saved.template.name}」을 가져왔습니다`);
  };

  return (
    <section className="my-templates" data-template-group="mine" aria-label="내 템플릿">
      <h2>내 템플릿</h2>
      <p className="muted">이 브라우저에 저장한 Unit 입니다. 번들 템플릿과 따로 두고, 이미 놓은 Unit 과는 이어지지 않습니다.</p>
      {stored.skipped > 0 && <p className="notice warn" data-template-skipped>읽을 수 없는 항목 {stored.skipped}개를 빼고 나머지를 보여 줍니다.</p>}
      {stored.templates.length === 0 && <p className="muted">저장된 내 템플릿이 없습니다.</p>}
      <div className="my-template-list">
        {stored.templates.map((t) => (
          <button key={t.id} type="button" className="my-template" data-template-id={t.id} aria-pressed={sel === t.id} onClick={() => setSel(t.id)}>
            <span className="mine-mark">내 템플릿</span>
            <b>{t.name}</b>
          </button>
        ))}
      </div>
      {current && (
        <div className="my-template-detail" data-template-detail={current.id}>
          <p>Device {current.devices.length} · Action {current.actions.length}</p>
          <div className="my-template-actions">
            <button type="button" disabled={locked || !kv} title={locked ? '실행 중에는 템플릿을 놓지 못합니다' : reason} onClick={() => onPlace(current.id)}>프로젝트에 추가</button>
            <button type="button" disabled={!kv} title={reason} onClick={() => setRename(current)}>이름 바꾸기</button>
            <button type="button" className="danger" disabled={!kv} title={reason} onClick={() => setRemove(current)}>삭제</button>
            <button type="button" onClick={() => downloadText(`${current.name}.unit-template.json`, JSON.stringify(current, null, 2))}>내보내기</button>
            <label className="filebtn">템플릿 가져오기
              <input type="file" accept=".json,application/json" disabled={!kv} title={reason} style={{ display: 'none' }}
                onChange={(e) => { const file = e.target.files?.[0]; if (file) void takeFile(file); e.target.value = ''; }} />
            </label>
          </div>
        </div>
      )}
      {!current && <label className="filebtn">템플릿 가져오기
        <input type="file" accept=".json,application/json" disabled={!kv} title={reason} style={{ display: 'none' }}
          onChange={(e) => { const file = e.target.files?.[0]; if (file) void takeFile(file); e.target.value = ''; }} />
      </label>}
      {rename && (
        <NameDialog
          title={`내 템플릿 이름 — ${rename.name}`}
          initial={rename.name}
          submitLabel="이름 바꾸기"
          hint="이미 놓은 Unit 의 이름은 바뀌지 않습니다."
          validate={(value) => {
            const name = normalizeTemplateName(value);
            if (!name) return '이름을 입력하세요 (공백만은 안 됩니다)';
            if (name.length > 60) return '이름은 60자 이하로 입력하세요';
            if (stored.templates.some((t) => t.id !== rename.id && templateNameKey(t.name) === templateNameKey(name))) return `같은 이름 「${name}」이(가) 이미 있습니다`;
            return null;
          }}
          onCancel={() => setRename(null)}
          onSubmit={(name) => {
            if (!kv) return;
            const result = renameTemplate(kv, rename.id, name);
            if (!result.ok) { onMessage(result.reason, true); return; }
            setRename(null);
            bump();
            onMessage(`이름을 「${result.template.name}」(으)로 바꿨습니다`);
          }}
        />
      )}
      {remove && (
        <StaticModalFrame title={`${remove.name} 삭제`} onCancel={() => setRemove(null)}>
          <p>내 템플릿 「{remove.name}」을 지웁니다. 이미 놓은 Unit 은 그대로입니다.</p>
          <div className="modal-actions">
            <button type="button" autoFocus ref={(el) => { el?.focus(); }} onClick={() => setRemove(null)}>취소</button>
            <button type="button" className="danger" onClick={() => {
              if (!kv) return;
              const result = deleteTemplate(kv, remove.id);
              if (!result.ok) { onMessage(result.reason, true); return; }
              setSel((id) => (id === remove.id ? null : id));
              setRemove(null);
              bump();
              onMessage(`「${remove.name}」을 지웠습니다`);
            }}>삭제</button>
          </div>
        </StaticModalFrame>
      )}
      {clash && (
        <StaticModalFrame title={`같은 이름 「${clash.name}」`} onCancel={() => setClash(null)}>
          <p>내 템플릿 「{clash.name}」이 있습니다. 덮어쓰면 저장 내용만 바뀌고, 이미 놓은 Unit 은 그대로입니다.</p>
          <div className="modal-actions">
            <button type="button" autoFocus ref={(el) => { el?.focus(); }} onClick={() => setClash(null)}>취소</button>
            <button type="button" onClick={() => {
              const next = suggestTemplateName(clash.name, stored.templates.map((t) => t.name));
              if (!kv) return;
              const id = stored.templates.some((t) => t.id === clash.template.id) ? undefined : clash.template.id;
              const saved = saveTemplate(kv, capturedOf(clash.template), next, { id });
              setClash(null);
              if (!saved.ok) { onMessage(saved.reason, true); return; }
              setSel(saved.template.id);
              bump();
              onMessage(`「${saved.template.name}」(으)로 가져왔습니다`);
            }}>새 이름</button>
            <button type="button" className="primary" onClick={() => {
              if (!kv) return;
              const hit = stored.templates.find((t) => templateNameKey(t.name) === templateNameKey(clash.name));
              const saved = saveTemplate(kv, capturedOf(clash.template), clash.name, { id: hit?.id ?? clash.template.id });
              setClash(null);
              if (!saved.ok) { onMessage(saved.reason, true); return; }
              setSel(saved.template.id);
              bump();
              onMessage(`「${saved.template.name}」을 덮어썼습니다`);
            }}>덮어쓰기</button>
          </div>
        </StaticModalFrame>
      )}
    </section>
  );
}

function capturedOf(template: UserTemplate): CapturedTemplate {
  return {
    unit: template.unit,
    devices: template.devices,
    signals: template.signals,
    positions: template.positions,
    actions: template.actions,
    connections: template.connections,
    notice: '',
    omitted: { sequenceSteps: 0, materialRoutes: 0, interlocks: 0 },
    externalConnections: 0,
  };
}
