/**
 * EDX Digital - High-Performance Sliding Window Rate Limiter
 * Protection: DDoS, Credential Stuffing, Scraping, Resource Exhaustion
 * Scopes: Client IP and Tenant ID dual-enforcement
 */

class RateLimiter {
  constructor() {
    // Map<key, Array<timestamp>>
    this.hits = new Map();

    // Auto cleanup of expired windows every 2 minutes
    this.cleanupInterval = setInterval(() => this.pruneExpired(), 120000);
    if (this.cleanupInterval.unref) {
      this.cleanupInterval.unref();
    }
  }

  /**
   * Checks and consumes a hit in a sliding window
   * @param {string} key Identifier (e.g. `ip:192.168.1.1` or `tenant:uuid:export`)
   * @param {number} maxHits Maximum allowed requests in the window
   * @param {number} windowMs Time window in milliseconds
   * @returns {{ allowed: boolean, remaining: number, resetMs: number }}
   */
  check(key, maxHits, windowMs) {
    const now = Date.now();
    const cutoff = now - windowMs;

    let timestamps = this.hits.get(key) || [];
    // Filter timestamps within current window
    timestamps = timestamps.filter(t => t > cutoff);

    if (timestamps.length >= maxHits) {
      const oldest = timestamps[0];
      const resetMs = Math.max(0, oldest + windowMs - now);
      return {
        allowed: false,
        remaining: 0,
        resetMs
      };
    }

    timestamps.push(now);
    this.hits.set(key, timestamps);

    return {
      allowed: true,
      remaining: maxHits - timestamps.length,
      resetMs: windowMs
    };
  }

  /**
   * Dual-layer check for IP and Tenant simultaneously
   */
  checkDual(ip, tenantId, options = {}) {
    const {
      maxIp = 120,
      windowIpMs = 60000,
      maxTenant = 600,
      windowTenantMs = 60000
    } = options;

    const ipResult = this.check(`ip:${ip}`, maxIp, windowIpMs);
    if (!ipResult.allowed) {
      return {
        allowed: false,
        scope: 'ip',
        error: `Muitas requisições originadas do seu endereço IP. Tente novamente em ${Math.ceil(ipResult.resetMs / 1000)}s.`
      };
    }

    if (tenantId) {
      const tenantResult = this.check(`tenant:${tenantId}`, maxTenant, windowTenantMs);
      if (!tenantResult.allowed) {
        return {
          allowed: false,
          scope: 'tenant',
          error: `Limite de tráfego por organização atingido para mitigar raspagem. Aguarde ${Math.ceil(tenantResult.resetMs / 1000)}s.`
        };
      }
    }

    return { allowed: true };
  }

  /**
   * Specialized rate limit for Sensitive Actions (Export, Auth)
   */
  checkExportRateLimit(tenantId) {
    // Max 5 exports per hour per tenant
    return this.check(`export:tenant:${tenantId}`, 5, 3600000);
  }

  checkAuthRateLimit(ip) {
    // Max 5 failed attempts per 5 minutes per IP
    return this.check(`auth:ip:${ip}`, 5, 300000);
  }

  pruneExpired() {
    const now = Date.now();
    const maxWindow = 3600000; // 1 hour max retention
    for (const [key, timestamps] of this.hits.entries()) {
      const valid = timestamps.filter(t => t > now - maxWindow);
      if (valid.length === 0) {
        this.hits.delete(key);
      } else {
        this.hits.set(key, valid);
      }
    }
  }

  reset() {
    this.hits.clear();
  }

  destroy() {
    clearInterval(this.cleanupInterval);
  }
}

// Singleton instance
const globalRateLimiter = new RateLimiter();

module.exports = {
  RateLimiter,
  globalRateLimiter
};
