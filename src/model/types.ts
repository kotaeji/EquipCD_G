// Mechanism Model — prototype data contract (설계 제안 / prototype assumption, NOT a confirmed common schema).
// Design data only. Runtime state lives in src/runtime and is never written back here.

export const FILE_FORMAT_ID = 'equipment-concept-designer/project';
export const FILE_FORMAT_VERSION = '0.1.0'; // file format version (separate from app / asset / model revision)
export const APP_VERSION = '0.2.0-prototype';
export const RUNTIME_RULES_VERSION = 'seq-runtime/0.1.0';

export type Id = string;

/** Asset type key (SystemUnitClass Name in the AML library). Built-in keys listed in BUILTIN_KINDS. */
export type AssetKind = string;
export const BUILTIN_KINDS = [
  'cylinder', 'pusher', 'barcodeReader', 'conveyor', 'stopper', 'gantry', 'picker', 'sensor',
  'photoelectricSensor', 'proximitySensor', 'limitSwitch', 'unitInput', 'unitIdentify', 'unitTransfer',
] as const;

export type Confirmation = 'unconfirmed' | 'confirmed' | 'rejected' | 'needsRecheck';

export interface SourceRef {
  method: 'direct-input' | 'asset-default' | 'sample-example' | 'import' | 'unit-template';
  note?: string;
}

/** A value that may be unknown (null != 0). assumption=true means "가정값, 확정 사양 아님". */
export interface Quantity {
  value: number | null;
  unit: string; // e.g. 'mm', 's', 'kg', 'mm/s'
  assumption: boolean;
  source?: SourceRef;
  /** history of assumption → measured replacements (F8-03 placeholder; prototype keeps only list) */
  history?: { at: string; from: number | null; to: number | null; assumption: boolean; note?: string }[];
}

export interface PortDef {
  key: string;
  label: string;
  direction: 'in' | 'out';
  role: 'command' | 'complete' | 'sensor' | 'result' | 'flow';
}

export interface PropertyDef {
  key: string;
  label: string;
  unit: string;
  defaultValue: number | null;
  /** true: needed to judge execution / capacity (missing → 미정 축 사양 gap) */
  requiredForRun: boolean;
}

export interface AssetActionTemplate {
  key: string;
  label: string;
  kind: ActionKind;
  commandPort: string;
  completePort: string | null;
  durationS: number | null;
  timeoutS: number | null;
}

export interface TemplateChild { localId: string; assetId: Id; label: string; dx: number; dy: number }
export interface TemplateLink { from: { child: string; port: string }; to: { child: string; port: string } }
export interface TemplateRule { child: string; action: string; pre: { child: string; port: string; equals: boolean }[] }
/** Unit template = real device bundle (child devices + internal signal links + action preconditions). */
export interface UnitTemplate { size: { w: number; h: number }; children: TemplateChild[]; links: TemplateLink[]; rules: TemplateRule[] }

export interface AssetDefinition {
  id: Id;           // e.g. 'asset.cylinder' (SystemUnitClass ID)
  version: string;  // asset definition version (independent from file format version)
  kind: AssetKind;  // SystemUnitClass Name
  name: string;     // display name (CAEX Description)
  category: 'axis' | 'io' | 'sensor' | 'transport' | 'unit';
  namePrefix: string;
  roleClassPath: string; // CAEX SupportedRoleClass/@RefRoleClassPath
  amlSource: { file: string; sucPath: string; origin: 'bundled' | 'imported' };
  properties: PropertyDef[];
  ports: PortDef[];
  actions: AssetActionTemplate[];
  template: UnitTemplate | null;
  /** AML ExternalDataReference refURIs (relative to the AML file) */
  visualRefs: { schematic: string | null; photo: string | null; photoScope: PhotoScope | null };
}

/** C03-05/C03-09: what the reference photo represents. exactModelMatch=false → never evidence of a maker/model/spec. */
export interface PhotoScope { matchType: 'class-reference' | 'component-reference' | 'assembly-reference' | 'exact-model'; exactModelMatch: boolean; note: string }

export type BuiltinKind = typeof BUILTIN_KINDS[number];

export interface Layout { x: number; y: number; w: number; h: number }

export interface Equipment { id: Id; name: string; unitIds: Id[] }

export interface Unit {
  id: Id;
  name: string;
  code: string; // display code e.g. S1
  deviceIds: Id[];
  layout: Layout;
  capacity: { maxMaterials: Quantity; maxWeight: Quantity };
  /** set when the unit was created from a unit template (definition pinned) */
  templateRef?: { assetId: Id; version: string };
}

export interface Device {
  id: Id;
  name: string;
  kind: AssetKind;
  definitionRef: { assetId: Id; version: string }; // pinned version, no auto-update
  unitId: Id;
  /** template child local id when created from a unit template */
  templateChild?: string;
  layout: Layout;
  properties: Record<string, Quantity>;
  lineage?: { duplicatedFrom: Id };
}

export interface Signal {
  id: Id;
  name: string;
  deviceId: Id;
  portKey: string | null;
  direction: 'in' | 'out';
  valueType: 'bool';
  role: 'command' | 'complete' | 'sensor' | 'result';
  address: string | null; // 실제 I/O 주소 (미정이면 null — 개념 신호)
  addressStatus: 'unassigned' | 'assumed' | 'confirmed';
}

export interface Position {
  id: Id;
  name: string;
  deviceId: Id;
  value: Quantity;
}

export type ActionKind = 'extend' | 'retract' | 'read' | 'work' | 'pick' | 'move' | 'place' | 'convey' | 'raise' | 'lower' | 'detect';

export type Condition =
  | { kind: 'signal'; signalId: Id; equals: boolean }
  | { kind: 'materialAt'; unitId: Id }
  | { kind: 'materialState'; state: string }
  | { kind: 'materialHeldBy'; deviceId: Id | null }
  | { kind: 'undefined'; note: string }; // explicitly 미정 — never treated as true

export interface MaterialEffect {
  moveTo?: Id | 'EXIT';
  setState?: string;
  holder?: Id | null; // device that holds the material (picker); null = released
}

export interface Action {
  id: Id;
  name: string;
  unitId: Id;
  deviceId: Id;
  kind: ActionKind;
  params: Record<string, Quantity>;
  duration: Quantity; // 가상 동작 시간
  timeout: Quantity;  // 완료 대기 타임아웃 (null → 미정 → 실행 차단)
  commandSignalId: Id | null;
  completeSignalId: Id | null; // 완료 조건: 이 신호 == true
  targetPositionId: Id | null;
  pre: Condition[];
  post: Condition[];   // 완료 후 검증 조건 (false면 오류, 상태 몰래 변경 금지)
  effect: MaterialEffect;
  note?: string;
}

export interface Material {
  id: Id;
  name: string;
  kind: 'individual' | 'carrier';
  carrierOf: Id | null;
  size: { w: Quantity; l: Quantity; h: Quantity };
  weight: Quantity;
  handling: string;
  states: string[];
  initialState: string | null;
  initialLocation: Id | null; // unit id
  route: Id[];                // ordered unit ids
  feedInterval: Quantity;
}

export interface Connection {
  id: Id;
  kind: 'flow' | 'signal';
  from: { nodeId: Id; signalId?: Id };
  to: { nodeId: Id; signalId?: Id };
}

export interface Constraint {
  id: Id;
  kind: 'interlock-candidate' | 'prohibition' | 'premise';
  description: string;
  relatedIds: Id[];
  confirmation: Confirmation;
  source: SourceRef;
}

export interface SequenceStep {
  id: Id;
  name: string;
  actionId: Id;
  /** override timeout for this step (null → use action timeout) */
  timeoutOverride: Quantity | null;
  /** 진입 조건 (extra preconditions beyond the Action's pre) */
  entry: Condition[];
  sourceText?: string; // 원문 구절 (구조화 문장 입력 시)
  origin: 'dnd' | 'structured-text' | 'sample';
}

export interface SequenceDraft {
  id: Id;
  name: string;
  steps: SequenceStep[];
  unresolved: string[]; // 미정·모호함 목록 (보존)
}

export interface Candidate {
  id: Id;
  targetKind: 'unit' | 'device';
  name: string;
  deviceKind: AssetKind | null;
  assignedUnitId: Id | null;
  sourceRefs: SourceRef[];
  confidence: { level: 'direct' | 'low' | 'medium' | 'high'; basis: string };
  confirmation: Confirmation;
  appliedObjectId: Id | null;
}

export interface SimSettings {
  /** Fault injection for verification scenarios */
  faults: { neverTrueSignalIds: Id[]; readFailActionIds: Id[] };
  speed: number; // wall-clock multiplier, does not affect logic results
}

export interface GapReviewEntry {
  status: 'open' | 'resolved' | 'hidden' | 'needsHuman' | 'humanConfirmed';
  firstSeenRevision: number;
  lastSeenRevision: number;
  lastEvidence: string;
  resolvedRevision?: number;
}

export interface Project {
  id: Id;
  name: string;
  revision: number;
  equipment: Equipment;
  units: Unit[];
  devices: Device[];
  signals: Signal[];
  positions: Position[];
  actions: Action[];
  materials: Material[];
  connections: Connection[];
  constraints: Constraint[];
  sequence: SequenceDraft;
  candidates: Candidate[];
  simSettings: SimSettings;
  gapReview: Record<Id, GapReviewEntry>;
  assumptionsNote: string[];
}

export interface ProjectFile {
  format: typeof FILE_FORMAT_ID;
  formatVersion: string;
  appVersion: string;
  assetDefinitions: { id: Id; version: string }[];
  project: Project;
}

export function q(value: number | null, unit: string, assumption = true, source?: SourceRef): Quantity {
  return { value, unit, assumption, ...(source ? { source } : {}) };
}
