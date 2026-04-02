// ─────────────────────────────────────────
// CyclOn app.js — YNAB準拠設計
// 記録が全ての起点。口座残高は取引の総和。
// ─────────────────────────────────────────

const FOLDER_TYPES = {
  keirin: { label: "競輪",           icon: "🚲" },
  auto:   { label: "オートレース",   icon: "🏍️" },
  horse:  { label: "競馬",           icon: "🏇" },
  slot:   { label: "パチスロ",       icon: "🎰" },
  custom: { label: "カスタム",       icon: "📁" },
};

const TYPE_COLORS = {
  keirin: "#1565c0",
  auto:   "#6a1b9a",
  horse:  "#2e7d32",
  slot:   "#e65100",
  custom: "#ff6600",
};

const CARD_PRESETS = [
  "#1565c0","#6a1b9a","#2e7d32","#e65100","#ff6600",
  "#d32f2f","#00838f","#558b2f","#4527a0","#37474f",
];

// ── Migration（旧形式 → 新形式） ──────────
function migrateState(s) {
  // allocated → budget
  s.folders.forEach(f => {
    if (!("budget" in f)) { f.budget = f.allocated || 0; delete f.allocated; }
  });
  // 旧 type:"in"/"out" + 正の amount → signed amount + category
  s.transactions.forEach(t => {
    if (!("category" in t)) {
      t.category = "normal";
      t.amount   = t.type === "in" ? Math.abs(t.amount || 0) : -(Math.abs(t.amount || 0));
      delete t.type;
    }
  });
  return s;
}

// ── Storage ──────────────────────────────
function loadState() {
  const s = {
    folders:      JSON.parse(localStorage.getItem("cyclon_folders")      || "[]"),
    transactions: JSON.parse(localStorage.getItem("cyclon_transactions") || "[]"),
    unallocated:  parseFloat(localStorage.getItem("cyclon_unallocated")   || "0"),
  };
  localStorage.removeItem("cyclon_account"); // 旧キー廃止
  return migrateState(s);
}
function saveState() {
  localStorage.setItem("cyclon_folders",      JSON.stringify(state.folders));
  localStorage.setItem("cyclon_transactions", JSON.stringify(state.transactions));
  localStorage.setItem("cyclon_unallocated",  String(state.unallocated));
}

// ── App State ─────────────────────────────
let state          = loadState();
let activeTab      = "home";
let recordType     = "out";       // "in" | "out"
let recordCategory = "normal";   // "normal" | "transfer" | "other"
let recordFolder   = state.folders[0]?.id || null;

// ── Dark Mode ─────────────────────────────
function initTheme() {
  if (localStorage.getItem("cyclon_dark") === "1")
    document.documentElement.setAttribute("data-theme", "dark");
}
function toggleDark() {
  const dark = document.documentElement.getAttribute("data-theme") === "dark";
  document.documentElement.setAttribute("data-theme", dark ? "" : "dark");
  localStorage.setItem("cyclon_dark", dark ? "0" : "1");
  const btn = document.getElementById("btn-dark");
  if (btn) btn.textContent = dark ? "🌙" : "☀️";
}
initTheme();

// ── CountUp Animation ─────────────────────
const prevValues = new Map();

function countUp(el, from, to) {
  const duration = 500;
  const start    = performance.now();
  function tick(now) {
    const t     = Math.min((now - start) / duration, 1);
    const eased = 1 - Math.pow(1 - t, 3);
    const cur   = Math.round(from + (to - from) * eased);
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
function genId()    { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
function esc(s)     { return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }
function today()    { return new Date().toISOString().slice(0, 10); }
function fmtDate(d) { if (!d) return ""; const [,m,dd] = d.split("-"); return `${m}/${dd}`; }
function typeInfo(f){ return FOLDER_TYPES[f?.type] || FOLDER_TYPES.custom; }

function fmtMoney(n) {
  return (n >= 0 ? "+" : "−") + Math.abs(n).toLocaleString("ja-JP") + "円";
}
function fmtAbs(n) { return "¥" + Math.abs(n).toLocaleString("ja-JP"); }

// ── Calculations ──────────────────────────
// 口座残高 = 全フォルダ収支の合計 + 未割当額
function accountBalance() {
  return state.unallocated + state.folders.reduce((s, f) => s + folderNetPL(f.id), 0);
}
// フォルダ残高 = フォルダ収支（転送込み）
function folderNetPL(id) {
  return state.transactions.reduce((s, t) => {
    if (t.category === "transfer") {
      if (t.folderId   === id) return s - Math.abs(t.amount || 0);
      if (t.toFolderId === id) return s + Math.abs(t.amount || 0);
      return s;
    }
    if (t.folderId === id) return s + (t.amount || 0);
    return s;
  }, 0);
}
// フォルダ残高 = 記録の総和（= folderNetPL）
// フォルダ入金合計（transfer除く）
function folderIn(id) {
  return state.transactions.filter(t => t.folderId === id && t.category !== "transfer" && t.amount > 0)
    .reduce((s, t) => s + t.amount, 0);
}
// フォルダ出金合計（transfer除く）
function folderOut(id) {
  return state.transactions.filter(t => t.folderId === id && t.category !== "transfer" && t.amount < 0)
    .reduce((s, t) => s + Math.abs(t.amount), 0);
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

// ── Drag & Drop ───────────────────────────
let dragState = null;

function startDrag(e, folderId) {
  e.preventDefault();
  const card = document.querySelector(`.folder-card[data-folder-id="${folderId}"]`);
  if (!card) return;
  const rect  = card.getBoundingClientRect();
  const clone = card.cloneNode(true);
  Object.assign(clone.style, {
    position: "fixed", left: rect.left+"px", top: rect.top+"px",
    width: rect.width+"px", opacity: "0.88", zIndex: "1000",
    pointerEvents: "none", transform: "scale(1.04) rotate(1.5deg)",
    boxShadow: "0 24px 48px rgba(0,0,0,0.22)", transition: "none",
  });
  document.body.appendChild(clone);
  card.classList.add("dragging");
  dragState = {
    folderId, clone, card, targetId: null,
    offsetX: e.clientX - rect.left,
    offsetY: e.clientY - rect.top,
  };
  document.addEventListener("pointermove",   onDragMove, { passive: false });
  document.addEventListener("pointerup",     onDragEnd);
  document.addEventListener("pointercancel", onDragEnd);
}

function onDragMove(e) {
  if (!dragState) return;
  e.preventDefault();
  dragState.clone.style.left = (e.clientX - dragState.offsetX) + "px";
  dragState.clone.style.top  = (e.clientY - dragState.offsetY) + "px";
  dragState.clone.style.pointerEvents = "none";
  const below  = document.elementFromPoint(e.clientX, e.clientY);
  const target = below?.closest(".folder-card[data-folder-id]");
  document.querySelectorAll(".folder-card.drag-over").forEach(c => c.classList.remove("drag-over"));
  if (target && target !== dragState.card) {
    target.classList.add("drag-over");
    dragState.targetId = target.dataset.folderId;
  } else {
    dragState.targetId = null;
  }
}

function onDragEnd() {
  if (!dragState) return;
  const { folderId, clone, card, targetId } = dragState;
  clone.remove();
  card.classList.remove("dragging");
  document.querySelectorAll(".folder-card.drag-over").forEach(c => c.classList.remove("drag-over"));
  if (targetId && targetId !== folderId) {
    const fi = state.folders.findIndex(f => f.id === folderId);
    const ti = state.folders.findIndex(f => f.id === targetId);
    if (fi !== -1 && ti !== -1) {
      const [moved] = state.folders.splice(fi, 1);
      state.folders.splice(ti, 0, moved);
      saveState(); render();
    }
  }
  dragState = null;
  document.removeEventListener("pointermove",   onDragMove);
  document.removeEventListener("pointerup",     onDragEnd);
  document.removeEventListener("pointercancel", onDragEnd);
}

// ── Render ────────────────────────────────
function render() {
  const bal = accountBalance();
  const el  = document.getElementById("total-balance");
  el.className     = "total-balance animate-num";
  el.dataset.key   = "header-bal";
  el.dataset.value = String(bal);
  el.textContent   = fmtAbs(bal);

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

// ── 口座残高インライン編集は廃止 ─────────────────

// ── Folder Card ───────────────────────────
const SIZE_LABELS = { sm: "1×1", md: "2×1", tall: "1×2", lg: "2×2" };
const SIZE_ORDER  = ["sm", "md", "tall", "lg"];

function cycleSize(id) {
  const f = state.folders.find(x => x.id === id);
  if (!f) return;
  const i = SIZE_ORDER.indexOf(f.size || "md");
  f.size  = SIZE_ORDER[(i + 1) % SIZE_ORDER.length];
  saveState(); render();
}

function renderFolderCard(f) {
  const size  = f.size  || "md";
  const color = f.color || TYPE_COLORS[f.type] || TYPE_COLORS.custom;
  const pl    = folderNetPL(f.id);
  const fIn   = folderIn(f.id);
  const fOut  = folderOut(f.id);
  const ti    = typeInfo(f);
  const handle   = `<span class="drag-handle" onpointerdown="startDrag(event,'${f.id}')">⠿</span>`;
  const sizePill = `<button class="btn-size-badge" onclick="cycleSize('${f.id}')">${SIZE_LABELS[size]||"中"}</button>`;

  if (size === "sm") {
    return `
    <div class="folder-card" data-size="sm" data-folder-id="${f.id}" style="--card-color:${color}">
      ${sizePill}
      <div class="fc-sm">
        <div class="fc-sm-top">
          ${handle}
          <span class="fc-sm-icon">${ti.icon}</span>
          <button class="fc-sm-gear" onclick="showEditFolder('${f.id}')">⚙</button>
        </div>
        <div class="fc-sm-name">${esc(f.name)}</div>
        <div class="fc-sm-bal folder-balance ${pl >= 0 ? "positive" : "negative"} animate-num" data-key="bal-${f.id}" data-value="${pl}">${fmtMoney(pl)}</div>
      </div>
    </div>`;
  }

  return `
  <div class="folder-card" data-size="${size}" data-folder-id="${f.id}" style="--card-color:${color}">
    ${sizePill}
    <div class="folder-card-header">
      ${handle}
      <span class="folder-icon">${ti.icon}</span>
      <span class="folder-name">${esc(f.name)}</span>
    </div>
    <div class="folder-stats-row">
      <div class="folder-stat">
        <span class="folder-stat-label">入金</span>
        <span class="folder-stat-value positive animate-num" data-key="in-${f.id}" data-value="${fIn}">${fmtAbs(fIn)}</span>
      </div>
      <div class="folder-stat">
        <span class="folder-stat-label">出金</span>
        <span class="folder-stat-value negative animate-num" data-key="out-${f.id}" data-value="${fOut}">${fmtAbs(fOut)}</span>
      </div>
      <div class="folder-stat">
        <span class="folder-stat-label">残高</span>
        <span class="folder-stat-value balance-big folder-balance ${pl >= 0 ? "positive" : "negative"} animate-num" data-key="bal-${f.id}" data-value="${pl}">${fmtMoney(pl)}</span>
      </div>
    </div>
    <div class="folder-actions">
      <button class="btn-icon" onclick="showEditFolder('${f.id}')">✏️</button>
      <button class="btn-icon btn-danger" onclick="confirmDelete('${f.id}')">🗑️</button>
    </div>
  </div>`;
}

// ── Budget Assignment ─────────────────────
function assignBudget(folderId, amount, isReturn) {
  const val = isReturn ? -Math.abs(amount) : Math.abs(amount);
  state.unallocated -= val;
  state.transactions.push({
    id: genId(),
    category: "transfer",
    folderId: isReturn ? folderId : "unallocated",
    toFolderId: isReturn ? "unallocated" : folderId,
    amount: Math.abs(amount),
    date: today(),
    createdAt: Date.now()
  });
  saveState(); render();
}

function showAssignModal() {
  const opts = state.folders.map(f => `<option value="${f.id}">${typeInfo(f).icon} ${esc(f.name)}</option>`).join("");
  openModal(`
    <p class="modal-title">資金を分配</p>
    <label class="modal-label">フォルダ</label>
    <select class="modal-select" id="m-assign-folder">${opts}</select>
    <label class="modal-label">金額</label>
    <div class="amount-input-wrap"><input type="number" id="m-assign-amount" placeholder="0" min="0" inputmode="numeric"><span class="currency">円</span></div>
    <div class="modal-actions">
      <button class="btn-secondary" onclick="closeModal()">キャンセル</button>
      <button class="btn-primary" onclick="doAssign()">分配する</button>
    </div>`);
}
function doAssign() {
  const folderId = document.getElementById("m-assign-folder")?.value;
  const amount = parseFloat(document.getElementById("m-assign-amount")?.value);
  if (!folderId || !amount || amount <= 0) return;
  if (state.unallocated < amount) { showToast("未割当資金が不足しています"); return; }
  assignBudget(folderId, amount, false);
  closeModal();
  showToast(amount.toLocaleString() + "円 を分配しました");
}

// ── Home ──────────────────────────────────
function renderHome() {
  const cards = state.folders.map(renderFolderCard).join("");

  return `
    <div class="home-view">
      <div class="unallocated-card" style="background:var(--surface-card);border-radius:var(--radius-xl);padding:20px;box-shadow:var(--shadow-card);margin-bottom:20px;text-align:center;">
        <div class="unallocated-label" style="font-size:11px;font-weight:700;color:var(--ink-3);letter-spacing:1px;text-transform:uppercase;margin-bottom:6px;">未割当資金</div>
        <div class="unallocated-num" style="font-size:32px;font-weight:800;margin-bottom:12px;">${fmtAbs(state.unallocated)}</div>
        <button class="btn-primary" onclick="showAssignModal()">分配する</button>
      </div>
      <div class="folder-grid">${cards}</div>
      <button class="btn-add-folder" onclick="showAddFolder()">＋ フォルダを追加</button>
      <button class="btn-reset-link" onclick="confirmReset()">全データをリセット</button>
    </div>`;
}

// ── Record ────────────────────────────────
function setRecordType(type) {
  recordType = type;
  document.querySelectorAll("#btn-out,#btn-in").forEach(b => b.classList.remove("active"));
  const btn = document.getElementById("btn-" + type);
  if (btn) btn.classList.add("active");
}

function setRecordCategory(cat) {
  recordCategory = cat;
  if (activeTab === "record") {
    document.getElementById("content").innerHTML = renderRecord();
  }
}

function renderRecord() {
  if (!state.folders.length) return `
    <div class="empty-state">
      <p>先にフォルダを作成してください</p>
      <button class="btn-primary" onclick="switchTab('home')">ホームへ</button>
    </div>`;

  if (!recordFolder || !state.folders.find(f => f.id === recordFolder))
    recordFolder = state.folders[0].id;

  const options = state.folders.map(f =>
    `<option value="${f.id}" ${f.id === recordFolder ? "selected" : ""}>${typeInfo(f).icon} ${esc(f.name)}</option>`
  ).join("");

  const otherOpts = state.folders
    .filter(f => f.id !== recordFolder)
    .map(f => `<option value="${f.id}">${typeInfo(f).icon} ${esc(f.name)}</option>`)
    .join("");

  const isTransfer = recordCategory === "transfer";

  const recent = [...state.transactions]
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 15);

  const recentHtml = !recent.length
    ? `<p class="no-records">記録がありません</p>`
    : recent.map(t => {
        const f   = state.folders.find(x => x.id === t.folderId);
        const ti  = typeInfo(f);
        const isT = t.category === "transfer";
        const toF = isT ? state.folders.find(x => x.id === t.toFolderId) : null;
        const folderLabel = isT
          ? `↔ ${ti.icon}${esc(f?.name||"?")} → ${typeInfo(toF).icon}${esc(toF?.name||"?")}`
          : `${ti.icon} ${esc(f ? f.name : "削除済み")}`;
        const amtClass = isT ? "" : (t.amount >= 0 ? "positive" : "negative");
        const amtStr   = isT
          ? Math.abs(t.amount).toLocaleString() + "円 移動"
          : (t.amount >= 0 ? "+" : "−") + Math.abs(t.amount).toLocaleString() + "円";
        return `
        <div class="record-item ${isT ? "transfer" : (t.amount >= 0 ? "in" : "out")}">
          <div class="record-left">
            <span class="record-folder">${folderLabel}</span>
            ${t.memo ? `<span class="record-note">${esc(t.memo)}</span>` : ""}
            <span class="record-date">${fmtDate(t.date)}</span>
          </div>
          <div class="record-right">
            <div class="record-amount ${amtClass}">${amtStr}</div>
            <button class="btn-record-del" onclick="confirmDeleteTx('${t.id}')">✕</button>
          </div>
        </div>`;
      }).join("");

  return `
    <div class="record-view">
      <div class="record-form">
        <div class="form-group">
          <label>カテゴリ</label>
          <div class="type-toggle">
            <button class="toggle-btn ${recordCategory==="normal"  ?"active":""}" id="rcat-normal"   onclick="setRecordCategory('normal')">通常</button>
            <button class="toggle-btn ${recordCategory==="transfer"?"active":""}" id="rcat-transfer" onclick="setRecordCategory('transfer')">移動</button>
            <button class="toggle-btn ${recordCategory==="other"   ?"active":""}" id="rcat-other"    onclick="setRecordCategory('other')">その他</button>
          </div>
        </div>
        ${!isTransfer ? `
        <div class="form-group">
          <label>種別</label>
          <div class="type-toggle">
            <button class="toggle-btn ${recordType==="out"?"active":""}" id="btn-out" onclick="setRecordType('out')">📤 出金（損失）</button>
            <button class="toggle-btn ${recordType==="in" ?"active":""}" id="btn-in"  onclick="setRecordType('in')">💰 入金（利益）</button>
          </div>
        </div>` : ""}
        <div class="form-group">
          <label>${isTransfer ? "移動元フォルダ" : "フォルダ"}</label>
          <select id="rec-folder" onchange="recordFolder=this.value">${options}</select>
        </div>
        ${isTransfer ? `
        <div class="form-group">
          <label>移動先フォルダ</label>
          <select id="rec-to-folder">${otherOpts || '<option disabled>他のフォルダがありません</option>'}</select>
        </div>` : ""}
        <div class="form-group">
          <label>金額</label>
          <div class="amount-input-wrap">
            <input type="number" id="rec-amount" placeholder="0" min="0" inputmode="numeric">
            <span class="currency">円</span>
          </div>
        </div>
        <div class="form-group">
          <label>メモ（任意）</label>
          <input type="text" id="rec-memo" placeholder="例：川崎記念 6R・おばあちゃんのお小遣い">
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

function submitRecord() {
  const folderId   = document.getElementById("rec-folder")?.value || recordFolder;
  const amtRaw     = parseFloat(document.getElementById("rec-amount")?.value || "0");
  const toFolderId = document.getElementById("rec-to-folder")?.value || "";
  const memo       = document.getElementById("rec-memo")?.value?.trim() || "";
  const date       = document.getElementById("rec-date")?.value || today();

  if (!folderId) { showToast("フォルダを選択してください"); return; }
  if (!amtRaw || amtRaw <= 0) { showToast("金額を入力してください"); return; }
  if (recordCategory === "transfer") {
    if (!toFolderId || toFolderId === folderId) { showToast("移動先フォルダを選択してください"); return; }
  }

  const amount = recordCategory === "transfer" ? amtRaw
               : recordType === "in"           ? amtRaw
               : -amtRaw;

  const tx = { id: genId(), folderId, amount, category: recordCategory, memo, date, createdAt: Date.now() };
  if (recordCategory === "transfer") tx.toFolderId = toFolderId;
  state.transactions.push(tx);
  recordFolder = folderId;
  localStorage.removeItem("cyclon_balance_override");
  saveState();

  document.getElementById("rec-amount").value = "";
  const memoEl = document.getElementById("rec-memo");
  if (memoEl) memoEl.value = "";

  const msg = recordCategory === "transfer"
    ? amtRaw.toLocaleString() + "円 を移動しました"
    : (amount >= 0 ? "+" : "−") + Math.abs(amount).toLocaleString() + "円 記録しました";
  showToast(msg);
  render();
}

// ── Stats ─────────────────────────────────
function renderStats() {
  const nonTx = state.transactions.filter(t => t.category !== "transfer");
  if (!nonTx.length) return `
    <div class="empty-state">
      <div class="empty-icon">📊</div>
      <p>記録がありません</p>
    </div>`;

  const totalIn  = nonTx.filter(t => t.amount > 0).reduce((s, t) => s + t.amount, 0);
  const totalOut = nonTx.filter(t => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0);
  const net      = totalIn - totalOut;
  const recovery = totalOut > 0 ? Math.round(totalIn / totalOut * 100) : 0;
  const streak   = calcStreak();

  const folderRows = state.folders.map(f => {
    const txs  = nonTx.filter(t => t.folderId === f.id);
    if (!txs.length) return null;
    const fIn  = txs.filter(t => t.amount > 0).reduce((s, t) => s + t.amount, 0);
    const fOut = txs.filter(t => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0);
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

  const monthMap = {};
  state.transactions.forEach(t => {
    if (t.category === "transfer" || !t.date) return;
    const key = t.date.slice(0, 7);
    if (!monthMap[key]) monthMap[key] = 0;
    monthMap[key] += t.amount;
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
    if (t.category === "transfer") return;
    const key = (t.date || "0000-00-00") + "_" + t.folderId;
    if (!sessions[key]) sessions[key] = { date: t.date || "0000-00-00", net: 0 };
    sessions[key].net += (t.amount || 0);
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

// ── Tab ───────────────────────────────────
function switchTab(tab) { activeTab = tab; render(); window.scrollTo(0, 0); }

// ── クイック記録 FAB ──────────────────────
function showQuickRecord() {
  if (!state.folders.length) { showToast("先にフォルダを作成してください"); return; }
  const opts = state.folders.map(f =>
    `<option value="${f.id}" ${f.id === recordFolder ? "selected" : ""}>${typeInfo(f).icon} ${esc(f.name)}</option>`
  ).join("");
  openModal(`
    <p class="modal-title">収支を記録</p>
    <div class="type-toggle" style="margin-bottom:14px">
      <button class="toggle-btn ${recordType==="out"?"active":""}" id="qr-out" onclick="setQRType('out')">📤 出金</button>
      <button class="toggle-btn ${recordType==="in" ?"active":""}" id="qr-in"  onclick="setQRType('in')">💰 入金</button>
    </div>
    <label class="modal-label">フォルダ</label>
    <select class="modal-select" id="qr-folder">${opts}</select>
    <label class="modal-label" style="margin-top:14px">金額</label>
    <div class="amount-input-wrap">
      <input type="number" id="qr-amount" placeholder="0" min="0" inputmode="numeric">
      <span class="currency">円</span>
    </div>
    <div class="modal-actions">
      <button class="btn-secondary" onclick="closeModal()">キャンセル</button>
      <button class="btn-primary"   onclick="submitQuickRecord()">記録する</button>
    </div>`);
  setTimeout(() => document.getElementById("qr-amount")?.focus(), 120);
}
function setQRType(type) {
  recordType = type;
  ["out","in"].forEach(t => {
    const b = document.getElementById("qr-" + t);
    if (b) b.classList.toggle("active", t === type);
  });
}
function submitQuickRecord() {
  const folderId = document.getElementById("qr-folder")?.value || recordFolder;
  const amtRaw   = parseFloat(document.getElementById("qr-amount")?.value || "0");
  if (!amtRaw || amtRaw <= 0) { showToast("金額を入力してください"); return; }
  const amount = recordType === "in" ? amtRaw : -amtRaw;
  state.transactions.push({ id: genId(), folderId, amount, category: "normal", memo: "", date: today(), createdAt: Date.now() });
  recordFolder = folderId;
  saveState(); closeModal();
  showToast((amount >= 0 ? "+" : "−") + Math.abs(amount).toLocaleString() + "円 記録しました");
  render();
}

// ── 記録削除 ──────────────────────────────
function confirmDeleteTx(id) {
  const t = state.transactions.find(x => x.id === id);
  if (!t) return;
  const amtStr = t.category === "transfer"
    ? Math.abs(t.amount).toLocaleString() + "円 移動"
    : (t.amount >= 0 ? "+" : "−") + Math.abs(t.amount).toLocaleString() + "円";
  openModal(`
    <p class="modal-title">記録を削除</p>
    <p style="font-size:14px;color:#666;margin-bottom:16px;">${amtStr} の記録を削除しますか？</p>
    <div class="modal-actions">
      <button class="btn-secondary"      onclick="closeModal()">キャンセル</button>
      <button class="btn-danger-outline" onclick="deleteTx('${id}')">削除する</button>
    </div>`);
}
function deleteTx(id) {
  state.transactions = state.transactions.filter(t => t.id !== id);
  saveState(); closeModal(); showToast("記録を削除しました"); render();
}

// ── 全初期化 ──────────────────────────────
function confirmReset() {
  openModal(`
    <p class="modal-title">⚠️ 全データを初期化</p>
    <p style="font-size:14px;color:#666;margin-bottom:16px;">すべての記録・フォルダが削除されます。この操作は取り消せません。</p>
    <div class="modal-actions">
      <button class="btn-secondary"      onclick="closeModal()">キャンセル</button>
      <button class="btn-danger-outline" onclick="confirmReset2()">次へ →</button>
    </div>`);
}
function confirmReset2() {
  document.getElementById("modal-content").innerHTML = `
    <p class="modal-title">本当に削除しますか？</p>
    <p style="font-size:14px;color:var(--negative);margin-bottom:16px;font-weight:700;">全データが完全に消えます。</p>
    <div class="modal-actions">
      <button class="btn-secondary"      onclick="closeModal()">キャンセル</button>
      <button class="btn-danger-outline" onclick="doReset()">全削除する</button>
    </div>`;
}
function doReset() {
  ["cyclon_account","cyclon_folders","cyclon_transactions","cyclon_balance_override"].forEach(k => localStorage.removeItem(k));
  state = loadState();
  closeModal(); showToast("データを初期化しました"); render();
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
  state.folders.push({ id: genId(), name, type, size: "md", color: TYPE_COLORS[type] || TYPE_COLORS.custom, createdAt: Date.now() });
  saveState(); closeModal();
  showToast("フォルダを作成しました");
  render();
}
function showEditFolder(id) {
  const f = state.folders.find(x => x.id === id);
  if (!f) return;
  const color    = f.color || TYPE_COLORS[f.type] || TYPE_COLORS.custom;
  const sizeOpts = [["sm","小（1×1）"],["md","中（2×1）"],["tall","縦（1×2）"],["lg","大（2×2）"]]
    .map(([v,l]) => `<option value="${v}" ${(f.size||"md")===v?"selected":""}>${l}</option>`).join("");
  const swatches = CARD_PRESETS
    .map(c => `<button type="button" onclick="document.getElementById('m-color').value='${c}'" style="width:28px;height:28px;background:${c};border-radius:50%;border:2px solid rgba(0,0,0,0.1);flex-shrink:0"></button>`)
    .join("");
  openModal(`
    <p class="modal-title">フォルダを編集</p>
    <label class="modal-label">名前</label>
    <input class="modal-input" id="m-rename" value="${esc(f.name)}" maxlength="20">
    <label class="modal-label" style="margin-top:14px">カードサイズ</label>
    <select class="modal-select" id="m-size">${sizeOpts}</select>
    <label class="modal-label" style="margin-top:14px">カードカラー</label>
    <div style="display:flex;align-items:center;gap:10px;margin-top:6px;flex-wrap:wrap">
      <input type="color" id="m-color" value="${color}" style="width:40px;height:40px;border:none;border-radius:8px;cursor:pointer;padding:2px;flex-shrink:0">
      <div style="display:flex;gap:6px;flex-wrap:wrap">${swatches}</div>
    </div>
    <div class="modal-actions">
      <button class="btn-secondary" onclick="closeModal()">キャンセル</button>
      <button class="btn-primary"   onclick="saveEditFolder('${id}')">保存</button>
    </div>`);
}
function saveEditFolder(id) {
  const name  = document.getElementById("m-rename")?.value?.trim();
  const size  = document.getElementById("m-size")?.value  || "md";
  const color = document.getElementById("m-color")?.value || "#ff6600";
  if (!name) { document.getElementById("m-rename").focus(); return; }
  const f = state.folders.find(x => x.id === id);
  if (f) { f.name = name; f.size = size; f.color = color; saveState(); }
  closeModal(); showToast("保存しました"); render();
}
function confirmDelete(id) {
  const f   = state.folders.find(x => x.id === id);
  const cnt = state.transactions.filter(t => t.folderId === id).length;
  openModal(`
    <p class="modal-title">「${esc(f.name)}」を削除</p>
    <p style="font-size:14px;color:#666;margin-bottom:8px;">${cnt}件の記録が削除されます。この操作は取り消せません。</p>
    <div class="modal-actions">
      <button class="btn-secondary"      onclick="closeModal()">キャンセル</button>
      <button class="btn-danger-outline" onclick="deleteFolder('${id}')">削除する</button>
    </div>`);
}
function deleteFolder(id) {
  state.folders      = state.folders.filter(f => f.id !== id);
  state.transactions = state.transactions.filter(t => t.folderId !== id && t.toFolderId !== id);
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
