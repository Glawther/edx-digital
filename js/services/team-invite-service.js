/**
 * EDX Digital - Team invite code
 *
 * Each company has one invite code. Whoever has it can create their own account as a
 * salesperson of that company ("Criar conta" > "Tenho um convite"). The administrator can
 * replace the code at any time, which makes the old one stop working.
 */

import { getSavedOrganization } from '../core/config.js';
import { isCloudSession, regenerateTeamInviteCode } from './auth-service.js';

const DEMO_INVITE_CODE = 'EDX-EXEMPLO';

/**
 * The company's current invite code. The demo has a placeholder that opens nothing.
 */
export function getCompanyTeamInviteCode() {
  if (!isCloudSession()) return DEMO_INVITE_CODE;
  const org = getSavedOrganization();
  return (org && org.teamInviteCode) || '';
}

/**
 * Replaces the invite code (administrators of a real account only)
 */
export async function replaceCompanyTeamInviteCode() {
  if (!isCloudSession()) {
    return { success: false, error: 'Na demonstração o código é só um exemplo.' };
  }
  try {
    const code = await regenerateTeamInviteCode();
    return { success: true, code };
  } catch (err) {
    return { success: false, error: 'Não foi possível gerar um novo código. Tente de novo.' };
  }
}

/**
 * Message to send to the people who should join
 */
export function generateInviteShareText(code) {
  const org = getSavedOrganization();
  const appUrl = window.location.origin;
  return [
    `Convite para o CRM da ${org.name || 'nossa empresa'}`,
    '',
    `1. Acesse ${appUrl}`,
    '2. Abra "Criar conta" e escolha "Tenho um convite"',
    `3. Use o código ${code}`
  ].join('\n');
}

/**
 * Ready-made links that open the person's own e-mail program or WhatsApp with the invite written.
 * Nothing is sent by the CRM itself: the administrator chooses who receives it.
 */
export function inviteShareLinks(code) {
  const org = getSavedOrganization();
  const text = generateInviteShareText(code);
  return {
    email: `mailto:?subject=${encodeURIComponent(`Convite para o CRM da ${org.name || 'nossa empresa'}`)}&body=${encodeURIComponent(text)}`,
    whatsapp: `https://wa.me/?text=${encodeURIComponent(text)}`
  };
}
