/* ============================================================
   Lipana TPS — Dashboard Application
   Domain: tazama.lipana.co
   ============================================================ */

const App = (() => {
  // ── State ──────────────────────────────────────────────────
  let apiKey = '';
  let tenantId = '';
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
    lookup: 'Lookup',
    pods: 'Pods & Services',
    nats: 'NATS Cluster',
    logs: 'Container Logs',
    deployments: 'Deployments',
    events: 'Cluster Events',
    settings: 'Settings',
  };

  // Pipeline component definitions — maps pod name patterns to display info
  const PIPELINE_COMPONENTS = [
    { key: 'channel-router', label: 'Channel Router', short: 'CRSP', icon: '📡', pattern: /channel-router/i },
    { key: 'transaction-monitoring', label: 'TMS', short: 'TMS', icon: '🔍', pattern: /transaction-monitoring/i },
    { key: 'event-director', label: 'Event Director', short: 'ED', icon: '🎯', pattern: /event-director/i },
    { key: 'typology-processor', label: 'Typology Processor', short: 'TP', icon: '🧬', pattern: /typology-processor/i },
    { key: 'rule-901', label: 'Rule 901', short: 'R901', icon: '📏', pattern: /rule-901/i },
    { key: 'rule-902', label: 'Rule 902', short: 'R902', icon: '📏', pattern: /rule-902/i },
  ];

  // ── Helpers ────────────────────────────────────────────────
  const $ = id => document.getElementById(id);
  const qs = sel => document.querySelector(sel);
  const qsa = sel => document.querySelectorAll(sel);

  async function api(path, opts = {}) {
    const url = baseUrl + path;
    const headers = { 'X-API-Key': apiKey, 'Content-Type': 'application/json', ...opts.headers };
    try {
      const res = await fetch(url, { ...opts, headers });
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
    const saved = JSON.parse(localStorage.getItem('lipana_session') || '{}');
    apiKey = saved.apiKey || '';
    tenantId = saved.tenantId || '';
    baseUrl = saved.baseUrl || window.location.origin;

    startClock();

    if (apiKey) {
      connect();
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
      showToast('Connected to Lipana TPS', 'success');
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
      autoRefreshTimer = setInterval(() => {
        refreshCurrentPage();
      }, 30000);
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

      // FIXED: Use correct field names from StatsResponse model
      const evals = data.evaluations_total ?? 0;
      const alerts = data.alerts ?? 0;
      const noAlerts = data.no_alerts ?? 0;
      const txns = data.event_history_transactions ?? 0;

      $('statEvals').textContent = evals.toLocaleString();
      $('statTxns').textContent = txns.toLocaleString();
      $('statAlerts').textContent = alerts.toLocaleString();

      // Update alert badge in sidebar
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
      // Load stats for summary cards
      const statsData = await api(`/api/v1/results/stats/summary?tenant_id=${encodeURIComponent(tenantId)}`);
      const alerts = statsData.alerts ?? 0;
      const noAlerts = statsData.no_alerts ?? 0;
      const total = statsData.evaluations_total ?? 0;
      const rate = total > 0 ? ((alerts / total) * 100).toFixed(1) + '%' : '0%';

      $('alertTotal').textContent = alerts.toLocaleString();
      $('alertClean').textContent = noAlerts.toLocaleString();
      $('alertRate').textContent = rate;

      // Load alert results (ALRT only)
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

  // ── Transaction Submit (FIXED) ─────────────────────────────
  async function submitTransaction(e) {
    e.preventDefault();
    if (!connected) return showToast('Not connected', 'error');

    const btn = $('txSubmitBtn');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner" style="width:16px;height:16px;border-width:2px"></span> Submitting...';

    // FIXED: Use correct field names matching SimpleTransactionRequest model
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
      el.textContent = JSON.stringify(data, null, 2);
      el.classList.add('show');
      // FIXED: Use correct field name from TransactionSubmitResponse
      showToast('Transaction submitted: ' + (data.msg_id || 'OK'), data.success ? 'success' : 'warning');
    } catch (e) {
      showToast('Submit failed: ' + e.message, 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg> Send Transaction';
    }
  }

  // ── Lookup ─────────────────────────────────────────────────
  async function lookupById() {
    const id = $('lookupId').value.trim();
    if (!id) return showToast('Enter a Message ID', 'warning');
    if (!connected) return showToast('Not connected', 'error');
    try {
      const data = await api(`/api/v1/results/${encodeURIComponent(id)}?tenant_id=${encodeURIComponent(tenantId)}`);
      const el = $('lookupResult');
      el.textContent = JSON.stringify(data, null, 2);
      el.classList.add('show');
    } catch (e) {
      showToast('Lookup failed: ' + e.message, 'error');
    }
  }

  // ── Detail Modal ───────────────────────────────────────────
  async function viewResultDetail(msgId) {
    if (!connected || !msgId) return;
    try {
      const data = await api(`/api/v1/results/${encodeURIComponent(msgId)}?tenant_id=${encodeURIComponent(tenantId)}`);
      $('modalTitle').textContent = 'Evaluation: ' + msgId;
      $('modalBody').textContent = JSON.stringify(data, null, 2);
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

      // Determine health per component
      const components = PIPELINE_COMPONENTS.map(comp => {
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

      // Build pipeline flow SVG diagram
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

      // Build table
      const tableHtml = components.map(c => {
        const p = c.pod;
        const statusColor = c.status === 'healthy' ? 'var(--success)' : c.status === 'unhealthy' ? 'var(--danger)' : 'var(--text-muted)';
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

      // Health bar
      const healthy = components.filter(c => c.status === 'healthy').length;
      const pct = Math.round((healthy / components.length) * 100);
      updateHealthBar(pct);
    } catch (e) {
      $('pipelineFlow').innerHTML = `<div class="empty-state"><p>Failed to load pipeline: ${escHtml(e.message)}</p></div>`;
    }
  }

  function updateHealthBar(pct) {
    const fills = [$('pipelineHealthFill'), $('pipelineHealthFill2')];
    const vals = [$('pipelineHealthPct'), $('pipelineHealthPct2')];
    fills.forEach(el => {
      if (!el) return;
      el.style.width = pct + '%';
      el.className = 'health-bar-fill' + (pct < 50 ? ' danger' : pct < 80 ? ' warning' : '');
    });
    vals.forEach(el => { if (el) el.textContent = pct + '%'; });
  }

  function viewPipelineComponent(key) {
    const comp = PIPELINE_COMPONENTS.find(c => c.key === key);
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

      // Update pipeline health on overview
      const healthyDeploys = data.deployments?.healthy ?? 0;
      const totalDeploys = data.deployments?.total ?? 1;
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
            <button class="btn btn-xs btn-danger" onclick="App.confirmRestartPod('${escHtml(p.name)}')">Restart</button>
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
    showConfirm('Restart Pod', `Are you sure you want to restart pod "${name}"? It will be deleted and recreated by its controller.`, () => restartPod(name));
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

      // Filter NATS core pods and utility pods
      const natsPods = allPods.filter(p => /nats/i.test(p.name) && !/box/i.test(p.name));
      const natsUtils = allPods.filter(p => /nats.*box/i.test(p.name));

      // Stats
      const healthy = natsPods.filter(p => (p.status || '').toLowerCase() === 'running').length;
      const totalContainers = natsPods.reduce((sum, p) => {
        const match = (p.ready || '0/0').match(/(\d+)\/(\d+)/);
        return sum + (match ? parseInt(match[2]) : 0);
      }, 0);

      $('natsTotal').textContent = natsPods.length;
      $('natsHealthy').textContent = healthy;
      $('natsContainers').textContent = totalContainers;

      if (!natsPods.length) {
        $('natsGrid').innerHTML = '<div class="empty-state"><p>No NATS pods found in cluster</p></div>';
        return;
      }

      const natsHtml = natsPods.map(p => {
        const status = (p.status || '').toLowerCase();
        const statusColor = status === 'running' ? 'var(--success)' : 'var(--warning)';
        const age = timeAgo(p.created);

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
            <div class="nats-meta-item"><span class="nats-meta-label">Age</span><span class="nats-meta-value">${age}</span></div>
            <div class="nats-meta-item"><span class="nats-meta-label">Node</span><span class="nats-meta-value">${escHtml(p.node || '—')}</span></div>
          </div>
          <div style="margin-top:12px;display:flex;gap:8px">
            <button class="btn btn-xs btn-ghost" onclick="App.viewPodLogs('${escHtml(p.name)}')">Logs</button>
            <button class="btn btn-xs btn-ghost" onclick="App.viewPodDetail('${escHtml(p.name)}')">Detail</button>
          </div>
        </div>`;
      }).join('');

      $('natsGrid').innerHTML = natsHtml;

      // Utilities
      if (natsUtils.length) {
        const utilHtml = natsUtils.map(p => {
          return `<div class="deploy-row">
            <div class="deploy-info">
              <div class="deploy-name">${escHtml(p.name)}</div>
              <div class="deploy-image">Utility pod · ${escHtml(p.ready)} ready · Restarts: ${p.restarts}</div>
            </div>
            <div class="deploy-actions">
              <span class="badge ${(p.status||'').toLowerCase()==='running' ? 'badge-safe' : 'badge-warning'}">${escHtml(p.status)}</span>
              <button class="btn btn-xs btn-ghost" onclick="App.viewPodLogs('${escHtml(p.name)}')">Logs</button>
            </div>
          </div>`;
        }).join('');
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
        $('logTerminalBody').innerHTML = '<div class="log-empty"><p>No logs available for this pod</p></div>';
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

          return `<div class="deploy-row">
            <div class="deploy-info">
              <div class="deploy-name">${escHtml(d.name)}</div>
              <div class="deploy-image">${escHtml((d.images || []).join(', '))}</div>
            </div>
            <div class="deploy-replicas">
              <div class="replica-bar">${dots}</div>
              <span style="font-size:13px;color:var(--${healthy ? 'success' : 'warning'})">${ready}/${total}</span>
            </div>
            <div class="deploy-actions">
              <div class="scale-control">
                <button onclick="App.scaleDeploy('${escHtml(d.name)}', ${Math.max(0, total - 1)})">−</button>
                <span class="scale-value">${total}</span>
                <button onclick="App.scaleDeploy('${escHtml(d.name)}', ${total + 1})">+</button>
              </div>
              <button class="btn btn-xs btn-ghost" onclick="App.confirmRestartDeploy('${escHtml(d.name)}')">Restart</button>
            </div>
          </div>`;
        }).join('');
        $('deploymentsBody').innerHTML = html;
      }

      if (!svcData.services?.length) {
        $('servicesBody').innerHTML = '<tr><td colspan="4"><div class="empty-state"><p>No services found</p></div></td></tr>';
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
    if (replicas < 0 || replicas > 10) return;
    try {
      await api(`/api/v1/system/deployments/${encodeURIComponent(name)}/scale?replicas=${replicas}`, { method: 'POST' });
      showToast(`Scaled "${name}" to ${replicas} replicas`, 'success');
      setTimeout(loadDeployments, 1500);
    } catch (e) {
      showToast('Scale failed: ' + e.message, 'error');
    }
  }

  function confirmRestartDeploy(name) {
    showConfirm('Rolling Restart', `Trigger a rolling restart of deployment "${name}"?`, () => restartDeploy(name));
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
        const emoji = ev.type === 'Warning' ? '⚠' : 'ℹ';
        return `<div class="event-row">
          <div class="event-type-icon ${icon}">${emoji}</div>
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
    submitTransaction, lookupById,
    viewResultDetail, closeModal,
    showConfirm, closeConfirm, execConfirm,
    loadPods, loadLogs, viewPodLogs, viewPodDetail, confirmRestartPod,
    loadPipelineStatus, viewPipelineComponent,
    loadNats,
    loadDeployments, scaleDeploy, confirmRestartDeploy,
    loadEvents,
    toggleAutoRefresh,
    showToast, logout,
  };
})();
