/**
 * EDX Digital - Theme Manager
 * Inspired by Doctor+ Modern Dashboard (Dark Matte with Neon Lime & Crisp Clean Light)
 */

const THEME_STORAGE_KEY = 'nexus_crm_theme';

/**
 * Returns current saved theme, defaulting to 'light' (the sober white look the product is meant to have)
 */
export function getSavedTheme() {
  return localStorage.getItem(THEME_STORAGE_KEY) || 'light';
}

/**
 * Applies a given theme ('dark' | 'light')
 */
export function setTheme(theme) {
  const finalTheme = theme === 'light' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', finalTheme);
  try {
    localStorage.setItem(THEME_STORAGE_KEY, finalTheme);
  } catch (e) {
    console.warn("Could not save theme preference:", e);
  }
  updateThemeUI(finalTheme);
  window.dispatchEvent(new CustomEvent('nexus-theme-change', { detail: { theme: finalTheme } }));
  return finalTheme;
}

/**
 * Toggles between dark and light themes
 */
export function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || getSavedTheme();
  const next = current === 'dark' ? 'light' : 'dark';
  setTheme(next);
  return next;
}

/**
 * Updates all theme toggle switches on the page
 */
export function updateThemeUI(theme) {
  // 1. Sidebar Brand Toggle: shows the theme you would switch to
  const brandToggle = document.getElementById('btn-brand-theme-toggle');
  if (brandToggle) {
    brandToggle.setAttribute('data-current-theme', theme);
    brandToggle.innerHTML = theme === 'dark'
      ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>'
      : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
    const label = theme === 'dark' ? 'Mudar para o tema claro' : 'Mudar para o tema escuro';
    brandToggle.title = label;
    brandToggle.setAttribute('aria-label', label);
  }

}

/**
 * Initializes theme on page load and attaches click listeners
 */
export function initTheme() {
  const initial = getSavedTheme();
  setTheme(initial);

  // Brand toggle in sidebar
  const brandToggle = document.getElementById('btn-brand-theme-toggle');
  if (brandToggle) {
    brandToggle.addEventListener('click', () => {
      const newTheme = toggleTheme();
      if (window.showToast) {
        window.showToast(newTheme === 'dark' ? 'Tema escuro ativado' : 'Tema claro ativado', 'info');
      }
    });
  }

  // Global Keyboard Shortcut: Alt + T
  window.addEventListener('keydown', (e) => {
    if (e.altKey && (e.key === 't' || e.key === 'T')) {
      e.preventDefault();
      const newTheme = toggleTheme();
      if (window.showToast) {
        window.showToast(newTheme === 'dark' ? 'Tema escuro ativado' : 'Tema claro ativado', 'info');
      }
    }
  });
}
