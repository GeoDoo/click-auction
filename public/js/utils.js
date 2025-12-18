/**
 * Utility functions - Shared across pages
 * @module Utils
 */

const Utils = {
  /**
   * Escape HTML to prevent XSS
   * @param {string} text - Text to escape
   * @returns {string} Escaped text
   */
  escapeHtml(text) {
    if (typeof text !== 'string') return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  },

  /**
   * Format a number with commas
   * @param {number} num
   * @returns {string}
   */
  formatNumber(num) {
    return num.toLocaleString();
  },

  /**
   * Debounce a function
   * @param {Function} fn - Function to debounce
   * @param {number} delay - Delay in ms
   * @returns {Function}
   */
  debounce(fn, delay = 300) {
    let timeoutId;
    return function (...args) {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => fn.apply(this, args), delay);
    };
  },

  /**
   * Throttle a function
   * @param {Function} fn - Function to throttle
   * @param {number} limit - Time limit in ms
   * @returns {Function}
   */
  throttle(fn, limit = 100) {
    let inThrottle;
    return function (...args) {
      if (!inThrottle) {
        fn.apply(this, args);
        inThrottle = true;
        setTimeout(() => (inThrottle = false), limit);
      }
    };
  },

  /**
   * Generate a unique ID
   * @returns {string}
   */
  generateId() {
    return Math.random().toString(36).substr(2, 9);
  },

  /**
   * Check if device is mobile
   * @returns {boolean}
   */
  isMobile() {
    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
  },

  /**
   * Check if device supports touch
   * @returns {boolean}
   */
  hasTouch() {
    return 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  },

  /**
   * Wait for a specified time
   * @param {number} ms - Milliseconds to wait
   * @returns {Promise<void>}
   */
  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  },

  /**
   * Get ordinal suffix for a number (1st, 2nd, 3rd, etc.)
   * @param {number} n
   * @returns {string}
   */
  getOrdinal(n) {
    const s = ['th', 'st', 'nd', 'rd'];
    const v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  },

  /**
   * Create an element with attributes
   * @param {string} tag - Tag name
   * @param {Object} attrs - Attributes
   * @param {string|Node|Node[]} children - Children
   * @returns {HTMLElement}
   */
  createElement(tag, attrs = {}, children = null) {
    const el = document.createElement(tag);

    for (const [key, value] of Object.entries(attrs)) {
      if (key === 'className') {
        el.className = value;
      } else if (key === 'style' && typeof value === 'object') {
        Object.assign(el.style, value);
      } else if (key.startsWith('on') && typeof value === 'function') {
        el.addEventListener(key.slice(2).toLowerCase(), value);
      } else if (key.startsWith('data')) {
        el.setAttribute(key.replace(/([A-Z])/g, '-$1').toLowerCase(), value);
      } else {
        el.setAttribute(key, value);
      }
    }

    if (children) {
      if (typeof children === 'string') {
        el.textContent = children;
      } else if (Array.isArray(children)) {
        children.forEach((child) => el.appendChild(child));
      } else {
        el.appendChild(children);
      }
    }

    return el;
  },

  /**
   * Announce message to screen readers
   * @param {string} message
   * @param {boolean} assertive - Use assertive (interrupting) or polite
   */
  announce(message, assertive = false) {
    const el = document.createElement('div');
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', assertive ? 'assertive' : 'polite');
    el.setAttribute('aria-atomic', 'true');
    el.className = 'sr-only';
    el.textContent = message;
    document.body.appendChild(el);

    // Remove after announcement
    setTimeout(() => el.remove(), 1000);
  },
};

// Export for use in other modules
window.Utils = Utils;

