/**
 * EDX Digital - Request Body Parser with Payload Size Limit
 * Defense: Buffer Overflow, Memory Exhaustion & Slowloris Payloads
 */

function parseJsonBody(req, maxSizeBytes = 1048576) { // 1 MB default
  return new Promise((resolve, reject) => {
    let rawBuffer = Buffer.alloc(0);

    req.on('data', (chunk) => {
      rawBuffer = Buffer.concat([rawBuffer, chunk]);
      if (rawBuffer.length > maxSizeBytes) {
        req.destroy();
        return reject(new Error('PAYLOAD_TOO_LARGE: O payload enviado excede o limite máximo permitido (1 MB).'));
      }
    });

    req.on('end', () => {
      if (rawBuffer.length === 0) {
        return resolve({ rawBuffer, body: {} });
      }
      try {
        const body = JSON.parse(rawBuffer.toString('utf8'));
        resolve({ rawBuffer, body });
      } catch (err) {
        reject(new Error('INVALID_JSON: O corpo da requisição não contém um formato JSON válido.'));
      }
    });

    req.on('error', (err) => reject(err));
  });
}

module.exports = {
  parseJsonBody
};
