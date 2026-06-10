// DOM helper utilities
export function createElement(html) {
  const tpl = document.createElement('template');
  tpl.innerHTML = html.trim();
  return tpl.content.firstChild;
}

export function $(selector, root = document) {
  return root.querySelector(selector);
}

export function $$(selector, root = document) {
  return Array.from(root.querySelectorAll(selector));
}

export function toggleClass(el, cls, force) {
  if (force === undefined) {
    el.classList.toggle(cls);
  } else {
    el.classList.toggle(cls, force);
  }
}

export function setAttributes(el, attrs) {
  for (const [key, val] of Object.entries(attrs)) {
    if (val === null || val === false) {
      el.removeAttribute(key);
    } else {
      el.setAttribute(key, val === true ? '' : val);
    }
  }
}

export function removeChildren(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
}
