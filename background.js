// 设定每天更新一次
const updateIntervalMinutes = 1440; // 24小时

// 定期更新分组信息
chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create("updateGroups", { periodInMinutes: updateIntervalMinutes });
});

// 监听 alarm 事件，触发分组更新
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "updateGroups") {
    updateFollowGroups();
  }
});

// 更新关注分组信息
function updateFollowGroupsAsync() {
    return new Promise((resolve, reject) => {
        console.log("正在更新关注分组...");

        // 获取本地存储的 mid（用户ID）
        chrome.storage.local.get(["mid"], (data) => {
            if (!data.mid) {
                // 如果本地没有 mid，先获取用户信息
                getUserInfo().then(() => {
                    // 重新获取 mid
                    chrome.storage.local.get(["mid"], (data) => {
                        if (!data.mid) {
                            console.error("未能获取到 MID");
                            reject("未获取到 MID");
                            return;
                        }
                        // 继续更新分组
                        fetchAndUpdateGroups(data.mid, resolve, reject);
                    });
                }).catch(error => {
                    console.error("获取用户信息失败:", error);
                    reject("获取用户信息失败");
                });
            } else {
                // 如果本地已有 mid，直接更新分组
                fetchAndUpdateGroups(data.mid, resolve, reject);
            }
        });
    });
}

// 提取分组更新的逻辑到一个单独的函数
function fetchAndUpdateGroups(mid, resolve, reject) {
    let updatedData = {};
    let completedRequests = 0;

    // 获取用户的所有标签（分组）
    fetch(`https://api.bilibili.com/x/relation/tags?vmid=${mid}`, { credentials: "include" })
        .then(response => response.json())
        .then(data => {
            if (data.code === 0 && data.data) {
                const tags = data.data;
                updatedData["tags"] = tags; // 存储标签信息

                // 遍历每个标签获取该标签下的关注用户
                const tagIds = tags.map(tag => tag.tagid);
                tagIds.forEach(tagId => {
                    let currentPage = 1;
                    let allUsers = [];

                    // 递归函数，逐页获取数据
                    const fetchTagUsers = (page) => {
                        fetch(`https://api.bilibili.com/x/relation/tag?&tagid=${tagId}&pn=${page}`, { credentials: "include" })
                            .then(response => response.json())
                            .then(tagData => {
                                if (tagData.code === 0 && tagData.data) {
                                    allUsers = allUsers.concat(tagData.data); // 将当前页的用户数据添加到总列表中

                                    // 检查是否还有更多数据
                                    if (tagData.data.length > 0) {
                                        fetchTagUsers(page + 1); // 继续获取下一页
                                    } else {
                                        // 没有更多数据，保存当前标签的所有用户数据
                                        updatedData[`tag_${tagId}`] = allUsers;
                                        completedRequests++;

                                        // 检查是否所有标签都已处理完毕
                                        if (completedRequests === tagIds.length) {
                                            chrome.storage.local.set(updatedData, () => {
                                                console.log("关注分组更新完成", updatedData);
                                                resolve(); // 所有请求完成后 resolve
                                            });
                                        }
                                    }
                                } else {
                                    console.error(`获取标签 ${tagId} 第 ${page} 页的用户失败:`, tagData);
                                    completedRequests++;
                                    if (completedRequests === tagIds.length) {
                                        chrome.storage.local.set(updatedData, () => {
                                            console.log("关注分组更新完成", updatedData);
                                            resolve();
                                        });
                                    }
                                }
                            })
                            .catch(error => {
                                console.error(`请求错误: ${error}`);
                                completedRequests++;
                                if (completedRequests === tagIds.length) {
                                    chrome.storage.local.set(updatedData, () => {
                                        console.log("关注分组更新完成", updatedData);
                                        resolve();
                                    });
                                }
                            });
                    };

                    // 开始获取第一页数据
                    fetchTagUsers(currentPage);
                });
            } else {
                console.error("获取标签分组失败:", data);
                reject("获取标签分组失败");
            }
        })
        .catch(error => {
            console.error("请求错误:", error);
            reject("请求错误");
        });
}
  

// 监听来自 popup.js 的手动更新请求或获取分组请求
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log("收到请求:", request);  // 调试信息
  if (request.action === "updateGroupsManually") {
    updateFollowGroupsAsync()
        .then(() => {
            // 分组更新完成后，发送消息通知 popup.js
            sendResponse({ message: "分组更新完成" });
        })
        .catch(error => {
            console.error("更新失败:", error);
            sendResponse({ message: "分组更新失败" });
        });

    return true; // 让 Chrome 继续等待 sendResponse
}

  // 获取关注分组数据
  if (request.action === "getGroups") {
    chrome.storage.local.get(null, (data) => {
      sendResponse({ data });
    });
    return true; // 必须返回 true 以支持异步 sendResponse
  }

  // 获取用户信息
  if (request.action === "getUserInfo") {
    chrome.storage.local.get(['mid', 'username'], (data) => {
      sendResponse(data); // 发送用户信息
    });
    return true; // 必须返回 true 以支持异步 sendResponse
  }
});

// 获取当前登录用户的 mid 和昵称
function getUserInfo() {
  console.log("开始获取用户信息...");
  fetch('https://api.bilibili.com/x/web-interface/nav', { credentials: 'include' })
    .then(response => response.json())
    .then(data => {
      if (data.code === 0) {
        const mid = data.data.mid;
        const username = data.data.uname;
        console.log(`获取到用户信息: ${username} (${mid})`);

        // 存储用户信息到 chrome.storage
        chrome.storage.local.set({ mid, username });

        // 发送消息到其他脚本
        chrome.runtime.sendMessage({
          action: 'updateUserInfo',
          mid: mid,
          username: username
        }, () => {
          console.log("已发送 updateUserInfo");
        });
      } else {
        console.error('获取用户信息失败:', data);
      }
    })
    .catch(error => console.error('请求错误:', error));
}

// 获取用户信息
getUserInfo();
