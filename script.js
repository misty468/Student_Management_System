"use strict";

const USES_SAME_SERVER =
  location.port === "3001" ||
  !["localhost", "127.0.0.1", ""].includes(location.hostname);
const API_URL = USES_SAME_SERVER
  ? "/students"
  : "http://localhost:3001/students";
const PREFS_KEY = "studentPrefs_v1";
const CACHE_KEY = "studentCache_v1";
const PASS_MARK = 35;

class ApiError extends Error {
  constructor(message, status = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

const STATUS_MESSAGES = {
  400: "Bad request. Please check the data and try again.",
  404: "Student not found. It may have been deleted.",
  500: "Server error. Please try again later.",
};

async function apiRequest(url, options = {}) {
  let response;

  try {
    response = await fetch(url, {
      headers: { "Content-Type": "application/json" },
      ...options,
    });
  } catch (err) {
    throw new ApiError(
      "Network error. Please check that the server is running.",
    );
  }

  if (!response.ok) {
    const message =
      STATUS_MESSAGES[response.status] || "Request failed. Please try again.";
    throw new ApiError(message, response.status);
  }

  if (response.status === 204) return null;

  try {
    return await response.json();
  } catch (err) {
    throw new ApiError("Invalid response received from server.");
  }
}

const fetchStudents = () => apiRequest(API_URL);

const createStudent = (student) =>
  apiRequest(API_URL, { method: "POST", body: JSON.stringify(student) });

const updateStudent = (id, changes) =>
  apiRequest(`${API_URL}/${id}`, {
    method: "PATCH",
    body: JSON.stringify(changes),
  });

const removeStudent = (id) =>
  apiRequest(`${API_URL}/${id}`, { method: "DELETE" });

function validateStudentsResponse(data) {
  const isStudent = (s) =>
    s &&
    typeof s === "object" &&
    s.id !== undefined &&
    typeof s.name === "string" &&
    typeof s.rollNo === "string" &&
    ["html", "css", "javascript"].every((k) => Number.isFinite(s[k]));

  if (!Array.isArray(data) || !data.every(isStudent)) {
    throw new ApiError("Invalid student data received from server.");
  }
  return data;
}

const DEFAULT_PREFS = {
  filter: "all",
  grade: "all",
  sort: "name-asc",
  rowsPerPage: 10,
};

function loadPrefs() {
  try {
    return { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem(PREFS_KEY)) };
  } catch (err) {
    return { ...DEFAULT_PREFS };
  }
}

function savePrefs() {
  try {
    const { filter, grade, sort, rowsPerPage } = state;
    localStorage.setItem(
      PREFS_KEY,
      JSON.stringify({ filter, grade, sort, rowsPerPage }),
    );
  } catch (err) {
    console.error("Could not save preferences", err);
  }
}

function saveCache(data) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(data));
  } catch (err) {}
}

function loadCache() {
  try {
    return validateStudentsResponse(
      JSON.parse(localStorage.getItem(CACHE_KEY)),
    );
  } catch (err) {
    return null;
  }
}

const state = {
  students: [],
  search: "",
  ...loadPrefs(),
  currentPage: 1,
  newStudentId: null,
  currentStudentId: null,
  editing: false,
  isBusy: false,
  hasLoaded: false,
  lastUpdated: null,
};

const findStudent = (id) =>
  state.students.find((s) => String(s.id) === String(id));

const $ = (id) => document.getElementById(id);

const dom = {
  loadingBox: $("loadingBox"),
  toastContainer: $("toastContainer"),
  addBtn: $("addstudent"),

  totalStudents: $("totalstudents"),
  passedStudents: $("passedstudents"),
  failedStudents: $("failedstudents"),
  averagePer: $("averageper"),
  highestPer: $("highestper"),
  lowestPer: $("lowestper"),
  dashboardNote: $("dashboardNote"),

  searchInput: $("searchInput"),
  filterSelect: $("filterSelect"),
  gradeSelect: $("gradeSelect"),
  sortSelect: $("sortSelect"),
  rowsSelect: $("rowsSelect"),
  refreshBtn: $("refreshBtn"),
  lastUpdated: $("lastUpdated"),

  table: $("studentTable"),
  tableBody: $("studentTableBody"),
  countInfo: $("countInfo"),
  errorState: $("errorState"),
  errorMessage: $("errorMessage"),
  retryBtn: $("retryBtn"),
  emptyState: $("emptyState"),
  emptyMessage: $("emptyMessage"),
  emptySub: $("emptySub"),
  pagination: $("pagination"),

  form: $("resultForm"),
  closeFormBtn: $("closebtn"),
  formTitle: $("modalTitle"),
  saveBtn: $("saveStudentBtn"),
  resetBtn: $("resetFormBtn"),
  preview: $("resultPreview"),

  viewModal: $("viewModal"),
  closeViewBtn: $("closeViewBtn"),
  viewTotal: $("viewTotal"),
  viewPercentage: $("viewPercentage"),
  viewGrade: $("viewGrade"),
  viewStatus: $("viewStatus"),
  editBtn: $("editBtn"),
  saveChangesBtn: $("saveChangesBtn"),
  deleteBtn: $("deleteBtn"),

  confirmModal: $("confirmModal"),
  confirmTitle: $("confirmTitle"),
  confirmText: $("confirmText"),
  confirmYesBtn: $("confirmYesBtn"),
  confirmNoBtn: $("confirmNoBtn"),
};

function calculateResult(student) {
  const total = student.html + student.css + student.javascript;
  const percentage = Number((total / 3).toFixed(2));
  const isPass = [student.html, student.css, student.javascript].every(
    (m) => m >= PASS_MARK,
  );
  const status = isPass ? "Pass" : "Fail";

  let grade = "F";
  if (isPass) grade = percentage >= 90 ? "A" : percentage >= 75 ? "B" : "C";

  return { ...student, total, percentage, status, grade };
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function validateName(value) {
  const v = value.trim();
  if (v === "") return "Student name should not be empty.";
  if (v.length < 3) return "Student name must be at least 3 characters.";
  if (v.length > 50) return "Student name must be 50 characters or less.";
  if (!/^[\p{L}][\p{L}\s.'-]*$/u.test(v))
    return "Student name should contain only letters (no numbers).";
  return "";
}

function validateRoll(value, ignoreId = null) {
  const v = value.trim();
  if (v === "") return "Roll number should not be empty.";
  if (!/^[A-Za-z0-9][A-Za-z0-9-]{1,14}$/.test(v))
    return "Use 2–15 letters, numbers or hyphens (e.g. CS101).";
  const duplicate = state.students.some(
    (s) =>
      String(s.id) !== String(ignoreId) &&
      s.rollNo.toLowerCase() === v.toLowerCase(),
  );
  return duplicate ? "Roll Number already exists." : "";
}

function validateMarks(value) {
  const v = value.trim();
  if (v === "") return "Marks are required.";
  if (v.startsWith("-")) return "Marks cannot be negative.";
  if (!/^\d+(\.\d+)?$/.test(v)) return "Marks should accept numbers only.";
  if (Number(v) > 100) return "Marks must be between 0 and 100.";
  return "";
}

const addFields = [
  {
    key: "name",
    input: $("studentName"),
    error: $("err-name"),
    validate: validateName,
  },
  {
    key: "rollNo",
    input: $("rollNo"),
    error: $("err-roll"),
    validate: (v) => validateRoll(v),
  },
  {
    key: "html",
    input: $("htmlMarks"),
    error: $("err-html"),
    validate: validateMarks,
    numeric: true,
  },
  {
    key: "css",
    input: $("cssMarks"),
    error: $("err-css"),
    validate: validateMarks,
    numeric: true,
  },
  {
    key: "javascript",
    input: $("jsMarks"),
    error: $("err-js"),
    validate: validateMarks,
    numeric: true,
  },
];

const viewFields = [
  {
    key: "name",
    input: $("viewName"),
    error: $("view-err-name"),
    validate: validateName,
  },
  {
    key: "rollNo",
    input: $("viewRoll"),
    error: $("view-err-roll"),
    validate: (v) => validateRoll(v, state.currentStudentId),
  },
  {
    key: "html",
    input: $("viewHtml"),
    error: $("view-err-html"),
    validate: validateMarks,
    numeric: true,
  },
  {
    key: "css",
    input: $("viewCss"),
    error: $("view-err-css"),
    validate: validateMarks,
    numeric: true,
  },
  {
    key: "javascript",
    input: $("viewJs"),
    error: $("view-err-js"),
    validate: validateMarks,
    numeric: true,
  },
];

function validateField(field) {
  const message = field.validate(field.input.value);
  field.error.textContent = message;
  field.input.classList.toggle("invalid", message !== "");
  return message === "";
}

function validateFields(fields) {
  return fields.map(validateField).every(Boolean);
}

function clearFieldErrors(fields) {
  fields.forEach((f) => {
    f.error.textContent = "";
    f.input.classList.remove("invalid");
  });
}

function bindLiveValidation(fields) {
  fields.forEach((f) =>
    f.input.addEventListener("input", () => validateField(f)),
  );
}

function readFields(fields) {
  return Object.fromEntries(
    fields.map((f) => {
      const value = f.input.value.trim();
      return [f.key, f.numeric ? Number(value) : value];
    }),
  );
}

function getPreview(fields) {
  const marks = fields.filter((f) => f.numeric);
  if (marks.some((f) => validateMarks(f.input.value) !== "")) return null;
  const [html, css, javascript] = marks.map((f) =>
    Number(f.input.value.trim()),
  );
  return calculateResult({ html, css, javascript });
}

const PREVIEW_HINT =
  "Enter valid marks to see Total, Percentage, Grade and Result.";

function renderAddPreview() {
  const r = getPreview(addFields);
  dom.preview.textContent = r
    ? `Total: ${r.total} | Percentage: ${r.percentage}% | Grade: ${r.grade} | Result: ${r.status}`
    : PREVIEW_HINT;
}

function renderViewPreview() {
  const r = getPreview(viewFields);
  if (!r) return;
  dom.viewTotal.value = r.total;
  dom.viewPercentage.value = `${r.percentage}%`;
  dom.viewGrade.value = r.grade;
  dom.viewStatus.value = r.status;
}

function searchStudents(list, term) {
  if (!term) return list;
  return list.filter(
    (s) =>
      s.name.toLowerCase().includes(term) ||
      s.rollNo.toLowerCase().includes(term),
  );
}

function filterByResult(list, value) {
  if (value === "pass") return list.filter((s) => s.status === "Pass");
  if (value === "fail") return list.filter((s) => s.status === "Fail");
  return list;
}

function filterByGrade(list, value) {
  if (value === "all") return list;
  return list.filter((s) => s.grade.toLowerCase() === value);
}

const SORTERS = {
  "name-asc": (a, b) => a.name.localeCompare(b.name),
  "name-desc": (a, b) => b.name.localeCompare(a.name),
  highestper: (a, b) => b.percentage - a.percentage,
  lowestper: (a, b) => a.percentage - b.percentage,
  highestmar: (a, b) => b.total - a.total,
  lowestmar: (a, b) => a.total - b.total,
  "roll-asc": (a, b) =>
    a.rollNo.localeCompare(b.rollNo, undefined, { numeric: true }),
  "roll-desc": (a, b) =>
    b.rollNo.localeCompare(a.rollNo, undefined, { numeric: true }),
};

function sortStudents(list, sortKey) {
  const sorter = SORTERS[sortKey];
  return sorter ? [...list].sort(sorter) : list;
}

function promoteNewStudent(list) {
  if (state.newStudentId === null) return list;
  const target = list.find((s) => String(s.id) === String(state.newStudentId));
  if (!target) return list;
  return [target, ...list.filter((s) => s !== target)];
}

function getProcessedStudents() {
  let list = searchStudents(state.students, state.search);
  list = filterByResult(list, state.filter);
  list = filterByGrade(list, state.grade);
  list = sortStudents(list, state.sort);
  return promoteNewStudent(list);
}

const getTotalPages = (totalItems) =>
  Math.max(1, Math.ceil(totalItems / state.rowsPerPage));

function getPageSlice(list) {
  const start = (state.currentPage - 1) * state.rowsPerPage;
  return list.slice(start, start + state.rowsPerPage);
}

function getPageItems(current, total) {
  const pages = new Set([1, total, current - 1, current, current + 1]);
  const sorted = [...pages]
    .filter((p) => p >= 1 && p <= total)
    .sort((a, b) => a - b);

  const items = [];
  sorted.forEach((page, i) => {
    if (i > 0 && page - sorted[i - 1] > 1) items.push("...");
    items.push(page);
  });
  return items;
}

const formatNumber = (n) => n.toLocaleString();
const formatPercent = (n) =>
  n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }) + "%";

function calculateStats(list) {
  const total = list.length;
  const passed = list.filter((s) => s.status === "Pass").length;
  const percentages = list.map((s) => s.percentage);
  const average = total ? percentages.reduce((a, b) => a + b, 0) / total : 0;

  return {
    total,
    passed,
    failed: total - passed,
    average,
    highest: total ? Math.max(...percentages) : 0,
    lowest: total ? Math.min(...percentages) : 0,
  };
}

function updateDashboard(list) {
  const stats = calculateStats(list);

  dom.totalStudents.textContent = formatNumber(stats.total);
  dom.passedStudents.textContent = formatNumber(stats.passed);
  dom.failedStudents.textContent = formatNumber(stats.failed);
  dom.averagePer.textContent = formatPercent(stats.average);
  dom.highestPer.textContent = formatPercent(stats.highest);
  dom.lowestPer.textContent = formatPercent(stats.lowest);

  dom.dashboardNote.hidden = state.students.length > 0;
}

function showLoading(message) {
  dom.loadingBox.textContent = message;
  dom.loadingBox.style.display = "block";
}

function hideLoading() {
  dom.loadingBox.style.display = "none";
}

const PENDING_TOAST_KEY = "studentPendingToast_v1";

function setPendingToast(message, type) {
  try {
    sessionStorage.setItem(
      PENDING_TOAST_KEY,
      JSON.stringify({ message, type }),
    );
  } catch (err) {}
}

function clearPendingToast(message) {
  try {
    const saved = JSON.parse(sessionStorage.getItem(PENDING_TOAST_KEY));
    if (saved && saved.message === message)
      sessionStorage.removeItem(PENDING_TOAST_KEY);
  } catch (err) {}
}

function showToast(message, type = "success", { persist = false } = {}) {
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.textContent = message;
  dom.toastContainer.appendChild(toast);
  if (persist) setPendingToast(message, type);

  setTimeout(() => toast.classList.add("hide"), 4000);
  setTimeout(() => {
    toast.remove();
    if (persist) clearPendingToast(message);
  }, 4400);
}
const showSuccess = (message) => showToast(message, "success");
const showSaved = (message) => showToast(message, "success", { persist: true });
const showError = (message) => showToast(message, "error");
const showWarning = (message) => showToast(message, "warning");

function showPendingToast() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(PENDING_TOAST_KEY));
    if (saved && saved.message)
      showToast(saved.message, saved.type || "success", { persist: true });
  } catch (err) {}
}

const isOpen = (el) => getComputedStyle(el).display !== "none";

function confirmAction({ title, message, confirmText = "Confirm" }) {
  return new Promise((resolve) => {
    dom.confirmTitle.textContent = title;
    dom.confirmText.textContent = message;
    dom.confirmYesBtn.textContent = confirmText;
    dom.confirmModal.style.display = "flex";

    const finish = (answer) => {
      dom.confirmModal.style.display = "none";
      resolve(answer);
    };

    dom.confirmYesBtn.onclick = () => finish(true);
    dom.confirmNoBtn.onclick = () => finish(false);
    dom.confirmModal.onclick = (e) => {
      if (e.target === dom.confirmModal) finish(false);
    };
  });
}

async function runOperation({ message, task, button, busyText }) {
  if (state.isBusy) return { ok: false, skipped: true };

  state.isBusy = true;
  const originalText = button ? button.textContent : "";
  if (button) {
    button.disabled = true;
    if (busyText) button.textContent = busyText;
  }
  showLoading(message);

  try {
    const data = await task();
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: err };
  } finally {
    state.isBusy = false;
    hideLoading();
    if (button) {
      button.disabled = false;
      button.textContent = originalText;
    }
  }
}

function handleOperationError(err) {
  showError(err.message || "Something went wrong. Please try again.");
  if (err.status === 404) refreshStudents();
}

function setScreen(screen, message = "") {
  dom.table.style.display = screen === "table" ? "table" : "none";
  dom.emptyState.style.display = screen === "empty" ? "block" : "none";
  dom.errorState.style.display = screen === "error" ? "block" : "none";

  if (screen === "empty") {
    dom.emptyMessage.textContent = message;
    dom.emptySub.textContent =
      state.students.length === 0
        ? "Add your first student to get started."
        : "";
  }
  if (screen === "error") dom.errorMessage.textContent = message;
  if (screen !== "table") {
    dom.countInfo.textContent = "";
    dom.pagination.innerHTML = "";
  }
}

function getEmptyMessage() {
  return state.students.length === 0
    ? "No students available."
    : "No matching students found.";
}

function renderTable(pageList, startIndex) {
  dom.tableBody.innerHTML = pageList
    .map(
      (s, i) => `
      <tr>
        <td>${startIndex + i + 1}</td>
        <td>${escapeHtml(s.name)}</td>
        <td>${escapeHtml(s.rollNo)}</td>
        <td>${s.html}</td>
        <td>${s.css}</td>
        <td>${s.javascript}</td>
        <td>${s.total}</td>
        <td>${s.percentage}%</td>
        <td>${s.grade}</td>
        <td>${s.status}</td>
        <td><button class="view-btn" data-id="${escapeHtml(String(s.id))}">View</button></td>
      </tr>`,
    )
    .join("");
  setScreen("table");
}

function renderPagination(totalItems) {
  const totalPages = getTotalPages(totalItems);
  const current = state.currentPage;

  const numbers = getPageItems(current, totalPages)
    .map((item) =>
      item === "..."
        ? `<span class="page-dots">…</span>`
        : `<button class="page-btn ${item === current ? "active" : ""}" data-page="${item}">${item}</button>`,
    )
    .join("");

  dom.pagination.innerHTML = `
    <button class="page-btn" data-page="prev" ${current === 1 ? "disabled" : ""}>‹ Previous</button>
    ${numbers}
    <button class="page-btn" data-page="next" ${current === totalPages ? "disabled" : ""}>Next ›</button>`;
}

function renderLastUpdated() {
  if (!state.lastUpdated) return;
  const time = state.lastUpdated.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
  dom.lastUpdated.textContent = `Last updated: ${time}`;
}

function render() {
  const processed = getProcessedStudents();
  updateDashboard(state.students);

  if (processed.length === 0) {
    setScreen("empty", getEmptyMessage());
    return;
  }

  state.currentPage = Math.min(
    state.currentPage,
    getTotalPages(processed.length),
  );

  const start = (state.currentPage - 1) * state.rowsPerPage;
  const pageList = getPageSlice(processed);

  renderTable(pageList, start);
  renderPagination(processed.length);
  dom.countInfo.textContent = `Showing ${start + 1}–${start + pageList.length} of ${processed.length} students`;
}

async function refreshStudents({
  message = "Loading students...",
  button,
  busyText,
} = {}) {
  const result = await runOperation({
    message,
    button,
    busyText,
    task: async () => validateStudentsResponse(await fetchStudents()),
  });

  if (result.skipped) return false;

  if (!result.ok) {
    if (state.hasLoaded) {
      showError(result.error.message);
    } else {
      const cached = loadCache();
      if (cached) {
        state.students = cached.map(calculateResult);
        render();
        showWarning("Server unreachable. Showing last saved data.");
      } else {
        setScreen(
          "error",
          `Unable to load student data. ${result.error.message}`,
        );
      }
    }
    return false;
  }

  state.students = result.data.map(calculateResult);
  saveCache(result.data);
  state.hasLoaded = true;
  state.lastUpdated = new Date();
  render();
  renderLastUpdated();
  return true;
}

function openAddForm() {
  resetForm();
  dom.formTitle.textContent = "Add Student";
  dom.form.style.display = "block";
  addFields[0].input.focus();
}

function closeAddForm() {
  dom.form.style.display = "none";
}

function resetForm() {
  addFields.forEach((f) => (f.input.value = ""));
  clearFieldErrors(addFields);
  renderAddPreview();
}

async function handleAddSubmit(e) {
  e.preventDefault();
  if (state.isBusy) return;

  if (!validateFields(addFields)) {
    showWarning("Please enter valid student details.");
    return;
  }

  const student = readFields(addFields);

  const result = await runOperation({
    message: "Adding student...",
    button: dom.saveBtn,
    busyText: "Adding...",
    task: async () => {
      const latest = validateStudentsResponse(await fetchStudents());
      if (
        latest.some(
          (s) => s.rollNo.toLowerCase() === student.rollNo.toLowerCase(),
        )
      ) {
        throw new ApiError("Roll Number already exists.");
      }
      const ids = latest.map((s) => Number(s.id)).filter(Number.isFinite);
      const id = ids.length ? Math.max(...ids) + 1 : 1;
      return createStudent({ id, ...student });
    },
  });

  if (result.skipped) return;
  if (!result.ok) return handleOperationError(result.error);

  state.newStudentId = result.data.id;
  resetFilters();
  closeAddForm();
  resetForm();
  showSaved("Student added successfully.");
  await refreshStudents();
}

function fillViewModal(student) {
  viewFields.forEach((f) => (f.input.value = student[f.key]));
  dom.viewTotal.value = student.total;
  dom.viewPercentage.value = `${student.percentage}%`;
  dom.viewGrade.value = student.grade;
  dom.viewStatus.value = student.status;
}

function setEditMode(on) {
  state.editing = on;
  viewFields.forEach((f) => (f.input.readOnly = !on));
  dom.saveChangesBtn.style.display = on ? "block" : "none";
  dom.editBtn.style.display = on ? "none" : "block";
}

function openViewModal(id) {
  const student = findStudent(id);
  if (!student) return showWarning("No student selected/found.");

  state.currentStudentId = student.id;
  fillViewModal(student);
  clearFieldErrors(viewFields);
  setEditMode(false);
  dom.viewModal.style.display = "flex";
}

function closeViewModal() {
  dom.viewModal.style.display = "none";
  state.currentStudentId = null;
  setEditMode(false);
}

async function handleUpdate() {
  const student = findStudent(state.currentStudentId);
  if (!student) return showWarning("No student selected/found.");

  if (!validateFields(viewFields)) {
    showWarning("Please enter valid student details.");
    return;
  }

  const changes = readFields(viewFields);

  const result = await runOperation({
    message: "Updating student...",
    button: dom.saveChangesBtn,
    busyText: "Updating...",
    task: () => updateStudent(student.id, changes),
  });

  if (result.skipped) return;
  if (!result.ok) return handleOperationError(result.error);

  closeViewModal();
  showSaved("Student updated successfully.");
  await refreshStudents();
}

async function handleDelete() {
  const student = findStudent(state.currentStudentId);
  if (!student) return showWarning("No student selected/found.");

  const confirmed = await confirmAction({
    title: "Delete Student?",
    message: `Are you sure you want to delete ${student.name} (${student.rollNo})? This cannot be undone.`,
    confirmText: "Yes, Delete",
  });
  if (!confirmed) return;

  const result = await runOperation({
    message: "Deleting student...",
    button: dom.deleteBtn,
    busyText: "Deleting...",
    task: () => removeStudent(student.id),
  });

  if (result.skipped) return;
  if (!result.ok) return handleOperationError(result.error);

  if (String(state.newStudentId) === String(student.id))
    state.newStudentId = null;
  closeViewModal();
  showSaved("Student deleted successfully.");
  await refreshStudents();
}

async function handleRefresh() {
  const ok = await refreshStudents({
    button: dom.refreshBtn,
    busyText: "Refreshing...",
  });
  if (ok) showSuccess("Student data refreshed successfully.");
}

function debounce(callback, delay = 400) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => callback(...args), delay);
  };
}

function onControlChange() {
  state.newStudentId = null;
  state.currentPage = 1;
  savePrefs();
  render();
}

function resetFilters() {
  state.search = "";
  dom.searchInput.value = "";
  state.filter = state.grade = "all";
  dom.filterSelect.value = dom.gradeSelect.value = "all";
  state.currentPage = 1;
  savePrefs();
}

function applyPrefsToControls() {
  const apply = (select, value, fallback) => {
    select.value = value;
    if (select.value !== String(value)) select.value = fallback;
    return select.value;
  };
  state.filter = apply(dom.filterSelect, state.filter, DEFAULT_PREFS.filter);
  state.grade = apply(dom.gradeSelect, state.grade, DEFAULT_PREFS.grade);
  state.sort = apply(dom.sortSelect, state.sort, DEFAULT_PREFS.sort);
  state.rowsPerPage = Number(
    apply(dom.rowsSelect, state.rowsPerPage, DEFAULT_PREFS.rowsPerPage),
  );
}

function bindEvents() {
  dom.searchInput.addEventListener(
    "input",
    debounce(() => {
      state.search = dom.searchInput.value.trim().toLowerCase();
      onControlChange();
    }, 400),
  );
  dom.filterSelect.addEventListener("change", () => {
    state.filter = dom.filterSelect.value;
    onControlChange();
  });
  dom.gradeSelect.addEventListener("change", () => {
    state.grade = dom.gradeSelect.value;
    onControlChange();
  });
  dom.sortSelect.addEventListener("change", () => {
    state.sort = dom.sortSelect.value;
    onControlChange();
  });
  dom.rowsSelect.addEventListener("change", () => {
    state.rowsPerPage = Number(dom.rowsSelect.value);
    onControlChange();
  });

  dom.refreshBtn.addEventListener("click", handleRefresh);
  dom.retryBtn.addEventListener("click", () => refreshStudents());

  dom.tableBody.addEventListener("click", (e) => {
    const btn = e.target.closest(".view-btn");
    if (btn) openViewModal(btn.dataset.id);
  });

  dom.pagination.addEventListener("click", (e) => {
    const btn = e.target.closest(".page-btn");
    if (!btn || btn.disabled) return;

    const page = btn.dataset.page;
    if (page === "prev") state.currentPage -= 1;
    else if (page === "next") state.currentPage += 1;
    else state.currentPage = Number(page);
    render();
  });

  dom.addBtn.addEventListener("click", openAddForm);
  dom.closeFormBtn.addEventListener("click", closeAddForm);
  dom.resetBtn.addEventListener("click", resetForm);
  dom.form.addEventListener("submit", handleAddSubmit);

  dom.closeViewBtn.addEventListener("click", closeViewModal);
  dom.viewModal.addEventListener("click", (e) => {
    if (e.target === dom.viewModal) closeViewModal();
  });
  dom.editBtn.addEventListener("click", () => setEditMode(true));
  dom.saveChangesBtn.addEventListener("click", handleUpdate);
  dom.deleteBtn.addEventListener("click", handleDelete);

  bindLiveValidation(addFields);
  bindLiveValidation(viewFields);
  addFields
    .filter((f) => f.numeric)
    .forEach((f) => f.input.addEventListener("input", renderAddPreview));
  viewFields
    .filter((f) => f.numeric)
    .forEach((f) => f.input.addEventListener("input", renderViewPreview));

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (isOpen(dom.confirmModal)) dom.confirmNoBtn.click();
      else if (isOpen(dom.viewModal)) closeViewModal();
      else if (isOpen(dom.form)) closeAddForm();
    }

    const typingInViewForm =
      e.key === "Enter" &&
      state.editing &&
      isOpen(dom.viewModal) &&
      !isOpen(dom.confirmModal) &&
      e.target.matches("input");
    if (typingInViewForm) {
      e.preventDefault();
      dom.saveChangesBtn.click();
    }
  });
}

console.log("Student app: script loaded (v3)");
applyPrefsToControls();
bindEvents();
showPendingToast();
renderAddPreview();
refreshStudents();
