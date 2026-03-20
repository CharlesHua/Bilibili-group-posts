// 当前页面模式：
// - 默认：小窗模式
// - view=page：完整网页模式
// - view=settings：设置页面
const currentView = new URLSearchParams(window.location.search).get("view") || "popup";
const isFullPageMode = currentView === "page";
const isSettingsPage = currentView === "settings";

const DEFAULT_DISPLAY_SETTINGS = {
  dateDisplayMode: "full",
};

let currentDisplaySettings = { ...DEFAULT_DISPLAY_SETTINGS };

// 监听来自 background.js 的消息。
chrome.runtime.onMessage.addListener((message) => {
  if (message.action === "updateUserInfo") {
    updateUserInfoUI(message.mid, message.username);
  }

  if (message.action === "latestDateProgress") {
    updateLatestDateProgressStatus(message);
  }

  if (message.action === "latestDateUserUpdated") {
    updateUserLatestDateInView(message.userMid, message.latestUpdateDate);
  }
});

// 监听本地设置变化，让已经打开的页面也能立即应用新的显示格式。
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local" || !changes.displaySettings) {
    return;
  }

  currentDisplaySettings = {
    ...DEFAULT_DISPLAY_SETTINGS,
    ...(changes.displaySettings.newValue || {}),
  };

  refreshRenderedLatestDates();
});

// 初始化当前页面模式。
function initializeViewMode() {
  const body = document.body;
  const mainPage = document.getElementById("mainPage");
  const settingsPage = document.getElementById("settingsPage");
  const viewToggleBtn = document.getElementById("viewToggleBtn");

  if (isSettingsPage) {
    body.classList.add("settings-page");
    mainPage.classList.add("hidden");
    settingsPage.classList.remove("hidden");
    document.title = "关注分组 - 设置";
    return;
  }

  settingsPage.classList.add("hidden");
  mainPage.classList.remove("hidden");

  if (isFullPageMode) {
    body.classList.add("full-page");
    viewToggleBtn.textContent = "切回小窗";
    document.title = "关注分组 - 网页模式";
  } else {
    viewToggleBtn.textContent = "网页显示";
    document.title = "关注分组";
  }
}

// 更新页面顶部的账号信息。
function updateUserInfoUI(mid, username) {
  const midElement = document.getElementById("mid");
  const usernameElement = document.getElementById("username");

  if (midElement) {
    midElement.innerText = `MID: ${mid}`;
  }

  if (usernameElement) {
    usernameElement.innerText = `用户名: ${username}`;
  }
}

// 更新状态栏提示。
function setStatus(message) {
  const statusElement = document.getElementById("status");
  if (statusElement) {
    statusElement.innerText = message;
  }
}

// 格式化“上次获取时间”的文案。
function formatLastFetchTimeLabel(dateTimeText) {
  return dateTimeText ? `上次获取时间：${dateTimeText}` : "";
}

// 按设置格式化成员列表中的日期显示。
function formatLatestDateForDisplay(dateText) {
  if (!dateText) {
    return "";
  }

  if (currentDisplaySettings.dateDisplayMode !== "short") {
    return dateText;
  }

  const matched = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateText);
  if (!matched) {
    return dateText;
  }

  const [, year, month, day] = matched;
  const currentYear = `${new Date().getFullYear()}`;
  if (year === currentYear) {
    return `${month}-${day}`;
  }

  return dateText;
}

// 更新后台任务进度。
function updateLatestDateProgressStatus(message) {
  const completedCount = typeof message.completedCount === "number" ? message.completedCount : 0;
  const totalCount = typeof message.totalCount === "number" ? message.totalCount : 0;

  if (message.scope === "group") {
    const tagName = message.tagName || "当前分组";
    setStatus(`正在更新分组 ${tagName} 的最后更新时间...`);
    updateGroupLatestButtonProgress(message.tagId, completedCount, totalCount);
    return;
  }

  if (message.scope === "all") {
    setStatus("正在更新所有关注对象的最后更新时间...");
    updateAllLatestButtonProgress(completedCount, totalCount);
  }
}

// 更新某个分组按钮上的进度文字。
function updateGroupLatestButtonProgress(tagId, completedCount, totalCount) {
  const button = document.querySelector(`.latest-action-trigger[data-tagid="${tagId}"]`);
  if (!button || !button.disabled) {
    return;
  }

  button.textContent = `更新中...（${completedCount}/${totalCount}）`;
}

// 更新顶部按钮上的进度文字。
function updateAllLatestButtonProgress(completedCount, totalCount) {
  const button = document.getElementById("updateAllLatestBtn");
  if (!button || !button.disabled) {
    return;
  }

  button.textContent = `更新中...（${completedCount}/${totalCount}）`;
}

// 某个用户刚刚拿到最后更新时间时，立即更新这一行。
function updateUserLatestDateInView(userMid, latestUpdateDate) {
  if (!userMid) {
    return;
  }

  document.querySelectorAll(`.user-item[data-mid="${userMid}"]`).forEach((item) => {
    const dateSpan = item.querySelector(".latest-update-date");
    if (!dateSpan) {
      return;
    }

    const displayDate = formatLatestDateForDisplay(latestUpdateDate);
    dateSpan.textContent = displayDate ? ` ${displayDate}` : "";
    dateSpan.dataset.rawDate = latestUpdateDate || "";
  });
}

// 按当前设置重新格式化页面上已经渲染出来的所有日期。
function refreshRenderedLatestDates() {
  document.querySelectorAll(".latest-update-date").forEach((dateSpan) => {
    const rawDate = dateSpan.dataset.rawDate || "";
    const displayDate = formatLatestDateForDisplay(rawDate);
    dateSpan.textContent = displayDate ? ` ${displayDate}` : "";
  });
}

// 加载显示设置。
function loadDisplaySettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get(["displaySettings"], (data) => {
      currentDisplaySettings = {
        ...DEFAULT_DISPLAY_SETTINGS,
        ...(data.displaySettings || {}),
      };
      resolve(currentDisplaySettings);
    });
  });
}

// 保存显示设置。
function saveDisplaySettings(nextSettings) {
  return new Promise((resolve) => {
    chrome.storage.local.set(
      {
        displaySettings: {
          ...DEFAULT_DISPLAY_SETTINGS,
          ...nextSettings,
        },
      },
      () => resolve()
    );
  });
}

// 将设置值回填到设置页面表单。
function hydrateSettingsForm() {
  const selectedMode = currentDisplaySettings.dateDisplayMode || DEFAULT_DISPLAY_SETTINGS.dateDisplayMode;
  const radio = document.querySelector(`input[name="dateDisplayMode"][value="${selectedMode}"]`);
  if (radio) {
    radio.checked = true;
  }
}

// 从设置页面读取当前表单值。
function readSettingsFormValue() {
  const checkedRadio = document.querySelector('input[name="dateDisplayMode"]:checked');
  return {
    dateDisplayMode: checkedRadio ? checkedRadio.value : DEFAULT_DISPLAY_SETTINGS.dateDisplayMode,
  };
}

// 确保当前账号信息已存在。
function ensureUserInfo() {
  return new Promise((resolve) => {
    chrome.storage.local.get(["mid", "username"], (data) => {
      if (data.mid && data.username) {
        updateUserInfoUI(data.mid, data.username);
        resolve(data);
        return;
      }

      chrome.runtime.sendMessage({ action: "getUserInfo" }, (response) => {
        if (response?.mid && response?.username) {
          updateUserInfoUI(response.mid, response.username);
          chrome.storage.local.set({ mid: response.mid, username: response.username }, () => {
            resolve(response);
          });
          return;
        }

        resolve(response || {});
      });
    });
  });
}

// 渲染全部分组和成员列表。
function loadGroups() {
  chrome.storage.local.get(null, (data) => {
    const container = document.getElementById("group-container");
    if (!container) {
      console.error("无法找到 group-container 元素");
      return;
    }

    container.innerHTML = "";

    const tags = Array.isArray(data.tags) ? data.tags : [];
    const groupStates = data.groupStates || {};
    const latestDateFetchMeta = data.latestDateFetchMeta || {};

    document.getElementById("allLatestFetchTime").textContent = formatLastFetchTimeLabel(latestDateFetchMeta.all || "");

    tags.forEach((tag) => {
      if ((tag.tagid === undefined || tag.tagid === null) || !tag.name) {
        console.warn("无效的标签数据:", tag);
        return;
      }

      const tagId = String(tag.tagid);
      const users = Array.isArray(data[`tag_${tagId}`]) ? data[`tag_${tagId}`] : [];
      const missingLatestDateCount = users.filter((user) => !user.latestUpdateDate).length;
      const isCollapsed = groupStates[tagId]?.collapsed ?? false;

      const groupDiv = document.createElement("div");
      groupDiv.className = "group";

      const groupHeader = document.createElement("div");
      groupHeader.className = "group-header";

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.className = "group-checkbox";
      checkbox.dataset.tagid = tagId;
      checkbox.checked = groupStates[tagId]?.checked ?? true;

      const toggleButton = document.createElement("button");
      toggleButton.type = "button";
      toggleButton.className = "toggle-collapse";
      toggleButton.dataset.tagid = tagId;
      toggleButton.textContent = isCollapsed ? "\u25b6" : "\u25bc";

      const groupName = document.createElement("span");
      groupName.className = "group-name";
      groupName.textContent = `${tag.name} (${users.length}人)`;

      const refreshAction = document.createElement("div");
      refreshAction.className = "latest-action";

      const refreshButton = document.createElement("button");
      refreshButton.type = "button";
      refreshButton.className = "latest-action-trigger";
      refreshButton.dataset.tagid = tagId;
      refreshButton.dataset.tagname = tag.name;
      refreshButton.dataset.totalcount = String(users.length);
      refreshButton.dataset.missingcount = String(missingLatestDateCount);
      refreshButton.textContent = "获取最后更新";

      const refreshMenu = document.createElement("div");
      refreshMenu.className = "latest-action-menu";

      const updateAllButton = document.createElement("button");
      updateAllButton.type = "button";
      updateAllButton.dataset.scope = "group";
      updateAllButton.dataset.tagid = tagId;
      updateAllButton.dataset.tagname = tag.name;
      updateAllButton.dataset.totalcount = String(users.length);
      updateAllButton.dataset.missingcount = String(missingLatestDateCount);
      updateAllButton.dataset.mode = "all";
      updateAllButton.textContent = "全部";

      const updateMissingButton = document.createElement("button");
      updateMissingButton.type = "button";
      updateMissingButton.dataset.scope = "group";
      updateMissingButton.dataset.tagid = tagId;
      updateMissingButton.dataset.tagname = tag.name;
      updateMissingButton.dataset.totalcount = String(users.length);
      updateMissingButton.dataset.missingcount = String(missingLatestDateCount);
      updateMissingButton.dataset.mode = "missing";
      updateMissingButton.textContent = "补全";

      refreshMenu.appendChild(updateAllButton);
      refreshMenu.appendChild(updateMissingButton);
      refreshAction.appendChild(refreshButton);
      refreshAction.appendChild(refreshMenu);

      const lastFetchTime = document.createElement("span");
      lastFetchTime.className = "last-fetch-time";
      lastFetchTime.textContent = formatLastFetchTimeLabel(latestDateFetchMeta.groups?.[tagId] || "");

      groupHeader.appendChild(checkbox);
      groupHeader.appendChild(toggleButton);
      groupHeader.appendChild(groupName);
      groupHeader.appendChild(refreshAction);
      groupHeader.appendChild(lastFetchTime);

      const userList = document.createElement("ul");
      userList.className = "user-list";
      userList.dataset.tagid = tagId;
      userList.style.display = isCollapsed ? "none" : "block";

      users.forEach((user) => {
        const li = document.createElement("li");
        li.className = "user-item";
        li.dataset.mid = String(user.mid);

        const nameSpan = document.createElement("span");
        nameSpan.textContent = `${user.uname} `;

        const midLink = document.createElement("a");
        midLink.href = `https://space.bilibili.com/${user.mid}`;
        midLink.target = "_blank";
        midLink.textContent = String(user.mid);

        const dateSpan = document.createElement("span");
        dateSpan.className = "latest-update-date";
        dateSpan.dataset.rawDate = user.latestUpdateDate || "";
        const displayDate = formatLatestDateForDisplay(user.latestUpdateDate || "");
        dateSpan.textContent = displayDate ? ` ${displayDate}` : "";

        li.appendChild(nameSpan);
        li.appendChild(midLink);
        li.appendChild(dateSpan);
        userList.appendChild(li);
      });

      groupDiv.appendChild(groupHeader);
      groupDiv.appendChild(userList);
      container.appendChild(groupDiv);
    });

    bindGroupEvents();
  });
}

// 给当前渲染出的所有分组元素绑定事件。
function bindGroupEvents() {
  document.querySelectorAll(".group-checkbox").forEach((checkbox) => {
    checkbox.addEventListener("change", function () {
      const tagId = this.dataset.tagid;
      chrome.storage.local.get("groupStates", (data) => {
        const groupStates = data.groupStates || {};
        groupStates[tagId] = groupStates[tagId] || {};
        groupStates[tagId].checked = this.checked;
        chrome.storage.local.set({ groupStates });
      });
    });
  });

  document.querySelectorAll(".toggle-collapse").forEach((button) => {
    button.addEventListener("click", function () {
      const tagId = this.dataset.tagid;
      const userList = document.querySelector(`.user-list[data-tagid="${tagId}"]`);
      const isCollapsed = userList.style.display === "none";

      userList.style.display = isCollapsed ? "block" : "none";
      this.textContent = isCollapsed ? "\u25bc" : "\u25b6";

      chrome.storage.local.get("groupStates", (data) => {
        const groupStates = data.groupStates || {};
        groupStates[tagId] = groupStates[tagId] || {};
        groupStates[tagId].collapsed = !isCollapsed;
        chrome.storage.local.set({ groupStates });
      });
    });
  });

  bindLatestActionMenus();
}

// 绑定“获取最后更新”下拉菜单。
function bindLatestActionMenus() {
  document.querySelectorAll(".latest-action-trigger").forEach((button) => {
    button.addEventListener("click", function (event) {
      event.stopPropagation();

      if (this.disabled) {
        return;
      }

      const actionWrapper = this.closest(".latest-action");
      const isOpen = actionWrapper.classList.contains("open");
      closeLatestActionMenus();

      if (!isOpen) {
        actionWrapper.classList.add("open");
      }
    });
  });

  document.querySelectorAll(".latest-action-menu button").forEach((button) => {
    button.addEventListener("click", async function (event) {
      event.stopPropagation();
      closeLatestActionMenus();

      const scope = this.dataset.scope;
      const mode = this.dataset.mode || "all";

      if (scope === "group") {
        await handleGroupLatestDateAction(
          this.dataset.tagid,
          this.dataset.tagname,
          Number(mode === "missing" ? this.dataset.missingcount || 0 : this.dataset.totalcount || 0),
          mode
        );
        return;
      }

      if (scope === "all") {
        await handleAllLatestDateAction(mode);
      }
    });
  });
}

// 关闭所有已打开的下拉菜单。
function closeLatestActionMenus() {
  document.querySelectorAll(".latest-action.open").forEach((element) => {
    element.classList.remove("open");
  });
}

// 处理单个分组的“获取最后更新”。
async function handleGroupLatestDateAction(tagId, tagName, totalCount, mode) {
  const button = document.querySelector(`.latest-action-trigger[data-tagid="${tagId}"]`);
  if (!button) {
    return;
  }

  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = `更新中...（0/${totalCount}）`;
  setStatus(`正在更新分组 ${tagName || "当前分组"} 的最后更新时间...`);

  try {
    const response = await sendRuntimeMessage({
      action: "updateGroupLatestDates",
      tagId,
      mode,
    });
    loadGroups();
    setStatus(response?.message || "分组最后更新时间更新完成");
  } catch (error) {
    console.error("更新分组最后时间失败:", error);
    setStatus("分组最后更新时间更新失败");
    button.disabled = false;
    button.textContent = originalText;
  }
}

// 处理顶部全量“获取最后更新”。
async function handleAllLatestDateAction(mode) {
  const button = document.getElementById("updateAllLatestBtn");
  const originalText = button.textContent;

  try {
    const totalCount = await getAllUserCount(mode);
    button.disabled = true;
    button.textContent = `更新中...（0/${totalCount}）`;
    setStatus("正在更新所有关注对象的最后更新时间...");

    const response = await sendRuntimeMessage({
      action: "updateAllLatestDates",
      mode,
    });
    loadGroups();
    setStatus(response?.message || "最后更新时间更新完成");
    button.disabled = false;
    button.textContent = originalText;
  } catch (error) {
    console.error("更新所有最后时间失败:", error);
    setStatus("最后更新时间更新失败");
    button.disabled = false;
    button.textContent = originalText;
  }
}

function sendRuntimeMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
        return;
      }
      resolve(response);
    });
  });
}

// 打开设置页面。
function openSettingsPage() {
  const settingsUrl = chrome.runtime.getURL("popup.html?view=settings");
  window.open(settingsUrl, "_blank");
}

// 切换显示模式。
function toggleViewMode() {
  if (isFullPageMode) {
    window.close();
    return;
  }

  const pageUrl = chrome.runtime.getURL("popup.html?view=page");
  window.open(pageUrl, "_blank");
}

// 关闭设置页。
function closeSettingsPage() {
  window.close();
}

// 统计当前缓存中的总关注人数。
function getAllUserCount(mode = "all") {
  return new Promise((resolve) => {
    chrome.storage.local.get(null, (data) => {
      const totalCount = Object.keys(data)
        .filter((key) => key.startsWith("tag_"))
        .reduce((count, key) => {
          const users = Array.isArray(data[key]) ? data[key] : [];
          if (mode === "missing") {
            return count + users.filter((user) => !user.latestUpdateDate).length;
          }
          return count + users.length;
        }, 0);
      resolve(totalCount);
    });
  });
}

// 初始化设置页面。
async function initializeSettingsPage() {
  await loadDisplaySettings();
  hydrateSettingsForm();

  document.getElementById("applySettingsBtn").addEventListener("click", async () => {
    const nextSettings = readSettingsFormValue();
    await saveDisplaySettings(nextSettings);
    closeSettingsPage();
  });

  document.getElementById("cancelSettingsBtn").addEventListener("click", () => {
    closeSettingsPage();
  });
}

// 初始化主页面。
async function initializeMainPage() {
  document.getElementById("settingsBtn").addEventListener("click", openSettingsPage);
  document.getElementById("viewToggleBtn").addEventListener("click", toggleViewMode);
  document.addEventListener("click", closeLatestActionMenus);

  document.getElementById("updateGroupsBtn").addEventListener("click", async () => {
    setStatus("正在更新分组...");

    try {
      await ensureUserInfo();
      const response = await sendRuntimeMessage({ action: "updateGroupsManually" });
      loadGroups();
      setStatus(response?.message || "分组更新完成");
    } catch (error) {
      console.error("更新分组失败:", error);
      setStatus("分组更新失败");
    }
  });

  document.getElementById("clearCacheBtn").addEventListener("click", () => {
    chrome.storage.local.clear(() => {
      console.log("本地缓存已清空");
      document.getElementById("mid").innerText = "MID: 未知";
      document.getElementById("username").innerText = "用户名: 未知";
      setStatus("缓存已清除");
      loadGroups();
      ensureUserInfo();
    });
  });

  await ensureUserInfo();
  await loadDisplaySettings();
  loadGroups();
}

document.addEventListener("DOMContentLoaded", async () => {
  initializeViewMode();

  if (isSettingsPage) {
    await initializeSettingsPage();
    return;
  }

  await initializeMainPage();
});
