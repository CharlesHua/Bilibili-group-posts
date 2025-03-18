// 监听来自 background.js 的消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'updateUserInfo') {
        updateUserInfoUI(message.mid, message.username);
    }

    if (message.action === "updateGroupsCompleted") {
        console.log("收到后台更新完成的通知，刷新 UI");
        loadGroups(); // 更新分组
    }
});

// 更新 UI 上的用户信息
function updateUserInfoUI(mid, username) {
    document.getElementById('mid').innerText = `MID: ${mid}`;
    document.getElementById('username').innerText = `用户名: ${username}`;
}

// 检查并获取用户信息
function ensureUserInfo() {
    return new Promise((resolve) => {
        chrome.storage.local.get(["mid", "username"], (data) => {
            if (data.mid && data.username) {
                // 如果本地已存储用户信息，直接更新 UI
                updateUserInfoUI(data.mid, data.username);
                resolve();
            } else {
                // 如果本地没有用户信息，从网页获取
                chrome.runtime.sendMessage({ action: "getUserInfo" }, (response) => {
                    if (response && response.mid && response.username) {
                        // 更新 UI 并存储用户信息
                        updateUserInfoUI(response.mid, response.username);
                        chrome.storage.local.set({ mid: response.mid, username: response.username });
                    }
                    resolve();
                });
            }
        });
    });
}

// 加载并显示关注分组
function loadGroups() {
    chrome.storage.local.get(null, data => {
        const container = document.getElementById("group-container");
        if (!container) {
            console.error("无法找到 group-container 元素");
            return;
        }
        container.innerHTML = "";

        const tags = data.tags || [];
        const groupStates = data.groupStates || {};

        tags.forEach(tag => {
            // 确保标签数据有效

            if ((tag.tagid === undefined || tag.tagid === null) || !tag.name) {
                console.warn("无效的标签数据:", tag);
                return;
            }

            const tagId = tag.tagid;
            const tagName = tag.name;
            const users = data[`tag_${tagId}`] || [];

            // 创建分组容器
            const groupDiv = document.createElement("div");
            groupDiv.className = "group";

            // 分组标题
            const groupHeader = document.createElement("div");
            groupHeader.className = "group-header";

            // 勾选框
            const checkbox = document.createElement("input");
            checkbox.type = "checkbox";
            checkbox.className = "group-checkbox";
            checkbox.dataset.tagid = tagId;
            checkbox.checked = groupStates[tagId]?.checked ?? true;

            // 三角形按钮
            const toggleButton = document.createElement("button");
            toggleButton.className = "toggle-collapse";
            toggleButton.dataset.tagid = tagId;

            // 根据 collapsed 状态设置三角形图标
            const isCollapsed = groupStates[tagId]?.collapsed ?? false;
            toggleButton.textContent = isCollapsed ? "▶" : "▼"; // 设置初始图标

            // 分组名
            const groupName = document.createElement("span");
            groupName.className = "group-name";
            groupName.textContent = `${tagName} (${users.length} 人)`;

            // 组装标题
            groupHeader.appendChild(checkbox);
            groupHeader.appendChild(toggleButton);
            groupHeader.appendChild(groupName);

            // 用户列表
            const userList = document.createElement("ul");
            userList.className = "user-list";
            userList.dataset.tagid = tagId;
            userList.style.display = isCollapsed ? "none" : "block"; // 根据 collapsed 状态设置显示

            users.forEach(user => {
                const li = document.createElement("li");
                li.innerHTML = `${user.uname} <a href="https://space.bilibili.com/${user.mid}" target="_blank">${user.mid}</a>`;
                userList.appendChild(li);
            });

            // 组装分组
            groupDiv.appendChild(groupHeader);
            groupDiv.appendChild(userList);
            container.appendChild(groupDiv);
        });

        // 绑定事件监听器
        document.querySelectorAll(".group-checkbox").forEach(checkbox => {
            checkbox.addEventListener("change", function() {
                const tagId = this.dataset.tagid;
                const groupStates = data.groupStates || {};
                groupStates[tagId] = groupStates[tagId] || {};
                groupStates[tagId].checked = this.checked;
                chrome.storage.local.set({ groupStates });
            });
        });

        document.querySelectorAll(".toggle-collapse").forEach(button => {
            button.addEventListener("click", function() {
                const tagId = this.dataset.tagid;
                const userList = document.querySelector(`.user-list[data-tagid="${tagId}"]`);
                const isCollapsed = userList.style.display === "none";
                userList.style.display = isCollapsed ? "block" : "none";
                this.textContent = isCollapsed ? "▼" : "▶"; // 切换图标

                // 更新存储状态
                const groupStates = data.groupStates || {};
                groupStates[tagId] = groupStates[tagId] || {};
                groupStates[tagId].collapsed = !isCollapsed;
                chrome.storage.local.set({ groupStates });
            });
        });
    });
}


document.addEventListener("DOMContentLoaded", async () => {
    await ensureUserInfo();
    loadGroups(); // 页面加载时显示所有分组
});

// 监听 "手动更新" 按钮
document.getElementById("updateGroupsBtn").addEventListener("click", async () => {
    document.getElementById("status").innerText = "正在更新...";

    try {
        // 确保用户信息已获取
        await ensureUserInfo();

        // 发送消息给 background.js，触发分组更新，并等待更新完成
        const response = await new Promise((resolve, reject) => {
            chrome.runtime.sendMessage({ action: "updateGroupsManually" }, (response) => {
                if (chrome.runtime.lastError) {
                    reject(chrome.runtime.lastError);
                } else {
                    resolve(response);
                }
            });
        });

        // 更新完成后，刷新 UI 显示最新数据
        loadGroups();
        document.getElementById("status").innerText = response?.message || "更新完成";
    } catch (error) {
        console.error("更新失败:", error);
        document.getElementById("status").innerText = "更新失败";
    }
});

// 监听 "清除缓存" 按钮
document.getElementById("clearCacheBtn").addEventListener("click", () => {
    chrome.storage.local.clear(() => {
        console.log("本地缓存已清空");
        document.getElementById('mid').innerText = "MID: 未知";
        document.getElementById('username').innerText = "用户名: 未知";
        loadGroups();
        ensureUserInfo();
    });
});



// 监听选择框的变化
document.querySelectorAll(".group-checkbox").forEach(checkbox => {
    checkbox.addEventListener("change", (event) => {
        const tagId = event.target.dataset.tagid;
        const isChecked = event.target.checked;

        // 获取当前的 groupStates
        chrome.storage.local.get("groupStates", (data) => {
            const groupStates = data.groupStates || {};
            groupStates[tagId] = groupStates[tagId] || {};
            groupStates[tagId].checked = isChecked; // 更新勾选状态

            // 保存更新后的 groupStates
            chrome.storage.local.set({ groupStates }, () => {
                console.log(`分组 ${tagId} 的勾选状态已更新为: ${isChecked}`);
            });
        });
    });
});


// 更新勾选状态
checkbox.addEventListener("change", function() {
    const tagId = this.dataset.tagid;
    chrome.storage.local.get("groupStates", (data) => {
        const groupStates = data.groupStates || {};
        groupStates[tagId] = groupStates[tagId] || {};
        groupStates[tagId].checked = this.checked;
        chrome.storage.local.set({ groupStates }, () => {
            console.log(`分组 ${tagId} 的勾选状态已更新为: ${this.checked}`);
        });
    });
});


chrome.storage.local.get(null, data => {
    console.log("从存储中加载的数据:", data);
    // 其他逻辑...
});