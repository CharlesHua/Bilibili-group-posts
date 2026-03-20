// 每天自动同步一次分组数据。
const UPDATE_INTERVAL_MINUTES = 1440; // 24 小时
const BILIBILI_API_BASE = "https://api.bilibili.com";
const LATEST_DATE_CONCURRENCY = 2;
const REQUEST_DELAY_MIN_MS = 600;
const REQUEST_DELAY_MAX_MS = 1500;

// 扩展安装时注册定时任务。
chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create("updateGroups", { periodInMinutes: UPDATE_INTERVAL_MINUTES });
});

// 定时任务只做分组同步，不自动刷新最后动态时间。
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== "updateGroups") {
    return;
  }

  updateFollowGroupsAsync().catch((error) => {
    console.error("定时更新分组失败:", error);
  });
});

// 统一处理 popup.js 发来的消息请求。
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log("收到请求:", request);

  if (request.action === "updateGroupsManually") {
    updateFollowGroupsAsync()
      .then(() => sendResponse({ message: "分组更新完成" }))
      .catch((error) => {
        console.error("手动更新分组失败:", error);
        sendResponse({ message: "分组更新失败" });
      });
    return true;
  }

  if (request.action === "updateAllLatestDates") {
    updateAllLatestDatesAsync(request.mode || "all")
      .then(() => sendResponse({ message: "最后更新时间更新完成" }))
      .catch((error) => {
        console.error("更新所有最后时间失败:", error);
        sendResponse({ message: "最后更新时间更新失败" });
      });
    return true;
  }

  if (request.action === "updateGroupLatestDates") {
    updateGroupLatestDatesAsync(request.tagId, request.mode || "all")
      .then(() => sendResponse({ message: "分组最后更新时间更新完成" }))
      .catch((error) => {
        console.error("更新分组最后时间失败:", error);
        sendResponse({ message: "分组最后更新时间更新失败" });
      });
    return true;
  }

  if (request.action === "getGroups") {
    chrome.storage.local.get(null, (data) => {
      sendResponse({ data });
    });
    return true;
  }

  if (request.action === "getUserInfo") {
    chrome.storage.local.get(["mid", "username"], (data) => {
      sendResponse(data);
    });
    return true;
  }

  return false;
});

// 手动更新分组：
// 1. 读取旧缓存
// 2. 获取新的分组和分组成员
// 3. 以 uid(mid) 为键，迁移旧缓存中的附加信息
// 4. 整体覆盖本地存储
async function updateFollowGroupsAsync() {
  console.log("正在更新关注分组...");

  const mid = await ensureStoredUserInfo();
  const oldData = await getStorage(null);
  const fetchedData = await fetchGroupsAndUsers(mid);
  const legacyUserCache = buildLegacyUserCache(oldData);
  const mergedData = mergeCachedUserFieldsIntoFetchedData(fetchedData, legacyUserCache);

  // 这里不主动刷新 latestUpdateDate，只保留旧缓存中已经有的值。
  await setStorage(mergedData);
  console.log("关注分组更新完成", mergedData);
}

// 更新所有分组里所有用户的最后动态时间。
async function updateAllLatestDatesAsync(mode = "all") {
  console.log(`正在更新所有关注对象的最后更新时间，模式: ${mode}`);

  const data = await getStorage(null);
  const nextData = await attachLatestDatesForAllUsers(data, mode);
  nextData.latestDateFetchMeta = mergeLatestDateFetchMeta(nextData.latestDateFetchMeta, {
    all: getCurrentDateTimeString(),
  });

  await setStorage(nextData);
  console.log("所有关注对象的最后更新时间已更新");
}

// 只更新某一个分组下所有用户的最后动态时间。
async function updateGroupLatestDatesAsync(tagId, mode = "all") {
  if (tagId === undefined || tagId === null || tagId === "") {
    throw new Error("缺少 tagId");
  }

  console.log(`正在更新分组 ${tagId} 的最后更新时间，模式: ${mode}`);

  const data = await getStorage(null);
  const users = Array.isArray(data[`tag_${tagId}`]) ? data[`tag_${tagId}`] : [];

  if (!users.length) {
    console.warn(`分组 ${tagId} 没有可更新的用户`);
    return;
  }

  const tagName = getTagNameById(data.tags, tagId);
  let completedCount = 0;

  const updatedUsers = await updateUsersLatestDates(users, {
    scope: "group",
    tagId,
    tagName,
    mode,
    onUserCompleted: () => {
      completedCount += 1;
    },
  });

  const latestDateFetchMeta = mergeLatestDateFetchMeta(data.latestDateFetchMeta, {
    groups: {
      [String(tagId)]: getCurrentDateTimeString(),
    },
  });

  await setStorage({
    [`tag_${tagId}`]: updatedUsers,
    latestDateFetchMeta,
  });

  console.log(`分组 ${tagId} 的最后更新时间已更新`);
}

// 获取所有关注分组和其下成员。
async function fetchGroupsAndUsers(mid) {
  const nextData = {};
  const tagsResponse = await fetchJson(`${BILIBILI_API_BASE}/x/relation/tags?vmid=${mid}`);

  if (tagsResponse.code !== 0 || !Array.isArray(tagsResponse.data)) {
    throw new Error("获取标签分组失败");
  }

  const tags = tagsResponse.data;
  nextData.tags = tags;

  for (const tag of tags) {
    const tagId = tag.tagid;
    nextData[`tag_${tagId}`] = await fetchAllUsersForTag(tagId);
  }

  return nextData;
}

// 分页获取某个分组下的所有用户。
async function fetchAllUsersForTag(tagId) {
  const allUsers = [];
  let page = 1;

  while (true) {
    const response = await fetchJson(`${BILIBILI_API_BASE}/x/relation/tag?tagid=${tagId}&pn=${page}`);

    if (response.code !== 0 || !Array.isArray(response.data)) {
      throw new Error(`获取标签 ${tagId} 第 ${page} 页用户失败`);
    }

    if (response.data.length === 0) {
      break;
    }

    allUsers.push(...response.data);
    page += 1;
  }

  return allUsers;
}

// 把旧分组数据压平成以 uid 为键的缓存表。
function buildLegacyUserCache(data) {
  const cache = {};
  const tagKeys = Object.keys(data || {}).filter((key) => key.startsWith("tag_"));

  tagKeys.forEach((key) => {
    const users = Array.isArray(data[key]) ? data[key] : [];
    users.forEach((user) => {
      if (!user || user.mid === undefined || user.mid === null) {
        return;
      }

      cache[String(user.mid)] = {
        ...(cache[String(user.mid)] || {}),
        ...user,
      };
    });
  });

  return cache;
}

// 将旧缓存中的附加字段合并到新抓取到的分组用户中。
function mergeCachedUserFieldsIntoFetchedData(nextData, legacyUserCache) {
  const mergedData = { ...nextData };
  const tagKeys = Object.keys(mergedData).filter((key) => key.startsWith("tag_"));

  tagKeys.forEach((key) => {
    const users = Array.isArray(mergedData[key]) ? mergedData[key] : [];
    mergedData[key] = users.map((user) => mergeUserWithLegacyCache(user, legacyUserCache));
  });

  return mergedData;
}

// 以新用户数据为主，旧缓存只用于补充附加字段。
function mergeUserWithLegacyCache(user, legacyUserCache) {
  if (!user || user.mid === undefined || user.mid === null) {
    return user;
  }

  const cachedUser = legacyUserCache[String(user.mid)];
  if (!cachedUser) {
    return user;
  }

  return {
    ...cachedUser,
    ...user,
    latestUpdateDate: user.latestUpdateDate || cachedUser.latestUpdateDate || "",
  };
}

// 为所有分组下的所有用户补充 latestUpdateDate。
async function attachLatestDatesForAllUsers(data, mode = "all") {
  const nextData = { ...data };
  const tagKeys = Object.keys(nextData).filter((key) => key.startsWith("tag_"));
  const totalCount = tagKeys.reduce((count, key) => {
    const users = Array.isArray(nextData[key]) ? nextData[key] : [];
    return count + getUsersToUpdateByMode(users, mode).length;
  }, 0);
  let completedCount = 0;

  for (const key of tagKeys) {
    const users = Array.isArray(nextData[key]) ? nextData[key] : [];
    nextData[key] = await updateUsersLatestDates(users, {
      scope: "all",
      totalCount,
      mode,
      onUserCompleted: () => {
        completedCount += 1;
      },
    });
  }

  return nextData;
}

// 用小并发队列更新用户的最后动态时间。
async function updateUsersLatestDates(users, progressOptions = {}) {
  const updatedUsers = [...users];
  const updateMode = progressOptions.mode || "all";
  const usersToUpdate = getUsersToUpdateByMode(users, updateMode);
  const totalCount = usersToUpdate.length;
  let completedCount = 0;
  let nextIndex = 0;

  const worker = async () => {
    while (nextIndex < usersToUpdate.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;

      const user = usersToUpdate[currentIndex];
      const userPosition = users.findIndex((item) => String(item.mid) === String(user.mid));
      await sleep(getRandomDelay(REQUEST_DELAY_MIN_MS, REQUEST_DELAY_MAX_MS));

      const latestUpdateDate = await fetchLatestUpdateDate(user.mid);
      updatedUsers[userPosition] = {
        ...user,
        latestUpdateDate,
      };

      notifyLatestDateUserUpdated(user.mid, latestUpdateDate);

      completedCount += 1;
      if (typeof progressOptions.onUserCompleted === "function") {
        progressOptions.onUserCompleted();
      }

      notifyLatestDateProgress({
        ...progressOptions,
        totalCount,
        getCompletedCount: () => completedCount,
      });
    }
  };

  if (!usersToUpdate.length) {
    notifyLatestDateProgress({
      ...progressOptions,
      totalCount: 0,
      getCompletedCount: () => 0,
    });
    return updatedUsers;
  }

  const workerCount = Math.min(LATEST_DATE_CONCURRENCY, usersToUpdate.length);
  const workers = Array.from({ length: workerCount }, () => worker());
  await Promise.all(workers);

  return updatedUsers;
}

// 根据模式决定本次要更新哪些用户。
function getUsersToUpdateByMode(users, mode) {
  if (mode === "missing") {
    return users.filter((user) => !user.latestUpdateDate);
  }

  return [...users];
}

// 读取某个 UP 的动态页接口，取第一条非置顶动态的时间。
async function fetchLatestUpdateDate(uid) {
  if (!uid) {
    return "";
  }

  try {
    const response = await fetchJson(`${BILIBILI_API_BASE}/x/polymer/web-dynamic/v1/feed/space?host_mid=${uid}`);

    if (response.code !== 0) {
      console.warn(`获取用户 ${uid} 动态失败:`, response);
      return "";
    }

    const items = getDynamicItems(response.data);
    const firstTimestamp = extractFirstDynamicTimestamp(items);
    return firstTimestamp ? formatDate(firstTimestamp) : "";
  } catch (error) {
    console.error(`获取用户 ${uid} 最后更新时间失败:`, error);
    return "";
  }
}

function getDynamicItems(data) {
  if (!data || !Array.isArray(data.items)) {
    return [];
  }
  return data.items;
}

function extractFirstDynamicTimestamp(items) {
  for (const item of items) {
    if (isPinnedDynamicItem(item)) {
      continue;
    }

    const timestamp = extractTimestampFromDynamicItem(item);
    if (timestamp) {
      return timestamp;
    }
  }

  return 0;
}

// 跳过置顶动态，避免把旧置顶内容误判为最新动态。
function isPinnedDynamicItem(item) {
  const modules = item?.modules || {};
  const moduleTag = modules.module_tag || {};
  const moduleAuthor = modules.module_author || {};
  const candidateTexts = [
    moduleTag.text,
    moduleTag.tag_text,
    moduleTag.label,
    item?.display?.title,
    item?.display?.topic_info?.topic_name,
  ];

  if (
    item?.is_top === 1 ||
    item?.is_top === true ||
    moduleAuthor?.is_top === 1 ||
    moduleAuthor?.is_top === true
  ) {
    return true;
  }

  return candidateTexts.some((text) => typeof text === "string" && text.includes("置顶"));
}

// 从不同类型动态中尽量提取统一的发布时间字段。
function extractTimestampFromDynamicItem(item) {
  const modules = item?.modules || {};
  const moduleAuthor = modules.module_author || {};
  const candidates = [
    item?.modules?.module_dynamic?.major?.archive?.pub_ts,
    item?.modules?.module_dynamic?.major?.article?.pub_ts,
    item?.modules?.module_dynamic?.major?.opus?.pub_ts,
    item?.modules?.module_dynamic?.major?.draw?.pub_ts,
    item?.modules?.module_dynamic?.major?.common?.pub_ts,
    item?.modules?.module_dynamic?.major?.live_rcmd?.content?.live_play_info?.start_time,
    moduleAuthor.pub_ts,
    moduleAuthor.pub_time_ts,
  ];

  for (const candidate of candidates) {
    const normalized = normalizeTimestamp(candidate);
    if (normalized) {
      return normalized;
    }
  }

  return 0;
}

// 将接口里可能出现的毫秒/秒/数字字符串统一成秒级时间戳。
function normalizeTimestamp(value) {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value > 1e12 ? Math.floor(value / 1000) : Math.floor(value);
  }

  if (typeof value === "string" && /^\d+$/.test(value)) {
    const numericValue = Number(value);
    if (Number.isFinite(numericValue) && numericValue > 0) {
      return numericValue > 1e12 ? Math.floor(numericValue / 1000) : Math.floor(numericValue);
    }
  }

  return 0;
}

function getTagNameById(tags, tagId) {
  const matchedTag = Array.isArray(tags)
    ? tags.find((tag) => String(tag.tagid) === String(tagId))
    : null;
  return matchedTag?.name || `分组 ${tagId}`;
}

// 通知 popup 某个用户的 latestUpdateDate 已经获取到。
function notifyLatestDateUserUpdated(userMid, latestUpdateDate) {
  chrome.runtime.sendMessage({
    action: "latestDateUserUpdated",
    userMid: String(userMid),
    latestUpdateDate: latestUpdateDate || "",
  });
}

// 通知 popup 当前任务的进度。
function notifyLatestDateProgress(progressOptions) {
  if (!progressOptions || !progressOptions.scope) {
    return;
  }

  const completedCount = typeof progressOptions.getCompletedCount === "function"
    ? progressOptions.getCompletedCount()
    : 0;

  if (progressOptions.scope === "group") {
    chrome.runtime.sendMessage({
      action: "latestDateProgress",
      scope: "group",
      tagId: progressOptions.tagId,
      tagName: progressOptions.tagName,
      completedCount,
      totalCount: progressOptions.totalCount,
    });
    return;
  }

  if (progressOptions.scope === "all") {
    chrome.runtime.sendMessage({
      action: "latestDateProgress",
      scope: "all",
      completedCount,
      totalCount: progressOptions.totalCount,
    });
  }
}

// 合并“上次获取最后更新时间”的元数据。
function mergeLatestDateFetchMeta(currentMeta, patchMeta) {
  const nextMeta = {
    all: currentMeta?.all || "",
    groups: {
      ...(currentMeta?.groups || {}),
    },
  };

  if (patchMeta?.all) {
    nextMeta.all = patchMeta.all;
  }

  if (patchMeta?.groups) {
    nextMeta.groups = {
      ...nextMeta.groups,
      ...patchMeta.groups,
    };
  }

  return nextMeta;
}

function formatDate(timestampSeconds) {
  const date = new Date(timestampSeconds * 1000);
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// 生成“上次获取时间”的展示文案时间值。
function getCurrentDateTimeString() {
  const now = new Date();
  const year = now.getFullYear();
  const month = `${now.getMonth() + 1}`.padStart(2, "0");
  const day = `${now.getDate()}`.padStart(2, "0");
  const hours = `${now.getHours()}`.padStart(2, "0");
  const minutes = `${now.getMinutes()}`.padStart(2, "0");
  return `${year}-${month}-${day} ${hours}:${minutes}`;
}

function getRandomDelay(minMs, maxMs) {
  return minMs + Math.floor(Math.random() * (maxMs - minMs + 1));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 如果本地没有 mid，就主动获取一次用户信息。
async function ensureStoredUserInfo() {
  const data = await getStorage(["mid"]);
  if (data.mid) {
    return data.mid;
  }

  const userInfo = await getUserInfo();
  if (!userInfo.mid) {
    throw new Error("未获取到 MID");
  }

  return userInfo.mid;
}

// 获取当前登录用户的 mid 和用户名。
async function getUserInfo() {
  console.log("开始获取用户信息...");
  const data = await fetchJson(`${BILIBILI_API_BASE}/x/web-interface/nav`);

  if (data.code !== 0) {
    throw new Error("获取用户信息失败");
  }

  const mid = data.data.mid;
  const username = data.data.uname;
  await setStorage({ mid, username });

  chrome.runtime.sendMessage({
    action: "updateUserInfo",
    mid,
    username,
  });

  return { mid, username };
}

function fetchJson(url) {
  return fetch(url, { credentials: "include" }).then((response) => response.json());
}

function getStorage(keys) {
  return new Promise((resolve) => {
    chrome.storage.local.get(keys, (data) => resolve(data));
  });
}

function setStorage(data) {
  return new Promise((resolve) => {
    chrome.storage.local.set(data, () => resolve());
  });
}

// 扩展启动时先尝试获取一次用户信息。
getUserInfo().catch((error) => {
  console.error("初始化获取用户信息失败:", error);
});
