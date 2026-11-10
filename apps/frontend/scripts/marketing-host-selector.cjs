'use strict';

// Reference selector for the marketing object key. SEO-TECH-02: the same rule
// lives in infra/cloudfront/spa-rewrite.js (MARKETING_ROOT_OBJECT), which is the
// one attached to CloudFront. Keep both in sync.
function marketingObjectKey(host, uri, method = 'GET') {
  if (typeof host !== 'string' || typeof uri !== 'string') return null;
  if (!['GET', 'HEAD'].includes(method)) return null;
  if (!['vendix.online', 'www.vendix.online'].includes(host.toLowerCase())) return null;
  return uri === '/' ? '/marketing/index.html' : null;
}

module.exports = { marketingObjectKey };
