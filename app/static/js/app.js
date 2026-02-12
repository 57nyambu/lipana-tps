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
  const resultsLimit = 20;
  let evalChart = null;
  let podsRefreshTimer = null;
  let confirmCallback = null;

  const pageTitles = {
    overview: 'Dashboard',
    results: 'Evaluation Results',
    transactions: 'Submit Transaction',
    lookup: 'Lookup',
    pods: 'Pods & Services',
    logs: 'Container Logs',
    deployments: 'Deployments',
    events: 'Cluster Events',
    settings: 'Settings',
  };

  // ── Helpers ────────────────────────────────────────────────
  const $ = id => document.getElementById(id);
  const qs = sel => document.querySelector(sel);
  const qsa = sel => document.querySelectorAll(sel);

  async function api(path, opts = {}) {
    const url = baseUrl + path;
    const headers = { 'X-API-Key': apiKey, 'X-Tenant-ID': tenantId, 'Content-Type': 'application/json', ...opts.headers };
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
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  function timeAgo(iso) {
    if (!iso) return '—';
    const diff = (Date.now() - new Date(iso).getTime()) / 1000;
    if (diff < 60) return `${Math.floor(diff)}s ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
  }

  // ── Init ───────────────────────────────────────────────────
  function init() {
    const saved = JSON.parse(localStorage.getItem('lipana_session') || '{}');
    apiKey = saved.apiKey || '';
    tenantId = saved.tenantId || '';
    baseUrl = saved.baseUrl || window.location.origin;

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

      // Update settings page
      $('cfgBaseUrl').textContent = baseUrl;
      $('cfgTenant').textContent = tenantId || 'default';
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

  // ── Stats ──────────────────────────────────────────────────
  async function loadStats() {
    if (!connected) return;
    try {
      const data = await api('/api/v1/results/stats/summary');
      $('statEvals').textContent = (data.total_evaluations ?? 0).toLocaleString();
      $('statTxns').textContent = (data.total_transactions ?? 0).toLocaleString();
      $('statAlerts').textContent = (data.alert_count ?? 0).toLocaleString();
      updateChart(data);
    } catch (e) {
      console.warn('Stats load failed:', e);
    }
  }

  function updateChart(data) {
    const ctx = $('evalChart');
    if (!ctx) return;
    const values = [data.alert_count || 0, data.non_alert_count || 0, data.error_count || 0];
    if (evalChart) {
      evalChart.data.datasets[0].data = values;
      evalChart.update();
      return;
    }
    evalChart = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: ['Alerts', 'Clean', 'Errors'],
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

  // ── Results ────────────────────────────────────────────────
  async function loadResults() {
    if (!connected) return showToast('Not connected', 'error');
    try {
      const offset = (resultsPage - 1) * resultsLimit;
      const data = await api(`/api/v1/results?limit=${resultsLimit}&offset=${offset}`);
      const rows = (data.results || []).map(r => {
        const status = (r.status || '').toLowerCase();
        const badge = status.includes('alert') ? 'badge-alert' : status.includes('error') ? 'badge-warning' : 'badge-safe';
        const label = status.includes('alert') ? 'ALERT' : status.includes('error') ? 'ERROR' : 'SAFE';
        return `<tr>
          <td class="mono">${escHtml(r.message_id || '')}</td>
          <td><span class="badge ${badge}">${label}</span></td>
          <td class="mono">${escHtml(r.result || '—')}</td>
          <td>${r.typology_count ?? '—'}</td>
          <td>${r.created_at ? new Date(r.created_at).toLocaleString() : '—'}</td>
          <td><button class="btn btn-xs btn-ghost" onclick="App.viewDetail('${escHtml(r.message_id || '')}')">View</button></td>
        </tr>`;
      }).join('');
      $('resultsBody').innerHTML = rows || '<tr><td colspan="6"><div class="empty-state"><p>No results found</p></div></td></tr>';
      $('resultsInfo').textContent = `Page ${resultsPage} · ${data.total ?? '?'} total`;
    } catch (e) {
      showToast('Failed to load results: ' + e.message, 'error');
    }
  }

  function nextPage() { resultsPage++; loadResults(); }
  function prevPage() { if (resultsPage > 1) { resultsPage--; loadResults(); } }

  // ── Transaction Submit ─────────────────────────────────────
  async function submitTransaction(e) {
    e.preventDefault();
    if (!connected) return showToast('Not connected', 'error');
    const payload = {
      debtor_name: $('txDebtor').value,
      creditor_name: $('txCreditor').value,
      debtor_account: $('txDebtorAcct').value,
      creditor_account: $('txCreditorAcct').value,
      amount: parseFloat($('txAmount').value),
      currency: $('txCurrency').value,
    };
    try {
      const data = await api('/api/v1/transactions/evaluate', { method: 'POST', body: JSON.stringify(payload) });
      const el = $('txResult');
      el.textContent = JSON.stringify(data, null, 2);
      el.classList.add('show');
      showToast('Transaction submitted: ' + (data.message_id || 'OK'), 'success');
    } catch (e) {
      showToast('Submit failed: ' + e.message, 'error');
    }
  }

  // ── Lookup ─────────────────────────────────────────────────
  async function lookupById() {
    const id = $('lookupId').value.trim();
    if (!id) return showToast('Enter a Message ID', 'warning');
    if (!connected) return showToast('Not connected', 'error');
    try {
      const data = await api(`/api/v1/results/${encodeURIComponent(id)}`);
      const el = $('lookupResult');
      el.textContent = JSON.stringify(data, null, 2);
      el.classList.add('show');
    } catch (e) {
      showToast('Lookup failed: ' + e.message, 'error');
    }
  }

  // ── Detail Modal ───────────────────────────────────────────
  async function viewDetail(msgId) {
    if (!connected) return;
    try {
      const data = await api(`/api/v1/results/${encodeURIComponent(msgId)}`);
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

  function closeConfirm() {
    $('confirmModal').classList.remove('show');
    confirmCallback = null;
  }

  function execConfirm() {
    if (confirmCallback) confirmCallback();
    closeConfirm();
  }

  // ═══════════════════════════════════════════════════════════
  //  CLUSTER MANAGEMENT
  // ═══════════════════════════════════════════════════════════

  async function loadClusterOverview() {
    if (!connected) return;
    try {
      const data = await api('/api/v1/system/overview');
      $('statPods').textContent = data.pods?.running ?? '—';
      $('csTotalPods').textContent = data.pods?.total ?? '—';
      $('csRunning').textContent = data.pods?.running ?? '—';
      $('csPending').textContent = data.pods?.pending ?? '—';
      $('csFailed').textContent = data.pods?.failed ?? '—';
      $('csRestarts').textContent = data.pods?.total_restarts ?? '—';
      $('csServices').textContent = data.services?.total ?? '—';
      $('cfgPodCount').textContent = data.pods?.total ?? '—';
      $('cfgDeployCount').textContent = data.deployments?.total ?? '—';
    } catch (e) {
      console.warn('Cluster overview failed:', e);
      // Not critical — K8s may not be available in local dev
    }
  }

  // ── Pods ───────────────────────────────────────────────────
  async function loadPods() {
    if (!connected) return showToast('Not connected', 'error');
    $('podsGrid').innerHTML = '<div class="skeleton skeleton-card"></div>'.repeat(4);
    try {
      const data = await api('/api/v1/system/pods');
      // Update cluster stats too
      loadClusterOverview();
      // Update log pod selector
      updatePodSelector(data.pods || []);

      if (!data.pods?.length) {
        $('podsGrid').innerHTML = '<div class="empty-state"><p>No pods found</p></div>';
        return;
      }

      const html = data.pods.map(p => {
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
    const current = sel.value;
    sel.innerHTML = '<option value="">Select a pod...</option>' +
      pods.map(p => `<option value="${escHtml(p.name)}" ${p.name === current ? 'selected' : ''}>${escHtml(p.name)}</option>`).join('');
  }

  async function viewPodDetail(name) {
    try {
      const data = await api('/api/v1/system/pods');
      const pod = (data.pods || []).find(p => p.name === name);
      if (!pod) return showToast('Pod not found', 'error');
      $('modalTitle').textContent = 'Pod: ' + name;
      $('modalBody').textContent = JSON.stringify(pod, null, 2);
      $('detailModal').classList.add('show');
    } catch (e) {
      showToast('Failed: ' + e.message, 'error');
    }
  }

  function viewPodLogs(name) {
    $('logPodSelect').value = name;
    navigateTo('logs');
    loadLogs();
  }

  function confirmRestartPod(name) {
    showConfirm('Restart Pod', `Are you sure you want to restart pod "${name}"? The pod will be deleted and recreated by its controller.`, () => restartPod(name));
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
        // Try to split timestamp
        const tsMatch = line.match(/^(\d{4}-\d{2}-\d{2}T[\d:.]+Z?)\s+(.*)/s);
        if (tsMatch) {
          ts = tsMatch[1];
          content = tsMatch[2];
        }

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

      // Deployments
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

      // Services
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

    // Update nav
    qsa('.nav-item').forEach(el => {
      el.classList.toggle('active', el.dataset.page === page);
    });

    // Update pages
    qsa('.page-section').forEach(el => {
      el.classList.toggle('active', el.id === 'page-' + page);
    });

    // Title
    $('pageTitle').textContent = pageTitles[page];

    // Close sidebar on mobile
    closeSidebar();

    // Load data for pages
    if (connected) {
      switch (page) {
        case 'results': loadResults(); break;
        case 'pods': loadPods(); break;
        case 'logs':
          if (!$('logPodSelect').options.length || $('logPodSelect').options.length <= 1) {
            // Load pod list for selector
            api('/api/v1/system/pods').then(d => updatePodSelector(d.pods || [])).catch(() => {});
          }
          break;
        case 'deployments': loadDeployments(); break;
        case 'events': loadEvents(); break;
        case 'overview': loadStats(); loadClusterOverview(); break;
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
    if (podsRefreshTimer) clearInterval(podsRefreshTimer);
    window.location.href = '/';
  }

  // ── Boot ───────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', init);

  // ── Public API ─────────────────────────────────────────────
  return {
    navigateTo,
    toggleSidebar,
    closeSidebar,
    loadResults,
    nextPage,
    prevPage,
    submitTransaction,
    lookupById,
    viewDetail,
    closeModal,
    showConfirm,
    closeConfirm,
    execConfirm,
    loadPods,
    loadLogs,
    viewPodLogs,
    viewPodDetail,
    confirmRestartPod,
    loadDeployments,
    scaleDeploy,
    confirmRestartDeploy,
    loadEvents,
    showToast,
    logout,
  };
})();
