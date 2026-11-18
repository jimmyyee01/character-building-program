// Original API endpoint for super-admin login
// State: 18/11/2026 (fixed)

const API = {
  // Super-admin login endpoint
  superLogin: function(username, password) {
    return fetch('/api/auth/super-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: username, password: password })
    })
      .then(function(response) {
        // Fixed: Always return JSON, even on errors
        return response.json();
      })
      .then(function(data) {
        // Fixed: Return only safe fields - extract primitives only
        var ok = data.ok;
        var token = data.token;
        var error = data.error;
        // Ensure we return only simple values, avoid circular references
        return { ok: ok || false, token: token || undefined, error: error || undefined };
      })
      .catch(function(e) {
        // Fixed: Return JSON error instead of throwing (was causing 302 instead of JSON)
        return { ok: false, error: e.message || 'Network error' };
      });
  },

  // Generic API get - FIXED: safely extract primitives only
  get: function(path) {
    return fetch(path)
      .then(function(response) {
        return response.json();
      })
      .then(function(data) {
        // FIXED: Extract only safe primitive fields to avoid circular JSON structure
        // (Converting circular structure to JSON error - TLSSocket/HTTPParser)
        var ok = data.ok;
        var programName = data.programName;
        var programLogo = data.programLogo;
        var portals = data.portals;
        // Return only simple values - avoid circular references from TLS/HTTP objects
        return {
          ok: ok || false,
          programName: typeof programName === 'string' ? programName : undefined,
          programLogo: typeof programLogo === 'string' ? programLogo : undefined,
          portals: Array.isArray(portals) ? portals : undefined
        };
      })
      .catch(function(e) {
        // Fixed: Return JSON error instead of throwing
        return { ok: false, error: e.message || 'Network error' };
      });
  }
};

module.exports = API;