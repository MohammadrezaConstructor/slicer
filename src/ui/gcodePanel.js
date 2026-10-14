// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 The Slicer Lab authors
// Virtualised G-code viewer (only visible lines are in the DOM) with an edit mode.
import { escapeHtml } from './format.js';

const LH = 20; // line height in px

function highlight(line) {
  const sc = line.indexOf(';');
  const code = sc >= 0 ? line.slice(0, sc) : line;
  const com = sc >= 0 ? line.slice(sc) : '';
  let html = escapeHtml(code).replace(/^(\s*)([GMT]\d+(?:\.\d+)?)/i, '$1<span class="tok-cmd">$2</span>')
    .replace(/(\s)([XYZEFSPIJR])([-+]?[\d.]+)/gi, '$1$2<span class="tok-num">$3</span>');
  if (com) html += `<span class="tok-com">${escapeHtml(com)}</span>`;
  return html;
}

export class GcodeView {
  constructor(root, { onSelect }) {
    this.root = root;
    this.onSelect = onSelect;
    this.lines = [];
    this.sel = -1;
    root.innerHTML = `<div class="gc-bar"><b id="gc-title">G-code</b><span class="muted" id="gc-count"></span><span class="muted">Click any line to see what it means.</span></div>
      <div class="gc-scroll"><div class="gc-lines"></div><div class="gc-spacer"></div></div>
      <textarea spellcheck="false" hidden aria-label="Edit G-code"></textarea>`;
    this.scroller = root.querySelector('.gc-scroll');
    this.linesEl = root.querySelector('.gc-lines');
    this.spacer = root.querySelector('.gc-spacer');
    this.textarea = root.querySelector('textarea');
    this.scroller.addEventListener('scroll', () => this.render());
    new ResizeObserver(() => this.render()).observe(this.scroller);
    this.linesEl.addEventListener('click', (e) => {
      const ln = e.target.closest('.ln');
      if (ln) this.select(+ln.dataset.n, false);
    });
  }

  setText(text, title = 'G-code') {
    this.text = text;
    this.lines = text.split('\n');
    this.root.querySelector('#gc-title').textContent = title;
    this.root.querySelector('#gc-count').textContent = `${this.lines.length.toLocaleString()} lines`;
    this.spacer.style.height = `${this.lines.length * LH}px`;
    this.render();
  }

  render() {
    const top = this.scroller.scrollTop, h = this.scroller.clientHeight;
    const first = Math.max(0, Math.floor(top / LH) - 10);
    const last = Math.min(this.lines.length, Math.ceil((top + h) / LH) + 10);
    this.linesEl.style.top = `${first * LH}px`;
    let html = '';
    for (let i = first; i < last; i++) {
      html += `<div class="ln${i === this.sel ? ' sel' : ''}" data-n="${i}"><span class="no">${i + 1}</span><span>${highlight(this.lines[i]) || ' '}</span></div>`;
    }
    this.linesEl.innerHTML = html;
  }

  select(n, scroll = true) {
    if (n < 0 || n >= this.lines.length) return;
    this.sel = n;
    if (scroll) {
      const y = n * LH, top = this.scroller.scrollTop, h = this.scroller.clientHeight;
      if (y < top || y > top + h - LH) this.scroller.scrollTop = y - h / 3;
    }
    this.render();
    this.onSelect(n, this.lines[n]);
  }

  search(q) {
    q = q.trim();
    if (!q) return;
    if (/^\d+$/.test(q)) return this.select(parseInt(q, 10) - 1);
    const needle = q.toUpperCase();
    for (let k = 1; k <= this.lines.length; k++) {
      const i = (this.sel + k) % this.lines.length;
      if (this.lines[i].toUpperCase().includes(needle)) return this.select(i);
    }
  }

  setEditing(on) {
    this.editing = on;
    this.textarea.hidden = !on;
    this.scroller.hidden = on;
    if (on) {
      this.textarea.value = this.text;
      const pos = this.lines.slice(0, Math.max(0, this.sel)).reduce((s, l) => s + l.length + 1, 0);
      this.textarea.focus();
      this.textarea.setSelectionRange(pos, pos);
      this.textarea.scrollTop = Math.max(0, this.sel * LH - 100);
    }
  }

  editedText() {
    return this.textarea.value;
  }
}
