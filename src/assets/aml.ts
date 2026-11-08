// AML (CAEX 3.0) library reader / writer for the app-supported SUBSET.
// - Target: CAEX 3.0 (IEC 62424:2016 schema "CAEX_ClassModel_V.3.0.xsd" as published by AutomationML e.V.),
//   SuperiorStandardVersion "AutomationML 2.10". Official XSD validation is done OUTSIDE the browser
//   (scripts/validate-aml.py with lxml); the in-app reader only does XML well-formedness + subset semantic checks.
// - Standard CAEX constructs used: SystemUnitClassLib/SystemUnitClass, Attribute(Unit, AttributeDataType, DefaultValue),
//   ExternalInterface (RefBaseClassPath → ECD_InterfaceClassLib/ConceptSignal ⊂ AutomationML SignalInterface;
//   AutomationML ExternalDataReference with refURI/MIMEType for images), InternalElement (RefBaseSystemUnitPath),
//   InternalLink (RefPartnerSideA/B = interface IDs), SupportedRoleClass (RefRoleClassPath), RoleClassLib, InterfaceClassLib.
// - App-only semantics (actions, simulation timing, name prefix, category, template layout/rules) live in
//   Attribute "ECD.AppExtension" — an application extension, NOT AutomationML standard semantics.
// This is NOT a general AutomationML importer. Unsupported constructs are reported, never silently treated as supported.
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import type { ActionKind, AssetActionTemplate, AssetDefinition, PortDef, PropertyDef, TemplateChild, TemplateLink, TemplateRule } from '../model/types';

export const CAEX_NS = 'http://www.dke.de/CAEX';
export const SUPPORTED_SCHEMA_VERSIONS = ['3.0'];
export const SUPERIOR_STANDARD = 'AutomationML 2.10';
export const ASSET_LIB_NAME = 'ECD_SampleAssetLib';
export const ROLE_LIB_NAME = 'ECD_RoleClassLib';
export const IF_LIB_NAME = 'ECD_InterfaceClassLib';
export const SIGNAL_CLASS_PATH = `${IF_LIB_NAME}/ConceptSignal`;
export const FLOW_CLASS_PATH = `${IF_LIB_NAME}/MaterialFlowPort`;
export const EXT_DATA_REF_PATH = 'AutomationMLInterfaceClassLib/AutomationMLBaseInterface/ExternalDataConnector/ExternalDataReference';
export const APP_EXT = 'ECD.AppExtension';

export interface AmlDiag { severity: 'error' | 'warning'; code: string; where: string; message: string }
export interface AmlParseResult {
  ok: boolean;
  defs: AssetDefinition[];
  diags: AmlDiag[];
  meta: { schemaVersion: string | null; superiorStandard: string[]; fileName: string | null; xsdValidatedInApp: false };
}

const ARRAY_TAGS = new Set(['Attribute', 'ExternalInterface', 'InternalElement', 'SystemUnitClass', 'RoleClass', 'InterfaceClass', 'SupportedRoleClass',
  'InternalLink', 'SystemUnitClassLib', 'RoleClassLib', 'InterfaceClassLib', 'SourceDocumentInformation', 'SuperiorStandardVersion', 'ExternalReference',
  'InstanceHierarchy', 'AttributeTypeLib', 'RoleRequirements', 'Revision', 'AdditionalInformation']);

type X = Record<string, any>;
const arr = (v: any): X[] => (Array.isArray(v) ? v : v === undefined ? [] : [v]);
const text = (v: any): string | null => {
  if (v === undefined || v === null) return null;
  if (typeof v === 'object') return v['#text'] !== undefined ? String(v['#text']) : null;
  return String(v);
};
const attrsOf = (e: X): X[] => arr(e.Attribute);
const attrNamed = (e: X, name: string) => attrsOf(e).find((a) => a['@_Name'] === name);
const valueOf = (e: X | undefined): string | null => (e ? text(e.Value) ?? text(e.DefaultValue) : null);
const childVal = (e: X | undefined, name: string) => (e ? valueOf(attrNamed(e, name)) : null);
const num = (s: string | null): number | null => (s === null || s.trim() === '' ? null : Number.isFinite(Number(s)) ? Number(s) : NaN);

const ACTION_KINDS: ActionKind[] = ['extend', 'retract', 'read', 'work', 'pick', 'move', 'place', 'convey', 'raise', 'lower', 'detect'];
const CATS = ['axis', 'io', 'sensor', 'transport', 'unit'] as const;

/** Parse an AML text and build AssetDefinitions for the supported subset. Never throws. */
export function parseAmlLibrary(xml: string, file = 'imported.aml', origin: 'bundled' | 'imported' = 'imported'): AmlParseResult {
  const diags: AmlDiag[] = [];
  const meta: AmlParseResult['meta'] = { schemaVersion: null, superiorStandard: [], fileName: null, xsdValidatedInApp: false };
  const err = (code: string, where: string, message: string) => diags.push({ severity: 'error', code, where, message });
  const warn = (code: string, where: string, message: string) => diags.push({ severity: 'warning', code, where, message });
  const fail = (): AmlParseResult => ({ ok: false, defs: [], diags, meta });

  const wf = XMLValidator.validate(xml);
  if (wf !== true) { err('XML_SYNTAX', `line ${wf.err.line}`, `XML 구문 오류: ${wf.err.msg}`); return fail(); }
  let doc: X;
  try {
    doc = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', parseTagValue: false, parseAttributeValue: false, trimValues: true,
      isArray: (name) => ARRAY_TAGS.has(name) }).parse(xml);
  } catch (e) { err('XML_SYNTAX', 'document', `XML 파싱 실패: ${(e as Error).message}`); return fail(); }
  const rootKey = Object.keys(doc).find((k) => !k.startsWith('?') && !k.startsWith('#'));
  if (!rootKey || rootKey.includes(':')) { err('NOT_CAEX', 'root', `루트가 CAEXFile이 아님 (${rootKey ?? '없음'}; 접두어 namespace 형식은 미지원)`); return fail(); }
  if (rootKey !== 'CAEXFile') { err('NOT_CAEX', 'root', `루트 요소 ${rootKey} — CAEXFile 필요`); return fail(); }
  const root = doc.CAEXFile as X;
  if (root['@_xmlns'] !== CAEX_NS) { err('NAMESPACE', 'CAEXFile', `기본 namespace가 ${CAEX_NS} 가 아님 (${root['@_xmlns'] ?? '없음'})`); return fail(); }
  meta.schemaVersion = root['@_SchemaVersion'] ?? null;
  meta.fileName = root['@_FileName'] ?? null;
  meta.superiorStandard = arr(root.SuperiorStandardVersion).map((v) => text(v) ?? '');
  if (!meta.schemaVersion || !SUPPORTED_SCHEMA_VERSIONS.includes(meta.schemaVersion)) { err('SCHEMA_VERSION', 'CAEXFile/@SchemaVersion', `지원하지 않는 CAEX SchemaVersion "${meta.schemaVersion}" (지원: ${SUPPORTED_SCHEMA_VERSIONS.join(', ')})`); return fail(); }
  if (!meta.superiorStandard.includes(SUPERIOR_STANDARD)) warn('SUPERIOR_STANDARD', 'CAEXFile', `SuperiorStandardVersion "${SUPERIOR_STANDARD}" 아님 (${meta.superiorStandard.join(', ') || '없음'}) — 앱 subset 해석은 계속`);
  if (arr(root.SourceDocumentInformation).length === 0) warn('NO_SOURCE_INFO', 'CAEXFile', 'SourceDocumentInformation 없음 (CAEX 3.0 XSD 필수 요소 — 공식 XSD 검증 시 실패 예상)');
  if (arr(root.ExternalReference).length) warn('UNSUPPORTED_EXTREF', 'CAEXFile/ExternalReference', 'CAEX ExternalReference(외부 AML 파일)는 지원하지 않음 — 무시');
  if (arr(root.InstanceHierarchy).length) warn('UNSUPPORTED_IH', 'CAEXFile/InstanceHierarchy', 'InstanceHierarchy는 라이브러리 가져오기에서 사용하지 않음 — 무시');

  const sucLibs = arr(root.SystemUnitClassLib);
  if (!sucLibs.length) { err('NO_SUC_LIB', 'CAEXFile', 'SystemUnitClassLib 없음'); return fail(); }
  const roleLibs = new Map(arr(root.RoleClassLib).map((l) => [l['@_Name'], l]));
  const roleExists = (path: string) => {
    const [lib, ...rest] = path.split('/'); let cur: X | undefined = roleLibs.get(lib);
    for (const seg of rest) { cur = cur ? arr(cur.RoleClass).find((r) => r['@_Name'] === seg) : undefined; }
    return !!cur && rest.length > 0;
  };

  // collect all SUCs (flat; nested SystemUnitClass not supported)
  const sucs: { lib: string; e: X }[] = [];
  for (const lib of sucLibs) for (const e of arr(lib.SystemUnitClass)) {
    sucs.push({ lib: lib['@_Name'], e });
    if (arr(e.SystemUnitClass).length) warn('UNSUPPORTED_NESTED_SUC', `${lib['@_Name']}/${e['@_Name']}`, '중첩 SystemUnitClass(상속 계층)는 지원하지 않음 — 무시');
  }
  const byPath = new Map(sucs.map((s) => [`${s.lib}/${s.e['@_Name']}`, s]));
  const seenIds = new Set<string>();
  const defs: AssetDefinition[] = [];

  for (const { lib, e } of sucs) {
    const path = `${lib}/${e['@_Name']}`;
    const before = diags.filter((d) => d.severity === 'error').length;
    const kind = e['@_Name']; const id = e['@_ID'];
    if (!kind) { err('SUC_NO_NAME', path, 'SystemUnitClass Name 없음'); continue; }
    if (!id) err('SUC_NO_ID', path, 'SystemUnitClass ID 없음 (앱은 ID로 정의를 식별)');
    else if (seenIds.has(id)) err('DUP_ID', path, `정의 ID 중복 ${id}`);
    else seenIds.add(id);
    const version = text(e.Version);
    if (!version) err('SUC_NO_VERSION', path, 'Version 없음 (정의 버전 고정 필요)');
    const name = text(e.Description) ?? kind;
    const ext = attrNamed(e, APP_EXT);
    if (!ext) { err('NO_APP_EXT', path, `${APP_EXT} 앱 확장 속성 없음 — 이 앱의 subset 정의가 아님`); continue; }
    const category = childVal(ext, 'Category') as AssetDefinition['category'] | null;
    if (!category || !CATS.includes(category)) err('BAD_CATEGORY', path, `Category "${category}" 미지원`);
    const namePrefix = childVal(ext, 'NamePrefix') ?? kind.slice(0, 3).toUpperCase();
    const role = arr(e.SupportedRoleClass)[0]?.['@_RefRoleClassPath'] ?? '';
    if (!role) err('NO_ROLE', path, 'SupportedRoleClass 없음');
    else if (!roleExists(role)) err('ROLE_MISSING', path, `RoleClass ${role} 가 파일 안에 없음`);

    // properties = top-level Attributes except app extension
    const properties: PropertyDef[] = [];
    for (const a of attrsOf(e)) {
      const key = a['@_Name']; if (key === APP_EXT) continue;
      const where = `${path}/Attribute[${key}]`;
      const dt = a['@_AttributeDataType'];
      if (dt !== 'xs:double') { err('ATTR_TYPE', where, `속성 데이터 타입 ${dt ?? '없음'} — subset은 xs:double 숫자 사양만 지원`); continue; }
      const unit = a['@_Unit'];
      if (!unit) { err('ATTR_NO_UNIT', where, '단위(Unit) 없음 — 단위를 임의 보충하지 않음'); continue; }
      const dv = num(text(a.DefaultValue));
      if (Number.isNaN(dv)) { err('ATTR_VALUE', where, `DefaultValue 숫자 아님`); continue; }
      const req = childVal(a, 'ECD.requiredForRun');
      properties.push({ key, label: text(a.Description) ?? key, unit, defaultValue: dv, requiredForRun: req === 'true' });
    }

    // ports + visual refs
    const ports: PortDef[] = [];
    const visualRefs: AssetDefinition['visualRefs'] = { schematic: null, photo: null, photoScope: null };
    for (const i of arr(e.ExternalInterface)) {
      const key = i['@_Name']; const base = i['@_RefBaseClassPath']; const where = `${path}/ExternalInterface[${key}]`;
      if (base === EXT_DATA_REF_PATH) {
        const uri = childVal(i, 'refURI'); const mime = childVal(i, 'MIMEType');
        if (!uri) { err('EXTREF_NO_URI', where, 'ExternalDataReference refURI 없음'); continue; }
        if (/^[a-z]+:/i.test(uri) || uri.startsWith('/')) { err('EXTREF_ABSOLUTE', where, `refURI는 AML 파일 기준 상대 경로만 지원 (${uri})`); continue; }
        if (key === 'Schematic') visualRefs.schematic = uri;
        else if (key === 'ReferencePhoto') {
          visualRefs.photo = uri;
          const mt = childVal(i, 'ECD.PhotoMatchType');
          if (!mt || !['class-reference', 'component-reference', 'assembly-reference', 'exact-model'].includes(mt)) warn('PHOTO_SCOPE', where, `사진 대표 범위(ECD.PhotoMatchType) 없음/미지원 "${mt}" — 대표 범위 미확인으로 표시`);
          visualRefs.photoScope = mt && ['class-reference', 'component-reference', 'assembly-reference', 'exact-model'].includes(mt)
            ? { matchType: mt as any, exactModelMatch: childVal(i, 'ECD.ExactModelMatch') === 'true', note: childVal(i, 'ECD.ScopeNote') ?? '' } : null;
        }
        else warn('EXTREF_UNKNOWN', where, `알 수 없는 외부 참조 이름 ${key} (${mime ?? '?'}) — 무시`);
        continue;
      }
      if (base !== SIGNAL_CLASS_PATH && base !== FLOW_CLASS_PATH) { warn('IF_UNSUPPORTED', where, `인터페이스 클래스 ${base ?? '없음'} 미지원 — 무시`); continue; }
      const direction = childVal(i, 'Direction'); const r = childVal(i, 'SignalRole') ?? (base === FLOW_CLASS_PATH ? 'flow' : null);
      if (direction !== 'in' && direction !== 'out') { err('PORT_DIRECTION', where, `Direction "${direction}" — in/out 필요`); continue; }
      if (!r || !['command', 'complete', 'sensor', 'result', 'flow'].includes(r)) { err('PORT_ROLE', where, `SignalRole "${r}" 미지원`); continue; }
      if (base === SIGNAL_CLASS_PATH && childVal(i, 'ValueType') !== 'xs:boolean') { err('PORT_VALUETYPE', where, 'subset은 xs:boolean 신호만 지원'); continue; }
      ports.push({ key, label: text(i.Description) ?? key, direction, role: r as PortDef['role'] });
    }

    // actions (app extension)
    const actions: AssetActionTemplate[] = [];
    for (const a of attrsOf(attrNamed(ext, 'Actions') ?? {})) {
      const key = a['@_Name']; const where = `${path}/${APP_EXT}/Actions/${key}`;
      const kindA = childVal(a, 'Kind') as ActionKind | null;
      const cmd = childVal(a, 'CommandPort'); const done = childVal(a, 'CompletePort') || null;
      if (!kindA || !ACTION_KINDS.includes(kindA)) { err('ACTION_KIND', where, `Action Kind "${kindA}" 미지원`); continue; }
      if (!cmd || !ports.some((p) => p.key === cmd && p.direction === 'in')) { err('ACTION_CMD_PORT', where, `명령 포트 ${cmd} 가 입력(in) 포트로 정의되지 않음`); continue; }
      if (done && !ports.some((p) => p.key === done && p.direction === 'out')) { err('ACTION_DONE_PORT', where, `완료 포트 ${done} 가 출력(out) 포트로 정의되지 않음`); continue; }
      if (!done) warn('ACTION_NO_COMPLETE', where, '완료 조건 포트 미정 — 미정으로 표시 (실행 시 차단)');
      const d = num(childVal(a, 'DurationS')); const t = num(childVal(a, 'TimeoutS'));
      if (Number.isNaN(d) || Number.isNaN(t)) { err('ACTION_TIME', where, '시간 값이 숫자가 아님'); continue; }
      actions.push({ key, label: childVal(a, 'Label') ?? key, kind: kindA, commandPort: cmd, completePort: done, durationS: d, timeoutS: t });
    }

    // unit template
    let template: AssetDefinition['template'] = null;
    if (category === 'unit') {
      const lay = attrNamed(ext, 'TemplateLayout');
      const w = num(childVal(lay, 'W')), h = num(childVal(lay, 'H'));
      if (!w || !h || Number.isNaN(w) || Number.isNaN(h)) err('TEMPLATE_LAYOUT', path, 'TemplateLayout W/H 없음');
      const children: TemplateChild[] = []; const ifaceIndex = new Map<string, { child: string; port: string }>();
      for (const ie of arr(e.InternalElement)) {
        const local = ie['@_Name']; const ref = ie['@_RefBaseSystemUnitPath']; const where = `${path}/InternalElement[${local}]`;
        const target = ref ? byPath.get(ref) : undefined;
        if (!target) { err('CHILD_REF_MISSING', where, `자식 정의 ${ref ?? '(없음)'} 를 같은 파일에서 찾을 수 없음`); continue; }
        if (ref === path) { err('CHILD_CYCLE', where, '자기 자신을 자식으로 참조 (순환)'); continue; }
        if (childVal(target.e.Attribute ? attrNamed(target.e, APP_EXT) : undefined, 'Category') === 'unit') { err('CHILD_IS_UNIT', where, '유닛 안의 유닛(중첩 유닛)은 미지원'); continue; }
        const off = attrNamed(ie, `${APP_EXT}.LayoutOffset`);
        const dx = num(childVal(off, 'X')) ?? 0, dy = num(childVal(off, 'Y')) ?? 0;
        children.push({ localId: local, assetId: target.e['@_ID'], label: text(ie.Description) ?? local, dx: Number(dx), dy: Number(dy) });
        for (const i of arr(ie.ExternalInterface)) if (i['@_ID']) ifaceIndex.set(i['@_ID'], { child: local, port: i['@_Name'] });
      }
      if (!children.length) err('TEMPLATE_EMPTY', path, '유닛 템플릿에 자식 장치(InternalElement)가 없음');
      const links: TemplateLink[] = [];
      for (const l of arr(e.InternalLink)) {
        const A = ifaceIndex.get(l['@_RefPartnerSideA']); const B = ifaceIndex.get(l['@_RefPartnerSideB']);
        if (!A || !B) { err('LINK_REF_MISSING', `${path}/InternalLink[${l['@_Name']}]`, `InternalLink 끝점 인터페이스 ID 없음 (${l['@_RefPartnerSideA']} ↔ ${l['@_RefPartnerSideB']})`); continue; }
        links.push({ from: A, to: B });
      }
      const rules: TemplateRule[] = [];
      for (const r of attrsOf(attrNamed(ext, 'TemplateRules') ?? {})) {
        const pre = attrsOf(r).filter((x) => x['@_Name'].startsWith('Pre')).map((x) => ({ child: childVal(x, 'Child') ?? '', port: childVal(x, 'Port') ?? '', equals: childVal(x, 'Equals') === 'true' }));
        rules.push({ child: childVal(r, 'Child') ?? '', action: childVal(r, 'Action') ?? '', pre });
      }
      template = { size: { w: Number(w ?? 216), h: Number(h ?? 300) }, children, links, rules };
    }
    if (diags.filter((d) => d.severity === 'error').length > before) continue;
    defs.push({ id, version: version!, kind, name, category: category!, namePrefix, roleClassPath: role, amlSource: { file, sucPath: path, origin },
      properties, ports, actions, template, visualRefs });
  }

  // second pass: template semantic checks need child defs
  const byId = new Map(defs.map((d) => [d.id, d]));
  for (const d of defs) if (d.template) {
    for (const c of d.template.children) if (!byId.has(c.assetId)) err('CHILD_DEF_INVALID', d.amlSource.sucPath, `자식 ${c.localId} 의 정의 ${c.assetId} 가 오류로 제외됨 — 템플릿도 사용 불가`);
    for (const l of d.template.links) {
      const cf = d.template.children.find((c) => c.localId === l.from.child); const ct = d.template.children.find((c) => c.localId === l.to.child);
      const pf = cf && byId.get(cf.assetId)?.ports.find((p) => p.key === l.from.port);
      const pt = ct && byId.get(ct.assetId)?.ports.find((p) => p.key === l.to.port);
      if (!pf || !pt) err('LINK_PORT_MISSING', d.amlSource.sucPath, `InternalLink 포트 ${l.from.child}.${l.from.port} → ${l.to.child}.${l.to.port} 가 자식 정의에 없음`);
      else if (pf.direction !== 'out' || pt.direction !== 'in') err('LINK_DIRECTION', d.amlSource.sucPath, `InternalLink 방향 오류 ${l.from.child}.${l.from.port}(${pf.direction}) → ${l.to.child}.${l.to.port}(${pt.direction}); out → in 필요`);
    }
    for (const r of d.template.rules) {
      const c = d.template.children.find((x) => x.localId === r.child);
      if (!c || !byId.get(c.assetId)?.actions.some((a) => a.key === r.action)) err('RULE_ACTION_MISSING', d.amlSource.sucPath, `TemplateRule 대상 ${r.child}.${r.action} 없음`);
      for (const pr of r.pre) { const pc = d.template.children.find((x) => x.localId === pr.child); if (!pc || !byId.get(pc.assetId)?.ports.some((p) => p.key === pr.port)) err('RULE_PORT_MISSING', d.amlSource.sucPath, `TemplateRule 조건 포트 ${pr.child}.${pr.port} 없음`); }
    }
  }
  const failedTemplates = new Set(diags.filter((x) => x.severity === 'error').map((x) => x.where));
  const finalDefs = defs.filter((d) => !failedTemplates.has(d.amlSource.sucPath));
  return { ok: !diags.some((x) => x.severity === 'error'), defs: finalDefs, diags, meta };
}

// ---------------- writer ----------------
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const sattr = (name: string, value: string, type = 'xs:string', ind = '') => `${ind}<Attribute Name="${esc(name)}" AttributeDataType="${type}"><Value>${esc(value)}</Value></Attribute>`;

export interface AmlWriteOptions { fileName: string; lastWritingDateTime: string; originVersion: string }

/** Serialize definitions into a single CAEX 3.0 file (app subset + minimal excerpts of AutomationML base libraries). */
export function serializeAmlLibrary(defs: AssetDefinition[], o: AmlWriteOptions): string {
  const I = (n: number) => '  '.repeat(n);
  const byId = new Map(defs.map((d) => [d.id, d]));
  const L: string[] = [];
  L.push('<?xml version="1.0" encoding="UTF-8"?>');
  L.push('<!-- Equipment Concept Designer sample asset library (prototype). Values are [예시] assumptions, not real device specs. -->');
  L.push(`<!-- "${APP_EXT}" attributes are an application-specific extension; they carry NO AutomationML standard semantics. -->`);
  L.push(`<CAEXFile xmlns="${CAEX_NS}" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="${CAEX_NS} CAEX_ClassModel_V.3.0.xsd" SchemaVersion="3.0" FileName="${esc(o.fileName)}">`);
  L.push(`${I(1)}<SuperiorStandardVersion>${SUPERIOR_STANDARD}</SuperiorStandardVersion>`);
  L.push(`${I(1)}<SourceDocumentInformation OriginName="Equipment Concept Designer (web prototype)" OriginID="ecd-web-prototype" OriginVersion="${esc(o.originVersion)}" LastWritingDateTime="${esc(o.lastWritingDateTime)}" OriginVendor="prototype (unreleased)" OriginProjectTitle="equipment-concept-prototype" OriginProjectID="unspecified" />`);
  // interface classes
  L.push(`${I(1)}<InterfaceClassLib Name="AutomationMLInterfaceClassLib">`);
  L.push(`${I(2)}<Description>EXCERPT (subset) of the AutomationML standard interface class library (structure as published by AutomationML e.V. example models, version 2.10.0). Not the complete library.</Description>`);
  L.push(`${I(2)}<Version>2.10.0</Version>`);
  L.push(`${I(2)}<InterfaceClass Name="AutomationMLBaseInterface">`);
  L.push(`${I(3)}<InterfaceClass Name="Port" RefBaseClassPath="AutomationMLInterfaceClassLib/AutomationMLBaseInterface" />`);
  L.push(`${I(3)}<InterfaceClass Name="ExternalDataConnector" RefBaseClassPath="AutomationMLInterfaceClassLib/AutomationMLBaseInterface">`);
  L.push(`${I(4)}<Attribute Name="refURI" AttributeDataType="xs:anyURI" />`);
  L.push(`${I(4)}<InterfaceClass Name="ExternalDataReference" RefBaseClassPath="AutomationMLInterfaceClassLib/AutomationMLBaseInterface/ExternalDataConnector">`);
  L.push(`${I(5)}<Attribute Name="MIMEType" AttributeDataType="xs:string" />`);
  L.push(`${I(4)}</InterfaceClass>`);
  L.push(`${I(3)}</InterfaceClass>`);
  L.push(`${I(3)}<InterfaceClass Name="Communication" RefBaseClassPath="AutomationMLInterfaceClassLib/AutomationMLBaseInterface">`);
  L.push(`${I(4)}<InterfaceClass Name="SignalInterface" RefBaseClassPath="AutomationMLInterfaceClassLib/AutomationMLBaseInterface/Communication" />`);
  L.push(`${I(3)}</InterfaceClass>`);
  L.push(`${I(2)}</InterfaceClass>`);
  L.push(`${I(1)}</InterfaceClassLib>`);
  L.push(`${I(1)}<InterfaceClassLib Name="${IF_LIB_NAME}">`);
  L.push(`${I(2)}<Description>Prototype interface classes. ConceptSignal = role-based conceptual boolean signal (no real I/O address).</Description>`);
  L.push(`${I(2)}<Version>0.1.0</Version>`);
  L.push(`${I(2)}<InterfaceClass Name="ConceptSignal" RefBaseClassPath="AutomationMLInterfaceClassLib/AutomationMLBaseInterface/Communication/SignalInterface">`);
  L.push(`${I(3)}<Attribute Name="Direction" AttributeDataType="xs:string" />`);
  L.push(`${I(3)}<Attribute Name="SignalRole" AttributeDataType="xs:string" />`);
  L.push(`${I(3)}<Attribute Name="ValueType" AttributeDataType="xs:string" />`);
  L.push(`${I(2)}</InterfaceClass>`);
  L.push(`${I(2)}<InterfaceClass Name="MaterialFlowPort" RefBaseClassPath="AutomationMLInterfaceClassLib/AutomationMLBaseInterface">`);
  L.push(`${I(3)}<Attribute Name="Direction" AttributeDataType="xs:string" />`);
  L.push(`${I(2)}</InterfaceClass>`);
  L.push(`${I(1)}</InterfaceClassLib>`);
  // roles
  L.push(`${I(1)}<RoleClassLib Name="AutomationMLBaseRoleClassLib">`);
  L.push(`${I(2)}<Description>EXCERPT (subset) of the AutomationML base role class library (version 2.10.0). Not the complete library.</Description>`);
  L.push(`${I(2)}<Version>2.10.0</Version>`);
  L.push(`${I(2)}<RoleClass Name="AutomationMLBaseRole">`);
  L.push(`${I(3)}<RoleClass Name="Resource" RefBaseClassPath="AutomationMLBaseRoleClassLib/AutomationMLBaseRole" />`);
  L.push(`${I(2)}</RoleClass>`);
  L.push(`${I(1)}</RoleClassLib>`);
  L.push(`${I(1)}<RoleClassLib Name="${ROLE_LIB_NAME}">`);
  L.push(`${I(2)}<Version>0.1.0</Version>`);
  for (const [n, d] of [['AxisDevice', '축/구동 장치'], ['IODevice', 'I/O 장치'], ['SensorDevice', '센서·식별 장치'], ['TransportDevice', '이송 장치'], ['EquipmentUnit', '복합 유닛(장치 묶음)']])
    L.push(`${I(2)}<RoleClass Name="${n}" RefBaseClassPath="AutomationMLBaseRoleClassLib/AutomationMLBaseRole/Resource"><Description>${d}</Description></RoleClass>`);
  L.push(`${I(1)}</RoleClassLib>`);
  // system units
  L.push(`${I(1)}<SystemUnitClassLib Name="${ASSET_LIB_NAME}">`);
  L.push(`${I(2)}<Description>Sample assets of the Equipment Concept Designer prototype. All numbers are [예시] assumptions.</Description>`);
  L.push(`${I(2)}<Version>0.1.0</Version>`);
  const portXml = (p: PortDef, id: string, ind: number) => {
    const base = p.role === 'flow' ? FLOW_CLASS_PATH : SIGNAL_CLASS_PATH;
    const out = [`${I(ind)}<ExternalInterface Name="${esc(p.key)}" ID="${esc(id)}" RefBaseClassPath="${base}">`, `${I(ind + 1)}<Description>${esc(p.label)}</Description>`,
      sattr('Direction', p.direction, 'xs:string', I(ind + 1))];
    if (p.role !== 'flow') out.push(sattr('SignalRole', p.role, 'xs:string', I(ind + 1)), sattr('ValueType', 'xs:boolean', 'xs:string', I(ind + 1)));
    out.push(`${I(ind)}</ExternalInterface>`); return out.join('\n');
  };
  const extRef = (name: string, id: string, uri: string, mime: string, ind: number, scope?: AssetDefinition['visualRefs']['photoScope']) => [
    `${I(ind)}<ExternalInterface Name="${name}" ID="${esc(id)}" RefBaseClassPath="${EXT_DATA_REF_PATH}">`,
    sattr('refURI', uri, 'xs:anyURI', I(ind + 1)), sattr('MIMEType', mime, 'xs:string', I(ind + 1)),
    ...(scope ? [sattr('ECD.PhotoMatchType', scope.matchType, 'xs:string', I(ind + 1)), sattr('ECD.ExactModelMatch', String(scope.exactModelMatch), 'xs:boolean', I(ind + 1)), sattr('ECD.ScopeNote', scope.note, 'xs:string', I(ind + 1))] : []),
    `${I(ind)}</ExternalInterface>`].join('\n');
  for (const d of defs) {
    L.push(`${I(2)}<SystemUnitClass Name="${esc(d.kind)}" ID="${esc(d.id)}">`);
    L.push(`${I(3)}<Description>${esc(d.name)}</Description>`);
    L.push(`${I(3)}<Version>${esc(d.version)}</Version>`);
    for (const p of d.properties) {
      L.push(`${I(3)}<Attribute Name="${esc(p.key)}" AttributeDataType="xs:double" Unit="${esc(p.unit)}">`);
      L.push(`${I(4)}<Description>${esc(p.label)}</Description>`);
      if (p.defaultValue !== null) L.push(`${I(4)}<DefaultValue>${p.defaultValue}</DefaultValue>`);
      L.push(sattr('ECD.requiredForRun', String(p.requiredForRun), 'xs:boolean', I(4)));
      L.push(`${I(3)}</Attribute>`);
    }
    L.push(`${I(3)}<Attribute Name="${APP_EXT}">`);
    L.push(`${I(4)}<Description>Application-specific extension of Equipment Concept Designer (category, naming, actions/simulation timing, template layout/rules). Not AutomationML standard semantics.</Description>`);
    L.push(sattr('Category', d.category, 'xs:string', I(4)));
    L.push(sattr('NamePrefix', d.namePrefix, 'xs:string', I(4)));
    if (d.actions.length) {
      L.push(`${I(4)}<Attribute Name="Actions">`);
      for (const a of d.actions) {
        L.push(`${I(5)}<Attribute Name="${esc(a.key)}">`);
        L.push(sattr('Label', a.label, 'xs:string', I(6)), sattr('Kind', a.kind, 'xs:string', I(6)), sattr('CommandPort', a.commandPort, 'xs:string', I(6)));
        L.push(a.completePort ? sattr('CompletePort', a.completePort, 'xs:string', I(6)) : `${I(6)}<Attribute Name="CompletePort" AttributeDataType="xs:string" />`);
        L.push(`${I(6)}<Attribute Name="DurationS" AttributeDataType="xs:double" Unit="s">${a.durationS === null ? '' : `<Value>${a.durationS}</Value>`}</Attribute>`);
        L.push(`${I(6)}<Attribute Name="TimeoutS" AttributeDataType="xs:double" Unit="s">${a.timeoutS === null ? '' : `<Value>${a.timeoutS}</Value>`}</Attribute>`);
        L.push(`${I(5)}</Attribute>`);
      }
      L.push(`${I(4)}</Attribute>`);
    }
    if (d.template) {
      L.push(`${I(4)}<Attribute Name="TemplateLayout">`, sattr('W', String(d.template.size.w), 'xs:double', I(5)), sattr('H', String(d.template.size.h), 'xs:double', I(5)), `${I(4)}</Attribute>`);
      if (d.template.rules.length) {
        L.push(`${I(4)}<Attribute Name="TemplateRules">`);
        d.template.rules.forEach((r, ri) => {
          L.push(`${I(5)}<Attribute Name="Rule${ri + 1}">`, sattr('Child', r.child, 'xs:string', I(6)), sattr('Action', r.action, 'xs:string', I(6)));
          r.pre.forEach((pr, pi) => L.push(`${I(6)}<Attribute Name="Pre${pi + 1}">`, sattr('Child', pr.child, 'xs:string', I(7)), sattr('Port', pr.port, 'xs:string', I(7)), sattr('Equals', String(pr.equals), 'xs:boolean', I(7)), `${I(6)}</Attribute>`));
          L.push(`${I(5)}</Attribute>`);
        });
        L.push(`${I(4)}</Attribute>`);
      }
    }
    L.push(`${I(3)}</Attribute>`);
    for (const p of d.ports) L.push(portXml(p, `${d.id}.${p.key}`, 3));
    if (d.visualRefs.schematic) L.push(extRef('Schematic', `${d.id}.Schematic`, d.visualRefs.schematic, 'image/svg+xml', 3));
    if (d.visualRefs.photo) L.push(extRef('ReferencePhoto', `${d.id}.ReferencePhoto`, d.visualRefs.photo, 'image/jpeg', 3, d.visualRefs.photoScope));
    if (d.template) for (const c of d.template.children) {
      const cd = byId.get(c.assetId);
      L.push(`${I(3)}<InternalElement Name="${esc(c.localId)}" ID="${esc(`${d.id}.${c.localId}`)}" RefBaseSystemUnitPath="${ASSET_LIB_NAME}/${esc(cd?.kind ?? '?')}">`);
      L.push(`${I(4)}<Description>${esc(c.label)}</Description>`);
      L.push(`${I(4)}<Attribute Name="${APP_EXT}.LayoutOffset">`, sattr('X', String(c.dx), 'xs:double', I(5)), sattr('Y', String(c.dy), 'xs:double', I(5)), `${I(4)}</Attribute>`);
      for (const p of cd?.ports ?? []) L.push(portXml(p, `${d.id}.${c.localId}.${p.key}`, 4));
      L.push(`${I(3)}</InternalElement>`);
    }
    L.push(`${I(3)}<SupportedRoleClass RefRoleClassPath="${esc(d.roleClassPath)}" />`);
    if (d.template) d.template.links.forEach((l, li) => L.push(`${I(3)}<InternalLink Name="Link${li + 1}" RefPartnerSideA="${esc(`${d.id}.${l.from.child}.${l.from.port}`)}" RefPartnerSideB="${esc(`${d.id}.${l.to.child}.${l.to.port}`)}" />`));
    L.push(`${I(2)}</SystemUnitClass>`);
  }
  L.push(`${I(1)}</SystemUnitClassLib>`);
  L.push('</CAEXFile>');
  return L.join('\n') + '\n';
}

/** Comparable projection of a definition (for round-trip equality; excludes file origin). */
export function defSignature(d: AssetDefinition) {
  const { amlSource: _a, ...rest } = d;
  return JSON.parse(JSON.stringify(rest));
}
