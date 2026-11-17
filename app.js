(function () {
  "use strict";

  var TABLE = "renovation_items";
  var LIST_LIMIT = 50;
  var SUMMARY_LIMIT = 1000;
  var SPACES = ["客廳", "餐廳", "廚房", "浴室", "臥室", "陽台", "樓梯", "屋頂", "外牆", "全室", "其他"];
  var TRADES = ["拆除", "水電", "泥作", "防水", "木作", "油漆", "門窗", "鐵件", "系統櫃", "其他"];
  var PRIORITIES = ["低", "中", "高"];
  var MAX_BUDGET = 100000000;

  var form = document.getElementById("item-form");
  var submitBtn = document.getElementById("submit-btn");
  var formMessage = document.getElementById("form-message");
  var list = document.getElementById("item-list");
  var listMessage = document.getElementById("list-message");
  var refreshBtn = document.getElementById("refresh-btn");
  var installBtn = document.getElementById("install-btn");
  var offlineBanner = document.getElementById("offline-banner");
  var sumEls = {
    budget: document.getElementById("sum-budget"),
    count: document.getElementById("sum-count"),
    "規劃中": document.getElementById("sum-planned"),
    "施工中": document.getElementById("sum-doing"),
    "已完成": document.getElementById("sum-done"),
  };

  // ---- PWA：註冊 Service Worker、安裝按鈕、離線提示 ----
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("sw.js").catch(function (err) {
        console.warn("Service Worker 註冊失敗", err);
      });
    });
  }

  var installPrompt = null;
  window.addEventListener("beforeinstallprompt", function (e) {
    e.preventDefault();
    installPrompt = e;
    installBtn.hidden = false;
  });
  installBtn.addEventListener("click", async function () {
    if (!installPrompt) return;
    installPrompt.prompt();
    await installPrompt.userChoice;
    installPrompt = null;
    installBtn.hidden = true;
  });
  window.addEventListener("appinstalled", function () {
    installBtn.hidden = true;
  });

  function updateOnline() {
    offlineBanner.hidden = navigator.onLine;
  }
  window.addEventListener("online", function () {
    updateOnline();
    if (typeof loadAll === "function" && window.supabase) loadAll();
  });
  window.addEventListener("offline", updateOnline);
  updateOnline();

  var cfg = window.APP_CONFIG || {};
  if (!window.supabase || !cfg.supabaseUrl || !cfg.supabaseKey) {
    showFormMessage("系統載入失敗，請檢查網路後重新整理頁面。", "error");
    submitBtn.disabled = true;
    listMessage.textContent = "無法載入清單。";
    return;
  }

  var client = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  function showFormMessage(text, type) {
    formMessage.textContent = text;
    formMessage.className = "message " + type;
    formMessage.hidden = false;
  }

  function formatTime(iso) {
    var d = new Date(iso);
    if (isNaN(d)) return "";
    function pad(n) { return String(n).padStart(2, "0"); }
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) +
      " " + pad(d.getHours()) + ":" + pad(d.getMinutes());
  }

  function formatMoney(n) {
    return "NT$ " + Number(n || 0).toLocaleString("zh-TW");
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text; // 一律用 textContent，避免 XSS
    return node;
  }

  function renderList(rows) {
    list.replaceChildren();
    if (!rows.length) {
      listMessage.textContent = "目前還沒有工項，從上方表單新增第一筆吧。";
      listMessage.hidden = false;
      return;
    }
    listMessage.hidden = true;
    rows.forEach(function (r) {
      var li = el("li");
      var head = el("div", "item-head");
      head.appendChild(el("strong", "item-title", r.title));
      head.appendChild(el("span", "item-budget", formatMoney(r.budget)));
      li.appendChild(head);

      var tags = el("div", "item-top");
      tags.appendChild(el("span", "tag", r.space));
      tags.appendChild(el("span", "tag", r.trade));
      tags.appendChild(el("span", "tag priority-" + r.priority, "優先：" + r.priority));
      tags.appendChild(el("span", "tag status-" + r.status, r.status));
      li.appendChild(tags);

      if (r.note) li.appendChild(el("p", "item-desc", r.note));
      var meta = [r.recorder_name];
      if (r.contractor) meta.push("廠商：" + r.contractor);
      meta.push(formatTime(r.created_at));
      li.appendChild(el("div", "item-meta", meta.join("｜")));
      list.appendChild(li);
    });
  }

  function renderSummary(rows) {
    var total = 0;
    var counts = { "規劃中": 0, "施工中": 0, "已完成": 0 };
    rows.forEach(function (r) {
      total += Number(r.budget) || 0;
      if (counts[r.status] != null) counts[r.status] += 1;
    });
    sumEls.budget.textContent = formatMoney(total);
    sumEls.count.textContent = String(rows.length);
    Object.keys(counts).forEach(function (k) { sumEls[k].textContent = String(counts[k]); });
  }

  async function loadList() {
    var res = await client
      .from(TABLE)
      .select("id, created_at, recorder_name, space, trade, title, note, budget, contractor, priority, status")
      .order("created_at", { ascending: false })
      .limit(LIST_LIMIT);
    if (res.error) throw res.error;
    renderList(res.data || []);
  }

  async function loadSummary() {
    var res = await client.from(TABLE).select("budget, status").limit(SUMMARY_LIMIT);
    if (res.error) throw res.error;
    renderSummary(res.data || []);
  }

  async function loadAll() {
    refreshBtn.disabled = true;
    listMessage.hidden = false;
    listMessage.textContent = "載入中…";
    try {
      await Promise.all([loadList(), loadSummary()]);
    } catch (err) {
      console.error(err);
      list.replaceChildren();
      listMessage.hidden = false;
      listMessage.textContent = "清單載入失敗：" + (err.message || "請稍後再試");
    } finally {
      refreshBtn.disabled = false;
    }
  }

  function readForm() {
    var fd = new FormData(form);
    // 預算允許輸入「85,000」這類有逗號或空白的寫法
    var budgetText = String(fd.get("budget") || "").replace(/[,，\s]/g, "");
    return {
      recorder_name: String(fd.get("recorder_name") || "").trim(),
      space: String(fd.get("space") || ""),
      trade: String(fd.get("trade") || ""),
      title: String(fd.get("title") || "").trim(),
      note: String(fd.get("note") || "").trim(),
      budget: /^\d+$/.test(budgetText) ? Number(budgetText) : NaN,
      contractor: String(fd.get("contractor") || "").trim(),
      priority: String(fd.get("priority") || "中"),
    };
  }

  function validate(row) {
    if (!row.title) return "請填寫工項名稱。";
    if (SPACES.indexOf(row.space) < 0) return "請選擇空間。";
    if (TRADES.indexOf(row.trade) < 0) return "請選擇工種。";
    if (!Number.isInteger(row.budget) || row.budget < 0 || row.budget > MAX_BUDGET)
      return "預算請填 0 到 100,000,000 之間的整數。";
    if (PRIORITIES.indexOf(row.priority) < 0) return "請選擇優先程度。";
    if (!row.recorder_name) return "請填寫登記人。";
    return null;
  }

  form.addEventListener("submit", async function (e) {
    e.preventDefault();
    var row = readForm();
    var problem = validate(row);
    if (problem) {
      showFormMessage(problem, "error");
      return;
    }
    if (!navigator.onLine) {
      showFormMessage("目前離線，無法新增。請連上網路後再試，已填寫的內容會保留。", "error");
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = "新增中…";
    try {
      // 只送這 8 個欄位；id、created_at、status 由資料庫預設值產生
      var res = await client.from(TABLE).insert(row);
      if (res.error) throw res.error;
      showFormMessage("已新增工項「" + row.title + "」。", "ok");
      var keepName = row.recorder_name;
      form.reset();
      form.elements.recorder_name.value = keepName; // 連續登記時不用重打名字
      await loadAll();
    } catch (err) {
      console.error(err);
      showFormMessage("新增失敗：" + (err.message || "請稍後再試"), "error");
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "新增工項";
    }
  });

  refreshBtn.addEventListener("click", loadAll);
  loadAll();
})();
