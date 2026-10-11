/**
 * EDX Digital - The company: name and logo, exporting, backup, leads arriving from forms
 */

import { getSavedOrganization, saveOrganization } from '../core/config.js';
import { crmStore } from '../core/crm-store.js';
import { safeImageUrl } from '../core/html.js';
import { storage } from '../core/storage-manager.js';
import { AUDIT_ACTIONS, AUDIT_SEVERITY, logAudit } from '../services/audit-service.js';
import { isAdmin } from '../services/auth-service.js';
import { exportCustomersToCSV } from '../services/export-service.js';
import { getWebhookConfig, regenerateWebhookToken, sendTestWebhookLead } from '../services/webhook-service.js';
import { escapeHtml, showToast } from '../ui/ui-renderer.js';

// ==========================================================================
// Webhook & Lead Ingestion Modal
// ==========================================================================
export function setupWebhookModalEvents() {
  const dialog = document.getElementById('webhook-dialog');
  const btnOpen = document.getElementById('btn-menu-webhook');
  const btnClose = document.getElementById('btn-close-webhook-dialog');
  const btnCloseFooter = document.getElementById('btn-close-webhook-footer');

  const urlInput = document.getElementById('webhook-url-input');
  const tokenInput = document.getElementById('webhook-token-input');
  const btnCopyUrl = document.getElementById('btn-copy-webhook-url');
  const btnCopyToken = document.getElementById('btn-copy-webhook-token');
  const btnToggleToken = document.getElementById('btn-toggle-show-token');
  const btnRegenerateToken = document.getElementById('btn-regenerate-webhook-token');
  const btnSendTest = document.getElementById('btn-send-test-webhook');

  function updateFields() {
    const cfg = getWebhookConfig();
    if (urlInput) {
      const base = typeof window.getApiBaseUrl === 'function' && window.getApiBaseUrl() ? window.getApiBaseUrl() : window.location.origin;
      urlInput.value = `${base}/api/webhook/leads`;
    }
    if (tokenInput) {
      tokenInput.value = cfg.token;
    }
  }

  if (btnOpen && dialog) {
    btnOpen.addEventListener('click', () => {
      updateFields();
      const toolsMenu = document.getElementById('header-tools-menu');
      if (toolsMenu) toolsMenu.style.display = 'none';
      dialog.showModal();
    });
  }

  const closeDialog = () => dialog && dialog.close();
  if (btnClose) btnClose.addEventListener('click', closeDialog);
  if (btnCloseFooter) btnCloseFooter.addEventListener('click', closeDialog);

  if (btnCopyUrl && urlInput) {
    btnCopyUrl.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(urlInput.value);
        showToast('URL do Webhook copiada!', 'success');
      } catch {
        urlInput.select();
        document.execCommand('copy');
        showToast('URL do Webhook selecionada/copiada!', 'success');
      }
    });
  }

  if (btnCopyToken && tokenInput) {
    btnCopyToken.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(tokenInput.value);
        showToast('Token do Webhook copiado!', 'success');
      } catch {
        tokenInput.select();
        document.execCommand('copy');
        showToast('Token selecionado/copiado!', 'success');
      }
    });
  }

  if (btnToggleToken && tokenInput) {
    btnToggleToken.addEventListener('click', () => {
      const isPassword = tokenInput.type === 'password';
      tokenInput.type = isPassword ? 'text' : 'password';
      btnToggleToken.textContent = isPassword ? 'Ocultar' : 'Ver';
    });
  }

  if (btnRegenerateToken) {
    btnRegenerateToken.addEventListener('click', () => {
      const newToken = regenerateWebhookToken();
      if (tokenInput) tokenInput.value = newToken;
      showToast('Novo token gerado e ativado com segurança!', 'info');
    });
  }

  if (btnSendTest) {
    btnSendTest.addEventListener('click', async () => {
      btnSendTest.disabled = true;
      btnSendTest.textContent = 'Enviando lead de teste…';
      try {
        const res = await sendTestWebhookLead();
        if (crmStore) crmStore.emitChange();
        showToast(`Lead de teste (${res.lead.name}) recebido e adicionado ao funil!`, 'success');
      } catch (err) {
        showToast('Erro ao disparar teste: ' + err.message, 'error');
      } finally {
        btnSendTest.disabled = false;
        btnSendTest.textContent = 'Simular Envio de Lead via Webhook';
      }
    });
  }
}

// ==========================================================================
// Whitelabel & Branding Customizer
// ==========================================================================
export function setupWhitelabelEvents() {
  const dialog = document.getElementById('whitelabel-dialog');
  const btnOpen = document.getElementById('btn-menu-whitelabel');
  const btnClose = document.getElementById('btn-close-whitelabel-dialog');
  const form = document.getElementById('form-whitelabel');
  const btnReset = document.getElementById('btn-whitelabel-reset');

  const inputName = document.getElementById('whitelabel-input-name');
  const inputLegal = document.getElementById('whitelabel-input-legal');
  const inputLogo = document.getElementById('whitelabel-input-logo');
  const fileLogo = document.getElementById('whitelabel-file-logo');
  const inputColor = document.getElementById('whitelabel-input-color');
  const colorBtns = document.querySelectorAll('.whitelabel-color-btn');

  const previewName = document.getElementById('whitelabel-preview-name');
  const previewIcon = document.getElementById('whitelabel-preview-icon');

  function updatePreview(name, logo, color) {
    if (previewName) previewName.textContent = name || 'EDX Digital';
    if (previewIcon) {
      if (color) previewIcon.style.background = color;
      const safeLogo = safeImageUrl(logo);
      if (safeLogo) {
        previewIcon.innerHTML = `<img src="${escapeHtml(safeLogo)}" alt="" style="width: 100%; height: 100%; object-fit: contain;">`;
      } else {
        previewIcon.textContent = (name || 'E').charAt(0).toUpperCase();
      }
    }
  }

  if (btnOpen && dialog) {
    btnOpen.addEventListener('click', () => {
      const org = getSavedOrganization();
      if (inputName) inputName.value = org.name || '';
      if (inputLegal) inputLegal.value = org.legalName || '';
      if (inputLogo) inputLogo.value = org.logoUrl || '';
      if (inputColor) inputColor.value = org.brandColor || '#3b82f6';
      
      updatePreview(org.name, org.logoUrl, org.brandColor);

      // Close tools dropdown if open
      const toolsMenu = document.getElementById('header-tools-menu');
      if (toolsMenu) toolsMenu.style.display = 'none';

      dialog.showModal();
    });
  }

  if (inputName) {
    inputName.addEventListener('input', () => {
      updatePreview(inputName.value, inputLogo?.value, inputColor?.value);
    });
  }

  if (inputLogo) {
    inputLogo.addEventListener('input', () => {
      updatePreview(inputName?.value, inputLogo.value, inputColor?.value);
    });
  }

  if (fileLogo) {
    fileLogo.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      if (!file.type.startsWith('image/') || file.size > 5 * 1024 * 1024) {
        showToast('Escolha uma imagem de até 5 MB.', 'error');
        return;
      }
      // Drawn at 256 px at most: sharp in the sidebar and on the proposal, small in the database
      const image = new Image();
      image.onload = () => {
        const scale = Math.min(1, 256 / Math.max(image.width, image.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));
        canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
        const reduced = canvas.toDataURL('image/png');
        URL.revokeObjectURL(image.src);
        if (inputLogo) inputLogo.value = reduced;
        updatePreview(inputName?.value, reduced, inputColor?.value);
      };
      image.onerror = () => showToast('Não foi possível ler essa imagem.', 'error');
      image.src = URL.createObjectURL(file);
    });
  }

  // Color preset buttons
  colorBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      colorBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const color = btn.getAttribute('data-color');
      if (inputColor) inputColor.value = color;
      updatePreview(inputName?.value, inputLogo?.value, color);
    });
  });

  if (inputColor) {
    inputColor.addEventListener('input', () => {
      colorBtns.forEach(b => b.classList.remove('active'));
      updatePreview(inputName?.value, inputLogo?.value, inputColor.value);
    });
  }

  if (btnClose) {
    btnClose.addEventListener('click', () => dialog && dialog.close());
  }

  if (btnReset) {
    btnReset.addEventListener('click', () => {
      const defaultOrg = {
        name: 'Empresa Exemplo',
        legalName: 'EDX Digital',
        logoUrl: '',
        brandColor: '#3b82f6'
      };
      saveOrganization(defaultOrg);
      if (inputName) inputName.value = defaultOrg.name;
      if (inputLegal) inputLegal.value = defaultOrg.legalName;
      if (inputLogo) inputLogo.value = '';
      if (inputColor) inputColor.value = defaultOrg.brandColor;
      updatePreview(defaultOrg.name, '', defaultOrg.brandColor);
      showToast("Identidade visual restaurada para o padrão!", "info");
    });
  }

  if (form) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const org = getSavedOrganization();
      const updated = {
        ...org,
        name: inputName?.value.trim() || 'EDX Digital',
        legalName: inputLegal?.value.trim() || '',
        logoUrl: inputLogo?.value.trim() || '',
        brandColor: inputColor?.value || '#3b82f6'
      };
      saveOrganization(updated);
      dialog.close();
      showToast("Identidade visual atualizada com sucesso!", "success");
    });
  }
}

// ==========================================================================
// Export CSV Events
// ==========================================================================
export function setupExportEvents() {
  const btnExport = document.getElementById('btn-export-csv');
  if (btnExport) {
    btnExport.addEventListener('click', () => {
      const customers = crmStore.getState().filteredCustomers;
      try {
        exportCustomersToCSV(customers);
        logAudit(AUDIT_ACTIONS.DATA_EXPORTED, { type: 'customers_csv', count: customers.length });
        showToast("Planilha CSV exportada com sucesso!", "success");
      } catch (err) {
        showToast("Erro ao exportar: " + err.message, "error");
      }
    });
  }
}

// ==========================================================================
// Disaster Recovery & Backup Events (Tríade CID: Disponibilidade)
// ==========================================================================
export function setupBackupEvents() {
  const backupFileInput = document.getElementById('backup-file-input');

  window.handleDownloadBackup = function() {
    try {
      const snapshot = storage.createBackupSnapshot();
      const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(snapshot, null, 2));
      const downloadAnchor = document.createElement('a');
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      downloadAnchor.setAttribute("href", dataStr);
      downloadAnchor.setAttribute("download", `edx_digital_backup_${timestamp}.json`);
      document.body.appendChild(downloadAnchor);
      downloadAnchor.click();
      downloadAnchor.remove();
      logAudit(AUDIT_ACTIONS.BACKUP_CREATED, { totalCustomers: snapshot?.customers?.length || 0 });
      showToast("Snapshot de contingência exportado com sucesso!", "success");
    } catch (err) {
      showToast("Erro ao exportar backup: " + err.message, "error");
    }
  };

  window.handleTriggerRestoreBackup = function() {
    if (!isAdmin()) {
      showToast("Só administradores podem restaurar uma cópia de segurança.", "error");
      logAudit(AUDIT_ACTIONS.PERMISSION_DENIED, { action: 'restore_backup' }, AUDIT_SEVERITY.WARNING);
      return;
    }
    if (backupFileInput) backupFileInput.click();
  };

  if (backupFileInput) {
    backupFileInput.addEventListener('change', async (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = async (event) => {
        try {
          const data = JSON.parse(event.target.result);
          await storage.restoreBackupSnapshot(data);
          logAudit(AUDIT_ACTIONS.BACKUP_RESTORED, { restoredCustomers: data?.customers?.length || 0 }, AUDIT_SEVERITY.WARNING);
          showToast("Banco restaurado com sucesso a partir do snapshot!", "success");
        } catch (err) {
          showToast("Falha na restauração do backup: " + err.message, "error");
        } finally {
          backupFileInput.value = '';
        }
      };
      reader.onerror = () => {
        showToast("Erro ao ler o arquivo de backup.", "error");
        backupFileInput.value = '';
      };
      reader.readAsText(file);
    });
  }
}
