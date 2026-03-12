export type ThemeMode = 'light' | 'dark';

export const normalizeThemeMode = (value: string | null | undefined): ThemeMode | null => {
  if (!value) return null;
  const next = value.toLowerCase();
  if (next.includes('dark')) return 'dark';
  if (next.includes('light')) return 'light';
  return null;
};

export const readThemeModeFromElement = (
  element: Element | null | undefined,
  sourceWindow: Window = window,
): ThemeMode | null => {
  if (!element) return null;
  const attrTheme = normalizeThemeMode(element.getAttribute('data-theme'))
    || normalizeThemeMode(element.getAttribute('data-color-scheme'))
    || normalizeThemeMode(element.getAttribute('color-scheme'));
  if (attrTheme) return attrTheme;
  if (element.classList.contains('dark')) return 'dark';
  if (element.classList.contains('light')) return 'light';
  try {
    return normalizeThemeMode(sourceWindow.getComputedStyle(element).colorScheme);
  } catch {
    return null;
  }
};

export const detectThemeMode = (): ThemeMode => {
  try {
    if (window.parent && window.parent !== window) {
      const parentTheme = readThemeModeFromElement(window.parent.document.documentElement, window.parent)
        || readThemeModeFromElement(window.parent.document.body, window.parent);
      if (parentTheme) return parentTheme;
    }
  } catch {}
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
};

export const applyThemeModeToDocument = (theme: ThemeMode) => {
  const root = document.documentElement;
  const body = document.body;
  for (const node of [root, body]) {
    node.classList.remove('light', 'dark');
    node.classList.add(theme);
    node.setAttribute('data-theme', theme);
    node.setAttribute('data-color-scheme', theme);
    node.style.colorScheme = theme;
  }
};

export const installThemeModeSync = (onTheme: (theme: ThemeMode) => void): (() => void) => {
  let rafId = 0;
  const syncTheme = () => onTheme(detectThemeMode());
  const scheduleSync = () => {
    cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(syncTheme);
  };

  syncTheme();

  const media = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  const mediaListener = () => scheduleSync();
  if (media) {
    if (typeof media.addEventListener === 'function') media.addEventListener('change', mediaListener);
    else if (typeof media.addListener === 'function') media.addListener(mediaListener);
  }

  const observers: MutationObserver[] = [];
  try {
    if (window.parent && window.parent !== window) {
      for (const target of [window.parent.document.documentElement, window.parent.document.body]) {
        if (!target) continue;
        const observer = new MutationObserver(scheduleSync);
        observer.observe(target, {
          attributes: true,
          attributeFilter: ['class', 'data-theme', 'data-color-scheme'],
        });
        observers.push(observer);
      }
    }
  } catch {}

  return () => {
    cancelAnimationFrame(rafId);
    if (media) {
      if (typeof media.removeEventListener === 'function') media.removeEventListener('change', mediaListener);
      else if (typeof media.removeListener === 'function') media.removeListener(mediaListener);
    }
    observers.forEach((observer) => observer.disconnect());
  };
};
