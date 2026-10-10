/**
 * EDX Digital - Putting data into HTML safely
 * Everything that comes from the database or from a person goes through one of these
 * before it reaches innerHTML. Tests: tests/unit/html.test.mjs
 */

/** Text or an attribute value */
export function escapeHtml(str) {
  if (str === null || str === undefined || str === '') return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * An address safe to use in src or href: https, or an embedded image. Anything else
 * (javascript:, data:text/html, a broken value) becomes an empty string.
 */
export function safeImageUrl(url) {
  const text = String(url ?? '').trim();
  if (/^https:\/\/[^\s"'<>]+$/i.test(text)) return text;
  if (/^data:image\/(png|jpeg|jpg|gif|webp|svg\+xml);base64,[A-Za-z0-9+/=]+$/i.test(text)) return text;
  return '';
}

/** Ids this app generates use only these characters; anything else did not come from it */
export function isSafeId(id) {
  return typeof id === 'string' && /^[A-Za-z0-9_-]{1,120}$/.test(id);
}
