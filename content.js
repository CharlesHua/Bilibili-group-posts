// 内容脚本负责动态页上的显示与过滤：
// 1. 等待 Bilibili 动态页导航栏出现
// 2. 插入我们自己的“分组标签”
// 3. 用户点击标签后，按分组成员过滤动态列表
// 4. 页面继续懒加载时，持续应用当前过滤规则

// 获取当前登录用户信息并通知其他页面。
function getUserInfo() {
  console.log("尝试获取用户信息...");

  fetch("https://api.bilibili.com/x/web-interface/nav", { credentials: "include" })
    .then((response) => response.json())
    .then((data) => {
      if (data.code !== 0) {
        console.error("获取用户信息失败:", data);
        return;
      }

      const mid = data.data.mid;
      const username = data.data.name;
      console.log(`成功获取用户信息: ${username} (${mid})`);

      chrome.runtime.sendMessage({
        action: "updateUserInfo",
        mid,
        username,
      });
    })
    .catch((error) => console.error("请求错误:", error));
}

getUserInfo();

// 等待动态页原生标签栏加载完成，再插入自定义分组标签。
const observer = new MutationObserver(() => {
  if (document.querySelector(".bili-dyn-list-tabs__list")) {
    observer.disconnect();
    insertFollowGroupTabs();
  }
});

observer.observe(document.body, { childList: true, subtree: true });

// 在动态页原本的导航区域后面插入自定义分组标签。
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

    // 当前一行放不下更多标签时，创建下一行。
    function createNewCustomNav() {
      customNav = document.createElement("div");
      customNav.className = "bili-dyn-list-tabs bili-custom-tabs";
      lastCustomNav.insertAdjacentElement("afterend", customNav);
      lastCustomNav = customNav;

      customNavList = document.createElement("div");
      customNavList.className = "bili-dyn-list-tabs__list";
      customNavList.style.display = "flex";
      customNavList.style.flexWrap = "nowrap";
      customNav.appendChild(customNavList);

      currentWidth = 0;
    }

    createNewCustomNav();

    tags.forEach((tag) => {
      const tagId = tag.tagid;
      const tagName = tag.name;
      const isChecked = groupStates[tagId]?.checked ?? true;

      if (!isChecked) {
        return;
      }

      const groupTab = document.createElement("div");
      groupTab.className = "bili-dyn-list-tabs__item";
      groupTab.innerText = tagName;
      groupTab.dataset.tagId = tagId;

      // 先插入 DOM，再测量宽度。
      customNavList.appendChild(groupTab);
      const tabWidth = groupTab.offsetWidth;

      if (currentWidth + tabWidth > maxWidth) {
        customNavList.removeChild(groupTab);
        createNewCustomNav();
        customNavList.appendChild(groupTab);
        currentWidth = tabWidth;
      } else {
        currentWidth += tabWidth + 20;
      }

      // 当前实现用“记录 + 刷新页面”的方式切换分组。
      groupTab.addEventListener("click", () => {
        localStorage.setItem("selectedGroupTab", tagId);
        window.location.reload();
      });
    });

    // 刷新后恢复选中的标签并立即执行过滤。
    const selectedGroupTab = localStorage.getItem("selectedGroupTab");
    if (selectedGroupTab) {
      filterDynamicPosts(selectedGroupTab, true);

      document
        .querySelectorAll(".bili-dyn-list-tabs__item.active")
        .forEach((element) => element.classList.remove("active"));

      const activeTab = document.querySelector(`.bili-dyn-list-tabs__item[data-tag-id="${selectedGroupTab}"]`);
      if (activeTab) {
        activeTab.classList.add("active");
      }

      localStorage.removeItem("selectedGroupTab");
    }
  });
}

// 根据选中的分组过滤动态列表。
function filterDynamicPosts(selectedTagId, isManual = false) {
  chrome.storage.local.get(null, (followGroups) => {
    if (!followGroups || !followGroups[`tag_${selectedTagId}`]) {
      console.warn("未找到对应的关注分组数据");
      return;
    }

    const targetGroup = followGroups[`tag_${selectedTagId}`];
    const targetUsernames = new Set(targetGroup.map((user) => user.uname.trim()));

    if (isManual) {
      console.log(`切换到分组 ${selectedTagId}，重新筛选动态...`);
      console.log("当前分组包含的用户名称:", [...targetUsernames]);
    }

    document.querySelectorAll(".bili-dyn-item").forEach((post) => {
      // 如果当前分组已经处理过这条动态，就不重复处理。
      if (post.dataset.filtered === selectedTagId) {
        return;
      }

      const authorElement = post.querySelector(".bili-dyn-title__text");
      if (!authorElement) {
        post.style.display = "";
        console.warn("未找到作者元素");
        return;
      }

      const authorName = authorElement.textContent.trim();
      if (targetUsernames.has(authorName)) {
        post.style.display = "";
        console.log(`显示动态: ${authorName}`);
      } else {
        post.style.display = "none";
        console.log(`隐藏动态: ${authorName}`);
      }

      post.dataset.filtered = selectedTagId;
    });
  });
}

// 页面继续懒加载时，对新增动态继续应用过滤规则。
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

// 获取当前 active 的分组标签 id。
function getCurrentSelectedTagId() {
  const activeTab = document.querySelector(".bili-dyn-list-tabs__item.active");
  return activeTab ? activeTab.dataset.tagId : null;
}

// 保留一个 storage 监听入口，后续如果希望在不刷新页面的情况下重建标签，可以从这里扩展。
chrome.storage.onChanged.addListener((changes) => {
  if (changes.selectedGroups) {
    insertFollowGroupTabs();
  }
});
