(function () {
  "use strict";

  var TABLE = "repair_requests";
  var LIST_LIMIT = 20;

  var form = document.getElementById("repair-form");
  var submitBtn = document.getElementById("submit-btn");
  var formMessage = document.getElementById("form-message");
  var list = document.getElementById("repair-list");
  var listMessage = document.getElementById("list-message");
  var refreshBtn = document.getElementById("refresh-btn");

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

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text; // 一律用 textContent，避免 XSS
    return node;
  }

  function renderList(rows) {
    list.replaceChildren();
    if (!rows.length) {
      listMessage.textContent = "目前還沒有報修。";
      listMessage.hidden = false;
      return;
    }
    listMessage.hidden = true;
    rows.forEach(function (r) {
      var li = el("li");
      var top = el("div", "item-top");
      top.appendChild(el("span", "tag", r.category));
      top.appendChild(el("span", "tag urgency-" + r.urgency, "緊急：" + r.urgency));
      top.appendChild(el("span", "tag", r.status));
      li.appendChild(top);
      li.appendChild(el("p", "item-desc", r.description));
      li.appendChild(el("div", "item-meta",
        r.reporter_name + "｜" + r.location + "｜" + formatTime(r.created_at)));
      list.appendChild(li);
    });
  }

  async function loadList() {
    refreshBtn.disabled = true;
    listMessage.hidden = false;
    listMessage.textContent = "載入中…";
    try {
      var res = await client
        .from(TABLE)
        .select("id, created_at, reporter_name, location, category, description, urgency, status")
        .order("created_at", { ascending: false })
        .limit(LIST_LIMIT);
      if (res.error) throw res.error;
      renderList(res.data || []);
    } catch (err) {
      console.error(err);
      list.replaceChildren();
      listMessage.textContent = "清單載入失敗：" + (err.message || "請稍後再試");
    } finally {
      refreshBtn.disabled = false;
    }
  }

  function readForm() {
    var fd = new FormData(form);
    return {
      reporter_name: String(fd.get("reporter_name") || "").trim(),
      location: String(fd.get("location") || "").trim(),
      category: String(fd.get("category") || ""),
      description: String(fd.get("description") || "").trim(),
      urgency: String(fd.get("urgency") || "中"),
    };
  }

  function validate(row) {
    if (!row.reporter_name) return "請填寫報修人。";
    if (!row.location) return "請填寫地點或部門。";
    if (["設備", "網路", "環境", "其他"].indexOf(row.category) < 0) return "請選擇類別。";
    if (!row.description) return "請填寫問題說明。";
    if (["低", "中", "高"].indexOf(row.urgency) < 0) return "請選擇緊急程度。";
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

    submitBtn.disabled = true;
    submitBtn.textContent = "送出中…";
    try {
      // 只送這 5 個欄位；id、created_at、status 由資料庫預設值產生
      var res = await client.from(TABLE).insert(row);
      if (res.error) throw res.error;
      showFormMessage("已送出報修，謝謝！", "ok");
      form.reset();
      await loadList();
    } catch (err) {
      console.error(err);
      showFormMessage("送出失敗：" + (err.message || "請稍後再試"), "error");
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "送出報修";
    }
  });

  refreshBtn.addEventListener("click", loadList);
  loadList();
})();
