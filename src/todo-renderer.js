"use strict";

let todos = [];
let i18nPayload = { lang: "en", translations: {} };

const titleEl = document.getElementById("title");
const addTaskInput = document.getElementById("add-task-input");
const contentEl = document.getElementById("content");

function t(key) {
  const dict = i18nPayload && i18nPayload.translations ? i18nPayload.translations : {};
  return dict[key] || key;
}

// Format "2026-06-21T18:00" to local readable string
function formatDeadline(deadlineStr) {
  if (!deadlineStr) return "";
  const d = new Date(deadlineStr);
  if (isNaN(d.getTime())) return deadlineStr;
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const isTomorrow = d.toDateString() === tomorrow.toDateString();
  const timeStr = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (isToday) return `今天 ${timeStr}`;
  if (isTomorrow) return `明天 ${timeStr}`;
  const month = d.getMonth() + 1;
  const day = d.getDate();
  return `${month}月${day}日 ${timeStr}`;
}

function isOverdue(deadlineStr) {
  if (!deadlineStr) return false;
  const d = new Date(deadlineStr);
  if (isNaN(d.getTime())) return false;
  return d < new Date();
}

// Convert ISO string to datetime-local input value (YYYY-MM-DDTHH:mm)
function toDatetimeLocal(deadlineStr) {
  if (!deadlineStr) {
    const now = new Date();
    now.setMinutes(0, 0, 0);
    now.setHours(now.getHours() + 1);
    const pad = (n) => String(n).padStart(2, "0");
    return `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
  }
  const d = new Date(deadlineStr);
  if (isNaN(d.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function groupByDate(todoList) {
  const groups = new Map();
  for (const todo of todoList) {
    if (!groups.has(todo.date)) groups.set(todo.date, []);
    groups.get(todo.date).push(todo);
  }
  return Array.from(groups.entries()).sort((a, b) => {
    return b[0].split(" ")[0].localeCompare(a[0].split(" ")[0]);
  });
}

function renderEmpty() {
  const empty = document.createElement("div");
  empty.className = "empty";
  const title = document.createElement("div");
  title.className = "empty-title";
  title.textContent = t("todoEmpty");
  empty.appendChild(title);
  const hint = document.createElement("div");
  hint.className = "empty-hint";
  hint.textContent = t("todoEmptyHint");
  empty.appendChild(hint);
  contentEl.replaceChildren(empty);
}

function createTaskItem(todo) {
  const item = document.createElement("div");
  item.className = "task-item";
  if (todo.completed) item.classList.add("completed");
  if (!todo.completed && isOverdue(todo.deadline)) item.classList.add("overdue");

  // Checkbox
  const checkbox = document.createElement("div");
  checkbox.className = "task-checkbox";
  if (todo.completed) checkbox.classList.add("checked");
  checkbox.title = t("todoToggleTitle");
  checkbox.addEventListener("click", async () => {
    checkbox.style.pointerEvents = "none";
    try {
      const completing = !todo.completed;
      const result = await window.todoAPI.updateTodo(todo.id, { completed: completing });
      if (result && result.status === "ok") {
        if (completing) {
          // Add completed styles immediately for visual feedback
          item.classList.add("completed");
          checkbox.classList.add("checked");
          // Then animate out after 1 second
          setTimeout(() => {
            item.classList.add("fade-out");
            item.addEventListener("transitionend", () => {
              loadTodos();
            }, { once: true });
          }, 1000);
        } else {
          await loadTodos();
        }
      }
    } catch (err) {
      console.warn("Failed to toggle todo:", err);
    } finally {
      checkbox.style.pointerEvents = "";
    }
  });
  item.appendChild(checkbox);

  // Main content area
  const main = document.createElement("div");
  main.className = "task-main";

  // Task content text (double-click to edit)
  const content = document.createElement("div");
  content.className = "task-content";
  content.textContent = todo.content;
  content.addEventListener("dblclick", () => {
    const input = document.createElement("input");
    input.type = "text";
    input.className = "task-content-input";
    input.value = todo.content;

    const save = async () => {
      const newContent = input.value.trim();
      if (!newContent || newContent === todo.content) {
        input.replaceWith(content);
        return;
      }
      input.disabled = true;
      try {
        const result = await window.todoAPI.updateTodo(todo.id, { content: newContent });
        if (result && result.status === "ok") await loadTodos();
        else input.replaceWith(content);
      } catch (err) {
        input.replaceWith(content);
      }
    };

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); save(); }
      else if (e.key === "Escape") { e.preventDefault(); input.replaceWith(content); }
    });
    input.addEventListener("blur", save);
    content.replaceWith(input);
    input.focus();
    input.select();
  });
  main.appendChild(content);

  // Deadline row
  const deadlineRow = document.createElement("div");
  deadlineRow.className = "task-deadline-row";

  const deadlineLabel = document.createElement("span");
  deadlineLabel.className = "task-deadline-text";
  if (todo.deadline) {
    const overdue = !todo.completed && isOverdue(todo.deadline);
    deadlineLabel.textContent = `${t("todoDeadlineLabel")} ${formatDeadline(todo.deadline)}`;
    if (overdue) deadlineLabel.classList.add("overdue-text");
  } else {
    deadlineLabel.textContent = t("todoNoDeadline");
    deadlineLabel.classList.add("muted");
  }

  const editDeadlineBtn = document.createElement("button");
  editDeadlineBtn.className = "task-deadline-edit-btn";
  editDeadlineBtn.type = "button";
  editDeadlineBtn.textContent = "✎";
  editDeadlineBtn.title = t("todoEditTimeTitle");

  editDeadlineBtn.addEventListener("click", (e) => {
    e.stopPropagation();

    // Replace the row with a datetime picker + confirm/cancel buttons
    const pickerWrap = document.createElement("div");
    pickerWrap.className = "task-deadline-picker";

    const picker = document.createElement("input");
    picker.type = "datetime-local";
    picker.className = "task-deadline-input";
    picker.value = toDatetimeLocal(todo.deadline);

    const clearBtn = document.createElement("button");
    clearBtn.type = "button";
    clearBtn.className = "task-deadline-clear-btn";
    clearBtn.textContent = t("todoClearDeadline");
    clearBtn.title = t("todoClearDeadline");

    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "task-deadline-cancel-btn";
    cancelBtn.textContent = "✕";
    cancelBtn.title = t("cancel");

    const save = async (newDeadline) => {
      if (newDeadline === todo.deadline) {
        pickerWrap.replaceWith(deadlineRow);
        return;
      }
      picker.disabled = true;
      try {
        const result = await window.todoAPI.updateTodo(todo.id, { deadline: newDeadline });
        if (result && result.status === "ok") await loadTodos();
        else pickerWrap.replaceWith(deadlineRow);
      } catch (err) {
        pickerWrap.replaceWith(deadlineRow);
      }
    };

    picker.addEventListener("change", () => save(picker.value));
    clearBtn.addEventListener("click", () => save(""));
    cancelBtn.addEventListener("click", () => pickerWrap.replaceWith(deadlineRow));

    pickerWrap.appendChild(picker);
    pickerWrap.appendChild(clearBtn);
    pickerWrap.appendChild(cancelBtn);
    deadlineRow.replaceWith(pickerWrap);

    // Open the picker immediately
    requestAnimationFrame(() => {
      try { picker.showPicker(); } catch (_) { picker.focus(); }
    });
  });

  deadlineRow.appendChild(deadlineLabel);
  deadlineRow.appendChild(editDeadlineBtn);
  main.appendChild(deadlineRow);

  item.appendChild(main);

  // Delete button
  const deleteBtn = document.createElement("button");
  deleteBtn.className = "task-delete";
  deleteBtn.type = "button";
  deleteBtn.textContent = "×";
  deleteBtn.title = t("todoDeleteTitle");
  deleteBtn.addEventListener("click", async () => {
    deleteBtn.disabled = true;
    try {
      const result = await window.todoAPI.deleteTodo(todo.id);
      if (result && result.status === "ok") await loadTodos();
      else deleteBtn.disabled = false;
    } catch (err) {
      deleteBtn.disabled = false;
    }
  });
  item.appendChild(deleteBtn);

  return item;
}

function render() {
  titleEl.textContent = t("todoWindowTitle");
  addTaskInput.placeholder = t("todoAddPlaceholder");
  document.title = t("todoWindowTitle");

  const activeTodos = todos.filter(t => !t.completed);
  if (activeTodos.length === 0) { renderEmpty(); return; }

  const fragment = document.createDocumentFragment();
  for (const [date, dateTodos] of groupByDate(activeTodos)) {
    const section = document.createElement("div");
    section.className = "date-group";
    const dateTitle = document.createElement("h2");
    dateTitle.className = "date-title";
    dateTitle.textContent = date;
    section.appendChild(dateTitle);
    const tasks = document.createElement("div");
    tasks.className = "tasks";
    for (const todo of dateTodos) tasks.appendChild(createTaskItem(todo));
    section.appendChild(tasks);
    fragment.appendChild(section);
  }
  contentEl.replaceChildren(fragment);
}

async function loadTodos() {
  try {
    const result = await window.todoAPI.getTodos();
    if (result && result.status === "ok") {
      todos = result.todos || [];
      render();
    }
  } catch (err) {
    console.warn("Failed to load todos:", err);
  }
}

addTaskInput.addEventListener("keydown", async (e) => {
  if (e.key !== "Enter") return;
  e.preventDefault();
  const content = addTaskInput.value.trim();
  if (!content) return;
  addTaskInput.disabled = true;
  try {
    const result = await window.todoAPI.addTodo(content, "");
    if (result && result.status === "ok") {
      addTaskInput.value = "";
      await loadTodos();
    }
  } catch (err) {
    console.warn("Failed to add todo:", err);
  } finally {
    addTaskInput.disabled = false;
    addTaskInput.focus();
  }
});

async function init() {
  window.todoAPI.onLangChange((payload) => {
    i18nPayload = payload || i18nPayload;
    render();
  });
  const [nextI18n] = await Promise.all([window.todoAPI.getI18n(), loadTodos()]);
  i18nPayload = nextI18n || i18nPayload;
  render();
}

init().catch((err) => {
  contentEl.textContent = err && err.message ? err.message : String(err);
});
