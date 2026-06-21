"use strict";

const fs = require("fs");
const path = require("path");

function requiredDependency(value, name) {
  if (!value) throw new Error(`registerTodoIpc requires ${name}`);
  return value;
}

function ensureDir(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function getCurrentDateString() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const dayNames = ["日", "一", "二", "三", "四", "五", "六"];
  return `${year}-${month}-${day} 周${dayNames[now.getDay()]}`;
}

// Parse todos from markdown. Each task line format:
//   - [ ] content @2026-06-21T18:00 +r1h +r15m
// where +r1h / +r15m track whether reminders have been sent.
function readTodosFromFile(todoFilePath) {
  ensureDir(todoFilePath);
  if (!fs.existsSync(todoFilePath)) return [];

  try {
    const content = fs.readFileSync(todoFilePath, "utf8");
    const todos = [];
    const lines = content.split("\n");
    let currentDate = null;
    let lineIndex = 0;

    for (const line of lines) {
      const dateMatch = line.match(/^##\s+(.+)$/);
      if (dateMatch) { currentDate = dateMatch[1].trim(); lineIndex = 0; continue; }

      const taskMatch = line.match(/^-\s+\[([ x])\]\s+(.+?)(?:\s+@([^\s+]+))?(\s+\+r1h)?(\s+\+r15m)?$/);
      if (taskMatch && currentDate) {
        const [, checkedStr, content, deadline, reminded1h, reminded15m] = taskMatch;
        todos.push({
          id: `${currentDate}-${lineIndex}`,
          content: content.trim(),
          deadline: deadline ? deadline.trim() : "",
          completed: checkedStr.toLowerCase() === "x",
          date: currentDate,
          reminded1h: !!reminded1h,
          reminded15m: !!reminded15m,
        });
        lineIndex++;
      }
    }
    return todos;
  } catch (err) {
    console.warn("Failed to read todos:", err);
    return [];
  }
}

function writeTodosToFile(todoFilePath, todos) {
  ensureDir(todoFilePath);
  const byDate = new Map();
  for (const todo of todos) {
    if (!byDate.has(todo.date)) byDate.set(todo.date, []);
    byDate.get(todo.date).push(todo);
  }

  const sortedDates = Array.from(byDate.keys()).sort((a, b) =>
    b.split(" ")[0].localeCompare(a.split(" ")[0])
  );

  const lines = [];
  for (const date of sortedDates) {
    lines.push(`## ${date}`);
    lines.push("");
    for (const todo of byDate.get(date)) {
      const checkbox = todo.completed ? "[x]" : "[ ]";
      const deadlineStr = todo.deadline ? ` @${todo.deadline}` : "";
      const r1h = todo.reminded1h ? " +r1h" : "";
      const r15m = todo.reminded15m ? " +r15m" : "";
      lines.push(`- ${checkbox} ${todo.content}${deadlineStr}${r1h}${r15m}`);
    }
    lines.push("");
  }

  fs.writeFileSync(todoFilePath, lines.join("\n"), "utf8");
}

function registerTodoIpc(options = {}) {
  const ipcMain = requiredDependency(options.ipcMain, "ipcMain");
  const getI18n = requiredDependency(options.getI18n, "getI18n");
  const todoFilePath = requiredDependency(options.todoFilePath, "todoFilePath");
  const onTodosChanged = typeof options.onTodosChanged === "function" ? options.onTodosChanged : () => {};
  const disposers = [];

  function handle(channel, listener) {
    ipcMain.handle(channel, listener);
    disposers.push(() => ipcMain.removeHandler(channel));
  }

  const readTodos = () => readTodosFromFile(todoFilePath);
  const writeTodos = (todos) => writeTodosToFile(todoFilePath, todos);

  handle("todo:get-i18n", () => getI18n());

  handle("todo:get-todos", () => {
    try { return { status: "ok", todos: readTodos() }; }
    catch (err) { return { status: "error", message: err && err.message }; }
  });

  handle("todo:add-todo", (_event, payload) => {
    if (!payload || typeof payload.content !== "string" || !payload.content.trim()) {
      return { status: "error", message: "Content is required" };
    }
    try {
      const todos = readTodos();
      const dateStr = getCurrentDateString();
      const newTodo = {
        id: `${dateStr}-${todos.length}`,
        content: payload.content.trim(),
        deadline: typeof payload.deadline === "string" ? payload.deadline.trim() : "",
        completed: false,
        date: dateStr,
        reminded1h: false,
        reminded15m: false,
      };
      todos.unshift(newTodo);
      writeTodos(todos);
      onTodosChanged();
      return { status: "ok", todo: newTodo };
    } catch (err) {
      return { status: "error", message: err && err.message };
    }
  });

  handle("todo:update-todo", (_event, payload) => {
    if (!payload || typeof payload.id !== "string") {
      return { status: "error", message: "Todo ID is required" };
    }
    try {
      const todos = readTodos();
      const index = todos.findIndex((t) => t.id === payload.id);
      if (index === -1) return { status: "error", message: "Todo not found" };

      const u = payload.updates || {};
      if (typeof u.content === "string") todos[index].content = u.content.trim();
      if (typeof u.completed === "boolean") todos[index].completed = u.completed;
      if (typeof u.deadline === "string") {
        todos[index].deadline = u.deadline.trim();
        // Reset reminder flags when deadline changes
        todos[index].reminded1h = false;
        todos[index].reminded15m = false;
      }
      if (typeof u.reminded1h === "boolean") todos[index].reminded1h = u.reminded1h;
      if (typeof u.reminded15m === "boolean") todos[index].reminded15m = u.reminded15m;

      writeTodos(todos);
      onTodosChanged();
      return { status: "ok", todo: todos[index] };
    } catch (err) {
      return { status: "error", message: err && err.message };
    }
  });

  handle("todo:delete-todo", (_event, payload) => {
    if (!payload || typeof payload.id !== "string") {
      return { status: "error", message: "Todo ID is required" };
    }
    try {
      const todos = readTodos();
      const filtered = todos.filter((t) => t.id !== payload.id);
      if (filtered.length === todos.length) return { status: "error", message: "Todo not found" };
      writeTodos(filtered);
      return { status: "ok" };
    } catch (err) {
      return { status: "error", message: err && err.message };
    }
  });

  return {
    dispose() {
      while (disposers.length) disposers.pop()();
    },
  };
}

module.exports = {
  registerTodoIpc,
  readTodosFromFile,
  writeTodosToFile,
};
