/**
 * ThemeManager 模块 - 管理应用主题切换
 */

const sunIcon = `
    <path d="M12 4.5V2m0 20v-2.5M4.93 4.93 3.51 3.51m16.98 16.98-1.42-1.42M4.5 12H2m20 0h-2.5M4.93 19.07l-1.42 1.42m16.98-16.98-1.42 1.42M12 7.5A4.5 4.5 0 1 1 7.5 12 4.505 4.505 0 0 1 12 7.5z"/>
`;
const moonIcon = `
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
`;
const systemIcon = `
    <path d="M3 4h18v12H3z M8 20h8M10 16h4" stroke-width="2" stroke="currentColor" fill="none"/>
`;

/**
 * 应用主题（更新所有主题图标按钮）
 * @param {string} mode - 'light' | 'dark' | 'auto'
 */
export function applyTheme(mode) {
    document.documentElement.classList.remove("light", "dark");
    
    // 获取所有主题图标和按钮
    const themeToggles = [
        { btn: document.getElementById("theme-toggle-btn"), icon: document.getElementById("theme-icon") },
        { btn: document.getElementById("editor-theme-toggle-btn"), icon: document.getElementById("editor-theme-icon") }
    ];
    
    let iconHtml;
    let isActive;
    
    if (mode === "light") {
        document.documentElement.classList.add("light");
        iconHtml = sunIcon;
        isActive = false;
    } else if (mode === "dark") {
        document.documentElement.classList.add("dark");
        iconHtml = moonIcon;
        isActive = true;
    } else {
        const systemDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
        iconHtml = systemIcon;
        isActive = systemDark;
    }
    
    // 更新所有主题切换按钮
    themeToggles.forEach(({ btn, icon }) => {
        if (btn && icon) {
            icon.innerHTML = iconHtml;
            btn.classList.toggle("active", isActive);
        }
    });
}

/**
 * 获取下一个主题
 * @param {string} current - 当前主题
 * @returns {string} 下一个主题
 */
export function getNextTheme(current) {
    return current === "light" ? "dark" : current === "dark" ? "auto" : "light";
}

/**
 * 处理主题切换
 * @param {function} onThemeChange - 主题变更回调
 */
function handleThemeToggle(onThemeChange) {
    const current = localStorage.getItem("theme") || "auto";
    const next = getNextTheme(current);
    applyTheme(next);
    localStorage.setItem("theme", next);
    if (onThemeChange) {
        onThemeChange();
    }
}

/**
 * 初始化主题管理器
 * @param {function} onThemeChange - 主题变更回调
 */
export function initThemeManager(onThemeChange) {
    const saved = localStorage.getItem("theme") || "auto";
    applyTheme(saved);
    
    // 绑定游戏模式的主题切换
    document.getElementById("theme-toggle").addEventListener("click", () => {
        handleThemeToggle(onThemeChange);
    });
    
    // 绑定编辑器模式的主题切换
    document.getElementById("editor-theme-toggle").addEventListener("click", () => {
        handleThemeToggle(onThemeChange);
    });
}

/**
 * 从CSS变量获取颜色值
 * @returns {object} 颜色对象
 */
export function getColorsFromCSS() {
    const computedStyle = getComputedStyle(document.documentElement);
    return {
        ground: computedStyle.getPropertyValue('--ground-color').trim(),
        gridLine: computedStyle.getPropertyValue('--grid-line-color').trim(),
        unexplored: computedStyle.getPropertyValue('--unexplored-color').trim(),
        wall: computedStyle.getPropertyValue('--wall-color').trim(),
        player: computedStyle.getPropertyValue('--player-color').trim(),
        ghost: computedStyle.getPropertyValue('--ghost-color').trim(),
        endPoint: computedStyle.getPropertyValue('--end-point-color').trim(),
        startPoint: computedStyle.getPropertyValue('--start-point-color').trim(),
        key: computedStyle.getPropertyValue('--key-color').trim(),
        startRoomHighlight: computedStyle.getPropertyValue('--start-room-highlight').trim(),
        hoverHighlight: computedStyle.getPropertyValue('--hover-highlight-color').trim(),
        text: computedStyle.getPropertyValue('--text-color').trim(),
        voidGrid: computedStyle.getPropertyValue('--void-grid-color').trim()
    };
}
