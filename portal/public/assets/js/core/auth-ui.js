// 登录 / 注册页共用的图标与密码显隐逻辑。
export const AUTH_ICONS = {
  user: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="3.6"/><path d="M4.8 20.4a7.2 7.2 0 0 1 14.4 0"/></svg>',
  ticket: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 9.5V6.8a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2v2.7a2.5 2.5 0 0 0 0 5v2.7a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2v-2.7a2.5 2.5 0 0 0 0-5z"/><path d="M9 8.5v7"/></svg>',
  lock: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10.5" width="14" height="9.5" rx="2.4"/><path d="M8.2 10.5V8a3.8 3.8 0 0 1 7.6 0v2.5"/><path d="M12 14.5v2"/></svg>',
  mail: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5.5" width="17" height="13" rx="2.4"/><path d="M4.5 7.5l7.5 5.5 7.5-5.5"/></svg>',
  eye: '<svg class="icon-eye" viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12s3.6-6 9.5-6 9.5 6 9.5 6-3.6 6-9.5 6-9.5-6-9.5-6z"/><circle cx="12" cy="12" r="2.6"/></svg>',
  eyeOff: '<svg class="icon-eye-off" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5l16 14"/><path d="M9.9 6.5A9.5 9.5 0 0 1 12 6c5.9 0 9.5 6 9.5 6a17 17 0 0 1-3 3.4"/><path d="M6.2 8.2A17.6 17.6 0 0 0 2.5 12s3.6 6 9.5 6a9.7 9.7 0 0 0 4.3-1"/></svg>',
  refresh: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.3-5.6"/><path d="M20 3.5V9h-5.5"/></svg>',
};

export function bindPasswordToggle(button, input) {
  if (!button || !input) return;
  button.addEventListener('click', () => {
    const visible = input.type === 'text';
    input.type = visible ? 'password' : 'text';
    button.classList.toggle('is-visible', !visible);
    button.setAttribute('aria-label', visible ? '显示密码' : '隐藏密码');
    input.focus();
  });
}
