/**
 * EDX Digital - Notifications
 * The list behind the bell, kept in this browser, plus a browser notification when the person allowed it.
 */

const NOTIFICATIONS_STORAGE_KEY = 'edx_notifications';
const MAX_NOTIFICATIONS = 60;

export function isNotificationSupported() {
  return typeof window !== 'undefined' && 'Notification' in window;
}

/**
 * @returns {Promise<string>} 'granted' | 'denied' | 'default' | 'unsupported'
 */
export async function requestNotificationPermission() {
  if (!isNotificationSupported()) return 'unsupported';
  return Notification.requestPermission();
}

export function getNotificationPermission() {
  if (!isNotificationSupported()) return 'unsupported';
  return Notification.permission;
}

/**
 * Adds a notice to the bell and, when allowed, shows it as a browser notification
 * @param {string} title
 * @param {string} body
 * @param {Object} [data] - { view, customerId }: where a click should lead
 */
export function notify(title, body = '', data = {}) {
  const entry = addInAppNotification({ title, body, data });
  if (getNotificationPermission() !== 'granted') return entry;

  const options = { body, icon: '/assets/icon.svg', badge: '/assets/icon.svg', tag: entry.id, data };
  try {
    // Through the service worker it also works on phones and with the window in the background
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.ready
        .then(registration => registration.showNotification(title, options))
        .catch(() => new Notification(title, options));
    } else {
      new Notification(title, options);
    }
  } catch (err) {
    console.warn('[Notifications] Could not show:', err);
  }
  return entry;
}

export function addInAppNotification(notification) {
  const entry = {
    id: 'notif-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7),
    title: notification.title || '',
    body: notification.body || '',
    data: notification.data || {},
    read: false,
    timestamp: new Date().toISOString()
  };
  const notifications = getInAppNotifications();
  notifications.unshift(entry);
  save(notifications.slice(0, MAX_NOTIFICATIONS));
  return entry;
}

export function getInAppNotifications(limit = MAX_NOTIFICATIONS) {
  try {
    const list = JSON.parse(localStorage.getItem(NOTIFICATIONS_STORAGE_KEY));
    return Array.isArray(list) ? list.slice(0, limit) : [];
  } catch {
    return [];
  }
}

export function getUnreadCount() {
  return getInAppNotifications().filter(n => !n.read).length;
}

export function markAsRead(notificationId) {
  const notifications = getInAppNotifications();
  const found = notifications.find(n => n.id === notificationId);
  if (!found) return null;
  found.read = true;
  save(notifications);
  return found;
}

export function markAllAsRead() {
  const notifications = getInAppNotifications();
  notifications.forEach(n => { n.read = true; });
  save(notifications);
}

/** The list belongs to whoever was signed in: it goes away on sign-out */
export function clearNotifications() {
  localStorage.removeItem(NOTIFICATIONS_STORAGE_KEY);
  notifySubscribers();
}

function save(notifications) {
  localStorage.setItem(NOTIFICATIONS_STORAGE_KEY, JSON.stringify(notifications));
  notifySubscribers();
}

const subscribers = [];

export function onNotificationsChange(callback) {
  subscribers.push(callback);
  return () => {
    const index = subscribers.indexOf(callback);
    if (index !== -1) subscribers.splice(index, 1);
  };
}

function notifySubscribers() {
  subscribers.forEach(callback => {
    try { callback(getUnreadCount()); } catch (err) { console.error(err); }
  });
}
