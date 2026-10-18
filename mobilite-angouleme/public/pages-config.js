(() => {
  const isGitHubPages = location.hostname.endsWith('github.io');
  if (!isGitHubPages) return;

  const API_BASE = 'https://mobilite-angouleme.onrender.com';
  const nativeFetch = window.fetch.bind(window);

  window.fetch = (input, init) => {
    if (typeof input === 'string' && input.startsWith('/api/')) {
      input = `${API_BASE}${input}`;
    } else if (input instanceof Request) {
      const url = new URL(input.url);
      if (url.origin === location.origin && url.pathname.startsWith('/api/')) {
        input = new Request(`${API_BASE}${url.pathname}${url.search}`, input);
      }
    }
    return nativeFetch(input, init);
  };

  if ('serviceWorker' in navigator) {
    const nativeRegister = navigator.serviceWorker.register.bind(navigator.serviceWorker);
    navigator.serviceWorker.register = (scriptURL, options) => {
      if (scriptURL === '/sw.js') scriptURL = './sw.js';
      return nativeRegister(scriptURL, options);
    };
  }
})();
