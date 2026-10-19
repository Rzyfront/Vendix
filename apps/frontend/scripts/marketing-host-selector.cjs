'use strict';

// Candidate viewer-request selector. NOT attached to CloudFront by this PR.
// Runs before cache lookup: different hosts resolve to different object keys.
function marketingObjectKey(host, uri, method = 'GET') {
  if (typeof host !== 'string' || typeof uri !== 'string') return null;
  if (!['GET', 'HEAD'].includes(method)) return null;
  if (!['vendix.online', 'www.vendix.online'].includes(host.toLowerCase())) return null;
  return uri === '/' ? '/marketing/index.html' : null;
}

module.exports = { marketingObjectKey };
