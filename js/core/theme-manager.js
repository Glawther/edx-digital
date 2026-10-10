/**
 * Nexus CRM - Theme Manager
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
  // 1. Sidebar Brand Toggle (Doctor+ Moon/Sun Style)
  const brandToggle = document.getElementById('btn-brand-theme-toggle');
  if (brandToggle) {
    brandToggle.setAttribute('data-current-theme', theme);
    brandToggle.innerHTML = theme === 'dark' 
      ? '<span class="theme-icon-moon" style="display:inline-block; transform: scale(1.1);">🌙</span>' 
      : '<span class="theme-icon-sun" style="display:inline-block; transform: scale(1.1);">☀️</span>';
    brandToggle.title = theme === 'dark' ? 'Mudar para Modo Claro (☀️)' : 'Mudar para Modo Noturno (🌙)';
  }

  // 2. Header Switcher Toggle
  const headerToggle = document.getElementById('btn-header-theme-toggle');
  if (headerToggle) {
    headerToggle.setAttribute('data-current-theme', theme);
    const label = headerToggle.querySelector('.theme-toggle-label');
    if (label) {
      label.textContent = theme === 'dark' ? 'Noturno' : 'Claro';
    }
  }

  // 3. Header Tools Menu Item
  const menuThemeLabel = document.getElementById('menu-theme-label');
  if (menuThemeLabel) {
    menuThemeLabel.textContent = theme === 'dark' ? 'Ativar Modo Claro (☀️)' : 'Ativar Modo Noturno (🌙)';
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
        window.showToast(newTheme === 'dark' ? '🌙 Modo Noturno Doctor+ ativado' : '☀️ Modo Claro ativado', 'info');
      }
    });
  }

  // Header pill switch
  const headerToggle = document.getElementById('btn-header-theme-toggle');
  if (headerToggle) {
    headerToggle.addEventListener('click', () => {
      const newTheme = toggleTheme();
      if (window.showToast) {
        window.showToast(newTheme === 'dark' ? '🌙 Modo Noturno Doctor+ ativado' : '☀️ Modo Claro ativado', 'info');
      }
    });
  }

  // Tools menu action
  const menuThemeBtn = document.getElementById('btn-menu-theme');
  if (menuThemeBtn) {
    menuThemeBtn.addEventListener('click', () => {
      const newTheme = toggleTheme();
      if (window.showToast) {
        window.showToast(newTheme === 'dark' ? '🌙 Modo Noturno Doctor+ ativado' : '☀️ Modo Claro ativado', 'info');
      }
      const toolsMenu = document.getElementById('header-tools-menu');
      if (toolsMenu) toolsMenu.style.display = 'none';
    });
  }

  // Global Keyboard Shortcut: Alt + T
  window.addEventListener('keydown', (e) => {
    if (e.altKey && (e.key === 't' || e.key === 'T')) {
      e.preventDefault();
      const newTheme = toggleTheme();
      if (window.showToast) {
        window.showToast(newTheme === 'dark' ? '🌙 Modo Noturno Doctor+ ativado' : '☀️ Modo Claro ativado', 'info');
      }
    }
  });
}
