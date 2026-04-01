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
    accountBalance: parseInt(localStorage.getItem("cyclon_account") || "0", 10),
    folders:        JSON.parse(localStorage.getItem("cyclon_folders")      || "[]"),
    transactions:   JSON.parse(localStorage.getItem("cyclon_transactions") || "[]"),
  };
}
function saveState() {
  localStorage.setItem("cyclon_account",      state.accountBalance);
  localStorage.setItem("cyclon_folders",      JSON.stringify(state.folders));
  localStorage.setItem("cyclon_transactions", JSON.stringify(state.transactions));
}

// ── App State ─────────────────────────────
let state        = loadState();
let activeTab    = "home";
let recordType   = "out";
let recordFolder = state.folders[0]?.id || null;

// ── CountUp Animation ─────────────────────
const prevValues = new Map();

function countUp(el, from, to) {
  const duration = 500;
  const start    = performance.now();
  function tick(now) {
    const t      = Math.min((now - start) / duration, 1);
    const eased  = 1 - Math.pow(1 - t, 3);
    const cur    = Math.round(from + (to - from) * eased);
    el.textContent = fmtAbs(cur);
    if (t < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

function runCountUps() {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  document.querySelectorAll(".animate-num").forEach(el => {
    const key    = el.dataset.key;
    const newVal = parseInt(el.dataset.value, 10);
    const prev   = prevValues.has(key) ? prevValues.get(key) : newVal;
    prevValues.set(key, newVal);
    if (prev !== newVal) countUp(el, prev, newVal);
  });
}

// ── Utilities ─────────────────────────────
function genId()   { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
function esc(s)    { return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }
function today()   { return new Date().toISOString().slice(0, 10); }
function fmtDate(d){ if (!d) return ""; const [,m,dd] = d.split("-"); return `${m}/${dd}`; }
function typeInfo(f){ return FOLDER_TYPES[f?.type] || FOLDER_TYPES.custom; }

function fmtMoney(n) {
  const abs = Math.abs(n).toLocaleString("ja-JP");
  return (n >= 0 ? "+" : "−") + abs + "円";
}
function fmtAbs(n) { return "¥" + Math.abs(n).toLocaleString("ja-JP"); }

// ── Calculations ──────────────────────────
// フォルダ内の収支純損益（払戻 - 投入）
function folderNetPL(id) {
  return state.transactions
    .filter(t => t.folderId === id)
    .reduce((s, t) => s + (t.type === "in" ? t.amount : -t.amount), 0);
}
// フォルダ残高 = 割当額 ± 収支
function folderBalance(id) {
  const f = state.folders.find(x => x.id === id);
  return (f?.allocated || 0) + folderNetPL(id);
}
// 全フォルダへの割当合計
function totalAllocated() {
  return state.folders.reduce((s, f) => s + (f.allocated || 0), 0);
}
// 未割当 = 口座残高 - 全割当
function unallocated() {
  return state.accountBalance - totalAllocated();
}

// ── Toast ─────────────────────────────────
let toastTimer;
function showToast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add("hidden"), 2200);
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

// ── Render ────────────────────────────────
function render() {
  // Header: 口座残高
  const bal = state.accountBalance;
  const el  = document.getElementById("total-balance");
  el.textContent = fmtAbs(bal);
  el.className   = "total-balance";

  const content = document.getElementById("content");
  if      (activeTab === "home")   content.innerHTML = renderHome();
  else if (activeTab === "record") content.innerHTML = renderRecord();
  else if (activeTab === "stats")  content.innerHTML = renderStats();

  document.querySelectorAll(".bottom-nav button").forEach(btn =>
    btn.classList.toggle("active", btn.dataset.tab === activeTab)
  );

  if (activeTab === "stats") drawChart();
  runCountUps();
}

// ── Home ──────────────────────────────────
function renderHome() {
  const ua    = unallocated();
  const alloc = totalAllocated();
  const uaCellClass = ua < 0 ? "account-sub-cell ua-negative" : ua === 0 ? "account-sub-cell ua-zero" : "account-sub-cell";
  const uaNumClass  = ua < 0 ? "account-sub-num negative" : ua === 0 ? "account-sub-num positive" : "account-sub-num";

  const accountSection = `
    <div class="account-bento">
      <div class="account-main-card">
        <div class="account-main-left">
          <div class="account-main-eyebrow">口座残高</div>
          <div class="account-main-num animate-num" data-key="account" data-value="${state.accountBalance}">${fmtAbs(state.accountBalance)}</div>
        </div>
        <button class="btn-account-edit" onclick="showEditAccount()">残高を更新</button>
      </div>
      <div class="account-sub-row">
        <div class="account-sub-cell">
          <div class="account-sub-label">割当済み</div>
          <div class="account-sub-num animate-num" data-key="allocated" data-value="${alloc}">${fmtAbs(alloc)}</div>
        </div>
        <div class="${uaCellClass}">
          <div class="account-sub-label">未割当${ua < 0 ? " ⚠️" : ua === 0 ? " ✅" : ""}</div>
          <div class="${uaNumClass} animate-num" data-key="unallocated" data-value="${ua}">${fmtAbs(ua)}</div>
        </div>
      </div>
    </div>`;

  if (!state.folders.length) return `
    ${accountSection}
    <div class="home-view">
      <div class="empty-state" style="padding:40px 24px">
        <div class="empty-icon">📂</div>
        <p>フォルダがありません</p>
        <button class="btn-primary" onclick="showAddFolder()">フォルダを作成</button>
      </div>
    </div>`;

  const cards = state.folders.map(f => {
    const alloc = f.allocated || 0;
    const pl    = folderNetPL(f.id);
    const bal   = alloc + pl;
    const ti    = typeInfo(f);
    return `
    <div class="folder-card">
      <div class="folder-card-header">
        <span class="folder-icon">${ti.icon}</span>
        <span class="folder-name">${esc(f.name)}</span>
        <span class="folder-type-label">${ti.label}</span>
      </div>
      <div class="folder-stats-row">
        <div class="folder-stat">
          <span class="folder-stat-label">割当</span>
          <span class="folder-stat-value animate-num" data-key="alloc-${f.id}" data-value="${alloc}">${fmtAbs(alloc)}</span>
        </div>
        <div class="folder-stat">
          <span class="folder-stat-label">収支</span>
          <span class="folder-stat-value ${pl >= 0 ? "positive" : "negative"}">${fmtMoney(pl)}</span>
        </div>
        <div class="folder-stat">
          <span class="folder-stat-label">残高</span>
          <span class="folder-stat-value balance-big ${bal >= 0 ? "positive" : "negative"} animate-num" data-key="bal-${f.id}" data-value="${bal}">${fmtAbs(bal)}</span>
        </div>
      </div>
      <div class="folder-actions">
        <button class="btn-allocate" onclick="showAllocate('${f.id}')">＋ 振り分け</button>
        <button class="btn-icon" onclick="showRenameFolder('${f.id}')">✏️</button>
        <button class="btn-icon" onclick="showTransfer('${f.id}')">↔️</button>
        <button class="btn-icon btn-danger" onclick="confirmDelete('${f.id}')">🗑️</button>
      </div>
    </div>`;
  }).join("");

  return `
    ${accountSection}
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
        const f  = state.folders.find(x => x.id === t.folderId);
        const ti = typeInfo(f);
        return `
        <div class="record-item ${t.type}">
          <div class="record-left">
            <span class="record-folder">${ti.icon} ${esc(f ? f.name : "削除済み")}</span>
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
            <button class="toggle-btn ${recordType==="out"?"active":""}" id="btn-out" onclick="setRecordType('out')">📤 投入（出金）</button>
            <button class="toggle-btn ${recordType==="in" ?"active":""}" id="btn-in"  onclick="setRecordType('in')">💰 払戻（入金）</button>
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

  const totalIn  = state.transactions.filter(t => t.type === "in").reduce((s,t)  => s + t.amount, 0);
  const totalOut = state.transactions.filter(t => t.type === "out").reduce((s,t)  => s + t.amount, 0);
  const net      = totalIn - totalOut;
  const recovery = totalOut > 0 ? Math.round(totalIn / totalOut * 100) : 0;
  const streak   = calcStreak();

  const folderRows = state.folders.map(f => {
    const txs  = state.transactions.filter(t => t.folderId === f.id);
    if (!txs.length) return null;
    const fIn  = txs.filter(t => t.type === "in").reduce((s,t)  => s + t.amount, 0);
    const fOut = txs.filter(t => t.type === "out").reduce((s,t)  => s + t.amount, 0);
    const fNet = fIn - fOut;
    const fRec = fOut > 0 ? Math.round(fIn / fOut * 100) : 0;
    return `
      <div class="stat-folder-row">
        <span class="stat-folder-name">${typeInfo(f).icon} ${esc(f.name)}</span>
        <span class="stat-folder-net ${fNet >= 0 ? "positive" : "negative"}">${fmtMoney(fNet)}</span>
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
          <div class="stat-value ${net >= 0 ? "positive" : "negative"}">${fmtMoney(net)}</div>
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
        <h3>月次収支（投入 vs 払戻）</h3>
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

  const monthMap = {};
  state.transactions.forEach(t => {
    if (!t.date) return;
    const key = t.date.slice(0, 7);
    if (!monthMap[key]) monthMap[key] = 0;
    monthMap[key] += t.type === "in" ? t.amount : -t.amount;
  });

  const keys = Object.keys(monthMap).sort();
  if (!keys.length) return;
  const values = keys.map(k => monthMap[k]);
  const maxAbs = Math.max(...values.map(Math.abs), 1);

  const dpr = window.devicePixelRatio || 1;
  const W   = canvas.parentElement.clientWidth - 32;
  const H   = 180;
  canvas.width  = W * dpr; canvas.height = H * dpr;
  canvas.style.width = W + "px"; canvas.style.height = H + "px";

  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);

  const PL = 56, PR = 12, PT = 16, PB = 32;
  const cW = W - PL - PR, cH = H - PT - PB, midY = PT + cH / 2;

  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = "#e0e0e0"; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(PL, midY); ctx.lineTo(W - PR, midY); ctx.stroke();

  const barW = Math.min(cW / keys.length * 0.6, 40);
  const gap  = cW / keys.length;

  keys.forEach((key, i) => {
    const v    = values[i];
    const x    = PL + gap * i + gap / 2 - barW / 2;
    const barH = Math.abs(v) / maxAbs * (cH / 2 - 4);
    ctx.fillStyle = v >= 0 ? "#2e7d32" : "#c62828";
    v >= 0 ? ctx.fillRect(x, midY - barH, barW, barH) : ctx.fillRect(x, midY, barW, barH);

    const [,m] = key.split("-");
    ctx.fillStyle = "#999"; ctx.font = "10px -apple-system,sans-serif"; ctx.textAlign = "center";
    ctx.fillText(parseInt(m) + "月", x + barW / 2, H - PB + 14);

    const label = Math.abs(v) >= 10000
      ? (v >= 0 ? "+" : "−") + Math.round(Math.abs(v) / 1000) + "k"
      : (v >= 0 ? "+" : "−") + Math.abs(v).toLocaleString();
    ctx.fillStyle = v >= 0 ? "#2e7d32" : "#c62828";
    ctx.font = "bold 9px -apple-system,sans-serif";
    ctx.fillText(label, x + barW / 2, v >= 0 ? midY - barH - 4 : midY + barH + 12);
  });

  const topVal = (maxAbs >= 10000 ? Math.round(maxAbs/1000)+"k" : maxAbs.toLocaleString()) + "円";
  ctx.fillStyle = "#bbb"; ctx.font = "9px -apple-system,sans-serif"; ctx.textAlign = "right";
  ctx.fillText("+" + topVal, PL - 4, PT + 8);
  ctx.fillText("−" + topVal, PL - 4, H - PB);
}

// ── Streak ────────────────────────────────
function calcStreak() {
  const sessions = {};
  state.transactions.forEach(t => {
    const key = (t.date || "0000-00-00") + "_" + t.folderId;
    if (!sessions[key]) sessions[key] = { date: t.date || "0000-00-00", net: 0 };
    sessions[key].net += t.type === "in" ? t.amount : -t.amount;
  });
  const sorted = Object.values(sessions).sort((a, b) => a.date.localeCompare(b.date));
  if (!sorted.length) return { count: 0, type: "win" };
  const winType = sorted[sorted.length - 1].net >= 0 ? "win" : "lose";
  let count = 0;
  for (let i = sorted.length - 1; i >= 0; i--) {
    if ((sorted[i].net >= 0) === (winType === "win")) count++;
    else break;
  }
  return { count, type: winType };
}

// ── Tab / Record ──────────────────────────
function switchTab(tab) { activeTab = tab; render(); window.scrollTo(0, 0); }

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
  if (!folder)          { showToast("フォルダを選択してください"); return; }
  if (!amount || amount <= 0) { showToast("金額を入力してください"); return; }
  state.transactions.push({ id: genId(), folderId: folder, type: recordType, amount, note, date, createdAt: Date.now() });
  saveState();
  document.getElementById("rec-amount").value = "";
  document.getElementById("rec-note").value   = "";
  showToast((recordType === "in" ? "+" : "−") + amount.toLocaleString() + "円 記録しました");
  render();
}

// ── 口座残高 ──────────────────────────────
function showEditAccount() {
  openModal(`
    <p class="modal-title">口座残高を更新</p>
    <p style="font-size:13px;color:#666;margin-bottom:14px;">現在: ${fmtAbs(state.accountBalance)}</p>
    <label class="modal-label">更新方法</label>
    <div class="type-toggle" style="margin-bottom:14px">
      <button class="toggle-btn active" id="m-mode-add" onclick="setAccountMode('add')">＋ 入金を追加</button>
      <button class="toggle-btn"        id="m-mode-set" onclick="setAccountMode('set')">直接入力</button>
    </div>
    <label class="modal-label" id="m-amount-label">入金額</label>
    <div class="amount-input-wrap">
      <input type="number" id="m-account-amount" placeholder="0" min="0" inputmode="numeric">
      <span class="currency">円</span>
    </div>
    <div class="modal-actions">
      <button class="btn-secondary" onclick="closeModal()">キャンセル</button>
      <button class="btn-primary"   onclick="updateAccount()">更新</button>
    </div>`);
}
let accountMode = "add";
function setAccountMode(mode) {
  accountMode = mode;
  document.querySelectorAll("#modal-box .toggle-btn").forEach(b => b.classList.remove("active"));
  document.getElementById("m-mode-" + mode).classList.add("active");
  document.getElementById("m-amount-label").textContent = mode === "add" ? "入金額" : "新しい残高";
}
function updateAccount() {
  const amt = parseInt(document.getElementById("m-account-amount")?.value || "0", 10);
  if (!amt || amt <= 0) { showToast("金額を入力してください"); return; }
  if (accountMode === "add") {
    state.accountBalance += amt;
    showToast("+" + amt.toLocaleString() + "円 入金しました");
  } else {
    state.accountBalance = amt;
    showToast("口座残高を " + fmtAbs(amt) + " に更新しました");
  }
  saveState(); closeModal(); render();
}

// ── 振り分け（フォルダへ割当） ─────────────
function showAllocate(id) {
  const f  = state.folders.find(x => x.id === id);
  const ua = unallocated();
  openModal(`
    <p class="modal-title">「${esc(f.name)}」へ振り分け</p>
    <p style="font-size:13px;color:#666;margin-bottom:4px;">未割当: ${fmtAbs(ua)}</p>
    <p style="font-size:13px;color:#666;margin-bottom:14px;">現在の割当: ${fmtAbs(f.allocated||0)}</p>
    <label class="modal-label">振り分け額</label>
    <div class="amount-input-wrap">
      <input type="number" id="m-alloc" placeholder="0" min="0" inputmode="numeric">
      <span class="currency">円</span>
    </div>
    ${ua <= 0 ? `<p style="color:#c62828;font-size:12px;margin-top:6px">⚠️ 未割当が不足しています</p>` : ""}
    <div class="modal-actions">
      <button class="btn-secondary" onclick="closeModal()">キャンセル</button>
      <button class="btn-primary"   onclick="doAllocate('${id}')">振り分ける</button>
    </div>`);
}
function doAllocate(id) {
  const amt = parseInt(document.getElementById("m-alloc")?.value || "0", 10);
  if (!amt || amt <= 0) { showToast("金額を入力してください"); return; }
  const f = state.folders.find(x => x.id === id);
  if (!f) return;
  f.allocated = (f.allocated || 0) + amt;
  saveState(); closeModal();
  showToast(fmtAbs(amt) + " を振り分けました");
  render();
}

// ── フォルダ間転送（割当を移動） ──────────
function showTransfer(fromId) {
  const others = state.folders.filter(f => f.id !== fromId);
  if (!others.length) { showToast("移動先のフォルダがありません"); return; }
  const from = state.folders.find(f => f.id === fromId);
  const opts = others.map(f => `<option value="${f.id}">${typeInfo(f).icon} ${esc(f.name)}</option>`).join("");
  openModal(`
    <p class="modal-title">割当を別フォルダへ移動</p>
    <p style="font-size:13px;color:#666;margin-bottom:12px;">「${esc(from.name)}」割当: ${fmtAbs(from.allocated||0)}</p>
    <label class="modal-label">移動先</label>
    <select class="modal-select" id="m-to">${opts}</select>
    <label class="modal-label">金額</label>
    <div class="amount-input-wrap">
      <input type="number" id="m-transfer" placeholder="0" min="0" inputmode="numeric">
      <span class="currency">円</span>
    </div>
    <div class="modal-actions">
      <button class="btn-secondary" onclick="closeModal()">キャンセル</button>
      <button class="btn-primary"   onclick="doTransfer('${fromId}')">移動</button>
    </div>`);
}
function doTransfer(fromId) {
  const toId = document.getElementById("m-to")?.value;
  const amt  = parseInt(document.getElementById("m-transfer")?.value || "0", 10);
  if (!toId || !amt || amt <= 0) { showToast("金額を入力してください"); return; }
  const from = state.folders.find(f => f.id === fromId);
  const to   = state.folders.find(f => f.id === toId);
  if (!from || !to) return;
  from.allocated = (from.allocated || 0) - amt;
  to.allocated   = (to.allocated   || 0) + amt;
  saveState(); closeModal();
  showToast(amt.toLocaleString() + "円 を移動しました");
  render();
}

// ── フォルダ CRUD ─────────────────────────
function showAddFolder() {
  const opts = Object.entries(FOLDER_TYPES).map(([k,v]) =>
    `<option value="${k}">${v.icon} ${v.label}</option>`).join("");
  openModal(`
    <p class="modal-title">フォルダを追加</p>
    <label class="modal-label">名前</label>
    <input class="modal-input" id="m-name" placeholder="フォルダ名" maxlength="20">
    <label class="modal-label">種別</label>
    <select class="modal-select" id="m-type">${opts}</select>
    <div class="modal-actions">
      <button class="btn-secondary" onclick="closeModal()">キャンセル</button>
      <button class="btn-primary"   onclick="addFolder()">作成</button>
    </div>`);
}
function addFolder() {
  const name = document.getElementById("m-name")?.value?.trim();
  const type = document.getElementById("m-type")?.value || "custom";
  if (!name) { document.getElementById("m-name").focus(); return; }
  state.folders.push({ id: genId(), name, type, allocated: 0, createdAt: Date.now() });
  saveState(); closeModal();
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
      <button class="btn-primary"   onclick="renameFolder('${id}')">変更</button>
    </div>`);
}
function renameFolder(id) {
  const name = document.getElementById("m-rename")?.value?.trim();
  if (!name) return;
  const f = state.folders.find(x => x.id === id);
  if (f) { f.name = name; saveState(); }
  closeModal(); showToast("名前を変更しました"); render();
}
function confirmDelete(id) {
  const f   = state.folders.find(x => x.id === id);
  const cnt = state.transactions.filter(t => t.folderId === id).length;
  openModal(`
    <p class="modal-title">「${esc(f.name)}」を削除</p>
    <p style="font-size:14px;color:#666;margin-bottom:8px;">${cnt}件の記録と割当 ${fmtAbs(f.allocated||0)} が削除されます。この操作は取り消せません。</p>
    <div class="modal-actions">
      <button class="btn-secondary"    onclick="closeModal()">キャンセル</button>
      <button class="btn-danger-outline" onclick="deleteFolder('${id}')">削除する</button>
    </div>`);
}
function deleteFolder(id) {
  state.folders      = state.folders.filter(f => f.id !== id);
  state.transactions = state.transactions.filter(t => t.folderId !== id);
  if (recordFolder === id) recordFolder = state.folders[0]?.id || null;
  saveState(); closeModal(); showToast("フォルダを削除しました"); render();
}

// ── Init ──────────────────────────────────
document.addEventListener("pointermove", e => {
  document.querySelectorAll(".folder-card").forEach(card => {
    const r = card.getBoundingClientRect();
    card.style.setProperty("--lx", ((e.clientX - r.left) / r.width  * 100).toFixed(1) + "%");
    card.style.setProperty("--ly", ((e.clientY - r.top)  / r.height * 100).toFixed(1) + "%");
  });
});

render();
