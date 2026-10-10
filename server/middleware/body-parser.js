/**
 * EDX Digital - Reads a JSON request body, up to a size limit
 */

function parseJsonBody(req, maxSizeBytes = 1048576) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let rejected = false;

    req.on('data', (chunk) => {
      size += chunk.length;
      if (rejected) {
        // A little more is read and thrown away so the caller can still be told why; then the line is cut
        if (size > maxSizeBytes * 4) req.destroy();
        return;
      }
      if (size > maxSizeBytes) {
        rejected = true;
        chunks.length = 0;
        return reject(new Error('PAYLOAD_TOO_LARGE'));
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      if (rejected) return;
      const rawBuffer = Buffer.concat(chunks);
      if (rawBuffer.length === 0) return resolve({ rawBuffer, body: {} });
      try {
        const body = JSON.parse(rawBuffer.toString('utf8'));
        // null, numbers and strings are valid JSON but never a valid request here
        resolve({ rawBuffer, body: body && typeof body === 'object' ? body : {} });
      } catch {
        reject(new Error('INVALID_JSON'));
      }
    });

    req.on('error', (err) => { if (!rejected) reject(err); });
  });
}

module.exports = { parseJsonBody };
