/**
 * EDX Digital - What surrounds every screen: navigation, tools menu, search and shortcuts, notifications, installing the app
 */

import { startTour } from '../ui/tour.js';
import { todayPanel } from '../core/today.js';
import { crmStore } from '../core/crm-store.js';
import { storage } from '../core/storage-manager.js';
import { toggleTheme } from '../core/theme-manager.js';
import { AUDIT_ACTIONS, getAuditStats, logAudit } from '../services/audit-service.js';
import {
  getCurrentRole,
  isAdmin,
  isDemoSession,
  isSessionActive,
  setUserRole,
  USER_ROLES
} from '../services/auth-service.js';
import { getEmployees } from '../services/employee-service.js';
import {
  getInAppNotifications,
  getNotificationPermission,
  getUnreadCount,
  markAllAsRead,
  markAsRead,
  onNotificationsChange,
  requestNotificationPermission
} from '../services/notification-service.js';
import { escapeHtml, formatBRL, showToast } from '../ui/ui-renderer.js';

export function applyRoleUIRestrictions(permissions) {
  const exportBtn = document.getElementById('btn-export-csv');

  const isAdmin = !!permissions.isAdmin;

  // 1. Restrição das abas exclusivas do Administrador: Equipe & Convites, Auditoria e Tríade CID
  const navTeam = document.getElementById('nav-item-team') || document.querySelector('.nav-item[data-view="team"]')?.closest('li');
  const navAudit = document.getElementById('nav-item-audit') || document.querySelector('.nav-item[data-view="audit"]')?.closest('li');
  const navSecurity = document.getElementById('nav-item-security') || document.querySelector('.nav-item[data-view="security"]')?.closest('li');

  if (navTeam) navTeam.style.display = isAdmin ? '' : 'none';
  if (navAudit) navAudit.style.display = isAdmin ? '' : 'none';
  if (navSecurity) navSecurity.style.display = isAdmin ? '' : 'none';

  // Se o usuário não for admin e estiver em uma das abas protegidas, redireciona imediatamente para o funil
  const adminOnlyViews = ['team', 'audit', 'security'];
  const state = crmStore.getState();
  if (!isAdmin && adminOnlyViews.includes(state.activeView)) {
    if (window.navigateToView) {
      window.navigateToView('pipeline');
    }
  }

  // 2. Menu de Ferramentas da Barra Lateral (Governança exclusiva de Administrador)
  const btnMenuExportAudit = document.getElementById('btn-menu-export-audit');
  const btnMenuBilling = document.getElementById('btn-menu-billing');
  const btnMenuWhitelabel = document.getElementById('btn-menu-whitelabel');
  const btnMenuWebhook = document.getElementById('btn-menu-webhook');
  const groupCompany = document.getElementById('tools-group-company');
  const dividerCompany = document.getElementById('tools-divider-company');

  if (btnMenuExportAudit) btnMenuExportAudit.style.display = isAdmin ? 'flex' : 'none';
  if (btnMenuBilling) btnMenuBilling.style.display = isAdmin ? 'flex' : 'none';
  if (btnMenuWhitelabel) btnMenuWhitelabel.style.display = isAdmin ? 'flex' : 'none';
  if (btnMenuWebhook) btnMenuWebhook.style.display = isAdmin ? 'flex' : 'none';
  if (groupCompany) groupCompany.style.display = isAdmin ? 'block' : 'none';
  if (dividerCompany) dividerCompany.style.display = isAdmin ? 'block' : 'none';

  const btnMenuCustomize = document.getElementById('btn-menu-customize');
  if (btnMenuCustomize) btnMenuCustomize.style.display = isAdmin ? 'flex' : 'none';

  if (exportBtn) {
    if (permissions.canExportAll) {
      exportBtn.title = 'Exportar base completa para CSV';
    } else {
      exportBtn.title = 'Exportar meus leads atribuídos para CSV (Confidencialidade)';
    }
  }
}

// Switches between the two sample profiles. Real accounts keep the role their company gave them.
window.handleToggleRole = async function() {
  if (!isDemoSession()) return;
  const role = getCurrentRole();
  const nextRole = role === USER_ROLES.ADMIN ? USER_ROLES.EMPLOYEE : USER_ROLES.ADMIN;
  setUserRole(nextRole);
  await storage.init();
  logAudit(AUDIT_ACTIONS.ROLE_SWITCHED, { fromRole: role, toRole: nextRole });
  showToast(nextRole === USER_ROLES.ADMIN
    ? "Agora você vê a demonstração como administrador."
    : "Agora você vê a demonstração como vendedor.", "info");
};

// ==========================================================================
// Navigation & Views
// ==========================================================================
export function setupNavigation() {
  const navItems = document.querySelectorAll('.nav-item[data-view]');
  const viewSections = document.querySelectorAll('.view-section');

  window.navigateToView = function(targetView) {
    const adminOnlyViews = ['team', 'audit', 'security'];
    const state = crmStore.getState();
    const isAdmin = !!state.permissions?.isAdmin;

    if (adminOnlyViews.includes(targetView) && !isAdmin) {
      showToast('Equipe, Auditoria e Segurança são só para administradores.', 'warning');
      targetView = 'pipeline';
    }

    navItems.forEach(n => n.classList.remove('active'));
    const item = document.querySelector(`.nav-item[data-view="${targetView}"]`);
    if (item) item.classList.add('active');

    viewSections.forEach(section => {
      section.classList.toggle('active', section.id === `view-${targetView}`);
    });

    // Update header title
    const pageTitle = document.getElementById('current-page-title');
    if (pageTitle && item) {
      pageTitle.textContent = item.dataset.title || 'Pipeline de Vendas';
    }

    document.body.dataset.view = targetView;
    crmStore.setActiveView(targetView);
  };

  navItems.forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      const targetView = item.dataset.view;
      window.navigateToView(targetView);
    });
  });

  // Deep linking and hash navigation protection
  window.addEventListener('hashchange', () => {
    const hash = window.location.hash.replace('#', '').split('?')[0];
    if (hash && !hash.startsWith('checkout') && !hash.startsWith('register')) {
      const validViews = ['today', 'pipeline', 'customers', 'tasks', 'metrics', 'team', 'audit', 'security'];
      if (validViews.includes(hash)) {
        window.navigateToView(hash);
      }
    }
  });

  // Initialize view from URL hash if present
  const initialHash = window.location.hash.replace('#', '').split('?')[0];
  const validInitialViews = ['today', 'pipeline', 'customers', 'tasks', 'metrics', 'team', 'audit', 'security'];
  if (initialHash && validInitialViews.includes(initialHash)) {
    window.navigateToView(initialHash);
  }
}

export function updateNavCounters(state) {
  const pipelineCount = document.getElementById('nav-count-pipeline');
  const customersCount = document.getElementById('nav-count-customers');
  const tasksCount = document.getElementById('nav-count-tasks');

  const todayCount = document.getElementById('nav-count-today');
  if (todayCount) {
    // tasks that are late or due today: what cannot wait
    const urgent = todayPanel(state.visibleCustomers || []).urgent;
    todayCount.textContent = urgent;
    todayCount.hidden = urgent === 0;
  }
  if (pipelineCount) pipelineCount.textContent = state.allCustomers.length;
  if (customersCount) customersCount.textContent = state.allCustomers.length;
  if (tasksCount) {
    const pendingCount = (state.tasks || []).filter(t => !t.completed).length;
    tasksCount.textContent = pendingCount;
  }

  // Update team counter
  const teamCount = document.getElementById('nav-count-team');
  if (teamCount) {
    // the signed-in administrator is not in the list
    teamCount.textContent = getEmployees().length + 1;
  }

  // Update audit counter
  const auditCount = document.getElementById('nav-count-audit');
  if (auditCount) {
    const stats = getAuditStats();
    auditCount.textContent = stats.todayLogs;
  }
}

// ==========================================================================
// Command Palette Engine (Spotlight / Raycast-style Ctrl+K Launcher)
// ==========================================================================
export function setupCommandPalette() {
  const dialog = document.getElementById('command-palette-dialog');
  const input = document.getElementById('command-palette-input');
  const body = document.getElementById('command-palette-body');
  const btnTrigger = document.getElementById('btn-open-command-palette');

  if (!dialog || !input || !body) return;

  window.openCommandPalette = function() {
    dialog.showModal();
    input.value = '';
    renderPaletteItems('');
    setTimeout(() => input.focus(), 50);
  };

  window.closeCommandPalette = function() {
    dialog.close();
  };

  if (btnTrigger) {
    btnTrigger.addEventListener('click', window.openCommandPalette);
  }

  // Click outside backdrop to close
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) {
      window.closeCommandPalette();
    }
  });

  input.addEventListener('input', (e) => {
    renderPaletteItems(e.target.value);
  });

  // Keyboard navigation inside the palette (ArrowUp, ArrowDown, Enter)
  input.addEventListener('keydown', (e) => {
    const items = body.querySelectorAll('.command-item');
    if (items.length === 0) return;

    let activeIndex = Array.from(items).findIndex(el => el.classList.contains('active'));

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (activeIndex >= 0) items[activeIndex].classList.remove('active');
      activeIndex = (activeIndex + 1) % items.length;
      items[activeIndex].classList.add('active');
      items[activeIndex].scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (activeIndex >= 0) items[activeIndex].classList.remove('active');
      activeIndex = (activeIndex - 1 + items.length) % items.length;
      items[activeIndex].classList.add('active');
      items[activeIndex].scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const targetItem = activeIndex >= 0 ? items[activeIndex] : items[0];
      if (targetItem) targetItem.click();
    }
  });

  function renderPaletteItems(query) {
    const q = (query || '').toLowerCase().trim();
    const state = crmStore.getState();
    const customers = state.visibleCustomers || [];

    const isUserAdmin = !!state.permissions?.isAdmin;

    const go = (view) => () => { window.closeCommandPalette(); window.navigateToView(view); };
    const click = (id) => () => { window.closeCommandPalette(); document.getElementById(id)?.click(); };
    const allActions = [
      { id: 'action-new-lead', title: 'Nova oportunidade', hint: 'N', category: 'Ações', run: click('btn-new-lead') },
      { id: 'action-import-csv', title: 'Importar contatos de uma planilha', hint: 'I', category: 'Ações', run: click('btn-open-import-modal') },
      { id: 'action-export-csv', title: 'Exportar clientes para planilha', hint: '', category: 'Ações', run: click('btn-export-csv') },
      { id: 'action-export-audit', title: 'Exportar o histórico de atividade', hint: '', adminOnly: true, category: 'Ações', run: () => { window.closeCommandPalette(); window.handleExportAudit(); } },
      { id: 'action-toggle-theme', title: 'Trocar entre tema claro e escuro', hint: '', category: 'Ações', run: () => { window.closeCommandPalette(); toggleTheme(); } },
      { id: 'action-toggle-role', title: 'Ver a demonstração com o outro perfil', hint: '', demoOnly: true, category: 'Ações', run: () => { window.closeCommandPalette(); window.handleToggleRole(); } },
      { id: 'action-shortcuts', title: 'Atalhos de teclado', hint: '?', category: 'Ações', run: () => { window.closeCommandPalette(); document.getElementById('shortcuts-dialog')?.showModal(); } },
      { id: 'action-tour', title: 'Conhecer o sistema', hint: '', category: 'Ações', run: () => { window.closeCommandPalette(); startTour(); } },
      { id: 'nav-today', title: 'Hoje', hint: 'H', category: 'Ir para', run: go('today') },
      { id: 'nav-pipeline', title: 'Funil de vendas', hint: '1', category: 'Ir para', run: go('pipeline') },
      { id: 'nav-customers', title: 'Clientes', hint: '2', category: 'Ir para', run: go('customers') },
      { id: 'nav-tasks', title: 'Tarefas', hint: '3', category: 'Ir para', run: go('tasks') },
      { id: 'nav-metrics', title: 'Relatórios', hint: '4', category: 'Ir para', run: go('metrics') },
      { id: 'nav-team', title: 'Equipe', hint: '', adminOnly: true, category: 'Ir para', run: go('team') },
      { id: 'nav-audit', title: 'Auditoria', hint: '', adminOnly: true, category: 'Ir para', run: go('audit') },
      { id: 'nav-security', title: 'Segurança', hint: '5', adminOnly: true, category: 'Ir para', run: go('security') }
    ].map(action => ({ icon: '', ...action }));

        const defaultActions = allActions.filter(a => (!a.adminOnly || isUserAdmin) && (!a.demoOnly || isDemoSession()));

    let html = '';

    if (!q) {
      const categories = ['Ações', 'Ir para'];
      categories.forEach(cat => {
        const items = defaultActions.filter(a => a.category === cat);
        html += `<div class="command-group-title">${cat}</div>`;
        items.forEach((item, idx) => {
          const isFirst = cat === 'Ações' && idx === 0;
          html += `
            <div class="command-item ${isFirst ? 'active' : ''}" data-action-id="${escapeHtml(item.id)}">
              <div class="command-item-left">
                <span class="command-item-icon">${item.icon}</span>
                <span>${escapeHtml(item.title)}</span>
              </div>
              <span class="command-item-hint">${escapeHtml(item.hint)}</span>
            </div>
          `;
        });
      });
    } else {
      const matchedActions = defaultActions.filter(a => 
        a.title.toLowerCase().includes(q) || 
        a.hint.toLowerCase().includes(q)
      );

      const matchedCustomers = customers.filter(c => 
        (c.name || '').toLowerCase().includes(q) ||
        (c.company || '').toLowerCase().includes(q) ||
        (c.email || '').toLowerCase().includes(q) ||
        (c.phone || '').includes(q) ||
        (c.tags || []).some(t => t.toLowerCase().includes(q))
      ).slice(0, 8);

      if (matchedActions.length > 0) {
        html += `<div class="command-group-title">Ações</div>`;
        matchedActions.forEach((item, idx) => {
          html += `
            <div class="command-item ${idx === 0 ? 'active' : ''}" data-action-id="${escapeHtml(item.id)}">
              <div class="command-item-left">
                <span class="command-item-icon">${item.icon}</span>
                <span>${escapeHtml(item.title)}</span>
              </div>
              <span class="command-item-hint">${escapeHtml(item.hint)}</span>
            </div>
          `;
        });
      }

      if (matchedCustomers.length > 0) {
        html += `<div class="command-group-title">Oportunidades</div>`;
        matchedCustomers.forEach((c, idx) => {
          const isAct = matchedActions.length === 0 && idx === 0;
          html += `
            <div class="command-item ${isAct ? 'active' : ''}" data-customer-id="${escapeHtml(c.id)}">
              <div class="command-item-left">
                <span class="command-item-icon"></span>
                <div>
                  <div style="font-weight: 600; font-size: 0.82rem;">${escapeHtml(c.name)}</div>
                  <div style="font-size: 0.72rem; color: var(--text-muted);">${escapeHtml([c.company, formatBRL(c.dealValue)].filter(Boolean).join(', '))}</div>
                </div>
              </div>
              <span class="command-item-hint">Abrir</span>
            </div>
          `;
        });
      }

      if (matchedActions.length === 0 && matchedCustomers.length === 0) {
        html = `
          <div style="padding: 2.5rem 1rem; text-align: center; color: var(--text-muted); font-size: 0.85rem;">
            Nada encontrado para "<strong>${escapeHtml(q)}</strong>".
          </div>
        `;
      }
    }

    body.innerHTML = html;

    body.querySelectorAll('.command-item').forEach(item => {
      item.addEventListener('click', () => {
        const actionId = item.getAttribute('data-action-id');
        const customerId = item.getAttribute('data-customer-id');

        if (actionId) {
          const action = defaultActions.find(a => a.id === actionId);
          if (action) action.run();
        } else if (customerId) {
          window.closeCommandPalette();
          window.handleOpenLeadDetails(customerId);
        }
      });
    });
  }
}

// ==========================================================================
// Keyboard Shortcuts Engine (?)
// ==========================================================================
export function setupKeyboardShortcuts() {
  const shortcutsDialog = document.getElementById('shortcuts-dialog');
  const btnOpenShortcuts = document.getElementById('btn-open-shortcuts');
  const btnCloseShortcuts = document.getElementById('btn-close-shortcuts-dialog');
  const btnCloseShortcutsFooter = document.getElementById('btn-close-shortcuts-footer');

  if (btnOpenShortcuts && shortcutsDialog) {
    btnOpenShortcuts.addEventListener('click', () => shortcutsDialog.showModal());
  }
  if (btnCloseShortcuts && shortcutsDialog) {
    btnCloseShortcuts.addEventListener('click', () => shortcutsDialog.close());
  }
  if (btnCloseShortcutsFooter && shortcutsDialog) {
    btnCloseShortcutsFooter.addEventListener('click', () => shortcutsDialog.close());
  }

  document.addEventListener('keydown', (e) => {
    // Ctrl+K or Cmd+K: Open Command Palette
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      if (window.openCommandPalette) window.openCommandPalette();
      return;
    }

    // Single keys only act inside the app, with no window open and no modifier held:
    // otherwise "n" on the sign-in screen opened a form, and Alt+N or Ctrl+I were swallowed
    const activeEl = document.activeElement;
    const isTyping = activeEl && (['INPUT', 'TEXTAREA', 'SELECT'].includes(activeEl.tagName) || activeEl.isContentEditable);
    if (isTyping) {
      if (e.key === 'Escape') activeEl.blur();
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey || !isSessionActive() || document.querySelector('dialog[open]')) return;

    const key = e.key.toLowerCase();
    const views = { '1': 'pipeline', '2': 'customers', '3': 'tasks', '4': 'metrics', '5': 'security' };
    if (e.key === '?') {
      e.preventDefault();
      if (shortcutsDialog) shortcutsDialog.showModal();
    } else if (key === 'h') {
      e.preventDefault();
      window.navigateToView('today');
    } else if (key === 'n') {
      // the same path as the button: plan limit, read-only mode and a clean form
      e.preventDefault();
      document.getElementById('btn-new-lead')?.click();
    } else if (key === 'i') {
      e.preventDefault();
      document.getElementById('btn-open-import-modal')?.click();
    } else if (views[e.key]) {
      window.navigateToView(views[e.key]);
    }
  });
}

// ==========================================================================
// Progressive Web App (PWA) & Service Worker Registration
// ==========================================================================
export function setupPWA() {
  if ('serviceWorker' in navigator) {
    // When a new version takes over, the page reloads once so nobody keeps running the old code.
    // Not on the very first visit (there was no version before), and never while a window is open
    // or a field has unsaved text: then the new version simply applies on the next visit.
    const hadVersion = !!navigator.serviceWorker.controller;
    let reloaded = false;
    let newVersionWaiting = false;
    const applyNewVersion = () => {
      if (!newVersionWaiting || reloaded) return;
      const busy = document.querySelector('dialog[open]') || ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);
      if (busy) return;
      reloaded = true;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadVersion) return;
      newVersionWaiting = true;
      applyNewVersion();
    });

    // A tab left open for days would never hear of a new version: it asks when the person
    // comes back to it, and once an hour while it stays in view.
    let registration = null;
    let lastCheck = Date.now();
    const checkForNewVersion = () => {
      applyNewVersion();
      if (!registration || document.visibilityState !== 'visible' || Date.now() - lastCheck < 15 * 60 * 1000) return;
      lastCheck = Date.now();
      registration.update().catch(() => {});
    };
    document.addEventListener('visibilitychange', checkForNewVersion);
    setInterval(checkForNewVersion, 60 * 60 * 1000);

    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').then((result) => { registration = result; }).catch((err) => {
        console.warn('Service worker não registrado:', err);
      });
    });
  }

  let deferredPrompt = null;
  const btnInstall = document.getElementById('btn-install-pwa');

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    if (btnInstall) {
      btnInstall.style.display = 'inline-flex';
    }
  });

  if (btnInstall) {
    btnInstall.addEventListener('click', async () => {
      if (!deferredPrompt) return;
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') {
        showToast("EDX Digital instalado com sucesso no seu sistema!", "success");
      }
      deferredPrompt = null;
      btnInstall.style.display = 'none';
    });
  }

  window.addEventListener('appinstalled', () => {
    if (btnInstall) btnInstall.style.display = 'none';
    showToast("EDX Digital configurado como aplicativo nativo!", "success");
  });
}

// ==========================================================================
// Unified Header Tools & Actions Dropdown Menu
// ==========================================================================
export function setupHeaderToolsMenu() {
  const btnTools = document.getElementById('btn-header-tools');
  const menu = document.getElementById('header-tools-menu');
  const btnMenuImport = document.getElementById('btn-menu-import');
  const btnMenuExportCsv = document.getElementById('btn-menu-export-csv');
  const btnMenuExportAudit = document.getElementById('btn-menu-export-audit');
  const btnMenuShortcuts = document.getElementById('btn-menu-shortcuts');
  const btnMenuPwa = document.getElementById('btn-menu-pwa');
  const legacyInstallBtn = document.getElementById('btn-install-pwa');

  if (!btnTools || !menu) return;

  function toggleMenu(e) {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    const isHidden = menu.style.display === 'none' || !menu.style.display;
    menu.style.display = isHidden ? 'block' : 'none';
    btnTools.classList.toggle('active', isHidden);
    if (isHidden) {
      menu.classList.add('open');
    } else {
      menu.classList.remove('open');
    }
  }

  function closeMenu() {
    menu.style.display = 'none';
    menu.classList.remove('open');
    btnTools.classList.remove('active');
  }

  if (btnTools && menu) {
    btnTools.addEventListener('click', toggleMenu);
  }

  const btnSidebarGemini = document.getElementById('sidebar-gemini-btn');

  if (btnSidebarGemini) {
    btnSidebarGemini.addEventListener('click', () => {
      closeMenu();
    });
  }

  document.addEventListener('click', (e) => {
    if (!menu.contains(e.target) && !btnTools.contains(e.target)) {
      closeMenu();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && menu.style.display === 'block') {
      closeMenu();
    }
  });

  if (btnMenuImport) {
    btnMenuImport.addEventListener('click', () => {
      closeMenu();
      const importDialog = document.getElementById('import-dialog');
      if (importDialog) importDialog.showModal();
    });
  }

  if (btnMenuExportCsv) {
    btnMenuExportCsv.addEventListener('click', () => {
      closeMenu();
      const exportBtn = document.getElementById('btn-export-csv');
      if (exportBtn) exportBtn.click();
    });
  }

  if (btnMenuExportAudit) {
    btnMenuExportAudit.addEventListener('click', () => {
      closeMenu();
      window.handleExportAudit();
    });
  }

  if (btnMenuShortcuts) {
    btnMenuShortcuts.addEventListener('click', () => {
      closeMenu();
      const shortcutsDialog = document.getElementById('shortcuts-dialog');
      if (shortcutsDialog) shortcutsDialog.showModal();
    });
  }

  document.getElementById('btn-menu-tour')?.addEventListener('click', () => {
    closeMenu();
    startTour();
  });

  if (btnMenuPwa) {
    btnMenuPwa.addEventListener('click', () => {
      closeMenu();
      if (legacyInstallBtn) legacyInstallBtn.click();
    });
  }

  window.addEventListener('beforeinstallprompt', () => {
    if (btnMenuPwa) btnMenuPwa.style.display = 'flex';
  });
  window.addEventListener('appinstalled', () => {
    if (btnMenuPwa) btnMenuPwa.style.display = 'none';
  });
}

// ==========================================================================
// Notification Center (Bell Icon + Dropdown)
// ==========================================================================
export function setupNotificationCenter() {
  const bellBtn = document.getElementById('btn-notification-bell');
  const dropdown = document.getElementById('notification-dropdown');
  const badge = document.getElementById('notification-badge');
  const markAllBtn = document.getElementById('btn-mark-all-read');
  const enablePushBtn = document.getElementById('btn-enable-push');

  function updateBadge() {
    const count = getUnreadCount();
    if (badge) {
      if (count > 0) {
        badge.textContent = count > 99 ? '99+' : count;
        badge.style.display = 'flex';
      } else {
        badge.style.display = 'none';
      }
    }
  }

  function renderNotificationList() {
    const listEl = document.getElementById('notification-list');
    if (!listEl) return;

    const notifications = getInAppNotifications(20);
    if (notifications.length === 0) {
      listEl.innerHTML = '<p class="notification-empty">Nada por aqui. Os lembretes de tarefa e os contatos que chegam por formulário aparecem nesta lista.</p>';
      return;
    }

    listEl.innerHTML = notifications.map(n => {
      const date = new Date(n.timestamp);
      const minutes = Math.floor((Date.now() - date) / 60000);
      const when = minutes < 1 ? 'agora'
        : minutes < 60 ? `há ${minutes} min`
        : minutes < 1440 ? `há ${Math.floor(minutes / 60)} h`
        : date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
      return `<button type="button" class="notification-item ${n.read ? '' : 'unread'}" data-click="handleNotificationClick" data-a="${escapeHtml(n.id)}">
        <span class="notification-item-title">${escapeHtml(n.title)}</span>
        <span class="notification-item-body">${escapeHtml(n.body)}</span>
        <span class="notification-item-time">${when}</span>
      </button>`;
    }).join('');
  }

  // Toggle dropdown
  if (bellBtn) {
    bellBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (dropdown) {
        const isVisible = dropdown.style.display !== 'none';
        dropdown.style.display = isVisible ? 'none' : 'flex';
        if (!isVisible) renderNotificationList();
      }
    });
  }

  // Close dropdown on click outside
  document.addEventListener('click', (e) => {
    if (dropdown && dropdown.style.display !== 'none') {
      const wrapper = document.getElementById('notification-bell-wrapper');
      if (wrapper && !wrapper.contains(e.target)) {
        dropdown.style.display = 'none';
      }
    }
  });

  // Mark all as read
  if (markAllBtn) {
    markAllBtn.addEventListener('click', () => {
      markAllAsRead();
      renderNotificationList();
      updateBadge();
    });
  }

  // Browser notifications: asked for only when the person clicks
  if (enablePushBtn) {
    const reflect = () => {
      const permission = getNotificationPermission();
      enablePushBtn.hidden = permission === 'unsupported';
      enablePushBtn.disabled = permission === 'granted' || permission === 'denied';
      enablePushBtn.textContent = permission === 'granted' ? 'Avisos do navegador ativados'
        : permission === 'denied' ? 'Avisos bloqueados nas configurações do navegador'
        : 'Avisar também pelo navegador';
    };
    enablePushBtn.addEventListener('click', async () => {
      const permission = await requestNotificationPermission();
      reflect();
      if (permission === 'granted') showToast('Pronto. Os lembretes de tarefa também vão aparecer como aviso do navegador.', 'success');
    });
    reflect();
  }

  // Notification click handler
  window.handleNotificationClick = function(notifId) {
    const notification = markAsRead(notifId);
    updateBadge();
    if (dropdown) dropdown.style.display = 'none';
    const target = (notification && notification.data) || {};
    if (target.view) window.navigateToView(target.view);
    if (target.customerId && storage.getCustomer(target.customerId)) window.handleOpenLeadDetails(target.customerId);
  };

  // Subscribe to changes
  onNotificationsChange(() => {
    updateBadge();
    if (dropdown && dropdown.style.display !== 'none') renderNotificationList();
  });

  // Initial state
  updateBadge();
}
