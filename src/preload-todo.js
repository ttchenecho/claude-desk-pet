"use strict";

const { contextBridge, ipcRenderer } = require("electron");

const langListeners = new Set();

ipcRenderer.on("todo:lang-change", (_event, payload) => {
  for (const cb of langListeners) {
    try { cb(payload); } catch (err) { console.warn("todo lang listener threw:", err); }
  }
});

contextBridge.exposeInMainWorld("todoAPI", {
  getI18n: () => ipcRenderer.invoke("todo:get-i18n"),
  getTodos: () => ipcRenderer.invoke("todo:get-todos"),
  addTodo: (content, deadline) => ipcRenderer.invoke("todo:add-todo", { content, deadline }),
  updateTodo: (id, updates) => ipcRenderer.invoke("todo:update-todo", { id, updates }),
  deleteTodo: (id) => ipcRenderer.invoke("todo:delete-todo", { id }),
  onLangChange: (cb) => {
    if (typeof cb !== "function") return () => {};
    langListeners.add(cb);
    return () => langListeners.delete(cb);
  },
});
