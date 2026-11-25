(() => {
  'use strict';

  const $ = (sel) => document.querySelector(sel);
  const authShell = $('#authShell');
  const dashboard = $('#dashboard');
  const tabs = Array.from(document.querySelectorAll('.tab'));
  const indicator = $('#tabIndicator');
  const loginForm = $('#loginForm');
  const registerForm = $('#registerForm');
  const loginSubmit = $('#loginSubmit');
  const registerSubmit = $('#registerSubmit');
  const toastEl = $('#toast');

  let toastTimer = null;
  function toast(message, type = 'error') {
    clearTimeout(toastTimer);
    toastEl.textContent = message;
    toastEl.className = `toast show ${type}`;
    toastTimer = setTimeout(() => {
      toastEl.className = 'toast';
    }, 3200);
  }

  async function api(url, options = {}) {
    let res;
    try {
      res = await fetch(url, {
        ...options,
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          ...(options.headers || {}),
        },
      });
    } catch {
      throw new Error('网络连接失败，请检查服务是否运行');
    }
    let data = {};
    try {
      data = await res.json();
    } catch {
      /* 忽略非 JSON 响应 */
    }
    if (!res.ok) throw new Error(data.error || `请求失败（${res.status}）`);
    return data;
  }

  function moveIndicator() {
    const active = tabs.find((t) => t.classList.contains('active'));
    if (!active) return;
    indicator.style.width = `${active.offsetWidth}px`;
    indicator.style.transform = `translateX(${active.offsetLeft}px)`;
  }

  function setMode(mode) {
    const isLogin = mode === 'login';
    loginForm.classList.toggle('hidden', !isLogin);
    registerForm.classList.toggle('hidden', isLogin);
    tabs.forEach((tab) => {
      const active = tab.dataset.mode === mode;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', String(active));
    });
    requestAnimationFrame(moveIndicator);
  }

  function setLoading(button, loading) {
    button.disabled = loading;
    button.classList.toggle('loading', loading);
  }

  function showDashboard(user) {
    const name = user.displayName || user.username;
    $('#dashAvatar').textContent = name.trim().charAt(0).toUpperCase();
    $('#dashWelcome').textContent = `欢迎，${name}`;
    $('#infoUsername').textContent = user.username;
    $('#infoEmail').textContent = user.email;
    $('#infoId').textContent = `#${user.id}`;
    $('#infoCreated').textContent = String(user.createdAt || '').replace('T', ' ').slice(0, 19);
    authShell.classList.add('hidden');
    dashboard.classList.remove('hidden');
  }

  /* ---------- 事件绑定 ---------- */

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => setMode(tab.dataset.mode));
  });

  document.querySelectorAll('[data-goto]').forEach((btn) => {
    btn.addEventListener('click', () => setMode(btn.dataset.goto));
  });

  window.addEventListener('resize', moveIndicator);

  document.querySelectorAll('.eye-toggle').forEach((btn) => {
    btn.addEventListener('click', () => {
      const input = document.getElementById(btn.dataset.target);
      if (!input) return;
      input.type = input.type === 'password' ? 'text' : 'password';
    });
  });

  loginForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const account = $('#loginAccount').value.trim();
    const password = $('#loginPassword').value;
    if (!account || !password) return toast('请输入账号和密码');

    setLoading(loginSubmit, true);
    try {
      const data = await api('/api/login', {
        method: 'POST',
        body: JSON.stringify({ account, password }),
      });
      toast(data.message || '登录成功', 'success');
      $('#loginPassword').value = '';
      showDashboard(data.user);
    } catch (err) {
      toast(err.message);
    } finally {
      setLoading(loginSubmit, false);
    }
  });

  registerForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const username = $('#regUsername').value.trim();
    const email = $('#regEmail').value.trim();
    const password = $('#regPassword').value;
    const confirmPassword = $('#regConfirm').value;

    if (!/^[\w\u4e00-\u9fa5]{2,30}$/.test(username)) {
      return toast('用户名需为 2-30 位字母、数字、下划线或中文');
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return toast('请输入有效的邮箱地址');
    }
    if (password.length < 8) return toast('密码至少需要 8 位');
    if (password !== confirmPassword) return toast('两次输入的密码不一致');

    setLoading(registerSubmit, true);
    try {
      const data = await api('/api/register', {
        method: 'POST',
        body: JSON.stringify({ username, email, password }),
      });
      toast(data.message || '注册成功', 'success');
      registerForm.reset();
      showDashboard(data.user);
    } catch (err) {
      toast(err.message);
    } finally {
      setLoading(registerSubmit, false);
    }
  });

  $('#logoutBtn').addEventListener('click', async () => {
    try {
      await api('/api/logout', { method: 'POST' });
    } catch {
      /* 即使请求失败也回到登录页 */
    }
    dashboard.classList.add('hidden');
    authShell.classList.remove('hidden');
    $('#loginAccount').value = '';
    $('#loginPassword').value = '';
    setMode('login');
    toast('已退出登录', 'success');
  });

  /* 刷新后自动恢复登录态 */
  (async () => {
    setMode('login');
    try {
      const data = await api('/api/me');
      showDashboard(data.user);
    } catch {
      /* 未登录，保持登录页 */
    }
  })();
})();
