// 续禾杀 动效 v1（美术）。用法：import { fx } from './fx.js';
// fx.playable(cardEl, true/false)   可出牌高亮（false = 置灰不可出）
// fx.hurt(el, amount, {self})       el 是 HP 数字或玩家信息条；amount 为伤害值（负数视为治疗）；self=true 时加屏幕红晕
// fx.destroy(cardEl) -> Promise     播放摧毁动画，约 1 秒后移除元素再 resolve
export const fx = {
  playable(el, on = true) { el.classList.toggle('fx-playable', !!on); el.classList.toggle('fx-unplayable', !on); },
  clearPlayable(root = document) { root.querySelectorAll('.fx-playable,.fx-unplayable').forEach((e) => e.classList.remove('fx-playable', 'fx-unplayable')); },
  hurt(el, amount = 1, { self = false } = {}) {
    el.classList.remove('fx-hurt'); void el.offsetWidth; el.classList.add('fx-hurt');
    setTimeout(() => el.classList.remove('fx-hurt'), 650);
    const r = el.getBoundingClientRect(); const f = document.createElement('div');
    f.className = 'fx-float' + (amount < 0 ? ' heal' : ''); f.textContent = amount < 0 ? `+${-amount}` : `-${amount}`;
    f.style.left = `${r.left + r.width / 2}px`; f.style.top = `${r.top - 6}px`; document.body.appendChild(f);
    setTimeout(() => f.remove(), 950);
    if (self && amount > 0) { const v = document.createElement('div'); v.className = 'fx-vignette'; document.body.appendChild(v); setTimeout(() => v.remove(), 650); }
  },
  destroy(el) {
    return new Promise((res) => {
      el.insertAdjacentHTML('beforeend', '<svg class="fx-scribble" viewBox="0 0 100 140" preserveAspectRatio="none">'
        + '<path d="M10 18 C 40 40, 60 70, 90 122 M 88 118 C 70 100, 40 90, 14 126"/>'
        + '<path d="M90 20 C 62 46, 44 80, 12 120 M 16 30 C 40 32, 66 28, 86 34"/></svg>');
      el.classList.add('fx-destroy');
      setTimeout(() => { el.remove(); res(); }, 1050);
    });
  },
};
