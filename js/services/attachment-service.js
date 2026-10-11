/**
 * EDX Digital - Files attached to an opportunity, in Firebase Storage
 * Who can send, open or delete a file is decided by storage.rules: the same people who reach
 * the opportunity in the database.
 */

import { attachmentPath, ATTACHMENT_TYPES } from '../core/attachments.js';
import { getFirebase, isUsingEmulator, SDK_BASE } from './firebase-app.js';

const STORAGE_EMULATOR_PORT = 9199;

let storagePromise = null;

function getStorage() {
  if (!storagePromise) {
    storagePromise = (async () => {
      const { app } = await getFirebase();
      const mod = await import(SDK_BASE + 'firebase-storage.js');
      const storage = mod.getStorage(app);
      if (isUsingEmulator()) mod.connectStorageEmulator(storage, '127.0.0.1', STORAGE_EMULATOR_PORT);
      return { mod, storage };
    })().catch((err) => {
      storagePromise = null;
      throw err;
    });
  }
  return storagePromise;
}

// the name goes in a header: plain ASCII in one field, the real name (encoded) in the other
function disposition(name) {
  const ascii = name.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

/**
 * @param {string} orgId
 * @param {string} customerId - the opportunity's id in the database
 * @param {{id: string, ext: string, name: string}} attachment
 * @param {File} file
 */
export async function uploadAttachment(orgId, customerId, attachment, file) {
  const { mod, storage } = await getStorage();
  await mod.uploadBytes(mod.ref(storage, attachmentPath(orgId, customerId, attachment)), file, {
    contentType: ATTACHMENT_TYPES[attachment.ext],
    contentDisposition: disposition(attachment.name)
  });
}

/** A link that downloads the file (it is stored to be downloaded, never shown as a page) */
export async function attachmentUrl(orgId, customerId, attachment) {
  const { mod, storage } = await getStorage();
  return mod.getDownloadURL(mod.ref(storage, attachmentPath(orgId, customerId, attachment)));
}

export async function deleteAttachment(orgId, customerId, attachment) {
  const { mod, storage } = await getStorage();
  try {
    await mod.deleteObject(mod.ref(storage, attachmentPath(orgId, customerId, attachment)));
  } catch (err) {
    // already gone is the result that was asked for
    if (!err || err.code !== 'storage/object-not-found') throw err;
  }
}

/** Turns a Storage error into a sentence the person can act on */
export function describeStorageError(err) {
  const code = (err && err.code) || '';
  const messages = {
    'storage/unauthorized': 'Você não tem permissão para mexer nos arquivos desta oportunidade.',
    'storage/object-not-found': 'Este arquivo não existe mais.',
    'storage/quota-exceeded': 'O espaço para arquivos acabou. Fale com o suporte.',
    'storage/retry-limit-exceeded': 'A conexão caiu durante o envio. Tente de novo.',
    'storage/canceled': 'O envio foi cancelado.',
    'storage/unknown': 'O serviço de arquivos não respondeu. Tente de novo em instantes.'
  };
  return messages[code] || 'Não foi possível concluir. Tente de novo.';
}
