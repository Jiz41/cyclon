// ─────────────────────────────────────────
// CyclOn app.js
// ─────────────────────────────────────────

const FOLDER_TYPES = {
  keirin: { label: "競輪",           icon: "🚲" },
  auto:   { label: "オートレース",   icon: "🏍️" },
  horse:  { label: "競馬",           icon: "🏇" },
  slot:   { label: "パチスロ",       icon: "🎰" },
  custom: { label: "カスタム",       icon: "📁" },
};

// ── Storage ──────────────────────────────
function loadState() {
  return {
    folders:      JSON.parse(localStorage.getItem("cyclon_folders")      || "[]"),
    transactions: JSON.parse(localStorage.getItem("cyclon_transactions") || "[]"),
  };
}
function saveState() {
  localStorage.setItem("cyclon_folders",      JSON.stringify(state.folders));
  localStorage.setItem("cyclon_transactions", JSON.stringify(state.transactions));
}

// ── App State ─────────────────────────────
let state = loadState();
let activeTab     = "home";
let recordType    = "out"; // "in" | "out"
let recordFolder  = state.folders[0]?.id || null;

// ── Utilities ────────────────────────────
function genId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
function esc(s) { return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }
function fmt(n) {
  const abs = Math.abs(n).toLocaleString("ja-JP");
  return (n >= 0 ? "+" : "−") + abs + "円";
}
function fmtAbs(n) { return Math.abs(n).toLocaleString("ja-JP") + "円"; }
function today() { return new Date().toISOString().slice(0, 10); }
function fmtDate(d) {
  if (!d) return "";
  const [y, m, dd] = d.split("-");
  return `${m}/${dd}`;
}
function folderBalance(id) {
  return state.transactions
    .filter(t => t.folderId === id)
    .reduce((s, t) => s + (t.type === "in" ? t.amount : -t.amount), 0);
}
function totalBalance() {
  return state.folders.reduce((s, f) => s + folderBalance(f.id), 0);
}
function typeInfo(f) { return FOLDER_TYPES[f?.type] || FOLDER_TYPES.custom; }

// ── Toast ─────────────────────────────────
let toastTimer;
function showToast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add("hidden"), 2000);
}

// ── Modal ─────────────────────────────────
function openModal(html) {
  document.getElementById("modal-content").innerHTML = html;
  document.getElementById("modal-overlay").classList.remove("hidden");
  setTimeout(() => {
    const first = document.querySelector("#modal-box input, #modal-box select");
    if (first) first.focus();
  }, 100);
}
function closeModal() {
  document.getElementById("modal-overlay").classList.add("hidden");
}

// ── Render ───────────────────────────────
function render() {
  // Header balance
  const total = totalBalance();
  const el = document.getElementById("total-balance");
  el.textContent = (total >= 0 ? "+" : "−") + Math.abs(total).toLocaleString("ja-JP") + "円";
  el.className = "total-balance " + (total >= 0 ? "positive" : "negative");

  // Tab content
  const content = document.getElementById("content");
  if      (activeTab === "home")   content.innerHTML = renderHome();
  else if (activeTab === "record") content.innerHTML = renderRecord();
  else if (activeTab === "stats")  content.innerHTML = renderStats();

  // Nav active state
  document.querySelectorAll(".bottom-nav button").forEach(btn =>
    btn.classList.toggle("active", btn.dataset.tab === activeTab)
  );

  if (activeTab === "stats") drawChart();
}

// ── Home ──────────────────────────────────
function renderHome() {
  if (!state.folders.length) return `
    <div class="empty-state">
      <div class="empty-icon">📂</div>
      <p>フォルダがありません</p>
      <button class="btn-primary" onclick="showAddFolder()">フォルダを作成</button>
    </div>`;

  const cards = state.folders.map(f => {
    const bal  = folderBalance(f.id);
    const ti   = typeInfo(f);
    const cnt  = state.transactions.filter(t => t.folderId === f.id).length;
    return `
    <div class="folder-card">
      <div class="folder-card-header">
        <span class="folder-icon">${ti.icon}</span>
        <span class="folder-name">${esc(f.name)}</span>
        <span class="folder-type-label">${ti.label}</span>
      </div>
      <div class="folder-balance ${bal >= 0 ? "positive" : "negative"}">${fmt(bal)}</div>
      <div class="folder-meta">${cnt}件の記録</div>
      <div class="folder-actions">
        <button class="btn-icon" onclick="showRenameFolder('${f.id}')">✏️</button>
        <button class="btn-icon" onclick="showTransfer('${f.id}')">↔️</button>
        <button class="btn-icon btn-danger" onclick="confirmDelete('${f.id}')">🗑️</button>
      </div>
    </div>`;
  }).join("");

  return `
    <div class="home-view">
      <div class="folder-grid">${cards}</div>
      <button class="btn-add-folder" onclick="showAddFolder()">＋ フォルダを追加</button>
    </div>`;
}

// ── Record ────────────────────────────────
function renderRecord() {
  if (!state.folders.length) return `
    <div class="empty-state">
      <p>先にフォルダを作成してください</p>
      <button class="btn-primary" onclick="switchTab('home')">ホームへ</button>
    </div>`;

  if (!recordFolder || !state.folders.find(f => f.id === recordFolder)) {
    recordFolder = state.folders[0].id;
  }

  const options = state.folders.map(f =>
    `<option value="${f.id}" ${f.id === recordFolder ? "selected" : ""}>${typeInfo(f).icon} ${esc(f.name)}</option>`
  ).join("");

  const recent = [...state.transactions]
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 15);

  const recentHtml = !recent.length
    ? `<p class="no-records">記録がありません</p>`
    : recent.map(t => {
        const f = state.folders.find(x => x.id === t.folderId);
        const ti = typeInfo(f);
        const name = f ? f.name : "削除済み";
        return `
        <div class="record-item ${t.type}">
          <div class="record-left">
            <span class="record-folder">${ti.icon} ${esc(name)}</span>
            ${t.note ? `<span class="record-note">${esc(t.note)}</span>` : ""}
            <span class="record-date">${fmtDate(t.date)}</span>
          </div>
          <div class="record-amount ${t.type === "in" ? "positive" : "negative"}">
            ${t.type === "in" ? "+" : "−"}${t.amount.toLocaleString()}円
          </div>
        </div>`;
      }).join("");

  return `
    <div class="record-view">
      <div class="record-form">
        <div class="form-group">
          <label>フォルダ</label>
          <select id="rec-folder" onchange="recordFolder=this.value">${options}</select>
        </div>
        <div class="form-group">
          <label>種別</label>
          <div class="type-toggle">
            <button class="toggle-btn ${recordType === "out" ? "active" : ""}" id="btn-out" onclick="setRecordType('out')">📤 出金（投入）</button>
            <button class="toggle-btn ${recordType === "in"  ? "active" : ""}" id="btn-in"  onclick="setRecordType('in')">💰 入金（払戻）</button>
          </div>
        </div>
        <div class="form-group">
          <label>金額</label>
          <div class="amount-input-wrap">
            <input type="number" id="rec-amount" placeholder="0" min="0" inputmode="numeric">
            <span class="currency">円</span>
          </div>
        </div>
        <div class="form-group">
          <label>レース名・メモ（任意）</label>
          <input type="text" id="rec-note" placeholder="例：川崎記念 6R">
        </div>
        <div class="form-group">
          <label>日付</label>
          <input type="date" id="rec-date" value="${today()}">
        </div>
        <button class="btn-submit" onclick="submitRecord()">記録する</button>
      </div>
      <div class="recent-records">
        <h3>最近の記録</h3>
        ${recentHtml}
      </div>
    </div>`;
}

// ── Stats ─────────────────────────────────
function renderStats() {
  if (!state.transactions.length) return `
    <div class="empty-state">
      <div class="empty-icon">📊</div>
      <p>記録がありません</p>
    </div>`;

  const totalIn  = state.transactions.filter(t => t.type === "in").reduce((s,t) => s + t.amount, 0);
  const totalOut = state.transactions.filter(t => t.type === "out").reduce((s,t) => s + t.amount, 0);
  const net      = totalIn - totalOut;
  const recovery = totalOut > 0 ? Math.round(totalIn / totalOut * 100) : 0;
  const streak   = calcStreak();

  const folderRows = state.folders.map(f => {
    const txs  = state.transactions.filter(t => t.folderId === f.id);
    if (!txs.length) return null;
    const fIn  = txs.filter(t => t.type === "in").reduce((s,t) => s + t.amount, 0);
    const fOut = txs.filter(t => t.type === "out").reduce((s,t) => s + t.amount, 0);
    const fNet = fIn - fOut;
    const fRec = fOut > 0 ? Math.round(fIn / fOut * 100) : 0;
    const ti   = typeInfo(f);
    return `
      <div class="stat-folder-row">
        <span class="stat-folder-name">${ti.icon} ${esc(f.name)}</span>
        <span class="stat-folder-net ${fNet >= 0 ? "positive" : "negative"}">${fmt(fNet)}</span>
        <span class="stat-folder-rec">${fRec}%</span>
      </div>`;
  }).filter(Boolean).join("");

  const streakLabel = streak.count === 0 ? "−"
    : streak.type === "win" ? `${streak.count}連勝中` : `${streak.count}連敗中`;
  const streakClass = streak.count === 0 ? "" : streak.type === "win" ? "positive" : "negative";

  return `
    <div class="stats-view">
      <div class="stat-cards">
        <div class="stat-card">
          <div class="stat-label">純損益</div>
          <div class="stat-value ${net >= 0 ? "positive" : "negative"}">${fmt(net)}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">回収率</div>
          <div class="stat-value">${recovery}%</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">総投入</div>
          <div class="stat-value">${fmtAbs(totalOut)}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">ストリーク</div>
          <div class="stat-value ${streakClass}">${streakLabel}</div>
        </div>
      </div>
      <div class="chart-container">
        <h3>月次収支</h3>
        <canvas id="monthly-chart"></canvas>
      </div>
      ${folderRows ? `
        <div class="folder-breakdown">
          <h3>フォルダ別</h3>
          <div class="stat-folder-header">
            <span>フォルダ</span><span>純損益</span><span>回収率</span>
          </div>
          ${folderRows}
        </div>` : ""}
    </div>`;
}

// ── Chart ─────────────────────────────────
function drawChart() {
  const canvas = document.getElementById("monthly-chart");
  if (!canvas) return;

  // Build monthly data
  const monthMap = {};
  state.transactions.forEach(t => {
    if (!t.date) return;
    const key = t.date.slice(0, 7); // YYYY-MM
    if (!monthMap[key]) monthMap[key] = 0;
    monthMap[key] += t.type === "in" ? t.amount : -t.amount;
  });

  const keys = Object.keys(monthMap).sort();
  if (!keys.length) return;

  const values = keys.map(k => monthMap[k]);
  const maxAbs = Math.max(...values.map(Math.abs), 1);

  const dpr = window.devicePixelRatio || 1;
  const W = canvas.parentElement.clientWidth - 32;
  const H = 180;
  canvas.width  = W * dpr;
  canvas.height = H * dpr;
  canvas.style.width  = W + "px";
  canvas.style.height = H + "px";

  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);

  const PAD_L = 56, PAD_R = 12, PAD_T = 16, PAD_B = 32;
  const chartW = W - PAD_L - PAD_R;
  const chartH = H - PAD_T - PAD_B;
  const midY   = PAD_T + chartH / 2;

  // Background
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, W, H);

  // Zero line
  ctx.strokeStyle = "#e0e0e0";
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(PAD_L, midY); ctx.lineTo(W - PAD_R, midY); ctx.stroke();

  // Bars
  const barW = Math.min(chartW / keys.length * 0.6, 40);
  const gap  = chartW / keys.length;

  keys.forEach((key, i) => {
    const v   = values[i];
    const x   = PAD_L + gap * i + gap / 2 - barW / 2;
    const barH = Math.abs(v) / maxAbs * (chartH / 2 - 4);

    ctx.fillStyle = v >= 0 ? "#2e7d32" : "#c62828";
    if (v >= 0) {
      ctx.fillRect(x, midY - barH, barW, barH);
    } else {
      ctx.fillRect(x, midY, barW, barH);
    }

    // Month label
    const [, m] = key.split("-");
    ctx.fillStyle = "#999";
    ctx.font = `${10 * dpr / dpr}px -apple-system,sans-serif`;
    ctx.textAlign = "center";
    ctx.fillText(parseInt(m) + "月", x + barW / 2, H - PAD_B + 14);

    // Value label
    const absK = Math.abs(v) >= 10000
      ? (v >= 0 ? "+" : "−") + Math.round(Math.abs(v) / 1000) + "k"
      : (v >= 0 ? "+" : "−") + Math.abs(v).toLocaleString();
    ctx.fillStyle = v >= 0 ? "#2e7d32" : "#c62828";
    ctx.font = `bold ${9 * dpr / dpr}px -apple-system,sans-serif`;
    ctx.fillText(absK, x + barW / 2, v >= 0 ? midY - barH - 4 : midY + barH + 12);
  });

  // Y axis label
  const topVal = (maxAbs >= 10000 ? Math.round(maxAbs / 1000) + "k" : maxAbs.toLocaleString()) + "円";
  ctx.fillStyle = "#bbb";
  ctx.font = `9px -apple-system,sans-serif`;
  ctx.textAlign = "right";
  ctx.fillText("+" + topVal, PAD_L - 4, PAD_T + 8);
  ctx.fillText("−" + topVal, PAD_L - 4, H - PAD_B);
}

// ── Streak calculation ────────────────────
function calcStreak() {
  // Group transactions by date+folder → session P/L
  const sessions = {};
  state.transactions.forEach(t => {
    const key = (t.date || "0000-00-00") + "_" + t.folderId;
    if (!sessions[key]) sessions[key] = { date: t.date || "0000-00-00", net: 0 };
    sessions[key].net += t.type === "in" ? t.amount : -t.amount;
  });
  const sorted = Object.values(sessions).sort((a, b) => a.date.localeCompare(b.date));
  if (!sorted.length) return { count: 0, type: "win" };

  const last    = sorted[sorted.length - 1];
  const winType = last.net >= 0 ? "win" : "lose";
  let count = 0;
  for (let i = sorted.length - 1; i >= 0; i--) {
    const isWin = sorted[i].net >= 0;
    if ((winType === "win") === isWin) count++;
    else break;
  }
  return { count, type: winType };
}

// ── Actions ──────────────────────────────
function switchTab(tab) {
  activeTab = tab;
  render();
  window.scrollTo(0, 0);
}

function setRecordType(type) {
  recordType = type;
  document.querySelectorAll(".toggle-btn").forEach(b => b.classList.remove("active"));
  const btn = document.getElementById("btn-" + type);
  if (btn) btn.classList.add("active");
}

function submitRecord() {
  const folder = document.getElementById("rec-folder")?.value || recordFolder;
  const amount = parseInt(document.getElementById("rec-amount")?.value || "0", 10);
  const note   = document.getElementById("rec-note")?.value?.trim() || "";
  const date   = document.getElementById("rec-date")?.value || today();

  if (!folder) { showToast("フォルダを選択してください"); return; }
  if (!amount || amount <= 0) { showToast("金額を入力してください"); return; }

  state.transactions.push({
    id: genId(), folderId: folder, type: recordType,
    amount, note, date, createdAt: Date.now(),
  });
  saveState();
  document.getElementById("rec-amount").value = "";
  document.getElementById("rec-note").value   = "";
  showToast(recordType === "in" ? `+${amount.toLocaleString()}円 記録しました` : `−${amount.toLocaleString()}円 記録しました`);
  render();
}

// ── Folder modals ─────────────────────────
function showAddFolder() {
  const opts = Object.entries(FOLDER_TYPES).map(([k, v]) =>
    `<option value="${k}">${v.icon} ${v.label}</option>`).join("");
  openModal(`
    <p class="modal-title">フォルダを追加</p>
    <label class="modal-label">名前</label>
    <input class="modal-input" id="m-name" placeholder="フォルダ名" maxlength="20">
    <label class="modal-label">種別</label>
    <select class="modal-select" id="m-type">${opts}</select>
    <div class="modal-actions">
      <button class="btn-secondary" onclick="closeModal()">キャンセル</button>
      <button class="btn-primary" onclick="addFolder()">作成</button>
    </div>`);
}

function addFolder() {
  const name = document.getElementById("m-name")?.value?.trim();
  const type = document.getElementById("m-type")?.value || "custom";
  if (!name) { document.getElementById("m-name").focus(); return; }
  state.folders.push({ id: genId(), name, type, createdAt: Date.now() });
  saveState();
  closeModal();
  showToast("フォルダを作成しました");
  render();
}

function showRenameFolder(id) {
  const f = state.folders.find(x => x.id === id);
  if (!f) return;
  openModal(`
    <p class="modal-title">名前を変更</p>
    <label class="modal-label">新しい名前</label>
    <input class="modal-input" id="m-rename" value="${esc(f.name)}" maxlength="20">
    <div class="modal-actions">
      <button class="btn-secondary" onclick="closeModal()">キャンセル</button>
      <button class="btn-primary" onclick="renameFolder('${id}')">変更</button>
    </div>`);
}

function renameFolder(id) {
  const name = document.getElementById("m-rename")?.value?.trim();
  if (!name) return;
  const f = state.folders.find(x => x.id === id);
  if (f) { f.name = name; saveState(); }
  closeModal();
  showToast("名前を変更しました");
  render();
}

function confirmDelete(id) {
  const f = state.folders.find(x => x.id === id);
  if (!f) return;
  const cnt = state.transactions.filter(t => t.folderId === id).length;
  openModal(`
    <p class="modal-title">「${esc(f.name)}」を削除</p>
    <p style="font-size:14px;color:#666;margin-bottom:8px;">${cnt}件の記録が削除されます。この操作は取り消せません。</p>
    <div class="modal-actions">
      <button class="btn-secondary" onclick="closeModal()">キャンセル</button>
      <button class="btn-danger-outline" onclick="deleteFolder('${id}')">削除する</button>
    </div>`);
}

function deleteFolder(id) {
  state.folders      = state.folders.filter(f => f.id !== id);
  state.transactions = state.transactions.filter(t => t.folderId !== id);
  if (recordFolder === id) recordFolder = state.folders[0]?.id || null;
  saveState();
  closeModal();
  showToast("フォルダを削除しました");
  render();
}

function showTransfer(fromId) {
  const others = state.folders.filter(f => f.id !== fromId);
  if (!others.length) { showToast("移動先のフォルダがありません"); return; }
  const from = state.folders.find(f => f.id === fromId);
  const bal  = folderBalance(fromId);
  const opts = others.map(f => `<option value="${f.id}">${typeInfo(f).icon} ${esc(f.name)}</option>`).join("");
  openModal(`
    <p class="modal-title">残高移動</p>
    <p style="font-size:13px;color:#666;margin-bottom:12px;">「${esc(from.name)}」残高: ${fmt(bal)}</p>
    <label class="modal-label">移動先</label>
    <select class="modal-select" id="m-to">${opts}</select>
    <label class="modal-label">金額</label>
    <div class="amount-input-wrap" style="margin-bottom:0">
      <input type="number" id="m-transfer" class="modal-input" style="border:none;padding:10px 12px;font-size:18px;font-weight:700;" placeholder="0" min="0" inputmode="numeric">
      <span class="currency">円</span>
    </div>
    <div class="modal-actions">
      <button class="btn-secondary" onclick="closeModal()">キャンセル</button>
      <button class="btn-primary" onclick="doTransfer('${fromId}')">移動</button>
    </div>`);
}

function doTransfer(fromId) {
  const toId  = document.getElementById("m-to")?.value;
  const amt   = parseInt(document.getElementById("m-transfer")?.value || "0", 10);
  if (!toId || !amt || amt <= 0) { showToast("金額を入力してください"); return; }
  const now   = Date.now();
  const d     = today();
  state.transactions.push({ id: genId(), folderId: fromId, type: "out", amount: amt, note: "残高移動（出）", date: d, createdAt: now });
  state.transactions.push({ id: genId(), folderId: toId,   type: "in",  amount: amt, note: "残高移動（入）", date: d, createdAt: now + 1 });
  saveState();
  closeModal();
  showToast(`${amt.toLocaleString()}円 を移動しました`);
  render();
}

// ── Init ──────────────────────────────────
render();
