/* ============================================================
   Lipana TPS v2.0 — Dashboard Application
   Domain: tazama.lipana.co
   Features: JWT auth, RBAC, transaction testing, user management
   ============================================================ */

const App = (() => {
  // ── State ──────────────────────────────────────────────────
  let token = '';
  let userEmail = '';
  let userRole = '';
  let userFullName = '';
  let tenantId = 'DEFAULT';
  let baseUrl = '';
  let connected = false;
  let currentPage = 'overview';
  let resultsPage = 1;
  let alertsPage = 1;
  const resultsLimit = 20;
  let evalChart = null;
  let confirmCallback = null;
  let autoRefreshEnabled = false;
  let autoRefreshTimer = null;
  let clockTimer = null;
  let cachedPods = [];

  const pageTitles = {
    overview: 'Dashboard',
    pipeline: 'Pipeline Flow',
    results: 'Evaluation Results',
    alerts: 'Alert Investigation',
    transactions: 'Submit Transaction',
    txtest: 'Transaction Test',
    lookup: 'Lookup',
    pods: 'Pods & Services',
    nats: 'NATS Cluster',
    logs: 'Container Logs',
    deployments: 'Deployments',
    events: 'Cluster Events',
    settings: 'Settings',
    users: 'User Management',
    apikey: 'API Key Configuration',
    profile: 'My Profile',
  };

  // Pages restricted to admin role
  const ADMIN_PAGES = ['users', 'apikey', 'pods', 'nats', 'logs', 'deployments', 'events'];
  // Pages that require admin for destructive actions (read allowed for operators)
  const ADMIN_ACTIONS_PAGES = ['pods', 'nats', 'logs', 'deployments', 'events'];

  // Pipeline component definitions
  // Rules are matched dynamically via wildcard — new rules (rule-903, rule-904, etc.)
  // will be auto-discovered from running pods. Static components listed first.
  const PIPELINE_COMPONENTS_STATIC = [
    { key: 'channel-router', label: 'Channel Router', short: 'CRSP', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>', pattern: /channel-router/i },
    { key: 'transaction-monitoring', label: 'TMS', short: 'TMS', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>', pattern: /transaction-monitoring/i },
    { key: 'event-director', label: 'Event Director', short: 'ED', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>', pattern: /event-director/i },
    { key: 'typology-processor', label: 'Typology Processor', short: 'TP', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>', pattern: /typology-processor/i },
  ];

  // Dynamic rule icon (shared by all rule pods)
  const RULE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 6h16M4 12h16M4 18h10"/></svg>';

  function buildPipelineComponents(pods) {
    const components = [...PIPELINE_COMPONENTS_STATIC];
    // Auto-discover rule pods (rule-001 through rule-999)
    const rulePods = (pods || []).filter(p => /rule-\d{3}/i.test(p.name));
    const ruleIds = new Set();
    rulePods.forEach(p => {
      const m = p.name.match(/rule-(\d{3})/i);
      if (m) ruleIds.add(m[1]);
    });
    // Sort rule IDs numerically and add as components
    [...ruleIds].sort().forEach(id => {
      components.push({
        key: `rule-${id}`,
        label: `Rule ${id}`,
        short: `R${id}`,
        icon: RULE_ICON,
        pattern: new RegExp(`rule-${id}`, 'i'),
      });
    });
    return components;
  }

  // ── Helpers ────────────────────────────────────────────────
  const $ = id => document.getElementById(id);
  const qs = sel => document.querySelector(sel);
  const qsa = sel => document.querySelectorAll(sel);

  function isAdmin() { return userRole === 'admin'; }

  async function api(path, opts = {}) {
    const url = baseUrl + path;
    const headers = {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...opts.headers,
    };
    try {
      const res = await fetch(url, { ...opts, headers });
      if (res.status === 401) {
        showToast('Session expired — please log in again', 'error');
        setTimeout(logout, 1500);
        throw new Error('Session expired');
      }
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: res.statusText }));
        throw new Error(err.detail || res.statusText);
      }
      return await res.json();
    } catch (e) {
      if (e.message.includes('Failed to fetch')) throw new Error('Network error — server unreachable');
      throw e;
    }
  }

  /** Timed API call — returns { data, elapsed } */
  async function timedApi(path, opts = {}) {
    const start = performance.now();
    const data = await api(path, opts);
    const elapsed = Math.round(performance.now() - start);
    return { data, elapsed };
  }

  function escHtml(s) {
    if (s == null) return '';
    const d = document.createElement('div');
    d.textContent = String(s);
    return d.innerHTML;
  }

  function timeAgo(iso) {
    if (!iso) return '—';
    const diff = (Date.now() - new Date(iso).getTime()) / 1000;
    if (diff < 0) return 'just now';
    if (diff < 60) return `${Math.floor(diff)}s ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
  }

  function formatNs(ns) {
    if (!ns) return '—';
    const n = parseInt(ns, 10);
    if (isNaN(n)) return ns;
    if (n < 1000) return n + ' ns';
    if (n < 1e6) return (n / 1000).toFixed(1) + ' µs';
    if (n < 1e9) return (n / 1e6).toFixed(1) + ' ms';
    return (n / 1e9).toFixed(2) + ' s';
  }

  function countTypologies(typoResults) {
    if (!typoResults) return 0;
    if (Array.isArray(typoResults)) return typoResults.length;
    if (typeof typoResults === 'object') return Object.keys(typoResults).length;
    return 0;
  }

  // ── Clock ──────────────────────────────────────────────────
  function startClock() {
    function tick() {
      const now = new Date();
      const el = $('liveClock');
      if (el) el.textContent = now.toLocaleTimeString('en-US', { hour12: false });
    }
    tick();
    clockTimer = setInterval(tick, 1000);
  }

  // ── Init ───────────────────────────────────────────────────
  function init() {
    const saved = JSON.parse(
      localStorage.getItem('lipana_session') ||
      sessionStorage.getItem('lipana_session') || '{}'
    );
    token = saved.token || '';
    userEmail = saved.email || '';
    userRole = saved.role || '';
    userFullName = saved.fullName || '';
    baseUrl = saved.baseUrl || window.location.origin;

    startClock();

    if (token) {
      applyRoleUI();
      connect();
    } else {
      window.location.href = '/';
    }
  }

  // ── Role-Based UI ──────────────────────────────────────────
  function applyRoleUI() {
    // Update user display in sidebar
    const initials = userFullName
      ? userFullName.split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase()
      : userEmail.substring(0, 2).toUpperCase();

    $('userAvatar').textContent = initials;
    $('userName').textContent = userFullName || userEmail;
    $('userRole').textContent = userRole;
    $('userRole').style.color = isAdmin() ? 'var(--accent)' : 'var(--text-muted)';

    // Show/hide admin nav section
    const adminSection = $('navAdminSection');
    if (adminSection) {
      adminSection.style.display = isAdmin() ? '' : 'none';
    }

    // For operator role, hide destructive buttons on cluster pages
    if (!isAdmin()) {
      qsa('.admin-only').forEach(el => el.style.display = 'none');
    }
  }

  // ── Connection ─────────────────────────────────────────────
  async function connect() {
    try {
      const data = await api('/health');
      connected = true;
      $('statusDot').classList.add('connected');
      $('statusText').textContent = 'Connected';

      // Settings page
      $('cfgBaseUrl').textContent = baseUrl;
      $('cfgTenant').textContent = tenantId || 'DEFAULT';
      $('cfgConnStatus').textContent = 'Connected';
      $('cfgConnStatus').style.color = 'var(--success)';

      // DB status
      if (data.databases) {
        const dbHtml = Object.entries(data.databases).map(([k, v]) => {
          const ok = v === 'ok';
          return `<div class="config-field"><span class="config-field-label">${escHtml(k)}</span><span class="config-field-value" style="color:var(--${ok ? 'success' : 'danger'})">${ok ? 'Connected' : escHtml(v)}</span></div>`;
        }).join('');
        $('cfgDbStatus').innerHTML = dbHtml;
      }

      loadStats();
      loadClusterOverview();
      showToast(`Welcome, ${userFullName || userEmail}`, 'success');
    } catch (e) {
      connected = false;
      $('statusDot').classList.remove('connected');
      $('statusText').textContent = 'Error';
      showToast('Connection failed: ' + e.message, 'error');
    }
  }

  // ── Auto Refresh ───────────────────────────────────────────
  function toggleAutoRefresh() {
    autoRefreshEnabled = !autoRefreshEnabled;
    const btn = $('autoRefreshBtn');
    const label = $('autoRefreshLabel');
    const cfgEl = $('cfgAutoRefresh');

    if (autoRefreshEnabled) {
      btn.classList.add('active');
      label.textContent = '30s';
      if (cfgEl) cfgEl.textContent = '30s interval';
      autoRefreshTimer = setInterval(() => refreshCurrentPage(), 30000);
      showToast('Auto-refresh enabled (30s)', 'info');
    } else {
      btn.classList.remove('active');
      label.textContent = 'Auto';
      if (cfgEl) cfgEl.textContent = 'Off';
      clearInterval(autoRefreshTimer);
      autoRefreshTimer = null;
      showToast('Auto-refresh disabled', 'info');
    }
  }

  function refreshCurrentPage() {
    if (!connected) return;
    switch (currentPage) {
      case 'overview': loadStats(); loadClusterOverview(); break;
      case 'pipeline': loadPipelineStatus(); break;
      case 'results': loadResults(); break;
      case 'alerts': loadAlerts(); break;
      case 'pods': loadPods(); break;
      case 'nats': loadNats(); break;
      case 'deployments': loadDeployments(); break;
      case 'events': loadEvents(); break;
    }
  }

  // ── Stats ──────────────────────────────────────────────────
  async function loadStats() {
    if (!connected) return;
    try {
      const data = await api(`/api/v1/results/stats/summary?tenant_id=${encodeURIComponent(tenantId)}`);
      const evals = data.evaluations_total ?? 0;
      const alerts = data.alerts ?? 0;
      const noAlerts = data.no_alerts ?? 0;
      const txns = data.event_history_transactions ?? 0;

      $('statEvals').textContent = evals.toLocaleString();
      $('statTxns').textContent = txns.toLocaleString();
      $('statAlerts').textContent = alerts.toLocaleString();

      const alertBadge = $('alertBadge');
      if (alerts > 0) {
        alertBadge.textContent = alerts;
        alertBadge.style.display = '';
      } else {
        alertBadge.style.display = 'none';
      }

      updateChart(evals, alerts, noAlerts);
      loadRecentActivity();
    } catch (e) {
      console.warn('Stats load failed:', e);
    }
  }

  function updateChart(total, alerts, noAlerts) {
    const ctx = $('evalChart');
    if (!ctx) return;
    const errors = Math.max(0, total - alerts - noAlerts);
    const values = [alerts || 0, noAlerts || 0, errors || 0];

    if (evalChart) {
      evalChart.data.datasets[0].data = values;
      evalChart.update();
      return;
    }
    evalChart = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: ['Alerts (ALRT)', 'Clean (NALT)', 'Other'],
        datasets: [{
          data: values,
          backgroundColor: ['rgba(239,68,68,.8)', 'rgba(16,185,129,.8)', 'rgba(245,158,11,.8)'],
          borderColor: ['rgba(239,68,68,1)', 'rgba(16,185,129,1)', 'rgba(245,158,11,1)'],
          borderWidth: 1,
          hoverOffset: 6,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '65%',
        plugins: {
          legend: {
            position: 'bottom',
            labels: { color: '#94a3b8', padding: 16, usePointStyle: true, pointStyleWidth: 10, font: { size: 12 } },
          },
        },
      },
    });
  }

  // ── Recent Activity Feed ───────────────────────────────────
  async function loadRecentActivity() {
    if (!connected) return;
    try {
      const data = await api(`/api/v1/results?tenant_id=${encodeURIComponent(tenantId)}&page=1&per_page=8`);
      const results = data.results || [];

      if (!results.length) {
        $('activityFeed').innerHTML = '<div class="empty-state"><p>No recent evaluations</p></div>';
        return;
      }

      const html = results.map(r => {
        const isAlert = r.status === 'ALRT';
        const dotClass = isAlert ? 'alert' : 'safe';
        const label = isAlert ? 'ALERT' : 'Clean';
        const typoCount = countTypologies(r.typology_results);
        return `<div class="activity-item">
          <div class="activity-dot ${dotClass}"></div>
          <div>
            <div class="activity-text"><strong>${label}</strong> — ${escHtml(r.transaction_id || r.evaluation_id || 'Unknown')}</div>
            <div class="activity-time">${typoCount} typolog${typoCount === 1 ? 'y' : 'ies'} · ${r.evaluated_at ? timeAgo(r.evaluated_at) : '—'}</div>
          </div>
        </div>`;
      }).join('');
      $('activityFeed').innerHTML = html;
    } catch (e) {
      console.warn('Activity load failed:', e);
    }
  }

  // ── Results ────────────────────────────────────────────────
  async function loadResults() {
    if (!connected) return showToast('Not connected', 'error');
    try {
      const statusFilter = $('resultsStatusFilter')?.value || '';
      let url = `/api/v1/results?tenant_id=${encodeURIComponent(tenantId)}&page=${resultsPage}&per_page=${resultsLimit}`;
      if (statusFilter) url += `&status=${statusFilter}`;

      const data = await api(url);
      const results = data.results || [];
      const total = data.total ?? 0;

      const rows = results.map(r => {
        const isAlert = r.status === 'ALRT';
        const badgeClass = isAlert ? 'badge-alert' : 'badge-safe';
        const badgeLabel = isAlert ? 'ALERT' : 'CLEAN';
        const typoCount = countTypologies(r.typology_results);

        return `<tr>
          <td class="mono">${escHtml(r.transaction_id || '—')}</td>
          <td><span class="badge ${badgeClass}">${badgeLabel}</span></td>
          <td class="mono">${escHtml(r.evaluation_id || '—')}</td>
          <td>${typoCount}</td>
          <td class="mono">${formatNs(r.processing_time_ns)}</td>
          <td>${r.evaluated_at ? new Date(r.evaluated_at).toLocaleString() : '—'}</td>
          <td><button class="btn btn-xs btn-ghost" onclick="App.viewResultDetail('${escHtml(r.transaction_id || r.evaluation_id || '')}')">View</button></td>
        </tr>`;
      }).join('');

      $('resultsBody').innerHTML = rows || '<tr><td colspan="7"><div class="empty-state"><p>No results found</p></div></td></tr>';
      $('resultsInfo').textContent = `Page ${resultsPage} · ${total} total`;
    } catch (e) {
      showToast('Failed to load results: ' + e.message, 'error');
    }
  }

  function nextPage() { resultsPage++; loadResults(); }
  function prevPage() { if (resultsPage > 1) { resultsPage--; loadResults(); } }

  // ── Alerts ─────────────────────────────────────────────────
  async function loadAlerts() {
    if (!connected) return showToast('Not connected', 'error');
    try {
      const statsData = await api(`/api/v1/results/stats/summary?tenant_id=${encodeURIComponent(tenantId)}`);
      const alerts = statsData.alerts ?? 0;
      const noAlerts = statsData.no_alerts ?? 0;
      const total = statsData.evaluations_total ?? 0;
      const rate = total > 0 ? ((alerts / total) * 100).toFixed(1) + '%' : '0%';

      $('alertTotal').textContent = alerts.toLocaleString();
      $('alertClean').textContent = noAlerts.toLocaleString();
      $('alertRate').textContent = rate;

      let url = `/api/v1/results?tenant_id=${encodeURIComponent(tenantId)}&page=${alertsPage}&per_page=${resultsLimit}&status=ALRT`;
      const data = await api(url);
      const results = data.results || [];

      const rows = results.map(r => {
        const typoCount = countTypologies(r.typology_results);
        return `<tr>
          <td class="mono">${escHtml(r.transaction_id || '—')}</td>
          <td class="mono">${escHtml(r.evaluation_id || '—')}</td>
          <td>${typoCount}</td>
          <td class="mono">${formatNs(r.processing_time_ns)}</td>
          <td>${r.evaluated_at ? new Date(r.evaluated_at).toLocaleString() : '—'}</td>
          <td><button class="btn btn-xs btn-ghost" onclick="App.viewResultDetail('${escHtml(r.transaction_id || r.evaluation_id || '')}')">Investigate</button></td>
        </tr>`;
      }).join('');

      $('alertsBody').innerHTML = rows || '<tr><td colspan="6"><div class="empty-state"><p>No alerts found — all clean!</p></div></td></tr>';
      $('alertsInfo').textContent = `Page ${alertsPage} · ${data.total ?? alerts} alerts`;
    } catch (e) {
      showToast('Failed to load alerts: ' + e.message, 'error');
    }
  }

  function alertNextPage() { alertsPage++; loadAlerts(); }
  function alertPrevPage() { if (alertsPage > 1) { alertsPage--; loadAlerts(); } }

  // ── Transaction Submit ─────────────────────────────────────
  async function submitTransaction(e) {
    e.preventDefault();
    if (!connected) return showToast('Not connected', 'error');

    const btn = $('txSubmitBtn');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner" style="width:16px;height:16px;border-width:2px"></span> Submitting...';

    const payload = {
      debtor_member: $('txDebtor').value.trim(),
      creditor_member: $('txCreditor').value.trim(),
      amount: parseFloat($('txAmount').value),
      currency: $('txCurrency').value,
      status: $('txStatus').value,
    };

    const txTenant = $('txTenant')?.value?.trim();
    if (txTenant) payload.tenant_id = txTenant;

    try {
      const data = await api('/api/v1/transactions/evaluate', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      const el = $('txResult');
      el.innerHTML = formatSubmitResult(data);
      el.classList.add('show');
      showToast(
        data.success
          ? 'Transaction accepted — MsgId: ' + (data.msg_id || 'OK')
          : 'Transaction declined: ' + (data.message || 'Error'),
        data.success ? 'success' : 'warning'
      );
    } catch (e) {
      const el = $('txResult');
      el.innerHTML = `<div style="background:var(--danger-bg);border:1px solid rgba(239,68,68,.3);border-radius:10px;padding:16px">
        <div style="font-weight:600;color:var(--danger);margin-bottom:4px">Submission Failed</div>
        <div style="font-size:13px;color:var(--text-secondary)">${escHtml(e.message)}</div>
      </div>`;
      el.classList.add('show');
      showToast('Submit failed: ' + e.message, 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg> Send Transaction';
    }
  }

  function formatSubmitResult(data) {
    const ok = data.success;
    const statusColor = ok ? 'var(--success)' : 'var(--danger)';
    const statusBg = ok ? 'var(--success-bg)' : 'var(--danger-bg)';
    const statusBorder = ok ? 'rgba(16,185,129,.3)' : 'rgba(239,68,68,.3)';
    const statusLabel = ok ? 'ACCEPTED' : 'DECLINED';
    const statusIcon = ok
      ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>'
      : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';

    let html = `<div style="background:${statusBg};border:1px solid ${statusBorder};border-radius:10px;padding:16px;margin-bottom:12px">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
        <span style="color:${statusColor};display:flex">${statusIcon}</span>
        <span style="font-weight:700;font-size:15px;color:${statusColor}">${statusLabel}</span>
      </div>
      <div style="font-size:13px;color:var(--text-secondary)">${escHtml(data.message || '')}</div>
    </div>`;

    // ID cards row
    const ids = [
      { label: 'Message ID', value: data.msg_id },
      data.end_to_end_id ? { label: 'End-to-End ID', value: data.end_to_end_id } : null,
      data.pacs008_msg_id ? { label: 'pacs.008 ID', value: data.pacs008_msg_id } : null,
    ].filter(Boolean);
    if (ids.length) {
      html += `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">${ids.map(id =>
        `<div style="background:var(--bg-surface);border:1px solid var(--border);border-radius:8px;padding:10px 12px;flex:1;min-width:130px">
          <div style="font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:3px">${escHtml(id.label)}</div>
          <div style="font-size:12px;font-weight:600;font-family:JetBrains Mono,monospace;word-break:break-all">${escHtml(id.value || '—')}</div>
        </div>`).join('')}</div>`;
    }

    if (data.tms_response) {
      html += formatTmsResponse(data.tms_response);
    }

    // Collapsible raw JSON
    html += `<details style="margin-top:12px"><summary style="cursor:pointer;font-size:12px;color:var(--text-muted);user-select:none;padding:4px 0">View raw JSON</summary>
      <pre style="font-size:11px;margin-top:6px;background:var(--bg-surface);border:1px solid var(--border);border-radius:6px;padding:10px;overflow-x:auto;max-height:280px">${escHtml(JSON.stringify(data, null, 2))}</pre>
    </details>`;

    return html;
  }

  // ═══════════════════════════════════════════════════════════
  //  PREVIEW RAW PAYLOAD
  // ═══════════════════════════════════════════════════════════

  let _previewData = null;

  async function previewTransaction() {
    if (!connected) return showToast('Not connected', 'error');

    const btn = $('txPreviewBtn');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner" style="width:16px;height:16px;border-width:2px"></span> Loading...';

    const payload = {
      debtor_member: $('txDebtor').value.trim() || 'dfsp001',
      creditor_member: $('txCreditor').value.trim() || 'dfsp002',
      amount: parseFloat($('txAmount').value) || 100,
      currency: $('txCurrency').value,
      status: $('txStatus').value,
    };
    const txTenant = $('txTenant')?.value?.trim();
    if (txTenant) payload.tenant_id = txTenant;

    try {
      _previewData = await api('/api/v1/transactions/preview', {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      const container = $('txPreviewContainer');
      container.style.display = '';
      switchPreviewTab('008');
      showToast('Payload preview generated', 'info');
    } catch (e) {
      showToast('Preview failed: ' + e.message, 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg> Preview Payload';
    }
  }

  function switchPreviewTab(tab) {
    if (!_previewData) return;
    const el = $('txPreviewContent');
    const tab008 = $('previewTab008');
    const tab002 = $('previewTab002');

    // Active tab styling
    const activeStyle = 'font-size:12px;padding:4px 12px;background:var(--accent);color:#fff;border-color:var(--accent)';
    const inactiveStyle = 'font-size:12px;padding:4px 12px';

    if (tab === '008') {
      el.textContent = JSON.stringify(_previewData.pacs008, null, 2);
      tab008.setAttribute('style', activeStyle);
      tab002.setAttribute('style', inactiveStyle);
    } else {
      el.textContent = JSON.stringify(_previewData.pacs002, null, 2);
      tab008.setAttribute('style', inactiveStyle);
      tab002.setAttribute('style', activeStyle);
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  TRANSACTION TEST PAGE
  // ═══════════════════════════════════════════════════════════

  function toggleExitTestType() {
    const type = $('testExitType').value;
    $('testExitLookupField').style.display = type === 'lookup' ? '' : 'none';
  }

  async function testEntry(e) {
    e.preventDefault();
    if (!connected) return showToast('Not connected', 'error');

    const btn = $('testEntryBtn');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner" style="width:16px;height:16px;border-width:2px"></span> Testing...';

    const payload = {
      debtor_member: $('testEntryDebtor').value.trim(),
      creditor_member: $('testEntryCreditor').value.trim(),
      amount: parseFloat($('testEntryAmount').value),
      currency: $('testEntryCurrency').value,
      status: $('testEntryStatus').value,
    };

    try {
      const { data, elapsed } = await timedApi('/api/v1/transactions/evaluate', {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      showTestResult({
        title: 'Entry Test — POST /api/v1/transactions/evaluate',
        success: data.success,
        elapsed,
        data,
        summaryCards: [
          { label: 'Status', value: data.success ? 'ACCEPTED' : 'DECLINED', color: data.success ? 'success' : 'danger' },
          { label: 'Message ID', value: data.msg_id || '—', mono: true },
          ...(data.end_to_end_id ? [{ label: 'E2E ID', value: data.end_to_end_id, mono: true }] : []),
          { label: 'Response Time', value: elapsed + 'ms', color: elapsed < 1000 ? 'success' : elapsed < 3000 ? 'warning' : 'danger' },
          { label: 'Pipeline Message', value: data.message || '—' },
        ],
        formattedHtml: data.tms_response ? formatTmsResponse(data.tms_response) : '',
      });

      // Auto-fill the Message ID in exit test for convenience
      if (data.msg_id) {
        $('testExitMsgId').value = data.msg_id;
      }

      showToast(`Entry test complete (${elapsed}ms)`, data.success ? 'success' : 'warning');
    } catch (e) {
      showTestResult({
        title: 'Entry Test — POST /api/v1/transactions/evaluate',
        success: false,
        elapsed: 0,
        data: { error: e.message },
        summaryCards: [
          { label: 'Status', value: 'ERROR', color: 'danger' },
          { label: 'Error', value: e.message },
        ],
      });
      showToast('Entry test failed: ' + e.message, 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg> Run Entry Test';
    }
  }

  async function testExit() {
    if (!connected) return showToast('Not connected', 'error');

    const type = $('testExitType').value;
    const exitTenant = $('testExitTenant')?.value?.trim() || tenantId;
    const btn = $('testExitBtn');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner" style="width:16px;height:16px;border-width:2px"></span> Testing...';

    try {
      let result, title;

      if (type === 'lookup') {
        const msgId = $('testExitMsgId').value.trim();
        if (!msgId) { showToast('Enter a Message ID', 'warning'); return; }
        title = `Exit Test — GET /api/v1/results/${msgId}`;
        result = await timedApi(`/api/v1/results/${encodeURIComponent(msgId)}?tenant_id=${encodeURIComponent(exitTenant)}&wait=true`);

        const evalData = result.data.evaluation || {};
        const report = evalData.report || {};
        showTestResult({
          title,
          success: true,
          elapsed: result.elapsed,
          data: result.data,
          summaryCards: [
            { label: 'Status', value: report.status || '—', color: report.status === 'ALRT' ? 'danger' : 'success' },
            { label: 'Message ID', value: result.data.msg_id || msgId, mono: true },
            { label: 'Response Time', value: result.elapsed + 'ms', color: result.elapsed < 500 ? 'success' : 'warning' },
            { label: 'Tenant', value: result.data.tenant_id || exitTenant },
          ],
          formattedHtml: formatEvaluationResult(result.data),
        });

      } else if (type === 'stats') {
        title = 'Exit Test — GET /api/v1/results/stats/summary';
        result = await timedApi(`/api/v1/results/stats/summary?tenant_id=${encodeURIComponent(exitTenant)}`);

        const d = result.data;
        const alertRate = d.evaluations_total > 0
          ? ((d.alerts / d.evaluations_total) * 100).toFixed(1) + '%' : '0%';

        showTestResult({
          title,
          success: true,
          elapsed: result.elapsed,
          data: result.data,
          summaryCards: [
            { label: 'Total Evaluations', value: (d.evaluations_total ?? 0).toLocaleString() },
            { label: 'Alerts', value: (d.alerts ?? 0).toLocaleString(), color: d.alerts > 0 ? 'danger' : 'success' },
            { label: 'Clean', value: (d.no_alerts ?? 0).toLocaleString(), color: 'success' },
            { label: 'Alert Rate', value: alertRate, color: parseFloat(alertRate) > 10 ? 'danger' : 'success' },
            { label: 'Transactions', value: (d.event_history_transactions ?? 0).toLocaleString() },
            { label: 'Response Time', value: result.elapsed + 'ms' },
          ],
        });

      } else {
        title = 'Exit Test — GET /api/v1/results';
        result = await timedApi(`/api/v1/results?tenant_id=${encodeURIComponent(exitTenant)}&page=1&per_page=5`);

        const d = result.data;
        showTestResult({
          title,
          success: true,
          elapsed: result.elapsed,
          data: result.data,
          summaryCards: [
            { label: 'Total Results', value: (d.total ?? 0).toLocaleString() },
            { label: 'Page', value: `${d.page}/${Math.ceil((d.total || 1) / (d.per_page || 20))}` },
            { label: 'Returned', value: (d.results?.length ?? 0) + ' results' },
            { label: 'Response Time', value: result.elapsed + 'ms' },
          ],
          formattedHtml: formatResultsList(d.results || []),
        });
      }

      showToast(`Exit test complete (${result.elapsed}ms)`, 'success');
    } catch (e) {
      showTestResult({
        title: 'Exit Test',
        success: false,
        elapsed: 0,
        data: { error: e.message },
        summaryCards: [
          { label: 'Status', value: 'ERROR', color: 'danger' },
          { label: 'Error', value: e.message },
        ],
      });
      showToast('Exit test failed: ' + e.message, 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg> Run Exit Test';
    }
  }

  function showTestResult({ title, success, elapsed, data, summaryCards = [], formattedHtml = '' }) {
    $('testResultPanel').style.display = '';
    $('testResultTitle').textContent = title;

    const statusEl = $('testResultStatus');
    statusEl.textContent = success ? 'SUCCESS' : 'FAILED';
    statusEl.className = `badge ${success ? 'badge-safe' : 'badge-alert'}`;

    $('testResultTime').textContent = elapsed ? `${elapsed}ms` : '';

    // Summary cards
    if (summaryCards.length) {
      const cardsHtml = summaryCards.map(c => {
        const color = c.color ? `var(--${c.color})` : 'var(--text)';
        return `<div style="background:var(--bg-surface);border:1px solid var(--border);border-radius:10px;padding:14px 16px;min-width:140px;flex:1">
          <div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px">${escHtml(c.label)}</div>
          <div style="font-size:16px;font-weight:600;color:${color};${c.mono ? 'font-family:JetBrains Mono,monospace;font-size:12px;word-break:break-all' : ''}">${escHtml(c.value)}</div>
        </div>`;
      }).join('');
      $('testResultSummary').innerHTML = `<div style="display:flex;gap:12px;flex-wrap:wrap">${cardsHtml}</div>`;
    } else {
      $('testResultSummary').innerHTML = '';
    }

    $('testResultFormatted').innerHTML = formattedHtml;
    $('testResultRaw').textContent = JSON.stringify(data, null, 2);

    // Scroll to result
    $('testResultPanel').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function formatTmsResponse(tmsResp) {
    if (!tmsResp || typeof tmsResp !== 'object') return '';
    if (tmsResp.error) {
      const stepInfo = tmsResp.step ? ` at ${tmsResp.step}` : '';
      const statusCode = tmsResp.status_code ? ` HTTP ${tmsResp.status_code}` : '';
      return `<div style="background:var(--danger-bg);border:1px solid rgba(239,68,68,.3);border-radius:8px;padding:12px 14px">
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--danger)" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
          <span style="font-weight:600;color:var(--danger);font-size:13px">Pipeline Error${stepInfo}${statusCode}</span>
        </div>
        <div style="font-size:12px;color:var(--text-secondary)">${escHtml(typeof tmsResp.error === 'string' ? tmsResp.error : JSON.stringify(tmsResp.error))}</div>
      </div>`;
    }
    return `<div style="background:var(--success-bg);border:1px solid rgba(16,185,129,.3);border-radius:8px;padding:12px 14px">
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--success)" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
        <span style="font-weight:600;color:var(--success);font-size:13px">Pipeline Accepted</span>
      </div>
      <div style="font-size:12px;color:var(--text-secondary)">${escHtml(tmsResp.message || 'Transaction submitted for fraud evaluation')}</div>
    </div>`;
  }

  /**
   * Format a full evaluation result with rule scores, typology breakdown,
   * and thresholds. Designed to support any number of rules/typologies.
   */
  function formatEvaluationResult(data) {
    if (!data || !data.evaluation) return '';
    const ev = data.evaluation;
    const report = ev.report || {};
    const isAlert = report.status === 'ALRT';
    const statusText = isAlert ? 'ALERT' : report.status === 'NALT' ? 'NO ALERT' : (report.status || 'UNKNOWN');
    const tadp = report.tadpResult || {};
    const typos = tadp.typologyResult || [];
    const procTime = tadp.prcgTm ? formatNs(tadp.prcgTm) : null;

    // Header banner
    let html = `<div style="background:${isAlert ? 'var(--danger-bg)' : 'var(--success-bg)'};border:1px solid ${isAlert ? 'rgba(239,68,68,.3)' : 'rgba(16,185,129,.3)'};border-radius:8px;padding:14px 16px;margin-bottom:12px">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
        ${isAlert
          ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--danger)" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>'
          : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--success)" stroke-width="2"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>'}
        <span style="font-weight:700;font-size:14px;color:var(--${isAlert ? 'danger' : 'success'})">${statusText}</span>
        ${procTime ? `<span style="margin-left:auto;font-size:11px;color:var(--text-muted)">Processed in ${procTime}</span>` : ''}
      </div>
      <div style="font-size:12px;color:var(--text-secondary)">
        ${isAlert ? 'Suspicious activity detected — transaction flagged for review' : 'No suspicious patterns detected — transaction is clean'}
      </div>
    </div>`;

    // Evaluation metadata
    const metaItems = [
      report.evaluationID ? ['Evaluation ID', report.evaluationID] : null,
      ev.transactionID ? ['Transaction ID', ev.transactionID] : null,
      report.timestamp ? ['Evaluated At', new Date(report.timestamp).toLocaleString()] : null,
    ].filter(Boolean);
    if (metaItems.length) {
      html += `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">${metaItems.map(([label, val]) =>
        `<div style="background:var(--bg-surface);border:1px solid var(--border);border-radius:6px;padding:8px 10px;flex:1;min-width:120px">
          <div style="font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.4px;margin-bottom:2px">${escHtml(label)}</div>
          <div style="font-size:11px;font-weight:600;font-family:JetBrains Mono,monospace;word-break:break-all">${escHtml(val)}</div>
        </div>`).join('')}</div>`;
    }

    // Typology + Rule breakdown
    if (typos.length) {
      html += `<div style="font-size:13px;font-weight:600;color:var(--text);margin-bottom:8px">
        <span>Typology Results</span>
        <span style="font-weight:400;color:var(--text-muted);font-size:12px;margin-left:6px">${typos.length} typolog${typos.length === 1 ? 'y' : 'ies'} evaluated</span>
      </div>`;

      typos.forEach((t, i) => {
        const typoCfg = t.cfg || `Typology ${i + 1}`;
        const typoScore = t.result ?? 0;
        const typoId = t.id || '';
        const workflow = t.workflow || {};
        const alertThreshold = workflow.alertThreshold;
        const interdictionThreshold = workflow.interdictionThreshold;
        const ruleResults = t.ruleResults || [];
        const scoreNum = parseFloat(typoScore);
        const isTypoAlert = alertThreshold != null ? scoreNum >= alertThreshold : scoreNum > 0;

        // Typology header
        html += `<div style="background:var(--bg-surface);border:1px solid var(--border);border-radius:8px;margin-bottom:8px;overflow:hidden">
          <div style="padding:12px 14px;display:flex;align-items:center;gap:10px;border-bottom:1px solid var(--border)">
            <div style="width:8px;height:8px;border-radius:50%;background:var(--${isTypoAlert ? 'danger' : 'success'});flex-shrink:0"></div>
            <div style="flex:1;min-width:0">
              <div style="font-size:13px;font-weight:600;color:var(--text)">${escHtml(typoCfg)}</div>
              ${typoId ? `<div style="font-size:11px;color:var(--text-muted);font-family:JetBrains Mono,monospace">${escHtml(typoId)}</div>` : ''}
            </div>
            <div style="text-align:right;flex-shrink:0">
              <div style="font-size:18px;font-weight:700;color:var(--${isTypoAlert ? 'danger' : 'success'})">${escHtml(String(typoScore))}</div>
              ${alertThreshold != null ? `<div style="font-size:10px;color:var(--text-muted)">threshold: ${alertThreshold}${interdictionThreshold != null ? ' / ' + interdictionThreshold : ''}</div>` : ''}
            </div>
          </div>`;

        // Rule results table  
        if (ruleResults.length) {
          html += `<div style="padding:8px 14px">
            <table style="width:100%;border-collapse:collapse;font-size:12px">
              <thead><tr style="color:var(--text-muted);text-align:left;border-bottom:1px solid var(--border)">
                <th style="padding:4px 8px 4px 0;font-weight:500">Rule</th>
                <th style="padding:4px 8px;font-weight:500">Sub-rule</th>
                <th style="padding:4px 8px;font-weight:500">Reason</th>
                <th style="padding:4px 0 4px 8px;font-weight:500;text-align:right">Weight</th>
              </tr></thead>
              <tbody>`;
          ruleResults.forEach(r => {
            const ruleId = r.id || r.cfg || '—';
            const ruleCfg = r.cfg || '';
            const subRef = r.subRuleRef || r.ref || '—';
            const reason = r.reason || '—';
            const wght = r.result ?? r.wght ?? '—';
            const wghtNum = parseFloat(wght);
            const wghtColor = isNaN(wghtNum) ? 'var(--text)' : wghtNum > 0 ? 'var(--danger)' : 'var(--success)';
            html += `<tr style="border-bottom:1px solid var(--border)">
              <td style="padding:6px 8px 6px 0;font-family:JetBrains Mono,monospace;color:var(--text)">${escHtml(ruleId)}${ruleCfg && ruleCfg !== ruleId ? ` <span style="color:var(--text-muted)">${escHtml(ruleCfg)}</span>` : ''}</td>
              <td style="padding:6px 8px;font-family:JetBrains Mono,monospace;color:var(--text-muted)">${escHtml(subRef)}</td>
              <td style="padding:6px 8px;color:var(--text-secondary)">${escHtml(reason)}</td>
              <td style="padding:6px 0 6px 8px;text-align:right;font-weight:600;font-family:JetBrains Mono,monospace;color:${wghtColor}">${escHtml(String(wght))}</td>
            </tr>`;
          });
          html += `</tbody></table></div>`;
        }
        html += `</div>`;
      });
    }

    return html;
  }

  function formatResultsList(results) {
    if (!results.length) return '<div style="color:var(--text-muted);font-size:13px">No results returned</div>';
    return `<div class="table-wrap" style="margin-top:8px"><table class="data-table">
      <thead><tr><th>Transaction ID</th><th>Status</th><th>Typologies</th><th>Processing Time</th><th>Evaluated At</th></tr></thead>
      <tbody>${results.map(r => {
        const isAlert = r.status === 'ALRT';
        return `<tr>
          <td class="mono" style="font-size:12px">${escHtml(r.transaction_id || '—')}</td>
          <td><span class="badge ${isAlert ? 'badge-alert' : 'badge-safe'}">${isAlert ? 'ALERT' : 'CLEAN'}</span></td>
          <td>${countTypologies(r.typology_results)}</td>
          <td class="mono">${formatNs(r.processing_time_ns)}</td>
          <td>${r.evaluated_at ? new Date(r.evaluated_at).toLocaleString() : '—'}</td>
        </tr>`;
      }).join('')}</tbody>
    </table></div>`;
  }

  // ═══════════════════════════════════════════════════════════
  //  USER MANAGEMENT (Admin Only)
  // ═══════════════════════════════════════════════════════════

  async function loadUsers() {
    if (!isAdmin()) return;
    try {
      const data = await api('/api/v1/auth/users');
      const users = data.users || [];

      const rows = users.map(u => {
        const roleClass = u.role === 'admin' ? 'badge-alert' : 'badge-safe';
        const statusClass = u.is_active !== false ? 'badge-safe' : 'badge-neutral';
        return `<tr>
          <td class="mono">${escHtml(u.email)}</td>
          <td>${escHtml(u.full_name || '—')}</td>
          <td><span class="badge ${roleClass}">${escHtml(u.role)}</span></td>
          <td><span class="badge ${statusClass}">${u.is_active !== false ? 'Active' : 'Disabled'}</span></td>
          <td>${u.created_at ? new Date(u.created_at).toLocaleDateString() : '—'}</td>
          <td>
            <div style="display:flex;gap:4px">
              <button class="btn btn-xs btn-ghost" onclick="App.toggleUserRole('${escHtml(u.email)}', '${u.role === 'admin' ? 'operator' : 'admin'}')" title="Toggle role">${u.role === 'admin' ? 'Demote' : 'Promote'}</button>
              <button class="btn btn-xs btn-ghost" onclick="App.toggleUserActive('${escHtml(u.email)}', ${u.is_active === false ? 'true' : 'false'})" title="Toggle status">${u.is_active !== false ? 'Disable' : 'Enable'}</button>
              <button class="btn btn-xs btn-danger" onclick="App.deleteUserConfirm('${escHtml(u.email)}')">Delete</button>
            </div>
          </td>
        </tr>`;
      }).join('');

      $('usersTableBody').innerHTML = rows || '<tr><td colspan="6"><div class="empty-state"><p>No users found</p></div></td></tr>';
    } catch (e) {
      showToast('Failed to load users: ' + e.message, 'error');
    }
  }

  function showAddUserModal() {
    $('addUserModal').classList.add('show');
    $('newUserEmail').value = '';
    $('newUserName').value = '';
    $('newUserPassword').value = '';
    $('newUserRole').value = 'operator';
  }

  function closeAddUserModal() {
    $('addUserModal').classList.remove('show');
  }

  async function createUser(e) {
    e.preventDefault();
    try {
      await api('/api/v1/auth/users', {
        method: 'POST',
        body: JSON.stringify({
          email: $('newUserEmail').value.trim(),
          full_name: $('newUserName').value.trim(),
          password: $('newUserPassword').value,
          role: $('newUserRole').value,
        }),
      });
      closeAddUserModal();
      showToast('User created successfully', 'success');
      loadUsers();
    } catch (e) {
      showToast('Failed to create user: ' + e.message, 'error');
    }
  }

  async function toggleUserRole(email, newRole) {
    try {
      await api(`/api/v1/auth/users/${encodeURIComponent(email)}`, {
        method: 'PUT',
        body: JSON.stringify({ role: newRole }),
      });
      showToast(`User ${email} role changed to ${newRole}`, 'success');
      loadUsers();
    } catch (e) {
      showToast('Failed: ' + e.message, 'error');
    }
  }

  async function toggleUserActive(email, active) {
    try {
      await api(`/api/v1/auth/users/${encodeURIComponent(email)}`, {
        method: 'PUT',
        body: JSON.stringify({ is_active: active }),
      });
      showToast(`User ${email} ${active ? 'enabled' : 'disabled'}`, 'success');
      loadUsers();
    } catch (e) {
      showToast('Failed: ' + e.message, 'error');
    }
  }

  function deleteUserConfirm(email) {
    showConfirm('Delete User', `Permanently delete user "${email}"? This cannot be undone.`, () => deleteUser(email));
  }

  async function deleteUser(email) {
    try {
      await api(`/api/v1/auth/users/${encodeURIComponent(email)}`, { method: 'DELETE' });
      showToast(`User ${email} deleted`, 'success');
      loadUsers();
    } catch (e) {
      showToast('Failed: ' + e.message, 'error');
    }
  }

  // ── API Key Management (Admin) ─────────────────────────────
  async function loadApiKeyStatus() {
    if (!isAdmin()) return;
    try {
      const data = await api('/api/v1/auth/api-key/status');
      const statusEl = $('apiKeyStatusText');
      if (data.configured) {
        statusEl.textContent = `API key configured (${data.key_preview})`;
        statusEl.style.color = 'var(--success)';
      } else {
        statusEl.textContent = 'No API key configured — transactions will fail';
        statusEl.style.color = 'var(--warning)';
      }
    } catch (e) {
      console.warn('API key status check failed:', e);
    }
  }

  async function saveApiKey() {
    const key = $('adminApiKeyInput').value.trim();
    if (!key) return showToast('Enter an API key', 'warning');

    try {
      await api('/api/v1/auth/api-key', {
        method: 'POST',
        body: JSON.stringify({ api_key: key }),
      });
      showToast('API key saved successfully', 'success');
      $('adminApiKeyInput').value = '';
      loadApiKeyStatus();
    } catch (e) {
      showToast('Failed to save API key: ' + e.message, 'error');
    }
  }

  // ── Change Password ────────────────────────────────────────
  async function changePassword() {
    const current = $('currentPassword').value;
    const newPass = $('newPassword').value;
    const confirm = $('confirmPassword').value;

    if (!newPass || newPass.length < 6) return showToast('Password must be at least 6 characters', 'warning');
    if (newPass.length > 128) return showToast('Password too long (max 128 characters)', 'warning');
    if (newPass !== confirm) return showToast('Passwords do not match', 'warning');

    try {
      await api('/api/v1/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ current_password: current, new_password: newPass }),
      });
      showToast('Password changed successfully', 'success');
      $('currentPassword').value = '';
      $('newPassword').value = '';
      $('confirmPassword').value = '';
    } catch (e) {
      showToast('Failed: ' + e.message, 'error');
    }
  }

  // ── Lookup ─────────────────────────────────────────────────
  async function lookupById() {
    const id = $('lookupId').value.trim();
    if (!id) return showToast('Enter a Message ID', 'warning');
    if (!connected) return showToast('Not connected', 'error');

    const el = $('lookupResult');
    el.innerHTML = '<div style="display:flex;align-items:center;gap:8px;color:var(--text-muted);font-size:13px"><span class="spinner" style="width:16px;height:16px;border-width:2px"></span> Looking up evaluation (pipeline may still be processing)…</div>';
    el.classList.add('show');

    try {
      const data = await api(`/api/v1/results/${encodeURIComponent(id)}?tenant_id=${encodeURIComponent(tenantId)}&wait=true`);
      let html = formatEvaluationResult(data);
      html += `<details style="margin-top:12px"><summary style="cursor:pointer;font-size:12px;color:var(--text-muted);user-select:none;padding:4px 0">View raw JSON</summary>
        <pre style="font-size:11px;margin-top:6px;background:var(--bg-surface);border:1px solid var(--border);border-radius:6px;padding:10px;overflow-x:auto;max-height:400px">${escHtml(JSON.stringify(data, null, 2))}</pre>
      </details>`;
      el.innerHTML = html;
    } catch (e) {
      el.innerHTML = `<div style="color:var(--danger);font-size:13px">Lookup failed: ${escHtml(e.message)}</div>`;
      showToast('Lookup failed: ' + e.message, 'error');
    }
  }

  // ── Detail Modal ───────────────────────────────────────────
  async function viewResultDetail(msgId) {
    if (!connected || !msgId) return;
    try {
      const data = await api(`/api/v1/results/${encodeURIComponent(msgId)}?tenant_id=${encodeURIComponent(tenantId)}`);
      $('modalTitle').textContent = 'Evaluation: ' + msgId;
      let html = formatEvaluationResult(data);
      html += `<details style="margin-top:12px"><summary style="cursor:pointer;font-size:12px;color:var(--text-muted);user-select:none;padding:4px 0">View raw JSON</summary>
        <pre style="font-size:11px;margin-top:6px;overflow-x:auto;max-height:400px">${escHtml(JSON.stringify(data, null, 2))}</pre>
      </details>`;
      $('modalBody').innerHTML = html;
      $('detailModal').classList.add('show');
    } catch (e) {
      showToast('Detail load failed: ' + e.message, 'error');
    }
  }

  function closeModal() { $('detailModal').classList.remove('show'); }

  // ── Confirm Modal ──────────────────────────────────────────
  function showConfirm(title, message, callback) {
    $('confirmTitle').textContent = title;
    $('confirmMessage').textContent = message;
    confirmCallback = callback;
    $('confirmModal').classList.add('show');
  }
  function closeConfirm() { $('confirmModal').classList.remove('show'); confirmCallback = null; }
  function execConfirm() { if (confirmCallback) confirmCallback(); closeConfirm(); }

  // ═══════════════════════════════════════════════════════════
  //  PIPELINE FLOW
  // ═══════════════════════════════════════════════════════════

  async function loadPipelineStatus() {
    if (!connected) return;
    try {
      const data = await api('/api/v1/system/pods');
      cachedPods = data.pods || [];

      const components = buildPipelineComponents(cachedPods).map(comp => {
        const pod = cachedPods.find(p => comp.pattern.test(p.name));
        let status = 'unknown', statusLabel = 'Not Found';
        if (pod) {
          const phase = (pod.status || '').toLowerCase();
          if (phase === 'running') {
            status = 'healthy'; statusLabel = 'Running';
          } else if (phase === 'pending') {
            status = 'unhealthy'; statusLabel = 'Pending';
          } else {
            status = 'unhealthy'; statusLabel = pod.status || 'Error';
          }
        }
        return { ...comp, status, statusLabel, pod };
      });

      const connector = `<div class="pipeline-connector"><svg viewBox="0 0 40 20"><line class="arrow-line" x1="0" y1="10" x2="34" y2="10"/><polygon class="arrow-head" points="34,5 40,10 34,15"/></svg></div>`;

      const flowHtml = components.map((c, i) => {
        const node = `<div class="pipeline-node ${c.status}" onclick="App.viewPipelineComponent('${c.key}')" title="${c.label}">
          <div class="node-icon">${c.icon}</div>
          <div class="node-name">${c.short}</div>
          <div class="node-status"><span class="status-indicator"></span>${c.statusLabel}</div>
        </div>`;
        return i < components.length - 1 ? node + connector : node;
      }).join('');

      $('pipelineFlow').innerHTML = flowHtml;

      const tableHtml = components.map(c => {
        const p = c.pod;
        const badgeClass = c.status === 'healthy' ? 'badge-safe' : c.status === 'unhealthy' ? 'badge-alert' : 'badge-neutral';
        return `<tr>
          <td><strong>${escHtml(c.label)}</strong></td>
          <td class="mono">${p ? escHtml(p.name) : '—'}</td>
          <td><span class="badge ${badgeClass}">${escHtml(c.statusLabel)}</span></td>
          <td>${p ? escHtml(p.ready) : '—'}</td>
          <td>${p ? p.restarts : '—'}</td>
          <td>${p ? timeAgo(p.created) : '—'}</td>
          <td>${p ? `<button class="btn btn-xs btn-ghost" onclick="App.viewPodLogs('${escHtml(p.name)}')">Logs</button>` : '—'}</td>
        </tr>`;
      }).join('');
      $('pipelineTable').innerHTML = tableHtml;

      const healthy = components.filter(c => c.status === 'healthy').length;
      const pct = Math.round((healthy / components.length) * 100);
      updateHealthBar(pct);
    } catch (e) {
      $('pipelineFlow').innerHTML = `<div class="empty-state"><p>Failed to load pipeline: ${escHtml(e.message)}</p></div>`;
    }
  }

  function updateHealthBar(pct) {
    [$('pipelineHealthFill'), $('pipelineHealthFill2')].forEach(el => {
      if (!el) return;
      el.style.width = pct + '%';
      el.className = 'health-bar-fill' + (pct < 50 ? ' danger' : pct < 80 ? ' warning' : '');
    });
    [$('pipelineHealthPct'), $('pipelineHealthPct2')].forEach(el => { if (el) el.textContent = pct + '%'; });
  }

  function viewPipelineComponent(key) {
    const comp = buildPipelineComponents(cachedPods).find(c => c.key === key);
    if (!comp) return;
    const pod = cachedPods.find(p => comp.pattern.test(p.name));
    if (pod) {
      $('modalTitle').textContent = comp.label + ' — Pod Detail';
      $('modalBody').textContent = JSON.stringify(pod, null, 2);
      $('detailModal').classList.add('show');
    } else {
      showToast(comp.label + ' pod not found', 'warning');
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  CLUSTER MANAGEMENT
  // ═══════════════════════════════════════════════════════════

  async function loadClusterOverview() {
    if (!connected) return;
    try {
      const data = await api('/api/v1/system/overview');
      const running = data.pods?.running ?? 0;
      const total = data.pods?.total ?? 0;

      $('statPods').textContent = `${running}/${total}`;
      $('csTotalPods').textContent = total;
      $('csRunning').textContent = running;
      $('csPending').textContent = data.pods?.pending ?? 0;
      $('csFailed').textContent = data.pods?.failed ?? 0;
      $('csRestarts').textContent = data.pods?.total_restarts ?? 0;
      $('csServices').textContent = data.services?.total ?? 0;
      $('cfgPodCount').textContent = total;
      $('cfgDeployCount').textContent = data.deployments?.total ?? 0;

      const pct = Math.round((running / Math.max(total, 1)) * 100);
      updateHealthBar(pct);
    } catch (e) {
      console.warn('Cluster overview failed:', e);
    }
  }

  // ── Pods ───────────────────────────────────────────────────
  async function loadPods() {
    if (!connected) return showToast('Not connected', 'error');
    $('podsGrid').innerHTML = '<div class="skeleton skeleton-card"></div>'.repeat(4);
    try {
      const data = await api('/api/v1/system/pods');
      cachedPods = data.pods || [];
      loadClusterOverview();
      updatePodSelector(cachedPods);

      if (!cachedPods.length) {
        $('podsGrid').innerHTML = '<div class="empty-state"><p>No pods found</p></div>';
        return;
      }

      const html = cachedPods.map(p => {
        const status = (p.status || '').toLowerCase();
        const statusClass = status === 'running' ? 'pod-running' : status === 'pending' ? 'pod-pending' : status === 'failed' ? 'pod-failed' : '';
        const statusColor = status === 'running' ? 'var(--success)' : status === 'pending' ? 'var(--warning)' : status === 'failed' ? 'var(--danger)' : 'var(--text-muted)';
        const age = timeAgo(p.created);
        const restartBtn = isAdmin()
          ? `<button class="btn btn-xs btn-danger" onclick="App.confirmRestartPod('${escHtml(p.name)}')">Restart</button>`
          : '';

        return `<div class="pod-card ${statusClass}">
          <div class="pod-card-header">
            <div class="pod-card-title">${escHtml(p.name)}</div>
            <div class="pod-card-status" style="color:${statusColor}">
              <span class="pod-status-indicator"></span>
              ${escHtml(p.status)}
            </div>
          </div>
          <div class="pod-card-meta">
            <div class="pod-meta-item"><span class="pod-meta-label">Ready</span><span class="pod-meta-value">${escHtml(p.ready)}</span></div>
            <div class="pod-meta-item"><span class="pod-meta-label">Restarts</span><span class="pod-meta-value">${p.restarts}</span></div>
            <div class="pod-meta-item"><span class="pod-meta-label">IP</span><span class="pod-meta-value">${escHtml(p.ip || '—')}</span></div>
            <div class="pod-meta-item"><span class="pod-meta-label">Age</span><span class="pod-meta-value">${age}</span></div>
          </div>
          <div class="pod-card-actions">
            <button class="btn btn-xs btn-ghost" onclick="App.viewPodLogs('${escHtml(p.name)}')">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>
              Logs
            </button>
            <button class="btn btn-xs btn-ghost" onclick="App.viewPodDetail('${escHtml(p.name)}')">Detail</button>
            ${restartBtn}
          </div>
        </div>`;
      }).join('');

      $('podsGrid').innerHTML = html;
    } catch (e) {
      $('podsGrid').innerHTML = `<div class="empty-state"><p>Failed to load pods: ${escHtml(e.message)}</p></div>`;
    }
  }

  function updatePodSelector(pods) {
    const sel = $('logPodSelect');
    if (!sel) return;
    const current = sel.value;
    sel.innerHTML = '<option value="">Select a pod...</option>' +
      pods.map(p => `<option value="${escHtml(p.name)}" ${p.name === current ? 'selected' : ''}>${escHtml(p.name)}</option>`).join('');
  }

  async function viewPodDetail(name) {
    const pod = cachedPods.find(p => p.name === name);
    if (pod) {
      $('modalTitle').textContent = 'Pod: ' + name;
      $('modalBody').textContent = JSON.stringify(pod, null, 2);
      $('detailModal').classList.add('show');
    } else {
      try {
        const data = await api('/api/v1/system/pods');
        const found = (data.pods || []).find(p => p.name === name);
        if (!found) return showToast('Pod not found', 'error');
        $('modalTitle').textContent = 'Pod: ' + name;
        $('modalBody').textContent = JSON.stringify(found, null, 2);
        $('detailModal').classList.add('show');
      } catch (e) {
        showToast('Failed: ' + e.message, 'error');
      }
    }
  }

  function viewPodLogs(name) {
    $('logPodSelect').value = name;
    navigateTo('logs');
    loadLogs();
  }

  function confirmRestartPod(name) {
    if (!isAdmin()) return showToast('Admin access required', 'error');
    showConfirm('Restart Pod', `Are you sure you want to restart pod "${name}"?`, () => restartPod(name));
  }

  async function restartPod(name) {
    try {
      await api(`/api/v1/system/pods/${encodeURIComponent(name)}/restart`, { method: 'POST' });
      showToast(`Pod "${name}" restart triggered`, 'success');
      setTimeout(loadPods, 2000);
    } catch (e) {
      showToast('Restart failed: ' + e.message, 'error');
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  NATS CLUSTER
  // ═══════════════════════════════════════════════════════════

  async function loadNats() {
    if (!connected) return showToast('Not connected', 'error');
    $('natsGrid').innerHTML = '<div class="skeleton skeleton-card"></div>'.repeat(3);
    try {
      const data = await api('/api/v1/system/pods');
      const allPods = data.pods || [];
      const natsPods = allPods.filter(p => /nats/i.test(p.name) && !/box/i.test(p.name));
      const natsUtils = allPods.filter(p => /nats.*box/i.test(p.name));

      const healthy = natsPods.filter(p => (p.status || '').toLowerCase() === 'running').length;
      const totalContainers = natsPods.reduce((sum, p) => {
        const match = (p.ready || '0/0').match(/(\d+)\/(\d+)/);
        return sum + (match ? parseInt(match[2]) : 0);
      }, 0);

      $('natsTotal').textContent = natsPods.length;
      $('natsHealthy').textContent = healthy;
      $('natsContainers').textContent = totalContainers;

      if (!natsPods.length) {
        $('natsGrid').innerHTML = '<div class="empty-state"><p>No NATS pods found</p></div>';
        return;
      }

      const natsHtml = natsPods.map(p => {
        const status = (p.status || '').toLowerCase();
        const statusColor = status === 'running' ? 'var(--success)' : 'var(--warning)';
        return `<div class="nats-node">
          <div class="nats-node-header">
            <div class="nats-icon">N</div>
            <div>
              <div class="nats-node-name">${escHtml(p.name)}</div>
              <div class="nats-node-role" style="color:${statusColor}">${escHtml(p.status)}</div>
            </div>
          </div>
          <div class="nats-meta">
            <div class="nats-meta-item"><span class="nats-meta-label">Ready</span><span class="nats-meta-value">${escHtml(p.ready)}</span></div>
            <div class="nats-meta-item"><span class="nats-meta-label">Restarts</span><span class="nats-meta-value">${p.restarts}</span></div>
            <div class="nats-meta-item"><span class="nats-meta-label">IP</span><span class="nats-meta-value">${escHtml(p.ip || '—')}</span></div>
            <div class="nats-meta-item"><span class="nats-meta-label">Age</span><span class="nats-meta-value">${timeAgo(p.created)}</span></div>
            <div class="nats-meta-item"><span class="nats-meta-label">Node</span><span class="nats-meta-value">${escHtml(p.node || '—')}</span></div>
          </div>
          <div style="margin-top:12px;display:flex;gap:8px">
            <button class="btn btn-xs btn-ghost" onclick="App.viewPodLogs('${escHtml(p.name)}')">Logs</button>
            <button class="btn btn-xs btn-ghost" onclick="App.viewPodDetail('${escHtml(p.name)}')">Detail</button>
          </div>
        </div>`;
      }).join('');

      $('natsGrid').innerHTML = natsHtml;

      if (natsUtils.length) {
        const utilHtml = natsUtils.map(p => `<div class="deploy-row">
          <div class="deploy-info"><div class="deploy-name">${escHtml(p.name)}</div><div class="deploy-image">Utility pod · ${escHtml(p.ready)} ready</div></div>
          <div class="deploy-actions">
            <span class="badge ${(p.status||'').toLowerCase()==='running' ? 'badge-safe' : 'badge-warning'}">${escHtml(p.status)}</span>
            <button class="btn btn-xs btn-ghost" onclick="App.viewPodLogs('${escHtml(p.name)}')">Logs</button>
          </div>
        </div>`).join('');
        $('natsUtilsBody').innerHTML = utilHtml;
      } else {
        $('natsUtilsBody').innerHTML = '<div class="empty-state"><p>No NATS utility pods</p></div>';
      }
    } catch (e) {
      $('natsGrid').innerHTML = `<div class="empty-state"><p>Failed: ${escHtml(e.message)}</p></div>`;
    }
  }

  // ── Logs ───────────────────────────────────────────────────
  async function loadLogs() {
    const pod = $('logPodSelect').value;
    if (!pod) return;
    if (!connected) return showToast('Not connected', 'error');

    $('logTerminalTitle').textContent = pod;
    $('logStatus').innerHTML = '<span class="spinner"></span> Loading...';
    $('logTerminalBody').innerHTML = '<div class="log-empty"><span class="spinner-lg spinner"></span><p style="margin-top:12px">Fetching logs...</p></div>';

    try {
      const tail = $('logTailLines').value;
      const data = await api(`/api/v1/system/pods/${encodeURIComponent(pod)}/logs?tail_lines=${tail}`);
      $('logStatus').textContent = `${data.total_lines || 0} lines`;

      if (!data.log_lines?.length || (data.log_lines.length === 1 && !data.log_lines[0])) {
        $('logTerminalBody').innerHTML = '<div class="log-empty"><p>No logs available</p></div>';
        return;
      }

      const html = data.log_lines.filter(l => l).map(line => {
        let ts = '', content = line;
        const tsMatch = line.match(/^(\d{4}-\d{2}-\d{2}T[\d:.]+Z?)\s+(.*)/s);
        if (tsMatch) { ts = tsMatch[1]; content = tsMatch[2]; }
        let level = '';
        const lower = content.toLowerCase();
        if (lower.includes('error') || lower.includes('fatal') || lower.includes('panic')) level = 'log-error';
        else if (lower.includes('warn')) level = 'log-warn';
        else if (lower.includes('info')) level = 'log-info';
        return `<div class="log-line ${level}"><span class="log-timestamp">${escHtml(ts)}</span><span class="log-content">${escHtml(content)}</span></div>`;
      }).join('');

      $('logTerminalBody').innerHTML = html;
      if ($('logAutoScroll').checked) {
        const body = $('logTerminalBody');
        body.scrollTop = body.scrollHeight;
      }
    } catch (e) {
      $('logTerminalBody').innerHTML = `<div class="log-empty"><p style="color:var(--danger)">Error: ${escHtml(e.message)}</p></div>`;
      $('logStatus').textContent = 'Error';
    }
  }

  // ── Deployments ────────────────────────────────────────────
  async function loadDeployments() {
    if (!connected) return showToast('Not connected', 'error');
    $('deploymentsBody').innerHTML = '<div class="skeleton skeleton-lg"></div>';
    try {
      const [deplData, svcData] = await Promise.all([
        api('/api/v1/system/deployments'),
        api('/api/v1/system/services'),
      ]);

      if (!deplData.deployments?.length) {
        $('deploymentsBody').innerHTML = '<div class="empty-state"><p>No deployments found</p></div>';
      } else {
        const html = deplData.deployments.map(d => {
          const ready = d.ready_replicas || 0;
          const total = d.replicas || 0;
          const healthy = ready >= total && total > 0;
          const dots = Array.from({ length: Math.max(total, 1) }, (_, i) =>
            `<span class="replica-dot ${i < ready ? 'active' : ''}"></span>`
          ).join('');

          const adminActions = isAdmin() ? `
            <div class="deploy-actions">
              <div class="scale-control">
                <button onclick="App.scaleDeploy('${escHtml(d.name)}', ${Math.max(0, total - 1)})">−</button>
                <span class="scale-value">${total}</span>
                <button onclick="App.scaleDeploy('${escHtml(d.name)}', ${total + 1})">+</button>
              </div>
              <button class="btn btn-xs btn-ghost" onclick="App.confirmRestartDeploy('${escHtml(d.name)}')">Restart</button>
            </div>` : '';

          return `<div class="deploy-row">
            <div class="deploy-info">
              <div class="deploy-name">${escHtml(d.name)}</div>
              <div class="deploy-image">${escHtml((d.images || []).join(', '))}</div>
            </div>
            <div class="deploy-replicas">
              <div class="replica-bar">${dots}</div>
              <span style="font-size:13px;color:var(--${healthy ? 'success' : 'warning'})">${ready}/${total}</span>
            </div>
            ${adminActions}
          </div>`;
        }).join('');
        $('deploymentsBody').innerHTML = html;
      }

      if (!svcData.services?.length) {
        $('servicesBody').innerHTML = '<tr><td colspan="4"><div class="empty-state"><p>No services</p></div></td></tr>';
      } else {
        const svcHtml = svcData.services.map(s => {
          const ports = (s.ports || []).map(p => `${p.port}${p.node_port ? ':'+p.node_port : ''}/${p.protocol}`).join(', ');
          return `<tr>
            <td class="mono">${escHtml(s.name)}</td>
            <td><span class="badge badge-neutral">${escHtml(s.type)}</span></td>
            <td class="mono">${escHtml(s.cluster_ip || '—')}</td>
            <td class="mono">${escHtml(ports || '—')}</td>
          </tr>`;
        }).join('');
        $('servicesBody').innerHTML = svcHtml;
      }
    } catch (e) {
      $('deploymentsBody').innerHTML = `<div class="empty-state"><p>Failed: ${escHtml(e.message)}</p></div>`;
    }
  }

  async function scaleDeploy(name, replicas) {
    if (!isAdmin()) return showToast('Admin access required', 'error');
    if (replicas < 0 || replicas > 10) return;
    try {
      await api(`/api/v1/system/deployments/${encodeURIComponent(name)}/scale?replicas=${replicas}`, { method: 'POST' });
      showToast(`Scaled "${name}" to ${replicas}`, 'success');
      setTimeout(loadDeployments, 1500);
    } catch (e) {
      showToast('Scale failed: ' + e.message, 'error');
    }
  }

  function confirmRestartDeploy(name) {
    if (!isAdmin()) return showToast('Admin access required', 'error');
    showConfirm('Rolling Restart', `Trigger rolling restart of "${name}"?`, () => restartDeploy(name));
  }

  async function restartDeploy(name) {
    try {
      await api(`/api/v1/system/deployments/${encodeURIComponent(name)}/restart`, { method: 'POST' });
      showToast(`Rolling restart triggered for "${name}"`, 'success');
      setTimeout(loadDeployments, 2000);
    } catch (e) {
      showToast('Restart failed: ' + e.message, 'error');
    }
  }

  // ── Events ─────────────────────────────────────────────────
  async function loadEvents() {
    if (!connected) return showToast('Not connected', 'error');
    $('eventsBody').innerHTML = '<div class="skeleton skeleton-lg"></div>';
    try {
      const data = await api('/api/v1/system/events?limit=50');
      if (!data.events?.length) {
        $('eventsBody').innerHTML = '<div class="empty-state"><p>No recent events</p></div>';
        return;
      }
      const html = data.events.map(ev => {
        const icon = ev.type === 'Warning' ? 'warning' : 'normal';
        const iconSvg = ev.type === 'Warning'
          ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>'
          : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>';
        return `<div class="event-row">
          <div class="event-type-icon ${icon}">${iconSvg}</div>
          <div class="event-content">
            <div class="event-reason">${escHtml(ev.reason || '')}</div>
            <div class="event-message">${escHtml(ev.message || '')}</div>
            <div class="event-meta">
              <span>${escHtml(ev.involved_object?.kind || '')}/${escHtml(ev.involved_object?.name || '')}</span>
              <span>${ev.count ? 'x' + ev.count : ''}</span>
              <span>${ev.last_time ? timeAgo(ev.last_time) : ''}</span>
            </div>
          </div>
        </div>`;
      }).join('');
      $('eventsBody').innerHTML = html;
    } catch (e) {
      $('eventsBody').innerHTML = `<div class="empty-state"><p>Failed: ${escHtml(e.message)}</p></div>`;
    }
  }

  // ── Navigation ─────────────────────────────────────────────
  function navigateTo(page) {
    if (!pageTitles[page]) return;

    // Role check for admin-only pages
    if (['users', 'apikey'].includes(page) && !isAdmin()) {
      showToast('Admin access required', 'error');
      return;
    }

    currentPage = page;

    qsa('.nav-item').forEach(el => {
      el.classList.toggle('active', el.dataset.page === page);
    });
    qsa('.page-section').forEach(el => {
      el.classList.toggle('active', el.id === 'page-' + page);
    });
    $('pageTitle').textContent = pageTitles[page];
    closeSidebar();

    if (connected) {
      switch (page) {
        case 'overview': loadStats(); loadClusterOverview(); break;
        case 'pipeline': loadPipelineStatus(); break;
        case 'results': loadResults(); break;
        case 'alerts': loadAlerts(); break;
        case 'pods': loadPods(); break;
        case 'nats': loadNats(); break;
        case 'logs':
          if (!$('logPodSelect').options.length || $('logPodSelect').options.length <= 1) {
            api('/api/v1/system/pods').then(d => { cachedPods = d.pods || []; updatePodSelector(cachedPods); }).catch(() => {});
          }
          break;
        case 'deployments': loadDeployments(); break;
        case 'events': loadEvents(); break;
        case 'users': loadUsers(); break;
        case 'apikey': loadApiKeyStatus(); break;
      }
    }
  }

  // ── Sidebar Toggle ─────────────────────────────────────────
  function toggleSidebar() {
    $('sidebar').classList.toggle('open');
    $('sidebarOverlay').classList.toggle('show');
  }
  function closeSidebar() {
    $('sidebar').classList.remove('open');
    $('sidebarOverlay').classList.remove('show');
  }

  // ── Toast ──────────────────────────────────────────────────
  function showToast(message, type = 'info') {
    const container = $('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `<span>${escHtml(message)}</span>`;
    container.appendChild(toast);
    setTimeout(() => {
      toast.style.animation = 'fadeOut .3s ease forwards';
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  }

  // ── Logout ─────────────────────────────────────────────────
  function logout() {
    localStorage.removeItem('lipana_session');
    sessionStorage.removeItem('lipana_session');
    clearInterval(autoRefreshTimer);
    clearInterval(clockTimer);
    window.location.href = '/';
  }

  // ── Boot ───────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', init);

  // ── Public API ─────────────────────────────────────────────
  return {
    navigateTo, toggleSidebar, closeSidebar,
    loadResults, nextPage, prevPage,
    loadAlerts, alertNextPage, alertPrevPage,
    submitTransaction, previewTransaction, switchPreviewTab, lookupById,
    viewResultDetail, closeModal,
    showConfirm, closeConfirm, execConfirm,
    loadPods, loadLogs, viewPodLogs, viewPodDetail, confirmRestartPod,
    loadPipelineStatus, viewPipelineComponent,
    loadNats,
    loadDeployments, scaleDeploy, confirmRestartDeploy,
    loadEvents,
    toggleAutoRefresh,
    showToast, logout,
    // v2 — Transaction test
    testEntry, testExit, toggleExitTestType,
    // v2 — User management
    loadUsers, showAddUserModal, closeAddUserModal, createUser,
    toggleUserRole, toggleUserActive, deleteUserConfirm,
    // v2 — Admin
    saveApiKey, changePassword,
  };
})();
