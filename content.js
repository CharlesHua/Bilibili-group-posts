// 获取当前登录用户的 mid 和昵称
function getUserInfo() {
    console.log('尝试获取用户信息...');
    fetch('https://api.bilibili.com/x/web-interface/nav', { credentials: 'include' })
        .then(response => response.json())
        .then(data => {
            if (data.code === 0) {
                const mid = data.data.mid;
                const username = data.data.name;
                console.log(`成功获取用户信息: ${username} (${mid})`);
                chrome.runtime.sendMessage({
                    action: 'updateUserInfo',
                    mid: mid,
                    username: username
                });
            } else {
                console.error('获取用户信息失败:', data);
            }
        })
        .catch(error => console.error('请求错误:', error));
}

getUserInfo();

// 监听 DOM 变化，检测动态页面是否加载完成
const observer = new MutationObserver(() => {
    if (document.querySelector(".bili-dyn-list-tabs__list")) {
        observer.disconnect();
        insertFollowGroupTabs();
    }
});
observer.observe(document.body, { childList: true, subtree: true });

// 插入自定义分组按钮
function insertFollowGroupTabs() {
    const originalNav = document.querySelector(".bili-dyn-list-tabs");
    if (!originalNav) {
        console.error("未找到原始导航栏");
        return;
    }

    let customNav = document.querySelector(".bili-custom-tabs");
    if (!customNav) {
        customNav = originalNav.cloneNode(false);
        customNav.classList.add("bili-custom-tabs");
        originalNav.insertAdjacentElement("afterend", customNav);
    }
    const customNavList = document.createElement("div");
    customNavList.className = "bili-dyn-list-tabs__list";
    customNav.appendChild(customNavList);

    chrome.storage.local.get(["tags", "groupStates"], (data) => {
        const tags = data.tags || [];
        const groupStates = data.groupStates || {};

        tags.forEach((tag) => {
            const tagId = tag.tagid;
            const tagName = tag.name;
            const isChecked = groupStates[tagId]?.checked ?? true;
            if (!isChecked) return;

            const groupTab = document.createElement("div");
            groupTab.className = "bili-dyn-list-tabs__item";
            groupTab.innerText = tagName;
            groupTab.dataset.tagId = tagId;
            customNavList.appendChild(groupTab);

            // 绑定点击事件
            groupTab.addEventListener("click", () => {
                // 保存当前选中的分组到 localStorage
                localStorage.setItem("selectedGroupTab", tagId);

                // 刷新页面
                window.location.reload();
            });
        });

        // 页面加载后，检查是否有需要切换的分组
        const selectedGroupTab = localStorage.getItem("selectedGroupTab");
        if (selectedGroupTab) {
            // 切换到对应的分组
            filterDynamicPosts(selectedGroupTab, true);
            document.querySelectorAll(".bili-dyn-list-tabs__item.active").forEach(el => el.classList.remove("active"));
            const activeTab = document.querySelector(`.bili-dyn-list-tabs__item[data-tag-id="${selectedGroupTab}"]`);
            if (activeTab) {
                activeTab.classList.add("active");
            }

            // 清除 localStorage 中的选中状态
            localStorage.removeItem("selectedGroupTab");
        }
    });
}

// 筛选动态
function filterDynamicPosts(selectedTagId, isManual = false) {
    chrome.storage.local.get(null, (followGroups) => {
        if (!followGroups || !followGroups[`tag_${selectedTagId}`]) {
            console.warn("未找到对应的关注分组数据");
            return;
        }

        const targetGroup = followGroups[`tag_${selectedTagId}`];
        const targetUsernames = new Set(targetGroup.map(user => user.uname.trim()));

        if (isManual) {
            console.log(`切换到分组 ${selectedTagId}，重新筛选动态...`);
            console.log("当前分组包含的用户名:", [...targetUsernames]);
        }

        document.querySelectorAll(".bili-dyn-item").forEach(post => {
            if (post.dataset.filtered === selectedTagId) return;
            const authorElement = post.querySelector(".bili-dyn-title__text");
            if (!authorElement) {
                post.style.display = "";
                console.warn("⚠️ 未找到作者元素");
                return;
            }

            const authorName = authorElement.textContent.trim();
            if (targetUsernames.has(authorName)) {
                post.style.display = "";
                console.log(`✅ 显示动态: ${authorName}`);
            } else {
                post.style.display = "none";
                console.log(`❌ 隐藏动态: ${authorName}`);
            }
            post.dataset.filtered = selectedTagId;
        });
    });
}

// 监听新动态加载
const dynamicObserver = new MutationObserver(() => {
    const selectedTagId = getCurrentSelectedTagId();
    if (selectedTagId) {
        filterDynamicPosts(selectedTagId, false);
    }
});

const dynamicContainer = document.querySelector(".bili-dyn-list");
if (dynamicContainer) {
    dynamicObserver.observe(dynamicContainer, { childList: true, subtree: true });
}

// 获取当前选中的标签 ID
function getCurrentSelectedTagId() {
    const activeTab = document.querySelector(".bili-dyn-list-tabs__item.active");
    return activeTab ? activeTab.dataset.tagId : null;
}

// 监听存储变更，自动更新分组
chrome.storage.onChanged.addListener((changes) => {
    if (changes.selectedGroups) {
        insertFollowGroupTabs();
    }
});