(() => {
  "use strict";

  const CLASS_STRUCTURE = { 1: 7, 2: 7, 3: 8 };

  // ===== Storage Adapter（localStorage が使えない環境でも落ちないようにフォールバック）=====
  function createStorageAdapter() {
    const mem = new Map();

    const candidates = [];
    try { if (window.localStorage) candidates.push({ name: "localStorage", api: window.localStorage }); } catch {}
    try { if (window.sessionStorage) candidates.push({ name: "sessionStorage", api: window.sessionStorage }); } catch {}

    for (const c of candidates) {
      try {
        const k = "__test__" + Math.random();
        c.api.setItem(k, "1");
        c.api.getItem(k);
        c.api.removeItem(k);
        return {
          type: c.name,
          persistent: c.name === "localStorage",
          getItem: (key) => { try { return c.api.getItem(key); } catch { return mem.get(key) ?? null; } },
          setItem: (key, val) => { try { c.api.setItem(key, val); } catch { mem.set(key, val); } },
          removeItem: (key) => { try { c.api.removeItem(key); } catch { mem.delete(key); } },
        };
      } catch {
        // try next
      }
    }

    return {
      type: "memory",
      persistent: false,
      getItem: (key) => mem.get(key) ?? null,
      setItem: (key, val) => mem.set(key, val),
      removeItem: (key) => mem.delete(key),
    };
  }

  const storage = createStorageAdapter();

  // ===== State =====
  const state = {
    selectedGrade: 1,
    selectedClass: 1,
    layout: { rows: 6, cols: 6 },
    students: [],
    seats: [],
    history: [],
    view: "seating",
    showHistory: false,
    rotate180: true,
    csvEncoding: "UTF-8",

    // クリック配置/交換用の選択状態
    selection: null, // { kind:"student", studentId } | { kind:"seat", from:{row,col}, studentId } | null

    // Drag&Drop（効く環境では使える）
    draggedStudentId: null,
    draggedFromSeat: null,
  };

  // ===== DOM =====
  const el = {
    envBanner: document.getElementById("envBanner"),

    classButtons: document.getElementById("classButtons"),
    classTitle: document.getElementById("classTitle"),

    btnViewSeating: document.getElementById("btnViewSeating"),
    btnViewStudents: document.getElementById("btnViewStudents"),

    controlsSeating: document.getElementById("controlsSeating"),
    controlsStudents: document.getElementById("controlsStudents"),

    btnAutoArrange: document.getElementById("btnAutoArrange"),
    btnClearAll: document.getElementById("btnClearAll"),
    btnSaveHistory: document.getElementById("btnSaveHistory"),
    btnToggleHistory: document.getElementById("btnToggleHistory"),
    historyCount: document.getElementById("historyCount"),

    btnToggleRotate: document.getElementById("btnToggleRotate"),
    rotateState: document.getElementById("rotateState"),

    btnExportCsvSeating: document.getElementById("btnExportCsvSeating"),

    inputRows: document.getElementById("inputRows"),
    inputCols: document.getElementById("inputCols"),

    btnAddStudent: document.getElementById("btnAddStudent"),
    inputStudentsCsv: document.getElementById("inputStudentsCsv"),
    selectEncoding: document.getElementById("selectEncoding"),
    btnExportCsvStudents: document.getElementById("btnExportCsvStudents"),

    viewSeating: document.getElementById("viewSeating"),
    viewStudents: document.getElementById("viewStudents"),

    seatingCard: document.getElementById("seatingCard"),
    seatingGrid: document.getElementById("seatingGrid"),
    unassignedList: document.getElementById("unassignedList"),

    selectionInfo: document.getElementById("selectionInfo"),
    selectionText: document.getElementById("selectionText"),
    btnClearSelection: document.getElementById("btnClearSelection"),

    studentsCount: document.getElementById("studentsCount"),
    studentsTbody: document.getElementById("studentsTbody"),

    historyModal: document.getElementById("historyModal"),
    btnCloseHistory: document.getElementById("btnCloseHistory"),
    historyBody: document.getElementById("historyBody"),
    historyFoot: document.getElementById("historyFoot"),

    csvModal: document.getElementById("csvModal"),
    btnCloseCsv: document.getElementById("btnCloseCsv"),
    btnCopyCsv: document.getElementById("btnCopyCsv"),
    csvText: document.getElementById("csvText"),

    confirmDialog: document.getElementById("confirmDialog"),
    confirmMessage: document.getElementById("confirmMessage"),
    confirmOk: document.getElementById("confirmOk"),
    confirmCancel: document.getElementById("confirmCancel"),
    toast: document.getElementById("toast"),
  };

  // ===== iframe検出（Teams等の埋め込み環境） =====
  function isInIframe() {
    try { return window.self !== window.top; } catch { return true; }
  }

  // ===== カスタム確認ダイアログ（window.confirm()の代替） =====
  function showConfirm(message) {
    return new Promise((resolve) => {
      el.confirmMessage.textContent = message;
      el.confirmDialog.classList.remove("hidden");
      el.confirmOk.focus();

      function cleanup(result) {
        el.confirmDialog.classList.add("hidden");
        el.confirmOk.removeEventListener("click", onOk);
        el.confirmCancel.removeEventListener("click", onCancel);
        resolve(result);
      }
      function onOk() { cleanup(true); }
      function onCancel() { cleanup(false); }

      el.confirmOk.addEventListener("click", onOk);
      el.confirmCancel.addEventListener("click", onCancel);
    });
  }

  // ===== トースト通知（alert()の代替） =====
  let toastTimer = null;
  function showToast(message) {
    el.toast.textContent = message;
    el.toast.classList.remove("hidden");
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.toast.classList.add("hidden"), 2500);
  }

  // ===== Utils =====
  const deepClone = (obj) => JSON.parse(JSON.stringify(obj));

  function clampInt(v, min, max, def) {
    const n = parseInt(v, 10);
    if (Number.isNaN(n)) return def;
    return Math.min(max, Math.max(min, n));
  }

  function classKey() {
    return `${state.selectedGrade}-${state.selectedClass}`;
  }

  function makeSampleStudents(key, grade, classNum) {
    return Array.from({ length: 45 }, (_, i) => ({
      id: `${key}-${i + 1}`,
      name: `生徒${i + 1}`,
      attendanceNumber: i + 1,
      grade,
      classNumber: classNum,
    }));
  }

  function makeSeats(rows, cols) {
    const seats = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        seats.push({ row: r, col: c, studentId: null });
      }
    }
    return seats;
  }

  function seatIndex(row, col) {
    return row * state.layout.cols + col;
  }

  function normalizeLayout(layout) {
    const rows = clampInt(layout?.rows, 1, 10, 6);
    const cols = clampInt(layout?.cols, 1, 10, 6);
    return { rows, cols };
  }

  function parseBool(v, fallback) {
    if (v === null || v === undefined) return fallback;
    if (typeof v === "boolean") return v;
    if (typeof v === "string") {
      if (v.toLowerCase() === "true") return true;
      if (v.toLowerCase() === "false") return false;
    }
    return fallback;
  }

  function safeParse(json, fallback) {
    try {
      const v = JSON.parse(json);
      return (v === null || v === undefined) ? fallback : v;
    } catch {
      return fallback;
    }
  }

  function assignedSeatOfStudent(studentId) {
    return state.seats.find((s) => s.studentId === studentId) || null;
  }

  function unassignedStudents() {
    const assigned = new Set(state.seats.filter((s) => s.studentId).map((s) => s.studentId));
    return state.students.filter((st) => !assigned.has(st.id));
  }

  function cleanupSeatInvalidStudentIds() {
    const ids = new Set(state.students.map((s) => s.id));
    state.seats = state.seats.map((seat) => {
      if (!seat.studentId) return seat;
      return ids.has(seat.studentId) ? seat : { ...seat, studentId: null };
    });
  }

  function ensureSeatsMatchLayout(savedSeatsMaybe) {
    const expected = state.layout.rows * state.layout.cols;
    if (Array.isArray(state.seats) && state.seats.length === expected) {
      cleanupSeatInvalidStudentIds();
      return;
    }

    const map = new Map();
    if (Array.isArray(savedSeatsMaybe)) {
      for (const s of savedSeatsMaybe) {
        if (typeof s?.row === "number" && typeof s?.col === "number") {
          map.set(`${s.row}-${s.col}`, s.studentId ?? null);
        }
      }
    }

    state.seats = makeSeats(state.layout.rows, state.layout.cols).map((seat) => ({
      ...seat,
      studentId: map.get(`${seat.row}-${seat.col}`) ?? null,
    }));
    cleanupSeatInvalidStudentIds();
  }

  function showEnvBannerIfNeeded() {
    if (storage.type === "memory") {
      el.envBanner.textContent = "この環境では保存領域(localStorage)が利用できません。ページを閉じるとデータが消える可能性があります。";
      el.envBanner.classList.remove("hidden");
    } else {
      el.envBanner.classList.add("hidden");
    }
  }

  // ===== Persistence =====
  async function loadData() {
    const key = classKey();
    let serverData = null;

    try {
      const res = await fetch(`/api/class/${state.selectedGrade}/${state.selectedClass}`);
      if (res.ok) serverData = await res.json();
    } catch {
      // API 未接続時は localStorage にフォールバック
    }

    if (serverData) {
      state.rotate180  = parseBool(serverData.rotate180, true);
      state.layout     = normalizeLayout(serverData.layout || {});
      state.students   = Array.isArray(serverData.students) ? serverData.students
                          : makeSampleStudents(key, state.selectedGrade, state.selectedClass);
      const savedSeats = Array.isArray(serverData.seats) ? serverData.seats : [];
      state.seats      = savedSeats;
      ensureSeatsMatchLayout(savedSeats);
      state.history    = Array.isArray(serverData.history) ? serverData.history : [];
    } else {
      // localStorage フォールバック
      const savedLayoutJson   = storage.getItem(`layout-${key}`);
      const savedStudentsJson = storage.getItem(`students-${key}`);
      const savedSeatsJson    = storage.getItem(`seats-${key}`);
      const savedHistoryJson  = storage.getItem(`history-${key}`);
      const savedRotate       = storage.getItem(`rotate-${key}`);

      state.rotate180 = parseBool(savedRotate, state.rotate180);
      state.layout    = normalizeLayout(savedLayoutJson ? safeParse(savedLayoutJson, state.layout) : state.layout);

      if (savedStudentsJson) {
        state.students = safeParse(savedStudentsJson, []);
      } else {
        state.students = makeSampleStudents(key, state.selectedGrade, state.selectedClass);
      }

      let savedSeats = null;
      if (savedSeatsJson) {
        savedSeats  = safeParse(savedSeatsJson, []);
        state.seats = Array.isArray(savedSeats) ? savedSeats : [];
      } else {
        state.seats = [];
      }
      ensureSeatsMatchLayout(savedSeats);
      state.history = savedHistoryJson ? safeParse(savedHistoryJson, []) : [];
    }

    el.inputRows.value = String(state.layout.rows);
    el.inputCols.value = String(state.layout.cols);
    state.selection         = null;
    state.draggedStudentId  = null;
    state.draggedFromSeat   = null;
  }

  function persistData() {
    const key = classKey();
    // localStorage キャッシュ（オフライン対応）
    storage.setItem(`students-${key}`, JSON.stringify(state.students));
    storage.setItem(`seats-${key}`,    JSON.stringify(state.seats));
    storage.setItem(`layout-${key}`,   JSON.stringify(state.layout));
    storage.setItem(`history-${key}`,  JSON.stringify(state.history));
    storage.setItem(`rotate-${key}`,   String(state.rotate180));

    // サーバーに保存（fire-and-forget）
    fetch(`/api/class/${state.selectedGrade}/${state.selectedClass}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        layout:    state.layout,
        students:  state.students,
        seats:     state.seats,
        history:   state.history,
        rotate180: state.rotate180,
      }),
    }).catch(() => {}); // API 未接続時は無視
  }

  // ===== History =====
  function saveToHistory(description) {
    const item = {
      id: Date.now(),
      date: new Date().toLocaleString("ja-JP"),
      description: String(description || ""),
      seatArrangement: deepClone(state.seats),
      students: deepClone(state.students),
    };
    state.history = [item, ...state.history].slice(0, 20);
    persistData();
    render();
  }

  function restoreFromHistory(item) {
    state.seats = deepClone(item.seatArrangement || []);
    state.students = deepClone(item.students || []);
    ensureSeatsMatchLayout(state.seats);
    state.showHistory = false;
    state.selection = null;
    persistData();
    render();
  }

  function deleteHistory(id) {
    state.history = state.history.filter((h) => h.id !== id);
    persistData();
    render();
  }

  // ===== Students CRUD =====
  function addStudent() {
    const key = classKey();
    const maxAtt = state.students.reduce((m, s) => Math.max(m, Number(s.attendanceNumber) || 0), 0);
    state.students.push({
      id: `${key}-${Date.now()}`,
      name: "新しい生徒",
      attendanceNumber: maxAtt + 1,
      grade: state.selectedGrade,
      classNumber: state.selectedClass,
    });
    persistData();
    render();
  }

  function updateStudent(id, field, value) {
    state.students = state.students.map((s) => (s.id === id ? { ...s, [field]: value } : s));
    persistData();
    render();
  }

  function deleteStudent(id) {
    state.students = state.students.filter((s) => s.id !== id);
    state.seats = state.seats.map((seat) => (seat.studentId === id ? { ...seat, studentId: null } : seat));
    if (state.selection?.studentId === id) state.selection = null;
    persistData();
    render();
  }

  // ===== Seating operations =====
  function removeSeat(row, col) {
    const idx = seatIndex(row, col);
    if (!state.seats[idx]) return;
    state.seats[idx] = { ...state.seats[idx], studentId: null };
    persistData();
    render();
  }

  function shuffleArray(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function autoArrange() {
    const shuffled = shuffleArray(state.students);
    state.seats = state.seats.map((seat, i) => ({ ...seat, studentId: shuffled[i]?.id || null }));
    saveToHistory("自動配置を実行");
  }

  function clearAll() {
    state.seats = state.seats.map((seat) => ({ ...seat, studentId: null }));
    saveToHistory("全座席をクリア");
  }

  // ===== Selection (click-based) =====
  function clearSelection() {
    state.selection = null;
    renderSelectionInfo();
    renderSeating(); // highlight 更新
  }

  function selectStudent(studentId) {
    state.selection = { kind: "student", studentId };
    renderSelectionInfo();
    renderSeating();
  }

  function selectSeat(row, col, studentId) {
    state.selection = { kind: "seat", from: { row, col }, studentId };
    renderSelectionInfo();
    renderSeating();
  }

  function onSeatClick(row, col) {
    const idx = seatIndex(row, col);
    const targetSeat = state.seats[idx];
    if (!targetSeat) return;

    const occupantId = targetSeat.studentId;

    if (!state.selection) {
      if (occupantId) {
        selectSeat(row, col, occupantId);
      }
      return;
    }

    if (state.selection.kind === "student") {
      const studentId = state.selection.studentId;

      // 既存の配置を解除
      state.seats = state.seats.map((s) => (s.studentId === studentId ? { ...s, studentId: null } : s));

      // 目標座席に配置（そこに居た生徒は未配置へ＝上書き）
      state.seats[idx] = { ...state.seats[idx], studentId };

      state.selection = null;
      persistData();
      render();
      return;
    }

    if (state.selection.kind === "seat") {
      const from = state.selection.from;
      if (from.row === row && from.col === col) {
        clearSelection();
        return;
      }

      const fromIdx = seatIndex(from.row, from.col);
      const fromSeat = state.seats[fromIdx];
      if (!fromSeat) { clearSelection(); return; }

      const movingId = fromSeat.studentId;
      const targetId = state.seats[idx].studentId;

      // swap/move
      state.seats[fromIdx] = { ...state.seats[fromIdx], studentId: targetId || null };
      state.seats[idx] = { ...state.seats[idx], studentId: movingId || null };

      state.selection = null;
      persistData();
      render();
      return;
    }
  }

  // ===== Drag & Drop (optional) =====
  function onDragStartFromSeat(studentId, row, col) {
    state.draggedStudentId = studentId;
    state.draggedFromSeat = { row, col };
  }

  function onDragStartFromList(studentId) {
    state.draggedStudentId = studentId;
    state.draggedFromSeat = null;
  }

  function cleanupDrag() {
    state.draggedStudentId = null;
    state.draggedFromSeat = null;
  }

  function handleDrop(row, col) {
    const draggedId = state.draggedStudentId;
    if (!draggedId) return;

    const targetIdx = seatIndex(row, col);
    const targetSeat = state.seats[targetIdx];
    if (!targetSeat) { cleanupDrag(); return; }

    const targetStudentId = targetSeat.studentId;
    const seats = state.seats.map((s) => ({ ...s }));

    if (state.draggedFromSeat) {
      const fromIdx = seatIndex(state.draggedFromSeat.row, state.draggedFromSeat.col);
      if (fromIdx === targetIdx) { cleanupDrag(); return; }

      if (targetStudentId) {
        seats[fromIdx].studentId = targetStudentId;
        seats[targetIdx].studentId = draggedId;
      } else {
        seats[fromIdx].studentId = null;
        seats[targetIdx].studentId = draggedId;
      }
    } else {
      for (const s of seats) {
        if (s.studentId === draggedId) s.studentId = null;
      }
      seats[targetIdx].studentId = draggedId;
    }

    state.seats = seats;
    cleanupDrag();
    persistData();
    render();
  }

  // ===== CSV =====
  function buildCSVText() {
    const headers = ["出席番号", "名前", "座席(行)", "座席(列)"];
    const rows = state.students.map((st) => {
      const seat = assignedSeatOfStudent(st.id);
      const name = String(st.name || "").replace(/"/g, '""');
      return [
        st.attendanceNumber ?? "",
        `"${name}"`,
        seat ? seat.row + 1 : "",
        seat ? seat.col + 1 : "",
      ];
    });
    return [headers, ...rows].map((r) => r.join(",")).join("\n");
  }

  function openCsvModal(csv) {
    el.csvText.value = csv;
    el.csvModal.classList.remove("hidden");
    setTimeout(() => el.csvText.focus(), 0);
  }

  function closeCsvModal() {
    el.csvModal.classList.add("hidden");
  }

  function exportCSV() {
    const csv = buildCSVText();
    const filename = `座席表_${state.selectedGrade}年${state.selectedClass}組_${new Date().toISOString().slice(0, 10)}.csv`;

    try {
      const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });

      if (window.navigator && window.navigator.msSaveOrOpenBlob) {
        window.navigator.msSaveOrOpenBlob(blob, filename);
        showToast("CSV出力が完了しました");
        return;
      }

      const link = document.createElement("a");
      const url = URL.createObjectURL(blob);
      link.href = url;
      link.download = filename;

      // ダウンロードが失敗する場合があるので try/catch
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(url), 150);

      showToast("CSV出力が完了しました");
    } catch (err) {
      console.warn("CSVダウンロード失敗:", err);
      openCsvModal(csv);
    }
  }

  function parseCSVLine(line) {
    const matches = line.match(/(".*?"|[^,]+)(?=\s*,|\s*$)/g);
    if (!matches) return [];
    return matches.map((s) => s.trim());
  }

  function importStudentsCSV(file) {
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      showToast("ファイルサイズが大きすぎます。5MB以下のファイルを選択してください。");
      el.inputStudentsCsv.value = "";
      return;
    }

    const encoding = state.csvEncoding || "UTF-8";
    const reader = new FileReader();

    reader.onerror = () => {
      showToast("ファイルの読み込みに失敗しました。");
      el.inputStudentsCsv.value = "";
    };

    reader.onload = async (e) => {
      try {
        const text = e.target?.result;
        if (typeof text !== "string") throw new Error("ファイル内容が不正です");

        const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
        const lines = normalized.split("\n").filter((line) => line.trim().length > 0);
        if (lines.length === 0) {
          showToast("CSVファイルが空です。");
          el.inputStudentsCsv.value = "";
          return;
        }

        const dataLines = lines.slice(1);
        if (dataLines.length === 0) {
          showToast("データが含まれていません。ヘッダー行の下にデータを入力してください。");
          el.inputStudentsCsv.value = "";
          return;
        }

        const key = classKey();
        const imported = [];
        const errors = [];

        dataLines.forEach((line, idx) => {
          const lineNum = idx + 2;
          const cols = parseCSVLine(line);
          if (!cols || cols.length < 2) {
            errors.push(`${lineNum}行目: データ形式が不正です`);
            return;
          }

          const attendanceRaw = cols[0].replace(/^"|"$/g, "");
          const nameRaw = cols[1].replace(/^"|"$/g, "");

          if (!attendanceRaw || !nameRaw) {
            errors.push(`${lineNum}行目: 出席番号または名前が空です`);
            return;
          }

          const att = parseInt(attendanceRaw, 10);
          if (Number.isNaN(att) || att < 1) {
            errors.push(`${lineNum}行目: 出席番号が不正です（${attendanceRaw}）`);
            return;
          }

          imported.push({
            id: `${key}-${Date.now()}-${idx}`,
            name: nameRaw,
            attendanceNumber: att,
            grade: state.selectedGrade,
            classNumber: state.selectedClass,
          });
        });

        if (errors.length > 0) {
          const proceed = await showConfirm(
            `以下のエラーがあります:\n${errors.slice(0, 5).join("\n")}` +
            `${errors.length > 5 ? `\n...他${errors.length - 5}件` : ""}` +
            `\n\n正常なデータ（${imported.length}件）のみインポートしますか？`
          );
          if (!proceed) {
            el.inputStudentsCsv.value = "";
            return;
          }
        }

        if (imported.length === 0) {
          showToast("インポート可能なデータがありませんでした。");
          el.inputStudentsCsv.value = "";
          return;
        }

        const confirmMessage =
          `${imported.length}名の生徒をインポートします。\n` +
          `現在の生徒データ（${state.students.length}名）は削除され、座席配置もリセットされます。\n\nよろしいですか？`;

        if (!await showConfirm(confirmMessage)) {
          el.inputStudentsCsv.value = "";
          return;
        }

        state.students = imported;
        state.seats = state.seats.map((seat) => ({ ...seat, studentId: null }));
        state.selection = null;
        saveToHistory(`CSV入力：${imported.length}名の生徒を登録`);

        showToast(`${imported.length}名の生徒を正常にインポートしました。`);
      } catch (err) {
        console.error("CSV読み込みエラー:", err);
        showToast("CSVファイルの処理中にエラーが発生しました。\nファイル形式を確認してください。");
      } finally {
        el.inputStudentsCsv.value = "";
      }
    };

    reader.readAsText(file, encoding);
  }

  // ===== Rendering =====
  function renderSidebar() {
    el.classButtons.innerHTML = "";

    [1, 2, 3].forEach((g) => {
      const block = document.createElement("div");
      block.className = "grade-block";

      const title = document.createElement("div");
      title.className = "grade-title";
      title.textContent = `${g}年生`;
      block.appendChild(title);

      const classCount = CLASS_STRUCTURE[g] || 0;
      for (let c = 1; c <= classCount; c++) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "class-btn" + ((state.selectedGrade === g && state.selectedClass === c) ? " active" : "");
        btn.textContent = `${c}組`;
        btn.addEventListener("click", async () => {
          state.selectedGrade = g;
          state.selectedClass = c;
          await loadData();
          persistData();
          render();
        });
        block.appendChild(btn);
      }

      el.classButtons.appendChild(block);
    });
  }

  function renderTop() {
    el.classTitle.textContent = `${state.selectedGrade}年${state.selectedClass}組`;

    if (state.view === "seating") {
      el.btnViewSeating.classList.add("blue");
      el.btnViewSeating.classList.remove("gray");
      el.btnViewStudents.classList.add("gray");
      el.btnViewStudents.classList.remove("blue");

      el.controlsSeating.classList.remove("hidden");
      el.controlsStudents.classList.add("hidden");
      el.viewSeating.classList.remove("hidden");
      el.viewStudents.classList.add("hidden");
    } else {
      el.btnViewStudents.classList.add("blue");
      el.btnViewStudents.classList.remove("gray");
      el.btnViewSeating.classList.add("gray");
      el.btnViewSeating.classList.remove("blue");

      el.controlsStudents.classList.remove("hidden");
      el.controlsSeating.classList.add("hidden");
      el.viewStudents.classList.remove("hidden");
      el.viewSeating.classList.add("hidden");
    }

    el.historyCount.textContent = String(state.history.length);

    el.rotateState.textContent = state.rotate180 ? "ON" : "OFF";
    el.btnToggleRotate.setAttribute("aria-pressed", state.rotate180 ? "true" : "false");
  }

  function renderSelectionInfo() {
    if (!state.selection) {
      el.selectionInfo.classList.add("hidden");
      return;
    }

    if (state.selection.kind === "student") {
      const st = state.students.find((s) => s.id === state.selection.studentId);
      el.selectionText.textContent = `選択中：${st?.attendanceNumber ?? ""} ${st?.name ?? ""}（座席をクリックして配置）`;
    } else if (state.selection.kind === "seat") {
      const st = state.students.find((s) => s.id === state.selection.studentId);
      el.selectionText.textContent = `移動/交換：${st?.attendanceNumber ?? ""} ${st?.name ?? ""}（別の座席をクリック）`;
    }
    el.selectionInfo.classList.remove("hidden");
  }

  function renderSeating() {
    el.seatingGrid.style.gridTemplateColumns = `repeat(${state.layout.cols}, minmax(0, 1fr))`;

    el.seatingGrid.classList.toggle("rot180", state.rotate180);
    el.seatingCard.classList.toggle("rot180", state.rotate180);

    el.seatingGrid.innerHTML = "";

    for (const seat of state.seats) {
      const cell = document.createElement("div");
      cell.className = "seat";
      cell.dataset.row = String(seat.row);
      cell.dataset.col = String(seat.col);

      // highlight selected seat
      if (state.selection?.kind === "seat") {
        if (state.selection.from.row === seat.row && state.selection.from.col === seat.col) {
          cell.classList.add("selected");
        }
      }

      cell.addEventListener("click", () => onSeatClick(seat.row, seat.col));

      // Drag drop
      cell.addEventListener("dragover", (e) => e.preventDefault());
      cell.addEventListener("drop", () => handleDrop(seat.row, seat.col));

      const st = seat.studentId ? state.students.find((s) => s.id === seat.studentId) : null;

      if (st) {
        const card = document.createElement("div");
        card.className = "seat-card";
        card.draggable = true;
        card.addEventListener("dragstart", () => onDragStartFromSeat(st.id, seat.row, seat.col));

        const rm = document.createElement("button");
        rm.type = "button";
        rm.className = "seat-remove";
        rm.textContent = "×";
        rm.addEventListener("click", (e) => {
          e.stopPropagation();
          removeSeat(seat.row, seat.col);
        });

        const num = document.createElement("div");
        num.className = "num";
        num.textContent = String(st.attendanceNumber ?? "");

        const name = document.createElement("div");
        name.className = "name";
        name.textContent = String(st.name ?? "");

        card.appendChild(rm);
        card.appendChild(num);
        card.appendChild(name);
        cell.appendChild(card);
      } else {
        const coord = document.createElement("div");
        coord.className = "coord";
        coord.textContent = `${seat.row + 1}-${seat.col + 1}`;
        cell.appendChild(coord);
      }

      el.seatingGrid.appendChild(cell);
    }

    // unassigned list
    const unassigned = unassignedStudents();
    el.unassignedList.innerHTML = "";

    if (unassigned.length === 0) {
      const note = document.createElement("div");
      note.className = "empty-note";
      note.textContent = "全員配置済み";
      el.unassignedList.appendChild(note);
    } else {
      for (const st of unassigned) {
        const pill = document.createElement("div");
        pill.className = "student-pill";
        pill.draggable = true;

        pill.addEventListener("dragstart", () => onDragStartFromList(st.id));
        pill.addEventListener("click", () => selectStudent(st.id));

        if (state.selection?.kind === "student" && state.selection.studentId === st.id) {
          pill.classList.add("selected");
        }

        const name = document.createElement("div");
        name.className = "pill-name";
        name.textContent = String(st.name ?? "");

        const sub = document.createElement("div");
        sub.className = "pill-sub";
        sub.textContent = `出席番号: ${st.attendanceNumber ?? ""}`;

        pill.appendChild(name);
        pill.appendChild(sub);
        el.unassignedList.appendChild(pill);
      }
    }

    renderSelectionInfo();
  }

  function renderStudents() {
    el.studentsCount.textContent = `学生一覧 (${state.students.length}名)`;
    el.studentsTbody.innerHTML = "";

    for (const st of state.students) {
      const tr = document.createElement("tr");
      const seat = assignedSeatOfStudent(st.id);

      const tdAtt = document.createElement("td");
      const inputAtt = document.createElement("input");
      inputAtt.className = "cell-input cell-num";
      inputAtt.type = "number";
      inputAtt.value = (st.attendanceNumber ?? "");
      inputAtt.addEventListener("change", () => {
        const n = parseInt(inputAtt.value, 10);
        updateStudent(st.id, "attendanceNumber", Number.isNaN(n) ? null : n);
      });
      tdAtt.appendChild(inputAtt);

      const tdName = document.createElement("td");
      const inputName = document.createElement("input");
      inputName.className = "cell-input";
      inputName.type = "text";
      inputName.value = (st.name ?? "");
      inputName.addEventListener("input", () => updateStudent(st.id, "name", inputName.value));
      tdName.appendChild(inputName);

      const tdSeat = document.createElement("td");
      tdSeat.textContent = seat ? `${seat.row + 1}行${seat.col + 1}列` : "未配置";

      const tdAct = document.createElement("td");
      const btnDel = document.createElement("button");
      btnDel.type = "button";
      btnDel.className = "danger-mini";
      btnDel.textContent = "削除";
      btnDel.addEventListener("click", async () => {
        if (await showConfirm(`「${st.name}」を削除しますか？\n（座席に配置されている場合は解除されます）`)) {
          deleteStudent(st.id);
        }
      });
      tdAct.appendChild(btnDel);

      tr.appendChild(tdAtt);
      tr.appendChild(tdName);
      tr.appendChild(tdSeat);
      tr.appendChild(tdAct);

      el.studentsTbody.appendChild(tr);
    }
  }

  function renderHistoryModal() {
    if (!state.showHistory) {
      el.historyModal.classList.add("hidden");
      return;
    }
    el.historyModal.classList.remove("hidden");
    el.historyBody.innerHTML = "";

    if (!state.history || state.history.length === 0) {
      const empty = document.createElement("div");
      empty.className = "history-empty";
      empty.innerHTML = `
        <div>
          <div style="font-size:44px; line-height:1; margin-bottom:10px;">🕘</div>
          <div style="font-size:16px; font-weight:950;">履歴がありません</div>
          <div style="margin-top:6px; font-size:12px; font-weight:850; opacity:.9;">
            座席配置を保存すると、ここに履歴が表示されます
          </div>
        </div>
      `;
      el.historyBody.appendChild(empty);
      el.historyFoot.classList.add("hidden");
      return;
    }

    const wrap = document.createElement("div");
    wrap.style.display = "flex";
    wrap.style.flexDirection = "column";
    wrap.style.gap = "10px";

    state.history.forEach((item, idx) => {
      const assignedCount = (item.seatArrangement || []).filter((s) => s.studentId).length;
      const studentCount = (item.students || []).length;

      const card = document.createElement("div");
      card.className = "history-item";

      const left = document.createElement("div");

      const title = document.createElement("h4");
      title.className = "history-title";
      title.textContent = item.description || "(無題)";
      left.appendChild(title);

      const meta = document.createElement("div");
      meta.className = "history-meta";
      meta.innerHTML = `
        <div>🕒 ${item.date || ""}</div>
        <div>🪑 配置数: <strong style="color:#0f172a;">${assignedCount}席</strong></div>
        <div>👥 生徒数: <strong style="color:#0f172a;">${studentCount}名</strong></div>
        <div>№ ${state.history.length - idx}</div>
      `;
      left.appendChild(meta);

      const actions = document.createElement("div");
      actions.className = "history-actions";

      const btnRestore = document.createElement("button");
      btnRestore.type = "button";
      btnRestore.className = "mini blue";
      btnRestore.textContent = "↩️ 復元";
      btnRestore.addEventListener("click", () => restoreFromHistory(item));

      const btnDelete = document.createElement("button");
      btnDelete.type = "button";
      btnDelete.className = "mini red";
      btnDelete.textContent = "🗑️ 削除";
      btnDelete.addEventListener("click", async () => {
        if (await showConfirm("この履歴を削除しますか？")) deleteHistory(item.id);
      });

      actions.appendChild(btnRestore);
      actions.appendChild(btnDelete);

      card.appendChild(left);
      card.appendChild(actions);
      wrap.appendChild(card);
    });

    el.historyBody.appendChild(wrap);

    el.historyFoot.classList.remove("hidden");
    el.historyFoot.textContent = `全 ${state.history.length} 件の履歴（最新20件まで保存）`;
  }

  function render() {
    showEnvBannerIfNeeded();
    renderSidebar();
    renderTop();
    renderSeating();
    renderStudents();
    renderHistoryModal();
  }

  // ===== Events =====
  el.btnViewSeating.addEventListener("click", () => { state.view = "seating"; render(); });
  el.btnViewStudents.addEventListener("click", () => { state.view = "students"; render(); });

  el.btnAutoArrange.addEventListener("click", autoArrange);

  el.btnClearAll.addEventListener("click", async () => {
    if (await showConfirm("全座席をクリアしますか？")) clearAll();
  });

  el.btnSaveHistory.addEventListener("click", () => saveToHistory("手動保存"));

  el.btnToggleHistory.addEventListener("click", () => {
    state.showHistory = !state.showHistory;
    renderHistoryModal();
  });

  el.btnCloseHistory.addEventListener("click", () => {
    state.showHistory = false;
    renderHistoryModal();
  });

  el.historyModal.addEventListener("click", (e) => {
    if (e.target === el.historyModal) {
      state.showHistory = false;
      renderHistoryModal();
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (state.showHistory) { state.showHistory = false; renderHistoryModal(); }
      if (!el.csvModal.classList.contains("hidden")) closeCsvModal();
      if (state.selection) clearSelection();
    }
  });

  el.btnToggleRotate.addEventListener("click", () => {
    state.rotate180 = !state.rotate180;
    persistData();
    render();
  });

  el.btnExportCsvSeating.addEventListener("click", exportCSV);
  el.btnExportCsvStudents.addEventListener("click", exportCSV);

  el.btnAddStudent.addEventListener("click", addStudent);

  el.selectEncoding.addEventListener("change", () => {
    state.csvEncoding = el.selectEncoding.value || "UTF-8";
  });

  el.inputStudentsCsv.addEventListener("change", () => {
    const file = el.inputStudentsCsv.files && el.inputStudentsCsv.files[0];
    importStudentsCSV(file);
  });

  el.btnClearSelection.addEventListener("click", clearSelection);

  // Layout change
  async function applyLayoutChange() {
    const rows = clampInt(el.inputRows.value, 1, 10, state.layout.rows);
    const cols = clampInt(el.inputCols.value, 1, 10, state.layout.cols);
    const changed = rows !== state.layout.rows || cols !== state.layout.cols;
    if (!changed) return;

    if (!await showConfirm("行・列を変更すると、座席配置はリセットされます。\nよろしいですか？")) {
      el.inputRows.value = String(state.layout.rows);
      el.inputCols.value = String(state.layout.cols);
      return;
    }

    state.layout = { rows, cols };
    state.seats = makeSeats(rows, cols);
    state.selection = null;
    persistData();
    render();
  }

  el.inputRows.addEventListener("change", applyLayoutChange);
  el.inputCols.addEventListener("change", applyLayoutChange);

  // CSV modal
  el.btnCloseCsv.addEventListener("click", closeCsvModal);
  el.csvModal.addEventListener("click", (e) => {
    if (e.target === el.csvModal) closeCsvModal();
  });
  el.btnCopyCsv.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(el.csvText.value);
      showToast("コピーしました");
    } catch {
      // fallback
      el.csvText.focus();
      el.csvText.select();
      showToast("クリップボードに直接書き込めませんでした。選択状態にしたので Ctrl+C でコピーしてください。");
    }
  });

  // ===== Init =====
  loadData().then(() => {
    persistData();
    render();
  });
})();
