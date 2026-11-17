(function () {
  "use strict";

  var TABLE = "renovation_items";
  var LIST_LIMIT = 50;
  var SUMMARY_LIMIT = 1000;
  var SPACES = ["客廳", "餐廳", "廚房", "浴室", "臥室", "陽台", "樓梯", "屋頂", "外牆", "全室", "其他"];
  var TRADES = ["拆除", "水電", "泥作", "防水", "木作", "油漆", "門窗", "鐵件", "系統櫃", "其他"];
  var PRIORITIES = ["低", "中", "高"];
  var MAX_BUDGET = 100000000;
  var PHOTO_TABLE = "renovation_photos";
  var BUCKET = "renovation-photos";
  var MAX_PHOTOS = 6;          // 每個工項最多幾張（資料庫也有同樣限制）
  var PHOTO_MAX_SIDE = 1600;   // 上傳前把長邊縮到這個像素
  var PHOTO_MAX_BYTES = 2 * 1024 * 1024;

  var form = document.getElementById("item-form");
  var submitBtn = document.getElementById("submit-btn");
  var formMessage = document.getElementById("form-message");
  var list = document.getElementById("item-list");
  var listMessage = document.getElementById("list-message");
  var refreshBtn = document.getElementById("refresh-btn");
  var installBtn = document.getElementById("install-btn");
  var offlineBanner = document.getElementById("offline-banner");
  var photoInput = document.getElementById("photos");
  var photoPreview = document.getElementById("photo-preview");
  var addPhotoInput = document.getElementById("add-photo-input");
  var pendingPhotos = [];      // 表單裡選好、還沒上傳的照片（File）
  var addPhotoTarget = null;   // 「加照片」目前針對的工項
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

      var photos = (r.renovation_photos || []).slice().sort(function (a, b) {
        return String(a.created_at).localeCompare(String(b.created_at));
      });
      if (photos.length) {
        var thumbs = el("div", "thumbs");
        photos.forEach(function (ph, i) {
          var url = client.storage.from(BUCKET).getPublicUrl(ph.path).data.publicUrl;
          var a = el("a", "thumb");
          a.href = url;
          a.target = "_blank";
          a.rel = "noopener";
          var img = el("img");
          img.src = url;
          img.alt = r.title + " 照片 " + (i + 1);
          img.loading = "lazy";
          a.appendChild(img);
          thumbs.appendChild(a);
        });
        li.appendChild(thumbs);
      }
      if (photos.length < MAX_PHOTOS) {
        var addBtn = el("button", "secondary small add-photo-btn", "＋ 加照片");
        addBtn.type = "button";
        addBtn.addEventListener("click", function () {
          addPhotoTarget = { id: r.id, title: r.title, count: photos.length, button: addBtn };
          addPhotoInput.value = "";
          addPhotoInput.click();
        });
        li.appendChild(addBtn);
      }
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
      .select("id, created_at, recorder_name, space, trade, title, note, budget, contractor, priority, status, " +
        PHOTO_TABLE + "(path, created_at)")
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

  // ---- 照片：縮圖、轉 JPEG（同時去掉 GPS 等 EXIF 資訊）、上傳 ----
  function loadImage(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error("無法讀取圖片「" + file.name + "」")); };
      img.src = url;
    });
  }

  function canvasToBlob(canvas, quality) {
    return new Promise(function (resolve) { canvas.toBlob(resolve, "image/jpeg", quality); });
  }

  async function compressPhoto(file) {
    var img = await loadImage(file);
    var scale = Math.min(1, PHOTO_MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    var canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    var ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff"; // 透明背景（PNG）轉 JPEG 時補白底
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    var qualities = [0.82, 0.7, 0.55];
    for (var i = 0; i < qualities.length; i++) {
      var blob = await canvasToBlob(canvas, qualities[i]);
      if (blob && blob.size <= PHOTO_MAX_BYTES) return blob;
    }
    throw new Error("圖片「" + file.name + "」太大，請換一張。");
  }

  // 上傳多張照片到某個工項；回傳成功張數，失敗時拋出第一個錯誤
  async function uploadPhotos(itemId, files, onProgress) {
    var done = 0;
    for (var i = 0; i < files.length; i++) {
      if (onProgress) onProgress(i + 1, files.length);
      var blob = await compressPhoto(files[i]);
      var path = itemId + "/" + crypto.randomUUID() + ".jpg";
      var up = await client.storage.from(BUCKET).upload(path, blob, {
        contentType: "image/jpeg",
        upsert: false,
      });
      if (up.error) throw up.error;
      var res = await client.from(PHOTO_TABLE).insert({ item_id: itemId, path: path });
      if (res.error) throw res.error;
      done += 1;
    }
    return done;
  }

  function pickImages(fileList) {
    return Array.prototype.filter.call(fileList || [], function (f) {
      return /^image\//.test(f.type) || /\.(jpe?g|png|webp|heic|heif|gif)$/i.test(f.name);
    });
  }

  function renderPreview() {
    photoPreview.replaceChildren();
    pendingPhotos.forEach(function (file, i) {
      var box = el("div", "thumb");
      var img = el("img");
      img.src = URL.createObjectURL(file);
      img.alt = "待上傳照片 " + (i + 1);
      img.onload = function () { URL.revokeObjectURL(img.src); };
      box.appendChild(img);
      var rm = el("button", "thumb-remove", "×");
      rm.type = "button";
      rm.setAttribute("aria-label", "移除照片 " + (i + 1));
      rm.addEventListener("click", function () {
        pendingPhotos.splice(i, 1);
        renderPreview();
      });
      box.appendChild(rm);
      photoPreview.appendChild(box);
    });
  }

  photoInput.addEventListener("change", function () {
    var picked = pickImages(photoInput.files);
    photoInput.value = "";
    var room = MAX_PHOTOS - pendingPhotos.length;
    if (picked.length > room) {
      showFormMessage("每個工項最多 " + MAX_PHOTOS + " 張照片，多出的已略過。", "error");
    }
    pendingPhotos = pendingPhotos.concat(picked.slice(0, Math.max(0, room)));
    renderPreview();
  });

  addPhotoInput.addEventListener("change", async function () {
    var target = addPhotoTarget;
    addPhotoTarget = null;
    if (!target) return;
    var files = pickImages(addPhotoInput.files);
    addPhotoInput.value = "";
    if (!files.length) return;
    if (!navigator.onLine) {
      alert("目前離線，無法上傳照片。");
      return;
    }
    var room = MAX_PHOTOS - target.count;
    if (files.length > room) {
      alert("「" + target.title + "」最多還能加 " + room + " 張，多出的已略過。");
      files = files.slice(0, room);
    }
    target.button.disabled = true;
    try {
      await uploadPhotos(target.id, files, function (n, total) {
        target.button.textContent = "上傳中 " + n + "/" + total + "…";
      });
    } catch (err) {
      console.error(err);
      alert("照片上傳失敗：" + (err.message || "請稍後再試"));
    }
    await loadAll();
  });

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
      var res = await client.from(TABLE).insert(row).select("id").single();
      if (res.error) throw res.error;
      var keepName = row.recorder_name;
      var photos = pendingPhotos.slice();
      form.reset();
      form.elements.recorder_name.value = keepName; // 連續登記時不用重打名字
      pendingPhotos = [];
      renderPreview();

      var msg = "已新增工項「" + row.title + "」。";
      var msgType = "ok";
      if (photos.length) {
        try {
          await uploadPhotos(res.data.id, photos, function (n, total) {
            submitBtn.textContent = "上傳照片 " + n + "/" + total + "…";
          });
          msg = "已新增工項「" + row.title + "」與 " + photos.length + " 張照片。";
        } catch (photoErr) {
          console.error(photoErr);
          msg += "但照片上傳失敗（" + (photoErr.message || "請稍後再試") + "），可在清單用「加照片」補傳。";
          msgType = "error";
        }
      }
      showFormMessage(msg, msgType);
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
