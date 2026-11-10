// jsdom has no ResizeObserver or DOMMatrixReadOnly. React Flow reads both while measuring.
// These stand-ins only exist so node tests can mount the canvas. They are not a layout engine.
const g = globalThis as unknown as {
  ResizeObserver?: typeof ResizeObserver;
  DOMMatrixReadOnly?: typeof DOMMatrixReadOnly;
  DOMMatrix?: typeof DOMMatrix;
  matchMedia?: (q: string) => MediaQueryList;
};

if (typeof g.ResizeObserver === 'undefined') {
  g.ResizeObserver = class {
    private cb: ResizeObserverCallback;
    constructor(cb: ResizeObserverCallback) { this.cb = cb; }
    observe(target: Element) {
      const rect = target.getBoundingClientRect();
      const box = { x: rect.x, y: rect.y, top: rect.top, left: rect.left, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height, toJSON() { return {}; } };
      this.cb([{ target, contentRect: box as DOMRectReadOnly, borderBoxSize: [], contentBoxSize: [], devicePixelContentBoxSize: [] } as unknown as ResizeObserverEntry], this as unknown as ResizeObserver);
    }
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

if (typeof g.DOMMatrixReadOnly === 'undefined') {
  class Matrix {
    a = 1; b = 0; c = 0; d = 1; e = 0; f = 0;
    m11 = 1; m12 = 0; m21 = 0; m22 = 1; m41 = 0; m42 = 0;
    is2D = true;
    constructor(init?: string | number[]) {
      if (typeof init === 'string' && init !== 'none' && init !== '') {
        const m = /matrix\(([^)]+)\)/.exec(init);
        if (m) {
          const p = m[1].split(/[\s,]+/).map(Number);
          if (p.length >= 6 && p.every((n) => Number.isFinite(n))) {
            this.a = this.m11 = p[0]; this.b = this.m12 = p[1]; this.c = this.m21 = p[2];
            this.d = this.m22 = p[3]; this.e = this.m41 = p[4]; this.f = this.m42 = p[5];
          }
        }
      }
    }
    inverse() { return new Matrix(); }
    transformPoint(p: { x: number; y: number }) {
      return { x: this.a * p.x + this.c * p.y + this.e, y: this.b * p.x + this.d * p.y + this.f, z: 0, w: 1 };
    }
  }
  g.DOMMatrixReadOnly = Matrix as unknown as typeof DOMMatrixReadOnly;
  g.DOMMatrix = Matrix as unknown as typeof DOMMatrix;
}

if (typeof (g as { PointerEvent?: unknown }).PointerEvent === 'undefined' && typeof MouseEvent !== 'undefined') {
  class PointerEventPolyfill extends MouseEvent {
    pointerId: number;
    pointerType: string;
    width: number;
    height: number;
    pressure: number;
    isPrimary: boolean;
    constructor(type: string, params: PointerEventInit = {}) {
      super(type, params);
      this.pointerId = params.pointerId ?? 1;
      this.pointerType = params.pointerType ?? 'mouse';
      this.width = params.width ?? 1;
      this.height = params.height ?? 1;
      this.pressure = params.pressure ?? 0.5;
      this.isPrimary = params.isPrimary ?? true;
    }
  }
  (g as { PointerEvent: unknown }).PointerEvent = PointerEventPolyfill;
}

// jsdom reports 0 for offsetWidth. React Flow will not measure handles, and then it skips edges.
if (typeof HTMLElement !== 'undefined') {
  const px = (el: HTMLElement, axis: 'width' | 'height') => {
    const raw = el.style?.[axis];
    if (typeof raw === 'string' && raw.endsWith('px')) {
      const n = parseFloat(raw);
      if (Number.isFinite(n) && n > 0) return n;
    }
    return 0;
  };
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, get() { return px(this, 'width'); } });
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get() { return px(this, 'height'); } });
}

if (typeof g.matchMedia === 'undefined') {
  g.matchMedia = (q: string) => ({
    matches: false, media: q, onchange: null,
    addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; },
  }) as unknown as MediaQueryList;
}
