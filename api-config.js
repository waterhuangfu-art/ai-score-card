(() => {
  const defaults = {
    apiBase: 'https://api.playforfun.life'
  };

  const existing = window.SCORE_CARD_CONFIG || {};
  const config = Object.assign({}, defaults, existing);

  function normalizeApiBase(value) {
    return String(value || '').trim().replace(/\/+$/, '');
  }

  function isGitHubPagesHost(hostname) {
    return /(^|\.)github\.io$/i.test(String(hostname || ''));
  }

  function readStoredApiBase() {
    try {
      return normalizeApiBase(window.localStorage.getItem('score-card-api-base'));
    } catch {
      return '';
    }
  }

  function writeStoredApiBase(value) {
    try {
      if (value) {
        window.localStorage.setItem('score-card-api-base', value);
      } else {
        window.localStorage.removeItem('score-card-api-base');
      }
    } catch {
      // Ignore storage failures in private mode or restricted browsers.
    }
  }

  function resolveScoreCardApiBase() {
    const params = new URLSearchParams(window.location.search);
    const rawApiBase = params.get('api');
    const queryApiBase = rawApiBase === 'clear' ? '' : normalizeApiBase(rawApiBase);
    const configuredApiBase = normalizeApiBase(config.apiBase);

    if (rawApiBase === 'clear') {
      writeStoredApiBase('');
    }

    if (queryApiBase) {
      writeStoredApiBase(queryApiBase);
      return queryApiBase;
    }

    if (configuredApiBase) {
      return configuredApiBase;
    }

    if (!isGitHubPagesHost(window.location.hostname)) {
      return window.location.origin;
    }

    return readStoredApiBase();
  }

  window.SCORE_CARD_CONFIG = config;
  window.resolveScoreCardApiBase = resolveScoreCardApiBase;
})();
