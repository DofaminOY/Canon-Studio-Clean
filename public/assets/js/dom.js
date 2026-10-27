import { state } from './state.js';

export const $ = (id) => document.getElementById(id);
// Accessible banners and queue elements; no HTML injection.

export function flash(text, level = 'info') {
  if (text === state.lastMessage && $('flash').classList.contains('visible')) return;
  state.lastMessage = text;
  $('flash').textContent = text;
  $('flash').className = `flash visible ${level}`;
}

export function seg(group, value) {
  document.querySelectorAll(`#${group} button`).forEach((button) => {
    button.classList.toggle('selected', button.dataset.value === value);
    button.setAttribute('aria-pressed', String(button.dataset.value === value));
  });
}

export function simpleBlock(message) {
  const div = document.createElement('div'); div.className = 'empty'; div.textContent = message; return div;
}

export function makeJob(title, detail, buttonLabel = null, onClick = null) {
  const div = document.createElement('div'); div.className = 'job';
  const content = document.createElement('div');
  const name = document.createElement('div'); name.className = 'job-name'; name.textContent = title;
  const sub = document.createElement('div'); sub.className = 'job-detail'; sub.textContent = detail;
  content.append(name, sub); div.append(content);
  if (buttonLabel) {
    const wrap = document.createElement('div'); wrap.className = 'job-buttons';
    const button = document.createElement('button'); button.type = 'button'; button.className = 'btn danger';
    button.textContent = buttonLabel; button.addEventListener('click', onClick);
    wrap.append(button); div.append(wrap);
  }
  return div;
}
