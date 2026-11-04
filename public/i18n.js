import messages from './locales/pt-PT.js';
export const locale = 'pt-PT';
export function t(key, values = {}) {
  if (!(key in messages)) throw new Error('Missing translation: ' + key);
  return messages[key].replace(/\{(\w+)\}/g, (match, name) => Object.hasOwn(values, name) ? String(values[name]) : match);
}
export function translateDocument(root = document) {
  for (const element of root.querySelectorAll('[data-i18n]')) element.textContent = t(element.dataset.i18n);
  for (const attribute of ['aria-label', 'content']) {
    for (const element of root.querySelectorAll('[data-i18n-' + attribute + ']')) element.setAttribute(attribute, t(element.getAttribute('data-i18n-' + attribute)));
  }
}
