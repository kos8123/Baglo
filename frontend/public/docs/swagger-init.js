// Kept in its own file because the site CSP (script-src 'self') blocks inline scripts.
fetch('/config.json', {cache: 'no-store'})
  .then((response) => response.json())
  .then(async (config) => {
    const base = (config.api_base || '').replace(/\/$/, '');
    const spec = await fetch(base + '/api/openapi.json').then((response) => response.json());
    spec.servers = [{url: base || location.origin}];
    SwaggerUIBundle({spec, dom_id: '#swagger-ui', deepLinking: true, persistAuthorization: false, validatorUrl: null});
  })
  .catch(() => {
    document.getElementById('swagger-ui').textContent = '文件載入失敗，請確認 API 與網路。';
  });
