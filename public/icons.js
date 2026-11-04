// Original project artwork; no third-party libraries or assets.
const paths = {
  proposal: '<path d="M6 3h8l4 4v14H6zM14 3v5h4M9 12h6M9 16h4"/>',
  ballot: '<path d="M5 12 3 16v5h18v-5l-2-4M3 16h18M9 12h6"/><path d="m9 3 9 3-3 9-9-3zM10 7l1 2 3-1"/>',
  assembly: '<circle cx="5" cy="7" r="2"/><circle cx="12" cy="5" r="2"/><circle cx="19" cy="7" r="2"/><path d="M2 17v-4a3 3 0 0 1 6 0v4M9 15v-5a3 3 0 0 1 6 0v5M16 17v-4a3 3 0 0 1 6 0v4M4 21h16"/>',
  chair: '<circle cx="12" cy="5" r="2"/><path d="M8 12v-1a4 4 0 0 1 8 0v1M3 14h18M5 14v7M19 14v7M9 18h6"/>',
  count: '<path d="m4 4 4-1 2 10-4 1zM12 3l4 1-2 10-4-1M18 6l4 2-4 9-4-2M3 21h18"/>',
};
export function icon(name) {
  if (!(name in paths)) return '';
  return `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths[name]}</svg>`;
}
export function applyIcons(root = document) {
  for (const element of root.querySelectorAll('[data-icon]')) element.innerHTML = icon(element.dataset.icon);
}
