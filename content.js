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

    chrome.storage.local.get(["tags", "groupStates"], (data) => {
        const tags = data.tags || [];
        const groupStates = data.groupStates || {};
        const maxWidth = originalNav.offsetWidth;
        let currentWidth = 0;
        let lastCustomNav = originalNav;
        let customNav = null;
        let customNavList = null;

        // 创建新的导航栏容器
        function createNewCustomNav() {
            customNav = document.createElement("div");
            customNav.className = "bili-dyn-list-tabs bili-custom-tabs";
            lastCustomNav.insertAdjacentElement("afterend", customNav);
            lastCustomNav = customNav;

            customNavList = document.createElement("div");
            customNavList.className = "bili-dyn-list-tabs__list";
            customNavList.style.display = "flex";
            customNavList.style.flexWrap = "nowrap"; // 确保不换行
            customNav.appendChild(customNavList);
            currentWidth = 0; // 重置当前宽度
        }

        // 初始化第一个自定义导航栏
        createNewCustomNav();

        tags.forEach((tag) => {
            const tagId = tag.tagid;
            const tagName = tag.name;
            const isChecked = groupStates[tagId]?.checked ?? true;
            if (!isChecked) return;

            // 创建 tab 元素
            const groupTab = document.createElement("div");
            groupTab.className = "bili-dyn-list-tabs__item";
            groupTab.innerText = tagName;
            groupTab.dataset.tagId = tagId;

            // 先添加到 DOM 中，以便计算宽度
            customNavList.appendChild(groupTab);
            const tabWidth = groupTab.offsetWidth;

            // 如果当前宽度加上新 tab 的宽度超过最大宽度，则创建新的导航栏
            if (currentWidth + tabWidth > maxWidth) {
                customNavList.removeChild(groupTab); // 从当前导航栏移除
                createNewCustomNav(); // 创建新的导航栏
                customNavList.appendChild(groupTab); // 将 tab 添加到新的导航栏
                currentWidth = tabWidth; // 重置当前宽度
            } else {
                currentWidth += tabWidth + 20; // 累加当前宽度, 20 为 tab 之间的间距
            }

            // 绑定点击事件
            groupTab.addEventListener("click", () => {
                localStorage.setItem("selectedGroupTab", tagId);
                window.location.reload();
            });
        });

        // 处理选中的 tab
        const selectedGroupTab = localStorage.getItem("selectedGroupTab");
        if (selectedGroupTab) {
            filterDynamicPosts(selectedGroupTab, true);
            document.querySelectorAll(".bili-dyn-list-tabs__item.active").forEach(el => el.classList.remove("active"));
            const activeTab = document.querySelector(`.bili-dyn-list-tabs__item[data-tag-id="${selectedGroupTab}"]`);
            if (activeTab) {
                activeTab.classList.add("active");
            }
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