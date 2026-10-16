/**
 * EDX Digital - Watching a PIX charge until it is paid
 *
 * The checkout asks about the charge on a timer and again when the tab comes back into view.
 * Both can fire together; without this, two answers of "approved" would confirm the payment
 * twice (two notices, two audit records).
 */

/**
 * @param {object} options
 * @param {(paymentId: string) => Promise<{status: string}>} options.fetchStatus
 * @param {(result: object, paymentId: string) => (void|Promise<void>)} options.onApproved
 * @param {(result: object, paymentId: string) => void} [options.onEnded] - cancelled or expired
 * @returns {{check: (paymentId: string) => Promise<void>}}
 */
export function createPaymentWatcher({ fetchStatus, onApproved, onEnded = () => {} }) {
  let inFlight = null;
  // charges already settled here: a late answer about them changes nothing
  const settled = new Set();

  const check = (paymentId) => {
    if (!paymentId || settled.has(paymentId)) return Promise.resolve();
    // one question at a time; whoever asks meanwhile waits for the same answer
    if (inFlight) return inFlight;
    inFlight = (async () => {
      try {
        const result = await fetchStatus(paymentId);
        if (settled.has(paymentId) || !result) return;
        if (result.status === 'approved') {
          settled.add(paymentId);
          await onApproved(result, paymentId);
        } else if (result.status !== 'pending') {
          settled.add(paymentId);
          onEnded(result, paymentId);
        }
      } catch {
        // A failed check is not a failed payment: keep waiting
      } finally {
        inFlight = null;
      }
    })();
    return inFlight;
  };

  return { check };
}
