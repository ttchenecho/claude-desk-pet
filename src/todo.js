"use strict";

const { BrowserWindow, nativeTheme } = require("electron");
const path = require("path");
const { clampTextScale, scaleWidth, scaleHeight, applyZoomToWindow } = require("./text-scale");

const DEFAULT_WIDTH = 420;
const DEFAULT_HEIGHT = 560;
const MIN_WIDTH = 320;
const MIN_HEIGHT = 400;
const LIGHT_BACKGROUND = "#f5f5f7";
const DARK_BACKGROUND = "#1c1c1f";

function getTodoBackgroundColor() {
  return nativeTheme.shouldUseDarkColors ? DARK_BACKGROUND : LIGHT_BACKGROUND;
}

function isUsableBounds(bounds) {
  return !!bounds
    && Number.isFinite(bounds.x)
    && Number.isFinite(bounds.y)
    && Number.isFinite(bounds.width)
    && Number.isFinite(bounds.height)
    && bounds.width > 0
    && bounds.height > 0;
}

function clampBoundsToWorkArea(bounds, workArea) {
  const width = Math.min(bounds.width, workArea.width);
  const height = Math.min(bounds.height, workArea.height);
  const minX = workArea.x;
  const minY = workArea.y;
  const maxX = workArea.x + workArea.width - width;
  const maxY = workArea.y + workArea.height - height;
  return {
    x: Math.round(Math.min(Math.max(bounds.x, minX), maxX)),
    y: Math.round(Math.min(Math.max(bounds.y, minY), maxY)),
    width: Math.round(width),
    height: Math.round(height),
  };
}

module.exports = function initTodo(ctx) {
  let todoWindow = null;
  const scheduleLater = typeof ctx.setTimeout === "function" ? ctx.setTimeout : setTimeout;

  function getTextScale() {
    return clampTextScale(typeof ctx.getTextScale === "function" ? ctx.getTextScale() : 1);
  }

  function getScaledMetrics() {
    const scale = getTextScale();
    return {
      defaultWidth: scaleWidth(DEFAULT_WIDTH, scale),
      defaultHeight: scaleHeight(DEFAULT_HEIGHT, scale),
      minWidth: scaleWidth(MIN_WIDTH, scale),
      minHeight: scaleHeight(MIN_HEIGHT, scale),
    };
  }

  function computeInitialBounds() {
    const petBounds = typeof ctx.getPetWindowBounds === "function"
      ? ctx.getPetWindowBounds()
      : null;
    const cx = petBounds ? petBounds.x + petBounds.width / 2 : 0;
    const cy = petBounds ? petBounds.y + petBounds.height / 2 : 0;
    const workArea = typeof ctx.getNearestWorkArea === "function"
      ? ctx.getNearestWorkArea(cx, cy)
      : { x: 0, y: 0, width: 1280, height: 800 };
    const metrics = getScaledMetrics();
    const width = Math.min(metrics.defaultWidth, Math.max(metrics.minWidth, workArea.width));
    const height = Math.min(metrics.defaultHeight, Math.max(metrics.minHeight, workArea.height));
    return {
      x: Math.round(workArea.x + (workArea.width - width) / 2),
      y: Math.round(workArea.y + (workArea.height - height) / 2),
      width,
      height,
    };
  }

  function getSettingsWindow() {
    return typeof ctx.getSettingsWindow === "function"
      ? ctx.getSettingsWindow()
      : null;
  }

  function getSettingsBounds(settingsWindow) {
    if (!settingsWindow || typeof settingsWindow.isDestroyed !== "function") return null;
    if (settingsWindow.isDestroyed()) return null;
    if (typeof settingsWindow.isMinimized === "function" && settingsWindow.isMinimized()) return null;
    if (typeof settingsWindow.getBounds !== "function") return null;
    const bounds = settingsWindow.getBounds();
    return isUsableBounds(bounds) ? bounds : null;
  }

  function computeSettingsAnchoredBounds(settingsBounds) {
    const cx = settingsBounds.x + settingsBounds.width / 2;
    const cy = settingsBounds.y + settingsBounds.height / 2;
    const workArea = typeof ctx.getNearestWorkArea === "function"
      ? ctx.getNearestWorkArea(cx, cy)
      : { x: 0, y: 0, width: 1280, height: 800 };
    const metrics = getScaledMetrics();
    const width = Math.max(metrics.minWidth, Math.min(metrics.defaultWidth, settingsBounds.width, workArea.width));
    const height = Math.max(metrics.minHeight, Math.min(settingsBounds.height, workArea.height));
    return clampBoundsToWorkArea({
      x: settingsBounds.x + (settingsBounds.width - width) / 2,
      y: settingsBounds.y,
      width,
      height,
    }, workArea);
  }

  function getTodoPlacement(options = {}) {
    if (options.source !== "settings") {
      return { bounds: computeInitialBounds() };
    }
    const settingsWindow = getSettingsWindow();
    const settingsBounds = getSettingsBounds(settingsWindow);
    if (!settingsBounds) {
      return { bounds: computeInitialBounds() };
    }
    return {
      bounds: computeSettingsAnchoredBounds(settingsBounds),
    };
  }

  function applySettingsPlacement(options = {}) {
    if (options.source !== "settings") return;
    if (!todoWindow || todoWindow.isDestroyed()) return;
    const placement = getTodoPlacement(options);
    if (isUsableBounds(placement.bounds) && typeof todoWindow.setBounds === "function") {
      todoWindow.setBounds(placement.bounds);
      applyTextScaleToWindow();
    }
  }

  function scheduleSettingsPlacementSync(options = {}) {
    if (options.source !== "settings") return;
    for (const delay of [0, 80]) {
      scheduleLater(() => {
        applySettingsPlacement(options);
      }, delay);
    }
  }

  function sendI18n() {
    if (!todoWindow || todoWindow.isDestroyed()) return;
    if (!todoWindow.webContents || todoWindow.webContents.isDestroyed()) return;
    if (typeof ctx.getI18n !== "function") return;
    todoWindow.webContents.send("todo:lang-change", ctx.getI18n());
  }

  function createTodoWindow(options = {}) {
    const placement = getTodoPlacement(options);
    const metrics = getScaledMetrics();
    const opts = {
      ...placement.bounds,
      minWidth: metrics.minWidth,
      minHeight: metrics.minHeight,
      show: false,
      frame: true,
      transparent: false,
      resizable: true,
      minimizable: true,
      maximizable: true,
      skipTaskbar: false,
      alwaysOnTop: false,
      title: typeof ctx.t === "function" ? ctx.t("todoWindowTitle") : "To-Do",
      backgroundColor: getTodoBackgroundColor(),
      webPreferences: {
        preload: path.join(__dirname, "preload-todo.js"),
        nodeIntegration: false,
        contextIsolation: true,
      },
    };
    if (ctx.iconPath) opts.icon = ctx.iconPath;

    todoWindow = new BrowserWindow(opts);
    todoWindow.setMenuBarVisibility(false);
    todoWindow.loadFile(path.join(__dirname, "todo.html"));

    let moveTextScaleTimer = null;
    todoWindow.on("move", () => {
      if (moveTextScaleTimer) clearTimeout(moveTextScaleTimer);
      moveTextScaleTimer = scheduleLater(() => {
        moveTextScaleTimer = null;
        applyTextScaleToWindow();
      }, 350);
    });

    todoWindow.webContents.once("did-finish-load", () => {
      applyZoomToWindow(todoWindow, getTextScale());
      sendI18n();
    });

    todoWindow.once("ready-to-show", () => {
      if (!todoWindow || todoWindow.isDestroyed()) return;
      applySettingsPlacement(options);
      todoWindow.show();
      scheduleSettingsPlacementSync(options);
      todoWindow.focus();
    });

    todoWindow.on("closed", () => {
      todoWindow = null;
    });

    return todoWindow;
  }

  function syncThemeBackground() {
    if (!todoWindow || todoWindow.isDestroyed()) return;
    todoWindow.setBackgroundColor(getTodoBackgroundColor());
  }

  if (nativeTheme && typeof nativeTheme.on === "function") {
    nativeTheme.on("updated", syncThemeBackground);
  }

  function showTodo(options = {}) {
    if (todoWindow && !todoWindow.isDestroyed()) {
      if (todoWindow.isMinimized()) todoWindow.restore();
      applySettingsPlacement(options);
      todoWindow.show();
      scheduleSettingsPlacementSync(options);
      todoWindow.focus();
      sendI18n();
      return todoWindow;
    }
    return createTodoWindow(options);
  }

  function applyTextScaleToWindow() {
    if (!todoWindow || todoWindow.isDestroyed()) return;
    const metrics = getScaledMetrics();
    applyZoomToWindow(todoWindow, getTextScale());
    if (typeof todoWindow.setMinimumSize === "function") {
      todoWindow.setMinimumSize(metrics.minWidth, metrics.minHeight);
    }
    if (typeof todoWindow.getBounds !== "function") return;
    const bounds = todoWindow.getBounds();
    if (bounds.width < metrics.minWidth || bounds.height < metrics.minHeight) {
      todoWindow.setBounds({
        ...bounds,
        width: Math.max(bounds.width, metrics.minWidth),
        height: Math.max(bounds.height, metrics.minHeight),
      });
    }
  }

  return {
    showTodo,
    sendI18n,
    getWindow: () => todoWindow,
    applyTextScaleToWindow,
  };
};
