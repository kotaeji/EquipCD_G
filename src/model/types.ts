// Mechanism Model — prototype data contract (설계 제안 / prototype assumption, NOT a confirmed common schema).
// Design data only. Runtime state lives in src/runtime and is never written back here.

export const FILE_FORMAT_ID = 'equipment-concept-designer/project';
export const FILE_FORMAT_VERSION = '0.3.0'; // file format version (separate from app / asset / model revision). 0.1.x and 0.2.x files open as-is; `flow` is optional.
export const APP_VERSION = '0.3.0-prototype';
export const PRODUCT_NAME = 'Aurora Concept Designer';
export const RUNTIME_RULES_VERSION = 'seq-runtime/0.9.0';
/** Extra tries after the first body run. 2 → at most 3 executions. */
export const DEFAULT_MAX_RETRIES = 2;
/** Substation group runtime rules (v0.3 설계 제안): shared virtual clock, fixed lane order at equal instants, conservative group stop on error. Sensor signals follow the same unit rule as the station runtime. */
export const GROUP_RULES_VERSION = 'group-runtime/0.2.0';

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

/** Where a numeric value lives. Used by the confirmation log. */
export type QuantityRef =
  | { kind: 'device'; id: Id; key: string }
  | { kind: 'action'; id: Id; field: 'duration' | 'timeout' }
  | { kind: 'position'; id: Id }
  | { kind: 'unitCap'; id: Id; field: 'maxMaterials' | 'maxWeight' }
  | { kind: 'material'; id: Id; field: 'weight' | 'feedInterval' | 'w' | 'l' | 'h' }
  | { kind: 'stepTimeout'; id: Id };

/** What a confirmation row points at. The name is also stored on the row, so a deleted target still has a label. */
export type ConfirmationTarget =
  | { kind: 'quantity'; ref: QuantityRef }
  | { kind: 'interlock'; id: Id }
  | { kind: 'candidate'; id: Id }
  | { kind: 'gap'; id: Id }
  | { kind: 'signalAddress'; id: Id };

/**
 * One confirmation (or its reversal). Optional on the project: an empty list is not written,
 * so files from before TURN-070 and the three samples stay the same. Format version stays 0.3.0.
 */
export interface ConfirmationEntry {
  /** ISO-8601 timestamp. */
  at: string;
  /** Confirmer name as typed. At most 60 characters. Not an account. */
  by: string;
  /** Target label captured when the row was written. */
  name: string;
  from: string;
  to: string;
  target: ConfirmationTarget;
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

/** Equipment = UI "Station" (장비 전체). ID/관계는 v0.2와 동일 — 라벨만 동의어(v0.3 임시 정책). */
export interface Equipment { id: Id; name: string; unitIds: Id[] }

/** Unit = UI "Substation" (여러 Device + 여러 시퀀스를 묶어 동시 Play/Pause/Resume 하는 단위). */
export interface Unit {
  id: Id;
  name: string;
  code: string; // display code e.g. S1
  deviceIds: Id[];
  layout: Layout;
  capacity: { maxMaterials: Quantity; maxWeight: Quantity };
  /** set when the unit was created from a unit template (definition pinned) */
  templateRef?: { assetId: Id; version: string };
  /**
   * Paste records `duplicatedFrom`. A placed 「내 템플릿」 records `fromTemplate`
   * with the name at that moment. Neither field is a live link, and older files omit both.
   */
  lineage?: { duplicatedFrom?: Id; fromTemplate?: { id: Id; name: string } };
  /**
   * Position lock. Absent on files saved before TURN-059, which means unlocked.
   * A locked Unit does not move or resize; Devices inside it still edit.
   */
  positionLocked?: boolean;
}

/**
 * One PNG or JPEG behind the stage-2 diagram. Absent on files saved before TURN-059.
 * Stored in the project (data URL). The file format version stays 0.3.0.
 * `scale` is millimetres per image pixel. `locked` defaults to on.
 */
export interface DiagramBackground {
  dataUrl: string;
  width: number;
  height: number;
  x: number;
  y: number;
  scale: number;
  /** 10–100 */
  opacity: number;
  locked: boolean;
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
  /**
   * This piece's material definition. Absent on files saved before TURN-080.
   * The screen shows it as 「자재 종류 = 표식」.
   */
  | { kind: 'materialType'; materialId: Id }
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
  /**
   * How many instances of this one definition to feed. Absent means 1
   * (0.1 / 0.2 / 0.3 files, and any project saved before TURN-040).
   * With several definitions the count on the first definition is the shared total.
   */
  feedCount?: number;
  /**
   * Short letter drawn on the piece. Absent on files saved before TURN-080
   * and on a definition that still uses the fallback letter (A, B, C, D).
   */
  mark?: string;
}

/** Instances to feed. A missing value is 1, so older files run as they did. */
export function feedCountOf(m: { feedCount?: number } | null | undefined): number {
  const n = m?.feedCount;
  return n == null ? 1 : n;
}

export interface Connection {
  id: Id;
  kind: 'flow' | 'signal';
  from: { nodeId: Id; signalId?: Id };
  to: { nodeId: Id; signalId?: Id };
}

/**
 * Machine-readable Interlock rule. Absent on files saved before TURN-046:
 * those files read and run as they did. `undetermined` is a cleared rule
 * (the target Action or a condition Signal was deleted) and keeps no dangling id.
 */
export type InterlockRule =
  | { form: 'allow'; actionId: Id; conditions: Condition[] }
  | { form: 'mutex'; actionId: Id; otherActionId: Id }
  | { form: 'undetermined'; note: string };

export interface Constraint {
  id: Id;
  kind: 'interlock-candidate' | 'prohibition' | 'premise';
  description: string;
  relatedIds: Id[];
  confirmation: Confirmation;
  source: SourceRef;
  /** Optional. Missing, or `undetermined`, does not block a run. */
  rule?: InterlockRule;
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

/**
 * Control structure over the flat `steps` list. A step id appears at most once.
 * Absent `flow` means "run `steps` in order" (0.1.x / 0.2.x files and the 5-step example).
 * A branch has 2–4 arms. The first arm is `cond` / `then`. The last arm is `else`
 * (no condition: 「거짓」 when there are two arms, 「그 밖」 when there are more).
 * `cases` holds the conditional arms in between and is omitted for two arms,
 * so files saved before TURN-063 stay byte-identical.
 */
/** One conditional arm between the first (`cond` / `then`) and the final else. */
export interface BranchCase {
  cond: Condition;
  body: FlowNode[];
}

export type FlowNode =
  | { kind: 'step'; stepId: Id }
  | { kind: 'branch'; id: Id; name: string; cond: Condition; then: FlowNode[]; else: FlowNode[]; cases?: BranchCase[] }
  | { kind: 'parallel'; id: Id; name: string; lanes: FlowNode[][] }
  | { kind: 'loop'; id: Id; name: string; count: number; body: FlowNode[] }
  | { kind: 'retry'; id: Id; name: string; until: Condition; maxRetries: number; body: FlowNode[] }
  | { kind: 'substation'; id: Id; unitId: Id }
  /**
   * Wait until `cond` is true, or stop with `WAIT_TIMEOUT`.
   * Absent on files saved before TURN-049. `timeout.value === null` is undetermined and blocks a run.
   */
  | { kind: 'wait'; id: Id; name: string; cond: Condition; timeout: Quantity };

export interface SequenceDraft {
  id: Id;
  name: string;
  steps: SequenceStep[];
  unresolved: string[]; // 미정·모호함 목록 (보존)
  /** When set, execution follows this tree. Steps not listed here are not run. */
  flow?: FlowNode[];
}

/**
 * v0.3: one of several sequences that belong to ONE Unit (= Substation) and are played / paused / resumed together
 * as a group on a shared virtual clock. The Station-level `Project.sequence` (v0.1/v0.2) is kept unchanged.
 * Steps may only use Actions of Devices inside the same Substation (checked before run).
 */
export interface SubstationSequence extends SequenceDraft { unitId: Id }

export interface Candidate {
  id: Id;
  targetKind: 'unit' | 'device' | 'signal';
  name: string;
  deviceKind: AssetKind | null;
  assignedUnitId: Id | null;
  /** Spreadsheet unit name. Apply creates that unit first when it is confirmed in the same batch. */
  assignedUnitName?: string | null;
  /** Device name a signal candidate belongs to. */
  signalDeviceName?: string | null;
  signalDirection?: 'in' | 'out' | null;
  signalAddress?: string | null;
  signalMemo?: string | null;
  /** Same name is already in the model or the candidate table. Left unconfirmed, so apply skips it. */
  alreadyExists?: boolean;
  sourceRefs: SourceRef[];
  confidence: { level: 'direct' | 'low' | 'medium' | 'high'; basis: string };
  confirmation: Confirmation;
  appliedObjectId: Id | null;
}

export interface SimSettings {
  /** Fault injection for verification scenarios */
  faults: {
    neverTrueSignalIds: Id[];
    readFailActionIds: Id[];
    /**
     * For an action also listed in `readFailActionIds`: fail only the first N executions, then succeed.
     * Omit the action (or the whole map) to keep failing every time.
     */
    readFailFirstN?: Record<Id, number>;
  };
  speed: number; // wall-clock multiplier, does not affect logic results
}

/**
 * One fault row inside a saved run scenario.
 * A row with `stepId` is dropped when that step is gone.
 * Action duration and timeout are not stored here.
 */
export interface ScenarioInjection {
  /** Station or Substation step this row was saved from. Absent when the fault is not on a step. */
  stepId?: string;
  /** Action the fault was aimed at. When `stepId` is set, the step must still use this action. */
  actionId?: string;
  /** Read action fails. */
  readFail?: boolean;
  /** With `readFail`: fail only the first N executions. Omit to fail every time. */
  readFailFirstN?: number;
  /** Complete signal that never becomes true (timeout injection). */
  neverTrueSignalId?: string;
}

/** Named feed, fault injection, and playback speed. Not Action times. */
export interface RunScenario {
  id: string;
  name: string;
  feedCount: number;
  /** Null is 미정. */
  feedInterval: number | null;
  speed: number;
  injections: ScenarioInjection[];
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
  /**
   * Repeating feed order (material definition ids). Cycled until the shared feed count.
   * Absent when there is one definition, or when the order is just the definition list.
   * Older files and the three samples omit it, so their save stays the same.
   */
  feedPattern?: Id[];
  connections: Connection[];
  constraints: Constraint[];
  /** Station-level sequence (v0.1/v0.2 single sequence, kept for compatibility) */
  sequence: SequenceDraft;
  /** v0.3 Substation sequences (several per Unit). Optional in memory for old data; files ≥0.2.0 always contain it. */
  substationSequences?: SubstationSequence[];
  candidates: Candidate[];
  simSettings: SimSettings;
  gapReview: Record<Id, GapReviewEntry>;
  assumptionsNote: string[];
  /** Optional stage-2 drawing behind the units. Missing on older files. */
  diagramBackground?: DiagramBackground;
  /**
   * Who confirmed a value, and when. Missing on files saved before TURN-070.
   * Empty lists are omitted on write so the three samples stay byte-identical.
   */
  confirmationLog?: ConfirmationEntry[];
  /**
   * Named run conditions (feed, fault injection, playback speed).
   * Absent when there are none, so older files and the three samples stay unchanged.
   * Format version stays 0.3.0.
   */
  runScenarios?: RunScenario[];
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
