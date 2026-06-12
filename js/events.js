const _h = {};
export const bus = {
  on(ev, cb)  { (_h[ev] = _h[ev] || []).push(cb); },
  off(ev, cb) { if (_h[ev]) _h[ev] = _h[ev].filter(h => h !== cb); },
  emit(ev, data) { (_h[ev] || []).forEach(cb => cb(data)); }
};
