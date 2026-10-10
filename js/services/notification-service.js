/**
 * EDX Digital - Push Notification Service (PWA)
 * Handles browser push notifications, in-app notification center,
 * and follow-up reminders via the Service Worker.
 */

const NOTIFICATIONS_STORAGE_KEY = 'nexus_crm_notifications';
const MAX_NOTIFICATIONS = 100;

/**
 * Notification types
 */
export const NOTIFICATION_TYPES = {
  FOLLOW_UP: 'follow_up',
  TASK_DUE: 'task_due',
  LEAD_UPDATE: 'lead_update',
  TEAM_INVITE: 'team_invite',
  DEAL_WON: 'deal_won',
  DEAL_LOST: 'deal_lost',
  SYSTEM: 'system',
  AI_INSIGHT: 'ai_insight'
};

/**
 * Checks if the browser supports notifications and they are enabled
 */
export function isNotificationSupported() {
  return 'Notification' in window;
}

/**
 * Requests notification permission from the user
 * @returns {Promise<string>} 'granted' | 'denied' | 'default'
 */
export async function requestNotificationPermission() {
  if (!isNotificationSupported()) {
    console.warn('[Notifications] Browser does not support notifications.');
    return 'unsupported';
  }

  const permission = await Notification.requestPermission();
  
  if (permission === 'granted') {
    // Register for service worker push if available
    tryRegisterPushSubscription();
  }
  
  return permission;
}

/**
 * Gets the current notification permission status
 */
export function getNotificationPermission() {
  if (!isNotificationSupported()) return 'unsupported';
  return Notification.permission;
}

/**
 * Sends a browser push notification
 * @param {string} title - Notification title
 * @param {Object} options - Notification options (body, icon, tag, data)
 */
export function sendPushNotification(title, options = {}) {
  if (!isNotificationSupported() || Notification.permission !== 'granted') {
    // Fallback: save as in-app notification only
    addInAppNotification({
      type: options.data?.type || NOTIFICATION_TYPES.SYSTEM,
      title,
      body: options.body || '',
      data: options.data || {}
    });
    return;
  }

  const defaultOptions = {
    icon: '/assets/icon.svg',
    badge: '/assets/icon.svg',
    vibrate: [200, 100, 200],
    requireInteraction: false,
    silent: false,
    tag: options.tag || 'edx-digital-' + Date.now(),
    ...options
  };

  try {
    // Try service worker notification first (works in background)
    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({
        type: 'SHOW_NOTIFICATION',
        title,
        options: defaultOptions
      });
    } else {
      // Fallback: direct notification API
      new Notification(title, defaultOptions);
    }
  } catch (e) {
    console.warn('[Notifications] Could not send push:', e);
  }

  // Also save to in-app center
  addInAppNotification({
    type: options.data?.type || NOTIFICATION_TYPES.SYSTEM,
    title,
    body: options.body || '',
    data: options.data || {}
  });
}

/**
 * Adds an in-app notification to the notification center
 */
export function addInAppNotification(notification) {
  const entry = {
    id: 'notif-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5),
    type: notification.type || NOTIFICATION_TYPES.SYSTEM,
    title: notification.title || '',
    body: notification.body || '',
    data: notification.data || {},
    read: false,
    timestamp: new Date().toISOString()
  };

  const notifications = getInAppNotifications();
  notifications.unshift(entry);

  if (notifications.length > MAX_NOTIFICATIONS) {
    notifications.length = MAX_NOTIFICATIONS;
  }

  localStorage.setItem(NOTIFICATIONS_STORAGE_KEY, JSON.stringify(notifications));
  notifySubscribers();
  return entry;
}

/**
 * Gets all in-app notifications
 */
export function getInAppNotifications(limit = MAX_NOTIFICATIONS) {
  try {
    const raw = localStorage.getItem(NOTIFICATIONS_STORAGE_KEY);
    if (raw) {
      const notifications = JSON.parse(raw);
      return Array.isArray(notifications) ? notifications.slice(0, limit) : [];
    }
  } catch (e) {
    console.warn('[Notifications] Error loading:', e);
  }
  return [];
}

/**
 * Gets unread notification count
 */
export function getUnreadCount() {
  return getInAppNotifications().filter(n => !n.read).length;
}

/**
 * Marks a notification as read
 */
export function markAsRead(notificationId) {
  const notifications = getInAppNotifications();
  const notif = notifications.find(n => n.id === notificationId);
  if (notif) {
    notif.read = true;
    localStorage.setItem(NOTIFICATIONS_STORAGE_KEY, JSON.stringify(notifications));
    notifySubscribers();
  }
}

/**
 * Marks all notifications as read
 */
export function markAllAsRead() {
  const notifications = getInAppNotifications();
  notifications.forEach(n => n.read = true);
  localStorage.setItem(NOTIFICATIONS_STORAGE_KEY, JSON.stringify(notifications));
  notifySubscribers();
}

/**
 * Schedules a follow-up reminder notification
 * @param {string} leadName - Name of the lead
 * @param {string} dueDate - Date string (YYYY-MM-DD)
 * @param {string} taskTitle - Task description
 */
export function scheduleFollowUpReminder(leadName, dueDate, taskTitle) {
  const now = new Date();
  const due = new Date(dueDate + 'T09:00:00');
  const delay = due.getTime() - now.getTime();

  if (delay <= 0) {
    // Already due — send immediately
    sendPushNotification(`Follow-up Pendente: ${leadName}`, {
      body: taskTitle || 'Tarefa de follow-up está atrasada!',
      tag: 'followup-' + leadName.replace(/\s/g, '-'),
      data: { type: NOTIFICATION_TYPES.FOLLOW_UP, leadName }
    });
    return;
  }

  // Schedule via setTimeout (limited to browser session)
  if (delay < 86400000) { // Only schedule if within 24h
    setTimeout(() => {
      sendPushNotification(`Follow-up Hoje: ${leadName}`, {
        body: taskTitle || 'Lembre de fazer o follow-up!',
        tag: 'followup-' + leadName.replace(/\s/g, '-'),
        data: { type: NOTIFICATION_TYPES.FOLLOW_UP, leadName }
      });
    }, delay);
  }
}

/**
 * Sends contextual notification for deal events
 */
export function notifyDealEvent(type, leadName, dealValue = 0) {
  const formatBRL = (v) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(v || 0);

  const messages = {
    [NOTIFICATION_TYPES.DEAL_WON]: {
      title: `Negócio Fechado!`,
      body: `${leadName} — ${formatBRL(dealValue)} convertido com sucesso!`
    },
    [NOTIFICATION_TYPES.DEAL_LOST]: {
      title: `Negócio Perdido`,
      body: `${leadName} — ${formatBRL(dealValue)} marcado como perdido.`
    },
    [NOTIFICATION_TYPES.LEAD_UPDATE]: {
      title: `Lead Atualizado`,
      body: `${leadName} teve alterações recentes.`
    }
  };

  const msg = messages[type] || { title: 'EDX Digital', body: `Atualização: ${leadName}` };
  sendPushNotification(msg.title, {
    body: msg.body,
    tag: `deal-${type}-${Date.now()}`,
    data: { type, leadName, dealValue }
  });
}

/**
 * Gets notification icon by type
 */
export function getNotificationIcon(type) {
  const icons = {
    [NOTIFICATION_TYPES.FOLLOW_UP]: '',
    [NOTIFICATION_TYPES.TASK_DUE]: '',
    [NOTIFICATION_TYPES.LEAD_UPDATE]: '',
    [NOTIFICATION_TYPES.TEAM_INVITE]: '',
    [NOTIFICATION_TYPES.DEAL_WON]: '',
    [NOTIFICATION_TYPES.DEAL_LOST]: '',
    [NOTIFICATION_TYPES.SYSTEM]: '',
    [NOTIFICATION_TYPES.AI_INSIGHT]: ''
  };
  return icons[type] || '';
}

// Subscriber pattern for UI updates
const subscribers = [];

export function onNotificationsChange(callback) {
  subscribers.push(callback);
  return () => {
    const idx = subscribers.indexOf(callback);
    if (idx !== -1) subscribers.splice(idx, 1);
  };
}

function notifySubscribers() {
  subscribers.forEach(cb => {
    try { cb(getUnreadCount()); } catch (e) { console.error(e); }
  });
}

/**
 * Attempts to register for push subscription via Service Worker
 */
async function tryRegisterPushSubscription() {
  try {
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.ready;
      console.log('[Notifications] Service Worker ready for push.');
    }
  } catch (e) {
    console.warn('[Notifications] Push subscription failed:', e);
  }
}
