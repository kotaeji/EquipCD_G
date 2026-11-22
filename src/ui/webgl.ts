/** True when this browser can create a WebGL context. jsdom cannot. */
export function canUseWebGL(): boolean {
  if (typeof document === 'undefined') return false;
  // jsdom prints "Not implemented" and returns null. Skip the call.
  if (typeof navigator !== 'undefined' && navigator.userAgent.includes('jsdom')) return false;
  try {
    const canvas = document.createElement('canvas');
    return !!(canvas.getContext('webgl2') || canvas.getContext('webgl'));
  } catch {
    return false;
  }
}
