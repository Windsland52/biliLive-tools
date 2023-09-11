import { join } from "path";
import fs from "fs-extra";

import { app, dialog, BrowserWindow, ipcMain, shell, Tray, Menu } from "electron";
import type { IpcMainInvokeEvent, IpcMain } from "electron";
import installExtension from "electron-devtools-installer";
import { electronApp, optimizer, is } from "@electron-toolkit/utils";
import log from "./utils/log";

import icon from "../../resources/icon.png?asset";
import { saveDanmuConfig, getDanmuConfig, convertDanmu2Ass } from "./danmu";
import { convertVideo2Mp4, mergeAssMp4, getAvailableEncoders } from "./video";
import { checkFFmpegRunning, getAllFFmpegProcesses } from "./utils/index";
import { CONFIG_PATH } from "./config";

import type { OpenDialogOptions } from "../types";

const genHandler = (ipcMain: IpcMain) => {
  // 通用函数
  ipcMain.handle("dialog:openDirectory", openDirectory);
  ipcMain.handle("dialog:openFile", openFile);
  ipcMain.handle("getVersion", getVersion);
  ipcMain.handle("openExternal", openExternal);
  ipcMain.handle("openPath", openPath);
  ipcMain.handle("exits", exits);
  ipcMain.handle("trashItem", trashItem);

  // 视频处理
  ipcMain.handle("convertVideo2Mp4", convertVideo2Mp4);
  ipcMain.handle("mergeAssMp4", mergeAssMp4);
  ipcMain.handle("getAvailableEncoders", getAvailableEncoders);

  // 弹幕相关
  ipcMain.handle("saveDanmuConfig", saveDanmuConfig);
  ipcMain.handle("getDanmuConfig", getDanmuConfig);
  ipcMain.handle("convertDanmu2Ass", convertDanmu2Ass);
};

let mainWin: BrowserWindow;
function createWindow(): void {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 900,
    height: 750,
    show: false,
    autoHideMenuBar: false,
    ...(process.platform === "linux" ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      sandbox: false,
    },
  });

  mainWindow.on("ready-to-show", () => {
    mainWindow.show();
  });

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url);
    return { action: "deny" };
  });

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
    mainWindow.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }
  mainWin = mainWindow;
  const content = mainWindow.webContents;

  content.on("render-process-gone", (_event, details) => {
    log.error(`render-process-gone: ${JSON.stringify(details)}`);
  });
  content.on("unresponsive", (event) => {
    log.error(`unresponsive: ${JSON.stringify(event)}`);
  });
  content.on("preload-error", (_event, preloadPath, error) => {
    log.error(`preload-error: ${preloadPath},${error}`);
  });

  // 触发关闭时触发
  mainWin.on("close", (event) => {
    // 截获 close 默认行为
    event.preventDefault();
    // 点击关闭时触发close事件，我们按照之前的思路在关闭时，隐藏窗口，隐藏任务栏窗口
    mainWin.hide();
    // mainWin.setSkipTaskbar(true);
  });

  // 新建托盘
  const tray = new Tray(join(icon));
  // 托盘名称
  tray.setToolTip("biliLive-tools");
  // 托盘菜单
  const contextMenu = Menu.buildFromTemplate([
    {
      label: "显示",
      click: () => {
        mainWin.show();
      },
    },
    {
      label: "退出",
      click: async () => {
        try {
          const isRunning = await checkFFmpegRunning();
          if (isRunning) {
            const confirm = await dialog.showMessageBox(mainWin, {
              message: "检测到有正在运行的ffmpeg进程，是否退出？",
              buttons: ["取消", "退出", "退出并杀死进程"],
            });
            if (confirm.response === 1) {
              mainWin.destroy();
              app.quit();
            } else if (confirm.response === 2) {
              const processes = await getAllFFmpegProcesses();
              processes.forEach((item) => {
                process.kill(item.pid, "SIGTERM");
              });
              mainWin.destroy();
            }
          } else {
            mainWin.destroy();
          }
        } catch (e) {
          mainWin.destroy();
          log.error(e);
        }
      },
    },
  ]);
  // 载入托盘菜单
  tray.setContextMenu(contextMenu);
  // 双击触发
  tray.on("double-click", () => {
    if (mainWin.isMinimized()) {
      mainWin.restore();
    } else {
      mainWin.isVisible() ? mainWin.hide() : mainWin.show();
    }
    // mainWin.isVisible() ? mainWin.setSkipTaskbar(false) : mainWin.setSkipTaskbar(true);
  });
}

function createMenu(): void {
  const menu = Menu.buildFromTemplate([
    {
      label: "设置",
      click: () => {
        mainWin.show();
        mainWin.webContents.send("open-setting");
      },
    },
    {
      label: "退出",
      click: async () => {
        try {
          const isRunning = await checkFFmpegRunning();
          if (isRunning) {
            const confirm = await dialog.showMessageBox(mainWin, {
              message: "检测到有正在运行的ffmpeg进程，是否退出？",
              buttons: ["取消", "退出", "退出并杀死进程"],
            });
            if (confirm.response === 1) {
              mainWin.destroy();
              app.quit();
            } else if (confirm.response === 2) {
              const processes = await getAllFFmpegProcesses();
              processes.forEach((item) => {
                process.kill(item.pid, "SIGTERM");
              });
              mainWin.destroy();
            }
          } else {
            mainWin.destroy();
          }
        } catch (e) {
          mainWin.destroy();
          log.error(e);
        }
      },
    },
    {
      label: "开发者工具",
      role: "viewMenu",
    },
  ]);
  Menu.setApplicationMenu(menu);
}

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.whenReady().then(() => {
    electronApp.setAppUserModelId("com.electron");
    installExtension("nhdogjmejiglipccpnnnanhbledajbpd")
      .then((name) => log.debug(`Added Extension:  ${name}`))
      .catch((err) => log.debug("An error occurred: ", err));

    log.info("app start");
    fs.ensureDir(CONFIG_PATH);
    // Default open or close DevTools by F12 in development
    // and ignore CommandOrControl + R in production.
    // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
    app.on("browser-window-created", (_, window) => {
      optimizer.watchWindowShortcuts(window);
    });

    createWindow();
    createMenu();
    genHandler(ipcMain);

    app.on("activate", function () {
      // On macOS it's common to re-create a window in the app when the
      // dock icon is clicked and there are no other windows open.
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  process.on("uncaughtException", function (error) {
    log.error(error);
  });

  app.on("second-instance", (_event, _commandLine, _workingDirectory) => {
    // 有人试图运行第二个实例，我们应该关注我们的窗口
    if (mainWin) {
      if (mainWin.isMinimized()) mainWin.restore();
      if (!mainWin.isVisible()) mainWin.show();
      mainWin.focus();
    }
  });

  // Quit when all windows are closed, except on macOS. There, it's common
  // for applications and their menu bar to stay active until the user quits
  // explicitly with Cmd + Q.
  app.on("window-all-closed", () => {
    log.info("app quit");
    if (process.platform !== "darwin") {
      app.quit();
    }
  });
}

const openDirectory = async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWin, {
    properties: ["openDirectory"],
  });
  if (canceled) {
    return;
  } else {
    return filePaths[0];
  }
};
const openFile = async (_event: IpcMainInvokeEvent, options: OpenDialogOptions) => {
  const properties: ("openFile" | "multiSelections")[] = ["openFile"];
  if (options.multi) {
    properties.push("multiSelections");
  }

  const { canceled, filePaths } = await dialog.showOpenDialog(mainWin, {
    properties,
    ...options,
  });
  if (canceled) {
    return;
  } else {
    return filePaths;
  }
};

const getVersion = () => {
  return app.getVersion();
};

const openExternal = (_event: IpcMainInvokeEvent, url: string) => {
  shell.openExternal(url);
};

const openPath = (_event: IpcMainInvokeEvent, path: string) => {
  shell.openPath(path);
};

const exits = (_event: IpcMainInvokeEvent, path: string) => {
  return fs.existsSync(path);
};

const trashItem = async (_event: IpcMainInvokeEvent, path: string) => {
  return await shell.trashItem(path);
};
