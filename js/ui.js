// Small DOM helpers shared by modules.
export const $ = id => document.getElementById(id);
let toastT = 0;
export function toastMsg(msg) {
  const t = $('toast'); if (!t) return;
  t.textContent = msg; t.style.opacity = 1;
  clearTimeout(toastT); toastT = setTimeout(() => t.style.opacity = 0, 1600);
}
